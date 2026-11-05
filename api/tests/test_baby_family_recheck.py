"""Independent family re-check probes and named surviving-guard regressions."""
import asyncio
import importlib
from datetime import timedelta
from io import BytesIO
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from PIL import Image
from sqlalchemy import func, select, text

from app.domains.baby import moves as moves_module
from app.domains.baby.lifecycle import now
from app.domains.baby.models import (
    BabyAttachment,
    BabyChild,
    BabyConversation,
    BabyImport,
    BabyMembership,
    BabyRecord,
    BabySpace,
    BabySpaceInvite,
    BabySpaceMember,
)
from app.domains.baby.runtime import BabyWorker
from app.domains.baby.share_models import BabyShareCredential
from app.models.deletion import DeletionCleanupJob
from app.models.identity import AppUser
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared
from tests import test_baby_invites as invites
from tests import test_baby_privacy_integration as privacy
from tests import test_baby_share_integration as native

baby_api, shared_privacy_api, pytestmark = privacy.baby_api, privacy.privacy_api, privacy.pytestmark


@pytest.fixture
async def privacy_api(shared_privacy_api):
    shared_privacy_api.settings.baby_family_enabled = False
    return shared_privacy_api


API = "/api/v1/baby"


def png_bytes(colour="white"):
    buf = BytesIO()
    Image.new("RGB", (16, 16), colour).save(buf, "PNG")
    return buf.getvalue()


async def upload(api, space, actor="owner", generation=1):
    identifier = str(uuid4())
    result = await api.client.post(API + "/attachments",
        headers={**records.headers(space, actor, generation), "Idempotency-Key": identifier},
        files={"file": ("u.png", png_bytes(), "image/png")})
    assert result.status_code == 200, result.text
    return identifier


async def add_user(api, actor):
    async with api.sessions() as db:
        db.add(AppUser(id=actor))
        await db.commit()
    assert (await api.client.post(API + "/bootstrap", headers={"X-Test-Owner": actor})).status_code == 200


async def member_status(api, family, actor):
    async with api.sessions() as db:
        link = await db.get(BabySpaceMember, (family, actor))
        return None if link is None else link.status


@pytest.fixture
async def fam(privacy_api):
    """Owner plus a real accepted second parent and caregiver, flags on, 058 applied."""
    api = privacy_api
    api.settings.baby_family_enabled = api.settings.baby_invites_enabled = api.settings.baby_new_kinds_enabled = True
    await importlib.import_module("migrations.058_contract_baby_spaces").run_migration(
        configured=api.settings, migration_engine=api.engine)
    api.client._transport.app.include_router(native.router)
    async with api.sessions() as db:
        for actor in ("caregiver",):
            db.add(AppUser(id=actor))
        await db.commit()
    for actor in ("owner", "other", "caregiver"):
        assert (await api.client.post(API + "/bootstrap", headers={"X-Test-Owner": actor})).status_code == 200
    personal = await invites.personal(api, "owner")
    first = await invites.create(api, personal)
    family = UUID(first["space_id"])
    assert (await invites.accept(api, first, "other")).status_code == 200
    care = await api.client.post(API + "/family/invites", headers=records.headers(family, generation=1),
        json={"role": "caregiver", "disclosure_version": 1})
    assert care.status_code == 201
    assert (await invites.accept(api, care.json(), "caregiver")).status_code == 200
    return SimpleNamespace(api=api, c=api.client, family=family, personal=personal,
                           h=records.headers(family, generation=1),
                           ho=records.headers(family, "other", 1),
                           hc=records.headers(family, "caregiver", 1))


async def test_o1_delete_ignores_removed_parents(fam):
    r = await fam.c.delete(f"{API}/family/{fam.family}/members/other", headers=fam.h)
    assert r.status_code == 200, r.text
    r = await fam.c.delete(f"{API}/family/{fam.family}", headers=fam.h)
    assert r.status_code == 200, r.text
    async with fam.api.sessions() as db:
        assert await db.get(BabySpace, fam.family) is None


async def test_o1_delete_ignores_left_parents(fam):
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)).status_code == 200
    assert (await fam.c.delete(f"{API}/family/{fam.family}", headers=fam.h)).status_code == 200


async def test_o2_caregiver_does_not_block_last_parent_deletion(fam):
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)).status_code == 200
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.h)).status_code == 409
    upload_id = await upload(fam.api, fam.family, "caregiver")
    r = await fam.c.delete(f"{API}/family/{fam.family}", headers=fam.h)
    assert r.status_code == 200, r.text
    async with fam.api.sessions() as db:
        assert await db.get(BabySpace, fam.family) is None
        assert await db.get(BabyAttachment, upload_id) is None
        prefixes = [p for job in await db.scalars(select(DeletionCleanupJob)) for p in job.storage_prefixes]
        assert any(upload_id in p for p in prefixes)
        assert (await db.get(BabyMembership, "caregiver")).status == "active"


@pytest.mark.parametrize("client", [None, "2"])
async def test_j_personal_erasure_revokes_family_credentials(fam, client):
    session = await fam.c.post(API + "/share/session", headers=fam.h, json={"installation_id": str(uuid4())})
    assert session.status_code == 201, session.text
    h = {"X-Test-Owner": "owner", "X-Baby-Generation": "1", "X-Baby-Client": "2"}
    if client is None:
        h.pop("X-Baby-Client")
    assert (await fam.c.delete(API + "/data?generation=1", headers=h)).status_code == 200
    async with fam.api.sessions() as db:
        rows = list(await db.scalars(select(BabyShareCredential).where(BabyShareCredential.app_user_id == "owner")))
        assert all(r.revoked_at is not None for r in rows), "family share credential outlives data erasure"


async def test_f5_remove_after_they_left_still_blocks_rejoin(fam):
    pending = (await fam.c.post(API + "/family/invites", headers=fam.h, json={"disclosure_version": 1})).json()
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)).status_code == 200
    removed = await fam.c.delete(f"{API}/family/{fam.family}/members/other", headers=fam.h)
    r = await invites.accept(fam.api, pending, "other")
    assert removed.status_code == 200 and r.status_code == 409
    assert await member_status(fam.api, fam.family, "other") == "removed"


async def test_f5_concurrent_removal_and_accept(fam):
    pending = (await fam.c.post(API + "/family/invites", headers=fam.h, json={"disclosure_version": 1})).json()
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)).status_code == 200
    a, b = await asyncio.gather(invites.accept(fam.api, pending, "other"),
                                fam.c.delete(f"{API}/family/{fam.family}/members/other", headers=fam.h))
    status = await member_status(fam.api, fam.family, "other")
    assert b.status_code in {200, 409}
    if a.status_code == 200 and b.status_code == 200:
        assert status == "removed"


async def post_in_family(fam, actor_h, data=None):
    body = shared.payload("source", data=data or {})
    r = await fam.c.post(API + "/records", headers=actor_h, json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def test_f6_creator_privatizes_with_other_parents_queued_job(fam):
    """Owner's post, other parent's import job. Owner privatizes: other parent's job must not hang or land in owner's private space unowned."""
    assert (await fam.c.patch(API + "/profile", headers=fam.ho, json={"ai_consent": True})).status_code == 200
    post = await post_in_family(fam, fam.h, {"source_text": "text to process"})
    imported = await fam.c.post(API + "/imports", headers=fam.ho, json={"id": str(uuid4()), "record_id": post["id"]})
    assert imported.status_code == 200, imported.text
    current = (await fam.c.get(f"{API}/records/{post['id']}", headers=fam.h)).json()
    moved = await fam.c.post(f"{API}/records/{post['id']}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": current["revision"]})
    assert moved.status_code == 200, moved.text
    async with fam.api.sessions() as db:
        cancelled = await db.get(BabyImport, imported.json()["id"])
        assert cancelled.status == "cancelled" and cancelled.space_id == fam.family
    async def processor(request, *a, **k):
        return {"title": "Done", "data": {"status": "ready"}, "status": "ready"}
    worker = BabyWorker(fam.api.sessions, processor=processor)
    for _ in range(3):
        if not await worker.tick():
            break
    async with fam.api.sessions() as db:
        job = await db.get(BabyImport, imported.json()["id"])
        source = await db.get(BabyRecord, post["id"])
        if moved.status_code == 200:
            assert source.data.get("status") not in {"queued", "processing"}, (job.status, source.data)
            assert not (str(job.space_id) == str(fam.personal) and job.app_user_id == "other"), "other parent's job row now lives in owner's private space"


async def test_f6_noncreator_attempt_still_copies_file(fam, monkeypatch):
    calls = []
    original = moves_module.put_payload
    async def counting(*a, **k):
        calls.append(a[0])
        return await original(*a, **k)
    monkeypatch.setattr(moves_module, "put_payload", counting)
    asset = await upload(fam.api, fam.family)
    post = await post_in_family(fam, fam.h, {"attachment_ids": [asset]})
    await post_in_family(fam, fam.h, {"attachment_ids": [asset]})
    own = await invites.personal(fam.api, "other")
    for _ in range(3):
        r = await fam.c.post(f"{API}/records/{post['id']}/move", headers=fam.ho, json={"space_id": str(own), "revision": post["revision"]})
        assert r.status_code == 403
    assert not calls, f"{len(calls)} storage copies made by a parent the move then refuses"


async def test_f9_queued_import_with_attachment_for_moved_child_has_a_route(privacy_api):
    api = privacy_api
    api.settings.baby_family_enabled = api.settings.baby_invites_enabled = True
    await importlib.import_module("migrations.058_contract_baby_spaces").run_migration(configured=api.settings, migration_engine=api.engine)
    assert (await api.client.post(API + "/bootstrap", headers={"X-Test-Owner": "owner"})).status_code == 200
    personal = await invites.personal(api, "owner")
    h = records.headers(personal, generation=1)
    child = (await api.client.post(API + "/children", headers=h, json={"name": "Moved"})).json()
    asset = await upload(api, personal)  # second phone: upload done, record still queued
    await invites.create(api, personal)
    body = {"id": str(uuid4()), "text": "queued", "child_id": child["id"], "attachment_ids": [asset]}
    first = await api.client.post(API + "/imports", headers=h, json=body)
    assert first.status_code == 200, first.text
    assert first.json()["space_id"] == str(personal)
    replay = await api.client.post(API + "/imports", headers=h, json=body)
    assert replay.status_code == 200 and replay.json() == first.json(), replay.text
    async with api.sessions() as db:
        job = await db.get(BabyImport, body["id"])
        assert job.request["child_id"] is None
        assert (await db.get(BabyRecord, job.record_id)).child_id is None


@pytest.mark.parametrize("kind", ["question"])
async def test_f9_queued_record_with_attachment_for_moved_child_has_a_route(privacy_api, kind):
    api = privacy_api
    api.settings.baby_family_enabled = api.settings.baby_invites_enabled = api.settings.baby_new_kinds_enabled = True
    await importlib.import_module("migrations.058_contract_baby_spaces").run_migration(configured=api.settings, migration_engine=api.engine)
    assert (await api.client.post(API + "/bootstrap", headers={"X-Test-Owner": "owner"})).status_code == 200
    personal = await invites.personal(api, "owner")
    h = records.headers(personal, generation=1)
    child = (await api.client.post(API + "/children", headers=h, json={"name": "Moved"})).json()
    asset = await upload(api, personal)
    await invites.create(api, personal)
    data = {"type": "wet"} if kind == "diaper" else {}
    body = shared.payload(kind, child_id=child["id"], data={**data, "attachment_ids": [asset]})
    first = await api.client.post(API + "/records", headers=h, json=body)
    assert first.status_code == 200, first.text
    assert first.json()["space_id"] == str(personal) and first.json()["child_id"] is None


async def test_f9_private_source_edit_to_moved_child(privacy_api):
    api = privacy_api
    api.settings.baby_family_enabled = api.settings.baby_invites_enabled = True
    await importlib.import_module("migrations.058_contract_baby_spaces").run_migration(configured=api.settings, migration_engine=api.engine)
    assert (await api.client.post(API + "/bootstrap", headers={"X-Test-Owner": "owner"})).status_code == 200
    personal = await invites.personal(api, "owner")
    h = records.headers(personal, generation=1)
    child = (await api.client.post(API + "/children", headers=h, json={"name": "Moved"})).json()
    body = shared.payload("source", data={"just_me": True}, child_id=child["id"])
    assert (await api.client.post(API + "/records", headers=h, json=body)).status_code == 200
    await invites.create(api, personal)
    current = (await api.client.get(f"{API}/records/{body['id']}", headers=h)).json()
    assert current["child_id"] is None
    r = await api.client.patch(f"{API}/records/{body['id']}", headers=h, json={"revision": current["revision"], "child_id": child["id"], "body": "x"})
    assert r.status_code == 200, "create detaches, edit returns 422"


async def staged_jobs(api):
    async with api.sessions() as db:
        return [j for j in await db.scalars(select(DeletionCleanupJob).where(DeletionCleanupJob.status == "queued"))]


async def setup_shared_asset(fam):
    """A family asset referenced by two posts, so the move must copy it."""
    asset = await upload(fam.api, fam.family)
    moving = await post_in_family(fam, fam.h, {"attachment_ids": [asset]})
    other = await post_in_family(fam, fam.h, {"attachment_ids": [asset]})
    return asset, moving, other


def during_copy(monkeypatch, action):
    original = moves_module.put_payload
    done = []
    async def wrapper(key, payload, mime):
        result = await original(key, payload, mime)
        if not done:
            done.append(key)
            await action()
        return result
    monkeypatch.setattr(moves_module, "put_payload", wrapper)
    return done


async def assert_staged_object_collectable(fam, done):
    """Whatever the outcome, the staged object is referenced or queued for cleanup, never orphaned."""
    assert done, "copy was not staged"
    from app.domains.baby import storage
    key = done[0]
    prefix = key.rsplit("asset", 1)[0]
    async with fam.api.sessions() as db:
        referenced = await db.scalar(select(BabyAttachment.id).where(BabyAttachment.object_key == key))
        job = await db.scalar(select(DeletionCleanupJob).where(DeletionCleanupJob.storage_prefixes.contains([prefix])))
    assert referenced or job is not None, "ORPHAN staged object"
    if not referenced:
        assert storage.local_path(key).exists()
        async with fam.api.sessions() as db:
            row = await db.get(DeletionCleanupJob, job.id)
            row.next_attempt_at = now() - timedelta(seconds=1)
            await db.commit()
        worker = privacy.cleanup.DurableDeletionCleanupWorker()
        for _ in range(6):
            claimed = await worker.claim_next_job()
            if claimed is None:
                break
            await worker.execute_claimed_job(claimed)
        assert not storage.local_path(key).exists(), "cleanup left the staged object"
    return referenced


async def test_race_copy_ok_receipt_completes(fam, monkeypatch):
    asset, moving, other = await setup_shared_asset(fam)
    async def nothing():
        pass
    done = during_copy(monkeypatch, nothing)
    r = await fam.c.post(f"{API}/records/{moving['id']}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": moving["revision"]})
    assert r.status_code == 200, r.text
    assert await assert_staged_object_collectable(fam, done)
    assert not [j for j in await staged_jobs(fam.api) if any(done[0].rsplit("asset", 1)[0] in p for p in j.storage_prefixes)]


async def test_race_attachment_deleted_during_copy(fam, monkeypatch):
    asset, moving, other = await setup_shared_asset(fam)
    async def act():
        r = await fam.c.delete(f"{API}/attachments/{asset}", headers=fam.ho)
        assert r.status_code == 204, r.text
    done = during_copy(monkeypatch, act)
    r = await fam.c.post(f"{API}/records/{moving['id']}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": moving["revision"]})
    assert r.status_code in {409}, r.text
    assert not await assert_staged_object_collectable(fam, done)


async def test_race_other_reference_removed_during_copy(fam, monkeypatch):
    asset, moving, other = await setup_shared_asset(fam)
    async def act():
        r = await fam.c.delete(f"{API}/records/{other['id']}?revision={other['revision']}", headers=fam.h)
        assert r.status_code in {200, 204}, r.text
    done = during_copy(monkeypatch, act)
    r = await fam.c.post(f"{API}/records/{moving['id']}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": moving["revision"]})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["attachment_ids"] == [asset], "file should move in place"
    assert not await assert_staged_object_collectable(fam, done)
    async with fam.api.sessions() as db:
        row = await db.get(BabyAttachment, asset)
        assert row.state == "ready" and str(row.space_id) == str(fam.personal)
    from app.domains.baby import storage
    assert storage.local_path(row.object_key).exists(), "cleanup hit the real object"


async def test_race_new_reference_added_during_inplace_prepare(fam, monkeypatch):
    # No copy staged at prepare; a new reference appears before the locks.
    asset = await upload(fam.api, fam.family)
    moving = await post_in_family(fam, fam.h, {"attachment_ids": [asset]})
    original = moves_module.prepare_move_files
    async def wrapper(db, actor, access, record_id=None):
        await original(db, actor, access, record_id)
        await post_in_family(fam, fam.h, {"attachment_ids": [asset]})
    monkeypatch.setattr(moves_module, "prepare_move_files", wrapper)
    r = await fam.c.post(f"{API}/records/{moving['id']}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": moving["revision"]})
    assert r.status_code == 409, r.text
    async with fam.api.sessions() as db:
        assert str((await db.get(BabyRecord, moving["id"])).space_id) == str(fam.family)
    monkeypatch.setattr(moves_module, "prepare_move_files", original)
    retry = await fam.c.post(f"{API}/records/{moving['id']}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": moving["revision"]})
    assert retry.status_code == 200, retry.text
    assert retry.json()["data"]["attachment_ids"] != [asset]


async def test_race_record_deleted_during_copy(fam, monkeypatch):
    asset, moving, other = await setup_shared_asset(fam)
    async def act():
        r = await fam.c.delete(f"{API}/records/{moving['id']}?revision={moving['revision']}", headers=fam.ho)
        assert r.status_code in {200, 204}, r.text
    done = during_copy(monkeypatch, act)
    r = await fam.c.post(f"{API}/records/{moving['id']}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": moving["revision"]})
    assert r.status_code in {404, 410}, r.text
    assert not await assert_staged_object_collectable(fam, done)
    async with fam.api.sessions() as db:
        assert str((await db.get(BabyRecord, moving["id"])).space_id) == str(fam.family)


async def test_race_actor_removed_during_copy(fam, monkeypatch):
    asset, moving, other = await setup_shared_asset(fam)
    async def act():
        r = await fam.c.delete(f"{API}/family/{fam.family}/members/owner", headers=fam.ho)
        assert r.status_code == 200, r.text
    done = during_copy(monkeypatch, act)
    r = await fam.c.post(f"{API}/records/{moving['id']}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": moving["revision"]})
    assert r.status_code in {403, 404, 409}, r.text
    assert not await assert_staged_object_collectable(fam, done)
    async with fam.api.sessions() as db:
        assert str((await db.get(BabyRecord, moving["id"])).space_id) == str(fam.family)


async def test_race_actor_account_deleted_during_copy(fam, monkeypatch):
    asset, moving, other = await setup_shared_asset(fam)
    async def act():
        r = await fam.c.delete("/api/users/me", headers={"X-Test-Owner": "owner"})
        assert r.status_code == 202, r.text
    done = during_copy(monkeypatch, act)
    r = await fam.c.post(f"{API}/records/{moving['id']}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": moving["revision"]})
    assert r.status_code in {401, 403, 404, 409}, r.text
    assert not await assert_staged_object_collectable(fam, done)


async def test_race_two_first_invites_copy(privacy_api, monkeypatch):
    api = privacy_api
    api.settings.baby_family_enabled = api.settings.baby_invites_enabled = True
    await importlib.import_module("migrations.058_contract_baby_spaces").run_migration(configured=api.settings, migration_engine=api.engine)
    assert (await api.client.post(API + "/bootstrap", headers={"X-Test-Owner": "owner"})).status_code == 200
    personal = await invites.personal(api, "owner")
    h = records.headers(personal, generation=1)
    asset = await upload(api, personal)
    for body in (shared.payload("source", data={"attachment_ids": [asset]}), shared.payload(data={"attachment_ids": [asset]})):
        assert (await api.client.post(API + "/records", headers=h, json=body)).status_code == 200
    a, b = await asyncio.gather(*[api.client.post(API + "/family/invites", headers=h, json={"publish_shared": True, "disclosure_version": 1}) for _ in range(2)])
    assert {a.status_code, b.status_code} <= {201, 409}, (a.text, b.text)
    async with api.sessions() as db:
        families = await db.scalar(select(func.count()).select_from(BabySpace).where(BabySpace.kind == "family"))
        assert families == 1
        rows = list(await db.scalars(select(BabyAttachment)))
        assert len(rows) == 2


async def flag_off_user(api, actor="owner", bootstrap=True):
    if bootstrap:
        assert (await api.client.post(API + "/bootstrap", headers={"X-Test-Owner": actor})).status_code == 200



async def test_o3_copy_signature_changed_after_staging_fails_closed(fam, monkeypatch):
    asset, moving, other = await setup_shared_asset(fam)
    async def change_signature():
        async with fam.api.sessions() as db:
            (await db.get(BabyAttachment, asset)).byte_hash = "changed-after-staging"
            await db.commit()
    done = during_copy(monkeypatch, change_signature)
    result = await fam.c.post(f"{API}/records/{moving['id']}/move", headers=fam.h,
        json={"space_id": str(fam.personal), "revision": moving["revision"]})
    assert result.status_code == 409, result.text
    assert not await assert_staged_object_collectable(fam, done)


@pytest.mark.parametrize("pending_status", ["queued", "processing"])
async def test_o4_pending_import_alone_retains_upload(fam, pending_status):
    asset = await upload(fam.api, fam.family, "other")
    result = await fam.c.post(API + "/imports", headers=fam.ho,
        json={"id": str(uuid4()), "text": "Pending original", "attachment_ids": [asset]})
    assert result.status_code == 200, result.text
    async with fam.api.sessions() as db:
        job = await db.get(BabyImport, result.json()["id"])
        job.status = pending_status
        (await db.get(BabyRecord, job.record_id)).deleted_at = now()
        await db.commit()
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)).status_code == 200
    async with fam.api.sessions() as db:
        assert (await db.get(BabyAttachment, asset)).state == "ready"


async def test_o6_nonnull_conversation_without_grant_is_preserved(fam):
    from fastapi import HTTPException

    from app.domains.baby.lifecycle import erase_conversations

    async with fam.api.sessions() as db:
        row = BabyConversation(app_user_id="owner", space_id=fam.personal, generation=1, title="Private")
        db.add(row)
        await db.flush()
        with pytest.raises(HTTPException) as caught:
            await erase_conversations(db, (), actor="owner")
        assert caught.value.status_code == 409
        assert await db.get(BabyConversation, row.id) is not None


async def test_o7_account_erasure_cancels_processing_family_source(fam):
    result = await fam.c.post(API + "/imports", headers=fam.ho, json={"id": str(uuid4()), "text": "Processing"})
    assert result.status_code == 200, result.text
    async with fam.api.sessions() as db:
        source = await db.get(BabyRecord, result.json()["record_id"])
        source.data = {**source.data, "status": "processing"}
        before = source.change_seq
        await db.commit()
    assert (await fam.c.delete("/api/users/me", headers={"X-Test-Owner": "other"})).status_code == 202
    async with fam.api.sessions() as db:
        source = await db.get(BabyRecord, result.json()["record_id"])
        assert source.data["status"] == "cancelled" and source.change_seq > before


async def test_o11_soft_deleted_reference_does_not_retain_upload(fam):
    asset = await upload(fam.api, fam.family, "other")
    post = await post_in_family(fam, fam.ho, {"attachment_ids": [asset]})
    async with fam.api.sessions() as db:
        (await db.get(BabyRecord, post["id"])).deleted_at = now()
        await db.commit()
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)).status_code == 200
    async with fam.api.sessions() as db:
        assert (await db.get(BabyAttachment, asset)).state == "deleted"


@pytest.mark.parametrize("poll", [False, True])
@pytest.mark.parametrize("missing", ["owner", "other"])
async def test_g_disappearing_account_only_returns_404_for_actor(fam, monkeypatch, poll, missing):
    from fastapi import HTTPException

    from app.domains.baby.access import access_for

    async with fam.api.sessions() as db:
        original = db.scalar
        async def disappeared(query, *args, **kwargs):
            if query.column_descriptions[0].get("entity") is AppUser and query.compile().params.get("id_1") == missing:
                return None
            return await original(query, *args, **kwargs)
        monkeypatch.setattr(db, "scalar", disappeared)
        with pytest.raises(HTTPException) as caught:
            await access_for(db, "owner", client="3", write=True, bootstrap=True, poll=poll)
        assert caught.value.status_code == (404 if missing == "owner" else 409)


@pytest.mark.parametrize("refusal", ["revision", "caregiver"])
async def test_f_refused_revision_and_role_do_not_stage(fam, monkeypatch, refusal):
    asset, moving, other = await setup_shared_asset(fam)
    calls = []
    original = moves_module.put_payload
    async def counting(*args, **kwargs):
        calls.append(args[0])
        return await original(*args, **kwargs)
    monkeypatch.setattr(moves_module, "put_payload", counting)
    actor = "owner" if refusal == "revision" else "caregiver"
    own = await invites.personal(fam.api, actor)
    result = await fam.c.post(f"{API}/records/{moving['id']}/move",
        headers=records.headers(fam.family, actor, 1),
        json={"space_id": str(own), "revision": moving["revision"] + (refusal == "revision")})
    assert result.status_code in ({409} if refusal == "revision" else {403, 404}), result.text
    assert not calls


async def test_h_departed_creator_still_blocks_private_move(fam):
    post = await post_in_family(fam, fam.ho)
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)).status_code == 200
    result = await fam.c.post(f"{API}/records/{post['id']}/move", headers=fam.h,
        json={"space_id": str(fam.personal), "revision": post["revision"]})
    assert result.status_code == 403, result.text


async def test_f_preflight_preserves_stale_space_moved_payload(fam):
    post = await post_in_family(fam, fam.h)
    moved = await fam.c.post(f"{API}/records/{post['id']}/move", headers=fam.h,
        json={"space_id": str(fam.personal), "revision": post["revision"]})
    assert moved.status_code == 200, moved.text
    stale = await fam.c.post(f"{API}/records/{post['id']}/move", headers=fam.h,
        json={"space_id": str(fam.family), "revision": moved.json()["revision"]})
    assert stale.status_code == 409 and stale.json()["code"] == "moved", stale.text


async def test_f1_caregiver_and_removed_cannot_delete(fam):
    assert (await fam.c.delete(f"{API}/family/{fam.family}", headers=fam.hc)).status_code == 403
    assert (await fam.c.delete(f"{API}/family/{fam.family}/members/other", headers=fam.h)).status_code == 200
    assert (await fam.c.delete(f"{API}/family/{fam.family}", headers=fam.ho)).status_code in {403, 404}
    async with fam.api.sessions() as db:
        assert await db.get(BabySpace, fam.family) is not None


async def test_f1_concurrent_both_delete_both_refused(fam):
    a, b = await asyncio.gather(fam.c.delete(f"{API}/family/{fam.family}", headers=fam.h),
                                fam.c.delete(f"{API}/family/{fam.family}", headers=fam.ho))
    assert (a.status_code, b.status_code) == (409, 409), (a.text, b.text)


async def test_f1_concurrent_mutual_removal_leaves_a_parent(fam):
    for _ in range(1):
        a, b = await asyncio.gather(
            fam.c.delete(f"{API}/family/{fam.family}/members/other", headers=fam.h),
            fam.c.delete(f"{API}/family/{fam.family}/members/owner", headers=fam.ho))
    statuses = [await member_status(fam.api, fam.family, x) for x in ("owner", "other")]
    assert "active" in statuses, (statuses, a.status_code, b.status_code)
    assert sorted([a.status_code, b.status_code])[0] == 200


async def test_f1_concurrent_both_leave_leaves_a_parent(fam):
    a, b = await asyncio.gather(fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.h),
                                fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho))
    assert sorted([a.status_code, b.status_code]) == [200, 409], (a.text, b.text)
    statuses = [await member_status(fam.api, fam.family, x) for x in ("owner", "other")]
    assert statuses.count("active") == 1


async def test_f1_concurrent_leave_and_delete_family(fam):
    a, b = await asyncio.gather(fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho),
                                fam.c.delete(f"{API}/family/{fam.family}", headers=fam.h))
    async with fam.api.sessions() as db:
        space = await db.get(BabySpace, fam.family)
    if b.status_code == 200:
        assert space is None
    else:
        assert b.status_code == 409 and space is not None


async def test_f1_concurrent_both_accounts_delete(fam):
    care = await fam.c.post(API + "/records", headers=fam.h, json=shared.payload("diaper", data={"type": "wet"}))
    assert care.status_code in {200, 422}
    a, b = await asyncio.gather(fam.c.delete("/api/users/me", headers={"X-Test-Owner": "owner"}),
                                fam.c.delete("/api/users/me", headers={"X-Test-Owner": "other"}))
    assert {a.status_code, b.status_code} <= {202, 409} and 202 in {a.status_code, b.status_code}, (a.text, b.text)
    for result, actor in ((a, "owner"), (b, "other")):
        if result.status_code == 409:
            retry = await fam.c.delete("/api/users/me", headers={"X-Test-Owner": actor})
            assert retry.status_code == 202, retry.text
    async with fam.api.sessions() as db:
        assert await db.get(BabySpace, fam.family) is None, "no parent remains, family must be erased"


@pytest.mark.parametrize("client", [None, "2", "3"])
async def test_f2_caregiver_data(fam, client):
    own = await invites.personal(fam.api, "caregiver")
    h = records.headers(own, "caregiver", 1)
    h.pop("X-Baby-Client")
    if client:
        h["X-Baby-Client"] = client
    else:
        h.pop("X-Baby-Space")
    if client == "2":
        h.pop("X-Baby-Space")
    r = await fam.c.delete(API + "/data?generation=1", headers=h)
    assert r.status_code == (409 if client == "3" else 200), r.text
    assert await member_status(fam.api, fam.family, "caregiver") == "active"
    async with fam.api.sessions() as db:
        assert await db.get(BabySpace, fam.family) is not None


@pytest.mark.parametrize("client", [None, "2"])
async def test_f2_last_parent_data_keeps_family_and_can_come_back(fam, client):
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)).status_code == 200
    child = await fam.c.post(API + "/children", headers=fam.h, json={"name": "Keep"})
    assert child.status_code == 200
    h = {"X-Test-Owner": "owner", "X-Baby-Generation": "1"}
    if client:
        h["X-Baby-Client"] = client
    r = await fam.c.delete(API + "/data?generation=1", headers=h)
    assert r.status_code == 200, r.text
    async with fam.api.sessions() as db:
        assert await db.get(BabySpace, fam.family) is not None
        assert await db.get(BabyChild, child.json()["id"]) is not None
    assert await member_status(fam.api, fam.family, "owner") == "active"
    # Caregiver still reaches the family.
    assert (await fam.c.get(API + "/children", headers={"X-Test-Owner": "caregiver", "X-Baby-Client": "3"})).status_code == 200
    # Parent comes back on client 3.
    boot = await fam.c.post(API + "/bootstrap", headers={"X-Test-Owner": "owner", "X-Baby-Client": "3"})
    assert boot.status_code == 200, boot.text
    assert fam.family in {UUID(s["id"]) for s in boot.json()["spaces"]}
    enrolled = await fam.c.post(API + "/enroll", headers=records.headers(await invites.personal(fam.api, "owner"), "owner", 2))
    assert enrolled.status_code == 200, enrolled.text
    kids = await fam.c.get(API + "/children", headers={"X-Test-Owner": "owner", "X-Baby-Client": "3"})
    assert child.json()["id"] in kids.text, kids.text
    # And Delete family remains available to them afterwards.
    assert (await fam.c.delete(f"{API}/family/{fam.family}", headers=records.headers(fam.family, generation=1))).status_code == 200


async def test_f2_client3_after_leaving_can_erase_personal(fam):
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)).status_code == 200
    own = await invites.personal(fam.api, "other")
    r = await fam.c.delete(API + "/data?generation=1", headers=records.headers(own, "other", 1))
    assert r.status_code == 200, r.text


async def test_f2_family_header_on_data_refused(fam):
    r = await fam.c.delete(API + "/data?generation=1", headers=fam.h)
    assert r.status_code == 422 and await member_status(fam.api, fam.family, "owner") == "active"


async def test_f2_client2_data_with_queued_family_import_settles(fam):
    """/data keeps the family. A family import owned by the eraser must not stick queued for the other parent."""
    assert (await fam.c.patch(API + "/profile", headers=fam.h, json={"ai_consent": True})).status_code == 200
    imported = await fam.c.post(API + "/imports", headers=fam.h, json={"id": str(uuid4()), "text": "Family capture"})
    assert imported.status_code == 200, imported.text
    record_id = imported.json()["record_id"]
    h = {"X-Test-Owner": "owner", "X-Baby-Generation": "1", "X-Baby-Client": "2"}
    assert (await fam.c.delete(API + "/data?generation=1", headers=h)).status_code == 200
    async def processor(request, *a, **k):
        return {"title": "Done", "data": {"status": "ready"}, "status": "ready"}
    worker = BabyWorker(fam.api.sessions, processor=processor)
    for _ in range(4):
        if not await worker.tick():
            break
    async with fam.api.sessions() as db:
        job = await db.get(BabyImport, imported.json()["id"])
        source = await db.get(BabyRecord, record_id)
        assert source is not None
        assert source.data.get("status") not in {"queued", "processing"}, (job and job.status, source.data.get("status"))


async def test_f4_referenced_by_other_parents_record_survives_leave(fam):
    asset = await upload(fam.api, fam.family)
    r = await fam.c.post(API + "/records", headers=fam.h, json=shared.payload("source", data={"attachment_ids": [asset]}))
    assert r.status_code == 200
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.h)).status_code == 200
    async with fam.api.sessions() as db:
        assert (await db.get(BabyAttachment, asset)).state == "ready"


async def test_f4_soft_deleted_ref_and_queued_import(fam):
    gone, queued, loose = await upload(fam.api, fam.family), await upload(fam.api, fam.family), await upload(fam.api, fam.family)
    body = shared.payload("source", data={"attachment_ids": [gone]})
    assert (await fam.c.post(API + "/records", headers=fam.h, json=body)).status_code == 200
    assert (await fam.c.delete(f"{API}/records/{body['id']}?revision=1", headers=fam.h)).status_code in {200, 204}
    imported = await fam.c.post(API + "/imports", headers=fam.h, json={"id": str(uuid4()), "text": "x", "attachment_ids": [queued]})
    assert imported.status_code == 200, imported.text
    assert (await fam.c.delete(f"{API}/family/{fam.family}/members/owner", headers=fam.ho)).status_code == 200
    async with fam.api.sessions() as db:
        rows = {k: (await db.get(BabyAttachment, k)).state for k in (gone, queued, loose)}
    assert rows[loose] == "deleted"
    # The queued import's source record now holds this asset: must stay readable to the family.
    assert rows[queued] == "ready"


async def test_f4_retired_upload_blocks_keep_in_personal(fam):
    """Plan 4.4: leaving offers Keep in my personal space. A draft with the retired upload must have a way through."""
    asset = await upload(fam.api, fam.family, "other")
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)).status_code == 200
    own = await invites.personal(fam.api, "other")
    r = await fam.c.post(API + "/records", headers=records.headers(own, "other", 1),
        json=shared.payload("source", data={"attachment_ids": [asset]}))
    assert r.status_code == 404, r.text


async def test_f5_removal_with_invites_in_every_state(fam):
    # Pending from each parent, an expired, a revoked and a used invite.
    a = (await fam.c.post(API + "/family/invites", headers=fam.h, json={"disclosure_version": 1})).json()
    b = (await fam.c.post(API + "/family/invites", headers=fam.ho, json={"disclosure_version": 1})).json()
    expired = (await fam.c.post(API + "/family/invites", headers=fam.h, json={"disclosure_version": 1})).json()
    revoked = (await fam.c.post(API + "/family/invites", headers=fam.h, json={"disclosure_version": 1})).json()
    assert (await fam.c.delete(f"{API}/family/{fam.family}/invites/{revoked['id']}", headers=fam.h)).status_code == 200
    async with fam.api.sessions() as db:
        (await db.get(BabySpaceInvite, expired["id"])).expires_at = now() - timedelta(days=1)
        used = list(await db.scalars(select(BabySpaceInvite).where(BabySpaceInvite.used_at.is_not(None))))
        used_at = {r.id: r.used_at for r in used}
        revoked_at = (await db.get(BabySpaceInvite, revoked["id"])).revoked_at
        await db.commit()
    assert (await fam.c.delete(f"{API}/family/{fam.family}/members/other", headers=fam.h)).status_code == 200
    for inv in (a, b, expired, revoked):
        assert (await invites.accept(fam.api, inv, "other")).status_code == 409
    assert await member_status(fam.api, fam.family, "other") == "removed"
    async with fam.api.sessions() as db:
        for k, v in used_at.items():
            row = await db.get(BabySpaceInvite, k)
            assert row.used_at == v and row.revoked_at is None, "used invite audit changed"
        assert (await db.get(BabySpaceInvite, revoked["id"])).revoked_at == revoked_at
    # A fresh invite after removal is the deliberate way back.
    fresh = (await fam.c.post(API + "/family/invites", headers=fam.h, json={"disclosure_version": 1})).json()
    assert (await invites.accept(fam.api, fresh, "other")).status_code == 200


async def test_f6_creator_now_caregiver(fam):
    post = await post_in_family(fam, fam.ho)
    assert (await fam.c.delete(f"{API}/family/{fam.family}/members/other", headers=fam.h)).status_code == 200
    inv = (await fam.c.post(API + "/family/invites", headers=fam.h, json={"role": "caregiver", "disclosure_version": 1})).json()
    assert (await invites.accept(fam.api, inv, "other")).status_code == 200
    own = await invites.personal(fam.api, "other")
    r = await fam.c.post(f"{API}/records/{post['id']}/move", headers=fam.ho, json={"space_id": str(own), "revision": post["revision"]})
    assert r.status_code in {403, 404}, r.text


async def test_f6_null_creator_parent_only(fam):
    post = await post_in_family(fam, fam.ho)
    async with fam.api.sessions() as db:
        (await db.get(BabyRecord, post["id"])).app_user_id = None
        await db.commit()
    own = await invites.personal(fam.api, "caregiver")
    r = await fam.c.post(f"{API}/records/{post['id']}/move", headers=fam.hc, json={"space_id": str(own), "revision": post["revision"]})
    assert r.status_code in {403, 404}, r.text
    r = await fam.c.post(f"{API}/records/{post['id']}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": post["revision"]})
    assert r.status_code == 200, r.text


async def test_f6_null_creator_journal_blocked(fam):
    body = shared.payload(data={})
    r = await fam.c.post(API + "/records", headers=fam.ho, json=body)
    assert r.status_code == 200, r.text
    async with fam.api.sessions() as db:
        (await db.get(BabyRecord, body["id"])).app_user_id = None
        await db.commit()
    r = await fam.c.post(f"{API}/records/{body['id']}/move", headers=fam.h, json={"space_id": str(fam.personal), "revision": 1})
    assert r.status_code == 403, r.text


@pytest.mark.parametrize("client", [None, "2", "3"])
async def test_build33_whole_profile_roundtrip_with_disclosure(fam, client):
    h = {"X-Test-Owner": "other"}
    if client:
        h["X-Baby-Client"] = client
    boot = await fam.c.get(API + "/bootstrap", headers=h)
    assert boot.status_code == 200, boot.text
    profile = boot.json()["profile"]
    assert "family_disclosures" not in profile
    own = await invites.personal(fam.api, "other")
    write = {**h, "X-Baby-Generation": "1"}
    if client == "3":
        write["X-Baby-Space"] = str(own)
    for patch in ({"ai_consent": True}, {"ai_consent": False, "auto_process_shares": False}, {"display_name": "Name"},
                  {"family_disclosures": [{"forged": True}], "auto_process_epoch": 999, "ai_consent": False}):
        r = await fam.c.patch(API + "/profile", headers=write, json={**profile, **patch})
        assert r.status_code == 200, (patch, r.text)
        assert "family_disclosures" not in r.json()
    async with fam.api.sessions() as db:
        stored = (await db.get(BabyMembership, "other")).profile
    assert stored["family_disclosures"] and all("forged" not in e for e in stored["family_disclosures"])
    assert stored["auto_process_epoch"] != 999


@pytest.mark.parametrize("action", ["leave", "remove", "account"])
async def test_f8_family_source_settles_after_importer_exit(fam, action):
    assert (await fam.c.patch(API + "/profile", headers=records.headers(await invites.personal(fam.api, "other"), "other", 1), json={"ai_consent": True})).status_code == 200
    imported = await fam.c.post(API + "/imports", headers=fam.ho, json={"id": str(uuid4()), "text": "Family capture"})
    assert imported.status_code == 200, imported.text
    record_id = imported.json()["record_id"]
    if action == "leave":
        r = await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)
    elif action == "remove":
        r = await fam.c.delete(f"{API}/family/{fam.family}/members/other", headers=fam.h)
    else:
        r = await fam.c.delete("/api/users/me", headers={"X-Test-Owner": "other"})
    assert r.status_code in {200, 202}, r.text
    async def processor(request, *a, **k):
        return {"title": "Done", "data": {"status": "ready"}, "status": "ready"}
    worker = BabyWorker(fam.api.sessions, processor=processor)
    for _ in range(3):
        if not await worker.tick():
            break
    async with fam.api.sessions() as db:
        source = await db.get(BabyRecord, record_id)
    assert source.data.get("status") not in {"queued", "processing"}


async def test_f8_last_parent_account_with_queued_source(fam):
    assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)).status_code == 200
    await fam.c.patch(API + "/profile", headers=records.headers(fam.personal, generation=1), json={"ai_consent": True})
    imported = await fam.c.post(API + "/imports", headers=fam.h, json={"id": str(uuid4()), "text": "x"})
    assert imported.status_code == 200, imported.text
    r = await fam.c.delete("/api/users/me")
    assert r.status_code == 202, r.text
    async with fam.api.sessions() as db:
        assert await db.get(BabySpace, fam.family) is None


async def test_f12_patch_reference_and_caregiver(fam):
    from tests import test_baby_changes as ch
    asset = await upload(fam.api, fam.family)
    first = await ch.fetch(fam.api, actor="other")
    assert asset not in {i["id"] for i in ch.items(first)}
    post = await post_in_family(fam, fam.h)
    r = await fam.c.patch(f"{API}/records/{post['id']}", headers=fam.h, json={"revision": post["revision"], "data": {"attachment_ids": [asset]}})
    assert r.status_code == 200, r.text
    delta = ch.items(await ch.fetch(fam.api, first["cursor"], actor="other"))
    assert asset in {i["id"] for i in delta if i.get("entity") == "attachment"}


async def test_f13_every_entity_serializes_through_real_route(fam):
    from tests import test_baby_changes as ch
    await fam.c.patch(API + "/profile", headers=fam.h, json={"ai_consent": True})
    child = (await fam.c.post(API + "/children", headers=fam.h, json={"name": "K"})).json()
    asset = await upload(fam.api, fam.family)
    await post_in_family(fam, fam.h, {"attachment_ids": [asset]})
    imported = await fam.c.post(API + "/imports", headers=fam.h, json={"id": str(uuid4()), "text": "x"})
    assert imported.status_code == 200
    assert (await fam.c.post(API + "/share/session", headers=fam.h, json={"installation_id": str(uuid4())})).status_code == 201
    chat = await fam.c.post(API + "/chat", headers=records.headers(fam.personal, generation=1), json={"request_id": str(uuid4()), "message": "hi", "scope": "journal"})
    assert chat.status_code == 200, chat.text
    # Tear something down too so tombstones appear.
    assert (await fam.c.delete(f"{API}/children/{child['id']}?revision=1", headers=fam.h)).status_code in {200, 204, 422, 409}
    page = await ch.fetch(fam.api)
    entities = {i.get("entity", "removed") for i in ch.items(page)}
    assert {"record", "attachment", "import", "credential"} <= entities


async def test_f13_session_clean_after_real_route_and_no_locks(fam):
    from tests import test_baby_changes as ch
    await ch.fetch(fam.api)
    async with fam.api.sessions() as db:
        # A NOWAIT lock on the owner, the space and the other member right after the poll.
        await db.execute(text("select 1 from app_users where id in ('owner','other','caregiver') for update nowait"))
        await db.execute(select(BabySpace.id).where(BabySpace.id == fam.family).with_for_update(nowait=True))
        await db.rollback()


async def test_f13_stress_no_deadlock_across_polls_writes_exits(fam):
    codes = []
    async def poll(actor):
        for _ in range(6):
            r = await fam.c.get(API + "/changes", headers={"X-Baby-Client": "3", "X-Test-Owner": actor})
            codes.append(("poll", actor, r.status_code, r.text[:60] if r.status_code != 200 else ""))
            assert r.status_code in {200, 404, 409}, r.text
    async def write(h):
        for _ in range(6):
            r = await fam.c.post(API + "/records", headers=h, json=shared.payload("diaper", data={"type": "wet"}))
            codes.append(("write", h["X-Test-Owner"], r.status_code, r.text[:60] if r.status_code != 200 else ""))
            assert r.status_code in {200, 403, 404, 409, 422}, r.text
    async def invite():
        for _ in range(4):
            r = await fam.c.post(API + "/family/invites", headers=fam.h, json={"disclosure_version": 1})
            codes.append(("invite", r.status_code, r.text[:60]))
            assert r.status_code in {201, 404, 409, 429}, r.text
    async def exit_caregiver():
        await asyncio.sleep(0.05)
        r = await fam.c.delete("/api/users/me", headers={"X-Test-Owner": "caregiver"})
        assert r.status_code in {202, 409}, r.text
    async def leave():
        await asyncio.sleep(0.1)
        r = await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)
        assert r.status_code in {200, 409}, r.text
    await asyncio.wait_for(asyncio.gather(poll("owner"), poll("other"), poll("caregiver"), write(fam.h), write(fam.ho),
        invite(), exit_caregiver(), leave()), timeout=600)


async def test_f10_post_family_gone_both_flags(fam):
    r = await fam.c.post(API + "/family", headers=fam.h)
    assert r.status_code in {404, 405}, r.text
    fam.api.settings.baby_family_enabled = False
    r = await fam.c.post(API + "/family", headers=fam.h)
    assert r.status_code in {404, 405}, r.text


@pytest.mark.parametrize("contract", [False, True])
async def test_off_recipes_delete_no_baby_data(privacy_api, contract):
    api = privacy_api
    assert api.settings.baby_family_enabled is False
    if contract:
        await importlib.import_module("migrations.058_contract_baby_spaces").run_migration(configured=api.settings, migration_engine=api.engine)
    async with api.sessions() as db:
        db.add(AppUser(id="plain"))
        await db.commit()
    r = await api.client.delete("/api/users/me", headers={"X-Test-Owner": "plain"})
    assert r.status_code == 202, r.text
    async with api.sessions() as db:
        assert await db.get(AppUser, "plain") is None


@pytest.mark.parametrize("client", [None, "2", "3"])
@pytest.mark.parametrize("contract", [False, True])
async def test_off_data_no_data_user(privacy_api, client, contract):
    api = privacy_api
    if contract:
        await importlib.import_module("migrations.058_contract_baby_spaces").run_migration(configured=api.settings, migration_engine=api.engine)
    async with api.sessions() as db:
        db.add(AppUser(id="plain"))
        await db.commit()
    h = {"X-Test-Owner": "plain", "X-Baby-Generation": "1"}
    if client:
        h["X-Baby-Client"] = client
    never_enrolled = await api.client.delete(API + "/data?generation=1", headers=h)
    assert never_enrolled.status_code == 409
    boot = await api.client.post(API + "/bootstrap", headers={"X-Test-Owner": "plain"})
    assert boot.status_code == 200
    gen = boot.json()["generation"]
    r = await api.client.delete(f"{API}/data?generation={gen}", headers={**h, "X-Baby-Generation": str(gen)})
    assert r.status_code == 200, r.text
    assert r.json()["generation"] == gen + 1
    # Replay is idempotent.
    r2 = await api.client.delete(f"{API}/data?generation={gen}", headers={**h, "X-Baby-Generation": str(gen)})
    assert r2.status_code == 200 and r2.json()["generation"] == gen + 1, r2.text
    boot = await api.client.post(API + "/bootstrap", headers={"X-Test-Owner": "plain"})
    assert boot.status_code == 200
    async with api.sessions() as db:
        member = await db.get(BabyMembership, "plain")
        assert member.status in {"active", "deleted"} and member.personal_space_id is not None
        spaces = await db.scalar(select(func.count()).select_from(BabySpace).where(BabySpace.created_by == "plain"))
        assert spaces == 1


async def test_off_data_user_with_private_data_real_routes(privacy_api):
    api = privacy_api
    case = await privacy.seed_private(api)
    r = await api.client.delete(API + "/data?generation=1", headers=privacy.headers())
    assert r.status_code == 200, r.text
    async with api.sessions() as db:
        assert await db.get(BabyRecord, case.entry["id"]) is None
        assert await db.get(BabyConversation, case.conversation_id) is None
        assert await db.get(BabyAttachment, case.asset_id) is None
        job = await db.scalar(select(DeletionCleanupJob).where(DeletionCleanupJob.status == "queued"))
    await privacy.complete_cleanup(api, job.id)
    assert not case.path.exists()




@pytest.mark.parametrize("client", [None, "2"])
@pytest.mark.parametrize("contract", [False, True])
async def test_off_build33_bootstrap_and_profile(privacy_api, client, contract):
    api = privacy_api
    if contract:
        await importlib.import_module("migrations.058_contract_baby_spaces").run_migration(configured=api.settings, migration_engine=api.engine)
    h = {"X-Test-Owner": "owner"}
    if client:
        h["X-Baby-Client"] = client
    boot = await api.client.post(API + "/bootstrap", headers=h)
    assert boot.status_code == 200, boot.text
    body = boot.json()
    assert "family_disclosures" not in body["profile"]
    gen = body["generation"]
    w = {**h, "X-Baby-Generation": str(gen)}
    profile = body["profile"]
    for patch in ({"display_name": "Saved"}, {"ai_consent": True}, {"ai_consent": False, "auto_process_shares": False}, {"timezone": "Pacific/Guam"}):
        profile_result = await api.client.patch(API + "/profile", headers=w, json={**profile, **patch})
        assert profile_result.status_code == 200, (patch, profile_result.text)
        profile = profile_result.json()
    assert profile["display_name"] == "Saved" and profile["timezone"] == "Pacific/Guam"
    child = await api.client.post(API + "/children", headers=w, json={"name": "K"})
    assert child.status_code == 200, child.text
    record = shared.payload("source", child_id=child.json()["id"])
    assert (await api.client.post(API + "/records", headers=w, json=record)).status_code == 200
    replay = await api.client.post(API + "/records", headers=w, json=record)
    assert replay.status_code == 200
    exported = await api.client.get(API + "/export", headers=h)
    assert exported.status_code == 200 and "family_disclosures" not in exported.text


async def test_f12_worker_completes_family_import_with_attachment_after_touch(fam):
    from tests import test_baby_changes as ch
    await fam.c.patch(API + "/profile", headers=records.headers(fam.personal, generation=1), json={"ai_consent": True})
    asset = await upload(fam.api, fam.family)
    first = await ch.fetch(fam.api, actor="other")
    imported = await fam.c.post(API + "/imports", headers=fam.h, json={"id": str(uuid4()), "text": "x", "attachment_ids": [asset]})
    assert imported.status_code == 200, imported.text
    async def processor(request, *a, **k):
        return {"title": "Done", "data": {"status": "ready"}, "status": "ready"}
    worker = BabyWorker(fam.api.sessions, processor=processor)
    assert await worker.tick()
    async with fam.api.sessions() as db:
        assert (await db.get(BabyImport, imported.json()["id"])).status == "ready"
    delta = ch.items(await ch.fetch(fam.api, first["cursor"], actor="other"))
    assert asset in {i["id"] for i in delta if i.get("entity") == "attachment"}


@pytest.mark.parametrize("destination_header", ["removed", "missing", "invalid"])
async def test_f_space_admission_precedes_row_lookup(fam, destination_header):
    post = await post_in_family(fam, fam.h)
    own = await invites.personal(fam.api, "other")
    headers = dict(fam.ho)
    expected = 422
    if destination_header == "removed":
        assert (await fam.c.post(f"{API}/family/{fam.family}/leave", headers=fam.ho)).status_code == 200
        expected = 403
    elif destination_header == "missing":
        headers.pop("X-Baby-Space")
    else:
        headers["X-Baby-Space"] = "not-a-uuid"
    result = await fam.c.post(f"{API}/records/{post['id']}/move", headers=headers,
        json={"space_id": str(own), "revision": post["revision"]})
    assert result.status_code == expected, result.text
