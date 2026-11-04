"""Calendar: repeating events expanded into dated occurrences, and changes to one occurrence.

An occurrence is identified by its event and its original start, the instant the repeat rule
gave it, whatever an exception later does to it. Time zones are the event's own.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Annotated, NamedTuple
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from pydantic import AwareDatetime, ValidationError
from sqlalchemy import and_, or_

from app.domains.baby.dependencies import Client, Database, Generation, User
from app.domains.baby.lifecycle import membership_for, now, owned
from app.domains.baby.models import BabyChild, BabyRecord
from app.domains.baby.queries import legacy_client
from app.domains.baby.recurrence import is_start, starts_between
from app.domains.baby.schemas import (
    EVENT_YEARS,
    MAX_EVENT_DAYS,
    DomainModel,
    EventData,
    EventException,
    Profile,
    Revision,
)
from app.domains.baby.security import BabyRoute
from app.domains.baby.stats import day_start, kind_query

router = APIRouter(route_class=BabyRoute)
MAX_RANGE_DAYS = 400
MAX_OCCURRENCES = 500
ROW_LIMIT = 1000  # Events read for one range; a family has a few dozen.
# Longest an occurrence can run, plus a day, so one that began before the range is still found.
LOOKBACK = timedelta(days=MAX_EVENT_DAYS + 1)
MARK_KINDS = ("contraction", "kick_session")


class Occurrence(NamedTuple):
    row: BabyRecord
    event: EventData
    zone: ZoneInfo
    original: datetime
    start: datetime
    end: datetime | None
    all_day: bool
    changes: dict  # What an exception changed; empty for a regular occurrence.

    @property
    def sort_key(self):
        return self.start, str(self.row.id), self.original

    def days(self, profile_zone):
        """Calendar days it touches: an all-day event on its own calendar, others on the parent's."""
        zone = self.zone if self.all_day else profile_zone
        first = self.start.astimezone(zone).date()
        last = (self.end - timedelta(microseconds=1) if self.end and self.end > self.start else self.start)
        return [first + timedelta(days=n) for n in range((last.astimezone(zone).date() - first).days + 1)]

    def item(self):
        event, local = self.event, lambda moment: moment and moment.astimezone(self.zone).isoformat()
        return {
            "event_id": str(self.row.id),
            "original_start": local(self.original),
            "occurrence_start": local(self.start),
            "occurrence_end": local(self.end),
            "all_day": self.all_day,
            "timezone": event.timezone,
            "title": self.changes.get("title", self.row.title),
            "category": self.changes.get("category", event.category),
            "location": self.changes.get("location", event.location),
            "attendees": self.changes.get("attendees", event.attendees),
            "child_id": self.row.child_id,
            "repeats": event.recurrence is not None,
            "changed": bool(self.changes),
            "revision": self.row.revision,
        }


def shaped(row, event, zone, original, change):
    """The occurrence the rule gave at ``original``, with its exception (if any) applied."""
    start, local = row.occurred_at, row.occurred_at.astimezone(zone)
    span = event.end - start if event.end else None
    days = (event.end.astimezone(zone).date() - local.date()).days if event.all_day and event.end else 1
    day = original.astimezone(zone).date()
    end = day_start(day + timedelta(days=days), zone) if event.all_day else original + span if span else None
    changes = change.overrides.model_dump(exclude_unset=True) if change and change.overrides else {}
    if not changes:
        return Occurrence(row, event, zone, original, original, end, event.all_day, {})
    begin = changes.get("start") or original
    all_day = changes.get("all_day", event.all_day)
    if changes.get("end"):
        end = changes["end"]
    elif changes.get("start") is not None:
        # Moved, so the length carries over; a new all-day with no end is one day.
        moved = begin.astimezone(zone).date()
        end = day_start(moved + timedelta(days=days if event.all_day else 1), zone) if all_day else (
            begin + span if span and not event.all_day else None
        )
    return Occurrence(row, event, zone, original, begin, end, all_day, changes)


def occurrences_of(row, lo, hi):
    """Occurrences of one event that overlap [lo, hi), unordered."""
    try:
        event = EventData.model_validate(row.data)
        zone = ZoneInfo(event.timezone)
    except (ValidationError, ValueError):
        return []  # A row from before these rules; it cannot be placed on a calendar.
    rule = event.recurrence and (event.recurrence.frequency, event.recurrence.interval, event.recurrence.until)
    changes = {item.original_start: item for item in event.exceptions}
    originals = set(starts_between(row.occurred_at, zone, rule, lo - LOOKBACK, hi))
    # An occurrence moved into the range can be one the rule gave far outside it.
    originals |= {
        moment
        for moment, item in changes.items()
        if item.overrides and moment not in originals and is_start(row.occurred_at, zone, rule, moment)
    }
    found = []
    for original in originals:
        change = changes.get(original)
        if change and change.cancelled:
            continue
        found.append(shaped(row, event, zone, original, change))
    return [
        item for item in found
        if item.start < hi and (item.start >= lo or (item.end or item.start) > lo)
    ]


async def occurrences(db, owner, generation, child_id, lo, hi):
    """Every occurrence overlapping [lo, hi), in a fixed order, and whether none was left out.

    Reads all repeating events whatever their date, since a series begun years ago still shows.
    """
    recurring = BabyRecord.data["recurrence"].as_string().is_not(None)
    query = kind_query(owner, generation, ("event",), BabyRecord).where(
        or_(recurring, and_(BabyRecord.occurred_at < hi, BabyRecord.occurred_at >= lo - LOOKBACK))
    )
    if child_id:
        query = query.where(or_(BabyRecord.child_id == child_id, BabyRecord.child_id.is_(None)))
    rows = list(await db.scalars(query.order_by(BabyRecord.occurred_at, BabyRecord.id).limit(ROW_LIMIT + 1)))
    found = [item for row in rows[:ROW_LIMIT] for item in occurrences_of(row, lo, hi)]
    return sorted(found, key=lambda item: item.sort_key), len(rows) <= ROW_LIMIT


def check_range(first, last):
    if first > last:
        raise HTTPException(422, "Choose a start before the end")
    if (last - first).days >= MAX_RANGE_DAYS:
        raise HTTPException(422, f"Choose {MAX_RANGE_DAYS} days or fewer")
    if first.year - 1 not in EVENT_YEARS or last.year not in EVENT_YEARS:
        raise HTTPException(422, "Choose dates between 2000 and 2100")


async def day_marks(db, owner, generation, child_id, zone, first, last):
    """ISO date to the kinds on it that are not care totals, for ``/care/summary``'s dots.

    With a child: its events and the whole family's. Without: the whole family's, as for care logs.
    Contractions and kicks follow the care rule.
    """
    lo, hi = day_start(first, zone), day_start(last + timedelta(days=1), zone)
    marks = defaultdict(set)
    found, _ = await occurrences(db, owner, generation, child_id, lo, hi)
    for item in found:
        if child_id is None and item.row.child_id is not None:
            continue
        for day in item.days(zone):
            marks[day.isoformat()].add("event")
    rows = await db.execute(
        kind_query(owner, generation, MARK_KINDS, BabyRecord.kind, BabyRecord.occurred_at).where(
            BabyRecord.occurred_at >= lo,
            BabyRecord.occurred_at < hi,
            BabyRecord.child_id == child_id if child_id else BabyRecord.child_id.is_(None),
        )
    )
    for kind, at in rows:
        marks[at.astimezone(zone).date().isoformat()].add(kind)
    return marks


def only_current_clients(client):
    # Build 32 has no calendar; to it these routes do not exist.
    if legacy_client(client):
        raise HTTPException(404, "Not found")


@router.get("/events")
async def event_list(
    user: User,
    db: Database,
    first: Annotated[date, Query(alias="from")],
    last: Annotated[date, Query(alias="to")],
    child_id: UUID | None = None,
    client: Client = None,
):
    """Occurrences on the parent's calendar days ``from`` to ``to``, inclusive.

    With a child: that child's events and the whole family's. Without: every event.
    """
    only_current_clients(client)
    check_range(first, last)
    member = await membership_for(db, user.id)
    if child_id:
        await owned(db, BabyChild, user.id, member.generation, child_id)
    zone = ZoneInfo(Profile.model_validate(member.profile).timezone)
    lo, hi = day_start(first, zone), day_start(last + timedelta(days=1), zone)
    found, complete = await occurrences(db, user.id, member.generation, child_id, lo, hi)
    return {
        "items": [item.item() for item in found[:MAX_OCCURRENCES]],
        "complete": complete and len(found) <= MAX_OCCURRENCES,
        "from": first,
        "to": last,
    }


class OccurrenceChange(EventException):
    revision: Revision


class SeriesEnd(DomainModel):
    revision: Revision
    from_date: date


async def series_for_edit(db, user, generation, identifier, client):
    only_current_clients(client)
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned(db, BabyRecord, user.id, generation, identifier)
    if row.kind != "event":
        raise HTTPException(404, "Item unavailable")
    return row


def repeating(row):
    try:
        event = EventData.model_validate(row.data)
    except ValidationError:
        raise HTTPException(422, "This event needs review before it can change") from None
    if event.recurrence is None:
        raise HTTPException(422, "This event does not repeat")
    return event, ZoneInfo(event.timezone)


async def save_series(db, row, event, revision):
    from app.domains.baby.router import record_response, revision_matches

    revision_matches(row, revision)
    try:
        # Assigning to a model skips its checks, so read it back through them.
        event = EventData.model_validate(event.model_dump(mode="json"))
        event.check_times(row.occurred_at)
    except (ValidationError, ValueError):
        raise HTTPException(422, "Enter valid details for this event") from None
    row.data = event.model_dump(mode="json")
    row.revision, row.updated_at = row.revision + 1, now()
    await db.commit()
    return record_response(row)


@router.put("/events/{identifier}/occurrences")
async def change_occurrence(
    identifier: UUID, body: OccurrenceChange, user: User, db: Database, generation: Generation,
    client: Client = None,
):
    """Cancel or change one occurrence. Repeating it is harmless: the same change is not an error."""
    from app.domains.baby.router import record_response

    row = await series_for_edit(db, user, generation, identifier, client)
    event, zone = repeating(row)
    rule = (event.recurrence.frequency, event.recurrence.interval, event.recurrence.until)
    if not is_start(row.occurred_at, zone, rule, body.original_start):
        raise HTTPException(422, "That is not one of this event's dates")
    change = EventException(
        original_start=body.original_start, cancelled=body.cancelled, overrides=body.overrides
    )
    kept = [item for item in event.exceptions if item.original_start != body.original_start]
    if change in event.exceptions:
        return record_response(row)
    event.exceptions = [*kept, change]
    return await save_series(db, row, event, body.revision)


@router.delete("/events/{identifier}/occurrences")
async def restore_occurrence(
    identifier: UUID, original_start: AwareDatetime, revision: Annotated[int, Query(ge=1)],
    user: User, db: Database, generation: Generation, client: Client = None,
):
    """Put one occurrence back as the rule gives it."""
    from app.domains.baby.router import record_response

    row = await series_for_edit(db, user, generation, identifier, client)
    event, _ = repeating(row)
    kept = [item for item in event.exceptions if item.original_start != original_start]
    if len(kept) == len(event.exceptions):
        return record_response(row)
    event.exceptions = kept
    return await save_series(db, row, event, revision)


@router.post("/events/{identifier}/end-series")
async def end_series(
    identifier: UUID, body: SeriesEnd, user: User, db: Database, generation: Generation,
    client: Client = None,
):
    """Stop a repeat from ``from_date`` on the event's own calendar; earlier occurrences stay."""
    from app.domains.baby.router import record_response

    row = await series_for_edit(db, user, generation, identifier, client)
    event, zone = repeating(row)
    last = body.from_date - timedelta(days=1)
    if last < row.occurred_at.astimezone(zone).date():
        raise HTTPException(422, "That would remove every date; delete the event instead")
    if event.recurrence.until is not None and event.recurrence.until <= last:
        return record_response(row)
    event.recurrence.until = last
    event.exceptions = [
        item for item in event.exceptions if item.original_start.astimezone(zone).date() <= last
    ]
    return await save_series(db, row, event, body.revision)
