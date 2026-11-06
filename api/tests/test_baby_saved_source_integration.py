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
