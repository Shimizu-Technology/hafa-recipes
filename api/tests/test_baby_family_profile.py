"""F4b bootstrap and actor-scoped consent through actual endpoints."""
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.domains.baby.models import BabyImport, BabyMembership, BabyRecord, BabySpace
from app.domains.baby.share_models import BabyShareCapture
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


async def test_bootstrap_three_levels_and_fresh_account(baby_api, family):
    c = baby_api.client
    for method in (c.get, c.post):
        result = await method("/api/v1/baby/bootstrap", headers={"X-Baby-Client": "3"})
        assert result.status_code == 200, result.text
        state = result.json()
        assert len(state["spaces"]) == 2
        assert {s["generation"] for s in state["spaces"]} == {1, 7}
        assert all(s["role"] == "parent" and s["access_version"] == 1 for s in state["spaces"])
        assert state["generation"] == 1
    for h in ({}, {"X-Baby-Client": "2"}):
        state = (await c.get("/api/v1/baby/bootstrap", headers=h)).json()
        assert state["generation"] == 1 and "spaces" not in state
    from app.models.identity import AppUser
    async with baby_api.sessions() as db:
        db.add(AppUser(id="fresh"))
        await db.commit()
    result = await c.post("/api/v1/baby/bootstrap", headers={"X-Test-Owner": "fresh", "X-Baby-Client": "3"})
    assert result.status_code == 200 and len(result.json()["spaces"]) == 1


@pytest.mark.parametrize("client", [None, "2", "3"])
async def test_consent_cancels_only_actor_jobs_across_space_generations(baby_api, family, client):
    h = records.headers(family) if client == "3" else {"X-Baby-Generation": "1"}
    if client == "2":
        h["X-Baby-Client"] = "2"
    c = baby_api.client
    assert (await c.patch("/api/v1/baby/profile", headers=h, json={"ai_consent": True})).status_code == 200
    jobs, sources, receipts = [], [], []
    async with baby_api.sessions() as db:
        space = await db.get(BabySpace, family)
        space.change_seq = 10
        for actor in ("owner", "other"):
            # Another author can own the saved source, while the actor owns its job.
            source = BabyRecord(id=uuid4(), app_user_id="other", space_id=family, generation=7,
                                change_seq=1, kind="source", title="Original", body="", data={"status": "queued"},
                                occurred_at=datetime.now(UTC), creation_hash="test")
            job = BabyImport(id=uuid4(), app_user_id=actor, space_id=family, generation=7, change_seq=1,
                             consent_epoch=1, creation_hash="test", request={}, status="processing",
                             record_id=source.id, lease_token=uuid4())
            receipt = BabyShareCapture(id=uuid4(), app_user_id=actor, space_id=family, generation=7,
                                       change_seq=1, creation_hash="test", request={}, record_id=source.id,
                                       status="deferred", created_at=datetime.now(UTC))
            db.add_all([source, job, receipt])
            sources.append(source.id)
            jobs.append(job.id)
            receipts.append(receipt.id)
        await db.commit()
    result = await c.patch("/api/v1/baby/profile", headers=h, json={"ai_consent": False})
    assert result.status_code == 200, result.text
    async with baby_api.sessions() as db:
        for index in range(2):
            job, source = await db.get(BabyImport, jobs[index]), await db.get(BabyRecord, sources[index])
            receipt = await db.get(BabyShareCapture, receipts[index])
            assert job.status == ("cancelled" if index == 0 else "processing")
            assert source.data["status"] == ("cancelled" if index == 0 else "queued")
            assert receipt.status == ("saved" if index == 0 else "deferred")
            if index == 0:
                assert job.lease_token is None and job.change_seq > 1 and source.change_seq > 1
                assert receipt.change_seq > 1


async def test_reenroll_uses_personal_space_generation(baby_api, family):
    async with baby_api.sessions() as db:
        member = await db.get(BabyMembership, "owner")
        space = await db.get(BabySpace, member.personal_space_id)
        member.status, space.status = "deleted", "deleted"
        personal = member.personal_space_id
        await db.commit()
    result = await baby_api.client.post("/api/v1/baby/enroll", headers=records.headers(personal, generation=1))
    assert result.status_code == 200, result.text
    assert result.json() == {"generation": 1, "active": True}
