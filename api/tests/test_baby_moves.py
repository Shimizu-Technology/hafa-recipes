"""F9b real API moves, stale-device recovery and import lease fencing."""
import importlib
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.domains.baby.models import (
    BabyAttachment,
    BabyImport,
    BabyMembership,
    BabyMovedOut,
    BabyRecord,
    BabySpaceMember,
)
from app.domains.baby.runtime import BabyWorker
from app.domains.baby.share_models import BabyShareCredential
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared
from tests import test_baby_share_integration as native

baby_api, pytestmark = foundation.baby_api, foundation.pytestmark


@pytest.fixture
async def enabled(baby_api):
    baby_api.settings.baby_family_enabled = True
    await importlib.import_module("migrations.058_contract_baby_spaces").run_migration(
        configured=baby_api.settings, migration_engine=baby_api.engine)
    async with baby_api.sessions() as db:
        return (await db.get(BabyMembership, "owner")).personal_space_id


async def family_for(api, personal):
    api.settings.baby_invites_enabled = True
    result = await api.client.post("/api/v1/baby/family/invites", headers=records.headers(personal, generation=1),
        json={"publish_shared": True, "disclosure_version": 1})
    assert result.status_code == 201, result.text
    return UUID(result.json()["space_id"])


async def test_create_family_replay_stale_phone_and_queued_care(baby_api, enabled):
    c, h = baby_api.client, records.headers(enabled, generation=1)
    child_id = str(uuid4())
    child_body = {"id": child_id, "name": "Synthetic"}
    assert (await c.post("/api/v1/baby/children", headers=h, json=child_body)).status_code == 200
    source = shared.payload("source", child_id=child_id)
    journal = shared.payload(child_id=child_id)
    private = shared.payload("source", child_id=child_id, data={"just_me": True})
    for body in (source, journal, private):
        assert (await c.post("/api/v1/baby/records", headers=h, json=body)).status_code == 200
    c._transport.app.include_router(native.router)
    credential = await c.post("/api/v1/baby/share/session", headers=h, json={"installation_id": str(uuid4())})
    assert credential.status_code == 201
    family = await family_for(baby_api, enabled)
    assert await family_for(baby_api, enabled) == family  # Lost response replay.
    for path, body in (("/children", child_body), ("/records", source)):
        replay = await c.post("/api/v1/baby" + path, headers=h, json=body)
        assert replay.status_code == 200 and replay.json()["space_id"] == str(family), replay.text
    edit = await c.patch(f"/api/v1/baby/records/{source['id']}", headers=h, json={"revision": 1, "body": "Queued"})
    assert edit.status_code == 409 and edit.json()["code"] == "moved"
    assert edit.json()["space_id"] == str(family) and edit.json()["record"]["id"] == source["id"]
    care = await c.post("/api/v1/baby/records", headers=h, json=shared.payload("diaper", child_id=child_id, data={"type": "wet"}))
    assert care.status_code == 409 and care.json()["code"] == "moved"
    retargeted = await c.post("/api/v1/baby/records", headers=records.headers(family, generation=1),
                             json=shared.payload("diaper", child_id=child_id, data={"type": "wet"}))
    assert retargeted.status_code == 200
    queued = await c.post("/api/v1/baby/records", headers=h, json=shared.payload("source"))
    assert queued.status_code == 200 and queued.json()["space_id"] == str(enabled)
    async with baby_api.sessions() as db:
        assert (await db.get(BabyMembership, "owner")).generation == 1
        for body in (journal, private):
            assert (await db.get(BabyRecord, body["id"])).space_id == enabled
        assert (await db.get(BabyRecord, private["id"])).child_id is None
        assert (await db.get(BabyRecord, journal["id"])).child_id == UUID(child_id)
        assert (await db.scalar(select(BabyShareCredential))).revoked_at is not None
        tombstones = list(await db.scalars(select(BabyMovedOut.record_id).where(BabyMovedOut.space_id == enabled)))
        assert UUID(source["id"]) in tombstones and UUID(child_id) in tombstones

    unshared = await c.post(f"/api/v1/baby/records/{source['id']}/move",
        headers=records.headers(family, generation=1), json={"space_id": str(enabled), "revision": 2})
    assert unshared.status_code == 200 and unshared.json()["child_id"] is None, unshared.text


async def test_import_mid_move_requeues_and_discards_old_completion(baby_api, enabled):
    c, h = baby_api.client, records.headers(enabled, generation=1)
    imported = await c.post("/api/v1/baby/imports", headers=h, json={"id": str(uuid4()), "text": "Original"})
    family = None
    calls = []
    async def processor(request, *args, **kwargs):
        nonlocal family
        calls.append(request)
        if family is None:
            family = await family_for(baby_api, enabled)
            async with baby_api.sessions() as db:
                job = await db.get(BabyImport, imported.json()["id"])
                assert job.status == "queued" and job.lease_token is None and job.lease_until is None
                assert job.space_id == family
            return {"title": "Discard stale result", "data": {"status": "ready"}, "status": "ready"}
        return {"title": "Current result", "data": {"status": "ready"}, "status": "ready"}
    worker = BabyWorker(baby_api.sessions, processor=processor)
    assert await worker.tick()
    async with baby_api.sessions() as db:
        job = await db.get(BabyImport, imported.json()["id"])
        assert job.status == "queued" and (await db.get(BabyRecord, job.record_id)).title != "Discard stale result"
    assert await worker.tick()
    replay = await c.post("/api/v1/baby/imports", headers=h,
                          json={"id": imported.json()["id"], "text": "Original"})
    assert replay.status_code == 200 and replay.json()["space_id"] == str(family)
    async with baby_api.sessions() as db:
        job = await db.get(BabyImport, imported.json()["id"])
        assert job.status == "ready" and (await db.get(BabyRecord, job.record_id)).title == "Current result"
    assert len(calls) == 2


async def test_shared_file_is_copied_and_unshare_removes_category(baby_api, enabled, monkeypatch, tmp_path):
    from io import BytesIO

    from PIL import Image

    from app.domains.baby import storage

    monkeypatch.setattr(storage, "local_root", lambda: tmp_path)
    c, h = baby_api.client, records.headers(enabled, generation=1)
    image = BytesIO()
    Image.new("RGB", (10, 10), "white").save(image, "PNG")
    asset = str(uuid4())
    assert (await c.post("/api/v1/baby/attachments", headers={**h, "Idempotency-Key": asset},
        files={"file": ("synthetic.png", image.getvalue(), "image/png")})).status_code == 200
    journal = shared.payload(data={"attachment_ids": [asset]})
    source = shared.payload("source", data={"attachment_ids": [asset]})
    for body in (source, journal):
        assert (await c.post("/api/v1/baby/records", headers=h, json=body)).status_code == 200
    category = shared.payload("collection", data={"record_ids": [source["id"], journal["id"]]})
    assert (await c.post("/api/v1/baby/records", headers=h, json=category)).status_code == 200
    family = await family_for(baby_api, enabled)
    async with baby_api.sessions() as db:
        moved = await db.get(BabyRecord, source["id"])
        copied = await db.get(BabyAttachment, moved.data["attachment_ids"][0])
        original = await db.get(BabyAttachment, asset)
        assert copied.id != original.id and copied.object_key != original.object_key
        assert copied.space_id == family and original.space_id == enabled
        assert storage.read(copied.object_key, 10000) == storage.read(original.object_key, 10000)
        assert (await db.get(BabyRecord, category["id"])).data["record_ids"] == [source["id"]]
    result = await c.post(f"/api/v1/baby/records/{source['id']}/move", headers=records.headers(family, generation=1),
                          json={"space_id": str(enabled), "revision": moved.revision})
    assert result.status_code == 200 and result.json()["data"]["just_me"] is True, result.text
    async with baby_api.sessions() as db:
        assert (await db.get(BabyRecord, category["id"])).data["record_ids"] == []
        assert (await db.get(BabyRecord, journal["id"])).data["attachment_ids"] == [asset]


@pytest.mark.parametrize("client", [None, "2"])
async def test_only_client_three_can_create_family(baby_api, enabled, client):
    baby_api.settings.baby_invites_enabled = True
    h = shared.GEN | ({"X-Baby-Client": client} if client else {})
    assert (await baby_api.client.post("/api/v1/baby/family/invites", headers=h)).status_code == 403


async def test_family_routes_are_hidden_with_gate_off(baby_api):
    baby_api.settings.baby_family_enabled = False
    assert (await baby_api.client.post("/api/v1/baby/family", headers=shared.GEN)).status_code == 404


async def test_batch_keeps_one_file_for_two_moving_sources(baby_api, enabled, monkeypatch, tmp_path):
    from app.domains.baby import storage
    monkeypatch.setattr(storage, "local_root", lambda: tmp_path)
    asset = await shared.media_fixture(baby_api)
    async with baby_api.sessions() as db:
        row = await db.get(BabyAttachment, asset)
        storage.put(row.object_key, b"synthetic", row.mime_type)
    sources = [shared.payload("source", data={"attachment_ids": [str(asset)]}) for _ in range(2)]
    for source in sources:
        assert (await baby_api.client.post("/api/v1/baby/records", headers=records.headers(enabled, generation=1), json=source)).status_code == 200
    family = await family_for(baby_api, enabled)
    async with baby_api.sessions() as db:
        assert (await db.get(BabyAttachment, asset)).space_id == family
        for source in sources:
            assert (await db.get(BabyRecord, source["id"])).data["attachment_ids"] == [str(asset)]


async def test_failed_family_transaction_retains_private_rows_and_cleanup_receipt(baby_api, enabled, monkeypatch, tmp_path):
    from app.domains.baby import moves, storage
    from app.domains.baby.models import BabySpace
    from app.models.deletion import DeletionCleanupJob

    monkeypatch.setattr(storage, "local_root", lambda: tmp_path)
    asset = await shared.media_fixture(baby_api, size=9)
    async with baby_api.sessions() as db:
        row = await db.get(BabyAttachment, asset)
        storage.put(row.object_key, b"synthetic", row.mime_type)
    for kind in ("source", "journal"):
        result = await baby_api.client.post("/api/v1/baby/records", headers=records.headers(enabled, generation=1),
            json=shared.payload(kind, data={"attachment_ids": [str(asset)]}))
        assert result.status_code == 200
    async def fail(*args, **kwargs):
        raise RuntimeError("Synthetic final relation failure")
    monkeypatch.setattr(moves, "validate_relations", fail)
    with pytest.raises(RuntimeError, match="Synthetic final"):
        await family_for(baby_api, enabled)
    async with baby_api.sessions() as db:
        assert not list(await db.scalars(select(BabySpace).where(BabySpace.kind == "family")))
        assert all(row.space_id == enabled for row in await db.scalars(select(BabyRecord)))
        queued = list(await db.scalars(select(DeletionCleanupJob).where(DeletionCleanupJob.status == "queued")))
        assert len(queued) == 1 and queued[0].storage_prefixes
        assert storage.local_path(queued[0].storage_prefixes[0] + "asset").is_file()


async def test_parent_cannot_privatize_another_creators_post(baby_api, enabled):
    from app.domains.baby.models import BabySpaceMember

    family = await family_for(baby_api, enabled)
    async with baby_api.sessions() as db:
        db.add(BabySpaceMember(space_id=family, app_user_id="other", role="parent"))
        other_personal = (await db.get(BabyMembership, "other")).personal_space_id
        await db.commit()
    post = shared.payload("source")
    assert (await baby_api.client.post("/api/v1/baby/records", headers=records.headers(family, generation=1), json=post)).status_code == 200
    result = await baby_api.client.post(f"/api/v1/baby/records/{post['id']}/move",
        headers=records.headers(family, "other", 1), json={"space_id": str(other_personal), "revision": 1})
    assert result.status_code == 403, result.text


@pytest.mark.parametrize("kind", ["source", "collection", "question", "import"])
async def test_queued_noncare_for_moved_child(baby_api, enabled, kind):
    h = records.headers(enabled, generation=1)
    child = str(uuid4())
    assert (await baby_api.client.post("/api/v1/baby/children", headers=h, json={"id": child, "name": "Baby"})).status_code == 200
    await family_for(baby_api, enabled)
    body = shared.payload(kind, child_id=child) if kind != "import" else {"id": str(uuid4()), "text": "Saved text", "child_id": child}
    path = "/imports" if kind == "import" else "/records"
    result = await baby_api.client.post("/api/v1/baby" + path, headers=h, json=body)
    if kind in {"question", "import"}:
        assert result.status_code == 409 and result.json()["code"] == "moved", result.text
    else:
        assert result.status_code == 200, result.text
        assert result.json()["child_id"] is None and result.json()["space_id"] == str(enabled)


async def test_attachment_copy_has_no_account_or_space_locks(baby_api, enabled, monkeypatch, tmp_path):
    # The journal retains the original while Create family moves the source.
    from io import BytesIO

    from PIL import Image

    from app.domains.baby import moves as implementation
    from app.domains.baby import storage
    from app.domains.baby.models import BabySpace
    from app.models.identity import AppUser

    monkeypatch.setattr(storage, "local_root", lambda: tmp_path)
    image = BytesIO()
    Image.new("RGB", (16, 16), "white").save(image, "PNG")
    asset = str(uuid4())
    result = await baby_api.client.post("/api/v1/baby/attachments",
        headers={**records.headers(enabled, generation=1), "Idempotency-Key": asset},
        files={"file": ("test.png", image.getvalue(), "image/png")})
    assert result.status_code == 200, result.text
    h = records.headers(enabled, generation=1)
    for kind in ("journal", "source"):
        result = await baby_api.client.post("/api/v1/baby/records", headers=h,
            json=shared.payload(kind, data={"attachment_ids": [asset]}))
        assert result.status_code == 200, result.text
    original = implementation.put_payload
    async def checked(*args, **kwargs):
        async with baby_api.sessions() as other:
            await other.scalar(select(AppUser).where(AppUser.id == "owner").with_for_update(nowait=True))
            await other.scalar(select(BabySpace).where(BabySpace.id == enabled).with_for_update(nowait=True))
        return await original(*args, **kwargs)
    monkeypatch.setattr(implementation, "put_payload", checked)
    await family_for(baby_api, enabled)


async def test_move_preparation_preserves_invalid_identifier_validation(baby_api, enabled):
    result = await baby_api.client.post("/api/v1/baby/records/not-a-uuid/move",
        headers=records.headers(enabled, generation=1), json={"space_id": str(enabled), "revision": 1})
    assert result.status_code == 422, result.text


@pytest.mark.parametrize("remove_original", [False, True])
async def test_family_creation_does_not_publish_pasted_visits(baby_api, enabled, remove_original):
    baby_api.settings.baby_new_kinds_enabled = True
    c, h = baby_api.client, records.headers(enabled, generation=1)
    source = {"text": "Visit words", "start": 0, "end": 11, "original": False}
    body = shared.payload("event", body="Visit words", data={"category": "appointment", "timezone": "Pacific/Guam", "paste_origin": source})
    saved = await c.post("/api/v1/baby/records", headers=h, json=body)
    assert saved.status_code == 200, saved.text
    if remove_original:
        removed = await c.patch(f"/api/v1/baby/records/{body['id']}", headers=h, json={"revision": 1, "data": {**body["data"], "paste_origin": None}})
        assert removed.status_code == 200 and removed.json()["data"]["just_me"] is True, removed.text
    family = await family_for(baby_api, enabled)
    personal = await c.get(f"/api/v1/baby/records/{body['id']}", headers=h)
    assert personal.status_code == 200 and personal.json()["space_id"] == str(enabled), personal.text
    explicitly_shared = {**body, "id": str(uuid4())}
    shared_visit = await c.post("/api/v1/baby/records", headers=records.headers(family, generation=1), json=explicitly_shared)
    assert shared_visit.status_code == 200 and shared_visit.json()["space_id"] == str(family), shared_visit.text


@pytest.mark.parametrize("protection", ["paste_origin", "just_me"])
async def test_split_private_visit_stays_personal_after_source_removal_and_family_creation(baby_api, enabled, protection):
    baby_api.settings.baby_new_kinds_enabled = True
    c, h = baby_api.client, records.headers(enabled, generation=1)
    data = {"category": "appointment", "timezone": "Pacific/Guam", "recurrence": {"frequency": "daily"}}
    data[protection] = {"text": "Visit words", "start": 0, "end": 11, "original": False} if protection == "paste_origin" else True
    original = shared.payload("event", body="Visit words", data=data)
    assert (await c.post("/api/v1/baby/records", headers=h, json=original)).status_code == 200
    replacement = shared.payload("event", body="Visit words", occurred_at="2026-10-21T12:00:00+10:00", data={"category": "appointment", "timezone": "Pacific/Guam", "recurrence": {"frequency": "daily"}, "paste_origin": None})
    result = await c.post(f"/api/v1/baby/events/{original['id']}/split", headers=h, json={"revision": 1, "from_start": replacement["occurred_at"], "event": replacement})
    assert result.status_code == 200, result.text
    assert result.json()["event"]["data"]["just_me"] is True
    family = await family_for(baby_api, enabled)
    personal = await c.get(f"/api/v1/baby/records/{replacement['id']}", headers=h)
    assert personal.status_code == 200 and personal.json()["space_id"] == str(enabled), personal.text
    async with baby_api.sessions() as db:
        db.add(BabySpaceMember(space_id=family, app_user_id="other", role="parent", status="active", access_version=1))
        await db.commit()
    family_rows = await c.get("/api/v1/baby/records", headers=records.headers(family, "other", generation=1))
    assert family_rows.status_code == 200 and replacement["id"] not in family_rows.text
