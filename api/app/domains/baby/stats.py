"""The one place care totals are computed; Ask, summaries and Stats all read these numbers.

Reports what was logged and never judges it. Days are the parent's calendar days. Today is
partial: it counts toward totals but not daily averages, and a day with nothing logged in a
category is left out of that category's averages rather than counted as zero.
"""

import math
from datetime import UTC, date, datetime, time, timedelta
from typing import NamedTuple

from sqlalchemy import and_, or_, select

from app.domains.baby.models import BabyRecord

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
    start, end = at - timedelta(hours=24), at
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
    """Today and the calendar days before it, ``count`` days in all."""
    today = at.astimezone(zone).date()
    return calendar_range(f"{count}d", today - timedelta(days=count - 1), today, zone, at)


def custom_days(first, last, zone, at):
    if (last - first).days >= MAX_CUSTOM_DAYS:
        raise ValueError(f"Choose {MAX_CUSTOM_DAYS} days or fewer")
    return calendar_range("custom", first, last, zone, at)


def care_query(owner, generation, child_id, *columns):
    """Who can see which care rows. ``child_id=None`` means logs with no child, as Today does."""
    return select(*columns).where(
        BabyRecord.app_user_id == owner,
        BabyRecord.generation == generation,
        BabyRecord.deleted_at.is_(None),
        BabyRecord.kind.in_(CARE_KINDS),
        BabyRecord.child_id == child_id if child_id else BabyRecord.child_id.is_(None),
    )


async def care_stats(db, owner, generation, child_id, zone, stats_range):
    rows = list(
        await db.execute(
            care_query(
                owner, generation, child_id,
                BabyRecord.id, BabyRecord.kind, BabyRecord.occurred_at, BabyRecord.data,
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
    return summarize(rows[:ROW_LIMIT], stats_range, zone, complete=len(rows) <= ROW_LIMIT)


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
    feed_times, bottles, timed, sleeps, longest, unusable, open_sleeps = [], 0, 0, 0, 0, 0, []
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
                overlap = minutes_between(max(at, start), min(stop.astimezone(UTC), end))
                if overlap > 0:
                    sleeps += 1
                    longest = max(longest, overlap)
                    add_sleep(days, max(at, start), min(stop.astimezone(UTC), end), zone)
            continue
        if at < start:
            continue
        day = days[at.astimezone(zone).date()]
        if row.kind == "diaper":
            kind = data.get("type")
            day["diapers"]["count"] += 1
            day["diapers"]["pee"] += kind in {"wet", "both"}
            day["diapers"]["poo"] += kind in {"dirty", "both"}
            day["diapers"]["dry"] += kind == "dry"
            continue
        feed_times.append(at)
        totals, method = day["feeding"], data.get("method")
        totals["count"] += 1
        if method == "breast":
            if data.get("side") in {"left", "right", "both"}:
                totals[data["side"]] += 1
            duration = number_in(data.get("duration_minutes"))
            if duration is not None:
                totals["breast_minutes"] += duration
                timed += 1
        elif method == "bottle":
            bottles += 1
            amount = number_in(data.get("amount"))
            if amount:
                # Stored amounts with no unit are shown as mL by the app.
                totals["bottle_oz" if data.get("unit") == "oz" else "bottle_ml"] += amount
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


def add_sleep(days, start, end, zone):
    """Split one sleep by overlap across the calendar days it touches."""
    day = start.astimezone(zone).date()
    while start < end:
        next_day = day + timedelta(days=1)
        stop = min(end, day_start(next_day, zone))
        minutes = minutes_between(start, stop)
        totals = days[day]["sleep"]
        totals["total_minutes"] += minutes
        totals["longest_minutes"] = max(totals["longest_minutes"], minutes)
        start, day = stop, next_day


def average_gap(times, zone):
    """Start to start, skipping any gap across a day with no feeds: that is missing data, not a gap."""
    times = sorted(times)
    gaps = [
        minutes_between(earlier, later)
        for earlier, later in zip(times, times[1:], strict=False)
        if (later.astimezone(zone).date() - earlier.astimezone(zone).date()).days <= 1
    ]
    return average(sum(gaps), len(gaps))
