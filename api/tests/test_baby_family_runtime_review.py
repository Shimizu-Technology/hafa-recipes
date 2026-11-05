"""PR 552 runtime review regressions through real routes and PostgreSQL."""
import importlib
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text

from app.domains.baby import moves, storage
from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyAttachment, BabyImport, BabyRecord
from app.models.deletion import DeletionCleanupJob
from tests import test_baby_changes as changes
from tests import test_baby_family_recheck as recheck
from tests import test_baby_invites as invites

baby_api = recheck.baby_api
shared_privacy_api = recheck.shared_privacy_api
privacy_api = recheck.privacy_api
fam = recheck.fam
pytestmark = recheck.pytestmark
API = recheck.API


@pytest.mark.parametrize("status", ["queued", "processing"])
async def test_caregiver_deletes_own_upload_cancels_parent_import(fam, status):
    asset = await recheck.upload(fam.api, fam.family, "caregiver")
    visible = await fam.c.post(API + "/records", headers=fam.hc,
        json=recheck.shared.payload("milestone", data={"attachment_ids": [asset]}))
    assert visible.status_code == 200, visible.text
    assert (await fam.c.patch(API + "/profile", headers=fam.h, json={"ai_consent": True})).status_code == 200
    result = await fam.c.post(API + "/imports", headers=fam.h,
        json={"id": str(uuid4()), "text": "Original", "attachment_ids": [asset]})
    assert result.status_code == 200, result.text
    job_id = UUID(result.json()["id"])
    async with fam.api.sessions() as db:
        job = await db.get(BabyImport, job_id)
        job.status, job.lease_token, job.lease_until = status, uuid4(), now() + timedelta(minutes=5)
        await db.commit()
    # The private job remains unreadable to the caregiver, even during cancellation.
    assert (await fam.c.get(f"{API}/imports/{job_id}", headers=fam.hc)).status_code == 404
    result = await fam.c.delete(f"{API}/attachments/{asset}", headers=fam.hc)
    assert result.status_code == 204, result.text
    async with fam.api.sessions() as db:
        job = await db.get(BabyImport, job_id)
        assert job.status == "cancelled" and job.lease_token is None and job.lease_until is None
        source = await db.get(BabyRecord, job.record_id)
        assert source.data["status"] == "cancelled" and not source.data["attachment_ids"]
        assert (await db.get(BabyAttachment, asset)).state == "deleted"


async def test_changes_resets_after_caregiver_removes_last_visible_reference(fam):
    asset = await recheck.upload(fam.api, fam.family)
    hidden = await recheck.upload(fam.api, fam.family)
    post = await fam.c.post(API + "/records", headers=fam.h,
        json=recheck.shared.payload("milestone", data={"attachment_ids": [asset]}))
    assert post.status_code == 200, post.text
    page = await changes.fetch(fam.api, actor="caregiver")
    assert asset in {item["id"] for item in changes.items(page)}
    assert hidden not in {item["id"] for item in changes.items(page)}
    versions = {space["id"]: space["access_version"] for space in page["spaces"]}
    result = await fam.c.delete(f"{API}/records/{post.json()['id']}?revision=1", headers=fam.hc)
    assert result.status_code == 204, result.text
    delta = await changes.fetch(fam.api, page["cursor"], versions, actor="caregiver")
    family = next(space for space in delta["spaces"] if space["id"] == str(fam.family))
    assert family["reset"] is True, "Previously synced metadata must be evicted"
    fresh = await changes.fetch(fam.api, actor="caregiver")
    assert {asset, hidden}.isdisjoint({item["id"] for item in changes.items(fresh)})
    async with fam.api.sessions() as db:
        assert (await db.get(BabyAttachment, asset)).state == "ready", "Uploader retains their bytes"


@pytest.mark.parametrize("refusal", ["disclosure", "generation", "contract", "invalid_body"])
async def test_invite_rejection_never_stages_copies(privacy_api, monkeypatch, refusal):
    api = privacy_api
    api.settings.baby_family_enabled = api.settings.baby_invites_enabled = True
    await importlib.import_module("migrations.058_contract_baby_spaces").run_migration(
        configured=api.settings, migration_engine=api.engine)
    assert (await api.client.post(API + "/bootstrap")).status_code == 200
    personal = await invites.personal(api, "owner")
    h = recheck.records.headers(personal, generation=1)
    asset = await recheck.upload(api, personal)
    for kind in ("source", "journal"):
        result = await api.client.post(API + "/records", headers=h,
            json=recheck.shared.payload(kind, data={"attachment_ids": [asset]}))
        assert result.status_code == 200, result.text
    async with api.sessions() as db:
        original_receipts = set(await db.scalars(select(DeletionCleanupJob.id)))
    calls = []
    original = moves.put_payload
    async def observe(*args):
        calls.append(args[0])
        return await original(*args)
    monkeypatch.setattr(moves, "put_payload", observe)
    body = {"publish_shared": True}
    if refusal == "disclosure":
        body["publish_shared"] = False
    elif refusal == "generation":
        h["X-Baby-Generation"] = "2"
    elif refusal == "contract":
        async with api.engine.begin() as conn:
            await conn.execute(text("DELETE FROM schema_migrations WHERE version=58"))
    else:
        body["role"] = "stranger"
    result = await api.client.post(API + "/family/invites", headers=h, json=body)
    assert result.status_code == (422 if refusal in {"disclosure", "invalid_body"} else 409), result.text
    assert not calls, "Refused invitations must not write storage"
    async with api.sessions() as db:
        assert set(await db.scalars(select(DeletionCleanupJob.id))) == original_receipts


@pytest.mark.parametrize("status", ["processing", "completed", "failed", "missing", "retried"])
async def test_move_rejects_unavailable_staged_cleanup_receipt(fam, monkeypatch, status):
    _, moving, _ = await recheck.setup_shared_asset(fam)
    async def consume_receipt():
        async with fam.api.sessions() as db:
            receipt = await db.scalar(select(DeletionCleanupJob).where(DeletionCleanupJob.status == "queued"))
            if status == "missing":
                await db.delete(receipt)
            else:
                receipt.status = "queued" if status == "retried" else status
                if status == "retried":
                    receipt.attempt_count = 1  # A failed cleanup may already have removed bytes.
                if status == "completed":
                    await storage.delete_private_prefix(receipt.storage_prefixes[0])
                    receipt.storage_prefixes = []
            await db.commit()
    done = recheck.during_copy(monkeypatch, consume_receipt)
    result = await fam.c.post(f"{API}/records/{moving['id']}/move", headers=fam.h,
        json={"space_id": str(fam.personal), "revision": moving["revision"]})
    assert result.status_code == 409, result.text
    async with fam.api.sessions() as db:
        assert (await db.get(BabyRecord, moving["id"])).space_id == fam.family
        assert not await db.scalar(select(BabyAttachment.id).where(BabyAttachment.object_key == done[0]))


async def test_move_locks_receipt_against_cleanup_claim(fam, monkeypatch):
    _, moving, _ = await recheck.setup_shared_asset(fam)
    original = moves.touch
    attempted = []
    async def inspect_lock(row, grant):
        if isinstance(row, BabyAttachment) and row.cleanup_job_id:
            async with fam.api.sessions() as db:
                receipt = await db.scalar(select(DeletionCleanupJob).where(
                    DeletionCleanupJob.id == row.cleanup_job_id).with_for_update(skip_locked=True))
                attempted.append(receipt)
            assert receipt is None, "Cleanup must skip the receipt while the copy publishes"
        return await original(row, grant)
    monkeypatch.setattr(moves, "touch", inspect_lock)
    result = await fam.c.post(f"{API}/records/{moving['id']}/move", headers=fam.h,
        json={"space_id": str(fam.personal), "revision": moving["revision"]})
    assert result.status_code == 200, result.text
    assert attempted == [None]


async def test_client_three_erasure_replays_original_personal_space(privacy_api):
    api = privacy_api
    api.settings.baby_family_enabled = True
    assert (await api.client.post(API + "/bootstrap")).status_code == 200
    own = await invites.personal(api, "owner")
    h = recheck.records.headers(own, generation=1)
    first = await api.client.delete(API + "/data?generation=1", headers=h)
    assert first.status_code == 200, first.text
    replay = await api.client.delete(API + "/data?generation=1", headers=h)
    assert replay.status_code == 200 and replay.json() == first.json(), replay.text


async def test_erasure_replay_does_not_bypass_active_family_exit(fam):
    # Legacy erase is permitted while in family; client 3 must still explicitly exit.
    h = recheck.records.headers(fam.personal, generation=1)
    first = await fam.c.delete(API + "/data?generation=1", headers={**h, "X-Baby-Client": "2"})
    assert first.status_code == 200, first.text
    replay = await fam.c.delete(API + "/data?generation=1", headers=h)
    assert replay.status_code == 409 and replay.json()["detail"]["code"] == "family_exit_required", replay.text
