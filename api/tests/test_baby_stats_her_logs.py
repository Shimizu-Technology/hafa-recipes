"""Her own logs on Stats: how many, and the newest exactly as she typed it. No ranges, no readings."""

from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.domains.baby.moves import HER_LOG_LABELS
from app.domains.baby.stats import add_own_logs, custom_days, summarize
from tests import test_baby_integration as shared
from tests.test_baby_care_summary import (  # noqa: F401
    API,
    GEN,
    NOW,
    allow_new_kinds,
    frozen,
    make_child,
    stats,
)

baby_api = shared.baby_api
zone = ZoneInfo("Pacific/Guam")
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


def log(label, title, at):
    return SimpleNamespace(data={"label": label}, title=title, occurred_at=at)


def added(rows, first=1, last=0):
    window = custom_days(NOW.date() - timedelta(days=first), NOW.date() - timedelta(days=last), zone, NOW)
    return add_own_logs(summarize([], window, zone), rows, zone)


def test_counts_by_hand_with_the_newest_as_typed():
    today, yesterday = NOW - timedelta(hours=1), NOW - timedelta(days=1)
    rows = [log("My weight", "152 lb", today), log("Blood pressure", "118/76", today), log("My weight", "151.5 lb", yesterday)]
    result = added(rows)
    assert result["own"]["count"] == 3
    assert result["own"]["logs"] == [
        {"label": "Blood pressure", "count": 1, "latest_title": "118/76", "latest_at": today.astimezone(zone).isoformat()},
        {"label": "My weight", "count": 2, "latest_title": "152 lb", "latest_at": today.astimezone(zone).isoformat()},
    ]
    assert [day["own"]["count"] for day in result["days"]] == [1, 2]


def test_a_day_is_the_parents_calendar_day():
    late = NOW.astimezone(zone).replace(hour=0, minute=30)
    result = added([log("My weight", "150", late), log("My weight", "150", late - timedelta(hours=1))])
    assert [day["own"]["count"] for day in result["days"]] == [1, 1]


def test_says_nothing_about_a_number():
    result = added([log("Blood pressure", "190/120", NOW - timedelta(hours=1))])
    assert set(result["own"]["logs"][0]) == {"label", "count", "latest_title", "latest_at"}
    for word in ("high", "low", "normal", "range", "flag", "risk"):
        assert word not in str(result["own"]).lower()


def test_nothing_logged_is_an_empty_list():
    result = added([])
    assert result["own"] == {"count": 0, "logs": []}
    assert all(day["own"] == {"count": 0} for day in result["days"])


async def own_log(baby_api, label, title, *, at="2026-11-03T10:00:00+10:00", headers=None, child_id=None):
    body = {**shared.payload("custom", title=title, occurred_at=at, data={"label": label}), "child_id": child_id}
    response = await baby_api.client.post(f"{API}/records", headers={**GEN, "X-Baby-Client": "2", **(headers or {})}, json=body)
    assert response.status_code == 200, response.text


@needs_database
async def test_the_route_counts_her_logs_and_only_hers(baby_api, frozen):  # noqa: F811
    await allow_new_kinds(baby_api)
    child = await make_child(baby_api)
    for label in sorted(HER_LOG_LABELS):
        await own_log(baby_api, label, f"Typed {label}")
    await own_log(baby_api, "My weight", "Newer", at="2026-11-03T12:00:00+10:00")
    # None of these are hers: a baby's log under the same label, a label she made up, and someone else's.
    await own_log(baby_api, "My weight", "The baby's", child_id=child)
    await own_log(baby_api, "Walked", "Walked")
    await own_log(baby_api, "My weight", "Someone else's", headers={"X-Test-Owner": "other"})
    for params in ({"child_id": child}, {}):
        result = await stats(baby_api, **params)
        by_label = {item["label"]: item for item in result["own"]["logs"]}
        assert set(by_label) == set(HER_LOG_LABELS)
        assert result["own"]["count"] == 5
        assert by_label["My weight"]["count"] == 2 and by_label["My weight"]["latest_title"] == "Newer"
        assert sum(day["own"]["count"] for day in result["days"]) == 5


@needs_database
async def test_everything_older_clients_read_is_unchanged(baby_api, frozen):  # noqa: F811
    await allow_new_kinds(baby_api)
    child = await make_child(baby_api)
    before = await stats(baby_api, child_id=child)
    await own_log(baby_api, "My weight", "152")
    after = await stats(baby_api, child_id=child)
    strip = lambda answer: {  # noqa: E731
        **{key: value for key, value in answer.items() if key != "own"},
        "days": [{key: value for key, value in day.items() if key != "own"} for day in answer["days"]],
    }
    assert strip(before) == strip(after)
    # A build with no Stats still has no route.
    assert (await baby_api.client.get(f"{API}/care/stats", headers={"X-Baby-Client": "1"})).status_code == 404


@needs_database
async def test_a_deleted_log_stops_counting(baby_api, frozen):  # noqa: F811
    await allow_new_kinds(baby_api)
    body = {**shared.payload("custom", title="152", occurred_at="2026-11-03T10:00:00+10:00", data={"label": "My weight"}), "child_id": None, "id": str(uuid4())}
    saved = await baby_api.client.post(f"{API}/records", headers={**GEN, "X-Baby-Client": "2"}, json=body)
    assert saved.status_code == 200, saved.text
    assert (await stats(baby_api))["own"]["count"] == 1
    gone = await baby_api.client.delete(f"{API}/records/{body['id']}", params={"revision": saved.json()["revision"]}, headers={**GEN, "X-Baby-Client": "2"})
    assert gone.status_code in (200, 204), gone.text
    assert (await stats(baby_api))["own"]["count"] == 0
