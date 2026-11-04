"""GET /events, repeats and exceptions, and the event dots on /care/summary."""

from datetime import UTC, date, datetime
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.domains.baby import router as baby_router
from app.domains.baby.events import occurrences_of
from app.domains.baby.recurrence import first_index, nth_date
from tests import test_baby_integration as shared
from tests.test_baby_events import allow_events, save

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
API = "/api/v1/baby"
V2 = {**shared.GEN, "X-Baby-Client": "2"}
GUAM = ZoneInfo("Pacific/Guam")
NEW_YORK = ZoneInfo("America/New_York")


def utc(text):
    return datetime.fromisoformat(text).astimezone(UTC)


def row(start, zone="Pacific/Guam", **data):
    return SimpleNamespace(
        id=uuid4(), occurred_at=utc(start), title="Check-up", child_id=None, revision=1,
        data={"timezone": zone, **data},
    )


def repeat(frequency, interval=1, until=None):
    return {"recurrence": {"frequency": frequency, "interval": interval, "until": until}}


def starts(event, lo, hi, zone=GUAM):
    """Local wall-clock text of each occurrence start, in order."""
    found = occurrences_of(event, utc(lo), utc(hi))
    zone = ZoneInfo(event.data["timezone"])
    return [item.start.astimezone(zone).strftime("%Y-%m-%d %H:%M") for item in sorted(found, key=lambda i: i.sort_key)]


def test_daily_and_weekly_with_intervals():
    daily = row("2026-11-01T09:00:00+10:00", **repeat("daily", 2))
    assert starts(daily, "2026-11-01T00:00:00+10:00", "2026-11-08T00:00:00+10:00") == [
        "2026-11-01 09:00", "2026-11-03 09:00", "2026-11-05 09:00", "2026-11-07 09:00",
    ]
    weekly = row("2026-11-02T09:00:00+10:00", **repeat("weekly", 2))
    assert starts(weekly, "2026-11-01T00:00:00+10:00", "2026-12-15T00:00:00+10:00") == [
        "2026-11-02 09:00", "2026-11-16 09:00", "2026-11-30 09:00", "2026-12-14 09:00",
    ]


def test_a_month_end_repeat_clamps_and_comes_back():
    monthly = row("2026-01-31T09:00:00+10:00", **repeat("monthly"))
    assert starts(monthly, "2026-01-01T00:00:00+10:00", "2026-06-01T00:00:00+10:00") == [
        "2026-01-31 09:00", "2026-02-28 09:00", "2026-03-31 09:00", "2026-04-30 09:00", "2026-05-31 09:00",
    ]
    # A leap February keeps its 29th; the clamp is from the 31st each time, never the previous date.
    assert starts(monthly, "2028-02-01T00:00:00+10:00", "2028-04-01T00:00:00+10:00") == [
        "2028-02-29 09:00", "2028-03-31 09:00",
    ]
    every_two = row("2026-01-31T09:00:00+10:00", **repeat("monthly", 2))
    assert starts(every_two, "2026-01-01T00:00:00+10:00", "2026-08-01T00:00:00+10:00") == [
        "2026-01-31 09:00", "2026-03-31 09:00", "2026-05-31 09:00", "2026-07-31 09:00",
    ]


def test_a_leap_day_yearly_repeat_uses_feb_28_in_other_years():
    yearly = row("2028-02-29T09:00:00+10:00", **repeat("yearly"))
    assert starts(yearly, "2028-01-01T00:00:00+10:00", "2033-01-01T00:00:00+10:00") == [
        "2028-02-29 09:00", "2029-02-28 09:00", "2030-02-28 09:00", "2031-02-28 09:00", "2032-02-29 09:00",
    ]
    four = row("2028-02-29T09:00:00+10:00", **repeat("yearly", 4))
    assert starts(four, "2028-01-01T00:00:00+10:00", "2037-01-01T00:00:00+10:00") == [
        "2028-02-29 09:00", "2032-02-29 09:00", "2036-02-29 09:00",
    ]


def test_until_is_the_last_day_on_the_events_own_calendar():
    # 08:00 on Jan 2 in Guam is still Jan 1 in UTC: "until Jan 2" must keep it.
    event = row("2026-12-30T08:00:00+10:00", **repeat("daily", until="2027-01-02"))
    assert starts(event, "2026-12-01T00:00:00+10:00", "2027-02-01T00:00:00+10:00") == [
        "2026-12-30 08:00", "2026-12-31 08:00", "2027-01-01 08:00", "2027-01-02 08:00",
    ]
    ends_first_day = row("2026-12-30T08:00:00+10:00", **repeat("weekly", until="2026-12-30"))
    assert len(starts(ends_first_day, "2026-12-01T00:00:00+10:00", "2027-12-01T00:00:00+10:00")) == 1


def test_a_series_begun_years_ago_is_found_without_walking_from_the_start():
    old = row("2008-03-15T09:00:00+10:00", **repeat("weekly"))
    assert starts(old, "2026-11-01T00:00:00+10:00", "2026-11-15T00:00:00+10:00") == [
        "2026-11-07 09:00", "2026-11-14 09:00",
    ]
    old_daily = row("2001-01-01T09:00:00+10:00", **repeat("daily", 3))
    assert len(starts(old_daily, "2026-11-01T00:00:00+10:00", "2026-11-30T00:00:00+10:00")) == 10
    # Starting near the range, not at the series' first date.
    assert first_index("daily", 1, date(2001, 1, 1), date(2026, 11, 1)) > 9000
    assert nth_date(date(2001, 1, 1), "daily", 1, first_index("daily", 1, date(2001, 1, 1), date(2026, 11, 1))) <= date(2026, 11, 1)
    # A range before the first date finds nothing.
    assert starts(old, "2000-01-01T00:00:00+10:00", "2008-03-15T00:00:00+10:00") == []


def test_a_nine_am_appointment_stays_at_nine_across_clock_changes():
    daily = row("2026-03-06T09:00:00-05:00", "America/New_York", **repeat("daily"))
    found = occurrences_of(daily, utc("2026-03-06T00:00:00-05:00"), utc("2026-03-11T00:00:00-04:00"))
    instants = [item.start.isoformat() for item in sorted(found, key=lambda i: i.sort_key)]
    assert instants == [  # 14:00Z in winter, 13:00Z once summer time starts on Mar 8.
        "2026-03-06T14:00:00+00:00", "2026-03-07T14:00:00+00:00", "2026-03-08T13:00:00+00:00",
        "2026-03-09T13:00:00+00:00", "2026-03-10T13:00:00+00:00",
    ]
    fall = row("2026-10-30T09:00:00-04:00", "America/New_York", **repeat("daily"))
    found = occurrences_of(fall, utc("2026-10-30T00:00:00-04:00"), utc("2026-11-03T00:00:00-05:00"))
    assert [item.start.isoformat() for item in sorted(found, key=lambda i: i.sort_key)] == [
        "2026-10-30T13:00:00+00:00", "2026-10-31T13:00:00+00:00", "2026-11-01T14:00:00+00:00",
        "2026-11-02T14:00:00+00:00",
    ]
    monthly = row("2026-02-09T09:00:00-05:00", "America/New_York", **repeat("monthly"))
    assert [i.start.isoformat() for i in sorted(occurrences_of(monthly, utc("2026-02-01T00:00:00Z"), utc("2026-05-01T00:00:00Z")), key=lambda i: i.sort_key)] == [
        "2026-02-09T14:00:00+00:00", "2026-03-09T13:00:00+00:00", "2026-04-09T13:00:00+00:00",
    ]


def test_a_time_that_does_not_exist_on_a_clock_change_day_is_deterministic():
    # 02:30 does not happen in New York on Mar 8, 2026; it lands at 03:30, and Mar 9 is normal again.
    event = row("2026-03-07T02:30:00-05:00", "America/New_York", **repeat("daily"))
    assert starts(event, "2026-03-07T00:00:00-05:00", "2026-03-10T00:00:00-04:00") == [
        "2026-03-07 02:30", "2026-03-08 03:30", "2026-03-09 02:30",
    ]


def test_guam_has_no_clock_change_to_shift_anything():
    event = row("2026-03-06T09:00:00+10:00", **repeat("daily"))
    found = occurrences_of(event, utc("2026-03-01T00:00:00Z"), utc("2026-04-01T00:00:00Z"))
    assert {item.start.hour for item in found} == {23}


def test_the_clamp_is_computed_on_the_events_calendar_not_utc():
    # 11 PM on Jan 31 in New York is already Feb 1 in UTC.
    event = row("2026-01-31T23:00:00-05:00", "America/New_York", **repeat("monthly"))
    assert starts(event, "2026-01-01T00:00:00Z", "2026-05-02T00:00:00Z") == [
        "2026-01-31 23:00", "2026-02-28 23:00", "2026-03-31 23:00", "2026-04-30 23:00",
    ]


def test_cancelled_and_changed_occurrences():
    second, third = "2026-11-08T09:00:00+10:00", "2026-11-15T09:00:00+10:00"
    event = row("2026-11-01T09:00:00+10:00", **repeat("weekly"), end="2026-11-01T10:00:00+10:00", exceptions=[
        {"original_start": second, "cancelled": True},
        {"original_start": third, "overrides": {"start": "2026-11-16T14:00:00+10:00", "title": "Moved"}},
    ])
    found = sorted(occurrences_of(event, utc("2026-11-01T00:00:00+10:00"), utc("2026-11-30T00:00:00+10:00")), key=lambda i: i.sort_key)
    assert [item.item()["occurrence_start"] for item in found] == [
        "2026-11-01T09:00:00+10:00", "2026-11-16T14:00:00+10:00", "2026-11-22T09:00:00+10:00",
        "2026-11-29T09:00:00+10:00",
    ]
    moved = found[1].item()
    # Identity stays the rule's date; the length carries over; the rest comes from the series.
    assert moved["original_start"] == "2026-11-15T09:00:00+10:00" and moved["changed"] is True
    assert moved["occurrence_end"] == "2026-11-16T15:00:00+10:00" and moved["title"] == "Moved"
    assert found[0].item()["changed"] is False and found[0].item()["title"] == "Check-up"


def test_an_occurrence_can_move_into_a_range_from_outside_it_and_out_of_one():
    # Next month's visit moved up into November; November's moved out to December.
    event = row("2026-10-01T09:00:00+10:00", **repeat("monthly"), exceptions=[
        {"original_start": "2026-12-01T09:00:00+10:00", "overrides": {"start": "2026-11-20T09:00:00+10:00"}},
        {"original_start": "2026-11-01T09:00:00+10:00", "overrides": {"start": "2026-12-20T09:00:00+10:00"}},
    ])
    assert starts(event, "2026-11-01T00:00:00+10:00", "2026-12-01T00:00:00+10:00") == ["2026-11-20 09:00"]
    assert starts(event, "2026-12-01T00:00:00+10:00", "2027-01-01T00:00:00+10:00") == ["2026-12-20 09:00"]


def test_an_exception_that_matches_no_occurrence_is_ignored():
    event = row("2026-11-01T09:00:00+10:00", **repeat("weekly"), exceptions=[
        {"original_start": "2026-11-03T09:00:00+10:00", "cancelled": True},
        {"original_start": "2026-11-04T09:00:00+10:00", "overrides": {"title": "Ghost"}},
    ])
    assert len(starts(event, "2026-11-01T00:00:00+10:00", "2026-11-15T00:00:00+10:00")) == 2
    assert not any(i.changes for i in occurrences_of(event, utc("2026-11-01T00:00:00+10:00"), utc("2026-11-15T00:00:00+10:00")))


def test_overlap_not_just_start_decides_membership():
    event = row("2026-11-10T23:00:00+10:00", end="2026-11-11T02:00:00+10:00")
    assert starts(event, "2026-11-11T00:00:00+10:00", "2026-11-12T00:00:00+10:00") == ["2026-11-10 23:00"]
    assert starts(event, "2026-11-11T02:00:00+10:00", "2026-11-12T00:00:00+10:00") == []  # Ended as it began.
    assert starts(event, "2026-11-09T00:00:00+10:00", "2026-11-10T23:00:00+10:00") == []  # Starts as it ends.
    instant = row("2026-11-10T09:00:00+10:00")
    assert starts(instant, "2026-11-10T09:00:00+10:00", "2026-11-10T09:30:00+10:00") != []
    assert starts(instant, "2026-11-10T09:00:01+10:00", "2026-11-11T00:00:00+10:00") == []


def test_all_day_events_span_whole_days_on_their_own_calendar():
    event = row("2026-11-12T00:00:00+10:00", all_day=True, end="2026-11-14T00:00:00+10:00", **repeat("weekly"))
    found = sorted(occurrences_of(event, utc("2026-11-19T00:00:00+10:00"), utc("2026-11-20T00:00:00+10:00")), key=lambda i: i.sort_key)
    assert [i.item()["occurrence_start"] for i in found] == ["2026-11-19T00:00:00+10:00"]
    assert found[0].item()["occurrence_end"] == "2026-11-21T00:00:00+10:00"
    assert found[0].days(NEW_YORK) == [date(2026, 11, 19), date(2026, 11, 20)]
    one_day = row("2026-11-12T00:00:00+10:00", all_day=True)
    assert occurrences_of(one_day, utc("2026-11-01T00:00:00Z"), utc("2026-12-01T00:00:00Z"))[0].item()["occurrence_end"] == "2026-11-13T00:00:00+10:00"


def test_a_timed_occurrence_can_become_all_day_and_back():
    event = row("2026-11-01T09:00:00+10:00", end="2026-11-01T10:00:00+10:00", **repeat("weekly"), exceptions=[
        {"original_start": "2026-11-08T09:00:00+10:00", "overrides": {"start": "2026-11-08T00:00:00+10:00", "all_day": True}},
    ])
    found = sorted(occurrences_of(event, utc("2026-11-01T00:00:00+10:00"), utc("2026-11-16T00:00:00+10:00")), key=lambda i: i.sort_key)
    assert [(i.all_day, i.item()["occurrence_end"]) for i in found] == [
        (False, "2026-11-01T10:00:00+10:00"), (True, "2026-11-09T00:00:00+10:00"), (False, "2026-11-15T10:00:00+10:00"),
    ]


def test_malformed_stored_data_is_skipped_not_fatal():
    broken = row("2026-11-01T09:00:00+10:00")
    broken.data = {"timezone": "Mars/Base"}
    assert occurrences_of(broken, utc("2026-01-01T00:00:00Z"), utc("2027-01-01T00:00:00Z")) == []


# ---- through the API ----------------------------------------------------------------------------

NOW = datetime(2026, 11, 4, 10, 0, tzinfo=UTC)  # 20:00 on Nov 4 in Guam.


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(baby_router, "now", lambda: NOW)


async def make(baby_api, at, title="Visit", owner="owner", child_id=None, **data):
    await allow_events(baby_api)
    response, body = await save(
        baby_api, "event", owner=owner, occurred_at=at, title=title, child_id=child_id,
        data={"timezone": "Pacific/Guam", **data},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def listing(baby_api, first, last, *, headers=V2, owner="owner", **params):
    return await baby_api.client.get(
        f"{API}/events", params={"from": first, "to": last, **params}, headers={**headers, "X-Test-Owner": owner}
    )


def titles(response):
    return [(item["occurrence_start"][:16], item["title"]) for item in response.json()["items"]]


@needs_database
async def test_events_in_a_range_and_their_shape(baby_api):
    one = await make(baby_api, "2026-11-10T09:00:00+10:00", "Check-up", end="2026-11-10T10:00:00+10:00",
                     category="appointment", location="Clinic", attendees=["Kami"])
    await make(baby_api, "2026-12-10T09:00:00+10:00", "December")
    response = await listing(baby_api, "2026-11-01", "2026-11-30")
    assert response.status_code == 200
    assert response.json() == {
        "items": [{
            "event_id": one["id"], "original_start": "2026-11-10T09:00:00+10:00",
            "occurrence_start": "2026-11-10T09:00:00+10:00", "occurrence_end": "2026-11-10T10:00:00+10:00",
            "all_day": False, "timezone": "Pacific/Guam", "title": "Check-up", "category": "appointment",
            "location": "Clinic", "attendees": ["Kami"], "child_id": None, "repeats": False,
            "changed": False, "revision": 1,
        }],
        "complete": True, "from": "2026-11-01", "to": "2026-11-30",
    }


@needs_database
async def test_the_range_is_on_the_parents_calendar_days(baby_api):
    await make(baby_api, "2026-11-10T08:00:00+10:00", "Early")  # 22:00 on Nov 9 in UTC and Nov 9 in New York.
    assert titles(await listing(baby_api, "2026-11-10", "2026-11-10")) == [("2026-11-10T08:00", "Early")]
    await baby_api.client.patch(f"{API}/profile", headers=shared.GEN, json={"timezone": "America/New_York"})
    assert titles(await listing(baby_api, "2026-11-10", "2026-11-10")) == []
    assert titles(await listing(baby_api, "2026-11-09", "2026-11-09")) == [("2026-11-10T08:00", "Early")]


@needs_database
async def test_range_bounds(baby_api):
    ok = await listing(baby_api, "2026-01-01", "2027-02-04")  # 400 days.
    assert ok.status_code == 200
    for first, last in [("2026-01-01", "2027-02-05"), ("2026-11-02", "2026-11-01"), ("1990-01-01", "1990-02-01"),
                        ("2100-12-01", "2101-02-01"), ("9999-01-01", "9999-02-01")]:
        assert (await listing(baby_api, first, last)).status_code == 422, (first, last)
    assert (await listing(baby_api, "2026-11-01", "nope")).status_code == 422
    assert (await baby_api.client.get(f"{API}/events", headers=V2)).status_code == 422


@needs_database
async def test_a_series_begun_long_before_the_range(baby_api):
    await make(baby_api, "2019-06-03T09:00:00+10:00", "Weekly", recurrence={"frequency": "weekly", "interval": 1})
    await make(baby_api, "2012-02-29T09:00:00+10:00", "Birthday", all_day=False, recurrence={"frequency": "yearly", "interval": 1})
    got = await listing(baby_api, "2026-11-01", "2026-11-15")
    assert titles(got) == [("2026-11-02T09:00", "Weekly"), ("2026-11-09T09:00", "Weekly")]
    assert [i["original_start"][:10] for i in (await listing(baby_api, "2026-02-27", "2026-03-01")).json()["items"]] == ["2026-02-28"]


@needs_database
async def test_over_500_are_cut_in_a_fixed_order_and_said_to_be_incomplete(baby_api):
    ids = [
        (await make(baby_api, "2026-01-01T09:00:00+10:00", name, recurrence={"frequency": "daily", "interval": 1}))["id"]
        for name in ("a", "b", "c")
    ]
    first = await listing(baby_api, "2026-01-01", "2027-02-04")
    again = await listing(baby_api, "2026-01-01", "2027-02-04")
    assert first.json() == again.json() and len(first.json()["items"]) == 500
    assert first.json()["complete"] is False
    # Same moment: ordered by event, so the cut is the same every time.
    assert [i["event_id"] for i in first.json()["items"][:6]] == sorted(ids) * 2
    last = first.json()["items"][-1]["occurrence_start"][:10]
    assert last < "2026-06-20"
    assert (await listing(baby_api, "2026-01-01", "2026-03-31")).json()["complete"] is True


@needs_database
async def test_deleted_events_other_owners_and_children(baby_api):
    child = str(uuid4())
    await baby_api.client.post(f"{API}/children", headers=shared.GEN, json={"id": child, "name": "Noa"})
    other_child = str(uuid4())
    await baby_api.client.post(f"{API}/children", headers=shared.GEN, json={"id": other_child, "name": "Ari"})
    family = await make(baby_api, "2026-11-10T09:00:00+10:00", "Family")
    mine = await make(baby_api, "2026-11-11T09:00:00+10:00", "Noa", child_id=child)
    await make(baby_api, "2026-11-12T09:00:00+10:00", "Ari", child_id=other_child)
    gone = await make(baby_api, "2026-11-13T09:00:00+10:00", "Gone", recurrence={"frequency": "daily", "interval": 1})
    await make(baby_api, "2026-11-14T09:00:00+10:00", "Theirs", owner="other")
    assert (await baby_api.client.delete(f"{API}/records/{gone['id']}", headers=V2, params={"revision": 1})).status_code == 204
    assert [t for _, t in titles(await listing(baby_api, "2026-11-01", "2026-11-30"))] == ["Family", "Noa", "Ari"]
    assert [t for _, t in titles(await listing(baby_api, "2026-11-01", "2026-11-30", child_id=child))] == ["Family", "Noa"]
    assert [t for _, t in titles(await listing(baby_api, "2026-11-01", "2026-11-30", owner="other"))] == ["Theirs"]
    # Someone else's child is not found.
    assert (await listing(baby_api, "2026-11-01", "2026-11-30", owner="other", child_id=child)).status_code == 404
    assert family["id"] and mine["id"]


@needs_database
async def test_time_zones_across_a_clock_change_through_the_api(baby_api):
    await make(baby_api, "2026-03-06T09:00:00-05:00", "Visit", **{"timezone": "America/New_York"}, recurrence={"frequency": "daily", "interval": 1})
    guam = await make(baby_api, "2026-03-06T09:00:00+10:00", "Guam", recurrence={"frequency": "daily", "interval": 1})
    items = (await listing(baby_api, "2026-03-07", "2026-03-10")).json()["items"]
    visit = [i["occurrence_start"] for i in items if i["title"] == "Visit"]
    # The parent's days are Guam's: 09:00 in New York on Mar 6 is midnight on Mar 7 there.
    assert visit == [
        "2026-03-06T09:00:00-05:00", "2026-03-07T09:00:00-05:00", "2026-03-08T09:00:00-04:00",
        "2026-03-09T09:00:00-04:00", "2026-03-10T09:00:00-04:00",
    ]
    assert {i["occurrence_start"][11:] for i in items if i["title"] == "Guam"} == {"09:00:00+10:00"}
    assert guam["id"]


@needs_database
async def test_build_32_has_no_calendar(baby_api):
    event = await make(baby_api, "2026-11-10T09:00:00+10:00", "Visit", recurrence={"frequency": "daily", "interval": 1})
    legacy = {"X-Baby-Generation": "1"}
    assert (await listing(baby_api, "2026-11-01", "2026-11-30", headers=legacy)).status_code == 404
    assert (await listing(baby_api, "2026-11-01", "2026-11-30", headers={**legacy, "X-Baby-Client": "1"})).status_code == 404
    url = f"{API}/events/{event['id']}"
    start = "2026-11-11T09:00:00+10:00"
    body = {"revision": 1, "original_start": start, "cancelled": True}
    assert (await baby_api.client.put(f"{url}/occurrences", headers=legacy, json=body)).status_code == 404
    assert (await baby_api.client.delete(f"{url}/occurrences", headers=legacy, params={"original_start": start, "revision": 1})).status_code == 404
    assert (await baby_api.client.post(f"{url}/end-series", headers=legacy, json={"revision": 1, "from_date": "2026-12-01"})).status_code == 404
    assert (await baby_api.client.get(f"{API}/records/{event['id']}", headers=V2)).json()["revision"] == 1


@needs_database
async def test_cancel_change_restore_and_end_a_series(baby_api):
    c = baby_api.client
    event = await make(baby_api, "2026-11-01T09:00:00+10:00", "Weekly", end="2026-11-01T10:00:00+10:00",
                       recurrence={"frequency": "weekly", "interval": 1})
    url = f"{API}/events/{event['id']}"
    cancel = {"revision": 1, "original_start": "2026-11-08T09:00:00+10:00", "cancelled": True}
    done = await c.put(f"{url}/occurrences", headers=V2, json=cancel)
    assert done.status_code == 200 and done.json()["revision"] == 2
    # A retry after a lost answer is the same change, not a conflict.
    again = await c.put(f"{url}/occurrences", headers=V2, json=cancel)
    assert again.status_code == 200 and again.json()["revision"] == 2
    change = {"revision": 2, "original_start": "2026-11-15T09:00:00+10:00", "overrides": {"start": "2026-11-15T14:00:00+10:00", "title": "Afternoon"}}
    assert (await c.put(f"{url}/occurrences", headers=V2, json=change)).json()["revision"] == 3
    assert titles(await listing(baby_api, "2026-11-01", "2026-11-23")) == [
        ("2026-11-01T09:00", "Weekly"), ("2026-11-15T14:00", "Afternoon"), ("2026-11-22T09:00", "Weekly"),
    ]
    # Changing a changed occurrence replaces its exception; a different offset names the same instant.
    swap = {"revision": 3, "original_start": "2026-11-14T23:00:00Z", "cancelled": True}
    assert (await c.put(f"{url}/occurrences", headers=V2, json=swap)).status_code == 200
    stored = (await c.get(f"{API}/records/{event['id']}", headers=V2)).json()["data"]["exceptions"]
    assert len(stored) == 2 and all(item["cancelled"] for item in stored)

    # Refused: stale revision, a date the rule does not give, a bad change, both or neither.
    assert (await c.put(f"{url}/occurrences", headers=V2, json={**cancel, "revision": 1, "original_start": "2026-11-22T09:00:00+10:00"})).status_code == 409
    for bad in (
        {"original_start": "2026-11-09T09:00:00+10:00", "cancelled": True},
        {"original_start": "2026-11-22T09:00:00+10:00", "overrides": {"start": "2026-11-22T09:00:00+10:00", "end": "2026-11-22T08:00:00+10:00"}},
        {"original_start": "2026-11-22T09:00:00+10:00", "overrides": {"category": "party"}},
        {"original_start": "2026-11-22T09:00:00+10:00", "cancelled": True, "overrides": {"title": "x"}},
        {"original_start": "2026-11-22T09:00:00+10:00"},
        {"original_start": "2026-10-25T09:00:00+10:00", "cancelled": True},  # Before the series.
    ):
        assert (await c.put(f"{url}/occurrences", headers=V2, json={"revision": 4, **bad})).status_code == 422, bad

    restored = await c.delete(f"{url}/occurrences", headers=V2, params={"original_start": "2026-11-08T09:00:00+10:00", "revision": 4})
    assert restored.status_code == 200 and restored.json()["revision"] == 5
    assert len((await listing(baby_api, "2026-11-01", "2026-11-23")).json()["items"]) == 3
    # Restoring what is not changed is a no-op, whatever the revision.
    assert (await c.delete(f"{url}/occurrences", headers=V2, params={"original_start": "2026-11-08T09:00:00+10:00", "revision": 1})).json()["revision"] == 5

    ended = await c.post(f"{url}/end-series", headers=V2, json={"revision": 5, "from_date": "2026-11-15"})
    assert ended.status_code == 200
    assert ended.json()["data"]["recurrence"]["until"] == "2026-11-14"
    # The exception from Nov 15 went with the dates it applied to.
    assert [e["original_start"][:10] for e in ended.json()["data"]["exceptions"]] == []
    assert [d for d, _ in titles(await listing(baby_api, "2026-11-01", "2027-03-01"))] == ["2026-11-01T09:00", "2026-11-08T09:00"]
    # Again, or later, changes nothing; before the first date is refused.
    assert (await c.post(f"{url}/end-series", headers=V2, json={"revision": 6, "from_date": "2026-11-15"})).json()["revision"] == 6
    assert (await c.post(f"{url}/end-series", headers=V2, json={"revision": 6, "from_date": "2026-12-15"})).json()["revision"] == 6
    assert (await c.post(f"{url}/end-series", headers=V2, json={"revision": 6, "from_date": "2026-11-01"})).status_code == 422
    earlier = await c.post(f"{url}/end-series", headers=V2, json={"revision": 6, "from_date": "2026-11-09"})
    assert earlier.json()["data"]["recurrence"]["until"] == "2026-11-08"


@needs_database
async def test_edits_need_a_repeating_event_that_is_the_callers(baby_api):
    c = baby_api.client
    single = await make(baby_api, "2026-11-10T09:00:00+10:00", "Once")
    repeating = await make(baby_api, "2026-11-10T09:00:00+10:00", "Weekly", recurrence={"frequency": "weekly", "interval": 1})
    plain = (await save(baby_api, "journal"))[0].json()
    body = {"revision": 1, "original_start": "2026-11-17T09:00:00+10:00", "cancelled": True}
    assert (await c.put(f"{API}/events/{single['id']}/occurrences", headers=V2, json=body)).status_code == 422
    assert (await c.post(f"{API}/events/{single['id']}/end-series", headers=V2, json={"revision": 1, "from_date": "2026-12-01"})).status_code == 422
    for target in (plain["id"], str(uuid4())):
        assert (await c.put(f"{API}/events/{target}/occurrences", headers=V2, json=body)).status_code == 404
    other = {**V2, "X-Test-Owner": "other"}
    assert (await c.put(f"{API}/events/{repeating['id']}/occurrences", headers=other, json=body)).status_code == 404
    assert (await c.delete(f"{API}/records/{repeating['id']}", headers=V2, params={"revision": 1})).status_code == 204
    assert (await c.put(f"{API}/events/{repeating['id']}/occurrences", headers=V2, json=body)).status_code == 404


@needs_database
async def test_event_dots_on_care_summary(baby_api, frozen):
    c = baby_api.client
    child = str(uuid4())
    await c.post(f"{API}/children", headers=shared.GEN, json={"id": child, "name": "Noa"})
    await make(baby_api, "2026-11-01T09:00:00+10:00", "Weekly", recurrence={"frequency": "weekly", "interval": 1})
    await make(baby_api, "2026-11-02T00:00:00+10:00", "Trip", all_day=True, end="2026-11-04T00:00:00+10:00")
    await make(baby_api, "2026-11-03T23:30:00+10:00", "Late", end="2026-11-04T00:30:00+10:00")
    gone = await make(baby_api, "2026-10-31T09:00:00+10:00", "Gone")
    await make(baby_api, "2026-10-30T09:00:00+10:00", "Theirs", owner="other")
    await make(baby_api, "2026-10-29T09:00:00+10:00", "Child", child_id=child)
    await c.delete(f"{API}/records/{gone['id']}", headers=V2, params={"revision": 1})
    for kind, at, data in [
        ("contraction", "2026-11-03T02:00:00+10:00", {}), ("contraction", "2026-11-03T02:05:00+10:00", {}),
        ("kick_session", "2026-11-02T20:00:00+10:00", {"count": 10}), ("diaper", "2026-11-01T10:00:00+10:00", {"type": "wet"}),
    ]:
        assert (await save(baby_api, kind, occurred_at=at, data=data))[0].status_code == 200
    guard = await save(baby_api, "contraction", owner="other", occurred_at="2026-11-01T02:00:00+10:00")
    assert guard[0].status_code == 200

    got = await c.get(f"{API}/care/summary", headers=V2, params={"from": "2026-10-29", "to": "2026-11-05"})
    dots = {day["date"]: day["dots"] for day in got.json()["days"]}
    assert dots == {
        "2026-10-29": [], "2026-10-30": [], "2026-10-31": [],
        "2026-11-01": ["diaper", "event"],  # The weekly visit; the first day has the diaper too.
        "2026-11-02": ["kick_session", "event"],
        "2026-11-03": ["contraction", "event"],
        "2026-11-04": ["event"],  # The trip's last day is Nov 3 (end is exclusive); the late visit runs into Nov 4.
    }
    assert "marks" not in got.json()["days"][0]
    # Past the 5th there is no day in the summary, as before: later days come from /events.
    # With a child: that child's events and the family's.
    with_child = await c.get(f"{API}/care/summary", headers=V2, params={"from": "2026-10-29", "to": "2026-10-30", "child_id": child})
    assert [d["dots"] for d in with_child.json()["days"]] == [["event"], []]
    # Build 32 keeps the dots it knows.
    old = await c.get(f"{API}/care/summary", headers=shared.GEN, params={"from": "2026-10-29", "to": "2026-11-05"})
    assert {d["date"]: d["dots"] for d in old.json()["days"]}["2026-11-01"] == ["diaper"]
    assert all(set(d["dots"]) <= {"feeding", "diaper", "sleep"} for d in old.json()["days"])


@needs_database
async def test_a_sleep_still_running_keeps_its_dot_beside_new_ones(baby_api, frozen):
    await make(baby_api, "2026-11-03T09:00:00+10:00", "Visit")
    assert (await save(baby_api, "sleep", occurred_at="2026-11-03T22:00:00+10:00", data={}))[0].status_code == 200
    got = await baby_api.client.get(f"{API}/care/summary", headers=V2, params={"from": "2026-11-03", "to": "2026-11-03"})
    assert got.json()["days"][0]["dots"] == ["sleep", "event"]
