"""Supplemental real background paths: stale files and pending native captures."""
from datetime import timedelta
from uuid import uuid4

import pytest

from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyAttachment, BabyImport, BabyMembership
from app.domains.baby.share_models import BabyShareCapture
from app.domains.baby.share_router import drain_deferred_captures
from app.models.deletion import DeletionCleanupJob
from tests import test_baby_access as foundation
from tests import test_baby_family_attachments as files
from tests import test_baby_family_records as records
from tests import test_baby_share_integration as native

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark
upload = files.upload


async def test_abandoned_file_reclamation_is_stamped_through_real_admission(baby_api, family, upload):
    identifier = await upload()
    async with baby_api.sessions() as db:
        row = await db.get(BabyAttachment, identifier)
        previous = row.change_seq
        row.created_at = now() - timedelta(days=8)
        (await db.get(DeletionCleanupJob, row.cleanup_job_id)).updated_at = row.created_at
        await db.commit()
    await upload()
    async with baby_api.sessions() as db:
        row = await db.get(BabyAttachment, identifier)
        assert row.state == "deleted" and row.change_seq > previous


@pytest.mark.parametrize("scenario", ["rotate", "permission", "missing_source"])
async def test_pending_native_capture_uses_original_space_after_recovery(baby_api, family, scenario):
    c, h = baby_api.client, records.headers(family)
    c._transport.app.include_router(native.router)
    assert (await c.patch("/api/v1/baby/profile", headers=h,
                         json={"ai_consent": True, "auto_process_shares": True})).status_code == 200
    jobs = []
    for _ in range(5):
        job_id = str(uuid4())
        assert (await c.post("/api/v1/baby/imports", headers=h,
                             json={"id": job_id, "text": "Synthetic queue reservation"})).status_code == 200
        jobs.append(job_id)
    installation = {"installation_id": str(uuid4())}
    result = await c.post("/api/v1/baby/share/session", headers=h, json=installation)
    assert result.status_code == 201
    capability = {"Authorization": "Bearer " + result.json()["token"]}
    request = native.capture(automatic_epoch=result.json()["auto_process_epoch"])
    result = await c.post("/api/v1/baby/share/captures", headers=capability, json=request)
    assert result.status_code == 202 and result.json()["status"] == "deferred", result.text
    async with baby_api.sessions() as db:
        before = (await db.get(BabyShareCapture, request["capture_id"])).change_seq
    if scenario == "rotate":
        async with baby_api.sessions() as db:
            personal = (await db.get(BabyMembership, "owner")).personal_space_id
        result = await c.post("/api/v1/baby/share/session", headers=records.headers(personal, generation=1), json=installation)
        assert result.status_code == 201
        assert (await c.post(f"/api/v1/baby/imports/{jobs[0]}/cancel", headers=h)).status_code == 200
    elif scenario == "permission":
        # A stale deferred receipt from an earlier server must honor current actor permission.
        async with baby_api.sessions() as db:
            member = await db.get(BabyMembership, "owner")
            member.profile = {**member.profile, "auto_process_shares": False}
            await db.commit()
    else:
        assert (await c.delete(f"/api/v1/baby/records/{request['capture_id']}?revision=1", headers=h)).status_code == 204
    async with baby_api.sessions() as db:
        admitted = await drain_deferred_captures(db)
        assert admitted == (1 if scenario == "rotate" else 0)
    async with baby_api.sessions() as db:
        capture = await db.get(BabyShareCapture, request["capture_id"])
        job = await db.get(BabyImport, request["capture_id"])
        assert capture.space_id == family and capture.generation == 7 and capture.change_seq > before
        assert capture.status == ("queued" if scenario == "rotate" else "saved")
        if scenario == "rotate":
            assert job.space_id == family and job.generation == 7 and job.change_seq > 0
        else:
            assert job is None
