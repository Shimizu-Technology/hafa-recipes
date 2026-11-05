"""What puts a reminder on the queue: the worker, from committed records, with its HTTP stubbed."""

import os
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy import event, select, text, update

from app.domains.baby import push as push_routes
from app.domains.baby import push_worker, reminders, triggers
from app.domains.baby.lifecycle import now
from app.domains.baby.models import (
    BabyImport,
    BabyMembership,
    BabyNotification,
    BabyPushDevice,
    BabyRecord,
    BabySpace,
)
from app.domains.baby.push_worker import BabyPushWorker
from app.domains.baby.reminders import LOCK_SCREEN, reminder_access
from app.domains.baby.runtime import BabyWorker
from app.domains.baby.schemas import EventData
from tests import test_baby_integration as shared
from tests.test_baby_push_worker import CURRENT, DUE, PREFS, WRITE, Expo, register

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="Disposable TEST_DATABASE_URL required"
)
baby_api = shared.baby_api
RECORDS = "/api/v1/baby/records"
GUAM = ZoneInfo("Pacific/Guam")


@pytest.fixture
async def push(baby_api):
    baby_api.settings.baby_push_enabled = True
    baby_api.settings.baby_new_kinds_enabled = True
    baby_api.settings.expo_access_token = SecretStr("expo-test-token")
    expo = Expo()
    await register(baby_api)
    worker = BabyPushWorker(baby_api.sessions, transport=expo.transport())
    worker.watch()  # As it is once running, without the background task.
    yield SimpleNamespace(**vars(baby_api), expo=expo, worker=worker)
    worker.unwatch()


async def turn_on(api, *kinds, **person):
    patch = {"kinds": {kind: {"enabled": True} for kind in kinds}, **person}
    response = await api.client.patch(PREFS, headers=WRITE, json=patch)
    assert response.status_code == 200, response.text
    api.worker.swept_at = None  # Settings wake the running worker; here, the next pass sweeps instead.


async def add_event(api, start, *, minutes=(60,), title="Checkup with Dr. Cruz", **data):
    body = {
        "id": str(uuid4()), "kind": "event", "title": title, "occurred_at": start.isoformat(),
        "data": {"timezone": "Pacific/Guam", "reminder_minutes": list(minutes), **data},
    }
    response = await api.client.post(RECORDS, headers=WRITE, json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def rows_of(api, kind=None, *, planned=True):
    if planned:
        await api.worker.maintain()
    async with api.sessions() as db:
        query = select(BabyNotification).order_by(BabyNotification.due_at)
        if kind:
            query = query.where(BabyNotification.kind == kind)
        return list(await db.scalars(query))


async def live(api, kind=None):
    return [row for row in await rows_of(api, kind) if row.dismissed_at is None]


async def due_texts(api):
    response = await api.client.get(DUE, headers=CURRENT)
    assert response.status_code == 200, response.text
    return [item["text"] for item in response.json()["items"]]


async def test_an_event_reminder_fires_once_at_the_time_set_and_generically(push):
    await turn_on(push, "event")
    start = now() + timedelta(minutes=30)
    await add_event(push, start)  # An hour's notice, so it is due now.
    await push.worker.tick()
    assert len(push.expo.messages) == 1
    assert push.expo.messages[0]["body"] == LOCK_SCREEN["event"]
    assert "Cruz" not in str(push.expo.messages[0])
    await push.worker.tick()
    assert len(push.expo.messages) == 1
    assert any("Checkup with Dr. Cruz" in text for text in await due_texts(push))


async def test_nothing_is_queued_without_a_time_set_or_with_the_setting_off(push):
    await add_event(push, now() + timedelta(hours=1))  # Setting off.
    assert await rows_of(push) == []
    await turn_on(push, "event")
    await add_event(push, now() + timedelta(hours=1), minutes=())
    assert len(await rows_of(push)) == 1  # Only the one with a time set.


async def test_turning_on_plans_events_already_saved_and_off_clears_them(push):
    await add_event(push, now() + timedelta(hours=5))
    assert await rows_of(push) == []
    await turn_on(push, "event")
    assert len(await live(push)) == 1
    off = await push.client.patch(PREFS, headers=WRITE, json={"kinds": {"event": {"enabled": False}}})
    assert off.status_code == 200
    push.worker.people.add("owner")
    assert await live(push) == []
    await turn_on(push, "event")
    assert len(await live(push)) == 1  # The same reminder back, not a second one.
    assert len(await rows_of(push)) == 1


async def test_editing_the_time_moves_the_reminder_and_undoing_restores_it(push):
    await turn_on(push, "event")
    start = now() + timedelta(hours=5)
    event = await add_event(push, start)
    first = await live(push)
    assert first[0].due_at == start - timedelta(hours=1)
    later = start + timedelta(hours=2)
    moved = await push.client.patch(f"{RECORDS}/{event['id']}", headers=WRITE, json={
        "revision": event["revision"], "occurred_at": later.isoformat(),
    })
    assert moved.status_code == 200, moved.text
    rows = await live(push)
    assert [row.due_at for row in rows] == [later - timedelta(hours=1)]
    back = await push.client.patch(f"{RECORDS}/{event['id']}", headers=WRITE, json={
        "revision": moved.json()["revision"], "occurred_at": start.isoformat(),
    })
    assert back.status_code == 200
    assert [row.id for row in await live(push)] == [first[0].id]


async def test_removing_or_changing_the_times_set_follows_the_edit(push):
    await turn_on(push, "event")
    start = now() + timedelta(hours=5)
    event = await add_event(push, start, minutes=(30, 60))
    assert len(await live(push)) == 2
    edited = await push.client.patch(f"{RECORDS}/{event['id']}", headers=WRITE, json={
        "revision": event["revision"], "data": {"timezone": "Pacific/Guam", "reminder_minutes": [30]},
    })
    assert edited.status_code == 200, edited.text
    assert [row.due_at for row in await live(push)] == [start - timedelta(minutes=30)]
    cleared = await push.client.patch(f"{RECORDS}/{event['id']}", headers=WRITE, json={
        "revision": edited.json()["revision"], "data": {"timezone": "Pacific/Guam"},
    })
    assert cleared.status_code == 200
    assert await live(push) == []


async def test_deleting_an_event_cancels_its_reminder(push):
    await turn_on(push, "event")
    event = await add_event(push, now() + timedelta(minutes=30))
    response = await push.client.delete(f"{RECORDS}/{event['id']}?revision={event['revision']}", headers=WRITE)
    assert response.status_code == 204
    await push.worker.tick()
    assert push.expo.sent == [] and await due_texts(push) == []


async def test_a_deleted_event_stays_quiet_even_if_the_cancel_was_missed(push):
    await turn_on(push, "event")
    event = await add_event(push, now() + timedelta(minutes=30))
    assert len(await live(push)) == 1
    async with push.sessions() as db:
        await db.execute(update(BabyRecord).where(BabyRecord.id == event["id"]).values(deleted_at=now()))
        await db.commit()
    assert await due_texts(push) == []
    await push.worker.tick()
    assert push.expo.sent == []
    assert (await rows_of(push))[0].status == "failed"


@pytest.mark.parametrize("change", [
    {"reminder_minutes": []},  # The time set was taken away.
    {"exceptions": "cancel"},  # This occurrence no longer happens.
])
async def test_a_reminder_whose_occurrence_or_time_went_stays_quiet_if_the_cancel_was_missed(push, change):
    await turn_on(push, "event")
    start = now() + timedelta(minutes=30)
    event = await add_event(push, start, recurrence={"frequency": "daily"})
    assert await live(push)
    data = {**event["data"], **change}
    if change.get("exceptions"):
        data["exceptions"] = [{"original_start": start.isoformat(), "cancelled": True}]
    async with push.sessions() as db:
        await db.execute(update(BabyRecord).where(BabyRecord.id == event["id"]).values(data=data))
        await db.commit()
    assert await due_texts(push) == []
    await push.worker.tick()
    assert push.expo.sent == []


async def test_repeats_are_planned_ahead_by_the_sweep(push):
    await turn_on(push, "event")
    start = now() - timedelta(days=5) + timedelta(hours=3)
    await add_event(push, start, recurrence={"frequency": "daily"})
    rows = await live(push)
    # Today's and the next two days': never the five that have passed.
    assert len(rows) in {2, 3} and all(row.due_at > now() - timedelta(hours=1) for row in rows)
    keys = {row.idempotency_key for row in rows}
    await sweep(push)
    await sweep(push)
    assert {row.idempotency_key for row in await live(push)} == keys
    assert len(keys) == len({row.collapse_id for row in rows})


async def test_sweep_touches_nothing_when_nothing_changed(push):
    await turn_on(push, "event")
    await add_event(push, now() + timedelta(hours=5))
    before = [(row.id, row.updated_at, row.due_at) for row in await rows_of(push)]
    await sweep(push)
    assert [(row.id, row.updated_at, row.due_at) for row in await rows_of(push)] == before


async def test_cancelling_or_moving_one_occurrence_changes_only_that_one(push):
    await turn_on(push, "event")
    start = now() + timedelta(hours=3)
    event = await add_event(push, start, recurrence={"frequency": "daily"})
    rows = await live(push)
    assert rows[0].due_at == start - timedelta(hours=1)
    count = len(rows)
    url = f"/api/v1/baby/events/{event['id']}/occurrences"
    cancelled = await push.client.put(url, headers=WRITE, json={
        "revision": event["revision"], "original_start": start.isoformat(), "cancelled": True,
    })
    assert cancelled.status_code == 200, cancelled.text
    rows = await live(push)
    assert len(rows) == count - 1 and rows[0].due_at > start
    later = start + timedelta(hours=2)
    changed = await push.client.put(url, headers=WRITE, json={
        "revision": cancelled.json()["revision"], "original_start": start.isoformat(),
        "overrides": {"start": later.isoformat()},
    })
    assert changed.status_code == 200, changed.text
    rows = await live(push)
    assert len(rows) == count and rows[0].due_at == later - timedelta(hours=1)
    restored = await push.client.delete(url, headers=WRITE, params={
        "original_start": start.isoformat(), "revision": changed.json()["revision"],
    })
    assert restored.status_code == 200, restored.text
    assert (await live(push))[0].due_at == start - timedelta(hours=1)


async def test_ending_a_series_cancels_what_falls_after_it(push):
    await turn_on(push, "event")
    start = now() + timedelta(hours=3)
    event = await add_event(push, start, recurrence={"frequency": "daily"})
    day = start.astimezone(GUAM).date()
    assert len(await live(push)) >= 2
    ended = await push.client.post(f"/api/v1/baby/events/{event['id']}/end-series", headers=WRITE, json={
        "revision": event["revision"], "from_date": (day + timedelta(days=1)).isoformat(),
    })
    assert ended.status_code == 200, ended.text
    assert len(await live(push)) == 1


async def test_all_day_events_remind_at_9_on_their_own_calendar(push):
    await turn_on(push, "event")
    day = (now().astimezone(GUAM) + timedelta(days=1)).date()
    start = datetime.combine(day, datetime.min.time(), GUAM)
    await add_event(push, start, minutes=(0,), all_day=True, title="Baptism")
    rows = await live(push)
    assert rows[0].due_at == datetime.combine(day, datetime.min.time().replace(hour=9), GUAM).astimezone(UTC)


async def test_wording_uses_the_persons_time_zone(push, monkeypatch):
    await turn_on(push, "event")
    moment = datetime(2030, 3, 4, 10, 0, tzinfo=GUAM)
    monkeypatch.setattr(triggers, "now", lambda: moment)
    start = datetime(2030, 3, 4, 15, 0, tzinfo=GUAM)
    row = SimpleNamespace(payload={
        "event_id": (await add_event(push, start))["id"], "start": start.isoformat(),
        "original": start.isoformat(), "minutes": 60,
    })
    async with push.sessions() as db:
        words = await triggers.event_words(db, row, await reminder_access(db, "owner"), None)
    assert words.detail == "Checkup with Dr. Cruz at 3:00 PM."
    assert set(words.data) == {"event_id", "original_start"}
    tomorrow = moment - timedelta(days=1)
    assert triggers.when_words(start, False, GUAM, tomorrow.date()) == "tomorrow at 3:00 PM"
    assert triggers.when_words(start, True, GUAM, moment.date()) == "today"
    assert triggers.when_words(start, False, GUAM, moment.date() - timedelta(days=4)) == "on Mar 4 at 3:00 PM"


@pytest.mark.parametrize("value", [[-1], [40321], ["60"], [1, 2, 3, 4, 5, 6]])
def test_times_set_on_an_event_are_bounded(value):
    with pytest.raises(ValidationError):
        EventData(timezone="Pacific/Guam", reminder_minutes=value)


def test_an_event_without_times_keeps_its_stored_form():
    assert "reminder_minutes" not in EventData(timezone="Pacific/Guam").model_dump(mode="json")
    assert EventData(timezone="Pacific/Guam", reminder_minutes=[60, 0, 60]).reminder_minutes == [0, 60]


# Visit prep. The clock is frozen at 10 AM so the evening-before time is always ahead.


def freeze_morning(monkeypatch):
    moment = now().astimezone(GUAM).replace(hour=10, minute=0, second=0, microsecond=0)
    monkeypatch.setattr(triggers, "now", lambda: moment)
    return moment


async def add_question(api, event_id, title="Is the new rash normal?"):
    body = {
        "id": str(uuid4()), "kind": "question", "title": title, "occurred_at": now().isoformat(),
        "data": {"event_id": event_id} if event_id else {},
    }
    response = await api.client.post(RECORDS, headers=WRITE, json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def test_visit_prep_counts_questions_and_keeps_them_off_the_lock_screen(push, monkeypatch):
    moment = freeze_morning(monkeypatch)
    await turn_on(push, "visit_prep")
    event = await add_event(push, moment + timedelta(days=1), minutes=())
    assert await live(push) == []
    await add_question(push, event["id"])
    await add_question(push, event["id"])
    await add_question(push, None)  # Not for this visit.
    rows = await live(push, "visit_prep")
    assert len(rows) == 1
    assert rows[0].due_at == moment.replace(hour=18).astimezone(UTC)
    evening = moment.replace(hour=18, minute=5)
    for module in (triggers, push_worker, reminders, push_routes):
        monkeypatch.setattr(module, "now", lambda: evening)
    await push.worker.tick()
    assert push.expo.messages[0]["body"] == "You have a reminder in Håfa Baby."
    assert "rash" not in str(push.expo.messages[0]) and "Cruz" not in str(push.expo.messages[0])
    assert await due_texts(push) == ["You have 2 questions for tomorrow."]


async def test_visit_prep_with_no_questions_left_is_cleared(push, monkeypatch):
    moment = freeze_morning(monkeypatch)
    await turn_on(push, "visit_prep")
    event = await add_event(push, moment + timedelta(days=1), minutes=())
    question = await add_question(push, event["id"])
    assert len(await live(push)) == 1
    removed = await push.client.delete(
        f"{RECORDS}/{question['id']}?revision={question['revision']}", headers=WRITE
    )
    assert removed.status_code == 204
    async with push.sessions() as db:
        await db.execute(update(BabyNotification).values(due_at=now() - timedelta(seconds=1)))
        await db.commit()
    assert await due_texts(push) == []
    await push.worker.tick()
    assert push.expo.sent == []


async def test_visit_prep_says_today_if_quiet_hours_held_it_overnight(push, monkeypatch):
    moment = freeze_morning(monkeypatch)
    await turn_on(push, "visit_prep")
    event = await add_event(push, moment + timedelta(days=1), minutes=())
    await add_question(push, event["id"])
    row = (await live(push, "visit_prep"))[0]
    monkeypatch.setattr(triggers, "now", lambda: moment + timedelta(days=1))
    async with push.sessions() as db:
        words = await triggers.visit_prep_words(db, row, await reminder_access(db, "owner"), None)
    assert words.detail == "You have a question for today."


async def test_a_question_added_too_late_for_the_evening_before_is_not_sent_late(push, monkeypatch):
    moment = freeze_morning(monkeypatch).replace(hour=21)
    monkeypatch.setattr(triggers, "now", lambda: moment)
    await turn_on(push, "visit_prep")
    event = await add_event(push, moment + timedelta(hours=13), minutes=())
    await add_question(push, event["id"])
    assert await live(push, "visit_prep") == []


# Imports.


async def start_import(api, key=None):
    body = {"id": key or str(uuid4()), "text": "A saved tip about sleep"}
    response = await api.client.post("/api/v1/baby/imports", headers=WRITE, json=body)
    assert response.status_code == 200, response.text
    return response.json()


def finishing(status="ready"):
    async def processor(request, assets, provider, **kwargs):
        if status == "boom":
            raise ValueError("private detail")
        return {"title": "Organized", "data": {"status": status}, "status": status}

    return processor


@pytest.mark.parametrize(("status", "expected"), [
    ("ready", "is ready."),
    ("incomplete", "couldn't finish. Your original is kept."),
    ("boom", "couldn't finish. Your original is kept."),
])
async def test_import_finished_or_failed_tells_the_person_who_asked(push, status, expected):
    await turn_on(push, "import")
    await start_import(push)
    await BabyWorker(push.sessions, processor=finishing(status)).tick()
    await push.worker.tick()
    assert [message["body"] for message in push.expo.messages] == [LOCK_SCREEN["import"]]
    assert "sleep" not in str(push.expo.messages[0]) and "Organized" not in str(push.expo.messages[0])
    assert (await due_texts(push))[0].endswith(expected)


async def test_import_is_silent_with_the_setting_off(push):
    await start_import(push)
    await BabyWorker(push.sessions, processor=finishing()).tick()
    assert await rows_of(push) == []


async def test_withdrawing_consent_stops_an_import_notice_that_was_waiting(push):
    await turn_on(push, "import")
    await start_import(push)
    await BabyWorker(push.sessions, processor=finishing()).tick()
    assert len(await live(push)) == 1
    on = await push.client.patch("/api/v1/baby/profile", headers=WRITE, json={"ai_consent": True})
    assert on.status_code == 200, on.text
    assert await due_texts(push) == []
    await push.worker.tick()
    assert push.expo.sent == []


async def test_retrying_an_import_clears_the_old_notice_and_can_send_a_new_one(push):
    await turn_on(push, "import")
    created = await start_import(push)
    await BabyWorker(push.sessions, processor=finishing("boom")).tick()
    await push.worker.tick()
    assert len(push.expo.messages) == 1
    async with push.sessions() as db:
        await db.execute(update(BabyImport).where(BabyImport.id == created["id"]).values(status="queued"))
        await db.commit()
    assert await due_texts(push) == []  # What it reported no longer stands.
    await BabyWorker(push.sessions, processor=finishing()).tick()
    push.worker.swept_at = None
    await push.worker.tick()
    assert len(push.expo.messages) == 2
    assert (await due_texts(push))[0].endswith("is ready.")


# The contract this rework exists for. A reminder problem can never undo a log; nothing runs with the flag off.


async def sweep(api):
    api.worker.swept_at = None
    await api.worker.maintain()


async def no_plan():
    return False


FEED = {
    "kind": "feeding", "title": "Feed", "data": {"method": "bottle"},
}


async def log_feed(api, at=None, headers=WRITE, **fields):
    body = {"id": str(uuid4()), **FEED, "occurred_at": (at or now()).isoformat(), **fields}
    response = await api.client.post(RECORDS, headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def test_a_reminder_failure_can_never_undo_a_log(push, monkeypatch):
    """Finding 1: whatever goes wrong while planning or waking, the feed is saved and stays saved."""
    async def boom(*_):
        raise RuntimeError("planning is broken")

    def broken(*_):
        raise RuntimeError("wake is broken")

    await turn_on(push, "event")
    monkeypatch.setattr(push_worker, "plan_person", boom)
    monkeypatch.setattr(push.worker, "notify", broken)
    saved = await log_feed(push)
    event_row = await add_event(push, now() + timedelta(hours=1))
    await push.worker.tick()  # Planning fails here, in the worker, and only here.
    async with push.sessions() as db:
        for record in (saved, event_row):
            assert (await db.get(BabyRecord, record["id"])).deleted_at is None
    assert (await push.client.get(f"{RECORDS}/{saved['id']}", headers=CURRENT)).status_code == 200


async def test_a_write_never_touches_the_reminder_tables_even_with_the_flag_on(push):
    """Finding 1: planning is the worker's alone, so no log's transaction has a reminder write to fail."""
    await turn_on(push, "event")
    statements = []

    def seen(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(push.engine.sync_engine, "before_cursor_execute", seen)
    try:
        await log_feed(push)
        created = await add_event(push, now() + timedelta(hours=2))
        moved = await push.client.patch(f"{RECORDS}/{created['id']}", headers=WRITE, json={
            "revision": created["revision"], "occurred_at": (now() + timedelta(hours=3)).isoformat(),
        })
        assert moved.status_code == 200
    finally:
        event.remove(push.engine.sync_engine, "before_cursor_execute", seen)
    assert not [text for text in statements if "baby_notification" in text or "baby_push" in text]


async def test_a_commit_wakes_the_worker_with_the_space_that_changed(push):
    """Finding 1: the after-commit wake. A rollback wakes nothing."""
    assert push.worker.event.is_set() is False
    await log_feed(push)
    assert push.worker.event.is_set() is True and len(push.worker.spaces) == 1
    push.worker.event.clear()
    push.worker.spaces.clear()
    async with push.sessions() as db:
        space = await db.scalar(select(BabyMembership.personal_space_id).filter_by(app_user_id="owner"))
        generation = await db.scalar(select(BabyMembership.generation).filter_by(app_user_id="owner"))
        db.add(BabyRecord(id=uuid4(), app_user_id="owner", space_id=space, generation=generation, revision=1,
                          kind="feeding", title="", body="", data={}, occurred_at=now(), creation_hash="x"))
        await db.flush()
        await db.rollback()
    assert push.worker.event.is_set() is False and not push.worker.spaces


async def test_a_journal_entry_wakes_nothing(push):
    assert (await push.client.post(RECORDS, headers=WRITE, json=shared.payload())).status_code == 200
    assert not push.worker.spaces


async def test_a_lost_wake_is_caught_by_the_sweep_and_a_restart_loses_nothing(push):
    """The worker wasn't running when these were saved: the next one finds them all from the records."""
    push.worker.unwatch()
    await turn_on(push, "event", "visit_prep", "import")
    await add_event(push, now() + timedelta(minutes=30))
    await start_import(push)
    await BabyWorker(push.sessions, processor=finishing()).tick()
    async with push.sessions() as db:
        assert list(await db.scalars(select(BabyNotification))) == []
    restarted = BabyPushWorker(push.sessions, transport=push.expo.transport())
    await restarted.tick()
    await restarted.tick()
    assert sorted(message["body"] for message in push.expo.messages) == sorted(
        [LOCK_SCREEN["event"], LOCK_SCREEN["import"]]
    )
    third = BabyPushWorker(push.sessions, transport=push.expo.transport())
    await third.tick()
    assert len(push.expo.messages) == 2


async def test_with_the_flag_off_writes_run_no_push_query_and_no_listener_exists(baby_api):
    """Finding: existing clients see nothing new. No worker, no listener, no query, and writes as before."""
    baby_api.settings.baby_new_kinds_enabled = True
    baby_api.settings.baby_push_enabled = False
    worker = BabyPushWorker(baby_api.sessions)
    await worker.start()
    assert worker.task is None and worker.watching is False
    from sqlalchemy.orm import Session

    assert not event.contains(Session, "after_commit", worker.wake_after_commit)
    statements = []

    def seen(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(baby_api.engine.sync_engine, "before_cursor_execute", seen)
    try:
        response = await baby_api.client.post(RECORDS, headers=WRITE, json={
            "id": str(uuid4()), **FEED, "occurred_at": now().isoformat(),
        })
        assert response.status_code == 200, response.text
    finally:
        event.remove(baby_api.engine.sync_engine, "before_cursor_execute", seen)
    assert not [text for text in statements if "baby_notification" in text or "baby_push" in text]
    async with baby_api.sessions() as db:
        assert list(await db.scalars(select(BabyNotification))) == []
        assert list(await db.scalars(select(BabyPushDevice))) == []
    assert (await baby_api.client.get(DUE, headers=CURRENT)).status_code == 404


async def test_an_event_without_times_is_stored_and_answered_as_before(baby_api):
    baby_api.settings.baby_new_kinds_enabled = True
    body = {"id": str(uuid4()), "kind": "event", "title": "Visit", "occurred_at": now().isoformat(),
            "data": {"timezone": "Pacific/Guam"}}
    response = await baby_api.client.post(RECORDS, headers=WRITE, json=body)
    assert response.status_code == 200 and "reminder_minutes" not in response.json()["data"]


@pytest.mark.parametrize("baby_api", [60], indirect=True)
async def test_a_sweep_page_reads_the_enabled_settings_index_not_every_row(push):
    """Finding 6: 70,000 settings rows were scanned on every page."""
    async with push.sessions() as db:
        space = await db.scalar(select(BabyMembership.personal_space_id).filter_by(app_user_id="owner"))
        await db.execute(text("""INSERT INTO app_users (id) SELECT 'person-' || lpad(n::text, 6, '0') FROM generate_series(1, 6000) n"""))
        await db.execute(text("""
            INSERT INTO baby_notification_prefs (space_id, app_user_id, kind, enabled, settings)
            SELECT :space, 'person-' || lpad(n::text, 6, '0'), kind, n % 50 = 0 AND kind = 'event', '{}'
            FROM generate_series(1, 6000) n, unnest(ARRAY['event', 'import', 'visit_prep']) kind"""), {"space": space})
        await db.commit()
    async with push.engine.connect() as connection:
        await connection.execution_options(isolation_level="AUTOCOMMIT")
        await connection.execute(text("ANALYZE baby_notification_prefs"))
    seen = []

    def note(conn, cursor, statement, parameters, context, executemany):
        if "baby_notification_prefs.enabled" in statement and "EXPLAIN" not in statement:
            seen.append((statement, parameters))

    event.listen(push.engine.sync_engine, "before_cursor_execute", note)
    try:
        await push.worker.sweep(now())
        await push.worker.sweep(now())
    finally:
        event.remove(push.engine.sync_engine, "before_cursor_execute", note)
    assert len(seen) == 2
    async with push.engine.connect() as connection:
        for statement, parameters in seen:
            plan = "\n".join(row[0] for row in await connection.exec_driver_sql("EXPLAIN " + statement, parameters))
            assert "ix_baby_notification_prefs_enabled" in plan, plan


async def test_a_profile_change_wakes_planning_for_that_person(push):
    """Finding 7: a new time zone changes when things are due, and no record changed."""
    push.worker.people.clear()
    response = await push.client.patch("/api/v1/baby/profile", headers=WRITE, json={"timezone": "UTC"})
    assert response.status_code == 200, response.text
    assert push.worker.people == {"owner"}
    assert push.worker.event.is_set() is True


async def test_planning_and_sending_never_advance_change_seq(push):
    await turn_on(push, "event")
    await add_event(push, now() + timedelta(minutes=30))
    async with push.sessions() as db:
        space_id = (await db.get(BabyMembership, "owner")).personal_space_id
        before = (await db.get(BabySpace, space_id)).change_seq
    await push.worker.tick()
    await sweep(push)
    assert len(push.expo.messages) == 1
    async with push.sessions() as db:
        assert (await db.get(BabySpace, space_id)).change_seq == before


async def test_a_planning_problem_for_one_person_doesnt_stop_anyone_else_or_any_send(push, monkeypatch):
    await turn_on(push, "event")
    await add_event(push, now() + timedelta(minutes=30))
    await push.worker.maintain()
    assert len(await rows_of(push, planned=False)) == 1

    async def boom(*_):
        raise RuntimeError("private detail")

    monkeypatch.setattr(push.worker, "maintain", boom)
    await push.worker.tick()  # What is already planned still goes.
    assert len(push.expo.messages) == 1


async def test_a_large_sweep_goes_in_pages_so_sends_keep_their_turn(push, monkeypatch):
    monkeypatch.setattr(push_worker, "PLAN_PAGE", 1)
    await turn_on(push, "event")
    from app.models.identity import AppUser

    async with push.sessions() as db:
        db.add(AppUser(id="zed"))
        await db.commit()
    other = {**WRITE, "X-Test-Owner": "other"}
    zed = {**WRITE, "X-Test-Owner": "zed"}
    for headers in (other, zed):
        assert (await push.client.post("/api/v1/baby/bootstrap", headers=headers)).status_code == 200
        assert (await push.client.patch(PREFS, headers=headers, json={"kinds": {"event": {"enabled": True}}})).status_code == 200
    planned = []

    async def note(db, person):
        planned.append(person)

    monkeypatch.setattr(push_worker, "plan_person", note)
    for _ in range(3):
        assert await push.worker.sweep(now()) is True
    assert await push.worker.sweep(now()) is False
    assert planned == ["other", "owner", "zed"]
    assert await push.worker.sweep(now()) is False  # Done until the next one is due.
    assert planned == ["other", "owner", "zed"]
