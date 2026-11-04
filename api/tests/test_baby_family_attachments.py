"""F4e real uploads, reads, retention, deletion and stored-key quota reconciliation."""
from datetime import timedelta
from io import BytesIO
from uuid import uuid4

import pytest
from PIL import Image
from sqlalchemy import select

from app.domains.baby import storage
from app.domains.baby.attachments import attachment_prefix
from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyAttachment, BabySpaceMember
from app.models.deletion import DeletionCleanupJob
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


@pytest.fixture
async def upload(baby_api, family, monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "local_root", lambda: tmp_path)
    payload = BytesIO()
    Image.new("RGB", (20, 20), "white").save(payload, "PNG")

    async def run():
        identifier = str(uuid4())
        result = await baby_api.client.post("/api/v1/baby/attachments",
            headers={**records.headers(family), "Idempotency-Key": identifier},
            files={"file": ("synthetic.png", payload.getvalue(), "image/png")})
        assert result.status_code == 200, result.text
        assert result.json()["space_id"] == str(family)
        return identifier

    return run


async def test_unattached_upload_is_private_then_shared_reference_retains_it(baby_api, family, upload):
    c, identifier = baby_api.client, await upload()
    other = records.headers(family, "other")
    path = f"/api/v1/baby/attachments/{identifier}"
    for suffix in ("", "/metadata"):
        assert (await c.get(path + suffix, headers=other)).status_code == 404
    forbidden = await c.post("/api/v1/baby/records", headers=other,
                             json=shared.payload("source", data={"attachment_ids": [identifier]}))
    assert forbidden.status_code == 404
    source = shared.payload("source", data={"attachment_ids": [identifier]})
    assert (await c.post("/api/v1/baby/records", headers=records.headers(family), json=source)).status_code == 200
    assert (await c.get(path, headers=other)).status_code == 200
    assert (await c.post(path + "/release", headers=other)).status_code == 204
    assert (await c.get(path, headers=other)).status_code == 200
    async with baby_api.sessions() as db:
        link = await db.get(BabySpaceMember, (family, "other"))
        link.role = "caregiver"
        await db.commit()
    assert (await c.get(path, headers=other)).status_code == 404
    assert (await c.delete(path, headers=other)).status_code == 403
    assert (await c.delete(path, headers=records.headers(family))).status_code == 204
    result = await c.get(f"/api/v1/baby/records/{source['id']}", headers=records.headers(family))
    assert result.json()["data"]["attachment_ids"] == []
    async with baby_api.sessions() as db:
        asset = await db.get(BabyAttachment, identifier)
        assert asset.state == "deleted" and asset.change_seq > 0
        cleanup = await db.scalar(select(DeletionCleanupJob).where(DeletionCleanupJob.status == "queued"))
        assert cleanup.storage_prefixes == [asset.object_key.removesuffix("asset")]


async def test_quota_reconciliation_uses_persisted_key_generation(baby_api, family, upload):
    identifier = await upload()
    async with baby_api.sessions() as db:
        row = await db.get(BabyAttachment, identifier)
        previous = row.change_seq
        row.object_key = attachment_prefix(identifier, "owner", 1) + "asset"
        row.state, row.created_at = "pending", now() - timedelta(hours=2)
        guard = await db.get(DeletionCleanupJob, row.cleanup_job_id)
        guard.completed_at, guard.attempt_count = now(), 1
        guard.storage_prefix_count, guard.last_error, guard.lease_token = 1, None, None
        await db.commit()
    await upload()  # Actual admission invokes quota reconciliation.
    async with baby_api.sessions() as db:
        row = await db.get(BabyAttachment, identifier)
        assert row.state == "deleted" and row.change_seq > previous


async def test_moved_unattached_file_never_discloses_name_to_another_parent(baby_api, family, upload):
    from app.domains.baby.models import BabyMembership

    identifier = await upload()
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "other")).personal_space_id
    stale = records.headers(personal, "other", generation=1)
    response = await baby_api.client.delete(f"/api/v1/baby/attachments/{identifier}", headers=stale)
    assert response.status_code == 409
    assert response.json().get("detail", response.json())["code"] == "moved"
    assert "record" not in response.json().get("detail", response.json())
    assert "synthetic.png" not in response.text
    response = await baby_api.client.post(f"/api/v1/baby/attachments/{identifier}/release", headers=stale)
    assert response.status_code == 409 and "record" not in response.json().get("detail", response.json())


async def test_upload_put_releases_user_and_family_locks(baby_api, family, upload, monkeypatch):
    from sqlalchemy import text

    from app.domains.baby import attachments

    put = attachments._shielded_write
    observed = []

    async def check(**kwargs):
        async with baby_api.sessions() as db:
            await db.execute(text("SELECT id FROM app_users WHERE id IN ('owner', 'other') FOR UPDATE NOWAIT"))
            await db.execute(text("SELECT id FROM baby_spaces WHERE id = :id FOR UPDATE NOWAIT"), {"id": family})
            observed.append(True)
        return await put(**kwargs)

    monkeypatch.setattr(attachments, "_shielded_write", check)
    await upload()
    assert observed == [True]


async def test_account_cleanup_uses_stored_object_key(baby_api, family, upload):
    from app.domains.baby.lifecycle import owned_cleanup_prefixes

    identifier = await upload()
    async with baby_api.sessions() as db:
        row = await db.get(BabyAttachment, identifier)
        prefix = attachment_prefix(identifier, "owner", 1)
        row.object_key = prefix + "asset"
        await db.commit()
        assert await owned_cleanup_prefixes(db, "owner") == [prefix]
