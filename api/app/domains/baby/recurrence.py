"""Repeat maths for calendar events. Pure: no database, no schemas.

An occurrence keeps the wall-clock time of the first one in the event's own time zone, so a
9 AM appointment stays at 9 AM across a clock change. Each date is worked out from the first
occurrence, never from the previous one, so a Jan 31 monthly repeat is Feb 28, then Mar 31.

A series split off from a later date keeps counting from the date the repeat first had, its
anchor, so going on from that Feb 28 is still Mar 31.
"""

import calendar
from datetime import UTC, date, datetime, timedelta


def nth_date(anchor, frequency, interval, n):
    """The date of occurrence ``n``, clamped to the last day of a shorter month."""
    if frequency == "daily":
        return anchor + timedelta(days=interval * n)
    if frequency == "weekly":
        return anchor + timedelta(weeks=interval * n)
    if frequency == "monthly":
        year, month = divmod(anchor.year * 12 + anchor.month - 1 + interval * n, 12)
        month += 1
    else:
        year, month = anchor.year + interval * n, anchor.month
    # Feb 29 yearly lands on Feb 28 in a year without one.
    return date(year, month, min(anchor.day, calendar.monthrange(year, month)[1]))


def first_index(frequency, interval, anchor, earliest):
    """An index no later than any occurrence on or after ``earliest``: no walking from year one."""
    if frequency in {"daily", "weekly"}:
        step = interval * (7 if frequency == "weekly" else 1)
        gap = (earliest - anchor).days // step
    elif frequency == "monthly":
        gap = ((earliest.year - anchor.year) * 12 + earliest.month - anchor.month) // interval
    else:
        gap = (earliest.year - anchor.year) // interval
    return max(0, gap - 1)


def falls_on(anchor, frequency, interval, day):
    """Whether counting from ``anchor`` gives ``day``."""
    if day < anchor:
        return False
    n = first_index(frequency, interval, anchor, day)
    while (found := nth_date(anchor, frequency, interval, n)) < day:
        n += 1
    return found == day


def starts_between(start, zone, rule, lo, hi):
    """Original starts ``s`` with ``lo <= s < hi``, in order. ``rule`` is (frequency, interval, until, anchor)."""
    if rule is None:
        if lo <= start < hi:
            yield start
        return
    frequency, interval, until, anchor = rule
    local = start.astimezone(zone)
    first = local.date()
    anchor = anchor or first
    n = first_index(frequency, interval, anchor, max(first, lo.astimezone(zone).date()))
    while True:
        try:
            day = nth_date(anchor, frequency, interval, n)
        except (OverflowError, ValueError):
            return  # Past the last calendar year.
        n += 1
        if day < first:
            continue
        if until is not None and day > until:
            return
        # The first occurrence is the stored instant, exact even when the hour repeats at a clock change.
        moment = start if day == first else datetime.combine(day, local.time(), zone).astimezone(UTC)
        if moment >= hi:
            return
        if moment >= lo:
            yield moment


def is_start(start, zone, rule, moment):
    """Whether ``moment`` is exactly one of the series' original starts."""
    return next(starts_between(start, zone, rule, moment, moment + timedelta(microseconds=1)), None) == moment
