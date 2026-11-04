"""GET /care/summary: per-day totals and calendar dots, on the parent's own calendar."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.domains.baby import router as baby_router
from app.domains.baby.stats import MAX_CUSTOM_DAYS, custom_days, summarize
from tests import test_baby_integration as shared

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
API = "/api/v1/baby"
GEN = shared.GEN
NOW = datetime(2026, 11, 4, 10, 0, tzinfo=UTC)  # 20:00 on Nov 4 in Guam.


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(baby_router, "now", lambda: NOW)


async def log(baby_api, kind, at, *, child_id=None, owner="owner", **data):
    body = shared.payload(kind, occurred_at=at, child_id=child_id, data=data)
    headers = {**GEN, "X-Test-Owner": owner}
    response = await baby_api.client.post(f"{API}/records", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def summary(baby_api, first, last, **params):
    response = await baby_api.client.get(f"{API}/care/summary", params={"from": first, "to": last, **params})
    assert response.status_code == 200, response.text
    return response.json()


def by_date(result):
    return {day["date"]: day for day in result["days"]}


@needs_database
async def test_each_day_names_its_sleeps_so_a_phone_can_swap_one(baby_api, frozen):
    night = await log(baby_api, "sleep", "2026-11-01T22:00:00+10:00", end_at="2026-11-02T02:00:00+10:00")
    nap = await log(baby_api, "sleep", "2026-11-02T01:00:00+10:00", end_at="2026-11-02T03:00:00+10:00")
    await log(baby_api, "sleep", "2026-11-02T10:00:00+10:00")  # Still going: no span yet.
    days = by_date(await summary(baby_api, "2026-11-01", "2026-11-02"))
    assert days["2026-11-01"]["sleep"]["spans"] == [
        {"record_id": night["id"], "from": "2026-11-01T12:00:00+00:00", "to": "2026-11-01T14:00:00+00:00"}
    ]
    # Overlaps stay apart here, though the total counts the time once.
    assert sorted(span["record_id"] for span in days["2026-11-02"]["sleep"]["spans"]) == sorted([night["id"], nap["id"]])
    assert days["2026-11-02"]["sleep"]["total_minutes"] == 180


@needs_database
async def test_totals_and_dots_per_day(baby_api, frozen):
    await log(baby_api, "feeding", "2026-11-01T08:00:00+10:00", method="breast", side="left", duration_minutes=20)
    await log(baby_api, "feeding", "2026-11-01T12:00:00+10:00", method="bottle", amount=4, unit="oz")
    await log(baby_api, "diaper", "2026-11-01T09:00:00+10:00", type="both")
    await log(baby_api, "diaper", "2026-11-02T09:00:00+10:00", type="wet")
    await log(baby_api, "journal", "2026-11-03T09:00:00+10:00")
    result = await summary(baby_api, "2026-11-01", "2026-11-03")
    days = by_date(result)
    assert list(days) == ["2026-11-01", "2026-11-02", "2026-11-03"]
    first = days["2026-11-01"]
    assert first["dots"] == ["feeding", "diaper"] and first["partial"] is False
    assert first["feeding"]["count"] == 2 and first["feeding"]["breast_minutes"] == 20
    assert first["feeding"]["bottle_oz"] == 4
    assert first["diapers"] == {"count": 1, "pee": 1, "poo": 1, "dry": 0}
    assert days["2026-11-02"]["dots"] == ["diaper"]
    # A journal entry is not care; a day with nothing logged has no dots and no invented zeros.
    assert days["2026-11-03"]["dots"] == []
    assert result["complete"] is True and result["feeding"]["days_logged"] == 1


@needs_database
async def test_a_sleep_crossing_midnight_is_split_and_marks_both_days(baby_api, frozen):
    await log(baby_api, "sleep", "2026-11-01T22:00:00+10:00", end_at="2026-11-02T03:00:00+10:00")
    days = by_date(await summary(baby_api, "2026-11-01", "2026-11-02"))
    assert days["2026-11-01"]["sleep"]["total_minutes"] == 120
    assert days["2026-11-02"]["sleep"]["total_minutes"] == 180
    assert days["2026-11-01"]["dots"] == days["2026-11-02"]["dots"] == ["sleep"]
    # Asking only for the second day still finds the sleep that began the night before.
    only = by_date(await summary(baby_api, "2026-11-02", "2026-11-02"))
    assert only["2026-11-02"]["sleep"]["total_minutes"] == 180 and only["2026-11-02"]["dots"] == ["sleep"]
    assert list(only) == ["2026-11-02"]


@needs_database
async def test_a_sleep_still_going_marks_the_day_it_began(baby_api, frozen):
    await log(baby_api, "sleep", "2026-11-03T22:00:00+10:00")
    days = by_date(await summary(baby_api, "2026-11-02", "2026-11-04"))
    assert days["2026-11-03"]["dots"] == ["sleep"] and days["2026-11-03"]["sleep"]["total_minutes"] == 0
    assert days["2026-11-02"]["dots"] == [] and days["2026-11-04"]["dots"] == []
    # Begun before the range: no day in it is the day it began.
    assert by_date(await summary(baby_api, "2026-11-04", "2026-11-04"))["2026-11-04"]["dots"] == []


@needs_database
async def test_days_follow_the_profile_time_zone(baby_api, frozen):
    # 08:00 on Nov 1 in Guam is 15:00 on Oct 31 in Los Angeles.
    await log(baby_api, "diaper", "2026-11-01T08:00:00+10:00", type="wet")
    guam = by_date(await summary(baby_api, "2026-10-31", "2026-11-02"))
    assert guam["2026-11-01"]["dots"] == ["diaper"] and guam["2026-10-31"]["dots"] == []
    changed = await baby_api.client.patch(f"{API}/profile", headers=GEN, json={"timezone": "America/Los_Angeles"})
    assert changed.status_code == 200
    pacific = by_date(await summary(baby_api, "2026-10-31", "2026-11-02"))
    assert pacific["2026-11-01"]["dots"] == [] and pacific["2026-10-31"]["dots"] == ["diaper"]


@needs_database
async def test_today_is_partial_and_the_future_is_empty(baby_api, frozen):
    await log(baby_api, "diaper", "2026-11-04T09:00:00+10:00", type="wet")
    await log(baby_api, "diaper", "2026-11-04T23:00:00+10:00", type="wet")  # Later today than now.
    days = by_date(await summary(baby_api, "2026-11-03", "2026-11-30"))
    assert list(days) == ["2026-11-03", "2026-11-04"]
    assert days["2026-11-04"]["partial"] is True and days["2026-11-04"]["diapers"]["count"] == 1
    future = await summary(baby_api, "2026-12-01", "2026-12-31")
    assert future["days"] == [] and future["complete"] is True and future["feeding"]["count"] == 0


@needs_database
async def test_scoped_to_the_child_and_the_owner(baby_api, frozen):
    c = baby_api.client
    child = str(uuid4())
    await c.post(f"{API}/children", headers=GEN, json={"id": child, "name": "Noa"})
    moment = "2026-11-01T09:00:00+10:00"
    await log(baby_api, "diaper", moment, child_id=child, type="wet")
    await log(baby_api, "diaper", moment, type="dirty")
    await log(baby_api, "diaper", moment, owner="other", type="dry")
    own = by_date(await summary(baby_api, "2026-11-01", "2026-11-01", child_id=child))
    assert own["2026-11-01"]["diapers"] == {"count": 1, "pee": 1, "poo": 0, "dry": 0}
    loose = by_date(await summary(baby_api, "2026-11-01", "2026-11-01"))
    assert loose["2026-11-01"]["diapers"] == {"count": 1, "pee": 0, "poo": 1, "dry": 0}
    foreign = await c.get(
        f"{API}/care/summary",
        params={"from": "2026-11-01", "to": "2026-11-01", "child_id": child},
        headers={"X-Test-Owner": "other"},
    )
    assert foreign.status_code == 404
    missing = await c.get(f"{API}/care/summary", params={"from": "2026-11-01", "to": "2026-11-01", "child_id": str(uuid4())})
    assert missing.status_code == 404


@needs_database
async def test_unknown_end_feeds_count_without_minutes(baby_api, frozen):
    def started(minute):
        return {"id": str(uuid4()), "action": "start", "at": f"2026-11-01T08:{minute:02d}:00+10:00", "side": "left"}

    await log(baby_api, "feeding", "2026-11-01T08:00:00+10:00", method="breast", actions=[started(0)])
    await log(baby_api, "feeding", "2026-11-01T08:30:00+10:00", method="breast", actions=[started(30)])
    result = await summary(baby_api, "2026-11-01", "2026-11-01")
    assert result["days"][0]["feeding"]["count"] == 2 and result["days"][0]["feeding"]["breast_minutes"] == 0
    assert result["feeding"]["unknown_end_feeds"] == 1


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-11-02", "to": "2026-11-01"},
        {"from": "2026-01-01", "to": "2026-11-01"},
        {"from": "2026-11-01"},
        {"to": "2026-11-01"},
        {"from": "yesterday", "to": "2026-11-01"},
    ],
)
@needs_database
async def test_unusable_ranges_are_refused(baby_api, frozen, params):
    assert (await baby_api.client.get(f"{API}/care/summary", params=params)).status_code == 422


@needs_database
async def test_the_longest_range_is_allowed_and_one_more_day_is_not(baby_api, frozen):
    last = NOW.date() - timedelta(days=1)
    first = last - timedelta(days=MAX_CUSTOM_DAYS - 1)
    assert len((await summary(baby_api, first.isoformat(), last.isoformat()))["days"]) == MAX_CUSTOM_DAYS
    over = (first - timedelta(days=1)).isoformat()
    response = await baby_api.client.get(f"{API}/care/summary", params={"from": over, "to": last.isoformat()})
    assert response.status_code == 422


def test_a_kind_added_to_care_rows_is_not_counted_as_a_feed():
    # The extension point: a later kind must not fall through to feeding before it has a branch.
    zone = ZoneInfo("Pacific/Guam")
    row = SimpleNamespace(id=uuid4(), kind="contraction", occurred_at=NOW - timedelta(days=1), data={})
    window = custom_days(NOW.date() - timedelta(days=1), NOW.date() - timedelta(days=1), zone, NOW)
    assert summarize([row], window, zone)["feeding"]["count"] == 0
