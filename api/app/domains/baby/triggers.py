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
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import and_, or_, select, update

from app.domains.baby.events import (
    Window,
    event_query,
    event_rows,
    occurrence_stream,
    occurrences_of,
    window_for,
)
from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyImport, BabyNotification, BabyRecord
from app.domains.baby.push import REMINDER_KINDS, load_prefs, quiet_until
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
from app.domains.baby.stats import kind_query
from app.models.identity import AppUser

PLAN_AHEAD = timedelta(days=2)  # Far longer than the gap between sweeps, in case some are missed.
GRACE = timedelta(hours=1)  # A reminder this late still goes; later than this, Today has moved on.
TIMED_EVENT_STAYS = timedelta(hours=1)  # A timed event with no end leaves Today this long after it starts.
ALL_DAY_HOUR = time(9)  # An all-day event has no start worth waking anyone for.
PREP_HOUR = time(18)  # The evening before a visit.
MAX_OCCURRENCES = 100  # Per event and plan; daily repeats at the longest lead time stay below it.
IMPORT_DONE = ("ready", "incomplete", "failed")
IMPORT_NOTICE = timedelta(hours=6)  # Older than this, a restart isn't a reason to mention it.

LOCK_SCREEN.update({
    "event": "You have something on your calendar.",
    "import": "A saved post has an update.",
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


RESOLVERS.update({"event": event_words, "visit_prep": visit_prep_words, "import": import_words})
PLANNERS = {"event": plan_events, "visit_prep": plan_visit_prep, "import": plan_imports}


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
