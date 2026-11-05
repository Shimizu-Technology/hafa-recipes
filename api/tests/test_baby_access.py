"""F4 resolver and ordered stamps on the disposable PostgreSQL fixture."""

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.domains.baby.access import access_for, touch
from app.domains.baby.models import BabyMembership, BabyRecord, BabySpace, BabySpaceMember
from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


@pytest.fixture
async def family(baby_api, monkeypatch):
    monkeypatch.setattr("app.domains.baby.access.get_settings", lambda: baby_api.settings)
    baby_api.settings.baby_family_enabled = True
    async with baby_api.sessions() as db:
        family = BabySpace(id=uuid4(), kind="family", generation=7, created_by="other")
        db.add(family)
        await db.flush()
        db.add_all([BabySpaceMember(space_id=family.id, app_user_id="owner", role="parent"),
                    BabySpaceMember(space_id=family.id, app_user_id="other", role="parent")])
        await db.commit()
        return family.id


@pytest.mark.parametrize("client", [None, "2", "3"])
async def test_resolver_levels_and_space_generation(baby_api, family, client):
    async with baby_api.sessions() as db:
        member = await db.get(BabyMembership, "owner")
        access = await access_for(db, "owner", client=client)
        assert {g.id for g in access.spaces} == (
            {member.personal_space_id, family} if client == "3" else {member.personal_space_id})
        if client == "3":
            with pytest.raises(HTTPException) as error:
                await access_for(db, "owner", client=client, write=True)
            assert error.value.status_code == 422
            access = await access_for(db, "owner", client=client, space_id=family, generation=7, write=True)
            assert access.target.id == family and access.target.role == "parent"
            assert access.target.access_version == 1
            with pytest.raises(HTTPException) as error:
                await access_for(db, "owner", client=client, space_id=family, generation=1, write=True)
            assert error.value.status_code == 409
        else:
            with pytest.raises(HTTPException) as error:
                await access_for(db, "owner", client=client, space_id=family, write=True)
            assert error.value.status_code == 403


async def test_stored_destination_precedes_client_and_rejects_header(baby_api, family):
    async with baby_api.sessions() as db:
        access = await access_for(db, "owner", stored_space_id=family, generation=7, write=True)
        assert access.target.id == family
        with pytest.raises(HTTPException) as error:
            await access_for(db, "owner", stored_space_id=family, space_id=uuid4(), write=True)
        assert error.value.status_code == 409
        with pytest.raises(HTTPException) as error:
            await access_for(db, "owner", client="3", space_id=uuid4(), write=True)
        assert error.value.status_code == 403


async def test_disabled_resolver_preserves_owner_fence_and_ignores_headers(baby_api, monkeypatch):
    baby_api.settings.baby_family_enabled = False
    monkeypatch.setattr("app.domains.baby.access.get_settings", lambda: baby_api.settings)
    async with baby_api.sessions() as db:
        access = await access_for(db, "owner", client="3", space_id="invalid", generation=1, write=True)
        assert access.enabled is False and access.target is None
        row = BabyRecord(**{**shared.payload(), "id": uuid4()}, app_user_id="owner",
                         space_id=access.personal_space_id, generation=1, creation_hash="test")
        await touch(row, access.target)
        assert row.change_seq is None
        await db.rollback()


async def test_stamps_are_commit_ordered_and_rollback_does_not_skip(baby_api, family):
    acquired, release = asyncio.Event(), asyncio.Event()
    identifiers = [uuid4(), uuid4()]

    async def writer(index):
        async with baby_api.sessions() as db:
            access = await access_for(db, "owner" if index == 0 else "other",
                                      stored_space_id=family, write=True)
            row = BabyRecord(id=identifiers[index], app_user_id=access.actor, space_id=family,
                             generation=7, kind="journal", title="test", body="", data={},
                             occurred_at=shared.datetime.now(shared.UTC), creation_hash="test")
            await touch(row, access.target)
            if index == 0:
                acquired.set()
                await release.wait()
            await db.commit()
            return row.change_seq

    first = asyncio.create_task(writer(0))
    await asyncio.wait_for(acquired.wait(), 3)
    second = asyncio.create_task(writer(1))
    try:
        await asyncio.sleep(0.05)
        assert not second.done()
    finally:
        release.set()
    assert await asyncio.gather(first, second) == [1, 2]
    async with baby_api.sessions() as db:
        access = await access_for(db, "owner", stored_space_id=family, write=True)
        row = await access.row(db, BabyRecord, identifiers[0], write=True)
        await touch(row, access.target)
        assert row.change_seq == 3
        await db.rollback()
        assert await db.scalar(select(BabySpace.change_seq).where(BabySpace.id == family)) == 2
        with pytest.raises(RuntimeError, match="current access_for"):
            await touch(row, access.target)


async def test_removed_membership_is_rechecked_after_waiting_for_user_lock(baby_api, family):
    async with baby_api.sessions() as holder:
        await holder.execute(text("SELECT id FROM app_users WHERE id='owner' FOR UPDATE"))

        async def waiting():
            async with baby_api.sessions() as db:
                return await access_for(db, "owner", client="3", space_id=family, write=True)

        task = asyncio.create_task(waiting())
        await asyncio.sleep(0.05)
        link = await holder.get(BabySpaceMember, (family, "owner"))
        link.status, link.access_version = "removed", 2
        await holder.commit()
        with pytest.raises(HTTPException) as error:
            await task
        assert error.value.status_code in {403, 409}


async def test_disabled_flag_matches_fixed_record_responses(baby_api, monkeypatch):
    baby_api.settings.baby_family_enabled = False
    monkeypatch.setattr("app.domains.baby.access.get_settings", lambda: baby_api.settings)
    at = shared.datetime(2026, 10, 20, 2, tzinfo=shared.UTC)
    monkeypatch.setattr("app.domains.baby.router.now", lambda: at)
    identifier = "11111111-1111-4111-8111-111111111111"
    expected = {"id": identifier, "kind": "journal", "title": "Notes", "body": "Original text",
                "child_id": None, "occurred_at": "2026-10-20T12:00:00+10:00",
                "data": {"attachment_ids": [], "provenance": "caregiver_observation"}, "revision": 1,
                "created_at": "2026-10-20T02:00:00+00:00", "updated_at": "2026-10-20T02:00:00+00:00"}
    c = baby_api.client
    created = await c.post("/api/v1/baby/records", headers=shared.GEN, json=shared.payload(id=identifier))
    assert created.status_code == 200 and created.json() == expected
    expected["occurred_at"] = "2026-10-20T02:00:00+00:00"
    for client in (None, "2", "3"):
        headers = {"X-Baby-Space": str(uuid4()), **({"X-Baby-Client": client} if client else {})}
        assert (await c.get(f"/api/v1/baby/records/{identifier}", headers=headers)).json() == expected
        for path in ("/records", "/search?q=Notes"):
            assert (await c.get("/api/v1/baby" + path, headers=headers)).json() == {
                "items": [expected], "total": 1, "has_more": False}


async def test_deleted_space_cannot_be_read(baby_api, family):
    async with baby_api.sessions() as db:
        row = BabyRecord(**{**shared.payload(), "id": uuid4(), "occurred_at": shared.datetime.now(shared.UTC)}, app_user_id="owner",
                         space_id=family, generation=7, creation_hash="test")
        db.add(row)
        space = await db.get(BabySpace, family)
        space.status = "deleted"
        await db.commit()
        access = await access_for(db, "owner", client="3")
        assert family not in {grant.id for grant in access.spaces}
        with pytest.raises(HTTPException) as error:
            await access.row(db, BabyRecord, row.id)
        assert error.value.status_code == 404
