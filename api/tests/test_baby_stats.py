"""Care totals against numbers worked out by hand, in the parent's time zone."""

from datetime import UTC, date, datetime
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.domains.baby import stats
from app.domains.baby.models import BabyChild, BabyRecord
from app.domains.baby.stats import care_stats, custom_days, last_days, rolling_24h, summarize
from tests import test_baby_integration as shared

baby_api = shared.baby_api
GUAM = ZoneInfo("Pacific/Guam")
# Wednesday, Nov 4 2026, 8:00 PM on Guam.
AT = datetime(2026, 11, 4, 20, 0, tzinfo=GUAM)
needs_database = pytest.mark.skipif(
    not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required"
)


def guam(month, day, hour=0, minute=0):
    return datetime(2026, month, day, hour, minute, tzinfo=GUAM)


def row(kind, at, **data):
    return SimpleNamespace(id=uuid4(), kind=kind, occurred_at=at, data=data)


def breast(at, side=None, minutes=None):
    data = {"method": "breast"}
    if side:
        data["side"] = side
    if minutes is not None:
        data["duration_minutes"] = minutes
    return row("feeding", at, **data)


def bottle(at, amount, unit):
    return row("feeding", at, method="bottle", amount=amount, unit=unit)


def diaper(at, kind):
    return row("diaper", at, type=kind)


def sleep(at, end=None):
    return row("sleep", at, **({"end_at": end.isoformat()} if end else {}))


def week_rows():
    return [
        breast(guam(11, 1, 8), "left", 20),
        breast(guam(11, 1, 11), "right"),
        bottle(guam(11, 1, 14), 90, "ml"),
        breast(guam(11, 2, 7), "both", 30),
        bottle(guam(11, 4, 6), 3, "oz"),
        breast(guam(11, 4, 9), "left", 10),
        diaper(guam(11, 1, 8), "wet"),
        diaper(guam(11, 1, 9), "both"),
        diaper(guam(11, 1, 10), "dirty"),
        diaper(guam(11, 1, 11), "dry"),
        diaper(guam(11, 2, 8), "both"),
        diaper(guam(11, 4, 7), "wet"),
        sleep(guam(10, 31, 23), guam(11, 1, 7)),
        sleep(guam(11, 1, 13), guam(11, 1, 14, 30)),
        sleep(guam(11, 4, 1), guam(11, 4, 4)),
        sleep(guam(11, 4, 19)),
    ]


def check_week(result):
    # Seven finished days, Oct 28 to Nov 3. Today, Nov 4, is partial and leaves the averages alone.
    assert [day["date"] for day in result["days"]][0] == "2026-10-28"
    assert len(result["days"]) == 8
    assert [day["partial"] for day in result["days"]] == [False] * 7 + [True]
    feeding = result["feeding"]
    assert feeding == {
        "count": 6,
        "average_per_day": 2.0,  # (3 + 1) over the 2 finished days with feeds, not over 7.
        # 180, 180, 1020 and 180 minutes; Nov 2 to Nov 4 crosses an empty day and is skipped.
        "average_gap_minutes": 390.0,
        "left": 2,
        "right": 1,
        "both": 1,
        "bottle_count": 2,
        "bottle_ml": 90,
        "bottle_oz": 3,
        "breast_minutes": 60,  # The untimed right-side feed adds nothing.
        "timed_breast_feeds": 3,
        "unknown_end_feeds": 0,
        "days_logged": 2,
        "days_total": 7,
    }
    assert result["diapers"] == {
        "count": 6,
        "pee": 4,  # Wet, both, both, wet.
        "poo": 3,  # Both, dirty, both.
        "dry": 1,
        "average_per_day": 2.5,  # (4 + 1) over 2 logged days.
        "days_logged": 2,
        "days_total": 7,
    }
    by_date = {day["date"]: day for day in result["days"]}
    assert by_date["2026-11-01"]["feeding"]["count"] == 3
    assert by_date["2026-11-03"]["feeding"]["count"] == 0
    assert by_date["2026-11-01"]["diapers"] == {"count": 4, "pee": 2, "poo": 2, "dry": 1}
    # 11 PM to 7 AM splits 60 and 420 across midnight.
    assert by_date["2026-10-31"]["sleep"] == {"total_minutes": 60, "longest_minutes": 60}
    assert by_date["2026-11-01"]["sleep"] == {"total_minutes": 510, "longest_minutes": 420}
    assert by_date["2026-11-04"]["sleep"] == {"total_minutes": 180, "longest_minutes": 180}
    sleeping = result["sleep"]
    assert sleeping["total_minutes"] == 750  # 60 + 510 + 180; the open sleep adds nothing.
    assert sleeping["average_minutes_per_day"] == 285.0  # (60 + 510) over 2 logged days.
    assert sleeping["longest_minutes"] == 480  # The whole night, not its split parts.
    assert sleeping["sleeps"] == 3
    assert sleeping["days_logged"] == 2 and sleeping["days_total"] == 7
    assert [item["started_at"] for item in sleeping["open"]] == ["2026-11-04T19:00:00+10:00"]


def test_seven_days_by_hand():
    result = summarize(week_rows(), last_days(7, GUAM, AT), GUAM)
    check_week(result)
    assert result["complete"] is True
    assert result["range"] == {
        "kind": "7d",
        "start": "2026-10-28T00:00:00+10:00",
        "end": "2026-11-04T20:00:00+10:00",
    }


def test_rolling_24_hours_reads_from_now():
    rows = [
        breast(guam(11, 3, 19, 59), "left"),
        breast(guam(11, 3, 20), "right"),
        breast(guam(11, 4, 19, 59), "left"),
        breast(guam(11, 4, 20), "left"),  # The window closes now.
        diaper(guam(11, 3, 19), "wet"),
        diaper(guam(11, 4, 1), "both"),
        sleep(guam(11, 3, 19), guam(11, 3, 21)),  # Only the last hour is in the window.
        sleep(guam(11, 3, 23), guam(11, 4, 2)),
    ]
    result = summarize(rows, rolling_24h(GUAM, AT), GUAM)
    assert result["range"]["start"] == "2026-11-03T20:00:00+10:00"
    assert [(day["date"], day["partial"]) for day in result["days"]] == [
        ("2026-11-03", True), ("2026-11-04", True),
    ]
    assert result["feeding"]["count"] == 2 and result["feeding"]["left"] == 1
    assert result["feeding"]["average_per_day"] is None
    assert result["feeding"]["days_total"] == 0
    assert result["diapers"]["count"] == 1
    assert result["sleep"]["total_minutes"] == 240  # 60 + 180.
    assert result["sleep"]["longest_minutes"] == 180
    assert result["days"][0]["sleep"]["total_minutes"] == 120  # 60 + the hour before midnight.
    assert result["days"][1]["sleep"]["total_minutes"] == 120


def test_rolling_window_closing_at_midnight_has_no_new_day():
    window = rolling_24h(GUAM, guam(11, 4))
    assert window.days == [date(2026, 11, 3)]
    result = summarize([], window, GUAM)
    # All of Nov 3, so it counts as a finished day.
    assert result["days"][0]["partial"] is False and result["feeding"]["days_total"] == 1


def test_thirty_days_and_custom_ranges():
    thirty = last_days(30, GUAM, AT)
    assert len(thirty.days) == 31 and thirty.days[0] == date(2026, 10, 5)
    past = custom_days(date(2026, 11, 1), date(2026, 11, 2), GUAM, AT)
    assert past.end == guam(11, 3).astimezone(UTC)
    result = summarize(week_rows(), past, GUAM)
    assert result["feeding"]["count"] == 4
    assert result["feeding"]["days_logged"] == 2 and result["feeding"]["days_total"] == 2
    assert result["feeding"]["average_per_day"] == 2.0
    # The sleep from Oct 31 contributes only what falls inside the range.
    assert result["sleep"]["total_minutes"] == 510 and result["sleep"]["longest_minutes"] == 420
    # A range running past today stops now, and a future log is not counted.
    ahead = custom_days(date(2026, 11, 4), date(2026, 11, 9), GUAM, AT)
    assert ahead.days == [date(2026, 11, 4)] and ahead.end == AT
    today = summarize([*week_rows(), diaper(guam(11, 4, 21), "wet")], ahead, GUAM)
    assert today["feeding"]["count"] == 2 and today["diapers"]["count"] == 1
    assert today["feeding"]["average_per_day"] is None and today["feeding"]["days_total"] == 0
    with pytest.raises(ValueError):
        custom_days(date(2026, 11, 5), date(2026, 11, 9), GUAM, AT)
    with pytest.raises(ValueError):
        custom_days(date(2026, 1, 1), date(2026, 11, 1), GUAM, AT)


def test_sleep_crossing_two_midnights_and_a_clock_change():
    days = custom_days(date(2026, 11, 1), date(2026, 11, 3), GUAM, AT)
    result = summarize([sleep(guam(11, 1, 22), guam(11, 3, 2))], days, GUAM)
    assert [day["sleep"]["total_minutes"] for day in result["days"]] == [120, 1440, 120]
    assert result["sleep"]["longest_minutes"] == 1680
    # US clocks fall back on Nov 1 2026, so 11 PM to 7 AM is really nine hours.
    york = ZoneInfo("America/New_York")
    moment = datetime(2026, 11, 2, 12, tzinfo=york)
    night = sleep(datetime(2026, 10, 31, 23, tzinfo=york), datetime(2026, 11, 1, 7, tzinfo=york))
    result = summarize([night], custom_days(date(2026, 10, 31), date(2026, 11, 1), york, moment), york)
    assert [day["sleep"]["total_minutes"] for day in result["days"]] == [60, 480]


def test_unusable_rows_do_not_break_or_change_totals():
    rows = [
        row("sleep", guam(11, 1, 9), end_at="not a time"),
        row("sleep", guam(11, 1, 10), end_at=guam(11, 1, 9).isoformat()),
        row("sleep", guam(11, 1, 11), end_at=42),
        row("feeding", guam(11, 1, 8), method="breast", duration_minutes=True, side="middle"),
        row("feeding", guam(11, 1, 9), method="bottle", amount="lots", unit="ml"),
        row("diaper", guam(11, 1, 8), type="sparkly"),
        SimpleNamespace(id=uuid4(), kind="diaper", occurred_at=guam(11, 1, 9), data=None),
    ]
    result = summarize(rows, last_days(7, GUAM, AT), GUAM)
    assert result["sleep"]["total_minutes"] == 0 and result["sleep"]["unusable"] == 3
    assert result["feeding"]["count"] == 2 and result["feeding"]["breast_minutes"] == 0
    assert result["feeding"]["timed_breast_feeds"] == 0 and result["feeding"]["bottle_ml"] == 0
    assert result["diapers"] == {
        "count": 2, "pee": 0, "poo": 0, "dry": 0,
        "average_per_day": 2.0, "days_logged": 1, "days_total": 7,
    }


def test_container_values_in_old_rows_are_unknown_not_a_crash():
    rows = [
        row("diaper", guam(11, 1, 8), type=[]),
        row("feeding", guam(11, 1, 9), method=[], side={}),
        row("feeding", guam(11, 1, 10), method="breast", side=[]),
        row("feeding", guam(11, 1, 11), method="bottle", amount=2, unit=[]),
    ]
    result = summarize(rows, last_days(7, GUAM, AT), GUAM)
    assert result["diapers"]["count"] == 1 and result["diapers"]["pee"] == 0
    assert result["feeding"]["count"] == 3 and result["feeding"]["left"] == 0
    assert result["feeding"]["bottle_ml"] == 2


def test_seven_days_means_seven_finished_days_plus_today():
    window = last_days(7, GUAM, AT)
    assert len(window.days) == 8 and window.days[0] == date(2026, 10, 28)
    result = summarize([], window, GUAM)
    assert result["feeding"]["days_total"] == 7 and result["days"][-1]["partial"] is True


def test_the_same_nap_logged_by_two_parents_counts_once():
    rows = [sleep(guam(11, 1, 9), guam(11, 1, 11)), sleep(guam(11, 1, 10), guam(11, 1, 12))]
    result = summarize(rows, last_days(7, GUAM, AT), GUAM)
    assert result["sleep"]["total_minutes"] == 180
    assert result["sleep"]["sleeps"] == 1 and result["sleep"]["longest_minutes"] == 180


def test_rolling_24_hours_are_real_hours_across_a_clock_change():
    york = ZoneInfo("America/New_York")
    window = rolling_24h(york, datetime(2026, 11, 1, 12, 0, tzinfo=york))
    assert (window.end - window.start).total_seconds() == 24 * 3600


def test_results_never_judge():
    text = str(summarize(week_rows(), last_days(7, GUAM, AT), GUAM)).lower()
    for word in ("normal", "abnormal", "low", "high", "healthy", "concern"):
        assert word not in text


def stored(child, kind, at, data, *, owner="owner", generation=1, deleted=None):
    return BabyRecord(
        id=uuid4(), app_user_id=owner, generation=generation, kind=kind, title=kind, body="",
        child_id=child, occurred_at=at, data=data, revision=1, creation_hash="x",
        created_at=at, updated_at=at, deleted_at=deleted,
    )


@needs_database
async def test_database_rows_match_hand_numbers_and_stay_scoped(baby_api, monkeypatch):
    child, sibling = uuid4(), uuid4()
    async with baby_api.sessions() as db:
        for identifier, name in ((child, "Noa"), (sibling, "Kai")):
            db.add(BabyChild(id=identifier, app_user_id="owner", generation=1, name=name, creation_hash="x"))
        await db.flush()
        for item in week_rows():
            db.add(stored(child, item.kind, item.occurred_at, item.data))
        wet = {"type": "wet"}
        moment = guam(11, 1, 12)
        # None of these count for this child in this range.
        db.add(stored(child, "diaper", moment, wet, deleted=AT))  # Soft deleted.
        db.add(stored(child, "diaper", moment, wet, generation=2))
        db.add(stored(child, "diaper", moment, wet, owner="other"))
        db.add(stored(sibling, "diaper", moment, wet))
        db.add(stored(None, "diaper", moment, wet))
        db.add(stored(child, "diaper", guam(10, 27, 23), wet))  # Before the range.
        db.add(stored(child, "journal", moment, {}))
        # Looked back for, and split at the range start.
        db.add(stored(sibling, "sleep", guam(10, 27, 22), {"end_at": guam(10, 28, 2).isoformat()}))
        db.add(stored(sibling, "sleep", guam(10, 20, 22), {"end_at": guam(10, 28, 3).isoformat()}))
        await db.commit()
    window = last_days(7, GUAM, AT)
    async with baby_api.sessions() as db:
        check_week(await care_stats(db, "owner", 1, child, GUAM, window))
        other = await care_stats(db, "owner", 1, sibling, GUAM, window)
        assert other["diapers"]["count"] == 1
        # 2 hours in range. The sleep begun over 48 hours before the range is not looked for.
        assert other["sleep"]["total_minutes"] == 120
        loose = await care_stats(db, "owner", 1, None, GUAM, window)
        assert loose["diapers"]["count"] == 1
        monkeypatch.setattr(stats, "ROW_LIMIT", 3)
        assert (await care_stats(db, "owner", 1, child, GUAM, window))["complete"] is False
