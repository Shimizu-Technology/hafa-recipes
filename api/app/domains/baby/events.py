"""Calendar: repeating events expanded into dated occurrences, and changes to one occurrence.

An occurrence is identified by its event and its original start, the instant the repeat rule
gave it, whatever an exception later does to it. Time zones are the event's own.
"""

import asyncio
import heapq
from collections import defaultdict
from datetime import date, datetime, timedelta
from itertools import islice
from operator import attrgetter
from typing import Annotated, NamedTuple
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, ValidationError, model_validator
from sqlalchemy import and_, func, literal_column, or_, tuple_

from app.domains.baby.access import touch
from app.domains.baby.dependencies import Access, Client, Database, Generation, User
from app.domains.baby.lifecycle import digest, now, owned, validate_relations
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
    RecordCreate,
    Revision,
)
from app.domains.baby.security import BabyRoute
from app.domains.baby.stats import day_start, kind_query

router = APIRouter(route_class=BabyRoute)
MAX_RANGE_DAYS = 400
MAX_OCCURRENCES = 500
ROW_LIMIT = 1000  # Events a listing reads; a family has a few dozen.
BATCH = 200  # Events read, and parsed, between yields to other requests.
MAX_SERIES = 200  # Repeating events one owner can keep, which bounds what a summary has to scan.
# Longest an occurrence can run, plus a day, so one that began before the range is still found.
LOOKBACK = timedelta(days=MAX_EVENT_DAYS + 1)
# An all-day event's dates are its own zone's, up to 26 hours from the same instants in another.
SLACK = timedelta(days=2)
MARK_KINDS = ("contraction", "kick_session")
EVENT_COLUMNS = (
    BabyRecord.id, BabyRecord.occurred_at, BabyRecord.title, BabyRecord.child_id, BabyRecord.revision,
    BabyRecord.data,
)


class Window(NamedTuple):
    """What a request asks for: instants for timed events, and (when given) dates for all-day ones."""

    lo: datetime
    hi: datetime
    dates: tuple[date, date] | None = None

    def overlaps(self, item):
        if item.all_day and self.dates:
            first, last = item.day_span(None)
            return first <= self.dates[1] and last >= self.dates[0]
        return item.start < self.hi and (item.start >= self.lo or (item.end or item.start) > self.lo)


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

    def day_span(self, profile_zone):
        """First and last calendar day it touches: an all-day event on its own calendar, others on the parent's."""
        zone = self.zone if self.all_day else profile_zone
        last = self.end - timedelta(microseconds=1) if self.end and self.end > self.start else self.start
        return self.start.astimezone(zone).date(), last.astimezone(zone).date()

    def days(self, profile_zone):
        first, last = self.day_span(profile_zone)
        return [first + timedelta(days=n) for n in range((last - first).days + 1)]

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
            "category_label": self.changes.get("category_label", event.category_label),
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
    moved = begin.astimezone(zone).date()
    if changes.get("end"):
        end = changes["end"]
    elif "end" in changes:
        # Cleared: no end, which for an all-day occurrence is its one day.
        end = day_start(moved + timedelta(days=1), zone) if all_day else None
    elif changes.get("start") is not None:
        # Moved, so the length carries over; a new all-day with no end is one day.
        end = day_start(moved + timedelta(days=days if event.all_day else 1), zone) if all_day else (
            begin + span if span and not event.all_day else None
        )
    return Occurrence(row, event, zone, original, begin, end, all_day, changes)


def occurrence_stream(row, window):
    """Occurrences of one event that overlap ``window``, one at a time and already in order.

    Only as many are built as the caller takes: a daily repeat is not expanded for a year to
    show its first few. Changed occurrences are few and come from the event's list of changes;
    the rest are read off the rule, so the two are merged.
    """
    try:
        event = EventData.model_validate(row.data)
        zone = ZoneInfo(event.timezone)
    except (ValidationError, ValueError):
        return iter(())  # A row from before these rules; it cannot be placed on a calendar.
    changes = {item.original_start: item for item in event.exceptions}
    # How far back a start can be and still reach the window, for this event rather than the longest.
    reach = (event.end - row.occurred_at if event.end else timedelta()) + SLACK

    def regular():
        for original in starts_between(row.occurred_at, zone, event.rule, window.lo - reach, window.hi + SLACK):
            if original not in changes:
                item = shaped(row, event, zone, original, None)
                if window.overlaps(item):
                    yield item

    # An occurrence moved into the window can be one the rule gave far outside it.
    moved = []
    for original, change in changes.items():
        if change.overrides and is_start(row.occurred_at, zone, event.rule, original):
            item = shaped(row, event, zone, original, change)
            if window.overlaps(item):
                moved.append(item)
    moved.sort(key=attrgetter("sort_key"))
    return heapq.merge(regular(), moved, key=attrgetter("sort_key"))


def occurrences_of(row, lo, hi, dates=None):
    """Occurrences of one event that overlap [lo, hi), in order."""
    return list(occurrence_stream(row, Window(lo, hi, dates)))


def window_for(first, last, zone):
    return Window(day_start(first, zone), day_start(last + timedelta(days=1), zone), (first, last))


def event_query(owner, generation, child_id, window, *, family_only=False):
    """Events that could have an occurrence in the window: not-yet-finished repeats, and the rest by date.

    A repeat that finished long before the window is left out unless a change to it names its own
    times, since that is the one way it can still reach in. Ordered, so it can be read in pages.
    """
    recurring = BabyRecord.data["recurrence"].as_string().is_not(None)
    changed = BabyRecord.data.op("@?")(literal_column("'$.exceptions[*].overrides ? (@ != null)'::jsonpath"))
    last_start = (window.lo - LOOKBACK - 2 * SLACK).date().isoformat()
    until = BabyRecord.data["recurrence"]["until"].as_string()
    query = kind_query(owner, generation, ("event",), *EVENT_COLUMNS).where(
        or_(
            and_(recurring, or_(until.is_(None), until >= last_start, changed)),
            and_(BabyRecord.occurred_at < window.hi + SLACK, BabyRecord.occurred_at >= window.lo - LOOKBACK - SLACK),
        )
    )
    if family_only:
        query = query.where(BabyRecord.child_id.is_(None))
    elif child_id:
        query = query.where(or_(BabyRecord.child_id == child_id, BabyRecord.child_id.is_(None)))
    return query.order_by(BabyRecord.occurred_at, BabyRecord.id)


async def event_rows(db, query):
    """Every row of an ordered query, read a page at a time with the loop given up in between."""
    after = None
    while True:
        page = query if after is None else query.where(tuple_(BabyRecord.occurred_at, BabyRecord.id) > after)
        rows = (await db.execute(page.limit(BATCH))).all()
        for row in rows:
            yield row
        if len(rows) < BATCH:
            return
        after = (rows[-1].occurred_at, rows[-1].id)
        await asyncio.sleep(0)


async def occurrences(db, owner, generation, child_id, window):
    """The first occurrences overlapping the window, in a fixed order, and whether none was left out.

    Reads repeating events whatever their start, since a series begun years ago still shows. At most
    ``MAX_OCCURRENCES`` and one more are built, however many events there are.
    """
    query = event_query(owner, generation, child_id, window)
    rows = (await db.execute(query.limit(ROW_LIMIT + 1))).all()
    streams = []
    for start in range(0, min(len(rows), ROW_LIMIT), BATCH):
        streams += [occurrence_stream(row, window) for row in rows[start:start + BATCH]]
        await asyncio.sleep(0)
    found = list(islice(heapq.merge(*streams, key=attrgetter("sort_key")), MAX_OCCURRENCES + 1))
    return found, len(rows) <= ROW_LIMIT


def merged_spans(spans):
    """Overlapping or touching (first, last) day pairs joined into the fewest."""
    joined = []
    for first, last in sorted(spans):
        if joined and first <= joined[-1][1] + timedelta(days=1):
            joined[-1] = (joined[-1][0], max(joined[-1][1], last))
        else:
            joined.append((first, last))
    return joined


async def check_series_cap(db, owner, generation, data, *, record_id):
    """A new or edited repeat is refused once the owner keeps ``MAX_SERIES`` of them."""
    if not (data or {}).get("recurrence"):
        return
    count = await db.scalar(
        kind_query(owner, generation, ("event",), func.count()).where(
            BabyRecord.data["recurrence"].as_string().is_not(None), BabyRecord.id != record_id,
            (BabyRecord.space_id == owner.target.id) if getattr(owner, "enabled", False) else True
        )
    )
    if count >= MAX_SERIES:
        raise HTTPException(422, f"You can keep up to {MAX_SERIES} repeating events")


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
    Contractions and kicks follow the care rule. Every eligible event is read, in pages, and each
    occurrence adds one clipped run of days, so a long event costs no more than a short one.
    """
    window = window_for(first, last, zone)
    whole = (first, last)
    spans = []
    async for row in event_rows(db, event_query(owner, generation, child_id, window, family_only=child_id is None)):
        for item in occurrence_stream(row, window):
            begin, end = item.day_span(zone)
            if max(begin, first) <= min(end, last):
                spans.append((max(begin, first), min(end, last)))
        spans = merged_spans(spans)
        if spans == [whole]:
            break  # Every day already has one; the rest cannot add a dot.
    marks = defaultdict(set)
    for begin, end in spans:
        for n in range((end - begin).days + 1):
            marks[(begin + timedelta(days=n)).isoformat()].add("event")
    rows = await db.execute(
        kind_query(owner, generation, MARK_KINDS, BabyRecord.kind, BabyRecord.occurred_at).where(
            BabyRecord.occurred_at >= window.lo,
            BabyRecord.occurred_at < window.hi,
            BabyRecord.child_id == child_id if child_id else BabyRecord.child_id.is_(None),
        )
    )
    for kind, at in rows:
        marks[at.astimezone(zone).date().isoformat()].add(kind)
    return marks


def only_current_clients(client: Client = None):
    # Build 32 has no calendar; to it these routes do not exist.
    if legacy_client(client):
        raise HTTPException(404, "Not found")


@router.get("/events", dependencies=[Depends(only_current_clients)])
async def event_list(
    user: User,
    db: Database,
    first: Annotated[date, Query(alias="from")],
    last: Annotated[date, Query(alias="to")],
    child_id: UUID | None = None,
    client: Client = None,
    access: Access = None,
):
    """Occurrences on the parent's calendar days ``from`` to ``to``, inclusive.

    With a child: that child's events and the whole family's. Without: every event.
    """
    only_current_clients(client)
    check_range(first, last)
    member = access.member
    if child_id:
        await owned(db, BabyChild, access, member.generation, child_id)
    zone = ZoneInfo(Profile.model_validate(member.profile).timezone)
    found, complete = await occurrences(db, access, member.generation, child_id, window_for(first, last, zone))
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


class EventSplit(DomainModel):
    revision: Revision
    from_start: AwareDatetime
    event: RecordCreate

    @model_validator(mode="after")
    def a_named_event(self):
        # The phone chooses the id, so a retry finds the series its first try made.
        if self.event.kind != "event" or "id" not in self.event.model_fields_set:
            raise ValueError("Send the new event, with its id")
        return self


async def series_for_edit(db, access, generation, identifier, client):
    only_current_clients(client)
    access.check_generation(generation)
    row = await owned(db, BabyRecord, access, generation, identifier)
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


def ending_before(event, zone, last):
    """The series with ``last`` as its final day. A change to a date it no longer has goes."""
    event.recurrence.until = last
    event.exceptions = [
        item for item in event.exceptions if item.original_start.astimezone(zone).date() <= last
    ]
    return event


def resaved(row, event):
    try:
        # Assigning to a model skips its checks, so read it back through them.
        event = EventData.model_validate(event.model_dump(mode="json"))
        event.check_times(row.occurred_at)
    except (ValidationError, ValueError):
        raise HTTPException(422, "Enter valid details for this event") from None
    row.data = event.model_dump(mode="json")
    row.revision, row.updated_at = row.revision + 1, now()


async def save_series(db, row, event, revision, access):
    from app.domains.baby.router import record_response, revision_matches

    revision_matches(row, revision)
    resaved(row, event)
    await touch(row, access.target)
    await db.commit()
    return record_response(row, access)


@router.put("/events/{identifier}/occurrences", dependencies=[Depends(only_current_clients)])
async def change_occurrence(
    identifier: UUID, body: OccurrenceChange, user: User, db: Database, generation: Generation,
    client: Client = None,
    access: Access = None,
):
    """Cancel or change one occurrence. Repeating it is harmless: the same change is not an error."""
    from app.domains.baby.router import record_response

    row = await series_for_edit(db, access, generation, identifier, client)
    event, zone = repeating(row)
    if not is_start(row.occurred_at, zone, event.rule, body.original_start):
        raise HTTPException(422, "That is not one of this event's dates")
    change = EventException(
        original_start=body.original_start, cancelled=body.cancelled, overrides=body.overrides
    )
    kept = [item for item in event.exceptions if item.original_start != body.original_start]
    if change in event.exceptions:
        return record_response(row, access)
    event.exceptions = [*kept, change]
    return await save_series(db, row, event, body.revision, access)


@router.delete("/events/{identifier}/occurrences", dependencies=[Depends(only_current_clients)])
async def restore_occurrence(
    identifier: UUID, original_start: AwareDatetime, revision: Annotated[int, Query(ge=1)],
    user: User, db: Database, generation: Generation, client: Client = None, access: Access = None,
):
    """Put one occurrence back as the rule gives it."""
    from app.domains.baby.router import record_response

    row = await series_for_edit(db, access, generation, identifier, client)
    event, _ = repeating(row)
    kept = [item for item in event.exceptions if item.original_start != original_start]
    if len(kept) == len(event.exceptions):
        return record_response(row, access)
    event.exceptions = kept
    return await save_series(db, row, event, revision, access)


@router.post("/events/{identifier}/end-series", dependencies=[Depends(only_current_clients)])
async def end_series(
    identifier: UUID, body: SeriesEnd, user: User, db: Database, generation: Generation,
    client: Client = None,
    access: Access = None,
):
    """Stop a repeat from ``from_date`` on the event's own calendar; earlier occurrences stay."""
    from app.domains.baby.router import record_response

    row = await series_for_edit(db, access, generation, identifier, client)
    event, zone = repeating(row)
    last = body.from_date - timedelta(days=1)
    if last < row.occurred_at.astimezone(zone).date():
        raise HTTPException(422, "That would remove every date; delete the event instead")
    if event.recurrence.until is not None and event.recurrence.until <= last:
        return record_response(row, access)
    return await save_series(db, row, ending_before(event, zone, last), body.revision, access)


async def split_replay(db, prior, fingerprint, access, generation, identifier, user):
    """The answer to a split that already happened: her retry, whatever has changed since."""
    from app.domains.baby.router import record_response

    if access.enabled:
        access.grant(prior)
    if (
        not access.enabled and (prior.app_user_id != user.id or prior.generation != generation)
    ) or prior.creation_hash != fingerprint:
        raise HTTPException(409, "This save identity was already used with different content")
    if prior.deleted_at:
        raise HTTPException(410, "This entry was removed; create a new entry")
    try:
        series = record_response(await owned(db, BabyRecord, access, generation, identifier), access)
    except HTTPException:
        series = None  # Deleted or moved since; the new series is still what was asked for.
    return {"series": series, "event": record_response(prior, access)}


@router.post("/events/{identifier}/split", dependencies=[Depends(only_current_clients)])
async def split_series(
    identifier: UUID, body: EventSplit, user: User, db: Database, generation: Generation,
    client: Client = None,
    access: Access = None,
):
    """End a repeat before ``from_start`` and start ``event`` after it: both, or neither.

    Sending it again changes nothing and gets the same answer, so a phone can retry for as long as it takes.
    """
    from app.domains.baby.router import can_create, record_response, revision_matches

    only_current_clients(client)
    access.check_generation(generation)
    new = body.event
    # Later queued changes can move the revision a retry carries, so it isn't part of what was asked.
    fingerprint = digest({"series": str(identifier), **body.model_dump(mode="json", exclude={"revision"})})
    # The caller holds the owner's or the spaces' write lock, so a concurrent retry waits and finds this.
    prior = await db.get(BabyRecord, new.id)
    if prior:
        return await split_replay(db, prior, fingerprint, access, generation, identifier, user)
    can_create("event", client)
    row = await series_for_edit(db, access, generation, identifier, client)
    event, zone = repeating(row)
    revision_matches(row, body.revision)
    if not is_start(row.occurred_at, zone, event.rule, body.from_start):
        raise HTTPException(422, "That is not one of this event's dates")
    last = body.from_start.astimezone(zone).date() - timedelta(days=1)
    if last < row.occurred_at.astimezone(zone).date():
        raise HTTPException(422, "That is the first date; change the whole event instead")
    # The old series keeps every date before the split, so an earlier start would show those dates twice.
    if new.occurred_at.astimezone(ZoneInfo(new.data["timezone"])).date() <= last:
        raise HTTPException(422, "The new dates can't start before the date being changed")
    await validate_relations(db, access, generation, new.child_id, new.data, record_id=new.id, kind="event")
    await check_series_cap(db, access, generation, new.data, record_id=new.id)
    resaved(row, ending_before(event, zone, last))
    await touch(row, access.target)
    added = BabyRecord(
        **new.model_dump(),
        app_user_id=user.id,
        space_id=access.target.id if access.enabled else access.member.personal_space_id,
        generation=generation,
        revision=1,
        creation_hash=fingerprint,
        created_at=now(),
        updated_at=now(),
    )
    db.add(added)
    await touch(added, access.target)
    await db.commit()
    return {"series": record_response(row, access), "event": record_response(added, access)}
