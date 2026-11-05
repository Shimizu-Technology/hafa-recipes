"""The delivery contract: nothing lost, nothing sent twice on purpose, nothing real sent at all."""

import asyncio
import json
import os
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import event, select, text

from app.domains.baby import push_worker, reminders
from app.domains.baby.lifecycle import now
from app.domains.baby.models import (
    BabyMembership,
    BabyNotification,
    BabyPushDevice,
    BabySpace,
    BabySpaceMember,
)
from app.domains.baby.push import MAX_DEVICES
from app.domains.baby.push_worker import BabyPushWorker
from app.domains.baby.runtime import WORKER_LOCK
from tests import test_baby_integration as shared

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="Disposable TEST_DATABASE_URL required"
)
baby_api = shared.baby_api
CURRENT = {"X-Baby-Client": "2"}
WRITE = {**shared.GEN, **CURRENT}
PREFS = "/api/v1/baby/push/prefs"
DUE = "/api/v1/baby/reminders/due"
SECRET = "expo-secret-do-not-log"


class Expo:
    """Stands in for Expo. Every request lands here; nothing can reach the real service."""

    def __init__(self):
        self.sent, self.receipt_requests, self.headers = [], [], []
        self.answers = []  # Popped for each send: a response, an exception, or a ticket-making function.
        self.receipts = {}

    def transport(self):
        return httpx.MockTransport(self.handle)

    def handle(self, request):
        self.headers.append(request.headers.get("authorization"))
        body = json.loads(request.content)
        if request.url.path.endswith("/getReceipts"):
            self.receipt_requests.append(body["ids"])
            return httpx.Response(200, json={"data": {
                key: self.receipts[key] for key in body["ids"] if key in self.receipts
            }})
        assert request.url.path.endswith("/push/send")
        assert isinstance(body, list) and len(body) <= 100
        self.sent.append(body)
        answer = self.answers.pop(0) if self.answers else None
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, httpx.Response):
            return answer
        return httpx.Response(200, json={"data": [
            answer(message) if answer else {"status": "ok", "id": f"ticket-{uuid4()}"} for message in body
        ]})

    @property
    def messages(self):
        return [message for batch in self.sent for message in batch]


@pytest.fixture
async def push(baby_api, monkeypatch):
    baby_api.settings.baby_push_enabled = True
    baby_api.settings.expo_access_token = SecretStr(SECRET)
    expo = Expo()
    worker = BabyPushWorker(baby_api.sessions, transport=expo.transport())
    # A resolver can be swapped per test; nothing else in this file depends on trigger wording.
    monkeypatch.setattr(reminders, "RESOLVERS", {"event": _generic, "feed_interval": _generic})
    monkeypatch.setattr(push_worker, "plan_person", _no_plan, raising=False)
    monkeypatch.setattr(push_worker, "CHECK_BUDGET", timedelta(minutes=1))  # Its own test sets it.
    registration = await register(baby_api)
    await prefs(baby_api, {"kinds": {"event": {"enabled": True}}})
    return SimpleNamespace(**vars(baby_api), expo=expo, worker=worker, monkeypatch=monkeypatch, registration=registration)


def push_max_devices():
    return MAX_DEVICES


async def _generic(db, row, access, prefs):
    return reminders.Words(reminders.GENERIC)


async def _no_plan(db, person):
    """Rows here are queued by hand, so nothing should plan them away."""


async def register(api, install="phone-install-1", token="ExponentPushToken[one]", owner="owner"):
    response = await api.client.put(
        f"/api/v1/baby/push/devices/{install}", headers={**WRITE, "X-Test-Owner": owner},
        json={"token": token, "platform": "ios"},
    )
    assert response.status_code == 200, response.text
    return response.json()["registration"]


async def prefs(api, patch):
    response = await api.client.patch(PREFS, headers=WRITE, json=patch)
    assert response.status_code == 200, response.text


async def queue(api, *, kind="event", owner="owner", key=None, due=None, payload=None):
    async with api.sessions() as db:
        space = await db.scalar(select(BabyMembership.personal_space_id).filter_by(app_user_id=owner))
        await reminders.schedule(
            db, owner=owner, space_id=space, kind=kind, key=key or str(uuid4()),
            due_at=due or now() - timedelta(seconds=5), payload=payload,
        )
        await db.commit()
    return await only(api, owner=owner) if key is None and due is None else None


async def only(api, owner="owner"):
    rows = await rows_of(api, owner)
    return rows[-1]


async def rows_of(api, owner="owner"):
    async with api.sessions() as db:
        return list(await db.scalars(
            select(BabyNotification).filter_by(app_user_id=owner).order_by(BabyNotification.created_at)
        ))


async def reread(api, row):
    async with api.sessions() as db:
        return await db.get(BabyNotification, row.id)


async def make_due(api, row):
    """The wait is over: leases and backoff are in the past, which is all time does here."""
    async with api.sessions() as db:
        current = await db.get(BabyNotification, row.id)
        if current.lease_until:
            current.lease_until = now() - timedelta(seconds=1)
        await db.commit()


async def devices(api):
    async with api.sessions() as db:
        return list(await db.scalars(select(BabyPushDevice)))


async def due_items(api, owner="owner"):
    response = await api.client.get(DUE, headers={**CURRENT, "X-Test-Owner": owner})
    assert response.status_code == 200, response.text
    return response.json()["items"]


async def test_sends_with_bearer_and_a_minimal_payload(push):
    row = await queue(push)
    assert await push.worker.tick() is True
    assert push.expo.headers == [f"Bearer {SECRET}"]
    message = push.expo.messages[0]
    assert set(message) == {"to", "body", "data", "collapseId", "tag", "ttl", "priority", "sound"}
    assert message["to"] == "ExponentPushToken[one]"
    assert message["body"] == reminders.lock_screen("event")
    assert message["collapseId"] == message["tag"] == row.collapse_id
    assert len(row.collapse_id) <= 64
    assert set(message["data"]) == {"notification_id", "space_id", "identity"}
    assert "interruptionLevel" not in message
    row = await reread(push, row)
    assert row.status == "accepted" and row.lease_token is None and row.attempts == 1
    assert timedelta(minutes=14) < row.receipt_due_at - now() <= timedelta(minutes=15)
    assert await push.worker.tick() is False
    assert len(push.expo.sent) == 1


async def test_not_due_yet_is_left_alone(push):
    await queue(push, key="later", due=now() + timedelta(hours=1))
    assert await push.worker.tick() is False
    assert push.expo.sent == []
    delay = await push.worker.next_delay()
    assert 590 <= delay <= 600  # Sleeps to the cap, not an hour: another replica may queue sooner.
    await queue(push, key="soon", due=now() + timedelta(seconds=30))
    assert 20 < await push.worker.next_delay() <= 30


async def test_each_pass_is_one_request_of_at_most_100_messages_with_a_persons_phones_together(push):
    """Finding 4: what one claim can take is bounded by messages, not rows, so it can't outlast its lease."""
    for n in range(2, push_max_devices() + 1):
        await register(push, f"phone-install-{n}", f"ExponentPushToken[p{n}]")
    for n in range(25):
        await queue(push, key=f"many-{n}")
    for expected in (1, 2, 3):
        assert await push.worker.tick() is True
        assert len(push.expo.sent) == expected
    assert await push.worker.tick() is False
    assert all(len(batch) <= 100 and len(batch) % push_max_devices() == 0 for batch in push.expo.sent)
    assert len(push.expo.messages) == 250
    assert {row.status for row in await rows_of(push)} == {"accepted"}
    assert {row.attempts for row in await rows_of(push)} == {1}


async def test_two_workers_racing_send_each_reminder_once(push):
    for n in range(30):
        await queue(push, key=f"race-{n}")
    other = BabyPushWorker(push.sessions, transport=push.expo.transport())

    async def drain(worker):
        for _ in range(6):
            await worker.tick()

    await asyncio.gather(drain(push.worker), drain(other))
    keys = [message["collapseId"] for message in push.expo.messages]
    assert len(keys) == len(set(keys)) == 30
    assert {row.attempts for row in await rows_of(push)} == {1}


async def test_claiming_ignores_the_import_lock_and_respects_its_own(push):
    row = await queue(push)
    async with push.sessions() as guard:
        # BabyWorker can hold its lock for minutes while a video imports.
        assert await guard.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": WORKER_LOCK})
        assert await push.worker.tick() is True
        await guard.rollback()
    assert (await reread(push, row)).status == "accepted"
    second = await queue(push, key="second")
    assert second is None
    async with push.sessions() as guard:
        assert await guard.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": push_worker.PUSH_LOCK})
        assert await push.worker.claim() is None
        await guard.rollback()
    assert await push.worker.claim() is not None


async def test_a_row_someone_else_has_locked_is_skipped_rather_than_waited_for(push):
    row = await queue(push)
    async with push.sessions() as other:
        await other.get(BabyNotification, row.id, with_for_update=True)
        assert await asyncio.wait_for(push.worker.claim(), 5) is None
        await other.rollback()
    assert await push.worker.claim() is not None


async def test_restart_mid_send_retries_once_under_the_same_identity_then_stops(push):
    row = await queue(push)
    started, hold = asyncio.Event(), asyncio.Event()

    async def blocked(request):
        started.set()
        await hold.wait()

    class Hanging(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            push.expo.sent.append(json.loads(request.content))
            await blocked(request)

    dying = BabyPushWorker(push.sessions, transport=Hanging())
    task = asyncio.create_task(dying.tick())
    await asyncio.wait_for(started.wait(), 5)
    task.cancel()  # The process goes away with the request in flight.
    with pytest.raises(asyncio.CancelledError):
        await task
    assert (await reread(push, row)).status == "sending"
    # Nothing goes out again while the dead worker's lease could still be live.
    assert await push.worker.tick() is False
    assert len(push.expo.sent) == 1
    await make_due(push, row)
    assert await push.worker.tick() is True
    assert push.expo.messages[0]["collapseId"] == push.expo.messages[1]["collapseId"]
    row = await reread(push, row)
    assert row.status == "accepted" and row.unknown_retries == 1


async def test_second_crash_ends_as_unknown_and_stays_on_today(push, caplog):
    row = await queue(push)
    for _ in range(2):
        assert await push.worker.claim() is not None  # Claimed, then the process died.
        await make_due(push, row)
    assert await push.worker.claim() is None
    row = await reread(push, row)
    assert row.status == "unknown" and row.lease_token is None
    assert "unknown outcomes: 1" in caplog.text
    assert push.expo.sent == []
    assert [item["delivery"] for item in await due_items(push)] == ["unknown"]


@pytest.mark.parametrize("failure", [
    httpx.ReadTimeout("slow"), httpx.RemoteProtocolError("cut off"), httpx.Response(500), httpx.Response(503),
    httpx.Response(200, text="not json"), httpx.Response(200, json={"data": []}),
], ids=["read-timeout", "cut-off", "http-500", "http-503", "not-json", "wrong-count"])
async def test_unknown_outcome_retries_once_then_is_not_sent_again(push, failure):
    row = await queue(push)
    push.expo.answers = [failure, failure]
    await push.worker.tick()
    current = await reread(push, row)
    assert current.status == "queued" and current.unknown_retries == 1
    assert timedelta(minutes=1) < current.lease_until - now() <= timedelta(minutes=2)
    assert await push.worker.tick() is False  # Backing off.
    await make_due(push, row)
    await push.worker.tick()
    current = await reread(push, row)
    assert current.status == "unknown" and current.last_error
    assert len(push.expo.sent) == 2
    assert len({message["collapseId"] for message in push.expo.messages}) == 1
    await make_due(push, row)
    assert await push.worker.tick() is False
    assert len(push.expo.sent) == 2
    assert [item["delivery"] for item in await due_items(push)] == ["unknown"]


@pytest.mark.parametrize("failure", [httpx.ConnectError("down"), httpx.ConnectTimeout("down"), httpx.Response(429), httpx.Response(401)],
                         ids=["connect", "connect-timeout", "http-429", "http-401"])
async def test_a_send_that_never_happened_backs_off_without_using_the_retry(push, failure):
    row = await queue(push)
    waits = []
    push.expo.answers = [failure] * (push_worker.MAX_ATTEMPTS - 1)
    for _ in range(push_worker.MAX_ATTEMPTS - 1):
        await push.worker.tick()
        current = await reread(push, row)
        assert current.status == "queued" and current.unknown_retries == 0
        waits.append(round((current.lease_until - now()).total_seconds(), -1))
        await make_due(push, row)
    assert waits == sorted(waits) and waits[0] < waits[1]
    assert await push.worker.tick() is True  # It gets through in the end.
    assert (await reread(push, row)).status == "accepted"


async def test_gives_up_after_the_attempt_limit_but_stays_on_today(push):
    row = await queue(push)
    push.expo.answers = [httpx.ConnectError("down")] * push_worker.MAX_ATTEMPTS
    for _ in range(push_worker.MAX_ATTEMPTS):
        await push.worker.tick()
        await make_due(push, row)
    assert (await reread(push, row)).status == "failed"
    assert [item["delivery"] for item in await due_items(push)] == ["failed"]


async def test_retry_after_is_honoured(push):
    row = await queue(push)
    push.expo.answers = [httpx.Response(429, headers={"Retry-After": "900"})]
    await push.worker.tick()
    assert timedelta(minutes=14) < (await reread(push, row)).lease_until - now() <= timedelta(minutes=15)


async def test_bad_request_is_not_retried(push):
    row = await queue(push)
    push.expo.answers = [httpx.Response(400, json={"errors": [{"code": "PUSH_TOO_MANY_EXPERIENCE_IDS"}]})]
    await push.worker.tick()
    row = await reread(push, row)
    assert row.status == "failed" and row.last_error == "http_400"
    assert await push.worker.tick() is False


async def test_device_not_registered_ticket_stops_that_token_only(push):
    await register(push, "phone-install-2", "ExponentPushToken[two]")
    row = await queue(push)

    def ticket(message):
        if message["to"] == "ExponentPushToken[one]":
            return {"status": "error", "details": {"error": "DeviceNotRegistered"}, "message": "gone"}
        return {"status": "ok", "id": "ticket-two"}

    push.expo.answers = [ticket]
    await push.worker.tick()
    assert (await reread(push, row)).status == "accepted"
    assert [device.token for device in await devices(push)] == ["ExponentPushToken[two]"]
    await queue(push, key="next")
    await push.worker.tick()
    assert push.expo.messages[-1]["to"] == "ExponentPushToken[two]"
    assert len(push.expo.sent[-1]) == 1


async def test_rate_limited_ticket_waits_and_other_ticket_errors_fail(push):
    row = await queue(push)
    push.expo.answers = [lambda _: {"status": "error", "details": {"error": "MessageRateExceeded"}}]
    await push.worker.tick()
    assert (await reread(push, row)).status == "queued"
    await make_due(push, row)
    push.expo.answers = [lambda _: {"status": "error", "details": {"error": "InvalidCredentials"}}]
    await push.worker.tick()
    row = await reread(push, row)
    assert row.status == "failed" and row.last_error == "InvalidCredentials"


async def receipt_due(api, row):
    async with api.sessions() as db:
        current = await db.get(BabyNotification, row.id)
        current.receipt_due_at = now() - timedelta(seconds=1)
        await db.commit()


async def test_receipts_wait_about_15_minutes_then_ok_finishes(push):
    row = await queue(push)
    await push.worker.tick()
    assert await push.worker.tick() is False
    assert push.expo.receipt_requests == []
    ticket = json.loads((await reread(push, row)).provider_ticket)["tickets"][0]["id"]
    push.expo.receipts = {ticket: {"status": "ok"}}
    await receipt_due(push, row)
    assert await push.worker.tick() is True
    assert push.expo.receipt_requests == [[ticket]]
    assert push.expo.headers[-1] == f"Bearer {SECRET}"
    row = await reread(push, row)
    assert row.status == "accepted" and row.receipt_due_at is None
    assert await push.worker.tick() is False


async def test_device_not_registered_receipt_removes_the_token_that_was_sent_to(push):
    row = await queue(push)
    await push.worker.tick()
    ticket = json.loads((await reread(push, row)).provider_ticket)["tickets"][0]["id"]
    push.expo.receipts = {ticket: {"status": "error", "details": {"error": "DeviceNotRegistered"}}}
    await receipt_due(push, row)
    await push.worker.tick()
    assert await devices(push) == []
    row = await reread(push, row)
    assert row.status == "failed" and row.last_error == "DeviceNotRegistered"
    # Today does not depend on any of this.
    assert len(await due_items(push)) == 1


async def test_late_receipt_leaves_a_token_the_phone_has_since_replaced(push):
    row = await queue(push)
    await push.worker.tick()
    await register(push, token="ExponentPushToken[fresh]")
    ticket = json.loads((await reread(push, row)).provider_ticket)["tickets"][0]["id"]
    push.expo.receipts = {ticket: {"status": "error", "details": {"error": "DeviceNotRegistered"}}}
    await receipt_due(push, row)
    await push.worker.tick()
    assert [device.token for device in await devices(push)] == ["ExponentPushToken[fresh]"]


async def test_missing_receipts_are_checked_a_bounded_number_of_times(push):
    row = await queue(push)
    await push.worker.tick()
    for _ in range(push_worker.MAX_RECEIPT_CHECKS):
        assert (await reread(push, row)).receipt_due_at is not None
        await receipt_due(push, row)
        assert await push.worker.tick() is True
    row = await reread(push, row)
    assert row.status == "accepted" and row.receipt_due_at is None and row.last_error == "receipt_missing"
    assert len(push.expo.receipt_requests) == push_worker.MAX_RECEIPT_CHECKS


def quiet_around_now(zone="UTC"):
    from zoneinfo import ZoneInfo

    moment = now().astimezone(ZoneInfo(zone))
    return {
        "start": (moment - timedelta(hours=1)).strftime("%H:%M"),
        "end": (moment + timedelta(hours=1)).strftime("%H:%M"),
        "timezone": zone,
    }


@pytest.mark.parametrize("zone", ["Pacific/Guam", "America/New_York"])
async def test_quiet_hours_hold_a_reminder_in_the_persons_zone_and_keep_it_on_today(push, zone):
    await prefs(push, {"quiet_hours": quiet_around_now(zone)})
    row = await queue(push)
    await push.worker.tick()
    assert push.expo.sent == []
    current = await reread(push, row)
    assert current.status == "queued" and current.attempts == 0 and current.unknown_retries == 0
    assert timedelta(minutes=55) < current.lease_until - now() <= timedelta(hours=1)
    assert [item["delivery"] for item in await due_items(push)] == ["queued"]
    assert await push.worker.tick() is False
    assert 500 < await push.worker.next_delay() <= 600
    await make_due(push, row)
    await prefs(push, {"quiet_hours": None})
    await push.worker.tick()
    assert (await reread(push, row)).status == "accepted"


async def test_break_through_ignores_quiet_hours_and_is_the_only_time_sensitive_send(push):
    await prefs(push, {"quiet_hours": quiet_around_now(), "kinds": {"event": {"break_through": True}}})
    await queue(push)
    await push.worker.tick()
    assert push.expo.messages[0]["interruptionLevel"] == "time-sensitive"


async def test_a_provider_only_ever_gets_fixed_text_and_opaque_identifiers(push):
    """Finding 7: no name, title, time or week leaves the server, for any item, private or shared."""
    async def words(db, row, access, prefs):
        return reminders.Words("Baby Mia at the clinic, week 31", {"event_id": "abc", "week": 31})

    push.monkeypatch.setitem(reminders.RESOLVERS, "event", words)
    row = await queue(push)
    await push.worker.tick()
    message = push.expo.messages[0]
    assert message["body"] == reminders.lock_screen("event") and "title" not in message
    assert message["data"] == {
        "notification_id": str(row.id), "space_id": str(row.space_id), "identity": row.collapse_id,
    }
    assert "Mia" not in json.dumps(message) and "31" not in message["body"] and "week" not in json.dumps(message)
    # Their own Today can say more than their lock screen.
    assert (await due_items(push))[0]["text"] == "Baby Mia at the clinic, week 31"


async def test_opt_out_after_queueing_stops_the_send_and_clears_today(push):
    row = await queue(push)
    assert len(await due_items(push)) == 1
    await prefs(push, {"kinds": {"event": {"enabled": False}}})
    assert await due_items(push) == []
    await push.worker.tick()
    assert push.expo.sent == []
    row = await reread(push, row)
    assert row.status == "failed" and row.dismissed_at is not None


async def test_changed_consent_stops_what_ran_under_the_old_permission(push):
    async with push.sessions() as db:
        epoch = await db.scalar(select(BabyMembership.consent_epoch).filter_by(app_user_id="owner"))
    current = await queue(push, payload={"consent_epoch": epoch})
    await push.worker.tick()
    assert (await reread(push, current)).status == "accepted"
    stale = await queue(push, payload={"consent_epoch": epoch + 1})
    await push.worker.tick()
    assert (await reread(push, stale)).status == "failed"
    assert len(push.expo.sent) == 1


async def test_leaving_the_app_stops_the_send(push):
    row = await queue(push)
    async with push.sessions() as db:
        member = await db.get(BabyMembership, "owner")
        member.status = "deleted"
        await db.commit()
    await push.worker.tick()
    assert push.expo.sent == []
    assert (await reread(push, row)).status == "failed"


async def test_erasure_removes_the_queue(push):
    await queue(push)
    response = await push.client.delete("/api/v1/baby/data?generation=1", headers=WRITE)
    assert response.status_code == 200
    await push.worker.tick()
    assert push.expo.sent == [] and await rows_of(push) == []


async def test_token_removed_after_queueing_is_not_sent_to_and_today_still_shows_it(push):
    row = await queue(push)
    url = f"/api/v1/baby/push/devices/phone-install-1?registration={push.registration}"
    assert (await push.client.delete(url, headers=CURRENT)).status_code == 204
    await push.worker.tick()
    assert push.expo.sent == []
    row = await reread(push, row)
    assert row.status == "failed" and row.last_error == "no_device" and row.dismissed_at is None
    assert [item["delivery"] for item in await due_items(push)] == ["failed"]


async def test_a_bad_reminder_does_not_use_up_the_rest_of_its_batch(push):
    async def broken(db, row, access, prefs):
        if row.payload.get("bad"):
            raise ValueError("private detail")
        return reminders.Words("ok")

    push.monkeypatch.setitem(reminders.RESOLVERS, "event", broken)
    bad = await queue(push, payload={"bad": True})
    good = await queue(push)
    await push.worker.tick()
    bad = await reread(push, bad)
    assert bad.status == "queued" and bad.last_error == "not_prepared"
    assert bad.lease_until > now()  # Backs off, so one bad row can't spin.
    assert (await reread(push, good)).status == "accepted"
    assert (await reread(push, good)).unknown_retries == 0


async def test_today_lists_due_until_dismissed_and_is_private(push):
    await register(push, token="ExponentPushToken[theirs]", install="other-install", owner="other")
    row = await queue(push)
    await queue(push, key="later", due=now() + timedelta(hours=2))
    items = await due_items(push)
    assert [item["id"] for item in items] == [str(row.id)]
    assert items[0]["identity"] == row.collapse_id
    assert await due_items(push, owner="other") == []
    url = f"/api/v1/baby/reminders/{row.id}/dismiss"
    assert (await push.client.post(url, headers={**WRITE, "X-Test-Owner": "other"})).status_code == 204
    assert len(await due_items(push)) == 1
    for _ in range(2):
        assert (await push.client.post(url, headers=WRITE)).status_code == 204
    assert await due_items(push) == []
    await push.worker.tick()
    assert push.expo.sent == []  # Dismissed before its turn, so it is never sent.


async def test_today_routes_are_gated(push):
    assert (await push.client.get(DUE)).status_code == 404
    push.settings.baby_push_enabled = False
    assert (await push.client.get(DUE, headers=CURRENT)).status_code == 404


async def test_dismissing_during_a_send_stops_a_retry(push):
    row = await queue(push)
    push.expo.answers = [httpx.ReadTimeout("slow")]
    original = push.worker.send

    async def dismissed_meanwhile(client, messages):
        outcome = await original(client, messages)
        url = f"/api/v1/baby/reminders/{row.id}/dismiss"
        assert (await push.client.post(url, headers=WRITE)).status_code == 204
        return outcome

    push.worker.send = dismissed_meanwhile
    await push.worker.tick()
    row = await reread(push, row)
    assert row.status == "failed" and row.last_error == "dismissed"
    assert await push.worker.tick() is False
    assert await push.worker.next_delay() == 600


async def test_schedule_is_once_per_key_and_follows_a_moved_time(push):
    due = now() + timedelta(hours=1)
    await queue(push, key="same", due=due)
    await queue(push, key="same", due=due)
    moved = due + timedelta(hours=1)
    await queue(push, key="same", due=moved)
    rows = await rows_of(push)
    assert len(rows) == 1 and rows[0].due_at == moved


async def test_scheduling_again_never_resets_the_retry_or_touches_a_sent_reminder(push):
    row = await queue(push, key="same", due=now() - timedelta(seconds=1)) or await only(push)
    push.expo.answers = [httpx.ReadTimeout("slow")]
    await push.worker.tick()
    await queue(push, key="same", due=now() + timedelta(seconds=5))
    current = await reread(push, row)
    assert current.status == "queued" and current.unknown_retries == 1 and current.lease_until is not None
    async with push.sessions() as db:
        (await db.get(BabyNotification, row.id)).status = "accepted"
        await db.commit()
    later = now() + timedelta(days=1)
    await queue(push, key="same", due=later)
    current = await reread(push, row)
    assert current.status == "accepted" and current.due_at != later


async def test_cancelled_comes_back_when_rescheduled_but_dismissed_does_not(push):
    await queue(push, key="edited", due=now() + timedelta(hours=1))
    await queue(push, key="closed", due=now() + timedelta(hours=1))
    async with push.sessions() as db:
        await reminders.cancel(db, BabyNotification.idempotency_key.like("%edited"))
        await reminders.dismiss(db, BabyNotification.idempotency_key.like("%closed"))
        await db.commit()
    for key in ("edited", "closed"):
        await queue(push, key=key, due=now() + timedelta(hours=2))
    state = {row.idempotency_key.rsplit(":", 1)[1]: (row.status, row.dismissed_at is None) for row in await rows_of(push)}
    assert state == {"edited": ("queued", True), "closed": ("failed", False)}


async def test_idle_pass_is_a_handful_of_queries(push):
    await push.worker.tick()  # The first pass may also prune.
    statements = []

    def count(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(push.engine.sync_engine, "before_cursor_execute", count)
    try:
        assert await push.worker.tick() is False
        assert await push.worker.next_delay() == 600
    finally:
        event.remove(push.engine.sync_engine, "before_cursor_execute", count)
    assert len(statements) <= 10


async def test_old_finished_rows_are_pruned_and_waiting_ones_kept(push):
    old = now() - push_worker.KEEP - timedelta(days=1)
    await queue(push, key="finished", due=old)
    await queue(push, key="waiting", due=old)
    async with push.sessions() as db:
        await reminders.cancel(db, BabyNotification.idempotency_key.like("%finished"))
        await db.commit()
    await push.worker.maintain()
    assert [row.idempotency_key.rsplit(":", 1)[1] for row in await rows_of(push)] == ["waiting"]


async def test_with_the_flag_off_the_worker_never_starts_and_no_token_means_nothing_is_sent(push):
    from app.domains.baby import security

    worker = BabyPushWorker(push.sessions, transport=push.expo.transport())
    push.settings.baby_push_enabled = False
    await worker.start()
    assert worker.task is None
    assert not [task for task in asyncio.all_tasks() if task.get_name() == "baby-push-worker"]
    push.settings.baby_push_enabled = True
    assert security.push_access_token() == SECRET
    await worker.start()
    assert worker.task is not None
    await worker.stop()
    assert worker.task is None
    # Before N0's token arrives Today works; the row waits, unspent, without waking anyone or spinning.
    push.settings.expo_access_token = None
    row = await queue(push)
    assert await push.worker.tick() is False
    assert await push.worker.next_delay() == push_worker.IDLE_SECONDS
    assert push.expo.sent == []
    current = await reread(push, row)
    assert current.status == "queued" and current.attempts == 0
    assert len(await due_items(push)) == 1


async def test_running_worker_wakes_and_sends_and_never_spins(push, monkeypatch):
    worker = BabyPushWorker(push.sessions, transport=push.expo.transport())
    await push.worker.tick()
    await worker.start()
    try:
        await asyncio.sleep(0.4)  # Long enough to be asleep for the ten-minute cap.
        await queue(push, key="now", due=now())
        worker.notify()
        for _ in range(50):
            if push.expo.sent:
                break
            await asyncio.sleep(0.1)
        assert len(push.expo.sent) == 1
    finally:
        await worker.stop()
    passes = []

    async def always_busy():
        passes.append(1)
        return True

    monkeypatch.setattr(worker, "tick", always_busy)
    await worker.start()
    await asyncio.sleep(0.5)
    await worker.stop()
    assert 1 <= len(passes) <= 4  # A pass that always finds work still pauses.


async def test_secret_and_tokens_stay_out_of_logs_and_rows(push, caplog):
    caplog.set_level("DEBUG")
    row = await queue(push)
    push.expo.answers = [httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow")]
    await push.worker.tick()
    await make_due(push, row)
    await push.worker.tick()
    assert SECRET not in caplog.text and "ExponentPushToken" not in caplog.text
    row = await reread(push, row)
    assert "ExponentPushToken" not in json.dumps([row.payload, row.last_error, row.provider_ticket])
    # The token setting cannot be printed by accident either.
    assert SECRET not in repr(push.settings.expo_access_token)


async def test_restart_loses_nothing(push):
    """The plan's N2 gate: a reminder waiting, one in flight and one held all survive a new process."""
    waiting = await queue(push)
    assert await push.worker.claim() is not None  # This one was leased when the process died.
    in_flight = waiting
    await queue(push, key="queued-when-it-died")
    fresh = BabyPushWorker(push.sessions, transport=push.expo.transport())
    assert await fresh.tick() is True
    assert [message["data"]["notification_id"] for message in push.expo.messages] == [
        str(row.id) for row in await rows_of(push) if row.id != in_flight.id
    ]
    # The dead worker's lease is still running, so its reminder isn't sent over it, or lost.
    assert (await reread(push, in_flight)).status == "sending"
    await make_due(push, in_flight)
    assert await fresh.tick() is True
    current = await reread(push, in_flight)
    assert current.status == "accepted" and current.unknown_retries == 1
    assert {row.status for row in await rows_of(push)} == {"accepted"}
    assert len(await due_items(push)) == 2


def before_final_check(worker, change):
    """Whatever lands after the claim and any earlier look, up to the last one before the request."""
    original = worker.final_check

    async def changed_first(*args):
        await change()
        return await original(*args)

    worker.final_check = changed_first


async def test_a_phone_that_changes_hands_after_the_claim_gets_nothing_about_the_old_account(push):
    """The phone is someone else's by the time the request goes."""
    row = await queue(push)

    async def signed_in_meanwhile():
        await register(push, install="their-install", owner="other")  # The same token, now theirs.

    before_final_check(push.worker, signed_in_meanwhile)
    await push.worker.tick()
    assert push.expo.sent == []
    assert (await reread(push, row)).status == "failed"
    assert [device.app_user_id for device in await devices(push)] == ["other"]
    assert len(await due_items(push)) == 1  # Today doesn't depend on a phone.


@pytest.mark.parametrize("change", ["removed", "dismissed", "lease_taken", "lease_lost"])
async def test_each_batch_is_checked_just_before_it_goes(push, change):
    row = await queue(push)

    async def changed_meanwhile():
        async with push.sessions() as db:
            current = await db.get(BabyNotification, row.id)
            if change == "removed":
                link = await db.get(BabySpaceMember, (row.space_id, "owner"))
                link.status = "removed"
            elif change == "dismissed":
                current.dismissed_at = now()
            elif change == "lease_taken":
                current.lease_token = uuid4()
            else:
                current.lease_until = now() - timedelta(seconds=1)
            await db.commit()

    before_final_check(push.worker, changed_meanwhile)
    await push.worker.tick()
    assert push.expo.sent == []


async def test_a_lease_or_membership_lost_while_the_batch_is_being_checked_stops_it_too(push):
    """The very last statement before the request confirms the lease and the membership."""
    row = await queue(push)
    original = push.worker.reason_stands

    async def removed_meanwhile(identifier, token):
        reminder = await original(identifier, token)
        async with push.sessions() as db:
            (await db.get(BabySpaceMember, (row.space_id, "owner"))).status = "removed"
            await db.commit()
        return reminder

    push.worker.reason_stands = removed_meanwhile
    await push.worker.tick()
    assert push.expo.sent == []
    assert (await reread(push, row)).attempts == 0


async def test_the_cap_applies_to_the_messages_actually_prepared(push):
    """Finding 2: claimed at one phone each, then nine more phones registered. 110 went; 100 is the limit."""
    for n in range(11):
        await queue(push, key=f"many-{n}")
    token, ids = await push.worker.claim()
    assert len(ids) == 11
    for n in range(2, 11):
        await register(push, f"phone-install-{n}", f"ExponentPushToken[p{n}]")
    await push.worker.deliver(token, ids)
    assert [len(batch) for batch in push.expo.sent] == [100]
    rows = await rows_of(push)
    waiting = [row for row in rows if row.status == "queued"]
    assert len(waiting) == 1 and waiting[0].attempts == 0 and waiting[0].lease_until is None
    assert await push.worker.tick() is True  # Released without waiting, and it fits the next request.
    assert [len(batch) for batch in push.expo.sent] == [100, 10]
    rows = await rows_of(push)
    assert {row.status for row in rows} == {"accepted"} and {row.attempts for row in rows} == {1}


async def test_a_batch_past_its_deadline_stops_and_the_rest_wait_unspent(push, monkeypatch):
    """Finding 4: checks that run long stop at the deadline, and nothing is sent for rows after it."""
    for n in range(3):
        await queue(push, key=f"slow-{n}")
    monkeypatch.setattr(push_worker, "CHECK_BUDGET", timedelta(0))
    assert await push.worker.tick() is True
    assert push.expo.sent == []
    rows = await rows_of(push)
    assert {row.status for row in rows} == {"queued"} and {row.attempts for row in rows} == {0}
    assert all(row.lease_until > now() for row in rows)
    assert await push.worker.tick() is False  # Not reclaimed at once: it can't spin.


async def test_an_expired_lease_stops_before_the_send(push):
    row = await queue(push)
    token, ids = await push.worker.claim()
    await make_due(push, row)
    await push.worker.deliver(token, ids)
    assert push.expo.sent == []
    assert (await reread(push, row)).status == "queued"


async def test_leases_are_renewed_right_before_the_send(push):
    """Finding 4: checking a long batch can use up most of a lease; what's left must outlast the request."""
    row = await queue(push)
    token, ids = await push.worker.claim()

    async def slow_batch():
        async with push.sessions() as db:
            (await db.get(BabyNotification, row.id)).lease_until = now() + timedelta(seconds=5)
            await db.commit()

    before_final_check(push.worker, slow_batch)
    leases = []
    send = push.worker.send

    async def looking(client, messages):
        leases.append((await reread(push, row)).lease_until)
        return await send(client, messages)

    push.worker.send = looking
    await push.worker.deliver(token, ids)
    assert leases[0] - now() > timedelta(seconds=push_worker.SEND_DEADLINE_SECONDS)


async def test_a_request_that_hangs_ends_at_its_deadline_as_an_unknown_outcome(push, monkeypatch):
    row = await queue(push)

    class Hanging(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            await asyncio.sleep(60)

    monkeypatch.setattr(push_worker, "SEND_DEADLINE_SECONDS", 0.1)
    worker = BabyPushWorker(push.sessions, transport=Hanging())
    await asyncio.wait_for(worker.tick(), 10)
    current = await reread(push, row)
    assert current.status == "queued" and current.unknown_retries == 1 and current.last_error == "deadline"


async def test_a_batch_held_in_a_writers_lock_defers_instead_of_blocking(push, monkeypatch):
    row = await queue(push)
    monkeypatch.setattr(push_worker, "LOCK_TIMEOUT", "100ms")
    token, ids = await push.worker.claim()
    async with push.sessions() as writer:
        await writer.get(BabyNotification, row.id, with_for_update=True)
        await asyncio.wait_for(push.worker.deliver(token, ids), 10)
        await writer.rollback()
    assert push.expo.sent == []
    current = await reread(push, row)
    assert current.status == "sending"  # Its lease runs out, and it comes back then.


async def test_a_rate_limited_phone_alone_goes_again_and_the_reminder_ends_accepted(push):
    """Finding 8: one phone took it and one was rate limited, so only that one is owed a retry."""
    await register(push, "phone-install-2", "ExponentPushToken[two]")
    row = await queue(push)

    def ticket(message):
        if message["to"] == "ExponentPushToken[two]":
            return {"status": "error", "details": {"error": "MessageRateExceeded"}}
        return {"status": "ok", "id": "ticket-one"}

    push.expo.answers = [ticket]
    await push.worker.tick()
    current = await reread(push, row)
    assert current.status == "queued" and current.last_error == "MessageRateExceeded"
    assert current.lease_until > now() and current.receipt_due_at is None
    assert await push.worker.tick() is False  # Backing off.
    await make_due(push, row)
    await push.worker.tick()
    assert [message["to"] for message in push.expo.sent[-1]] == ["ExponentPushToken[two]"]
    current = await reread(push, row)
    assert current.status == "accepted" and current.last_error is None and current.unknown_retries == 0
    state = json.loads(current.provider_ticket)
    assert [ticket["id"] for ticket in state["tickets"]][0] == "ticket-one" and len(state["tickets"]) == 2
    assert "retry" not in state


async def test_a_rate_limited_phone_stops_after_the_limit_and_the_other_phones_send_still_counts(push):
    await register(push, "phone-install-2", "ExponentPushToken[two]")
    row = await queue(push)

    def ticket(message):
        if message["to"] == "ExponentPushToken[two]":
            return {"status": "error", "details": {"error": "MessageRateExceeded"}}
        return {"status": "ok", "id": "ticket-one"}

    push.expo.answers = [ticket] + [lambda _: {"status": "error", "details": {"error": "MessageRateExceeded"}}] * 20
    for _ in range(push_worker.MAX_ATTEMPTS + 2):
        await push.worker.tick()
        await make_due(push, row)
    current = await reread(push, row)
    assert current.status == "accepted" and current.last_error == "MessageRateExceeded"
    assert len(push.expo.sent) == push_worker.MAX_ATTEMPTS
    assert current.receipt_due_at is not None
    assert await push.worker.tick() is False
    assert len(push.expo.sent) == push_worker.MAX_ATTEMPTS


async def test_a_new_phone_registered_during_a_retry_is_not_part_of_it(push):
    await register(push, "phone-install-2", "ExponentPushToken[two]")
    row = await queue(push)

    def ticket(message):
        if message["to"] == "ExponentPushToken[two]":
            return {"status": "error", "details": {"error": "MessageRateExceeded"}}
        return {"status": "ok", "id": "ticket-one"}

    push.expo.answers = [ticket]
    await push.worker.tick()
    await register(push, "phone-install-3", "ExponentPushToken[three]")
    await make_due(push, row)
    await push.worker.tick()
    assert [message["to"] for message in push.expo.sent[-1]] == ["ExponentPushToken[two]"]


async def test_a_rate_limited_receipt_retries_that_phone_only(push):
    await register(push, "phone-install-2", "ExponentPushToken[two]")
    row = await queue(push)
    await push.worker.tick()
    tickets = json.loads((await reread(push, row)).provider_ticket)["tickets"]
    assert len(tickets) == 2
    limited = tickets[1]
    limited_phone = next(d.token for d in await devices(push) if str(d.id) == limited["device"])
    push.expo.receipts = {
        tickets[0]["id"]: {"status": "ok"},
        limited["id"]: {"status": "error", "details": {"error": "MessageRateExceeded"}},
    }
    await receipt_due(push, row)
    await push.worker.tick()
    current = await reread(push, row)
    assert current.status == "queued" and current.receipt_due_at is None
    await make_due(push, row)
    await push.worker.tick()
    assert [message["to"] for message in push.expo.sent[-1]] == [limited_phone]
    assert (await reread(push, row)).status == "accepted"


async def test_a_rate_limited_phone_that_goes_away_ends_the_retry(push):
    registration = await register(push, "phone-install-2", "ExponentPushToken[two]")
    row = await queue(push)

    def ticket(message):
        if message["to"] == "ExponentPushToken[two]":
            return {"status": "error", "details": {"error": "MessageRateExceeded"}}
        return {"status": "ok", "id": "ticket-one"}

    push.expo.answers = [ticket]
    await push.worker.tick()
    url = f"/api/v1/baby/push/devices/phone-install-2?registration={registration}"
    assert (await push.client.delete(url, headers=CURRENT)).status_code == 204
    await make_due(push, row)
    sent = len(push.expo.sent)
    await push.worker.tick()
    assert len(push.expo.sent) == sent
    assert (await reread(push, row)).status == "accepted"


async def test_a_repeated_hour_holds_a_reminder_in_the_future_and_never_reclaims_it(push, monkeypatch):
    """Finding 3: old code returned an end an hour in the past, and the row was claimed again at once."""
    await prefs(push, {"quiet_hours": {"start": "22:00", "end": "01:30", "timezone": "America/New_York"}})
    moment = datetime(2026, 11, 1, 6, 15, tzinfo=UTC)  # 01:15 the second time round.
    row = await queue(push, key="dst", due=moment - timedelta(minutes=1)) or await only(push)
    monkeypatch.setattr(push_worker, "now", lambda: moment)
    monkeypatch.setattr(reminders, "now", lambda: moment)
    for _ in range(3):
        claimed = await push.worker.claim()
        if claimed:
            await push.worker.deliver(*claimed)
    assert push.expo.sent == []
    current = await reread(push, row)
    assert current.status == "queued" and current.lease_until == datetime(2026, 11, 1, 6, 30, tzinfo=UTC)
    assert current.attempts == 0
    assert await push.worker.claim() is None
    monkeypatch.setattr(push_worker, "now", lambda: datetime(2026, 11, 1, 6, 30, tzinfo=UTC))
    claimed = await push.worker.claim()
    await push.worker.deliver(*claimed)
    assert len(push.expo.sent) == 1


async def test_spring_forward_holds_to_a_real_moment(push, monkeypatch):
    await prefs(push, {"quiet_hours": {"start": "22:00", "end": "02:30", "timezone": "America/New_York"}})
    moment = datetime(2027, 3, 14, 7, 10, tzinfo=UTC)  # 03:10 EDT; 02:30 was skipped.
    row = await queue(push, key="dst", due=moment - timedelta(minutes=1)) or await only(push)
    monkeypatch.setattr(push_worker, "now", lambda: moment)
    monkeypatch.setattr(reminders, "now", lambda: moment)
    await push.worker.deliver(*await push.worker.claim())
    current = await reread(push, row)
    assert current.status == "queued" and current.lease_until > moment
    assert await push.worker.claim() is None
    assert push.expo.sent == []


async def test_guam_has_no_clock_change_and_holds_to_seven(push, monkeypatch):
    await prefs(push, {"quiet_hours": {"start": "22:00", "end": "07:00", "timezone": "Pacific/Guam"}})
    moment = datetime(2026, 11, 1, 16, 0, tzinfo=UTC)  # 02:00 on Guam.
    row = await queue(push, key="guam", due=moment - timedelta(minutes=1)) or await only(push)
    monkeypatch.setattr(push_worker, "now", lambda: moment)
    await push.worker.deliver(*await push.worker.claim())
    assert (await reread(push, row)).lease_until == datetime(2026, 11, 1, 21, 0, tzinfo=UTC)


@pytest.mark.parametrize("change", ["removed", "caregiver", "pref_off", "deleted_account"])
async def test_who_may_hear_is_checked_at_the_last_moment(push, change, monkeypatch):
    """Family review: membership, role and settings are all read again right before the send."""
    await prefs(push, {"kinds": {"feed_interval": {"enabled": True, "hours": 2}}})
    row = await queue(push, kind="feed_interval")
    async with push.sessions() as db:
        link = await db.get(BabySpaceMember, (row.space_id, "owner"))
        member = await db.get(BabyMembership, "owner")
        if change == "removed":
            link.status = "removed"
        elif change == "caregiver":
            link.role = "caregiver"
        elif change == "deleted_account":
            member.status = "deleted"
        await db.commit()
    if change == "pref_off":
        await prefs(push, {"kinds": {"feed_interval": {"enabled": False, "hours": 2}}})
    if change in {"removed", "caregiver"} and not push.settings.baby_family_enabled:
        pytest.skip("Roles are read from spaces when family access is on")
    await push.worker.tick()
    assert push.expo.sent == []
    current = await reread(push, row)
    assert current.status == "failed" and current.dismissed_at is not None


@pytest.mark.parametrize("kind", ["event", "running_timer"])
async def test_caregivers_hear_only_about_what_they_help_with(push, kind):
    access = SimpleNamespace(enabled=True, spaces=(SimpleNamespace(id="family", role="caregiver"),), personal_space_id="own")
    assert reminders.may_hear(access, kind, "family")


@pytest.mark.parametrize("kind", ["feed_interval", "visit_prep", "pregnancy_week", "import", "milestone_window", "well_visit"])
async def test_caregivers_hear_nothing_else_and_nobody_hears_about_a_space_they_are_not_in(push, kind):
    access = SimpleNamespace(enabled=True, spaces=(SimpleNamespace(id="family", role="caregiver"),), personal_space_id="own")
    assert not reminders.may_hear(access, kind, "family")
    assert not reminders.may_hear(access, "event", "someone-elses")


async def test_a_late_sign_out_does_not_stop_reminders_to_the_newer_registration(push):
    first = push.registration
    await register(push)  # Signed in again before the old sign-out arrived.
    url = f"/api/v1/baby/push/devices/phone-install-1?registration={first}"
    assert (await push.client.delete(url, headers=CURRENT)).status_code == 204
    await queue(push)
    await push.worker.tick()
    assert len(push.expo.messages) == 1


async def plans_of(api, run, word):
    """EXPLAIN what the worker actually ran, with the values it ran it with."""
    seen = []

    def note(conn, cursor, statement, parameters, context, executemany):
        if word in statement and "EXPLAIN" not in statement:
            seen.append((statement, parameters))

    event.listen(api.engine.sync_engine, "before_cursor_execute", note)
    try:
        await run()
    finally:
        event.remove(api.engine.sync_engine, "before_cursor_execute", note)
    assert seen, word
    async with api.engine.connect() as connection:
        return ["\n".join(row[0] for row in await connection.exec_driver_sql("EXPLAIN " + statement, parameters))
                for statement, parameters in seen]


@pytest.mark.parametrize("baby_api", [60], indirect=True)
async def test_receipt_work_reads_the_partial_index_not_the_whole_history(push):
    """Finding 5: 200,000 reminders with 100 receipts due scanned the table, in both places receipts are read."""
    async with push.sessions() as db:
        space = await db.scalar(select(BabyMembership.personal_space_id).filter_by(app_user_id="owner"))
        await db.execute(text("""
            INSERT INTO baby_notifications (id, space_id, app_user_id, idempotency_key, collapse_id, kind, payload,
                due_at, status, attempts, unknown_retries, receipt_due_at, provider_ticket)
            SELECT gen_random_uuid(), :space, 'owner', 'history-' || n, md5(n::text), 'event', '{}', now() - interval '1 day',
                'accepted', 1, 0, CASE WHEN n <= 20 THEN now() - interval '1 minute' END, '{"tickets": []}'
            FROM generate_series(1, 20000) n"""), {"space": space})
        await db.commit()
    async with push.engine.connect() as connection:
        await connection.execution_options(isolation_level="AUTOCOMMIT")
        await connection.execute(text("ANALYZE baby_notifications"))
    for plan in await plans_of(push, push.worker.check_receipts, "receipt_due_at <="):
        assert "ix_baby_notifications_receipts_due" in plan, plan
    for plan in await plans_of(push, push.worker.next_delay, "min(baby_notifications.receipt_due_at)"):
        assert "ix_baby_notifications_receipts_due" in plan, plan


async def test_receipts_still_work_without_the_index(push):
    """Before 060 is applied this is only slower."""
    async with push.engine.connect() as connection:
        assert not await connection.scalar(text("SELECT to_regclass('ix_baby_notifications_receipts_due')"))
    row = await queue(push)
    await push.worker.tick()
    assert (await reread(push, row)).status == "accepted"
    assert await push.worker.next_delay() > 1


async def test_worker_writes_never_advance_change_seq(push):
    async with push.sessions() as db:
        space_id = (await db.get(BabyMembership, "owner")).personal_space_id
        before = (await db.get(BabySpace, space_id)).change_seq
    row = await queue(push)
    await push.worker.tick()
    assert (await reread(push, row)).status == "accepted"
    async with push.sessions() as db:
        assert (await db.get(BabySpace, space_id)).change_seq == before


async def test_leaving_or_being_removed_cancels_what_is_pending_in_that_space(push):
    from app.domains.baby.lifecycle import retire_reminders

    row = await queue(push)
    async with push.sessions() as db:
        await retire_reminders(db, "owner", row.space_id)
        await db.commit()
    await push.worker.tick()
    assert push.expo.sent == []
    assert await due_items(push) == []
    assert (await reread(push, row)).dismissed_at is not None


async def test_a_row_follows_its_record_to_a_new_space_whatever_its_state(push):
    row = await queue(push, key="moving", due=now() + timedelta(hours=1)) or await only(push)
    async with push.sessions() as db:
        family = BabySpace(id=uuid4(), kind="family", generation=1)
        db.add(family)
        await db.flush()
        family_id = family.id
        await db.commit()
    async def move(due):
        async with push.sessions() as db:
            await reminders.schedule(db, owner="owner", space_id=family_id, kind="event", key="moving", due_at=due)
            await db.commit()
    await move(row.due_at)
    current = await reread(push, row)
    assert current.space_id == family_id and current.status == "queued"
    async with push.sessions() as db:
        (await db.get(BabyNotification, row.id)).status = "accepted"
        await db.commit()
        (await db.get(BabyNotification, row.id)).space_id = row.space_id
        await db.commit()
    later = now() + timedelta(days=2)
    await move(later)
    current = await reread(push, row)
    assert current.space_id == family_id and current.status == "accepted" and current.due_at != later


async def owed_to_second_phone(push):
    await register(push, "phone-install-2", "ExponentPushToken[two]")
    row = await queue(push)

    def ticket(message):
        if message["to"] == "ExponentPushToken[two]":
            return {"status": "error", "details": {"error": "MessageRateExceeded"}}
        return {"status": "ok", "id": "ticket-one"}

    push.expo.answers = [ticket]
    await push.worker.tick()
    current = await reread(push, row)
    assert current.status == "queued" and json.loads(current.provider_ticket)["retry"]
    return row


async def test_dismissing_a_reminder_still_owed_to_one_phone_keeps_what_was_delivered(push):
    row = await owed_to_second_phone(push)
    response = await push.client.post(f"/api/v1/baby/reminders/{row.id}/dismiss", headers=WRITE)
    assert response.status_code == 204
    current = await reread(push, row)
    assert current.status == "accepted" and current.dismissed_at is not None and current.lease_until is None
    await push.worker.tick()
    assert len(push.expo.sent) == 1
    assert await due_items(push) == []


async def test_a_reason_going_while_one_phone_is_owed_keeps_what_was_delivered(push):
    row = await owed_to_second_phone(push)
    async with push.sessions() as db:
        await reminders.cancel(db, BabyNotification.id == row.id)
        await db.commit()
    untouched = await reread(push, row)
    assert untouched.status == "queued" and untouched.dismissed_at is None  # Its last check settles it.
    await prefs(push, {"kinds": {"event": {"enabled": False}}})
    await make_due(push, row)
    await push.worker.tick()
    assert len(push.expo.sent) == 1
    current = await reread(push, row)
    assert current.status == "accepted" and current.dismissed_at is not None
    assert current.payload[reminders.CLEARED] is True and "retry" not in json.loads(current.provider_ticket)


async def test_a_reminder_being_sent_is_left_for_its_last_check(push):
    row = await queue(push)
    token, ids = await push.worker.claim()
    async with push.sessions() as db:
        await reminders.cancel(db, BabyNotification.id == row.id)
        await db.commit()
    current = await reread(push, row)
    assert current.status == "sending" and current.dismissed_at is None
    await prefs(push, {"kinds": {"event": {"enabled": False}}})
    await push.worker.deliver(token, ids)
    assert push.expo.sent == []
    assert (await reread(push, row)).status == "failed"
