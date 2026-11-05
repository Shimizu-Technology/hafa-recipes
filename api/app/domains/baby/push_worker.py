"""Sends due reminders through Expo. At-least-once, with short transactions and leases.

Not the import worker: that one holds its lock through long imports, and a reminder cannot wait
for a video. The lock here only covers each claim, so no connection is held during a send and two
replicas never pick up the same row. A lease that runs out means a worker died and may or may not
have sent, which is an unknown outcome: one more try under the same collapse ID, then ``unknown``.

One claim is one request to Expo, at most ``MAX_MESSAGES`` messages counted from what is actually
prepared. ``final_check`` is the only check, and the last thing before that request: the moment of
send is the only moment that counts. It renews the leases, and the request has its own deadline
shorter than a lease, so a batch can't outlast what it holds and a late one stops rather than sends.

A provider or lock screen only ever gets ``message_for``'s fixed text and opaque identifiers.

Reminders are planned here too, from what is committed (see ``triggers.py``). A commit that changes
something a reminder depends on wakes this worker through ``watch``'s listeners, which do nothing
else and can't fail a write. Those listeners exist only while the worker runs.

Asleep until the next known due time, at most ``IDLE_SECONDS``, so an idle day costs a query every
ten minutes rather than keeping Neon awake.
"""

import asyncio
import hashlib
import json
import logging
from collections import defaultdict
from contextlib import asynccontextmanager, suppress
from datetime import timedelta
from typing import NamedTuple
from uuid import UUID, uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import and_, delete, event, func, or_, select, text, update
from sqlalchemy.orm import Session

from app.db.database import AsyncSessionLocal
from app.domains.baby.lifecycle import now
from app.domains.baby.models import (
    BabyChild,
    BabyImport,
    BabyMembership,
    BabyNotification,
    BabyNotificationPref,
    BabyPushDevice,
    BabyRecord,
    BabySpaceMember,
)
from app.domains.baby.push import Prefs, held_routines, load_prefs, quiet_until
from app.domains.baby.reminders import (
    CANCELLED,
    CLEARED,
    DISMISSED,
    QUIET_HELD,
    lock_screen,
    reminder_access,
    resolve,
)
from app.domains.baby.security import push_access_token, push_enabled
from app.domains.baby.triggers import PLANNERS, plan_person

logger = logging.getLogger("hafa.baby.push")
SEND_URL = "https://exp.host/--/api/v2/push/send"
RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
PUSH_LOCK = 7340057
CLAIM_SIZE = 100
MAX_MESSAGES = 100  # Expo's limit for one request.
MAX_RECEIPT_IDS = 1000
LEASE = timedelta(minutes=3)
CHECK_BUDGET = timedelta(seconds=5)  # So nothing in a request was checked longer ago; the rest wait for the next pass.
SEND_DEADLINE_SECONDS = 30
RELEASE_DELAY = timedelta(seconds=30)  # So a batch that keeps losing its leases can't spin.
PAUSE_SECONDS = 0.2  # Between passes, whatever they found.
LOCK_TIMEOUT = "5s"  # A stuck writer defers this work instead of holding up the worker.
RECEIPT_DELAY = timedelta(minutes=15)
RECEIPT_RECHECK = timedelta(minutes=30)
MAX_RECEIPT_CHECKS = 3
UNKNOWN_RETRY = timedelta(minutes=2)
MAX_ATTEMPTS = 8  # With the doubling below, about an hour and a half of an outage.
MAX_BACKOFF_SECONDS = 1800
TTL_SECONDS = 6 * 3600  # A reminder from last night is no use on a phone back online today.
IDLE_SECONDS = 600
RETRY_AFTER_ERROR_SECONDS = 30
KEEP = timedelta(days=60)
PRUNE_EVERY = timedelta(hours=6)
SWEEP_EVERY = timedelta(minutes=15)
PLAN_PAGE = 25  # People planned in a pass, so sending never waits on all of them.
WATCHED = (BabyChild, BabyImport, BabyRecord, BabySpaceMember)
QUIET_KINDS = ("journal", "collection")  # Writes no reminder depends on, so they don't wake anything.
NOT_REGISTERED = "DeviceNotRegistered"
RATE_LIMITED = "MessageRateExceeded"


class Outcome(NamedTuple):
    state: str  # "tickets", "unknown" (it may have gone out), "not_sent" (it did not) or "rejected".
    code: str = ""
    tickets: list | None = None
    retry_after: float | None = None


class Standing(NamedTuple):
    """A reminder whose reason held when the last check read it. Which phones it goes to is read after."""

    row_id: object
    owner: str
    space_id: object
    kind: str
    collapse_id: str
    break_through: bool
    owed: dict | None  # Only these phones, when others have already taken it.
    held_as: tuple | None = None  # A routine: phones holding exactly this fire it themselves.


class Prepared(NamedTuple):
    row_id: object
    owner: str
    devices: list
    messages: list


def fingerprint(token):
    return hashlib.sha256(token.encode()).hexdigest()[:16]


def backoff(attempts, retry_after=None):
    seconds = min(30 * 2 ** max(attempts, 1), MAX_BACKOFF_SECONDS)
    return timedelta(seconds=max(seconds, min(retry_after or 0, 3600)))


def retry_after_seconds(response):
    with suppress(TypeError, ValueError):
        return float(response.headers.get("Retry-After"))
    return None


def ticket_state(row):
    """``tickets``: phones Expo has taken this for. ``retry``: phones still owed it, by tries so far."""
    return json.loads(row.provider_ticket) if row.provider_ticket else {}


def conclude(row, state, status, code, moment):
    """If any phone's send was taken the reminder is ``accepted``, however the rest went."""
    state.pop("retry", None)
    row.provider_ticket = json.dumps(state) if state.get("tickets") else None
    if state.get("tickets"):
        row.status, row.receipt_due_at = "accepted", moment + RECEIPT_DELAY
    else:
        row.status = status
    row.last_error = code


def message_for(reminder, device):
    """All a provider sees: fixed text for this kind, and opaque identifiers. Nothing else, ever."""
    message = {
        "to": device.token,
        "body": lock_screen(reminder.kind),
        # No reminder type: "pregnancy_week" in a payload would say more than any lock screen does.
        "data": {
            "notification_id": str(reminder.row_id), "space_id": str(reminder.space_id),
            "identity": reminder.collapse_id,
        },
        "collapseId": reminder.collapse_id,  # On iOS, replaces a duplicate already showing.
        "tag": reminder.collapse_id,  # The same, on Android.
        "ttl": TTL_SECONDS,
        "priority": "high",
        "sound": "default",
    }
    if reminder.break_through:
        message["interruptionLevel"] = "time-sensitive"
    return message


class BabyPushWorker:
    def __init__(self, session_factory=AsyncSessionLocal, transport=None):
        self.sessions, self.transport = session_factory, transport
        self.task = self.loop = None
        self.event = asyncio.Event()
        self.pruned_at = self.swept_at = self.sweep_after = None
        self.spaces, self.people = set(), set()
        self.watching = False

    def watch(self):
        if not self.watching:
            event.listen(Session, "after_flush", self.note_changes)
            event.listen(Session, "after_commit", self.wake_after_commit)
            event.listen(Session, "after_rollback", self.forget_changes)
            self.watching = True

    def unwatch(self):
        if self.watching:
            event.remove(Session, "after_flush", self.note_changes)
            event.remove(Session, "after_commit", self.wake_after_commit)
            event.remove(Session, "after_rollback", self.forget_changes)
            self.watching = False

    def note_changes(self, session, context):
        """Runs in every session's flush while the worker is on, so a problem here is only ever logged."""
        try:
            for row in (*session.new, *session.dirty, *session.deleted):
                if isinstance(row, BabyMembership):  # A new time zone changes when things are due.
                    session.info.setdefault(self, (set(), set()))[1].add(row.app_user_id)
                elif isinstance(row, WATCHED) and getattr(row, "kind", None) not in QUIET_KINDS and row.space_id:
                    session.info.setdefault(self, (set(), set()))[0].add(row.space_id)
        except Exception as error:
            logger.warning("Baby push wake lost: %s", type(error).__name__)

    def wake_after_commit(self, session):
        try:
            changed = session.info.pop(self, None)
            if changed:
                self.spaces |= changed[0]
                self.people |= changed[1]
                self.notify()
        except Exception as error:
            logger.warning("Baby push wake lost: %s", type(error).__name__)

    def forget_changes(self, session):
        session.info.pop(self, None)

    def plan_soon(self, person):
        """A person changed their settings. The sweep catches this if a wake is ever lost."""
        try:
            self.people.add(person)
            self.notify()
        except Exception as error:
            logger.warning("Baby push wake lost: %s", type(error).__name__)

    def notify(self):
        # A commit can land on another thread; Event itself isn't safe there.
        if self.loop:
            self.loop.call_soon_threadsafe(self.event.set)
        else:
            self.event.set()

    async def start(self):
        if not push_enabled():
            return
        if not push_access_token():
            logger.warning("Baby push: no Expo access token, so reminders show on Today but aren't sent")
        if self.task is None or self.task.done():
            self.watch()
            self.loop = asyncio.get_running_loop()
            self.task = asyncio.create_task(self.run(), name="baby-push-worker")

    async def stop(self):
        self.unwatch()
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
            self.task = self.loop = None

    @asynccontextmanager
    async def transaction(self):
        async with self.sessions() as db:
            await db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
            yield db

    async def run(self):
        while True:
            # Cleared before looking, so a commit during this pass still ends the wait below.
            self.event.clear()
            try:
                delay = 0 if await self.tick() else await self.next_delay()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                # Only the type: exception text can carry request details.
                logger.warning("Baby push work deferred: %s", type(error).__name__)
                delay = RETRY_AFTER_ERROR_SECONDS
            if delay:
                with suppress(TimeoutError):
                    await asyncio.wait_for(self.event.wait(), delay)
            await asyncio.sleep(PAUSE_SECONDS)

    async def tick(self):
        """One pass. True when there may be more to do right away."""
        try:
            busy = await self.maintain()
        except Exception as error:
            # What is already planned still goes.
            logger.warning("Baby push planning deferred: %s", type(error).__name__)
            busy = False
        if not push_access_token():
            return busy
        claimed = await self.claim()
        if claimed:
            await self.deliver(*claimed)
        return await self.check_receipts() or bool(claimed) or busy

    async def next_delay(self):
        if not push_access_token():
            return IDLE_SECONDS
        async with self.sessions() as db:
            table = BabyNotification
            due = await db.scalar(
                select(func.min(func.greatest(table.due_at, func.coalesce(table.lease_until, table.due_at))))
                .where(table.status.in_(("queued", "sending")), table.dismissed_at.is_(None))
            )
            receipt = await db.scalar(
                select(func.min(table.receipt_due_at)).where(table.status == "accepted", table.receipt_due_at.is_not(None))
            )
        soonest = min((moment for moment in (due, receipt) if moment), default=None)
        if soonest is None:
            return IDLE_SECONDS
        return max(1, min((soonest - now()).total_seconds(), IDLE_SECONDS))

    async def claim(self):
        """Lease what fits in one request. Returns (token, ids), or None when there is none or another worker is claiming."""
        table = BabyNotification
        token, moment, ids, unknown, room = uuid4(), now(), [], 0, MAX_MESSAGES
        async with self.transaction() as db:
            if not await db.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": PUSH_LOCK}):
                return None
            rows = list(await db.scalars(
                select(table)
                .where(or_(
                    and_(
                        table.status == "queued", table.due_at <= moment, table.dismissed_at.is_(None),
                        or_(table.lease_until.is_(None), table.lease_until <= moment),
                    ),
                    and_(table.status == "sending", table.lease_until <= moment),
                ))
                .order_by(table.due_at, table.id)
                .limit(CLAIM_SIZE)
                .with_for_update(skip_locked=True)
            ))
            phones = dict((await db.execute(
                select(BabyPushDevice.app_user_id, func.count())
                .where(BabyPushDevice.app_user_id.in_({row.app_user_id for row in rows}), BabyPushDevice.enabled.is_(True))
                .group_by(BabyPushDevice.app_user_id)
            )).all()) if rows else {}
            for row in rows:
                state = ticket_state(row)
                if row.status == "sending" and (row.unknown_retries or row.dismissed_at):
                    # Its worker died, maybe after the send went out, and it has had its second try.
                    conclude(row, state, "unknown", row.last_error, moment)
                    row.lease_token, row.lease_until, row.updated_at = None, None, moment
                    unknown += 1
                    continue
                # A person's phones stay in one request, so one result covers the whole reminder.
                size = len(state.get("retry", ())) or phones.get(row.app_user_id, 0) or 1
                if size > room:
                    break
                room -= size
                if row.status == "sending":
                    row.unknown_retries = 1
                row.status, row.lease_token, row.lease_until = "sending", token, moment + LEASE
                row.attempts, row.updated_at = row.attempts + 1, moment
                ids.append(row.id)
            await db.commit()
        if unknown:
            logger.warning("Baby push unknown outcomes: %d", unknown)
        return (token, ids) if ids else None

    async def deliver(self, token, ids):
        items = await self.final_check(ids, token)
        if not items:
            return
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(20, connect=5), transport=self.transport, follow_redirects=False
        ) as client:
            outcome = await self.send(client, [message for item in items for message in item.messages])
        start = 0
        for item in items:
            tickets = outcome.tickets[start:start + len(item.messages)] if outcome.tickets else None
            start += len(item.messages)
            try:
                await self.settle(item, token, outcome, tickets)
            except Exception as error:
                # Its lease runs out and it comes back as an unknown outcome; the others still settle.
                logger.warning("Baby push reminder not settled: %s", type(error).__name__)

    async def final_check(self, ids, token):
        """The one check, right before the request: what goes, to which phones, within the message cap.

        Each reminder's reason first: role, settings, the record, its due time and zone, quiet hours.
        Then, last of all, the phones, the cap, the lease and the membership. Whatever changes after
        this races the request itself. Nothing checked here is older than ``CHECK_BUDGET``.
        """
        deadline, standing = now() + CHECK_BUDGET, []
        for identifier in ids:
            if now() >= deadline:
                await self.release(identifier, token)
                continue
            try:
                reminder = await self.reason_stands(identifier, token)
            except Exception as error:
                # One bad row must not use up the retries of the rest of its batch, or spin by itself.
                logger.warning("Baby push reminder not prepared: %s", type(error).__name__)
                with suppress(Exception):  # Locked too, say: its lease runs out, and it comes back then.
                    await self.not_prepared(identifier, token)
                continue
            if reminder:
                standing.append(reminder)
        return await self.seal(standing, token)

    async def reason_stands(self, identifier, token):
        """One reminder, as things are now. None means it doesn't go on this request, and says why in the row."""
        async with self.transaction() as db:
            row = await db.get(BabyNotification, identifier, with_for_update=True)
            if row is None or row.lease_token != token:
                return None
            moment = now()
            if row.lease_until <= moment:
                await db.rollback()
                await self.release(identifier, token)
                return None
            try:
                access = await reminder_access(db, row.app_user_id)
            except HTTPException:
                access = None
            prefs = await load_prefs(db, row.app_user_id, access.personal_space_id) if access else Prefs()
            pref = prefs.kind(row.kind)
            words = await resolve(db, row, access, prefs) if access and not row.dismissed_at else None
            if words is None:
                self.stand_down(row, moment)
            elif words.not_yet(moment):
                # Its time moved, with a new setting or zone. Waiting is not an attempt.
                row.status, row.lease_token, row.lease_until = "queued", None, None
                row.due_at, row.attempts, row.updated_at = words.due_at, max(row.attempts - 1, 0), moment
            elif not pref.break_through and (quiet := quiet_until(prefs.quiet_hours, moment)):
                # Held, not lost. Today already shows it. Waiting is not an attempt.
                row.status, row.lease_token, row.lease_until = "queued", None, quiet
                row.last_error, row.attempts, row.updated_at = QUIET_HELD, max(row.attempts - 1, 0), moment
            else:
                return Standing(
                    row.id, row.app_user_id, row.space_id, row.kind, row.collapse_id, pref.break_through,
                    ticket_state(row).get("retry"), words.held_as,
                )
            await db.commit()
            return None

    @staticmethod
    def stand_down(row, moment):
        """It won't go. A person's dismissal stays theirs; a reason that went can return, by the next plan."""
        state = ticket_state(row)
        row.lease_token, row.lease_until, row.updated_at = None, None, moment
        if row.dismissed_at:
            conclude(row, state, "failed", DISMISSED, moment)
            return
        conclude(row, state, "failed", CANCELLED, moment)
        row.dismissed_at = moment
        if state.get("tickets"):
            row.payload = {**row.payload, CLEARED: True}

    async def seal(self, standing, token):
        """The last statements before the request: read the phones, build the messages, confirm the leases."""
        if not standing:
            return []
        table, member, moment = BabyNotification, BabySpaceMember, now()
        phones, ready, no_phone, over, room = defaultdict(list), {}, [], [], MAX_MESSAGES
        async with self.transaction() as db:
            for device in await db.scalars(
                select(BabyPushDevice)
                .where(BabyPushDevice.app_user_id.in_({item.owner for item in standing}), BabyPushDevice.enabled.is_(True))
                .order_by(BabyPushDevice.id)
            ):
                phones[device.app_user_id].append(device)
            holdings = await held_routines(db, [device.id for reminder in standing if reminder.held_as for device in phones[reminder.owner]])
            for reminder in standing:
                devices = phones[reminder.owner]
                if reminder.owed is not None:
                    devices = [device for device in devices if str(device.id) in reminder.owed]
                if reminder.held_as:
                    # A phone that has never reported may still have its old schedule, so it gets no second copy.
                    record, schedule = reminder.held_as
                    devices = [device for device in devices if device.id in holdings and holdings[device.id].get(record) != schedule]
                if not devices:
                    no_phone.append(reminder.row_id)
                elif len(devices) > room:
                    over.append(reminder.row_id)  # A person's phones stay in one request, so all of it waits.
                else:
                    room -= len(devices)
                    ready[reminder.row_id] = Prepared(
                        reminder.row_id, reminder.owner, [(device.id, device.token) for device in devices],
                        [message_for(reminder, device) for device in devices],
                    )
            live = set(await db.scalars(
                update(table)
                .where(
                    table.id.in_(list(ready)), table.lease_token == token, table.lease_until > moment,
                    table.dismissed_at.is_(None),
                    select(member.space_id).where(
                        member.space_id == table.space_id, member.app_user_id == table.app_user_id,
                        member.status == "active",
                    ).exists(),
                )
                .values(lease_until=moment + LEASE)
                .returning(table.id)
                .execution_options(synchronize_session=False)
            )) if ready else set()
            await db.commit()
        for identifier in no_phone:
            await self.no_phone(identifier, token)
        for identifier in over:
            await self.release(identifier, token, delay=None)  # The next request has room, so this can't spin.
        for identifier in set(ready) - live:
            await self.release(identifier, token)
        return [item for identifier, item in ready.items() if identifier in live]

    async def release(self, identifier, token, delay=RELEASE_DELAY):
        """Back to waiting, unsent and uncounted."""
        async with self.transaction() as db:
            row = await db.get(BabyNotification, identifier, with_for_update=True)
            if row is not None and row.lease_token == token:
                row.status, row.lease_token = "queued", None
                row.lease_until = now() + delay if delay else None
                row.attempts, row.updated_at = max(row.attempts - 1, 0), now()
                await db.commit()

    async def not_prepared(self, identifier, token):
        async with self.transaction() as db:
            row = await db.get(BabyNotification, identifier, with_for_update=True)
            if row is not None and row.lease_token == token:
                row.lease_token, row.lease_until, row.updated_at = None, None, now()
                self.not_sent(row, Outcome("not_sent", "not_prepared"), now())
                await db.commit()

    async def no_phone(self, identifier, token):
        async with self.transaction() as db:
            row = await db.get(BabyNotification, identifier, with_for_update=True)
            if row is not None and row.lease_token == token:
                moment = now()
                conclude(row, ticket_state(row), "failed", "no_device", moment)
                row.lease_token, row.lease_until, row.updated_at = None, None, moment
                await db.commit()

    async def send(self, client, messages):
        try:
            async with asyncio.timeout(SEND_DEADLINE_SECONDS):
                response = await client.post(
                    SEND_URL, json=messages, headers={"Authorization": f"Bearer {push_access_token()}"}
                )
        except TimeoutError:
            return Outcome("unknown", "deadline")
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout):
            return Outcome("not_sent", "network")  # The request never left.
        except httpx.HTTPError:
            return Outcome("unknown", "network")
        status = response.status_code
        if status == 429:
            return Outcome("not_sent", "http_429", retry_after=retry_after_seconds(response))
        if status >= 500:
            return Outcome("unknown", f"http_{status}")
        if status in {401, 403}:
            # The token is wrong, not the reminder: it can still go once that is fixed.
            return Outcome("not_sent", f"http_{status}")
        if status != 200:
            return Outcome("rejected", f"http_{status}")
        try:
            tickets = response.json()["data"]
        except (KeyError, TypeError, ValueError):
            return Outcome("unknown", "malformed")
        if not isinstance(tickets, list) or len(tickets) != len(messages) or not all(
            isinstance(ticket, dict) for ticket in tickets
        ):
            return Outcome("unknown", "malformed")
        return Outcome("tickets", tickets=tickets)

    async def settle(self, item, token, outcome, tickets):
        async with self.transaction() as db:
            row = await db.get(BabyNotification, item.row_id, with_for_update=True)
            if row is None or row.lease_token != token:
                return  # Erased, or another worker has taken over after the lease ran out.
            moment = now()
            row.lease_token, row.lease_until, row.updated_at = None, None, moment
            if outcome.state == "tickets":
                await self.apply_tickets(db, row, item, tickets, moment)
            elif outcome.state == "unknown":
                self.unknown(row, outcome.code, moment)
            elif outcome.state == "not_sent":
                self.not_sent(row, outcome, moment)
            else:
                conclude(row, ticket_state(row), "failed", outcome.code, moment)
            if row.status == "queued" and row.dismissed_at:
                row.status, row.last_error, row.lease_until = "failed", DISMISSED, None
            await db.commit()

    @staticmethod
    def unknown(row, code, moment):
        row.last_error = code
        if row.unknown_retries:
            conclude(row, ticket_state(row), "unknown", code, moment)
            logger.warning("Baby push unknown outcomes: 1")
            return
        row.status, row.unknown_retries, row.lease_until = "queued", 1, moment + UNKNOWN_RETRY

    @staticmethod
    def not_sent(row, outcome, moment):
        row.last_error = outcome.code
        if row.attempts >= MAX_ATTEMPTS:
            conclude(row, ticket_state(row), "failed", outcome.code, moment)
            return
        row.status, row.lease_until = "queued", moment + backoff(row.attempts, outcome.retry_after)

    async def apply_tickets(self, db, row, item, tickets, moment):
        state = ticket_state(row)
        tries, retry, codes = state.get("retry", {}), {}, []
        accepted = state.setdefault("tickets", [])
        for (device_id, token), ticket in zip(item.devices, tickets, strict=True):
            if ticket.get("status") == "ok" and ticket.get("id"):
                accepted.append({
                    "id": str(ticket["id"]), "device": str(device_id), "token": fingerprint(token),
                    "tries": tries.get(str(device_id), 0),
                })
                continue
            code = str((ticket.get("details") or {}).get("error") or "ticket_error")[:80]
            so_far = tries.get(str(device_id), 0) + 1
            if code == RATE_LIMITED and so_far < MAX_ATTEMPTS:
                retry[str(device_id)] = so_far  # Only this phone goes again; the others have theirs.
                continue
            codes.append(code)
            if code == NOT_REGISTERED:
                await db.execute(delete(BabyPushDevice).where(
                    BabyPushDevice.id == device_id, BabyPushDevice.token == token
                ))
        self.owed(row, state, retry, codes, moment)

    @staticmethod
    def owed(row, state, retry, codes, moment):
        if retry:
            row.provider_ticket = json.dumps({**state, "retry": retry})
            row.status, row.last_error = "queued", RATE_LIMITED
            row.lease_until = moment + backoff(max(retry.values()))
            row.receipt_due_at = None
        else:
            conclude(row, state, "failed", codes[0] if codes else None, moment)

    async def check_receipts(self):
        """Expo's answer about each accepted send. True when a batch was read, as more may be waiting."""
        table, moment = BabyNotification, now()
        async with self.transaction() as db:
            if not await db.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": PUSH_LOCK}):
                return False
            rows = list(await db.scalars(
                select(table)
                .where(table.status == "accepted", table.receipt_due_at <= moment)
                .order_by(table.receipt_due_at, table.id)
                .limit(CLAIM_SIZE)
                .with_for_update(skip_locked=True)
            ))
            found = []
            for row in rows:
                # Moved on first, so a worker that dies here costs a later check rather than a lost one.
                row.receipt_due_at = moment + RECEIPT_RECHECK
                found.append((row.id, ticket_state(row)))
            await db.commit()
        if not found:
            return False
        ids = [ticket["id"] for _, stored in found for ticket in stored.get("tickets", [])]
        receipts = {}
        async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=5), transport=self.transport) as client:
            for start in range(0, len(ids), MAX_RECEIPT_IDS):
                receipts |= await self.fetch_receipts(client, ids[start:start + MAX_RECEIPT_IDS])
        for identifier, stored in found:
            await self.apply_receipts(identifier, stored, receipts)
        return True

    @staticmethod
    async def fetch_receipts(client, ids):
        try:
            async with asyncio.timeout(SEND_DEADLINE_SECONDS):
                response = await client.post(
                    RECEIPTS_URL, json={"ids": ids}, headers={"Authorization": f"Bearer {push_access_token()}"}
                )
            data = response.json()["data"] if response.status_code == 200 else {}
        except (TimeoutError, httpx.HTTPError, KeyError, TypeError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    async def apply_receipts(self, identifier, stored, receipts):
        tickets = stored.get("tickets", [])
        answers = [(ticket, receipts.get(ticket["id"])) for ticket in tickets]
        async with self.transaction() as db:
            row = await db.get(BabyNotification, identifier, with_for_update=True)
            if row is None or row.status != "accepted":
                return
            codes, retry, kept = [], {}, []
            for ticket, receipt in answers:
                if not isinstance(receipt, dict) or receipt.get("status") == "ok":
                    kept.append(ticket)
                    continue
                code = str((receipt.get("details") or {}).get("error") or "receipt_error")[:80]
                so_far = ticket.get("tries", 0) + 1
                if code == RATE_LIMITED and so_far < MAX_ATTEMPTS:
                    retry[ticket["device"]] = so_far
                    continue
                kept.append(ticket)
                codes.append(code)
                if code == NOT_REGISTERED:
                    device = await db.get(BabyPushDevice, UUID(ticket["device"]))
                    # The phone may have registered a new token under the same row since this send.
                    if device and fingerprint(device.token) == ticket["token"]:
                        await db.delete(device)
            row.updated_at = now()
            if retry:
                self.owed(row, {**stored, "tickets": kept, "checks": 0}, retry, codes, now())
                await db.commit()
                return
            checks = stored.get("checks", 0) + 1
            waiting = any(not isinstance(receipt, dict) for _, receipt in answers)
            if waiting and checks < MAX_RECEIPT_CHECKS:
                # Not ready yet, or Expo could not be reached: this waits for the next check.
                row.provider_ticket = json.dumps({**stored, "checks": checks})
            else:
                row.receipt_due_at = None
                if waiting:
                    row.last_error = "receipt_missing"
            if codes and len(codes) == len(tickets):
                row.status, row.last_error, row.receipt_due_at = "failed", codes[0], None
            await db.commit()

    async def maintain(self):
        """Plans what has changed and what no write announces, then prunes. True when more is waiting.

        Finished rows are kept long enough to explain a miss, then go.
        """
        moment = now()
        more = await self.plan_changed() or await self.sweep(moment)
        if self.pruned_at and moment - self.pruned_at < PRUNE_EVERY:
            return more
        self.pruned_at = moment
        table = BabyNotification
        async with self.transaction() as db:
            await db.execute(delete(table).where(
                table.status.in_(("accepted", "failed", "unknown")), table.due_at < moment - KEEP
            ))
            await db.commit()
        return more

    async def plan_changed(self):
        """Everyone in a space that just changed, for whom it matters. False when nothing was waiting."""
        people, self.people = self.people, set()
        spaces, self.spaces = self.spaces, set()
        if spaces:
            pref, member = BabyNotificationPref, BabySpaceMember
            async with self.sessions() as db:
                people |= set(await db.scalars(
                    select(pref.app_user_id)
                    .join(member, member.app_user_id == pref.app_user_id)
                    .where(member.space_id.in_(spaces), member.status == "active",
                           pref.enabled.is_(True), pref.kind.in_(PLANNERS))
                    .distinct()
                ))
        waiting = sorted(people)
        self.people |= set(waiting[PLAN_PAGE:])
        await self.plan(waiting[:PLAN_PAGE])
        return bool(self.people)

    async def sweep(self, moment):
        """A page of the people with something on. A full pass also catches anything a restart missed."""
        if self.sweep_after is None and self.swept_at and moment - self.swept_at < SWEEP_EVERY:
            return False
        pref = BabyNotificationPref
        query = select(pref.app_user_id).where(pref.enabled.is_(True), pref.kind.in_(PLANNERS)).distinct()
        if self.sweep_after is not None:
            query = query.where(pref.app_user_id > self.sweep_after)
        async with self.sessions() as db:
            people = list(await db.scalars(query.order_by(pref.app_user_id).limit(PLAN_PAGE)))
        await self.plan(people)
        if len(people) == PLAN_PAGE:
            self.sweep_after = people[-1]
            return True
        self.sweep_after, self.swept_at = None, moment
        return False

    async def plan(self, people):
        for person in people:
            try:
                async with self.transaction() as db:
                    await plan_person(db, person)
                    await db.commit()
            except Exception as error:
                # One person's bad row, or an erased account, must not stop anyone else's reminders.
                logger.warning("Baby push planning deferred: %s", type(error).__name__)


baby_push_worker = BabyPushWorker()
