"""F6 durable invite lifecycle, disclosure and concurrent single-use joins."""
import asyncio
from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import func, select

from app.domains.baby.invites import token_hash
from app.domains.baby.lifecycle import now
from app.domains.baby.models import (
    BabyMembership,
    BabyRecord,
    BabySpace,
    BabySpaceInvite,
    BabySpaceMember,
)
from app.models.identity import AppUser
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared
from tests import test_baby_moves as moves

baby_api, enabled, pytestmark = moves.baby_api, moves.enabled, moves.pytestmark


@pytest.fixture
async def invites(baby_api, enabled):
    baby_api.settings.baby_invites_enabled = True
    return enabled


async def create(api, personal, role="parent"):
    result = await api.client.post("/api/v1/baby/family/invites", headers=records.headers(personal, generation=1),
        json={"role": role, "publish_shared": True, "disclosure_version": 1})
    assert result.status_code == 201, result.text
    return result.json()


async def personal(api, actor):
    async with api.sessions() as db:
        return (await db.get(BabyMembership, actor)).personal_space_id


async def accept(api, invitation, actor="other"):
    return await api.client.post("/api/v1/baby/family/invites/accept",
        headers=records.headers(await personal(api, actor), actor, 1),
        json={"code": invitation["code"], "disclosure_version": 1})


async def test_first_invite_creates_family_and_acceptance_records_disclosure(baby_api, invites):
    c, h = baby_api.client, records.headers(invites, generation=1)
    source, journal = shared.payload("source"), shared.payload()
    for body in (source, journal):
        assert (await c.post("/api/v1/baby/records", headers=h, json=body)).status_code == 200
    refused = await c.post("/api/v1/baby/family/invites", headers=h, json={"publish_shared": False})
    assert refused.status_code == 422
    invitation = await create(baby_api, invites)
    family = UUID(invitation["space_id"])
    async with baby_api.sessions() as db:
        row = await db.get(BabySpaceInvite, invitation["id"])
        assert row.token_hash == token_hash(invitation["code"]) and invitation["code"] not in row.token_hash
        assert timedelta(days=6, hours=23) < row.expires_at - now() <= timedelta(days=7)
        assert (await db.get(BabyRecord, source["id"])).space_id == family
        assert (await db.get(BabyRecord, journal["id"])).space_id == invites
    preview = await c.post("/api/v1/baby/family/invites/preview", headers={"X-Baby-Client": "3"}, json={"code": invitation["code"]})
    assert preview.status_code == 200 and preview.json()["disclosure_version"] == 1
    joined = await accept(baby_api, invitation)
    assert joined.status_code == 200 and joined.json()["space_id"] == str(family), joined.text
    async with baby_api.sessions() as db:
        member = await db.get(BabyMembership, "other")
        disclosure = member.profile["family_disclosures"][-1]
        assert disclosure["invite_id"] == invitation["id"] and disclosure["version"] == 1
        assert disclosure["action"] == "accept" and disclosure["accepted_at"]
        assert not member.profile.get("ai_consent")
    h = records.headers(family, generation=1)
    listed = await c.get(f"/api/v1/baby/family/{family}/invites", headers=h)
    assert listed.status_code == 200 and "code" not in listed.text and "token_hash" not in listed.text
    members = await c.get(f"/api/v1/baby/family/{family}/members", headers=h)
    assert {item["app_user_id"] for item in members.json()["items"]} == {"owner", "other"}
    assert (await accept(baby_api, invitation)).status_code == 409
    # The server-only disclosure survives an ordinary profile edit and bootstrap.
    other_h = records.headers(await personal(baby_api, "other"), "other", 1)
    assert (await c.patch("/api/v1/baby/profile", headers=other_h, json={"display_name": "Other parent"})).status_code == 200
    assert (await c.get("/api/v1/baby/bootstrap", headers={"X-Baby-Client": "3", "X-Test-Owner": "other"})).status_code == 200


@pytest.mark.parametrize("reason", ["expired", "revoked", "used", "invalid"])
async def test_unavailable_invites_fail_cleanly(baby_api, invites, reason):
    invitation = await create(baby_api, invites)
    if reason == "revoked":
        result = await baby_api.client.delete(f"/api/v1/baby/family/{invitation['space_id']}/invites/{invitation['id']}",
            headers=records.headers(invitation["space_id"], generation=1))
        assert result.status_code == 200
    elif reason == "used":
        assert (await accept(baby_api, invitation)).status_code == 200
    elif reason == "expired":
        async with baby_api.sessions() as db:
            (await db.get(BabySpaceInvite, invitation["id"])).expires_at = now() - timedelta(seconds=1)
            await db.commit()
    else:
        invitation["code"] = "hfbi_v1." + "invalid" * 5
    assert (await accept(baby_api, invitation)).status_code == 409
    preview = await baby_api.client.post("/api/v1/baby/family/invites/preview", headers={"X-Baby-Client": "3"}, json={"code": invitation["code"]})
    assert preview.status_code == 409


async def test_concurrent_accepts_cannot_double_join(baby_api, invites):
    invitation = await create(baby_api, invites)
    async with baby_api.sessions() as db:
        db.add(AppUser(id="third"))
        await db.commit()
    assert (await baby_api.client.post("/api/v1/baby/bootstrap", headers={"X-Test-Owner": "third"})).status_code == 200
    responses = await asyncio.gather(accept(baby_api, invitation, "other"), accept(baby_api, invitation, "third"))
    assert sorted(result.status_code for result in responses) == [200, 409]
    async with baby_api.sessions() as db:
        count = await db.scalar(select(func.count()).select_from(BabySpaceMember).where(
            BabySpaceMember.space_id == UUID(invitation["space_id"]), BabySpaceMember.status == "active"))
        assert count == 2
        assert (await db.get(BabySpaceInvite, invitation["id"])).used_at is not None


async def test_concurrent_two_invites_cannot_join_two_families(baby_api, invites):
    first = await create(baby_api, invites)
    # A second creator creates an independent family, while the same joining actor races both.
    async with baby_api.sessions() as db:
        db.add(AppUser(id="third"))
        await db.commit()
    await baby_api.client.post("/api/v1/baby/bootstrap", headers={"X-Test-Owner": "third"})
    result = await baby_api.client.post("/api/v1/baby/family/invites",
        headers=records.headers(await personal(baby_api, "third"), "third", 1), json={"publish_shared": True})
    assert result.status_code == 201, result.text
    responses = await asyncio.gather(accept(baby_api, first), accept(baby_api, result.json()))
    assert sorted(response.status_code for response in responses) == [200, 409]
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabySpaceMember).join(BabySpace).where(
            BabySpaceMember.app_user_id == "other", BabySpaceMember.status == "active", BabySpace.kind == "family")) == 1


async def test_invites_default_off_and_only_client_three(baby_api, enabled):
    h = records.headers(enabled, generation=1)
    assert (await baby_api.client.post("/api/v1/baby/family/invites", headers=h, json={})).status_code == 404
    baby_api.settings.baby_invites_enabled = True
    for client in (None, "2"):
        headers = shared.GEN | ({"X-Baby-Client": client} if client else {})
        assert (await baby_api.client.post("/api/v1/baby/family/invites", headers=headers, json={})).status_code == 403
