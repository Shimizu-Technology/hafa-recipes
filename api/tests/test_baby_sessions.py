"""Kick taps and contraction stops: one identity each, so phones add up and never conflict."""

from datetime import UTC, datetime, timedelta
from itertools import permutations
from uuid import uuid4

import pytest

from app.domains.baby.chat import local_data
from app.domains.baby.sessions import reduce_session, with_session
from tests import test_baby_integration as shared
from tests.test_baby_care_kinds import allow_new_kinds

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
GEN = {**shared.GEN, "X-Baby-Client": "2"}
API = "/api/v1/baby"


def at(minute):
    return f"2026-11-01T08:{minute:02d}:00+10:00"


def item(kind, minute, target=None):
    action = {"id": str(uuid4()), "action": kind, "at": at(minute)}
    return {**action, "target": target} if target else action


def test_every_ordering_gives_one_result():
    first = item("tap", 1)
    actions = [first, item("tap", 2), item("undo", 3, first["id"]), item("finish", 9), item("finish", 5)]
    results = {str(reduce_session(list(order))) for order in permutations(actions)}
    assert results == {str({"count": 1, "end_at": at(5)})}


def test_an_undone_stop_opens_it_again_and_a_stop_behind_the_start_is_clamped():
    stop = item("finish", 5)
    assert reduce_session([stop, item("undo", 6, stop["id"])])["end_at"] is None
    started = datetime(2026, 11, 1, 8, 10, tzinfo=UTC)
    data = with_session("contraction", {"session_actions": [item("finish", 0)]}, started)
    assert datetime.fromisoformat(data["end_at"]) == started
    assert "count" not in data


def test_the_model_never_reads_each_tap():
    assert local_data({"count": 1, "session_actions": [item("tap", 1)]}, None) == {"count": 1}


async def create(baby_api, kind="kick_session", **data):
    await allow_new_kinds(baby_api)
    body = shared.payload(kind, occurred_at=at(0), data=data)
    response = await baby_api.client.post(f"{API}/records", headers=GEN, json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def send(baby_api, record_id, action):
    payload = {"action_id": action["id"], **{key: value for key, value in action.items() if key != "id"}}
    return await baby_api.client.post(f"{API}/records/{record_id}/session-action", headers=GEN, json=payload)


@needs_database
async def test_two_phones_tapping_both_count_and_a_retry_changes_nothing(baby_api):
    row = await create(baby_api, count=1, session_actions=[item("tap", 0)])
    assert row["data"]["count"] == 1 and row["revision"] == 1
    mine, theirs = item("tap", 1), item("tap", 1)
    first = (await send(baby_api, row["id"], mine)).json()
    second = (await send(baby_api, row["id"], theirs)).json()
    assert second["data"]["count"] == 3 and second["revision"] == 3
    replay = await send(baby_api, row["id"], mine)
    assert replay.status_code == 200 and replay.json()["revision"] == 3
    assert replay.json()["data"]["count"] == 3
    # A replay after another phone's write still says which revision this tap made.
    stored = {action["id"]: action.get("revision") for action in replay.json()["data"]["session_actions"]}
    assert stored[mine["id"]] == first["revision"] == 2 and stored[theirs["id"]] == 3
    changed = await send(baby_api, row["id"], {**mine, "at": at(2)})
    assert changed.status_code == 409


@needs_database
async def test_a_session_create_replays_after_taps_have_landed(baby_api):
    await allow_new_kinds(baby_api)
    body = shared.payload("kick_session", occurred_at=at(0), data={"count": 1, "session_actions": [item("tap", 0)]})
    first = await baby_api.client.post(f"{API}/records", headers=GEN, json=body)
    assert first.json()["revision"] == 1
    assert (await send(baby_api, body["id"], item("tap", 1))).json()["data"]["count"] == 2
    replay = await baby_api.client.post(f"{API}/records", headers=GEN, json=body)
    assert replay.status_code == 200 and replay.json()["revision"] == 2 and replay.json()["data"]["count"] == 2


@needs_database
async def test_take_back_and_finish_are_order_free(baby_api):
    first = item("tap", 0)
    row = await create(baby_api, count=1, session_actions=[first])
    assert (await send(baby_api, row["id"], item("finish", 9))).json()["data"]["end_at"] == at(9)
    late = await send(baby_api, row["id"], item("tap", 8))
    assert late.json()["data"]["count"] == 2 and late.json()["data"]["end_at"] == at(9)
    gone = await send(baby_api, row["id"], item("undo", 10, first["id"]))
    assert gone.json()["data"]["count"] == 1


@needs_database
async def test_two_stops_on_one_contraction_never_conflict_and_a_start_replays(baby_api):
    await allow_new_kinds(baby_api)
    body = shared.payload("contraction", occurred_at=at(0), data={})
    for _ in range(2):
        response = await baby_api.client.post(f"{API}/records", headers=GEN, json=body)
        assert response.status_code == 200 and response.json()["revision"] == 1
    early, later = item("finish", 1), item("finish", 2)
    assert (await send(baby_api, body["id"], later)).json()["data"]["end_at"] == at(2)
    stopped = (await send(baby_api, body["id"], early)).json()
    assert stopped["data"]["end_at"] == at(1) and stopped["revision"] == 3
    undone = await send(baby_api, body["id"], item("undo", 3, later["id"]))
    assert undone.json()["data"]["end_at"] == at(1)
    assert (await send(baby_api, body["id"], item("tap", 3))).status_code == 422


@needs_database
async def test_an_old_copy_cannot_rewrite_taps_or_their_results(baby_api):
    row = await create(baby_api, count=1, session_actions=[item("tap", 0)])
    tapped = (await send(baby_api, row["id"], item("tap", 1))).json()
    edit = await baby_api.client.patch(f"{API}/records/{row['id']}", headers=GEN, json={
        "revision": tapped["revision"], "body": "Felt strong", "data": {"count": 9, "session_actions": []},
    })
    assert edit.status_code == 200, edit.text
    assert edit.json()["data"]["count"] == 2 and edit.json()["body"] == "Felt strong"
    assert len(edit.json()["data"]["session_actions"]) == 2


@needs_database
async def test_actions_are_scoped_and_bounded(baby_api):
    c = baby_api.client
    row = await create(baby_api, count=1, session_actions=[item("tap", 0)])
    url = f"{API}/records/{row['id']}/session-action"
    tap = {"action_id": str(uuid4()), "action": "tap", "at": at(1)}
    assert (await c.post(url, headers={**GEN, "X-Test-Owner": "other"}, json=tap)).status_code == 404
    assert (await c.post(url, json=tap)).status_code == 422  # No generation.
    for bad in (
        {**tap, "target": str(uuid4())},
        {"action_id": tap["action_id"], "action": "undo", "at": at(1)},
        {"action_id": tap["action_id"], "action": "start", "at": at(1)},
        {**tap, "at": (datetime.now(UTC) + timedelta(days=2)).isoformat()},
    ):
        assert (await c.post(url, headers=GEN, json=bad)).status_code == 422
    # Other kinds, and a count from before taps had identities, have nothing to add to.
    diaper = await create(baby_api, "diaper", type="wet")
    assert (await send(baby_api, diaper["id"], item("tap", 1))).status_code == 409
    counted = await create(baby_api, count=4)
    assert (await send(baby_api, counted["id"], item("tap", 1))).status_code == 409
    many = [item("tap", number % 60) for number in range(1000)]
    full = await create(baby_api, count=1000, session_actions=many)
    assert full["data"]["count"] == 1000
    assert (await send(baby_api, full["id"], item("tap", 1))).status_code == 422
