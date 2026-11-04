"""R1 snapshots, cursors, commit order, worker writes and access fences."""
import asyncio
import json
from uuid import uuid4

import pytest

from app.domains.baby.access import access_for, touch
from app.domains.baby.models import BabyRecord, BabySpaceMember
from app.domains.baby.runtime import BabyWorker
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared
from tests import test_baby_moves as moves

baby_api, enabled, pytestmark = moves.baby_api, moves.enabled, moves.pytestmark


async def fetch(api, cursors=None, versions=None, *, actor="owner", limit=100):
    params = {"cursor": json.dumps(cursors or {}), "access_version": json.dumps(versions or {}), "limit": limit}
    result = await api.client.get("/api/v1/baby/changes", headers={"X-Baby-Client": "3", "X-Test-Owner": actor}, params=params)
    assert result.status_code == 200, result.text
    return result.json()


def items(page):
    return [item for space in page["spaces"] for item in space["items"]]


async def test_equal_timestamps_page_by_sequence_and_soft_delete(baby_api, enabled, monkeypatch):
    instant = shared.datetime(2026, 11, 5, tzinfo=shared.UTC)
    monkeypatch.setattr("app.domains.baby.router.now", lambda: instant)
    ids = []
    for _ in range(6):
        body = shared.payload()
        result = await baby_api.client.post("/api/v1/baby/records", headers=records.headers(enabled, generation=1), json=body)
        assert result.status_code == 200
        ids.append(body["id"])
    cursor, seen = {}, []
    for _ in range(4):
        page = await fetch(baby_api, cursor, limit=2)
        seen.extend(items(page))
        cursor = page["cursor"]
        if not page["has_more"]:
            break
    assert {item["id"] for item in seen} == set(ids) and len(seen) == 6
    assert len({item["updated_at"] for item in seen}) == 1
    assert [item["seq"] for item in seen] == sorted({item["seq"] for item in seen})
    assert (await baby_api.client.delete(f"/api/v1/baby/records/{ids[0]}?revision=1", headers=records.headers(enabled, generation=1))).status_code == 204
    removed = items(await fetch(baby_api, cursor))
    assert len(removed) == 1 and removed[0]["id"] == ids[0] and removed[0]["removed"] is True
    assert "body" not in removed[0] and "title" not in removed[0]


async def test_delayed_commit_cannot_be_skipped(baby_api, enabled):
    identifier = uuid4()
    async with baby_api.sessions() as db:
        access = await access_for(db, "owner", client="3", space_id=enabled, write=True)
        row = BabyRecord(id=identifier, app_user_id="owner", space_id=enabled, generation=1,
            kind="journal", title="Delayed", body="", data={}, occurred_at=shared.datetime.now(shared.UTC), creation_hash="x")
        await touch(row, access.target)
        pending = asyncio.create_task(fetch(baby_api))
        try:
            await asyncio.sleep(0.05)
            assert not pending.done()
            await db.commit()
            page = await asyncio.wait_for(pending, 5)
            assert str(identifier) in {item["id"] for item in items(page)}
            assert not items(await fetch(baby_api, page["cursor"]))
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)


async def test_worker_updates_advance_the_cursor(baby_api, enabled):
    result = await baby_api.client.post("/api/v1/baby/imports", headers=records.headers(enabled, generation=1),
        json={"id": str(uuid4()), "text": "Synthetic original"})
    assert result.status_code == 200
    before = await fetch(baby_api)
    async def processor(*args, **kwargs):
        return {"title": "Organized", "data": {"status": "ready"}, "status": "ready"}
    assert await BabyWorker(baby_api.sessions, processor=processor).tick()
    delta = items(await fetch(baby_api, before["cursor"]))
    assert {item["id"] for item in delta} == {result.json()["id"], result.json()["record_id"]}
    assert next(item for item in delta if item["entity"] == "import")["status"] == "ready"
    assert next(item for item in delta if item["entity"] == "record")["title"] == "Organized"


async def test_move_has_old_space_tombstone_and_new_space_snapshot(baby_api, enabled):
    body = shared.payload("source")
    assert (await baby_api.client.post("/api/v1/baby/records", headers=records.headers(enabled, generation=1), json=body)).status_code == 200
    before = await fetch(baby_api)
    family = await moves.family_for(baby_api, enabled)
    after = await fetch(baby_api, before["cursor"])
    personal = next(space for space in after["spaces"] if space["id"] == str(enabled))
    shared_page = next(space for space in after["spaces"] if space["id"] == str(family))
    assert any(item["id"] == body["id"] and item.get("removed") for item in personal["items"])
    assert any(item["id"] == body["id"] and item.get("space_id") == str(family) for item in shared_page["items"])


async def test_access_change_between_pages_resets_and_removal_purges(baby_api, enabled):
    family = await moves.family_for(baby_api, enabled)
    async with baby_api.sessions() as db:
        db.add(BabySpaceMember(space_id=family, app_user_id="other", role="parent"))
        await db.commit()
    hidden = shared.payload("source", body="Hidden source words")
    for body in (hidden, shared.payload("diaper", data={"type": "wet"})):
        assert (await baby_api.client.post("/api/v1/baby/records", headers=records.headers(family, generation=1), json=body)).status_code == 200
    first = await fetch(baby_api, actor="other", limit=1)
    versions = {space["id"]: space["access_version"] for space in first["spaces"]}
    async with baby_api.sessions() as db:
        link = await db.get(BabySpaceMember, (family, "other"))
        link.role, link.access_version = "caregiver", 2
        await db.commit()
    second = await fetch(baby_api, first["cursor"], versions, actor="other", limit=1)
    assert next(space for space in second["spaces"] if space["id"] == str(family))["reset"] is True
    fresh = await fetch(baby_api, actor="other")
    assert hidden["id"] not in {item["id"] for item in items(fresh)}
    assert any(item.get("kind") == "diaper" for item in items(fresh))
    async with baby_api.sessions() as db:
        (await db.get(BabySpaceMember, (family, "other"))).status = "removed"
        await db.commit()
    removed = await fetch(baby_api, fresh["cursor"], actor="other")
    assert str(family) in removed["removed_space_ids"]
    assert not any(space["id"] == str(family) for space in removed["spaces"])


@pytest.mark.parametrize("cursor", ['[]', '{"invalid":1}', json.dumps({str(uuid4()): -1}), json.dumps({str(uuid4()): True})])
async def test_invalid_cursors_are_bounded(baby_api, enabled, cursor):
    result = await baby_api.client.get("/api/v1/baby/changes", headers={"X-Baby-Client": "3"}, params={"cursor": cursor})
    assert result.status_code == 422


async def test_changes_returns_404_with_flag_off(baby_api):
    baby_api.settings.baby_family_enabled = False
    assert (await baby_api.client.get("/api/v1/baby/changes", headers={"X-Baby-Client": "3"})).status_code == 404
