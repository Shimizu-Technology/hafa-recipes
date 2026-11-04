"""Actual F4a endpoint journeys; synthetic members have unequal space generations."""
from uuid import uuid4

import pytest
from sqlalchemy import event, inspect, select
from sqlalchemy.orm import Session

from app.domains.baby.models import BabyRecord, BabySpaceMember
from tests import test_baby_access as foundation
from tests import test_baby_integration as shared

baby_api, family = foundation.baby_api, foundation.family
pytestmark = foundation.pytestmark


def headers(space, owner="owner", generation=7):
    return {"X-Test-Owner": owner, "X-Baby-Client": "3", "X-Baby-Space": str(space),
            "X-Baby-Generation": str(generation)}


async def test_shared_records_search_history_summary_and_legacy_isolation(baby_api, family):
    c = baby_api.client
    request = shared.payload("diaper", title="Family searchable", data={"type": "wet"})
    assert (await c.post("/api/v1/baby/records", headers=headers(family), json=request)).status_code == 200
    for owner in ("owner", "other"):
        h = headers(family, owner)
        detail = await c.get(f"/api/v1/baby/records/{request['id']}", headers=h)
        assert detail.status_code == 200 and detail.json()["space_id"] == str(family)
        for path in ("/records", "/search?q=searchable", "/records?kinds=diaper&occurred_from=2026-10-20T00:00:00Z"):
            result = await c.get("/api/v1/baby" + path, headers=h)
            assert result.status_code == 200 and result.json()["total"] == 1, result.text
        result = await c.get("/api/v1/baby/care/summary?from=2026-10-20&to=2026-10-20", headers=h)
        assert result.status_code == 200 and result.json()["diapers"]["count"] == 1
    for client in (None, "2"):
        h = {"X-Baby-Client": client} if client else {}
        assert (await c.get("/api/v1/baby/records", headers=h)).json()["total"] == 0
        assert (await c.get(f"/api/v1/baby/records/{request['id']}", headers=h)).status_code == 404
    async with baby_api.sessions() as db:
        link = await db.get(BabySpaceMember, (family, "other"))
        link.status = "removed"
        await db.commit()
    assert (await c.get(f"/api/v1/baby/records/{request['id']}", headers=headers(family, "other"))).status_code == 403


# This fixture is extended by each F4 module; scenarios execute routes, never source searches.
@pytest.fixture
def mutation_paths():
    return ("create", "patch", "feed_action", "feed_settlement", "delete")


@pytest.mark.parametrize("path", ["create", "patch", "feed_action", "feed_settlement", "delete"])
async def test_real_mutations_advance_locked_space(baby_api, family, mutation_paths, path):
    assert path in mutation_paths
    c, h = baby_api.client, headers(family)
    if path in {"feed_action", "feed_settlement"}:
        request = shared.payload("feeding", data={"method": "breast", "side": "left", "state": "running"})
    else:
        request = shared.payload()
    first = await c.post("/api/v1/baby/records", headers=h, json=request)
    assert first.status_code == 200, first.text
    async with baby_api.sessions() as db:
        row = await db.get(BabyRecord, request["id"])
        previous = row.change_seq
        assert previous > 0
    if path == "patch":
        response = await c.patch(f"/api/v1/baby/records/{request['id']}", headers=h,
                                 json={"revision": 1, "body": "Changed"})
    elif path == "delete":
        response = await c.delete(f"/api/v1/baby/records/{request['id']}?revision=1", headers=h)
    elif path == "feed_action":
        response = await c.post(f"/api/v1/baby/records/{request['id']}/feed-action", headers=h,
                                json={"action_id": str(uuid4()), "action": "finish", "at": "2026-10-20T12:10:00+10:00"})
    elif path == "feed_settlement":
        request2 = {**request, "id": str(uuid4()), "occurred_at": "2026-10-20T12:01:00+10:00"}
        response = await c.post("/api/v1/baby/records", headers=h, json=request2)
    else:
        response = first
    assert response.status_code in {200, 204}, response.text
    async with baby_api.sessions() as db:
        row = await db.get(BabyRecord, request["id"])
        assert row.change_seq > previous if path != "create" else row.change_seq == previous
        if path == "feed_settlement":
            assert row.data["state"] == "unknown_end"
            rows = list(await db.scalars(select(BabyRecord)))
            assert len({r.change_seq for r in rows}) == 2


async def test_header_errors_and_caregiver_kind_filter(baby_api, family):
    c = baby_api.client
    assert (await c.post("/api/v1/baby/records", headers={**shared.GEN, "X-Baby-Client": "3"},
                         json=shared.payload())).status_code == 422
    assert (await c.post("/api/v1/baby/records", headers=headers(uuid4()), json=shared.payload())).status_code == 403
    for kind, data in (("journal", {}), ("diaper", {"type": "wet"})):
        assert (await c.post("/api/v1/baby/records", headers=headers(family),
                             json=shared.payload(kind, data=data))).status_code == 200
    async with baby_api.sessions() as db:
        link = await db.get(BabySpaceMember, (family, "other"))
        link.role = "caregiver"
        await db.commit()
    result = await c.get("/api/v1/baby/records", headers=headers(family, "other"))
    assert [r["kind"] for r in result.json()["items"]] == ["diaper"]
    result = await c.post("/api/v1/baby/records", headers=headers(family, "other"), json=shared.payload())
    assert result.status_code == 403



@pytest.fixture(autouse=True)
def require_touch_on_every_record_flush(family):
    # Observe actual writes, including helper/background writes in these journeys.
    # Adding a new writer to an exercised path without touch fails at flush.
    def check(session, context, instances):
        for row in session.new | session.dirty:
            if isinstance(row, BabyRecord) and session.is_modified(row):
                assert row.change_seq is not None and inspect(row).attrs.change_seq.history.has_changes(), (
                    "BabyRecord mutation skipped touch", row.id)

    event.listen(Session, "before_flush", check)
    try:
        yield
    finally:
        event.remove(Session, "before_flush", check)


async def test_mutation_guard_rejects_an_endpoint_skipping_touch(baby_api, family, monkeypatch):
    async def skipped(row, space):
        pass

    monkeypatch.setattr("app.domains.baby.router.touch", skipped)
    with pytest.raises(AssertionError, match="skipped touch"):
        await baby_api.client.post("/api/v1/baby/records", headers=headers(family), json=shared.payload())


async def test_sessions_and_calendar_marks_use_membership_not_creator(baby_api, family, monkeypatch):
    monkeypatch.setattr("app.domains.baby.router.new_kinds_enabled", lambda: True)
    c, h = baby_api.client, headers(family)
    request = shared.payload("kick_session", data={})
    assert (await c.post("/api/v1/baby/records", headers=h, json=request)).status_code == 200
    action = {"action_id": str(uuid4()), "action": "tap", "at": "2026-10-20T12:01:00+10:00"}
    path = f"/api/v1/baby/records/{request['id']}/session-action"
    result = await c.post(path, headers=headers(family, "other"), json=action)
    assert result.status_code == 200, result.text
    assert result.json()["data"]["count"] == 1
    async with baby_api.sessions() as db:
        row = await db.get(BabyRecord, request["id"])
        assert row.change_seq > 1
    for actor in ("owner", "other"):
        result = await c.get("/api/v1/baby/care/summary?from=2026-10-20&to=2026-10-20", headers=headers(family, actor))
        assert "kick_session" in result.json()["days"][0]["dots"]
    for client in (None, "2"):
        old = {**shared.GEN, **({"X-Baby-Client": client} if client else {})}
        assert (await c.post(path, headers=old, json=action)).status_code == 404
        result = await c.get("/api/v1/baby/care/summary?from=2026-10-20&to=2026-10-20", headers=old)
        assert result.json()["days"][0]["dots"] == []
    async with baby_api.sessions() as db:
        link = await db.get(BabySpaceMember, (family, "owner"))
        link.status = "removed"
        await db.commit()
    assert (await c.post(path, headers=headers(family), json=action)).status_code == 403
