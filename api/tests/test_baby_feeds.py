"""The feed reducer and feed-action: one result whatever order the taps arrive in."""

import asyncio
from datetime import UTC, datetime, timedelta
from itertools import permutations
from types import SimpleNamespace
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

from app.domains.baby.feeds import reduce_feed, retimed, with_derived
from app.domains.baby.schemas import RecordCreate
from app.domains.baby.stats import custom_days, next_side, summarize
from tests import test_baby_integration as shared

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
GEN = shared.GEN
API = "/api/v1/baby"
GUAM = ZoneInfo("Pacific/Guam")


def at(minute, hour=8):
    return f"2026-11-01T{hour:02d}:{minute:02d}:00+10:00"


def action(kind, minute, side=None, identifier=None, hour=8):
    item = {"id": str(identifier or uuid4()), "action": kind, "at": at(minute, hour)}
    return {**item, "side": side} if side else item


FEED = [
    action("start", 0, "left"),
    action("switch", 10, "right"),
    action("switch", 20, "left"),
    action("finish", 30),
]


def test_every_ordering_gives_one_result():
    results = [reduce_feed(list(order)) for order in permutations(FEED)]
    assert all(result == results[0] for result in results)
    stored = [with_derived({"method": "breast", "actions": list(order)}) for order in permutations(FEED)]
    assert all(item == stored[0] for item in stored)
    assert results[0] == {
        "finished": True,
        "segments": [
            {"side": "left", "started_at": at(0), "ended_at": at(10)},
            {"side": "right", "started_at": at(10), "ended_at": at(20)},
            {"side": "left", "started_at": at(20), "ended_at": at(30)},
        ],
        "side": "both",
        "started_at": at(0),
        "started_side": "left",
        "end_at": at(30),
        "duration_minutes": 30,
    }


def test_the_earliest_finish_ends_it_and_later_actions_do_nothing():
    early, late = action("finish", 15), action("finish", 40)
    after = action("switch", 20, "right")
    for order in permutations([action("start", 0, "left"), late, after, early]):
        result = reduce_feed(list(order))
        assert result["end_at"] == at(15) and result["duration_minutes"] == 15
        assert result["side"] == "left" and len(result["segments"]) == 1
    # They are kept, so a retried tap is still recognized.
    assert len(with_derived({"method": "breast", "actions": [FEED[0], early, after]})["actions"]) == 3


def test_a_switch_before_the_finish_applies_even_if_it_arrived_after():
    start, finish, switch = FEED[0], action("finish", 30), action("switch", 10, "right")
    assert reduce_feed([start, finish])["side"] == "left"
    assert reduce_feed([start, finish, switch])["side"] == "both"
    assert reduce_feed([start, finish, switch])["duration_minutes"] == 30


def test_timestamp_ties_break_by_id_and_offsets_compare_as_instants():
    low, high = UUID(int=1), UUID(int=2)
    finish_first = [action("start", 0, "left"), action("finish", 10, identifier=low), action("switch", 10, "right", high)]
    switch_first = [action("start", 0, "left"), action("switch", 10, "right", low), action("finish", 10, identifier=high)]
    for order in permutations(finish_first):
        assert reduce_feed(list(order))["side"] == "left"
    for order in permutations(switch_first):
        assert reduce_feed(list(order))["side"] == "both"
    # 22:10 UTC on the 31st is 08:10 in Guam, so it sorts before the 08:20 finish.
    switch = {"id": str(uuid4()), "action": "switch", "at": "2026-10-31T22:10:00Z", "side": "right"}
    assert reduce_feed([action("start", 0, "left"), action("finish", 20), switch])["side"] == "both"


def test_unfinished_feeds_have_no_end_or_duration():
    result = reduce_feed(FEED[:3])
    assert (result["finished"], result["end_at"], result["duration_minutes"]) == (False, None, None)
    assert result["side"] == "both" and result["segments"][-1] == {
        "side": "left", "started_at": at(20), "ended_at": None,
    }
    assert reduce_feed([FEED[0]])["side"] == "left"
    # Which unfinished state it is depends on other feeds; deriving does not decide that.
    assert with_derived({"method": "breast", "state": "unknown_end", "actions": [FEED[0]]})["state"] == "unknown_end"
    assert with_derived({"method": "breast", "state": "finished", "actions": [FEED[0]]})["state"] == "running"


def test_finish_with_no_side_has_no_duration_or_inherited_side():
    assert reduce_feed([action("finish", 10)])["duration_minutes"] is None
    data = with_derived({"method": "breast", "side": "right", "actions": [action("finish", 10)]})
    assert (data["state"], data["side"], data["end_at"]) == ("finished", None, at(10))


def test_taps_with_clocks_out_of_order_store_one_side_whatever_arrives_first():
    start, switch, finish = action("start", 5, "left"), action("switch", 2, "right"), action("finish", 1)
    results = set()
    for order in permutations([switch, finish]):
        data = {"method": "breast", "actions": [start]}
        for item in order:
            data = with_derived({**data, "actions": [*data["actions"], item]})
        results.add(data["side"])
    assert results == {"left"}


def test_clock_differences_between_phones_still_give_one_result():
    switch, start, finish = action("switch", 2, "right"), action("start", 5, "left"), action("finish", 12)
    results = [reduce_feed(list(order)) for order in permutations([switch, start, finish])]
    assert all(result == results[0] for result in results)
    assert results[0]["started_side"] == "left" and results[0]["started_at"] == at(5)
    assert results[0]["duration_minutes"] == 10 and results[0]["side"] == "both"
    # A finish before the start, by the clocks: finished, with no time to report.
    assert reduce_feed([action("finish", 1), start])["duration_minutes"] is None


def test_a_finish_days_later_is_not_a_duration_and_stays_valid():
    start = {"id": str(uuid4()), "action": "start", "at": "2026-10-20T08:00:00+10:00", "side": "left"}
    finish = {"id": str(uuid4()), "action": "finish", "at": "2026-10-25T08:00:00+10:00"}
    assert reduce_feed([start, finish])["duration_minutes"] is None
    body = RecordCreate.model_validate(
        {"kind": "feeding", "title": "Feed", "occurred_at": at(0), "data": {"method": "breast", "actions": [start, finish]}}
    )
    assert RecordCreate.model_validate(body.model_dump(mode="json")).data == body.data


def test_retiming_moves_only_the_start():
    moved = retimed(FEED, at(55, 7))
    assert reduce_feed(moved)["started_at"] == at(55, 7) and reduce_feed(moved)["duration_minutes"] == 35
    assert {item["id"]: item["at"] for item in moved}[FEED[1]["id"]] == at(10)
    # The same instant in another offset, as an edit screen resends it, rewrites nothing.
    assert retimed(FEED, "2026-10-31T22:00:00+00:00") == FEED


def test_a_phone_with_a_wrong_clock_is_refused():
    late = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    with pytest.raises(ValidationError):
        RecordCreate.model_validate(
            {"kind": "feeding", "title": "Feed", "occurred_at": at(0), "data": {"method": "breast", "actions": [
                {"id": str(uuid4()), "action": "start", "at": late, "side": "left"},
            ]}}
        )


@pytest.mark.parametrize(
    ("data", "side"),
    [
        ({"method": "breast", "side": "both", "actions": FEED}, "right"),
        ({"method": "breast", "side": "both", "actions": [action("start", 0, "right")]}, "left"),
        ({"method": "breast", "side": "both"}, None),
        ({"method": "breast", "side": "left"}, "right"),
        ({"method": "breast", "side": "left", "actions": "unusable"}, "right"),
        ({"method": "breast", "side": "left", "actions": [{"at": "soon"}]}, "right"),
        ({"method": "breast", "side": "left", "actions": 7}, "right"),
        ({"method": "bottle", "side": "left", "actions": FEED}, None),
    ],
)
def test_next_side_reads_the_side_the_feed_started_on(data, side):
    assert next_side(data) == side


def test_stats_count_unknown_ends_but_not_their_minutes():
    start = datetime(2026, 11, 1, 8, tzinfo=GUAM)
    rows = [
        SimpleNamespace(id=uuid4(), kind="feeding", occurred_at=start + timedelta(hours=hour), data=data)
        for hour, data in enumerate(
            [
                {"method": "breast", "side": "left", "state": "finished", "duration_minutes": 20},
                {"method": "breast", "side": "right", "state": "unknown_end", "duration_minutes": None},
                # An unknown end never has minutes, even if something stored them.
                {"method": "breast", "side": "left", "state": "unknown_end", "duration_minutes": 99},
                {"method": "breast", "side": "both", "state": "finished", "duration_minutes": None},
                {"method": "breast", "side": "left", "state": "running", "duration_minutes": None},
            ]
        )
    ]
    window = custom_days(start.date(), start.date(), GUAM, datetime(2026, 11, 2, tzinfo=GUAM))
    feeding = summarize(rows, window, GUAM)["feeding"]
    assert feeding["count"] == 5 and feeding["breast_minutes"] == 20
    assert feeding["timed_breast_feeds"] == 1 and feeding["unknown_end_feeds"] == 2
    assert (feeding["left"], feeding["right"], feeding["both"]) == (3, 1, 1)


async def create(baby_api, side="left", minute=0, *, child_id=None, hour=8, **data):
    body = shared.payload(
        "feeding",
        occurred_at=at(minute, hour),
        child_id=child_id,
        data={"method": "breast", "actions": [action("start", minute, side, hour=hour)], **data},
    )
    response = await baby_api.client.post(f"{API}/records", headers=GEN, json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def tap(baby_api, record_id, item):
    payload = {"action_id": item["id"], **{key: value for key, value in item.items() if key != "id"}}
    return await baby_api.client.post(f"{API}/records/{record_id}/feed-action", headers=GEN, json=payload)


async def stored(baby_api, record_id):
    return (await baby_api.client.get(f"{API}/records/{record_id}")).json()


@needs_database
@pytest.mark.parametrize("order", list(permutations(range(4))), ids=lambda order: "".join(map(str, order)))
async def test_endpoint_gives_one_result_for_every_arrival_order(baby_api, order):
    body = shared.payload("feeding", occurred_at=at(0), data={"method": "breast", "state": "running", "side": "left"})
    assert (await baby_api.client.post(f"{API}/records", headers=GEN, json=body)).status_code == 200
    for position in order:
        response = await tap(baby_api, body["id"], FEED[position])
        assert response.status_code == 200, response.text
    row = await stored(baby_api, body["id"])
    assert row["revision"] == 5
    # Which revision each tap made is the one thing that does follow arrival order.
    made = {item.pop("revision") for item in row["data"]["actions"]}
    assert made == {2, 3, 4, 5}
    assert row["data"] == {
        "method": "breast", "amount": None, "unit": None, "side": "both", "duration_minutes": 30,
        "state": "finished", "actions": FEED, "end_at": at(30),
    }
    assert datetime.fromisoformat(row["occurred_at"]) == datetime.fromisoformat(at(0))


@needs_database
async def test_retried_taps_change_nothing_and_a_changed_retry_is_refused(baby_api):
    row = await create(baby_api)
    item = action("switch", 5, "right")
    first = (await tap(baby_api, row["id"], item)).json()
    assert first["revision"] == 2 and first["data"]["side"] == "both"
    assert (await tap(baby_api, row["id"], item)).json() == first
    same_instant = {**item, "at": "2026-10-31T22:05:00Z"}
    assert (await tap(baby_api, row["id"], same_instant)).json()["revision"] == 2
    for changed in ({**item, "side": "left"}, {**item, "at": at(6)}, {"id": item["id"], "action": "finish", "at": at(5)}):
        assert (await tap(baby_api, row["id"], changed)).status_code == 409
    assert (await stored(baby_api, row["id"]))["revision"] == 2


@needs_database
async def test_a_replay_says_which_revision_the_tap_made_not_where_the_row_is(baby_api):
    row = await create(baby_api)
    mine = action("switch", 5, "right")
    first = (await tap(baby_api, row["id"], mine)).json()
    assert first["revision"] == 2
    # Another phone writes after it. The first phone never got its answer, and retries.
    edit = await baby_api.client.patch(
        f"{API}/records/{row['id']}", headers=GEN, json={"revision": 2, "body": "From the other phone"}
    )
    assert edit.json()["revision"] == 3
    replay = (await tap(baby_api, row["id"], mine)).json()
    assert replay["revision"] == 3 and replay["body"] == "From the other phone"
    made = {item["id"]: item.get("revision") for item in replay["data"]["actions"]}
    assert made[mine["id"]] == 2


@needs_database
async def test_a_tap_cannot_claim_its_own_revision(baby_api):
    row = await create(baby_api)
    mine = {**action("switch", 5, "right"), "revision": 99}
    response = (await tap(baby_api, row["id"], mine)).json()
    assert {item["id"]: item.get("revision") for item in response["data"]["actions"]}[mine["id"]] == 2


@needs_database
async def test_a_create_with_a_start_replays(baby_api):
    start = action("start", 0, "left")
    body = shared.payload("feeding", occurred_at=at(0), data={"method": "breast", "actions": [start]})
    first = await baby_api.client.post(f"{API}/records", headers=GEN, json=body)
    assert first.json()["data"]["state"] == "running" and first.json()["revision"] == 1
    await tap(baby_api, body["id"], action("finish", 5))
    replay = await baby_api.client.post(f"{API}/records", headers=GEN, json=body)
    assert replay.status_code == 200 and replay.json()["revision"] == 2


@needs_database
@pytest.mark.parametrize("reverse", [False, True], ids=["in order", "reversed"])
async def test_the_newest_start_runs_whatever_order_they_arrive(baby_api, reverse):
    minutes = [0, 20, 40]
    if reverse:
        minutes.reverse()
    rows = {minute: await create(baby_api, minute=minute) for minute in minutes}
    assert (await stored(baby_api, rows[40]["id"]))["data"]["state"] == "running"
    for minute in (0, 20):
        data = (await stored(baby_api, rows[minute]["id"]))["data"]
        assert data["state"] == "unknown_end"
        assert data.get("end_at") is None and data["duration_minutes"] is None


@needs_database
async def test_equal_starts_break_by_record_id(baby_api):
    rows = [await create(baby_api) for _ in range(3)]
    highest = max(rows, key=lambda row: UUID(row["id"]))
    for row in rows:
        expected = "running" if row["id"] == highest["id"] else "unknown_end"
        assert (await stored(baby_api, row["id"]))["data"]["state"] == expected


@needs_database
async def test_each_child_and_no_child_have_their_own_running_feed(baby_api):
    c = baby_api.client
    children = [str(uuid4()), str(uuid4())]
    for identifier in children:
        await c.post(f"{API}/children", headers=GEN, json={"id": identifier, "name": "Noa"})
    first = await create(baby_api, child_id=children[0])
    second = await create(baby_api, child_id=children[1], minute=5)
    loose = await create(baby_api, minute=10)
    for row in (first, second, loose):
        assert (await stored(baby_api, row["id"]))["data"]["state"] == "running"
    # Another account's feed changes nothing here.
    other = shared.payload("feeding", occurred_at=at(50), data={"method": "breast", "actions": [action("start", 50, "left")]})
    await c.post(f"{API}/records", headers={**GEN, "X-Test-Owner": "other"}, json=other)
    assert (await stored(baby_api, loose["id"]))["data"]["state"] == "running"


@needs_database
async def test_a_late_finish_still_finishes_an_unknown_end_feed(baby_api):
    old, new = await create(baby_api), await create(baby_api, minute=30)
    assert (await stored(baby_api, old["id"]))["data"]["state"] == "unknown_end"
    late = await tap(baby_api, old["id"], action("finish", 15))
    assert late.json()["data"]["state"] == "finished" and late.json()["data"]["duration_minutes"] == 15
    # And does not disturb the feed that really is running.
    assert (await stored(baby_api, new["id"]))["data"]["state"] == "running"


@needs_database
async def test_a_finished_newer_feed_still_ends_an_older_running_one(baby_api):
    old, new = await create(baby_api), await create(baby_api, minute=30)
    await tap(baby_api, new["id"], action("finish", 45))
    assert (await stored(baby_api, old["id"]))["data"]["state"] == "unknown_end"


@needs_database
async def test_undoing_the_newest_feed_restores_the_one_before(baby_api):
    old, new = await create(baby_api), await create(baby_api, minute=30)
    assert (await stored(baby_api, old["id"]))["revision"] == 2
    gone = await baby_api.client.delete(f"{API}/records/{new['id']}", headers=GEN, params={"revision": new["revision"]})
    assert gone.status_code == 204
    restored = await stored(baby_api, old["id"])
    assert restored["data"]["state"] == "running" and restored["revision"] == 3


def ahead(minutes):
    return (datetime.now(UTC) + timedelta(minutes=minutes)).isoformat()


async def running_now(baby_api, minutes_ago=5):
    started = (datetime.now(UTC) - timedelta(minutes=minutes_ago)).isoformat()
    body = shared.payload("feeding", occurred_at=started, data={
        "method": "breast", "actions": [{"id": str(uuid4()), "action": "start", "at": started, "side": "left"}],
    })
    response = await baby_api.client.post(f"{API}/records", headers=GEN, json=body)
    assert response.status_code == 200, response.text
    return response.json()


@needs_database
@pytest.mark.parametrize("data", [
    {"method": "breast", "side": "left", "duration_minutes": 10},
    {"method": "breast", "state": "running", "side": "left"},
], ids=["finished", "running"])
async def test_a_feed_dated_ahead_neither_runs_nor_ends_the_one_that_does(baby_api, data):
    running = await running_now(baby_api)
    body = shared.payload("feeding", occurred_at=ahead(180), data=data)
    created = await baby_api.client.post(f"{API}/records", headers=GEN, json=body)
    assert created.status_code == 200, created.text
    assert (await stored(baby_api, running["id"]))["data"]["state"] == "running"
    # It's left as it was until its time comes.
    assert (await stored(baby_api, body["id"]))["data"].get("state") == data.get("state")


@needs_database
async def test_a_clock_a_little_ahead_is_still_the_newest_feed(baby_api):
    running = await running_now(baby_api)
    start = ahead(2)
    body = shared.payload("feeding", occurred_at=start, data={
        "method": "breast", "actions": [{"id": str(uuid4()), "action": "start", "at": start, "side": "right"}],
    })
    assert (await baby_api.client.post(f"{API}/records", headers=GEN, json=body)).status_code == 200
    assert (await stored(baby_api, running["id"]))["data"]["state"] == "unknown_end"
    assert (await stored(baby_api, body["id"]))["data"]["state"] == "running"


@needs_database
async def test_a_both_tap_is_finished_with_no_actions_and_ends_a_running_feed(baby_api):
    c = baby_api.client
    running = await create(baby_api)
    both = shared.payload("feeding", occurred_at=at(30), data={"method": "breast", "side": "both", "state": "finished"})
    saved = (await c.post(f"{API}/records", headers=GEN, json=both)).json()
    assert saved["data"]["state"] == "finished" and saved["data"]["duration_minutes"] is None
    assert "actions" not in saved["data"] and saved["revision"] == 1
    assert (await stored(baby_api, running["id"]))["data"]["state"] == "unknown_end"
    assert (await tap(baby_api, both["id"], action("switch", 35, "left"))).status_code == 409
    assert (await stored(baby_api, both["id"]))["revision"] == 1


@needs_database
async def test_a_bottle_does_not_end_a_running_feed(baby_api):
    running = await create(baby_api)
    bottle = shared.payload("feeding", occurred_at=at(30), data={"method": "bottle", "amount": 2, "unit": "oz"})
    assert (await baby_api.client.post(f"{API}/records", headers=GEN, json=bottle)).status_code == 200
    assert (await stored(baby_api, running["id"]))["data"]["state"] == "running"


@needs_database
@pytest.mark.parametrize(
    ("kind", "data"),
    [
        ("feeding", {"method": "breast", "side": "left", "duration_minutes": 15}),
        ("feeding", {"method": "bottle", "amount": 4, "unit": "oz"}),
        ("diaper", {"type": "wet"}),
    ],
)
async def test_only_timed_feeds_take_actions(baby_api, kind, data):
    body = shared.payload(kind, occurred_at=at(0), data=data)
    await baby_api.client.post(f"{API}/records", headers=GEN, json=body)
    assert (await tap(baby_api, body["id"], action("finish", 5))).status_code == 409
    assert (await stored(baby_api, body["id"]))["revision"] == 1


@needs_database
async def test_actions_are_scoped_and_bounded(baby_api):
    c = baby_api.client
    row = await create(baby_api)
    url = f"{API}/records/{row['id']}/feed-action"
    item = {"action_id": str(uuid4()), "action": "finish", "at": at(5)}
    assert (await c.post(url, headers={**GEN, "X-Test-Owner": "other"}, json=item)).status_code == 404
    assert (await c.post(url, json=item)).status_code == 422  # No generation.
    assert (await c.post(url, headers={"X-Baby-Generation": "9"}, json=item)).status_code == 409
    for bad in (
        {**item, "side": "left"},
        {"action_id": item["action_id"], "action": "switch", "at": at(5)},
        {"action_id": item["action_id"], "action": "start", "at": at(5), "side": "both"},
        {"action_id": item["action_id"], "action": "finish", "at": "2026-11-01T08:05:00"},
        {"id": item["action_id"], "action": "finish", "at": at(5)},
    ):
        assert (await c.post(url, headers=GEN, json=bad)).status_code == 422
    for number in range(99):
        extra = {"id": str(uuid4()), "action": "switch", "at": at(number % 60), "side": "right"}
        assert (await tap(baby_api, row["id"], extra)).status_code == 200
    extra = {"id": str(uuid4()), "action": "switch", "at": at(1), "side": "right"}
    assert (await tap(baby_api, row["id"], extra)).status_code == 422


@needs_database
async def test_ordinary_edits_cannot_lose_or_rewrite_taps(baby_api):
    c = baby_api.client
    row = await create(baby_api)
    url = f"{API}/records/{row['id']}"
    assert (await tap(baby_api, row["id"], action("switch", 5, "right"))).status_code == 200
    # Stale editor: the tap moved the revision on.
    assert (await c.patch(url, headers=GEN, json={"revision": 1, "title": "Stale"})).status_code == 409
    # Build 32 sends back everything it read, old fields and unchanged additions alike.
    current = await stored(baby_api, row["id"])
    spread = await c.patch(url, headers=GEN, json={
        "revision": current["revision"], "title": "Morning", "occurred_at": current["occurred_at"],
        "data": current["data"],
    })
    assert spread.status_code == 200 and spread.json()["data"] == current["data"]
    # A client omitting them keeps them, and cannot replace them.
    omitted = await c.patch(url, headers=GEN, json={
        "revision": 3, "data": {"method": "breast", "actions": [action("finish", 9)], "state": "finished"},
    })
    assert omitted.status_code == 200
    assert omitted.json()["data"]["actions"] == current["data"]["actions"]
    assert omitted.json()["data"]["state"] == "running" and omitted.json()["data"]["side"] == "both"
    assert (await c.patch(url, headers=GEN, json={"revision": 4, "data": None})).status_code == 422


@needs_database
async def test_concurrent_edits_and_taps_lose_nothing(baby_api):
    c = baby_api.client
    for attempt in range(10):
        row = await create(baby_api, minute=attempt)
        url = f"{API}/records/{row['id']}"
        item = action("switch", attempt + 1, "right")
        edit, tapped = await asyncio.gather(
            c.patch(url, headers=GEN, json={"revision": 1, "title": "Edited", "data": {"method": "breast", "side": "left"}}),
            tap(baby_api, row["id"], item),
        )
        assert tapped.status_code == 200
        assert edit.status_code in {200, 409}
        final = await stored(baby_api, row["id"])
        assert [entry["id"] for entry in final["data"]["actions"]] == [
            row["data"]["actions"][0]["id"], item["id"],
        ]
        assert final["data"]["side"] == "both"
        assert final["revision"] == (3 if edit.status_code == 200 else 2)
        assert final["title"] == ("Edited" if edit.status_code == 200 else row["title"])


@needs_database
async def test_correcting_the_time_moves_the_start_and_reorders_the_child(baby_api):
    c = baby_api.client
    first, second = await create(baby_api), await create(baby_api, minute=30)
    moved = await c.patch(f"{API}/records/{first['id']}", headers=GEN, json={"revision": 2, "occurred_at": at(45)})
    assert moved.status_code == 200
    assert reduce_feed(moved.json()["data"]["actions"])["started_at"] == at(45)
    assert datetime.fromisoformat(moved.json()["occurred_at"]) == datetime.fromisoformat(at(45))
    assert moved.json()["data"]["state"] == "running"
    assert (await stored(baby_api, second["id"]))["data"]["state"] == "unknown_end"
    finished = await tap(baby_api, first["id"], action("finish", 55))
    assert finished.json()["data"]["duration_minutes"] == 10


@needs_database
async def test_a_hand_correction_wins_over_taps(baby_api):
    c = baby_api.client
    row = await create(baby_api)
    url = f"{API}/records/{row['id']}"
    corrected = await c.patch(url, headers=GEN, json={
        "revision": 1, "data": {"method": "breast", "side": "left", "duration_minutes": 20},
    })
    assert corrected.status_code == 200
    data = corrected.json()["data"]
    assert (data["state"], data["duration_minutes"]) == ("finished", 20) and "actions" not in data
    assert (await tap(baby_api, row["id"], action("finish", 5))).status_code == 409
    assert (await stored(baby_api, row["id"]))["data"]["duration_minutes"] == 20


@needs_database
async def test_resending_the_stored_duration_is_not_a_hand_correction(baby_api):
    c = baby_api.client
    row = await create(baby_api)
    finish = {"id": str(uuid4()), "action": "finish", "at": "2026-11-01T08:12:21+10:00"}
    finished = (await tap(baby_api, row["id"], finish)).json()
    assert finished["data"]["duration_minutes"] == 12.35
    url = f"{API}/records/{row['id']}"
    # A note edit sends back exactly what it was given.
    edit = await c.patch(url, headers=GEN, json={"revision": 2, "title": "Morning", "data": {
        "method": "breast", "side": "left", "duration_minutes": 12.35,
    }})
    assert edit.status_code == 200
    assert edit.json()["data"]["duration_minutes"] == 12.35 and len(edit.json()["data"]["actions"]) == 2
    assert edit.json()["data"]["state"] == "finished" and edit.json()["data"]["end_at"] == finish["at"]
    # Any change is a correction, even under a minute.
    changed = await c.patch(url, headers=GEN, json={"revision": 3, "data": {
        "method": "breast", "side": "left", "duration_minutes": 12.5,
    }})
    assert changed.json()["data"]["duration_minutes"] == 12.5 and "actions" not in changed.json()["data"]
    assert changed.json()["data"]["end_at"] == finish["at"]


@needs_database
async def test_moving_a_feed_or_deleting_a_child_settles_both_groups(baby_api):
    c = baby_api.client
    child = str(uuid4())
    made = (await c.post(f"{API}/children", headers=GEN, json={"id": child, "name": "Noa"})).json()
    loose = await create(baby_api)
    older = await create(baby_api, child_id=child, minute=10)
    newer = await create(baby_api, child_id=child, minute=20)
    assert (await stored(baby_api, older["id"]))["data"]["state"] == "unknown_end"
    moved = await c.patch(f"{API}/records/{newer['id']}", headers=GEN, json={"revision": 1, "child_id": None})
    assert moved.json()["data"]["state"] == "running"
    assert (await stored(baby_api, older["id"]))["data"]["state"] == "running"
    assert (await stored(baby_api, loose["id"]))["data"]["state"] == "unknown_end"
    # Detaching merges the child's feeds into the group with no child.
    gone = await c.delete(f"{API}/children/{child}", headers=GEN, params={"revision": made["revision"]})
    assert gone.status_code == 204
    assert (await stored(baby_api, older["id"]))["data"]["state"] == "unknown_end"
    assert (await stored(baby_api, newer["id"]))["data"]["state"] == "running"


@needs_database
async def test_changing_a_running_feed_to_a_bottle_drops_its_timer(baby_api):
    c = baby_api.client
    old, new = await create(baby_api), await create(baby_api, minute=30)
    changed = await c.patch(f"{API}/records/{new['id']}", headers=GEN, json={
        "revision": 1, "data": {"method": "bottle", "amount": 4, "unit": "oz"},
    })
    assert changed.status_code == 200 and not {"state", "actions", "end_at"} & set(changed.json()["data"])
    assert (await tap(baby_api, new["id"], action("finish", 40))).status_code == 409
    assert (await stored(baby_api, old["id"]))["data"]["state"] == "running"


@needs_database
async def test_last_feed_agrees_with_the_running_feed_on_a_timestamp_tie(baby_api):
    from app.domains.baby.stats import last_feed

    child = str(uuid4())
    made = await baby_api.client.post(
        f"{API}/children", headers=GEN, json={"id": child, "name": "Mia", "due_date": "2026-12-10"}
    )
    assert made.status_code in {200, 201}, made.text
    rows = [await create(baby_api, side, child_id=child) for side in ("left", "right", "left", "right")]
    running = max(rows, key=lambda row: UUID(row["id"]))
    zone = ZoneInfo("Pacific/Guam")
    async with baby_api.sessions() as db:
        latest = await last_feed(db, "owner", 1, UUID(child), zone, datetime(2030, 1, 1, tzinfo=zone))
    assert latest["side"] is None or latest["suggested_next_side"] != running["data"]["actions"][0]["side"]
