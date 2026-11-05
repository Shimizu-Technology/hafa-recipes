"""The durable reminder queue's writers, and what a reminder says at the moment it is read.

One row is one reminder for one person. Its phones are looked up when it is sent, so a new phone
is included and a removed one is not. A row holds references rather than words: an edit shows up,
and nothing outlives what it describes. Nothing here runs in a transaction that saves a log.

Rows do not sync through ``/changes``, so these writes never call ``touch()``.
"""

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from uuid import uuid4

from sqlalchemy import and_, case, cast, or_, update
from sqlalchemy.dialects.postgresql import JSONB, insert

from app.domains.baby.access import access_for
from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyNotification

GENERIC = "You have a reminder in Håfa Baby."
# All a provider or a lock screen ever gets: fixed text for each kind, with no name, title, time or week.
LOCK_SCREEN = {}
CANCELLED = "cancelled"  # Its reason went away, so scheduling the same reminder again brings it back.
DISMISSED = "dismissed"  # The person's decision, which nothing undoes.
CLEARED = "cleared"  # In a delivered row's payload: off Today because its reason went, and it may come back.
QUIET_HELD = "quiet_hours"  # What ``lease_until`` means on a waiting row, unlike a provider's backoff.
# A caregiver hears only about what they help with. Everything else is for parents, so a babysitter
# is not woken for a feed, and a question for the doctor stays with the people who can read it.
CAREGIVER_HEARS = frozenset({"event", "running_timer"})


@dataclass(frozen=True)
class Words:
    detail: str  # Shown in the app, on the person's own Today. Never sent to a provider.
    data: dict = field(default_factory=dict)  # Identifiers for Today to link to. Never sent to a provider.
    due_at: datetime | None = None  # When it is due by today's settings and zone, for kinds that depend on them.
    held_as: tuple | None = None  # A routine's (record id, schedule): a phone holding exactly this fires it itself.

    def not_yet(self, moment):
        return self.due_at is not None and self.due_at > moment


# Each kind's own check and wording, added as its trigger lands. Returning None clears the reminder,
# as does having no entry: nothing goes out or shows on Today unless something can vouch for it.
RESOLVERS = {}


def lock_screen(kind):
    return LOCK_SCREEN.get(kind, GENERIC)


def collapse_for(key):
    """Stable across retries, opaque to the provider, and within the 64 bytes APNs allows."""
    return hashlib.sha256(key.encode()).hexdigest()


async def reminder_access(db, person, *, client="3"):
    """Every space this person can read now. Read-only, so it takes no lock and blocks no writer."""
    return await access_for(db, person, client=client)


def role_in(access, space_id):
    if not access.enabled:
        return "parent" if space_id == access.personal_space_id else None
    return next((grant.role for grant in access.spaces if grant.id == space_id), None)


def may_hear(access, kind, space_id):
    role = role_in(access, space_id)
    return role == "parent" or (role == "caregiver" and kind in CAREGIVER_HEARS)


async def resolve(db, row, access, prefs):
    """What this reminder says now, or None when its reason has gone or the person can't hear it.

    The one test of whether a reminder stands, for the last check before a send and for Today.
    """
    if not prefs.kind(row.kind).enabled or not may_hear(access, row.kind, row.space_id):
        return None
    expires = row.payload.get("expires_at")
    if expires and datetime.fromisoformat(expires) <= now():
        return None
    # Whatever AI processing produced needs the permission it ran under to still stand.
    epoch = row.payload.get("consent_epoch")
    if epoch is not None and epoch != access.member.consent_epoch:
        return None
    resolver = RESOLVERS.get(row.kind)
    return await resolver(db, row, access, prefs) if resolver else None


async def schedule(db, *, owner, space_id, kind, key, due_at, payload=None):
    """Queue a reminder once for each key, for the worker's planning transaction.

    A waiting one follows a changed time, without touching its retries. A cancelled one comes back.
    Anything sent or dismissed stays as it is, except that any row follows its record to a new space.
    """
    identity = f"{kind}:{owner}:{key}"
    table = BabyNotification
    statement = insert(table).values(
        id=uuid4(), space_id=space_id, app_user_id=owner, idempotency_key=identity,
        collapse_id=collapse_for(identity), kind=kind, payload=payload or {}, due_at=due_at,
        created_at=now(), updated_at=now(),
    )
    waiting, revived = table.status == "queued", and_(table.status == "failed", table.last_error == CANCELLED)
    fresh = statement.excluded

    def when_revived(value, column):
        return case((revived, value), else_=column)

    def when_open(value, column):
        return case((or_(revived, waiting), value), else_=column)

    await db.execute(statement.on_conflict_do_update(
        index_elements=["idempotency_key"],
        set_={
            "due_at": when_open(fresh.due_at, table.due_at),
            "payload": when_open(fresh.payload, table.payload),
            "space_id": fresh.space_id,
            "updated_at": fresh.updated_at,
            "status": when_open("queued", table.status),
            "dismissed_at": when_revived(None, table.dismissed_at),
            "last_error": when_revived(None, table.last_error),
            "attempts": when_revived(0, table.attempts),
            "unknown_retries": when_revived(0, table.unknown_retries),
            "lease_until": when_revived(None, table.lease_until),
            "provider_ticket": when_revived(None, table.provider_ticket),
        },
        where=or_(
            revived,
            table.space_id != fresh.space_id,
            and_(waiting, or_(table.due_at != fresh.due_at, table.payload != fresh.payload)),
        ),
    ))


async def cancel(db, *conditions):
    """Its reason went away. What was still waiting stops, and what was delivered leaves Today, keeping that record.

    One being sent is left alone: its last check, or the next plan, settles it. Nor is one that is still
    owed to a phone after others took it, whose last check ends it as delivered.
    """
    table = BabyNotification
    waiting = and_(table.status == "queued", table.provider_ticket.is_(None))
    await db.execute(
        update(table)
        .where(table.dismissed_at.is_(None), or_(waiting, table.status.not_in(("queued", "sending"))), *conditions)
        .values(
            dismissed_at=now(),
            updated_at=now(),
            status=case((waiting, "failed"), else_=table.status),
            last_error=case((waiting, CANCELLED), else_=table.last_error),
            lease_until=case((waiting, None), else_=table.lease_until),
            payload=case((waiting, table.payload), else_=table.payload.op("||")(cast({CLEARED: True}, JSONB))),
        )
        .execution_options(synchronize_session=False)
    )


async def dismiss(db, *conditions):
    """The person's own decision. It stops anything waiting, and nothing brings it back."""
    table = BabyNotification
    waiting = and_(table.status == "queued", table.provider_ticket.is_(None))
    owed = and_(table.status == "queued", table.provider_ticket.is_not(None))
    await db.execute(
        update(table)
        .where(table.dismissed_at.is_(None), *conditions)
        .values(
            dismissed_at=now(),
            updated_at=now(),
            status=case((waiting, "failed"), (owed, "accepted"), else_=table.status),
            last_error=case((waiting, DISMISSED), else_=table.last_error),
            lease_until=case((or_(waiting, owed), None), else_=table.lease_until),
        )
        .execution_options(synchronize_session=False)
    )


async def restore(db, person, wanted):
    """Its reason is back: a delivered reminder returns to Today, as it was, and isn't sent again."""
    table = BabyNotification
    await db.execute(
        update(table)
        .where(
            table.app_user_id == person, table.idempotency_key.in_(wanted),
            table.dismissed_at.is_not(None), table.payload.has_key(CLEARED),
        )
        .values(dismissed_at=None, updated_at=now(), payload=table.payload.op("-")(CLEARED))
        .execution_options(synchronize_session=False)
    )
