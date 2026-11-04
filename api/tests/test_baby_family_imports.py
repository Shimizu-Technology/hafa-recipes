"""F4f endpoint + worker acceptance using stored space, generation and lease."""
from datetime import timedelta
from uuid import uuid4

import pytest

from app.domains.baby.models import BabyImport, BabyMembership, BabyRecord, BabySpaceMember
from app.domains.baby.runtime import BabyWorker
from app.domains.baby.share_models import BabyShareCapture
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


@pytest.mark.parametrize("scenario", ["ready", "edit", "removed", "expired_lease", "moved", "consent", "failure", "attempts"])
async def test_stored_space_worker_gates_and_stamps_every_completion(baby_api, family, scenario, baby_mutation_paths):
    assert scenario in baby_mutation_paths["worker"]
    c, h = baby_api.client, records.headers(family)
    assert (await c.patch("/api/v1/baby/profile", headers=h, json={"ai_consent": True})).status_code == 200
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    for space, generation, title in ((family, 7, "Shared category"), (personal, 1, "Hidden category")):
        result = await c.post("/api/v1/baby/records", headers=records.headers(space, generation=generation),
                              json=shared.payload("collection", title=title, data={"record_ids": []}))
        assert result.status_code == 200, result.text
    request = {"id": str(uuid4()), "text": "Original synthetic source"}
    created = await c.post("/api/v1/baby/imports", headers=h, json=request)
    assert created.status_code == 200 and created.json()["generation"] == 7, created.text
    source_id = created.json()["record_id"]
    if scenario == "attempts":
        async with baby_api.sessions() as db:
            job = await db.get(BabyImport, request["id"])
            job.attempts = 5
            await db.commit()
    called = []

    async def processor(request, assets, provider, **kwargs):
        called.append(True)
        assert [item["title"] for item in request["categories"]] == ["Shared category"]
        if scenario == "edit":
            source = (await c.get(f"/api/v1/baby/records/{source_id}", headers=h)).json()
            result = await c.patch(f"/api/v1/baby/records/{source_id}", headers=h,
                                   json={"revision": source["revision"], "body": "User edit"})
            assert result.status_code == 200
        elif scenario == "consent":
            assert (await c.patch("/api/v1/baby/profile", headers=h, json={"ai_consent": False})).status_code == 200
        elif scenario in {"removed", "expired_lease", "moved"}:
            async with baby_api.sessions() as db:
                job = await db.get(BabyImport, request["id"])
                if scenario == "removed":
                    (await db.get(BabySpaceMember, (family, "owner"))).status = "removed"
                elif scenario == "expired_lease":
                    from app.domains.baby.lifecycle import now
                    job.lease_until = now() - timedelta(seconds=1)
                else:
                    source = await db.get(BabyRecord, source_id)
                    source.space_id, source.generation = personal, 1
                    job.space_id, job.generation, job.status, job.lease_token = personal, 1, "queued", None
                await db.commit()
        elif scenario == "failure":
            raise ValueError("Synthetic processing failure")
        return {"title": "Processed", "data": {"source_text": "Processed data", "status": "ready"}, "status": "ready"}

    assert await BabyWorker(baby_api.sessions, processor=processor).tick()
    async with baby_api.sessions() as db:
        job, source = await db.get(BabyImport, request["id"]), await db.get(BabyRecord, source_id)
        assert job.change_seq > 0 and source.change_seq > 0
        if scenario == "ready":
            assert job.status == "ready" and source.title == "Processed"
        elif scenario == "edit":
            assert job.status == "incomplete" and source.body == "User edit" and source.revision == 4
        else:
            assert source.title != "Processed" and source.data["source_text"] == request["text"]
        if scenario in {"failure", "attempts"}:
            assert job.status == source.data["status"] == "failed"
        if scenario == "consent":
            assert job.status == "cancelled"
        if scenario == "moved":
            assert job.status == "queued"
    assert bool(called) == (scenario != "attempts")


async def test_deferred_capture_drains_into_its_stored_family_space(baby_api, family):
    c, h = baby_api.client, records.headers(family)
    assert (await c.patch("/api/v1/baby/profile", headers=h,
                         json={"ai_consent": True, "auto_process_shares": True})).status_code == 200
    source = shared.payload("source", data={"source_text": "Original"})
    assert (await c.post("/api/v1/baby/records", headers=h, json=source)).status_code == 200
    from app.domains.baby.lifecycle import now
    async with baby_api.sessions() as db:
        member = await db.get(BabyMembership, "owner")
        capture = BabyShareCapture(id=uuid4(), app_user_id="owner", space_id=family, generation=7,
                                   creation_hash="test", request={"automatic_epoch": member.profile["auto_process_epoch"]},
                                   record_id=source["id"], created_at=now(), status="deferred")
        capture_id = capture.id
        db.add(capture)
        await db.commit()

    async def processor(*args, **kwargs):
        return {"title": "Organized", "data": {"status": "ready"}, "status": "ready"}

    assert await BabyWorker(baby_api.sessions, processor=processor).tick()
    async with baby_api.sessions() as db:
        capture = await db.get(BabyShareCapture, capture_id)
        job = await db.get(BabyImport, capture_id)
        assert capture.status == "queued" and capture.change_seq > 0
        assert job.status == "ready" and job.space_id == family and job.generation == 7 and job.change_seq > 0


@pytest.mark.parametrize("reason", ["removed", "role", "expired_removed", "source_moved"])
async def test_inaccessible_job_does_not_starve_next_tick(baby_api, family, reason):
    from app.domains.baby.lifecycle import now

    c = baby_api.client
    first = await c.post("/api/v1/baby/imports", headers=records.headers(family),
                         json={"id": str(uuid4()), "text": "First original"})
    assert first.status_code == 200
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "other")).personal_space_id
    second = await c.post("/api/v1/baby/imports", headers=records.headers(personal, "other", generation=1),
                          json={"id": str(uuid4()), "text": "Second original"})
    assert second.status_code == 200
    async with baby_api.sessions() as db:
        job = await db.get(BabyImport, first.json()["id"])
        link = await db.get(BabySpaceMember, (family, "owner"))
        if reason == "role":
            link.role = "caregiver"
        elif reason == "source_moved":
            source = await db.get(BabyRecord, job.record_id)
            source.space_id = (await db.get(BabyMembership, "owner")).personal_space_id
            source.generation = 1
        else:
            link.status = "removed"
        if reason == "expired_removed":
            job.status, job.lease_until = "processing", now() - timedelta(seconds=1)
        await db.commit()
    processed = []

    async def processor(request, *args, **kwargs):
        processed.append(request["text"])
        return {"data": {"status": "ready"}, "status": "ready"}

    worker = BabyWorker(baby_api.sessions, processor=processor)
    assert await worker.tick()
    assert await worker.tick()
    assert processed == ["Second original"]
    async with baby_api.sessions() as db:
        job = await db.get(BabyImport, first.json()["id"])
        source = await db.get(BabyRecord, job.record_id)
        assert job.status == "cancelled" and job.lease_until is None and job.change_seq > 0
        assert source.data["status"] == ("queued" if reason == "source_moved" else "cancelled")
        assert (await db.get(BabyImport, second.json()["id"])).status == "ready"


async def test_import_retry_and_capture_cancel_belong_to_requester(baby_api, family):
    from app.domains.baby.lifecycle import now

    c = baby_api.client
    first = await c.post("/api/v1/baby/imports", headers=records.headers(family),
                         json={"id": str(uuid4()), "text": "Original"})
    async with baby_api.sessions() as db:
        job = await db.get(BabyImport, first.json()["id"])
        job.status = "cancelled"
        epoch = job.consent_epoch
        capture = BabyShareCapture(id=uuid4(), app_user_id="owner", space_id=family, generation=7,
            creation_hash="test", request={}, record_id=job.record_id, created_at=now(), status="deferred")
        db.add(capture)
        capture_id = capture.id
        await db.commit()
    other = records.headers(family, "other")
    assert (await c.post(f"/api/v1/baby/imports/{first.json()['id']}/retry", headers=other)).status_code == 403
    assert (await c.post(f"/api/v1/baby/imports/{capture_id}/cancel", headers=other)).status_code == 403
    async with baby_api.sessions() as db:
        job = await db.get(BabyImport, first.json()["id"])
        assert job.status == "cancelled" and job.consent_epoch == epoch
        assert (await db.get(BabyShareCapture, capture_id)).status == "deferred"
        (await db.get(BabySpaceMember, (family, "other"))).role = "caregiver"
        await db.commit()
    assert (await c.post(f"/api/v1/baby/imports/{capture_id}/cancel", headers=other)).status_code == 403


async def test_removed_deferred_capture_leaves_drain_window(baby_api, family):
    from app.domains.baby.lifecycle import now
    from app.domains.baby.share_router import drain_deferred_captures

    async with baby_api.sessions() as db:
        capture = BabyShareCapture(id=uuid4(), app_user_id="owner", space_id=family, generation=7,
            creation_hash="test", request={}, record_id=uuid4(), created_at=now(), status="deferred")
        db.add(capture)
        identifier = capture.id
        (await db.get(BabySpaceMember, (family, "owner"))).status = "removed"
        await db.commit()
        assert await drain_deferred_captures(db, limit=1) == 0
        assert await drain_deferred_captures(db, limit=1) == 0
        capture = await db.get(BabyShareCapture, identifier, populate_existing=True)
        assert capture.status == "saved" and capture.change_seq > 0


async def test_worker_rechecks_generated_category_relation(baby_api, family):
    c = baby_api.client
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    category = shared.payload("collection", data={"record_ids": []})
    assert (await c.post("/api/v1/baby/records", headers=records.headers(personal, generation=1), json=category)).status_code == 200
    imported = await c.post("/api/v1/baby/imports", headers=records.headers(family),
                            json={"id": str(uuid4()), "text": "Original"})

    async def processor(*args, **kwargs):
        return {"title": "Must not publish", "status": "ready", "data": {"status": "ready",
            "suggested_category": {"name": "Private category", "collection_id": category["id"], "confidence": 1}}}

    assert await BabyWorker(baby_api.sessions, processor=processor).tick()
    async with baby_api.sessions() as db:
        job = await db.get(BabyImport, imported.json()["id"])
        source = await db.get(BabyRecord, job.record_id)
        assert job.status == "failed" and source.data["status"] == "failed"
        assert not source.data.get("suggested_category") and source.title != "Must not publish"
async def test_worker_mutation_guard_rejects_a_claim_skipping_touch(baby_api, family, monkeypatch):
    request = {"id": str(uuid4()), "text": "Synthetic original"}
    result = await baby_api.client.post("/api/v1/baby/imports", headers=records.headers(family), json=request)
    assert result.status_code == 200

    async def skipped(row, space):
        pass

    monkeypatch.setattr("app.domains.baby.runtime.touch", skipped)
    with pytest.raises(AssertionError, match="Baby mutation skipped touch"):
        await BabyWorker(baby_api.sessions).tick()
