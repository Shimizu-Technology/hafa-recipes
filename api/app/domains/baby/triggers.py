"""What should be waiting for each person, worked out from committed records, and what each reminder says.

Only the worker plans, so a reminder problem can never touch the transaction that saves a log. A
commit wakes it, and a periodic sweep picks up what no write announces: the next date of a repeating
event, and anything a restart missed. Planning only reads; applying a plan is one short transaction.

Wording here states facts and carries no advice, and is only ever shown on the person's own Today.
Each reminder's reason is checked again when it is read, so a late plan is harmless.
"""

from datetime import UTC, datetime, time, timedelta
from itertools import islice
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import and_, func, or_, select, update

from app.domains.baby.events import (
    Window,
    event_query,
    event_rows,
    occurrence_stream,
    occurrences_of,
    window_for,
)
from app.domains.baby.lifecycle import FEED_START_TOLERANCE, now
from app.domains.baby.models import BabyChild, BabyImport, BabyNotification, BabyRecord
from app.domains.baby.push import REMINDER_KINDS, load_prefs, quiet_until
from app.domains.baby.queries import child_timing, records_query, timing_filter
from app.domains.baby.reminders import (
    LOCK_SCREEN,
    QUIET_HELD,
    RESOLVERS,
    Words,
    cancel,
    may_hear,
    reminder_access,
    restore,
    schedule,
)
from app.domains.baby.schemas import EventData, Profile
from app.domains.baby.stats import care_query, kind_query, sleep_end
from app.models.identity import AppUser

PLAN_AHEAD = timedelta(days=2)  # Far longer than the gap between sweeps, in case some are missed.
GRACE = timedelta(hours=1)  # A reminder this late still goes; later than this, Today has moved on.
TIMED_EVENT_STAYS = timedelta(hours=1)  # A timed event with no end leaves Today this long after it starts.
ALL_DAY_HOUR = time(9)  # An all-day event has no start worth waking anyone for.
PREP_HOUR = time(18)  # The evening before a visit.
MAX_OCCURRENCES = 100  # Per event and plan; daily repeats at the longest lead time stay below it.
IMPORT_DONE = ("ready", "incomplete", "failed")
IMPORT_NOTICE = timedelta(hours=6)  # Older than this, a restart isn't a reason to mention it.
FEED_TOO_LATE = timedelta(hours=12)  # Turning this on is not a reason to mention last week's feed.
RUNNING_RECENT = timedelta(hours=36)  # An older timer was forgotten, not running.
# Not advice: how long a timer can be left on before someone probably wants to know.
RUNNING_FEED_HOURS, RUNNING_SLEEP_HOURS = 1, 4
WEEK_HOUR = time(9)

# Pregnancy weeks and visit prep use the plain line: a lock screen shouldn't announce either.
LOCK_SCREEN.update({
    "event": "You have something on your calendar.",
    "import": "A saved post has an update.",
    "feed_interval": "Feed reminder.",
    "running_timer": "A timer is still running.",
    "routine": "A moment for your routine.",
})


class Plan:
    """What should be waiting for one person. ``owned`` kinds lose any row the plan doesn't name."""

    def __init__(self, person):
        self.person, self.owned, self.wanted, self.rows = person, set(), set(), []

    def keep(self, kind, key):
        self.owned.add(kind)
        self.wanted.add(f"{kind}:{self.person}:{key}")

    def add(self, kind, key, space_id, due_at, payload):
        self.keep(kind, key)
        self.rows.append({"kind": kind, "key": key, "space_id": space_id, "due_at": due_at, "payload": payload})


async def readable(db, access, model, identifier):
    """A record this person can read today, or None."""
    row = await db.scalar(select(model).where(
        model.id == identifier, access.condition(model),
    ).execution_options(populate_existing=True))
    return None if row is None or getattr(row, "deleted_at", None) else row


def local_zone(access):
    return ZoneInfo(Profile.model_validate(access.member.profile).timezone)


def clipped(value, limit=120):
    value = " ".join(value.split())
    return value if len(value) <= limit else value[:limit - 1].rstrip() + "…"


def day_words(day, today):
    if day == today:
        return "today"
    if day == today + timedelta(days=1):
        return "tomorrow"
    return f"on {day.strftime('%b')} {day.day}"


def when_words(moment, all_day, zone, today):
    local = moment.astimezone(zone)
    day = day_words(local.date(), today)
    if all_day:
        return day
    clock = local.strftime("%I:%M %p").lstrip("0")
    return f"at {clock}" if day == "today" else f"{day} at {clock}"


# Event reminders: at the times set on the event, through its repeats and changes.


def event_key(event_id, original, start, minutes):
    return f"{event_id}:{int(original.timestamp())}:{int(start.timestamp())}:{minutes}"


def event_due(item, minutes):
    if item.all_day:
        start = datetime.combine(item.start.astimezone(item.zone).date(), ALL_DAY_HOUR, item.zone)
    else:
        start = item.start
    return start.astimezone(UTC) - timedelta(minutes=minutes)


def event_expiry(item):
    return item.end or item.start + TIMED_EVENT_STAYS


async def plan_events(db, plan, access, prefs, moment):
    plan.owned.add("event")
    window = Window(moment - TIMED_EVENT_STAYS, moment + PLAN_AHEAD + timedelta(days=30))
    query = event_query(access, access.member.generation, None, window).add_columns(BabyRecord.space_id)
    async for row in event_rows(db, query):
        try:
            minutes = EventData.model_validate(row.data).reminder_minutes
        except ValidationError:
            continue  # From before these rules.
        if not minutes or not may_hear(access, "event", row.space_id):
            continue
        ahead = Window(moment - TIMED_EVENT_STAYS, moment + PLAN_AHEAD + timedelta(minutes=max(minutes)))
        for item in islice(occurrence_stream(row, ahead), MAX_OCCURRENCES):
            if event_expiry(item) <= moment:
                continue
            for lead in minutes:
                due = event_due(item, lead)
                if due > moment + PLAN_AHEAD:
                    continue
                key = event_key(row.id, item.original, item.start, lead)
                plan.keep("event", key)
                if due >= moment - GRACE:
                    plan.add("event", key, row.space_id, due, {
                        "event_id": str(row.id), "original": item.original.isoformat(),
                        "start": item.start.isoformat(), "minutes": lead,
                        "expires_at": event_expiry(item).isoformat(),
                    })


async def event_words(db, row, access, prefs):
    event = await readable(db, access, BabyRecord, UUID(row.payload["event_id"]))
    if event is None or event.kind != "event":
        return None
    start, original = (datetime.fromisoformat(row.payload[key]) for key in ("start", "original"))
    item = next((
        item for item in occurrences_of(event, start, start + timedelta(seconds=1))
        if item.original == original and item.start == start
    ), None)
    if item is None or row.payload["minutes"] not in item.event.reminder_minutes:
        return None
    zone = local_zone(access)
    when = when_words(item.start, item.all_day, zone, now().astimezone(zone).date())
    return Words(
        f"{clipped(item.item()['title'])} {when}.",
        {"event_id": str(event.id), "original_start": original.isoformat()},
        event_due(item, row.payload["minutes"]),
    )


# Visit prep: the questions someone saved, the evening before. Read under each person's own access,
# so one parent's private question is only ever counted for them.


async def questions_for_day(db, access, zone, day):
    window = window_for(day, day, zone)
    query = event_query(access, access.member.generation, None, window)
    events = set()
    async for row in event_rows(db, query):
        if any(day in item.days(zone) for item in occurrence_stream(row, window)):
            events.add(str(row.id))
    if not events:
        return []
    return list(await db.scalars(
        kind_query(access, access.member.generation, ("question",), BabyRecord.space_id).where(
            BabyRecord.data["event_id"].as_string().in_(events)
        )
    ))


async def plan_visit_prep(db, plan, access, prefs, moment):
    plan.owned.add("visit_prep")
    zone = local_zone(access)
    today = moment.astimezone(zone).date()
    for day in (today, today + timedelta(days=1), today + timedelta(days=2)):
        due = datetime.combine(day - timedelta(days=1), PREP_HOUR, zone).astimezone(UTC)
        spaces = await questions_for_day(db, access, zone, day)
        # A family question is in the family space; the same row covers any of the person's own.
        hearable = sorted((space for space in spaces if may_hear(access, "visit_prep", space)), key=str)
        if not hearable:
            continue
        family = next((space for space in hearable if space != access.personal_space_id), hearable[0])
        plan.keep("visit_prep", day.isoformat())
        if moment - GRACE <= due <= moment + PLAN_AHEAD:
            plan.add("visit_prep", day.isoformat(), family, due, {
                "date": day.isoformat(),
                "expires_at": datetime.combine(day + timedelta(days=1), time(), zone).isoformat(),
            })


async def visit_prep_words(db, row, access, prefs):
    zone = local_zone(access)
    day = datetime.fromisoformat(row.payload["date"]).date()
    count = len(await questions_for_day(db, access, zone, day))
    if not count:
        return None
    what = "a question" if count == 1 else f"{count} questions"
    return Words(
        f"You have {what} for {day_words(day, now().astimezone(zone).date())}.", {"date": day.isoformat()},
        datetime.combine(day - timedelta(days=1), PREP_HOUR, zone).astimezone(UTC),
    )


# Imports: only the person who asked hears about it, as soon as a pass sees it finished.


async def plan_imports(db, plan, access, prefs, moment):
    jobs = await db.scalars(select(BabyImport).where(
        access.condition(BabyImport), BabyImport.app_user_id == plan.person,
        BabyImport.status.in_(IMPORT_DONE), BabyImport.updated_at >= moment - IMPORT_NOTICE,
        BabyImport.consent_epoch == access.member.consent_epoch,
    ).execution_options(populate_existing=True))
    for job in jobs:
        if may_hear(access, "import", job.space_id):
            plan.add("import", f"{job.id}:{job.attempts}", job.space_id, job.updated_at, {
                "import_id": str(job.id), "record_id": str(job.record_id), "status": job.status,
                "attempts": job.attempts, "consent_epoch": job.consent_epoch,
            })
    plan.owned.discard("import")  # An old notice stays on Today until dismissed, or the job moves on.


async def import_words(db, row, access, prefs):
    job = await readable(db, access, BabyImport, UUID(row.payload["import_id"]))
    source = await readable(db, access, BabyRecord, UUID(row.payload["record_id"]))
    if job is None or source is None or (job.status, job.attempts) != (row.payload["status"], row.payload["attempts"]):
        return None
    data = {"record_id": str(source.id)}
    title = clipped(source.title)
    if job.status == "ready":
        return Words(f"{title} is ready.", data)
    return Words(f"{title} couldn't finish. Your original is kept.", data)


# Feed reminder: hours after the last feed, moved by every feed on any phone. Each parent has their
# own setting and their own row, and care rows can only be read through the space they are in.


def duration_words(elapsed):
    """Rounded down to the half hour, so it never claims more time than has passed."""
    halves = int(elapsed.total_seconds() // 1800)
    if halves < 2:
        return "30 minutes"
    hours = halves / 2
    return "1 hour" if hours == 1 else f"{hours:g} hours"


def newest_feed(access, space_id, child_id, moment):
    """The feed the clock runs from. One dated ahead has not happened yet, as for running feeds."""
    return (
        care_query(access, access.member.generation, child_id, BabyRecord)
        .where(BabyRecord.kind == "feeding", BabyRecord.space_id == space_id,
               BabyRecord.occurred_at <= moment + FEED_START_TOLERANCE)
        .order_by(BabyRecord.occurred_at.desc(), BabyRecord.id.desc())
        .limit(1)
        .execution_options(populate_existing=True)
    )


async def plan_feeds(db, plan, access, prefs, moment):
    """One reminder for each child, always from the newest feed; a running one has none yet."""
    plan.owned.add("feed_interval")
    hours = prefs.kind("feed_interval").hours
    clocks = await db.execute(
        kind_query(access, access.member.generation, ("feeding",), BabyRecord.space_id, BabyRecord.child_id).distinct()
    )
    for space_id, child_id in clocks.all():
        if not may_hear(access, "feed_interval", space_id):
            continue
        feed = await db.scalar(newest_feed(access, space_id, child_id, moment))
        if feed is None or feed.data.get("state") == "running":
            continue
        due = feed.occurred_at + timedelta(hours=hours)
        if moment - due <= FEED_TOO_LATE:
            plan.add("feed_interval", f"{feed.id}:{int(feed.occurred_at.timestamp())}:{hours:g}", space_id, due, {
                "record_id": str(feed.id), "child_id": str(child_id) if child_id else None,
            })


async def child_name(db, access, child_id):
    child = child_id and await readable(db, access, BabyChild, child_id)
    return clipped(child.name) if child else None


async def feed_words(db, row, access, prefs):
    feed = await readable(db, access, BabyRecord, UUID(row.payload["record_id"]))
    if feed is None or feed.kind != "feeding" or feed.data.get("state") == "running":
        return None
    moment = now()
    newest = await db.scalar(newest_feed(access, feed.space_id, feed.child_id, moment))
    due = feed.occurred_at + timedelta(hours=prefs.kind("feed_interval").hours)
    if newest is None or newest.id != feed.id or moment - due > FEED_TOO_LATE:
        return None
    elapsed = duration_words(moment - feed.occurred_at)
    name = await child_name(db, access, feed.child_id)
    return Words(
        f"It's been {elapsed} since {name}'s last feed." if name else f"It's been {elapsed} since the last feed.",
        {"record_id": str(feed.id), "child_id": str(feed.child_id) if feed.child_id else None},
        due,
    )


# A timer left running: a feed still going, or a sleep with no end.


def still_running(row):
    return row.data.get("state") == "running" if row.kind == "feeding" else sleep_end(row.data) is None


def running_hours(pref, kind):
    return (pref.feed_hours or RUNNING_FEED_HOURS) if kind == "feeding" else (pref.sleep_hours or RUNNING_SLEEP_HOURS)


async def plan_running(db, plan, access, prefs, moment):
    plan.owned.add("running_timer")
    pref = prefs.kind("running_timer")
    rows = await db.scalars(
        kind_query(access, access.member.generation, ("feeding", "sleep"), BabyRecord)
        .where(BabyRecord.occurred_at >= moment - RUNNING_RECENT, BabyRecord.occurred_at <= moment)
        .order_by(BabyRecord.occurred_at)
        .execution_options(populate_existing=True)
    )
    for row in rows:
        if not still_running(row) or not may_hear(access, "running_timer", row.space_id):
            continue
        hours = running_hours(pref, row.kind)
        plan.add("running_timer", f"{row.id}:{int(row.occurred_at.timestamp())}:{hours:g}", row.space_id,
                 row.occurred_at + timedelta(hours=hours), {"record_id": str(row.id)})


async def running_words(db, row, access, prefs):
    record = await readable(db, access, BabyRecord, UUID(row.payload["record_id"]))
    if record is None or record.kind not in {"feeding", "sleep"} or not still_running(record):
        return None
    hours = running_hours(prefs.kind("running_timer"), record.kind)
    name = await child_name(db, access, record.child_id)
    what = "feed" if record.kind == "feeding" else "sleep"
    subject = f"{name}'s {what} timer" if name else f"The {what} timer"
    return Words(
        f"{subject} has been running for {duration_words(now() - record.occurred_at)}.",
        {"record_id": str(record.id), "child_id": str(record.child_id) if record.child_id else None},
        record.occurred_at + timedelta(hours=hours),
    )


# A new pregnancy week, and what the person saved for it. Timing is ``queries.py``'s, as on Saved.


def week_start(child, week):
    return child.due_date - timedelta(days=280 - week * 7)


async def plan_pregnancy_weeks(db, plan, access, prefs, moment):
    plan.owned.add("pregnancy_week")
    zone = local_zone(access)
    today = moment.astimezone(zone).date()
    children = await db.scalars(select(BabyChild).where(
        access.condition(BabyChild), BabyChild.deleted_at.is_(None), BabyChild.due_date.is_not(None),
    ).execution_options(populate_existing=True))
    for child in children:
        timing = child_timing(child, today)
        if not timing or timing["stage"] != "pregnancy" or not may_hear(access, "pregnancy_week", child.space_id):
            continue
        # This week's stays on Today once sent; next week's is what gets queued.
        for week in (timing["pregnancy_week"], timing["pregnancy_week"] + 1):
            if week < 1:
                continue
            first_day = week_start(child, week)
            key = f"{child.id}:{week}:{child.due_date.isoformat()}"
            plan.keep("pregnancy_week", key)
            due = datetime.combine(first_day, WEEK_HOUR, zone).astimezone(UTC)
            if moment - GRACE <= due <= moment + PLAN_AHEAD:
                plan.add("pregnancy_week", key, child.space_id, due, {
                    "child_id": str(child.id), "week": week,
                    "expires_at": datetime.combine(first_day + timedelta(days=7), time(), zone).isoformat(),
                })


async def pregnancy_week_words(db, row, access, prefs):
    child = await readable(db, access, BabyChild, UUID(row.payload["child_id"]))
    if child is None or child.due_date is None:
        return None
    zone, moment, week = local_zone(access), now(), row.payload["week"]
    due = datetime.combine(week_start(child, week), WEEK_HOUR, zone).astimezone(UTC)
    if due > moment:  # Its first morning hasn't come where this person is now, so it waits rather than stops.
        return Words(f"Week {week} is here.", {"child_id": str(child.id), "week": week}, due)
    timing = child_timing(child, moment.astimezone(zone).date())
    if not timing or timing.get("pregnancy_week") != week:
        return None
    saved = await db.scalar(
        select(func.count()).select_from(
            records_query(access, access.member.generation)
            .where(timing_filter("now", "pregnancy", week)).subquery()
        )
    )
    tips = f", and you saved {'a tip' if saved == 1 else f'{saved} tips'} for it" if saved else ""
    return Words(f"Week {week} is here{tips}.", {"child_id": str(child.id), "week": week}, due)


# Routines: a phone that holds one fires it itself, so this row is for Today and for phones that don't.


ROUTINE_STAYS = timedelta(hours=24)  # On Today, unless the next one comes first or it is dismissed.


def routine_schedule(data):
    """What a phone reports holding. An edit that doesn't change when it fires doesn't change this."""
    return f"{data.get('reminder_at')}|{data.get('repeat') or 'none'}|{data.get('timezone') or ''}"


def routine_times(data, moment):
    """When it fires, from a day before ``moment`` to ``PLAN_AHEAD`` after. A repeat keeps its wall clock in its own zone."""
    try:
        start = datetime.fromisoformat(data["reminder_at"])
        zone = ZoneInfo(data.get("timezone") or "UTC")
        first = start.astimezone(zone)
    except (KeyError, TypeError, ValueError, ZoneInfoNotFoundError):
        return
    earliest, latest = moment - ROUTINE_STAYS, moment + PLAN_AHEAD
    repeat = data.get("repeat") or "none"
    if repeat == "none":
        if earliest <= start <= latest:
            yield start.astimezone(UTC)
        return
    day, last = max(first.date(), earliest.astimezone(zone).date()), latest.astimezone(zone).date()
    while day <= last:
        if repeat == "daily" or day.weekday() == first.weekday():
            due = datetime.combine(day, first.timetz().replace(tzinfo=None), zone).astimezone(UTC)
            if due >= start and earliest <= due <= latest:
                yield due
        day += timedelta(days=1)


def routine_stands(data):
    return bool(data.get("enabled")) and bool(data.get("reminder_at")) and not (
        data.get("items") and all(item.get("done") for item in data["items"])
    )


async def plan_routines(db, plan, access, prefs, moment):
    plan.owned.add("routine")
    rows = await db.scalars(
        kind_query(access, access.member.generation, ("routine",), BabyRecord).execution_options(populate_existing=True)
    )
    for row in rows:
        if not routine_stands(row.data) or not may_hear(access, "routine", row.space_id):
            continue
        times = list(routine_times(row.data, moment))
        past = [due for due in times if due <= moment]
        # Only the newest that has passed stays on Today, and only one that's recent is worth bringing up now.
        for due in [*past[-1:], *(due for due in times if due > moment)]:
            key = f"{row.id}:{int(due.timestamp())}"
            plan.keep("routine", key)
            if due >= moment - GRACE:
                plan.add("routine", key, row.space_id, due, {
                    "record_id": str(row.id), "schedule": routine_schedule(row.data),
                    "expires_at": (due + ROUTINE_STAYS).isoformat(),
                })


async def routine_words(db, row, access, prefs):
    record = await readable(db, access, BabyRecord, UUID(row.payload["record_id"]))
    if record is None or record.kind != "routine" or not routine_stands(record.data):
        return None
    schedule_now = routine_schedule(record.data)
    if schedule_now != row.payload["schedule"]:
        return None
    return Words(
        f"Reminder: {clipped(record.title)}.",
        {"record_id": str(record.id), "child_id": str(record.child_id) if record.child_id else None},
        held_as=(str(record.id), schedule_now),
    )


# STUB until K4a (milestones) and K4b (well visits) land with approved content. The settings exist so
# the app can show them; nothing is scheduled, and no window or age may be written here without that review.
STUB_KINDS = ("milestone_window", "well_visit")


async def nothing_yet(db, row, access, prefs):
    return None


RESOLVERS.update({
    "event": event_words, "visit_prep": visit_prep_words, "import": import_words, "feed_interval": feed_words,
    "running_timer": running_words, "pregnancy_week": pregnancy_week_words, "routine": routine_words,
    **dict.fromkeys(STUB_KINDS, nothing_yet),
})
PLANNERS = {
    "event": plan_events, "visit_prep": plan_visit_prep, "import": plan_imports, "feed_interval": plan_feeds,
    "running_timer": plan_running, "pregnancy_week": plan_pregnancy_weeks, "routine": plan_routines,
}


# Entry points for the worker.


async def recheck_holds(db, person, prefs, moment):
    """Quiet hours as they are now. Only a hold of ours moves: a provider's backoff is left to run."""
    table, until = BabyNotification, quiet_until(prefs.quiet_hours, moment)
    through = [kind for kind in REMINDER_KINDS if prefs.kind(kind).break_through]
    held = (table.app_user_id == person, table.status == "queued", table.last_error == QUIET_HELD)
    await db.execute(
        update(table)
        .where(*held, or_(until is None, table.kind.in_(through)))
        .values(lease_until=None, last_error=None)
        .execution_options(synchronize_session=False)
    )
    if until:
        await db.execute(
            update(table)
            .where(*held, table.lease_until != until)
            .values(lease_until=until)
            .execution_options(synchronize_session=False)
        )


async def apply_plan(db, plan, spaces, off, prefs, moment):
    """Written in the lock order everyone else uses: the person first, as a foreign key would, then rows."""
    await db.scalar(select(AppUser.id).where(AppUser.id == plan.person).with_for_update(read=True, key_share=True))
    for row in plan.rows:
        await schedule(db, owner=plan.person, **row)
    await restore(db, plan.person, plan.wanted)
    await recheck_holds(db, plan.person, prefs, moment)
    table = BabyNotification
    await cancel(db, table.app_user_id == plan.person, or_(
        table.kind.in_(off),
        table.space_id.not_in(spaces),
        and_(table.kind.in_(plan.owned), table.idempotency_key.not_in(plan.wanted)),
    ))


async def plan_person(db, person):
    """Bring one person's reminders in line with what they can read and have turned on, in one transaction."""
    plan = Plan(person)
    try:
        access = await reminder_access(db, person)
    except HTTPException:
        await cancel(db, BabyNotification.app_user_id == person)  # No longer in Baby.
        return
    prefs = await load_prefs(db, person, access.personal_space_id)
    moment = now()
    for kind, planner in PLANNERS.items():
        if prefs.kind(kind).enabled:
            await planner(db, plan, access, prefs, moment)
    spaces = [grant.id for grant in access.spaces] if access.enabled else [access.personal_space_id]
    off = [kind for kind in REMINDER_KINDS if not prefs.kind(kind).enabled]
    await apply_plan(db, plan, spaces, off, prefs, moment)
