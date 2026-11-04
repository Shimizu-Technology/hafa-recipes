"""The one place care totals are computed; Ask, summaries and Stats all read these numbers.

Reports what was logged and never judges it. Days are the parent's calendar days. Today is
partial: it counts toward totals but not daily averages, and a day with nothing logged in a
category is left out of that category's averages rather than counted as zero.
"""

import math
from datetime import UTC, date, datetime, time, timedelta
from typing import NamedTuple

from sqlalchemy import and_, or_, select

from app.domains.baby.feeds import reduce_feed
from app.domains.baby.models import BabyRecord
from app.domains.baby.queries import row_scope

CARE_KINDS = ("feeding", "sleep", "diaper")
MAX_CUSTOM_DAYS = 92
ROW_LIMIT = 5000  # Over 50 logs a day across the longest range; beyond it the result says so.
# How far before a range to look for a sleep still running into it.
SLEEP_LOOKBACK = timedelta(hours=48)


class StatsRange(NamedTuple):
    """Half-open instants, and the calendar days they touch."""

    kind: str
    start: datetime
    end: datetime
    days: list[date]


def day_start(day, zone):
    return datetime.combine(day, time(), tzinfo=zone).astimezone(UTC)


def rolling_24h(zone, at):
    # Real elapsed hours, so a clock change cannot stretch the window.
    end = at.astimezone(UTC)
    start = end - timedelta(hours=24)
    last = end.astimezone(zone).date()
    # A window closing exactly at midnight does not touch the new day.
    if day_start(last, zone) == end.astimezone(UTC):
        last -= timedelta(days=1)
    first = start.astimezone(zone).date()
    return StatsRange("24h", start, end, [first + timedelta(days=n) for n in range((last - first).days + 1)])


def calendar_range(kind, first, last, zone, at):
    today = at.astimezone(zone).date()
    last = min(last, today)
    if first > last:
        raise ValueError("Choose dates that have already started")
    days = [first + timedelta(days=n) for n in range((last - first).days + 1)]
    end = at if last == today else day_start(last + timedelta(days=1), zone)
    return StatsRange(kind, day_start(first, zone), end, days)


def last_days(count, zone, at):
    """The last ``count`` finished days, plus today so far."""
    today = at.astimezone(zone).date()
    return calendar_range(f"{count}d", today - timedelta(days=count), today, zone, at)


def check_custom_span(first, last):
    if first > last:
        raise ValueError("Choose a start before the end")
    if (last - first).days >= MAX_CUSTOM_DAYS:
        raise ValueError(f"Choose {MAX_CUSTOM_DAYS} days or fewer")


def custom_days(first, last, zone, at):
    check_custom_span(first, last)
    return calendar_range("custom", first, last, zone, at)


def care_query(owner, generation, child_id, *columns):
    """Who can see which care rows. ``child_id=None`` means logs with no child, as Today does."""
    return select(*columns).where(
        row_scope(BabyRecord, owner, generation),
        BabyRecord.deleted_at.is_(None),
        BabyRecord.kind.in_(CARE_KINDS),
        BabyRecord.child_id == child_id if child_id else BabyRecord.child_id.is_(None),
    )


def kind_query(owner, generation, kinds, *columns):
    """Who can see rows of these kinds: calendar events, contractions and kicks.

    The one owner-scoped query the calendar reads through, kept apart from ``care_query`` so the
    totals above never count them.
    """
    return select(*columns).where(
        row_scope(BabyRecord, owner, generation),
        BabyRecord.deleted_at.is_(None),
        BabyRecord.kind.in_(kinds),
    )


async def care_rows(db, owner, generation, child_id, stats_range, *, tracked=None):
    return list(
        await db.execute(
            care_query(
                owner, generation, child_id,
                BabyRecord.id, BabyRecord.kind, BabyRecord.occurred_at, BabyRecord.data,
                *([BabyRecord.space_id, BabyRecord.generation, BabyRecord.revision] if tracked is not None else []),
            )
            .where(
                BabyRecord.occurred_at < stats_range.end,
                or_(
                    BabyRecord.occurred_at >= stats_range.start,
                    and_(
                        BabyRecord.kind == "sleep",
                        BabyRecord.occurred_at >= stats_range.start - SLEEP_LOOKBACK,
                    ),
                ),
            )
            .order_by(BabyRecord.occurred_at.desc())
            .limit(ROW_LIMIT + 1)
        )
    )


async def care_stats(db, owner, generation, child_id, zone, stats_range, *, tracked=None):
    rows = await care_rows(db, owner, generation, child_id, stats_range, tracked=tracked)
    if tracked is not None:
        for row in rows[:ROW_LIMIT]:
            tracked["records"][row.id] = (row.space_id, row.generation, row.revision)
    return summarize(rows[:ROW_LIMIT], stats_range, zone, complete=len(rows) <= ROW_LIMIT)


# What puts a dot on a calendar day. ``day["marks"]`` holds the kinds the caller found for that
# day that are not care totals: events, contractions and kicks, and a sleep still going.
DAY_DOTS = {
    "feeding": lambda day: day["feeding"]["count"],
    "diaper": lambda day: day["diapers"]["count"],
    "sleep": lambda day: day["sleep"]["total_minutes"] or "sleep" in day["marks"],
    "contraction": lambda day: "contraction" in day["marks"],
    "kick_session": lambda day: "kick_session" in day["marks"],
    "event": lambda day: "event" in day["marks"],
}


async def care_summary(db, owner, generation, child_id, zone, first, last, at, marks=None):
    """Inclusive calendar days of totals and dots. A wholly future range is simply empty.

    ``marks`` maps an ISO date to the non-care kinds on it; without it only care earns dots.
    """
    check_custom_span(first, last)
    if first > at.astimezone(zone).date():
        start = day_start(first, zone)
        stats_range = StatsRange("custom", start, start, [])
        rows = []
    else:
        stats_range = calendar_range("custom", first, last, zone, at)
        rows = await care_rows(db, owner, generation, child_id, stats_range)
    result = summarize(rows[:ROW_LIMIT], stats_range, zone, complete=len(rows) <= ROW_LIMIT)
    add_sleep_spans(result["days"], rows[:ROW_LIMIT], stats_range, zone)
    # A sleep still going has no minutes yet, but the day it began has a sleep on it.
    sleeping = {
        datetime.fromisoformat(item["started_at"]).date().isoformat()
        for item in result["sleep"]["open"]
    }
    for day in result["days"]:
        day["marks"] = {*(marks or {}).get(day["date"], ()), *({"sleep"} if day["date"] in sleeping else ())}
        day["dots"] = [name for name, earned in DAY_DOTS.items() if earned(day)]
        del day["marks"]
    return result


def next_side(data):
    """Opposite of the side the feed started on; a Both or bottle feed suggests nothing.

    A feed with actions keeps its starting side there, even after switching makes it Both.
    """
    if text_in(data, "method") != "breast":
        return None
    return {"left": "right", "right": "left"}.get(started_side(data) or text_in(data, "side"))


def started_side(data):
    try:
        return reduce_feed(data.get("actions") or [])["started_side"]
    except (AttributeError, KeyError, TypeError, ValueError):
        return None  # Older or malformed rows may hold anything.


async def last_feed(db, owner, generation, child_id, zone, at, *, tracked=None):
    row = (
        await db.execute(
            care_query(owner, generation, child_id, BabyRecord.occurred_at, BabyRecord.data,
                       *([BabyRecord.id, BabyRecord.space_id, BabyRecord.generation, BabyRecord.revision] if tracked is not None else []))
            .where(BabyRecord.kind == "feeding", BabyRecord.occurred_at <= at)
            # Ties break as feed settlement does, so "last" and "running" are the same feed.
            .order_by(BabyRecord.occurred_at.desc(), BabyRecord.id.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    if tracked is not None:
        tracked["records"][row.id] = (row.space_id, row.generation, row.revision)
    data = row.data if isinstance(row.data, dict) else {}
    details = {key: text_in(data, key) for key in ("method", "side", "unit")}
    details |= {key: number_in(data.get(key)) for key in ("amount", "duration_minutes")}
    return {
        "at": row.occurred_at.astimezone(zone).isoformat(),
        **{key: value for key, value in details.items() if value is not None},
        "suggested_next_side": next_side(data),
    }


def text_in(data, key):
    """A categorical value from stored JSON; older or malformed rows may hold anything."""
    value = data.get(key)
    return value if isinstance(value, str) else None


def minutes_between(start, end):
    return (end.astimezone(UTC) - start.astimezone(UTC)).total_seconds() / 60


def number_in(value):
    """A usable non-negative number from stored JSON, or None."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return value if math.isfinite(value) and value >= 0 else None


def sleep_end(data):
    """The stored end of a sleep: a time, None when still open, False when unusable."""
    value = data.get("end_at")
    if value is None:
        return None
    try:
        moment = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return False
    return moment if moment.tzinfo else False


def rounded(value):
    return round(value, 1)


def average(total, days):
    return rounded(total / days) if days else None


def summarize(rows, stats_range, zone, *, complete=True):
    """Totals for rows already scoped to one child; sleeps may start before the range."""
    start, end = stats_range.start.astimezone(UTC), stats_range.end.astimezone(UTC)
    days = {
        day: {
            "date": day.isoformat(),
            # Rolling windows cut both of their days short; today is always unfinished.
            "partial": day_start(day, zone) < start or day_start(day + timedelta(days=1), zone) > end,
            "feeding": {
                "count": 0, "left": 0, "right": 0, "both": 0,
                "bottle_ml": 0, "bottle_oz": 0, "breast_minutes": 0,
            },
            "diapers": {"count": 0, "pee": 0, "poo": 0, "dry": 0},
            "sleep": {"total_minutes": 0, "longest_minutes": 0},
        }
        for day in stats_range.days
    }
    feed_times, bottles, timed, unusable, open_sleeps, slept_spans = [], 0, 0, 0, [], []
    unknown_ends = 0
    for row in rows:
        data = row.data if isinstance(row.data, dict) else {}
        at = row.occurred_at.astimezone(UTC)
        if at >= end:
            continue
        if row.kind == "sleep":
            stop = sleep_end(data)
            if stop is None:
                open_sleeps.append({"record_id": str(row.id), "started_at": row.occurred_at.astimezone(zone).isoformat()})
            elif stop is False or stop.astimezone(UTC) <= at:
                unusable += at >= start
            else:
                span = max(at, start), min(stop.astimezone(UTC), end)
                if span[0] < span[1]:
                    slept_spans.append(span)
            continue
        if at < start:
            continue
        day = days[at.astimezone(zone).date()]
        if row.kind == "diaper":
            kind = text_in(data, "type")
            day["diapers"]["count"] += 1
            day["diapers"]["pee"] += kind in {"wet", "both"}
            day["diapers"]["poo"] += kind in {"dirty", "both"}
            day["diapers"]["dry"] += kind == "dry"
            continue
        if row.kind != "feeding":
            continue
        feed_times.append(at)
        totals, method = day["feeding"], text_in(data, "method")
        totals["count"] += 1
        if method == "breast":
            side = text_in(data, "side")
            if side in {"left", "right", "both"}:
                totals[side] += 1
            duration = number_in(data.get("duration_minutes"))
            # A feed nobody finished still happened, but how long it lasted is not known.
            if text_in(data, "state") == "unknown_end":
                unknown_ends += 1
            elif duration is not None:
                totals["breast_minutes"] += duration
                timed += 1
        elif method == "bottle":
            bottles += 1
            amount = number_in(data.get("amount"))
            if amount:
                # Stored amounts with no unit are shown as mL by the app.
                totals["bottle_oz" if text_in(data, "unit") == "oz" else "bottle_ml"] += amount
    # Two parents can log the same nap; time asleep is counted once.
    spans = merged_spans(slept_spans)
    for span in spans:
        add_sleep(days, *span, zone)
    sleeps = len(spans)
    longest = max((minutes_between(*span) for span in spans), default=0)
    finished = [day for day in days.values() if not day["partial"]]

    def total(category, key, among=None):
        return sum(day[category][key] for day in (days.values() if among is None else among))

    def logged(category, key):
        return [day for day in finished if day[category][key]]

    fed, changed, slept = logged("feeding", "count"), logged("diapers", "count"), logged("sleep", "total_minutes")
    for day in days.values():
        for key in ("breast_minutes", "bottle_ml", "bottle_oz"):
            day["feeding"][key] = rounded(day["feeding"][key])
        for key in ("total_minutes", "longest_minutes"):
            day["sleep"][key] = rounded(day["sleep"][key])
    return {
        "range": {
            "kind": stats_range.kind,
            "start": stats_range.start.astimezone(zone).isoformat(),
            "end": stats_range.end.astimezone(zone).isoformat(),
        },
        "complete": complete,
        "days": list(days.values()),
        "feeding": {
            "count": total("feeding", "count"),
            "average_per_day": average(total("feeding", "count", fed), len(fed)),
            "average_gap_minutes": average_gap(feed_times, zone),
            "left": total("feeding", "left"),
            "right": total("feeding", "right"),
            "both": total("feeding", "both"),
            "bottle_count": bottles,
            "bottle_ml": rounded(total("feeding", "bottle_ml")),
            "bottle_oz": rounded(total("feeding", "bottle_oz")),
            "breast_minutes": rounded(total("feeding", "breast_minutes")),
            "timed_breast_feeds": timed,
            "unknown_end_feeds": unknown_ends,
            "days_logged": len(fed),
            "days_total": len(finished),
        },
        "diapers": {
            "count": total("diapers", "count"),
            "pee": total("diapers", "pee"),
            "poo": total("diapers", "poo"),
            "dry": total("diapers", "dry"),
            "average_per_day": average(total("diapers", "count", changed), len(changed)),
            "days_logged": len(changed),
            "days_total": len(finished),
        },
        "sleep": {
            "total_minutes": rounded(total("sleep", "total_minutes")),
            "average_minutes_per_day": average(total("sleep", "total_minutes", slept), len(slept)),
            "longest_minutes": rounded(longest),
            "sleeps": sleeps,
            "open": sorted(open_sleeps, key=lambda item: item["started_at"]),
            "unusable": unusable,
            "days_logged": len(slept),
            "days_total": len(finished),
        },
    }


def merged_spans(spans):
    """Overlapping or touching sleeps become one."""
    merged = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def day_pieces(start, end, zone):
    """One span cut at each midnight it crosses."""
    day = start.astimezone(zone).date()
    while start < end:
        next_day = day + timedelta(days=1)
        stop = min(end, day_start(next_day, zone))
        yield day, start, stop
        start, day = stop, next_day


def add_sleep(days, start, end, zone):
    """Split one sleep by overlap across the calendar days it touches."""
    for day, piece_start, piece_end in day_pieces(start, end, zone):
        minutes = minutes_between(piece_start, piece_end)
        totals = days[day]["sleep"]
        totals["total_minutes"] += minutes
        totals["longest_minutes"] = max(totals["longest_minutes"], minutes)


def add_sleep_spans(days, rows, stats_range, zone):
    """Each finished sleep inside each day, by record, unmerged. Totals merge overlaps, so these
    are what lets a phone swap one queued sleep into a day without guessing at the rest."""
    by_date = {day["date"]: day for day in days}
    for day in days:
        day["sleep"]["spans"] = []
    for row in rows:
        stop = sleep_end(row.data) if row.kind == "sleep" and isinstance(row.data, dict) else None
        if not stop:
            continue
        start, end = max(row.occurred_at.astimezone(UTC), stats_range.start), min(stop.astimezone(UTC), stats_range.end)
        for day, piece_start, piece_end in day_pieces(start, end, zone):
            if day.isoformat() in by_date:
                by_date[day.isoformat()]["sleep"]["spans"].append(
                    {"record_id": str(row.id), "from": piece_start.isoformat(), "to": piece_end.isoformat()}
                )


def average_gap(times, zone):
    """Start to start, skipping any gap across a day with no feeds: that is missing data, not a gap."""
    times = sorted(times)
    gaps = [
        minutes_between(earlier, later)
        for earlier, later in zip(times, times[1:], strict=False)
        if (later.astimezone(zone).date() - earlier.astimezone(zone).date()).days <= 1
    ]
    return average(sum(gaps), len(gaps))
