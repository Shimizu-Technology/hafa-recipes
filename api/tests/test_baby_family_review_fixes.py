"""Regression coverage for F4 queue recovery, actor privacy and lock contention."""
import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select

from app.domains.baby import runtime, share_router
from app.domains.baby.access import AccessChanged, access_for
from app.domains.baby.attachments import acquire_asset_lock
from app.domains.baby.lifecycle import now
from app.domains.baby.models import (
    BabyChild,
    BabyConversation,
    BabyImport,
    BabyMembership,
    BabyRecord,
    BabySpaceMember,
)
from app.domains.baby.share_models import BabyShareCapture
from app.media_lifecycle import acquire_recipe_media_lock
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


@pytest.mark.parametrize("model", [BabyImport, BabyShareCapture])
async def test_retired_generation_does_not_stop_queue(baby_api, family, model):
    created = await baby_api.client.post("/api/v1/baby/imports", headers=records.headers(family),
        json={"id": str(uuid4()), "text": "Original"})
    async with baby_api.sessions() as db:
        job = await db.get(BabyImport, created.json()["id"])
        source = await db.get(BabyRecord, job.record_id)
        job.generation = source.generation = 6
        identifier = job.id
        if model is BabyShareCapture:
            job.status = "cancelled"
            row = BabyShareCapture(id=uuid4(), app_user_id="owner", space_id=family, generation=6,
                creation_hash="test", request={}, record_id=source.id, created_at=now(), status="deferred")
            db.add(row)
            identifier = row.id
        await db.commit()
    worker = runtime.BabyWorker(baby_api.sessions)
    await worker.tick()
    assert not await worker.tick()
    async with baby_api.sessions() as db:
        row = await db.get(model, identifier)
        assert row.status == ("cancelled" if model is BabyImport else "saved")
        assert row.generation == 6 and row.change_seq > 0


@pytest.mark.parametrize("stage", ["claim", "complete", "failure", "defer", "admit"])
async def test_access_changed_keeps_work_recoverable(baby_api, family, monkeypatch, stage):
    created = await baby_api.client.post("/api/v1/baby/imports", headers=records.headers(family),
        json={"id": str(uuid4()), "text": "Original"})
    identifier = created.json()["id"]
    calls = 0
    real = runtime.job_access

    async def access(*args, **kwargs):
        nonlocal calls
        if kwargs.get("write"):
            calls += 1
            if calls == (1 if stage == "claim" else 2):
                raise AccessChanged()
        return await real(*args, **kwargs)

    async def processor(*args, **kwargs):
        if stage == "failure":
            raise ValueError("Synthetic processing error")
        return {"title": "Processed", "data": {"status": "ready"}, "status": "ready"}

    if stage in {"defer", "admit"}:
        async with baby_api.sessions() as db:
            job = await db.get(BabyImport, identifier)
            job.status = "cancelled"
            row = BabyShareCapture(id=uuid4(), app_user_id="owner", space_id=family, generation=7,
                creation_hash="test", request={}, record_id=job.record_id, created_at=now(), status="deferred")
            db.add(row)
            capture_id = row.id
            await db.commit()
        async def changed(*args, **kwargs):
            raise AccessChanged()
        monkeypatch.setattr(share_router, "access_for" if stage == "defer" else "admit_capture", changed)
        async with baby_api.sessions() as db:
            assert await share_router.drain_deferred_captures(db) == 0
            assert (await db.get(BabyShareCapture, capture_id)).status == "deferred"
        return
    monkeypatch.setattr(runtime, "job_access", access)
    assert await runtime.BabyWorker(baby_api.sessions, processor=processor).tick()
    async with baby_api.sessions() as db:
        job = await db.get(BabyImport, identifier)
        assert job.status == ("queued" if stage == "claim" else "processing")
        assert (await db.get(BabyRecord, job.record_id)).title != "Processed"


@pytest.mark.parametrize("model", [BabyImport, BabyShareCapture])
async def test_caregiver_import_details_are_actor_private(baby_api, family, model):
    async with baby_api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "other"))).role = "caregiver"
        rows = []
        for actor in ("owner", "other"):
            row = model(id=uuid4(), app_user_id=actor, space_id=family, generation=7,
                creation_hash="x", request={"private": actor}, record_id=uuid4(), created_at=now(), status="queued")
            if model is BabyImport:
                row.consent_epoch = 0
            db.add(row)
            rows.append(row)
        await db.commit()
        access = await access_for(db, "other", client="3")
        assert list(await db.scalars(select(model).where(access.condition(model)))) == [rows[1]]
        assert access.grant(rows[1]).id == family
        with pytest.raises(HTTPException) as error:
            access.grant(rows[0], kinds=False)
        assert error.value.status_code == 404


async def test_busy_asset_never_waits_with_family_locks(baby_api, family):
    identifier = uuid4()
    async with baby_api.sessions() as media, baby_api.sessions() as writer:
        await acquire_recipe_media_lock(media, identifier)
        await access_for(writer, "owner", client="3", space_id=family, write=True)
        with pytest.raises(HTTPException) as error:
            await asyncio.wait_for(acquire_asset_lock(writer, identifier), 1)
        assert error.value.status_code == 409 and error.value.detail == "This file is busy; retry"
        await writer.rollback()
        await media.rollback()
        await acquire_asset_lock(writer, identifier)


async def test_conversation_children_are_loaded_in_one_query(baby_api, family):
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
        child = BabyChild(id=uuid4(), app_user_id="owner", space_id=family, generation=7,
                          name="Synthetic", creation_hash="x")
        db.add(child)
        await db.flush()
        db.add_all([BabyConversation(app_user_id="owner", space_id=personal, generation=1,
            child_id=child.id, title="Synthetic", context_space_ids=[]) for _ in range(12)])
        await db.commit()
    queries = []
    def count(conn, cursor, statement, *args):
        if "FROM baby_children" in statement:
            queries.append(statement)
    event.listen(baby_api.engine.sync_engine, "before_cursor_execute", count)
    try:
        response = await baby_api.client.get("/api/v1/baby/conversations", headers=records.headers(personal, generation=1))
        assert len(response.json()["items"]) == 12
        assert all(row["child_id"] == str(child.id) for row in response.json()["items"])
        assert len(queries) == 1
    finally:
        event.remove(baby_api.engine.sync_engine, "before_cursor_execute", count)


async def test_automatic_import_retry_reads_member_before_mutating_request(baby_api, family):
    created = await baby_api.client.post("/api/v1/baby/imports", headers=records.headers(family),
        json={"id": str(uuid4()), "text": "Original"})
    identifier = created.json()["id"]
    async with baby_api.sessions() as db:
        job = await db.get(BabyImport, identifier)
        job.status = "cancelled"
        job.request = {**job.request, "automatic": True, "automatic_epoch": 1, "automatic_title": "Original"}
        await db.commit()
    result = await baby_api.client.post(f"/api/v1/baby/imports/{identifier}/retry", headers=records.headers(family))
    assert result.status_code == 200 and result.json()["status"] == "queued"
    async with baby_api.sessions() as db:
        job = await db.get(BabyImport, identifier)
        assert not {"automatic", "automatic_epoch", "automatic_title"} & job.request.keys()
        assert job.change_seq > 0
