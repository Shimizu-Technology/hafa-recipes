"""Phones that can receive reminders, and what each person wants from them. Nothing is sent here.

A person's settings are stored under their personal space, whichever family they are in, so Create
family has nothing to move and leaving one takes nothing with it. Everything is off until someone
turns it on. Quiet hours belong to the person rather than a reminder type, so they share a row
under the reserved kind ``PERSON_ROW``.
"""

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from pydantic import Field, StrictBool, ValidationError, field_validator, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from app.domains.baby.dependencies import Client, Database, Generation, Limit, User
from app.domains.baby.lifecycle import membership_for, now
from app.domains.baby.models import BabyNotification, BabyNotificationPref, BabyPushDevice
from app.domains.baby.queries import legacy_client
from app.domains.baby.reminders import dismiss, reminder_access, resolve
from app.domains.baby.schemas import DomainModel, Profile
from app.domains.baby.security import BabyRoute, push_enabled
from app.rate_limit import QuotaWindow, RateLimitExceeded, push_registration_limiter

MAX_DEVICES = 10  # Oldest goes first; a person replaces phones, and each row is a send.
# Far more than sign-ins and token changes need, and it costs no query. Per process, as elsewhere.
REGISTRATION_WINDOWS = (QuotaWindow(seconds=600, limit=30),)
PERSON_ROW = "_person"
ReminderKind = Literal[
    "event", "visit_prep", "import", "feed_interval", "running_timer", "pregnancy_week",
    "milestone_window", "well_visit",
]
REMINDER_KINDS = ReminderKind.__args__
TOKEN = re.compile(r"Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,160}\]")
InstallationId = Annotated[str, Path(pattern=r"^[A-Za-z0-9._:-]{8,128}$")]
Registration = Annotated[str, Query(pattern=r"^\d{1,17}$")]
# Half-hour steps. Chosen by the person, or their doctor: no value here is a recommendation.
Hours = Annotated[float, Field(ge=0.5, le=24, multiple_of=0.5)]
ClockTime = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
MICROSECOND = timedelta(microseconds=1)


def available(client: Client = None):
    # Build 32 has no push; to it, and with the flag off, these routes do not exist.
    if not push_enabled() or legacy_client(client):
        raise HTTPException(404, "Not found")


router = APIRouter(route_class=BabyRoute, dependencies=[Depends(available)])


class DeviceRegistration(DomainModel):
    token: str  # Checked by the route: a schema error would repeat the rejected value in its response.
    platform: Literal["ios", "android"]


class QuietHours(DomainModel):
    """A wall-clock window in its own zone; one that ends earlier than it starts crosses midnight."""

    start: ClockTime
    end: ClockTime
    timezone: str = Field(max_length=80)

    @field_validator("timezone")
    @classmethod
    def known_zone(cls, value):
        return Profile.timezone_known(value)

    @model_validator(mode="after")
    def has_length(self):
        if self.start == self.end:
            raise ValueError("Quiet hours need a different start and end")
        return self


class KindPref(DomainModel):
    enabled: StrictBool = False
    break_through: StrictBool = False  # Ignores quiet hours, and is sent as time-sensitive.
    hours: Hours | None = None  # feed_interval: hours after the last feed.
    feed_hours: Hours | None = None  # running_timer: how long a timer runs before a reminder.
    sleep_hours: Hours | None = None

    def check(self, kind):
        extra = {"hours"} if kind == "feed_interval" else {"feed_hours", "sleep_hours"} if kind == "running_timer" else set()
        if any(getattr(self, name) is not None for name in {"hours", "feed_hours", "sleep_hours"} - extra):
            raise ValueError("That setting belongs to another reminder")
        if kind == "feed_interval" and self.enabled and self.hours is None:
            raise ValueError("Choose how many hours")
        return self


class KindPatch(DomainModel):
    enabled: StrictBool | None = None
    break_through: StrictBool | None = None
    hours: Hours | None = None
    feed_hours: Hours | None = None
    sleep_hours: Hours | None = None


class PrefsPatch(DomainModel):
    quiet_hours: QuietHours | None = None
    kinds: dict[ReminderKind, KindPatch] = Field(default_factory=dict)


@dataclass(frozen=True)
class Prefs:
    quiet_hours: QuietHours | None = None
    kinds: dict = field(default_factory=dict)

    def kind(self, name):
        return self.kinds.get(name) or KindPref()

    def response(self):
        return {
            "quiet_hours": self.quiet_hours and self.quiet_hours.model_dump(),
            "kinds": {name: self.kind(name).model_dump() for name in REMINDER_KINDS},
        }


def wall_clock(day, clock, zone, pick):
    """The instant a clock reads this, by ``pick`` where a clock change repeats or skips the time."""
    return pick(datetime.combine(day, clock.replace(fold=fold), zone).astimezone(UTC) for fold in (0, 1))


def quiet_until(quiet, moment):
    """When the quiet window holding ``moment`` ends, always later than it, or None outside one.

    Compared as instants: Python compares two times in one zone by their wall clocks, and in a
    repeated hour that once gave an end already in the past. A time that a clock change repeats or
    skips takes the reading that keeps the window wider, so it never wakes anyone early.
    """
    if quiet is None:
        return None
    zone = ZoneInfo(quiet.timezone)
    moment = moment.astimezone(UTC)
    start, end = time.fromisoformat(quiet.start), time.fromisoformat(quiet.end)
    today = moment.astimezone(zone).date()
    for offset in (-1, 0, 1):  # A window that crosses midnight opened the day before.
        opened = today + timedelta(days=offset)
        begin = wall_clock(opened, start, zone, min)
        finish = wall_clock(opened + timedelta(days=1 if start > end else 0), end, zone, max)
        if begin <= moment < finish:
            return finish
    return None


async def load_prefs(db, owner, personal_space_id):
    """Stored settings, read so that anything unreadable counts as off."""
    rows = await db.scalars(
        select(BabyNotificationPref)
        .where(BabyNotificationPref.app_user_id == owner, BabyNotificationPref.space_id == personal_space_id)
        .execution_options(populate_existing=True)
    )
    quiet, kinds = None, {}
    for row in rows:
        try:
            if row.kind == PERSON_ROW:
                stored = row.settings.get("quiet_hours")
                quiet = QuietHours.model_validate(stored) if stored else None
            elif row.kind in REMINDER_KINDS:
                pref = KindPref.model_validate({**row.settings, "enabled": row.enabled})
                kinds[row.kind] = pref.check(row.kind)
        except (ValueError, TypeError, AttributeError):
            continue  # A validation error is a ValueError; the others are settings of the wrong shape.
    return Prefs(quiet, kinds)


async def store_pref(db, owner, space_id, kind, enabled, settings):
    await db.execute(
        insert(BabyNotificationPref)
        .values(space_id=space_id, app_user_id=owner, kind=kind, enabled=enabled, settings=settings)
        .on_conflict_do_update(
            index_elements=["space_id", "app_user_id", "kind"],
            set_={"enabled": enabled, "settings": settings},
        )
    )


@router.put("/push/devices/{installation_id}")
async def register_device(
    installation_id: InstallationId, body: DeviceRegistration, user: User, db: Database, generation: Generation,
):
    """Called on sign-in and whenever the token changes. Each call is a new ``registration``, which
    sign-out sends back. The generation is the personal space's."""
    if not TOKEN.fullmatch(body.token):
        raise HTTPException(422, "This isn't a valid push token")
    try:
        await push_registration_limiter.consume_quota(
            user_id=user.id, capability="baby_push_registration", windows=REGISTRATION_WINDOWS,
        )
    except RateLimitExceeded as error:
        raise HTTPException(429, "Try again shortly", headers={"Retry-After": str(error.retry_after)}) from None
    await membership_for(db, user.id, generation=generation, write=True)
    # A token is one phone, and a phone is whoever signed in last: no older copy keeps receiving.
    await db.execute(
        delete(BabyPushDevice).where(
            BabyPushDevice.token == body.token,
            (BabyPushDevice.app_user_id != user.id) | (BabyPushDevice.installation_id != installation_id),
        )
    )
    values = {"token": body.token, "platform": body.platform, "enabled": True}
    try:
        registered = await db.scalar(
            insert(BabyPushDevice)
            .values(app_user_id=user.id, installation_id=installation_id, updated_at=now(), **values)
            .on_conflict_do_update(
                index_elements=["app_user_id", "installation_id"],
                # Strictly later, whatever the clock did, so an older sign-out can never match.
                set_={**values, "updated_at": func.greatest(now(), BabyPushDevice.updated_at + MICROSECOND)},
            )
            .returning(BabyPushDevice.updated_at)
        )
    except IntegrityError:
        # Another account registered the same phone at this moment. Retrying settles who has it.
        await db.rollback()
        raise HTTPException(409, "This phone is registering; try again") from None
    extra = await db.scalars(
        select(BabyPushDevice.id)
        .where(BabyPushDevice.app_user_id == user.id)
        .order_by(BabyPushDevice.updated_at.desc(), BabyPushDevice.id)
        .offset(MAX_DEVICES)
    )
    await db.execute(delete(BabyPushDevice).where(BabyPushDevice.id.in_(list(extra))))
    await db.commit()
    return {
        "installation_id": installation_id, "platform": body.platform, "enabled": True,
        "registration": str((registered - EPOCH) // MICROSECOND),
    }


@router.delete("/push/devices/{installation_id}", status_code=204)
async def unregister_device(installation_id: InstallationId, registration: Registration, user: User, db: Database):
    """Sign-out, naming the registration it ends: arriving after a newer sign-in, it leaves that one.

    No generation fence: stopping pushes to a phone is right whatever else changed.
    """
    await db.execute(
        delete(BabyPushDevice).where(
            BabyPushDevice.app_user_id == user.id,
            BabyPushDevice.installation_id == installation_id,
            BabyPushDevice.updated_at == EPOCH + int(registration) * MICROSECOND,
        )
    )
    await db.commit()
    return Response(status_code=204)


@router.get("/push/prefs")
async def get_prefs(user: User, db: Database):
    member = await membership_for(db, user.id)
    return (await load_prefs(db, user.id, member.personal_space_id)).response()


@router.patch("/push/prefs")
async def patch_prefs(body: PrefsPatch, user: User, db: Database, generation: Generation):
    """Only what the body names changes; ``quiet_hours: null`` turns quiet hours off."""
    member = await membership_for(db, user.id, generation=generation, write=True)
    space_id = member.personal_space_id
    prefs = await load_prefs(db, user.id, space_id)
    if "quiet_hours" in body.model_fields_set:
        quiet = body.quiet_hours and body.quiet_hours.model_dump()
        await store_pref(db, user.id, space_id, PERSON_ROW, False, {"quiet_hours": quiet})
    for kind, patch in body.kinds.items():
        merged = {**prefs.kind(kind).model_dump(), **patch.model_dump(exclude_unset=True)}
        try:
            pref = KindPref.model_validate(merged).check(kind)
        except ValidationError:
            raise HTTPException(422, "Choose valid reminder settings") from None
        except ValueError as error:
            raise HTTPException(422, str(error)) from None
        settings = pref.model_dump(exclude={"enabled"}, exclude_none=True)
        await store_pref(db, user.id, space_id, kind, pref.enabled, settings)
    await db.commit()
    return (await load_prefs(db, user.id, space_id)).response()


@router.get("/reminders/due")
async def due_reminders(user: User, db: Database, client: Client = None, limit: Limit = 50):
    """What Today shows: due and not dismissed, its reason still standing, however delivery went."""
    access = await reminder_access(db, user.id, client=client)
    prefs = await load_prefs(db, user.id, access.personal_space_id)
    # An older build only reads its personal space, so a family's reminders stay off its Today too.
    spaces = [grant.id for grant in access.spaces] if access.enabled else [access.personal_space_id]
    rows = await db.scalars(
        select(BabyNotification)
        .where(
            BabyNotification.space_id.in_(spaces),
            BabyNotification.app_user_id == user.id,
            BabyNotification.due_at <= now(),
            BabyNotification.dismissed_at.is_(None),
        )
        .order_by(BabyNotification.due_at.desc(), BabyNotification.id)
        .limit(200)
    )
    items = []
    for row in rows:
        if len(items) == limit:
            break
        words = await resolve(db, row, access, prefs)
        if words and not words.not_yet(now()):
            items.append({
                "id": row.id,
                "kind": row.kind,
                "space_id": row.space_id,
                "text": words.detail,  # This is the person's own screen, not their lock screen.
                "due_at": row.due_at,
                "delivery": row.status,
                "identity": row.collapse_id,
                "data": words.data,
            })
    return {"items": items}


@router.post("/reminders/{identifier}/dismiss", status_code=204)
async def dismiss_reminder(identifier: UUID, user: User, db: Database):
    """Off Today, and never sent if it was still waiting. Repeating it changes nothing."""
    await dismiss(db, BabyNotification.id == identifier, BabyNotification.app_user_id == user.id)
    await db.commit()
    return Response(status_code=204)
