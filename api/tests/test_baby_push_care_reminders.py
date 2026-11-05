"""Feed, running-timer and pregnancy-week reminders, with delivery stubbed as in the worker's tests."""

import json
import os
import re
from datetime import UTC, datetime, time, timedelta
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select, update

from app.domains.baby import push_worker, reminders, triggers
from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyNotification
from app.domains.baby.push import load_prefs
from app.domains.baby.push_worker import BabyPushWorker
from app.domains.baby.reminders import LOCK_SCREEN, reminder_access, schedule
from tests import test_baby_integration as shared
from tests.test_baby_push_worker import CURRENT, DUE, PREFS, WRITE, Expo, register

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="Disposable TEST_DATABASE_URL required"
)
baby_api = shared.baby_api
RECORDS = "/api/v1/baby/records"
CHILDREN = "/api/v1/baby/children"
GUAM = ZoneInfo("Pacific/Guam")
# Advice, of the kind a reminder must never give.
ADVICE = re.compile(r"\b(should|needs?|must|ought|recommend\w*|try to|time to)\b", re.IGNORECASE)


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


async def set_prefs(api, **kinds):
    response = await api.client.patch(PREFS, headers=WRITE, json={"kinds": kinds})
    assert response.status_code == 200, response.text
    api.worker.people.add("owner")  # What the running worker hears from this route.


async def feed_reminder(api, hours=3):
    await set_prefs(api, feed_interval={"enabled": True, "hours": hours})


async def log(api, kind="feeding", *, at=None, child_id=None, data=None, title="Log"):
    body = {
        "id": str(uuid4()), "kind": kind, "title": title, "occurred_at": (at or now()).isoformat(),
        "child_id": child_id,
        "data": data if data is not None else ({"method": "bottle", "amount": 60, "unit": "ml"} if kind == "feeding" else {}),
    }
    response = await api.client.post(RECORDS, headers=WRITE, json=body)
    assert response.status_code == 200, response.text
    return response.json()


def running_feed(at):
    return {
        "method": "breast", "state": "running",
        "actions": [{"id": str(uuid4()), "action": "start", "at": at.isoformat(), "side": "left"}],
    }


async def add_child(api, **fields):
    body = {"id": str(uuid4()), "name": "Mia", **fields}
    response = await api.client.post(CHILDREN, headers=WRITE, json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def rows_of(api, kind=None):
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


async def test_off_by_default_even_with_feeds_logged(push):
    await log(push)
    assert await rows_of(push) == []


async def test_due_n_hours_after_the_last_feed_with_n_set_per_person(push):
    await feed_reminder(push, 2.5)
    fed = now() - timedelta(minutes=10)
    await log(push, at=fed)
    rows = await live(push, "feed_interval")
    assert [row.due_at for row in rows] == [fed + timedelta(hours=2.5)]
    await feed_reminder(push, 4)
    assert [row.due_at for row in await live(push, "feed_interval")] == [fed + timedelta(hours=4)]


async def test_logging_a_feed_cancels_and_reschedules(push):
    await feed_reminder(push)
    first = now() - timedelta(hours=2)
    await log(push, at=first)
    assert [row.due_at for row in await live(push)] == [first + timedelta(hours=3)]
    second = now() - timedelta(minutes=1)
    await log(push, at=second)
    assert [row.due_at for row in await live(push)] == [second + timedelta(hours=3)]
    assert len(await rows_of(push)) == 2


async def test_a_feed_that_went_out_leaves_today_once_the_next_is_logged(push):
    await feed_reminder(push)
    await log(push, at=now() - timedelta(hours=3, minutes=5))
    await push.worker.tick()
    assert push.expo.messages[0]["body"] == LOCK_SCREEN["feed_interval"]
    assert await due_texts(push) == ["It's been 3 hours since the last feed."]
    await log(push)
    assert await due_texts(push) == []
    await push.worker.tick()
    assert len(push.expo.messages) == 1


async def test_logging_an_older_feed_changes_nothing(push):
    await feed_reminder(push)
    newest = now() - timedelta(minutes=5)
    await log(push, at=newest)
    await log(push, at=newest - timedelta(hours=2))
    assert [row.due_at for row in await live(push)] == [newest + timedelta(hours=3)]
    assert len(await rows_of(push)) == 1


async def test_deleting_the_newest_feed_goes_back_to_the_one_before(push):
    await feed_reminder(push)
    earlier = now() - timedelta(hours=1)
    await log(push, at=earlier)
    newest = await log(push)
    response = await push.client.delete(f"{RECORDS}/{newest['id']}?revision={newest['revision']}", headers=WRITE)
    assert response.status_code == 204
    assert [row.due_at for row in await live(push)] == [earlier + timedelta(hours=3)]


async def test_editing_a_feeds_time_moves_the_reminder(push):
    await feed_reminder(push)
    feed = await log(push, at=now() - timedelta(hours=1))
    moved = now() - timedelta(minutes=20)
    response = await push.client.patch(f"{RECORDS}/{feed['id']}", headers=WRITE, json={
        "revision": feed["revision"], "occurred_at": moved.isoformat(),
    })
    assert response.status_code == 200, response.text
    assert [row.due_at for row in await live(push)] == [moved + timedelta(hours=3)]


async def test_each_child_has_its_own_clock_and_moving_a_feed_updates_both(push):
    await feed_reminder(push)
    one, two = await add_child(push), await add_child(push, name="Noa")
    first = await log(push, child_id=one["id"], at=now() - timedelta(minutes=30))
    await log(push, child_id=two["id"], at=now() - timedelta(minutes=5))
    assert len(await live(push)) == 2
    response = await push.client.patch(f"{RECORDS}/{first['id']}", headers=WRITE, json={
        "revision": first["revision"], "child_id": two["id"],
    })
    assert response.status_code == 200, response.text
    # One's only feed moved away, and the moved one is older than two's newest.
    assert [row.payload["child_id"] for row in await live(push)] == [two["id"]]


async def test_a_running_feed_has_no_reminder_until_it_finishes(push):
    await feed_reminder(push)
    started = now() - timedelta(minutes=20)
    await log(push, at=now() - timedelta(hours=2))
    assert len(await live(push)) == 1
    feed = await log(push, at=started, data=running_feed(started))
    assert await live(push) == []
    finished = await push.client.post(f"{RECORDS}/{feed['id']}/feed-action", headers=WRITE, json={
        "action_id": str(uuid4()), "action": "finish", "at": now().isoformat(),
    })
    assert finished.status_code == 200, finished.text
    assert [row.due_at for row in await live(push)] == [started + timedelta(hours=3)]


async def test_a_feed_dated_ahead_does_not_move_the_clock(push):
    await feed_reminder(push)
    fed = now() - timedelta(minutes=30)
    await log(push, at=fed)
    await log(push, at=now() + timedelta(hours=2))
    assert [row.due_at for row in await live(push)] == [fed + timedelta(hours=3)]


async def test_turning_it_on_ignores_a_long_gone_feed_and_off_clears_it(push):
    await log(push, at=now() - timedelta(days=3))
    await feed_reminder(push)
    assert await rows_of(push) == []
    await log(push, at=now() - timedelta(hours=1))
    assert len(await live(push)) == 1
    await set_prefs(push, feed_interval={"enabled": False})
    assert await live(push) == [] and await due_texts(push) == []


async def test_it_stays_quiet_if_a_newer_feed_exists_even_before_the_worker_has_replanned(push):
    """Log on one phone at the moment the old reminder comes due: the send-time check stops it."""
    await feed_reminder(push)
    await log(push, at=now() - timedelta(hours=4))
    assert len(await live(push)) == 1
    push.worker.unwatch()  # This write's wake is lost, and the sweep isn't due.
    await log(push, at=now() - timedelta(minutes=1))
    push.worker.swept_at = now()
    await push.worker.tick()
    assert push.expo.sent == []


async def test_the_lock_screen_never_has_a_name_and_today_does(push):
    await feed_reminder(push)
    child = await add_child(push)
    await log(push, child_id=child["id"], at=now() - timedelta(hours=3, minutes=40))
    await push.worker.tick()
    assert push.expo.messages[0]["body"] == LOCK_SCREEN["feed_interval"]
    assert "Mia" not in str(push.expo.messages[0])
    assert await due_texts(push) == ["It's been 3.5 hours since Mia's last feed."]


def test_durations_round_down_and_never_overstate():
    assert triggers.duration_words(timedelta(minutes=31)) == "30 minutes"
    assert triggers.duration_words(timedelta(minutes=59)) == "30 minutes"
    assert triggers.duration_words(timedelta(minutes=60)) == "1 hour"
    assert triggers.duration_words(timedelta(minutes=89)) == "1 hour"
    assert triggers.duration_words(timedelta(minutes=90)) == "1.5 hours"
    assert triggers.duration_words(timedelta(hours=3, minutes=1)) == "3 hours"


# Timers left running.


async def test_a_running_feed_reminds_after_the_default_and_finishing_clears_it(push):
    await set_prefs(push, running_timer={"enabled": True})
    started = now() - timedelta(minutes=65)
    feed = await log(push, at=started, data=running_feed(started))
    await push.worker.tick()
    assert push.expo.messages[0]["body"] == LOCK_SCREEN["running_timer"]
    assert await due_texts(push) == ["The feed timer has been running for 1 hour."]
    finished = await push.client.post(f"{RECORDS}/{feed['id']}/feed-action", headers=WRITE, json={
        "action_id": str(uuid4()), "action": "finish", "at": now().isoformat(),
    })
    assert finished.status_code == 200
    assert await due_texts(push) == []


async def test_an_open_sleep_reminds_at_the_persons_hours_and_an_end_cancels_it(push):
    await set_prefs(push, running_timer={"enabled": True, "sleep_hours": 2})
    started = now() - timedelta(minutes=30)
    sleep = await log(push, "sleep", at=started, data={})
    assert [row.due_at for row in await live(push, "running_timer")] == [started + timedelta(hours=2)]
    await log(push, "sleep", at=started - timedelta(hours=3), data={"end_at": started.isoformat()})
    assert len(await live(push, "running_timer")) == 1
    ended = await push.client.patch(f"{RECORDS}/{sleep['id']}", headers=WRITE, json={
        "revision": sleep["revision"], "data": {"end_at": now().isoformat()},
    })
    assert ended.status_code == 200, ended.text
    assert await live(push, "running_timer") == []


async def test_a_timer_forgotten_long_ago_stays_quiet(push):
    await log(push, "sleep", at=now() - timedelta(hours=40), data={})
    await set_prefs(push, running_timer={"enabled": True})
    assert await rows_of(push) == []


# Pregnancy weeks. The clock is frozen at 10 AM on Guam, the day before a week begins.


async def no_plan():
    return False


def freeze(monkeypatch):
    moment = now().astimezone(GUAM).replace(hour=10, minute=0, second=0, microsecond=0)
    monkeypatch.setattr(triggers, "now", lambda: moment)
    return moment


def due_date_for(moment, *, week, days_until_it_starts=1):
    return moment.date() + timedelta(days=days_until_it_starts) + timedelta(days=280 - week * 7)


async def save_tip(api, low, high):
    return await log(api, "source", title="Tea tip", data={
        "source_text": "A tip", "relevance": {"stage": "pregnancy", "pregnancy_week_min": low, "pregnancy_week_max": high},
    })


async def test_a_new_week_is_queued_for_9am_on_the_day_it_starts(push, monkeypatch):
    moment = freeze(monkeypatch)
    await add_child(push, due_date=due_date_for(moment, week=37).isoformat())
    await set_prefs(push, pregnancy_week={"enabled": True})
    rows = await live(push, "pregnancy_week")
    first_day = moment.date() + timedelta(days=1)
    assert [row.due_at for row in rows] == [datetime.combine(first_day, time(9), GUAM).astimezone(UTC)]
    assert rows[0].payload["week"] == 37
    push.worker.swept_at = None
    assert len(await rows_of(push, "pregnancy_week")) == 1


async def test_week_wording_counts_saved_tips_and_the_week_never_reaches_the_provider(push, monkeypatch):
    """Finding 7: the week number stays on the person's own Today."""
    moment = freeze(monkeypatch)
    await add_child(push, due_date=due_date_for(moment, week=37, days_until_it_starts=0).isoformat())
    await set_prefs(push, pregnancy_week={"enabled": True})
    row = SimpleNamespace(payload=(await rows_of(push, "pregnancy_week"))[0].payload)

    async def words():
        async with push.sessions() as db:
            return await triggers.pregnancy_week_words(db, row, await reminder_access(db, "owner"), None)

    assert (await words()).detail == "Week 37 is here."
    await save_tip(push, 36, 38)
    assert (await words()).detail == "Week 37 is here, and you saved a tip for it."
    await save_tip(push, 37, 37)
    await save_tip(push, 20, 21)  # Another week's.
    assert (await words()).detail == "Week 37 is here, and you saved 2 tips for it."
    async with push.sessions() as db:
        await db.execute(update(BabyNotification).values(due_at=now() - timedelta(minutes=1)))
        await db.commit()
    monkeypatch.setattr(push.worker, "maintain", no_plan)
    await push.worker.tick()
    assert push.expo.messages, "the week reminder should have gone"
    message = push.expo.messages[0]
    assert message["body"] == "You have a reminder in Håfa Baby."
    assert set(message["data"]) == {"notification_id", "space_id", "identity"}
    assert "week" not in json.dumps(message).lower() and "tip" not in json.dumps(message)


async def test_birth_or_a_new_due_date_clears_the_week(push, monkeypatch):
    moment = freeze(monkeypatch)
    child = await add_child(push, due_date=due_date_for(moment, week=37).isoformat())
    await set_prefs(push, pregnancy_week={"enabled": True})
    assert len(await live(push, "pregnancy_week")) == 1
    born = await push.client.patch(f"{CHILDREN}/{child['id']}", headers=WRITE, json={
        "revision": child["revision"], "birth_date": moment.date().isoformat(),
    })
    assert born.status_code == 200, born.text
    assert await live(push, "pregnancy_week") == []


async def test_moving_the_due_date_moves_the_week_and_removing_the_child_clears_it(push, monkeypatch):
    moment = freeze(monkeypatch)
    child = await add_child(push, due_date=due_date_for(moment, week=37).isoformat())
    await set_prefs(push, pregnancy_week={"enabled": True})
    first = (await live(push, "pregnancy_week"))[0]
    moved = await push.client.patch(f"{CHILDREN}/{child['id']}", headers=WRITE, json={
        "revision": child["revision"], "due_date": due_date_for(moment, week=30).isoformat(),
    })
    assert moved.status_code == 200, moved.text
    rows = await live(push, "pregnancy_week")
    assert [row.payload["week"] for row in rows] == [30] and rows[0].id != first.id
    removed = await push.client.delete(
        f"{CHILDREN}/{child['id']}?revision={moved.json()['revision']}", headers=WRITE
    )
    assert removed.status_code == 204, removed.text
    assert await live(push, "pregnancy_week") == []


async def test_no_week_is_queued_without_a_due_date_or_after_the_setting_goes_off(push, monkeypatch):
    moment = freeze(monkeypatch)
    await add_child(push)
    await set_prefs(push, pregnancy_week={"enabled": True})
    assert await rows_of(push) == []
    await add_child(push, name="Noa", due_date=due_date_for(moment, week=37).isoformat())
    assert len(await live(push, "pregnancy_week")) == 1
    await set_prefs(push, pregnancy_week={"enabled": False})
    assert await live(push, "pregnancy_week") == []


# Stubs, until approved content lands.


@pytest.mark.parametrize("kind", ["milestone_window", "well_visit"])
async def test_stubbed_kinds_can_be_set_but_nothing_is_scheduled_or_sent(push, kind):
    await set_prefs(push, **{kind: {"enabled": True}})
    await add_child(push, birth_date=(now() - timedelta(weeks=8)).date().isoformat())
    push.worker.swept_at = None
    assert await rows_of(push) == []
    assert kind in triggers.STUB_KINDS and kind not in triggers.PLANNERS
    # Even a row that somehow exists stays quiet.
    async with push.sessions() as db:
        access = await reminder_access(db, "owner")
        await schedule(db, owner="owner", space_id=access.personal_space_id, kind=kind, key="stray", due_at=now())
        await db.commit()
    assert await due_texts(push) == []
    await push.worker.tick()
    assert push.expo.sent == []


async def test_nothing_a_reminder_says_gives_advice(push, monkeypatch):
    moment = freeze(monkeypatch)
    child = await add_child(push, due_date=due_date_for(moment, week=37, days_until_it_starts=0).isoformat())
    await set_prefs(
        push, feed_interval={"enabled": True, "hours": 1}, running_timer={"enabled": True},
        pregnancy_week={"enabled": True},
    )
    fed = moment - timedelta(hours=2)
    await log(push, child_id=child["id"], at=fed)
    started = moment - timedelta(hours=5)
    await log(push, "sleep", child_id=child["id"], at=started, data={})
    await save_tip(push, 37, 37)
    words = list(LOCK_SCREEN.values())
    async with push.sessions() as db:
        access = await reminder_access(db, "owner")
        prefs = await load_prefs(db, "owner", access.personal_space_id)
        for row in await rows_of(push):
            text = await triggers.RESOLVERS[row.kind](db, row, access, prefs)
            if text:
                words.append(text.detail)
    assert len(words) >= 6
    assert not [text for text in words if ADVICE.search(text)]


# The moment of send is the only moment that counts.


def before_final_check(worker, change):
    original = worker.final_check

    async def changed_first(*args):
        await change()
        return await original(*args)

    worker.final_check = changed_first


def quiet_now():
    moment = now().astimezone(GUAM)
    return {
        "start": (moment - timedelta(hours=1)).strftime("%H:%M"),
        "end": (moment + timedelta(hours=1)).strftime("%H:%M"),
        "timezone": "Pacific/Guam",
    }


async def patch_prefs(api, **body):
    response = await api.client.patch(PREFS, headers=WRITE, json=body)
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("change", ["pref_off", "record_deleted", "new_feed", "quiet", "interval"])
async def test_nothing_that_changed_since_the_claim_slips_through(push, change):
    """Finding 1, and 7's interval: prefs, the record, a newer feed, quiet hours and the due time, all at the last check."""
    await feed_reminder(push)
    fed = await log(push, at=now() - timedelta(hours=3, minutes=5))

    async def later():
        if change == "pref_off":
            await set_prefs(push, feed_interval={"enabled": False})
        elif change == "record_deleted":
            removed = await push.client.delete(f"{RECORDS}/{fed['id']}?revision={fed['revision']}", headers=WRITE)
            assert removed.status_code == 204
        elif change == "new_feed":
            await log(push, at=now() - timedelta(minutes=1))
        elif change == "quiet":
            await patch_prefs(push, quiet_hours=quiet_now())
        else:
            await set_prefs(push, feed_interval={"enabled": True, "hours": 6})

    before_final_check(push.worker, later)
    await push.worker.tick()
    assert push.expo.sent == []


async def test_raising_the_interval_moves_the_send_before_any_replan(push):
    """Finding 7: the old 3-hour send went out after the setting said 6."""
    await feed_reminder(push)
    fed = now() - timedelta(hours=3, minutes=5)
    await log(push, at=fed)
    assert len(await live(push)) == 1
    response = await push.client.patch(PREFS, headers=WRITE, json={"kinds": {"feed_interval": {"hours": 6}}})
    assert response.status_code == 200
    push.worker.people.clear()  # The wake is lost, and the sweep isn't due.
    await push.worker.tick()
    assert push.expo.sent == []
    assert await due_texts(push) == []
    rows = [row for row in await live(push)]
    assert [row.due_at for row in rows] == [fed + timedelta(hours=6)]
    assert rows[0].status == "queued" and rows[0].attempts == 0


async def test_a_new_time_zone_moves_the_week_reminder_before_any_replan(push, monkeypatch):
    """Finding 7: Guam to UTC shortly before the send went out before 9 AM in the new zone."""
    moment = datetime(2026, 11, 9, 23, 30, tzinfo=UTC)  # 09:30 on the 10th on Guam; 23:30 on the 9th in UTC.
    for module in (triggers, push_worker, reminders):
        monkeypatch.setattr(module, "now", lambda: moment)
    first_day = moment.astimezone(GUAM).date()
    await add_child(push, due_date=(first_day + timedelta(days=280 - 37 * 7)).isoformat())
    await set_prefs(push, pregnancy_week={"enabled": True})
    rows = await live(push, "pregnancy_week")
    week_37 = next(row for row in rows if row.payload["week"] == 37)
    assert week_37.due_at == datetime.combine(first_day, time(9), GUAM).astimezone(UTC)
    response = await push.client.patch("/api/v1/baby/profile", headers=WRITE, json={"timezone": "UTC"})
    assert response.status_code == 200, response.text
    push.worker.people.clear()
    monkeypatch.setattr(push.worker, "maintain", no_plan)
    await push.worker.tick()
    assert push.expo.sent == []
    async with push.sessions() as db:
        current = await db.get(BabyNotification, week_37.id)
    assert current.due_at == datetime(2026, 11, 10, 9, 0, tzinfo=UTC) and current.status == "queued"
    assert current.attempts == 0
    monkeypatch.setattr(reminders, "now", lambda: datetime(2026, 11, 10, 9, 1, tzinfo=UTC))
    monkeypatch.setattr(triggers, "now", lambda: datetime(2026, 11, 10, 9, 1, tzinfo=UTC))
    monkeypatch.setattr(push_worker, "now", lambda: datetime(2026, 11, 10, 9, 1, tzinfo=UTC))
    await push.worker.tick()
    assert len(push.expo.messages) == 1


async def test_undoing_the_newer_feed_brings_a_delivered_reminder_back_without_sending_it_again(push):
    """Finding 3: A went out, B was logged, B was deleted. A describes the latest feed again."""
    await feed_reminder(push)
    await log(push, at=now() - timedelta(hours=3, minutes=5))
    await push.worker.tick()
    assert len(push.expo.messages) == 1
    assert len(await due_texts(push)) == 1
    newer = await log(push)
    await push.worker.maintain()
    assert await due_texts(push) == []
    removed = await push.client.delete(f"{RECORDS}/{newer['id']}?revision={newer['revision']}", headers=WRITE)
    assert removed.status_code == 204
    await push.worker.tick()
    response = await push.client.get(DUE, headers=CURRENT)
    items = response.json()["items"]
    assert len(items) == 1 and items[0]["delivery"] == "accepted"
    assert len(push.expo.messages) == 1  # Back on Today, not sent twice.


async def test_a_reminder_someone_dismissed_stays_dismissed_through_all_of_that(push):
    await feed_reminder(push)
    await log(push, at=now() - timedelta(hours=3, minutes=5))
    await push.worker.tick()
    item = (await push.client.get(DUE, headers=CURRENT)).json()["items"][0]
    dismissed = await push.client.post(f"/api/v1/baby/reminders/{item['id']}/dismiss", headers=WRITE)
    assert dismissed.status_code == 204
    newer = await log(push)
    await push.worker.maintain()
    removed = await push.client.delete(f"{RECORDS}/{newer['id']}?revision={newer['revision']}", headers=WRITE)
    assert removed.status_code == 204
    await push.worker.tick()
    assert await due_texts(push) == []
    assert len(push.expo.messages) == 1


async def test_turning_a_kind_off_and_on_brings_a_delivered_reminder_back(push):
    await feed_reminder(push)
    await log(push, at=now() - timedelta(hours=3, minutes=5))
    await push.worker.tick()
    await set_prefs(push, feed_interval={"enabled": False})
    await push.worker.maintain()
    assert await due_texts(push) == []
    await set_prefs(push, feed_interval={"enabled": True})
    await push.worker.tick()
    assert len(await due_texts(push)) == 1
    assert len(push.expo.messages) == 1


async def test_clearing_quiet_hours_releases_a_held_reminder(push):
    """Finding 4: the old deferral kept holding it after quiet hours were cleared and replanned."""
    await feed_reminder(push)
    await patch_prefs(push, quiet_hours=quiet_now())
    await log(push, at=now() - timedelta(hours=3, minutes=5))
    await push.worker.tick()
    assert push.expo.sent == []
    assert (await live(push))[0].lease_until > now()
    await patch_prefs(push, quiet_hours=None)
    push.worker.people.add("owner")  # What the route's wake does on the running worker.
    await push.worker.tick()
    assert len(push.expo.messages) == 1


async def test_changing_quiet_hours_moves_the_hold_to_the_new_end(push):
    await feed_reminder(push)
    await patch_prefs(push, quiet_hours=quiet_now())
    await log(push, at=now() - timedelta(hours=3, minutes=5))
    await push.worker.tick()
    moment = now().astimezone(GUAM)
    longer = {**quiet_now(), "end": (moment + timedelta(hours=3)).strftime("%H:%M")}
    await patch_prefs(push, quiet_hours=longer)
    push.worker.people.add("owner")
    await push.worker.tick()
    assert push.expo.sent == []
    assert (await live(push))[0].lease_until > now() + timedelta(hours=2)


async def test_clearing_quiet_hours_leaves_a_provider_backoff_alone(push):
    """Expo said to wait. Nothing about the person's settings changes that."""
    await feed_reminder(push)
    await log(push, at=now() - timedelta(hours=3, minutes=5))
    push.expo.answers = [httpx.Response(429, headers={"Retry-After": "900"})]
    await push.worker.tick()
    held = (await live(push))[0].lease_until
    assert held > now() + timedelta(minutes=14)
    await patch_prefs(push, quiet_hours=None)
    push.worker.people.add("owner")
    await push.worker.tick()
    assert len(push.expo.sent) == 1
    assert (await live(push))[0].lease_until == held
