"""Save two image originals without processing; retry/edit keep private uploads."""

from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import func, select

from app.domains.baby import storage
from app.domains.baby.models import BabyAIAdmission, BabyAttachment, BabyImport, BabyRecord
from app.domains.baby.provider import BabyProvider
from app.domains.baby.schemas import RecordCreate
from app.models.ai import AIInvocation
from tests import test_baby_integration as shared

baby_api = shared.baby_api


@pytest.mark.parametrize(
    "status", [None, "saved", "queued", "processing", "ready", "incomplete", "failed", "cancelled"]
)
def test_source_states_remain_explicit_and_preserved(status):
    source = RecordCreate(
        kind="source", title="Source", occurred_at=datetime.now(UTC), data={"status": status}
    )
    assert source.data["status"] == status


@pytest.mark.parametrize("status", ["complete", "completed", "", "unknown", "SAVED"])
def test_source_state_contract_still_rejects_unknown_states(status):
    with pytest.raises(ValidationError):
        RecordCreate(
            kind="source", title="Source", occurred_at=datetime.now(UTC), data={"status": status}
        )


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_two_image_only_saved_source_create_replay_edit_retains_actual_private_uploads(
    baby_api,
    monkeypatch,
    tmp_path,
):
    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            environment="test",
            baby_local_storage_dir=str(tmp_path),
        ),
    )
    extract, transcribe = (
        AsyncMock(side_effect=AssertionError("Save must not process")),
        AsyncMock(side_effect=AssertionError("Save must not transcribe")),
    )
    monkeypatch.setattr(BabyProvider, "extract", extract)
    monkeypatch.setattr(BabyProvider, "transcribe", transcribe)
    c = baby_api.client
    assets, metadata = [], []
    # HEIC is normalized on the native client before upload. Exercise its actual
    # supported JPEG wire representation alongside the independently shared PNG.
    for name, format_, mime in [
        ("shared.png", "PNG", "image/png"),
        ("normalized-heic.jpg", "JPEG", "image/jpeg"),
    ]:
        image = BytesIO()
        Image.new("RGB", (24, 24), "white").save(image, format_)
        identifier = str(uuid4())
        response = await c.post(
            "/api/v1/baby/attachments",
            headers={
                **shared.GEN,
                "Idempotency-Key": identifier,
            },
            files={"file": (name, image.getvalue(), mime)},
        )
        assert response.status_code == 200, response.text
        assert response.json()["id"] == identifier
        assets.append(identifier)
        metadata.append(response.json())
    request = shared.payload(
        "source",
        title="Saved source",
        body="",
        data={
            "status": "saved",
            "topics": [],
            "attachment_ids": assets,
        },
    )
    created = await c.post("/api/v1/baby/records", headers=shared.GEN, json=request)
    replay = await c.post("/api/v1/baby/records", headers=shared.GEN, json=request)
    assert created.status_code == replay.status_code == 200, (created.text, replay.text)
    # PostgreSQL returns timestamps in UTC; replay preserves the same instant.
    assert datetime.fromisoformat(created.json()["occurred_at"]) == datetime.fromisoformat(
        replay.json()["occurred_at"]
    )
    assert {k: v for k, v in created.json().items() if k != "occurred_at"} == {
        k: v for k, v in replay.json().items() if k != "occurred_at"
    }
    assert created.json()["id"] == request["id"] and created.json()["revision"] == 1
    assert created.json()["data"]["status"] == "saved"
    assert created.json()["data"]["attachment_ids"] == assets
    assert created.json()["data"]["source_text"] is None
    edited = await c.patch(
        f"/api/v1/baby/records/{request['id']}",
        headers=shared.GEN,
        json={
            "revision": 1,
            "title": "Edited saved source",
            "data": {**created.json()["data"], "topics": ["Original images"]},
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["revision"] == 2 and edited.json()["data"]["status"] == "saved"
    invalid = await c.patch(
        f"/api/v1/baby/records/{request['id']}",
        headers=shared.GEN,
        json={"revision": 2, "data": {"status": "completed", "attachment_ids": assets}},
    )
    assert invalid.status_code == 422
    reopened = await c.get(f"/api/v1/baby/records/{request['id']}")
    assert reopened.json() == edited.json()
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyRecord)) == 1
        rows = list(await db.scalars(select(BabyAttachment)))
        assert len(rows) == 2 and all(row.state == "ready" for row in rows)
        for row in rows:
            private_path = tmp_path / row.object_key
            assert private_path.is_file()
            authorized = await c.get(f"/api/v1/baby/attachments/{row.id}")
            assert authorized.status_code == 200 and authorized.content == private_path.read_bytes()
            assert authorized.headers["cache-control"] == "private, no-store"
            assert (
                await c.get(f"/api/v1/baby/attachments/{row.id}", headers={"X-Test-Owner": "other"})
            ).status_code == 404
        assert await db.scalar(select(func.count()).select_from(BabyImport)) == 0
        assert await db.scalar(select(func.count()).select_from(BabyAIAdmission)) == 0
        assert await db.scalar(select(func.count()).select_from(AIInvocation)) == 0
    for identifier, original in zip(assets, metadata, strict=True):
        assert (await c.get(f"/api/v1/baby/attachments/{identifier}/metadata")).json() == original
    extract.assert_not_awaited()
    transcribe.assert_not_awaited()


@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_pre_upgrade_source_creation_replay_preserves_original_fingerprint(baby_api):
    from app.domains.baby.lifecycle import digest

    request = shared.payload("source", data={"summary": "Original summary"})
    normalized = RecordCreate.model_validate(request).model_dump(mode="json")
    for field in ["key_points", "steps", "creator", "platform", "thumbnail_url"]:
        normalized["data"].pop(field, None)
    # Store the exact pre-upgrade fingerprint, not one generated by new schemas.
    async with baby_api.sessions() as db:
        db.add(BabyRecord(**RecordCreate.model_validate(request).model_dump(), app_user_id="owner",
                          generation=1, revision=1, creation_hash=digest(normalized),
                          created_at=datetime.now(UTC), updated_at=datetime.now(UTC)))
        from app.domains.baby.models import BabyMembership

        with db.no_autoflush:
            for seeded in list(db.new):
                if hasattr(seeded, "space_id") and seeded.space_id is None:
                    seeded.space_id = (await db.get(BabyMembership, seeded.app_user_id)).personal_space_id
        await db.commit()
    response = await baby_api.client.post("/api/v1/baby/records", headers=shared.GEN, json=request)
    assert response.status_code == 200 and response.json()["id"] == request["id"]
    changed = await baby_api.client.post("/api/v1/baby/records", headers=shared.GEN,
                                        json={**request, "data": {**request["data"], "key_points": ["New claim"]}})
    assert changed.status_code == 409



@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
@pytest.mark.parametrize("family_enabled", [False, True])
async def test_unreadable_photo_retry_improves_the_same_private_source(baby_api, monkeypatch, tmp_path, family_enabled):
    baby_api.settings.baby_family_enabled = family_enabled
    from pillow_heif import from_pillow

    from app.domains.baby import processing
    from app.domains.baby.provider import ExtractionOutput
    from app.domains.baby.runtime import BabyWorker
    monkeypatch.setattr(storage, "get_settings", lambda: SimpleNamespace(environment="test", baby_local_storage_dir=str(tmp_path)))
    c = baby_api.client
    assert (await c.patch("/api/v1/baby/profile", headers=shared.GEN, json={"ai_consent":True})).status_code == 200
    class Unavailable:
        def __init__(self, **kwargs): pass
        async def acquire(self, *args, **kwargs): raise ValueError("Unavailable linked source")
    monkeypatch.setattr(processing, "ProductionSourceAcquirer", Unavailable)
    seen = []
    class Provider:
        enabled = True
        def __init__(self, **kwargs): pass
        async def extract(self, source, categories=None):
            seen.extend(image.location for image in source.images)
            assert source.images and source.images[0].normalized
            return ExtractionOutput(title="Screenshot checklist", key_points=["Creator's literal list (image attachment:0)"],
                visual_text=[{"location":"attachment:0", "text":"Literal screenshot label"}])
    worker = BabyWorker(baby_api.sessions, provider_factory=Provider)
    body = {"id":str(uuid4()), "url":"https://www.tiktok.com/@synthetic/photo/123"}
    created = (await c.post("/api/v1/baby/imports", headers=shared.GEN, json=body)).json()
    record_id = created["record_id"]
    assert await worker.tick()
    original = (await c.get(f"/api/v1/baby/records/{record_id}")).json()
    assert original["data"]["status"] == "incomplete"
    image = BytesIO()
    from_pillow(Image.new("RGB", (120, 160), "white")).save(image)
    attachment_id = str(uuid4())
    uploaded = await c.post("/api/v1/baby/attachments", headers={**shared.GEN,"Idempotency-Key":attachment_id},
                            files={"file":("screenshot.heic",image.getvalue(),"image/heic")})
    assert uploaded.status_code == 200, uploaded.text
    patched = await c.patch(f"/api/v1/baby/records/{record_id}", headers=shared.GEN,
                            json={"revision":original["revision"],"data":{**original["data"],"attachment_ids":[attachment_id]}})
    assert patched.status_code == 200
    retried = await c.post(f"/api/v1/baby/imports/{body['id']}/retry", headers=shared.GEN)
    assert retried.status_code == 200
    assert await worker.tick()
    saved = (await c.get(f"/api/v1/baby/records/{record_id}")).json()
    assert saved["data"]["attachment_ids"] == [attachment_id]
    assert saved["data"]["key_points"] == ["Creator's literal list (image attachment:0)"]
    assert "Literal screenshot label" in saved["data"]["source_text"] and seen == ["attachment:0"]
    # A buggy/malicious processor result still cannot detach it in the merge.
    from app.domains.baby.runtime import keep_user_decisions
    assert "attachment_ids" not in keep_user_decisions(saved["data"], {"attachment_ids":[]})
    assert (await c.get(f"/api/v1/baby/records/{record_id}",headers={"X-Test-Owner":"other"})).status_code == 404

@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_repeated_url_reads_do_not_multiply_evidence_or_promote_parent_notes(baby_api, monkeypatch):
    from app.domains.baby import processing
    from app.domains.baby.provider import ExtractionOutput
    from app.domains.baby.runtime import BabyWorker
    from app.domains.workouts.extraction import SourceBundle, SourceMetadata, SourcePart
    c = baby_api.client
    await c.patch("/api/v1/baby/profile",headers=shared.GEN,json={"ai_consent":True})
    note, caption = "At 37 weeks I saved this for later", "The creator lists ordinary packing items"
    class Acquirer:
        def __init__(self, **kwargs): pass
        async def acquire(self, *args, **kwargs):
            return SourceBundle(SourceMetadata(title="Packing"), parts=[SourcePart("caption",caption)])
    monkeypatch.setattr(processing,"ProductionSourceAcquirer",Acquirer)
    class Provider:
        enabled=True
        def __init__(self, **kwargs): pass
        async def extract(self, source, categories=None):
            return ExtractionOutput(title="Packing", relevance={"stage":"pregnancy","pregnancy_week_min":37,"quote":"At 37 weeks"})
    worker=BabyWorker(baby_api.sessions,provider_factory=Provider)
    identifier=str(uuid4())
    first=(await c.post("/api/v1/baby/imports",headers=shared.GEN,json={"id":identifier,"url":"https://example.com/post","text":note})).json()
    record_id=first["record_id"]
    assert await worker.tick()
    for _ in range(4):
        saved=(await c.get(f"/api/v1/baby/records/{record_id}")).json()
        queued=await c.post("/api/v1/baby/imports",headers=shared.GEN,json={"id":str(uuid4()),"record_id":record_id,
            "url":"https://example.com/post","text":saved["data"]["source_text"]})  # old client echoes AI/caption text
        assert queued.status_code==200,queued.text
        assert await worker.tick()
    saved=(await c.get(f"/api/v1/baby/records/{record_id}")).json()
    assert saved["data"]["source_text"].count(caption)==1 and saved["data"]["source_text"].count(note)==1
    assert not saved["data"].get("relevance") and saved["data"]["user_text"]==note
    rejected=await c.post("/api/v1/baby/imports",headers=shared.GEN,json={"id":str(uuid4()),"record_id":record_id})
    assert rejected.status_code==429
    assert (await c.post(f"/api/v1/baby/imports/{identifier}/retry",headers=shared.GEN)).status_code==200  # ready is an idempotent no-op

@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
@pytest.mark.parametrize("family_enabled", [False, True])
async def test_failed_reread_preserves_prior_read_without_using_it_as_fresh_evidence(baby_api,monkeypatch,family_enabled):
    from app.domains.baby import processing
    from app.domains.baby.provider import ExtractionOutput
    from app.domains.baby.runtime import BabyWorker
    from app.domains.workouts.extraction import SourceBundle, SourceMetadata, SourcePart
    baby_api.settings.baby_family_enabled=family_enabled
    c=baby_api.client
    await c.patch("/api/v1/baby/profile",headers=shared.GEN,json={"ai_consent":True})
    class Acquirer:
        reads=0
        def __init__(self,**kwargs): pass
        async def acquire(self,*args,**kwargs):
            Acquirer.reads+=1
            if Acquirer.reads>1:
                raise ValueError("Unavailable source")
            return SourceBundle(SourceMetadata(title="Checklist"),parts=[SourcePart("caption","Earlier creator caption")],
                warnings=["One original image was not read; caption retained."])
    monkeypatch.setattr(processing,"ProductionSourceAcquirer",Acquirer)
    seen=[]
    class Provider:
        enabled=True
        def __init__(self,**kwargs): pass
        async def extract(self,source,categories=None):
            seen.append([p.text for p in source.parts])
            return ExtractionOutput(title="Checklist",summary="Earlier summary" if len(seen)==1 else "Note only",
                key_points=["Earlier supported tip"] if len(seen)==1 else ["Parent note only"])
    identifier=str(uuid4())
    made=(await c.post("/api/v1/baby/imports",headers=shared.GEN,json={"id":identifier,
        "url":"https://example.com/post","text":"My own note"})).json()
    worker=BabyWorker(baby_api.sessions,provider_factory=Provider)
    assert await worker.tick()
    before=(await c.get(f"/api/v1/baby/records/{made['record_id']}")).json()
    assert (await c.post(f"/api/v1/baby/imports/{identifier}/retry",headers=shared.GEN)).status_code==200
    assert await worker.tick()
    after=(await c.get(f"/api/v1/baby/records/{made['record_id']}")).json()
    assert after["data"]["status"]=="incomplete"
    for key in ["source_text","summary","evidence","key_points"]:
        assert after["data"][key]==before["data"][key]
    assert seen[1]==["My own note"]
    assert any("Previously saved text" in note for note in after["data"]["coverage_notes"])

@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
@pytest.mark.parametrize("family_enabled",[False,True])
async def test_source_attempt_limit_stops_expired_fifth_claim(baby_api,family_enabled):
    from datetime import timedelta
    from uuid import UUID

    from app.domains.baby.runtime import BabyWorker
    baby_api.settings.baby_family_enabled=family_enabled
    c=baby_api.client
    first=(await c.post("/api/v1/baby/imports",headers=shared.GEN,json={"id":str(uuid4()),"text":"Original"})).json()
    async with baby_api.sessions() as db:
        job=await db.get(BabyImport,UUID(first["id"]))
        job.status="incomplete"
        job.attempts=4
        source=await db.get(BabyRecord,UUID(first["record_id"]))
        source.data={**source.data,"status":"incomplete"}
        await db.commit()
    fifth=(await c.post("/api/v1/baby/imports",headers=shared.GEN,json={"id":str(uuid4()),"record_id":first["record_id"]})).json()
    async with baby_api.sessions() as db:
        job=await db.get(BabyImport,UUID(fifth["id"]))
        job.status="processing"
        job.attempts=1
        job.lease_until=datetime.now(UTC)-timedelta(seconds=1)
        job.lease_token=uuid4()
        await db.commit()
    processor=AsyncMock(side_effect=AssertionError("No sixth source read"))
    assert await BabyWorker(baby_api.sessions,processor=processor).tick()
    processor.assert_not_awaited()
    assert (await c.get(f"/api/v1/baby/imports/{fifth['id']}")).json()["status"]=="failed"

@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_worker_uses_url_edited_after_admission(baby_api):
    from app.domains.baby.runtime import BabyWorker
    c=baby_api.client
    job=(await c.post("/api/v1/baby/imports",headers=shared.GEN,json={"id":str(uuid4()),"url":"https://example.com/old"})).json()
    saved=(await c.get(f"/api/v1/baby/records/{job['record_id']}")).json()
    changed=await c.patch(f"/api/v1/baby/records/{job['record_id']}",headers=shared.GEN,
        json={"revision":saved["revision"],"data":{**saved["data"],"url":"https://example.com/edited"}})
    assert changed.status_code==200
    seen=[]
    async def processor(request,*args,**kwargs):
        seen.append(request["url"])
        return {"status":"ready","title":"Read","data":{"url":request["url"],"status":"ready"}}
    assert await BabyWorker(baby_api.sessions,processor=processor).tick()
    after=(await c.get(f"/api/v1/baby/records/{job['record_id']}")).json()
    assert seen==["https://example.com/edited"] and after["data"]["url"]==seen[0]

@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
async def test_import_attachment_union_keeps_eight_and_rejects_ninth(baby_api,monkeypatch,tmp_path):
    monkeypatch.setattr(storage,"get_settings",lambda:SimpleNamespace(environment="test",baby_local_storage_dir=str(tmp_path)))
    c=baby_api.client
    assets=[]
    image=BytesIO()
    Image.new("RGB",(2,2),"white").save(image,"PNG")
    for _ in range(9):
        identifier=str(uuid4())
        r=await c.post("/api/v1/baby/attachments",headers={**shared.GEN,"Idempotency-Key":identifier},
            files={"file":("screenshot.png",image.getvalue(),"image/png")})
        assert r.status_code==200
        assets.append(identifier)
    body=shared.payload("source",data={"status":"saved","attachment_ids":assets[:8]})
    assert (await c.post("/api/v1/baby/records",headers=shared.GEN,json=body)).status_code==200
    rejected=await c.post("/api/v1/baby/imports",headers=shared.GEN,
        json={"id":str(uuid4()),"record_id":body["id"],"attachment_ids":[assets[8]]})
    assert rejected.status_code==422 and rejected.json()["detail"]["code"] == "source_attachment_limit"
    saved=(await c.get(f"/api/v1/baby/records/{body['id']}")).json()
    assert saved["data"]["attachment_ids"]==assets[:8] and saved["data"]["status"]=="saved"
    accepted=await c.post("/api/v1/baby/imports",headers=shared.GEN,
        json={"id":str(uuid4()),"record_id":body["id"],"attachment_ids":[assets[0]]})
    assert accepted.status_code==200

@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
@pytest.mark.parametrize("known_original",[False,True])
async def test_legacy_text_survives_without_becoming_acquired_input(baby_api,monkeypatch,known_original):
    from uuid import UUID

    from app.domains.baby import processing
    from app.domains.baby.provider import ExtractionOutput
    from app.domains.baby.runtime import BabyWorker
    from app.domains.workouts.extraction import SourceBundle, SourceMetadata, SourcePart
    c=baby_api.client
    await c.patch("/api/v1/baby/profile",headers=shared.GEN,json={"ai_consent":True})
    note="Legacy original parent note"
    earlier="Old acquired caption and model-read labels"
    if known_original:
        job=(await c.post("/api/v1/baby/imports",headers=shared.GEN,json={"id":str(uuid4()),"url":"https://example.com/post","text":note})).json()
        record_id=job["record_id"]
        async with baby_api.sessions() as db:
            row=await db.get(BabyImport,UUID(job["id"]))
            row.status="incomplete"
            await db.commit()
    else:
        body=shared.payload("source",body="",data={"url":"https://example.com/post","source_text":"Original save","status":"saved"})
        saved=await c.post("/api/v1/baby/records",headers=shared.GEN,json=body)
        assert saved.status_code==200
        record_id=body["id"]
    async with baby_api.sessions() as db:
        source=await db.get(BabyRecord,UUID(record_id))
        source.data={**source.data,"source_text":earlier,"status":"incomplete"}
        source.data.pop("user_text",None)
        source.revision+=1
        await db.commit()
    class Acquirer:
        def __init__(self,**kwargs): pass
        async def acquire(self,*args,**kwargs):
            return SourceBundle(SourceMetadata(title="Fresh"),parts=[SourcePart("caption","Fresh caption")])
    monkeypatch.setattr(processing,"ProductionSourceAcquirer",Acquirer)
    seen=[]
    class Provider:
        enabled=True
        def __init__(self,**kwargs): pass
        async def extract(self,source,categories=None):
            seen.append([part.text for part in source.parts])
            return ExtractionOutput(title="Fresh",summary="Fresh summary")
    worker=BabyWorker(baby_api.sessions,provider_factory=Provider)
    for _ in range(2):
        queued=await c.post("/api/v1/baby/imports",headers=shared.GEN,json={"id":str(uuid4()),"record_id":record_id,"text":earlier})
        assert queued.status_code==200,queued.text
        assert await worker.tick()
    result=(await c.get(f"/api/v1/baby/records/{record_id}")).json()["data"]
    assert all(earlier not in parts for parts in seen)
    if known_original:
        assert result["user_text"]==note and all(note in parts for parts in seen)
    else:
        assert result["legacy_saved_text"]==earlier and all(parts==["Fresh caption"] for parts in seen)
        assert result["source_text"]=="Fresh caption"

@pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
@pytest.mark.parametrize("saved_url",[None,"https://example.com/old"])
async def test_admitted_replacement_url_remains_current_for_worker_and_retry(baby_api,saved_url):
    from app.domains.baby.runtime import BabyWorker
    c=baby_api.client
    body=shared.payload("source",body="My note",data={"url":saved_url,"status":"incomplete"})
    assert (await c.post("/api/v1/baby/records",headers=shared.GEN,json=body)).status_code==200
    job=(await c.post("/api/v1/baby/imports",headers=shared.GEN,json={"id":str(uuid4()),"record_id":body["id"],"url":"https://example.com/replacement"})).json()
    seen=[]
    async def processor(request,*args,**kwargs):
        seen.append(request["url"])
        return {"status":"incomplete","data":{"url":request["url"],"status":"incomplete"}}
    worker=BabyWorker(baby_api.sessions,processor=processor)
    assert await worker.tick()
    assert (await c.post(f"/api/v1/baby/imports/{job['id']}/retry",headers=shared.GEN)).status_code==200
    assert await worker.tick()
    assert seen==["https://example.com/replacement"]*2
    assert (await c.get(f"/api/v1/baby/records/{body['id']}")).json()["data"]["url"]==seen[0]


@pytest.mark.parametrize("family_enabled", [False, True])
@pytest.mark.parametrize("failure", ["outage", "daily", "caption"])
async def test_weaker_retry_keeps_saved_reading_as_one_unit(baby_api, monkeypatch, family_enabled, failure):
    from app.domains.baby import processing
    from app.domains.baby.provider import ExtractionOutput, ProviderUnavailable
    from app.domains.baby.runtime import BabyWorker
    from app.domains.workouts.budget import BudgetError
    from app.domains.workouts.extraction import SourceBundle, SourceMetadata, SourcePart
    baby_api.settings.baby_family_enabled = family_enabled
    c = baby_api.client
    await c.patch("/api/v1/baby/profile", headers=shared.GEN, json={"ai_consent": True})
    reading = {"url": "https://www.tiktok.com/@synthetic/photo/123", "status": "incomplete",
        "source_text": "Caption\n\nheating pad\nlabor comb", "summary": "The creator's saved packing list.",
        "key_points": ["Creator lists heating pad and labor comb (slide 2)"],
        "evidence": [{"location": "caption", "text": "Caption"}, {"location": "image:1", "text": "heating pad\nlabor comb"}]}
    request = shared.payload("source", title="Earlier reading", data=reading)
    assert (await c.post("/api/v1/baby/records", headers=shared.GEN, json=request)).status_code == 200
    class Acquirer:
        def __init__(self, **kwargs): pass
        async def acquire(self, *args, **kwargs):
            return SourceBundle(SourceMetadata(coverage_notes=["Slide 2 could not be read; its details may be missing."]),
                                parts=[SourcePart("caption", "Caption")])
    class Provider:
        enabled = True
        def __init__(self, **kwargs): pass
        async def extract(self, source, categories=None):
            if failure == "outage":
                raise ProviderUnavailable()
            if failure == "daily":
                raise BudgetError("workouts_ai_budget_exceeded")
            return ExtractionOutput(title="Caption reading", summary="Caption only.", key_points=["Only caption"])
    monkeypatch.setattr(processing, "ProductionSourceAcquirer", Acquirer)
    response = await c.post("/api/v1/baby/imports", headers=shared.GEN,
                            json={"id": str(uuid4()), "record_id": request["id"]})
    assert response.status_code == 200
    assert await BabyWorker(baby_api.sessions, provider_factory=Provider).tick()
    saved = (await c.get(f"/api/v1/baby/records/{request['id']}")).json()["data"]
    for field in ("source_text", "summary", "evidence", "key_points"):
        assert saved[field] == reading[field]
    assert saved["status"] == "incomplete"
    assert any("Previously saved text is shown" in note for note in saved["coverage_notes"])


def test_partial_retry_with_same_evidence_can_improve_and_ready_can_replace():
    from app.domains.baby.runtime import keep_user_decisions
    current = {"url": "https://example.com/post", "summary": "Old", "source_text": "Label", "evidence": [{"location":"image:0", "text":"Label"}]}
    for status in ("ready", "incomplete"):
        organized = {"status": status, "summary": "Better", "source_text": "Label plus", "evidence": [{"location":"image:0", "text":"Label plus"}]}
        assert keep_user_decisions(current, organized) == organized


@pytest.mark.parametrize("case, status, code", [("sixth",429,"source_retry_limit"), ("waiting",429,"source_queue_full"),
    ("daily",429,"source_daily_limit"), ("active",409,"source_already_processing")])
async def test_import_refusals_have_safe_codes_and_preserve_the_source(baby_api, case, status, code):
    from uuid import UUID
    c = baby_api.client
    created = (await c.post("/api/v1/baby/imports", headers=shared.GEN, json={"id":str(uuid4()),"text":"Original"})).json()
    async with baby_api.sessions() as db:
        row = await db.get(BabyImport, UUID(created["id"]))
        row.status, row.attempts = ("queued" if case == "active" else "incomplete"), (5 if case == "sixth" else 1)
        if case in {"waiting", "daily"}:
            for _ in range(5 if case == "waiting" else 29):
                db.add(BabyImport(app_user_id=row.app_user_id, space_id=row.space_id, generation=1, consent_epoch=row.consent_epoch,
                    creation_hash="synthetic", request={}, record_id=row.record_id, status="queued" if case == "waiting" else "incomplete"))
        await db.commit()
    before = (await c.get(f"/api/v1/baby/records/{created['record_id']}")).json()
    refused = await c.post("/api/v1/baby/imports", headers=shared.GEN,
                           json={"id":str(uuid4()),"record_id":created["record_id"]})
    assert refused.status_code == status and refused.json()["detail"]["code"] == code
    after = (await c.get(f"/api/v1/baby/records/{created['record_id']}")).json()
    assert after == before


async def test_retry_route_enforces_source_wide_limit_not_just_this_row(baby_api):
    from uuid import UUID
    c = baby_api.client
    first = (await c.post("/api/v1/baby/imports",headers=shared.GEN,json={"id":str(uuid4()),"text":"Original"})).json()
    async with baby_api.sessions() as db:
        row = await db.get(BabyImport, UUID(first["id"]))
        row.status, row.attempts = "incomplete", 1
        db.add(BabyImport(app_user_id=row.app_user_id, space_id=row.space_id, generation=1, consent_epoch=row.consent_epoch,
            creation_hash="synthetic", request={}, record_id=row.record_id, status="incomplete", attempts=4))
        await db.commit()
    response = await c.post(f"/api/v1/baby/imports/{first['id']}/retry", headers=shared.GEN)
    assert response.status_code == 429 and response.json()["detail"]["code"] == "source_retry_limit"
