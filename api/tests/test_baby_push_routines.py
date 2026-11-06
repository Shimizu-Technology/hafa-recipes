"""Routines on the API: a phone that holds one keeps firing it itself, and anyone else's phone gets a push."""

import os
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import SecretStr
from sqlalchemy import select, text, update

from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyNotification, BabyNotificationPref, BabyPushDevice
from app.domains.baby.push_worker import BabyPushWorker
from app.domains.baby.triggers import routine_schedule, routine_times
from tests import test_baby_integration as shared
from tests.test_baby_push_worker import CURRENT, WRITE, Expo, register

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="Disposable TEST_DATABASE_URL required"
)
baby_api = shared.baby_api
RECORDS = "/api/v1/baby/records"
BOOTSTRAP = "/api/v1/baby/bootstrap"
DUE = "/api/v1/baby/reminders/due"
PHONE = "/api/v1/baby/push/devices/phone-install-1/routines"
PHONE2 = "/api/v1/baby/push/devices/phone-install-2/routines"


@pytest.fixture
async def push(baby_api):
    baby_api.settings.baby_push_enabled = True
    baby_api.settings.expo_access_token = SecretStr("expo-test-token")
    expo = Expo()
    await register(baby_api)
    worker = BabyPushWorker(baby_api.sessions, transport=expo.transport())
    yield SimpleNamespace(**vars(baby_api), expo=expo, worker=worker)


async def routine(api, at, *, repeat="none", enabled=True, zone="Pacific/Guam", title="Vitamins", items=None, routine_type="schedule"):
    body = {
        "id": str(uuid4()), "kind": "routine", "title": title, "occurred_at": now().isoformat(),
        "data": {"routine_type": routine_type, "reminder_at": at.isoformat(), "repeat": repeat, "timezone": zone, "enabled": enabled, "items": items or []},
    }
    response = await api.client.post(RECORDS, headers=WRITE, json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def report(api, holds, url=PHONE, expected=200):
    response = await api.client.put(url, headers=WRITE, json={"holds": holds})
    assert response.status_code == expected, response.text
    api.worker.people.add("owner")  # What the running worker hears from this route.
    return response


async def held(api, *rows, url=PHONE):
    return await report(api, {row["id"]: routine_schedule(row["data"]) for row in rows}, url)


async def rows_of(api):
    await api.worker.maintain()
    async with api.sessions() as db:
        return list(await db.scalars(select(BabyNotification).where(BabyNotification.kind == "routine").order_by(BabyNotification.due_at)))


async def come_due(api):
    async with api.sessions() as db:
        await db.execute(update(BabyNotification).where(BabyNotification.kind == "routine").values(due_at=now() - timedelta(seconds=5)))
        await db.commit()


# Without migration 061 nothing changes.


async def test_before_the_migration_nothing_is_offered_and_nothing_goes(push):
    assert "routines" not in (await push.client.get(BOOTSTRAP, headers=CURRENT)).json()["reminders"]
    await report(push, {}, expected=404)
    await routine(push, now() + timedelta(hours=1))
    assert await rows_of(push) == []


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_after_the_migration_the_api_says_so(push):
    assert (await push.client.get(BOOTSTRAP, headers=CURRENT)).json()["reminders"] == {"push": True, "routines": True}


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_the_flag_off_says_nothing_and_takes_no_report(push):
    push.settings.baby_push_enabled = False
    assert "reminders" not in (await push.client.get(BOOTSTRAP, headers=CURRENT)).json()
    await report(push, {}, expected=404)


# Nobody's routines are planned until one of their phones has reported.


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_nothing_is_planned_until_a_phone_reports(push):
    await routine(push, now() + timedelta(hours=1))
    assert await rows_of(push) == []
    await report(push, {})
    assert len(await rows_of(push)) == 1


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_a_report_from_a_phone_that_isnt_registered_is_turned_away(push):
    await report(push, {}, url=PHONE2, expected=404)


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_a_report_can_only_name_a_phone_of_ones_own(push):
    response = await push.client.put(PHONE, headers={**WRITE, "X-Test-Owner": "other"}, json={"holds": {}})
    assert response.status_code in {404, 409}


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_a_report_of_a_bad_shape_is_refused(push):
    assert (await push.client.put(PHONE, headers=WRITE, json={"holds": {"not-an-id": "x"}})).status_code == 422
    assert (await push.client.put(PHONE, headers=WRITE, json={"holds": {str(uuid4()): "x" * 500}})).status_code == 422


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_turning_it_off_on_the_api_is_not_undone_by_the_next_report(push):
    await report(push, {})
    await push.client.patch("/api/v1/baby/push/prefs", headers=WRITE, json={"kinds": {"routine": {"enabled": False}}})
    await report(push, {})
    async with push.sessions() as db:
        row = await db.get(BabyNotificationPref, (await personal(push), "owner", "routine"))
    assert row.enabled is False


async def personal(api):
    async with api.sessions() as db:
        return await db.scalar(text("SELECT personal_space_id FROM baby_memberships WHERE app_user_id = 'owner'"))


# Per-device: exactly one thing fires on each phone.


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_a_phone_holding_it_gets_no_push_and_still_sees_it_on_today(push):
    row = await routine(push, now() + timedelta(hours=1))
    await held(push, row)
    [planned] = await rows_of(push)
    await come_due(push)
    await push.worker.tick()
    assert push.expo.messages == []
    async with push.sessions() as db:
        settled = await db.get(BabyNotification, planned.id)
    assert (settled.status, settled.last_error) == ("failed", "no_device")
    items = (await push.client.get(DUE, headers=CURRENT)).json()["items"]
    assert [item["kind"] for item in items] == ["routine"]
    assert items[0]["data"]["record_id"] == row["id"]
    assert "Vitamins" in items[0]["text"]


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_only_the_phone_that_doesnt_hold_it_gets_a_push(push):
    row = await routine(push, now() + timedelta(hours=1))
    await register(push, install="phone-install-2", token="ExponentPushToken[two]")
    await held(push, row)
    await report(push, {}, url=PHONE2)
    await rows_of(push)
    await come_due(push)
    await push.worker.tick()
    assert [message["to"] for message in push.expo.messages] == ["ExponentPushToken[two]"]
    assert push.expo.messages[0]["body"] == "A moment for your routine."
    assert set(push.expo.messages[0]["data"]) == {"notification_id", "space_id", "identity"}


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_a_phone_that_has_never_reported_gets_nothing_so_its_old_schedule_cant_double(push):
    row = await routine(push, now() + timedelta(hours=1))
    await register(push, install="phone-install-2", token="ExponentPushToken[two]")
    await held(push, row)
    await rows_of(push)
    await come_due(push)
    await push.worker.tick()
    assert push.expo.messages == []


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_one_held_at_an_old_schedule_doesnt_count_so_the_new_time_still_reaches_that_phone(push):
    row = await routine(push, now() + timedelta(hours=1))
    await held(push, row)
    await report(push, {row["id"]: "something-older"})
    await rows_of(push)
    await come_due(push)
    await push.worker.tick()
    assert [message["to"] for message in push.expo.messages] == ["ExponentPushToken[one]"]


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_a_new_report_replaces_the_last(push):
    first, second = await routine(push, now() + timedelta(hours=1)), await routine(push, now() + timedelta(hours=1), title="Stretches")
    await held(push, first)
    await held(push, second)
    await rows_of(push)
    await come_due(push)
    await push.worker.tick()
    # The first is no longer held, so it goes; the second is held, so it doesn't.
    assert len(push.expo.messages) == 1


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_signing_out_ends_the_report_so_signing_in_again_starts_clean(push):
    row = await routine(push, now() + timedelta(hours=1))
    await held(push, row)
    async with push.sessions() as db:
        device = await db.scalar(select(BabyPushDevice))
        await db.delete(device)
        await db.commit()
    async with push.engine.connect() as connection:
        assert await connection.scalar(text("SELECT count(*) FROM baby_device_routines")) == 0
    await report(push, {}, expected=404)


# When they're due.


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_a_one_off_and_a_repeat_are_planned_at_their_times(push):
    moment = now()
    await routine(push, moment + timedelta(hours=1))
    await routine(push, moment - timedelta(days=3) + timedelta(hours=1), repeat="daily", title="Daily")
    await routine(push, moment - timedelta(days=7) + timedelta(hours=1), repeat="weekly", title="Weekly")
    await report(push, {})
    rows = await rows_of(push)
    # The one-off, then each repeat's next times inside the planning window.
    assert sum(1 for row in rows if abs((row.due_at - (moment + timedelta(hours=1))).total_seconds()) < 2) == 3
    assert 4 <= len(rows) <= 6


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_a_past_one_off_turned_on_now_isnt_announced(push):
    await routine(push, now() - timedelta(hours=5))
    await report(push, {})
    assert await rows_of(push) == []


def test_a_repeat_keeps_its_wall_clock_across_a_clock_change():
    from datetime import UTC, datetime
    start = datetime(2026, 3, 1, 15, 0, tzinfo=UTC)  # 7 AM in Los Angeles, before its clocks change on March 8.
    data = {"reminder_at": start.isoformat(), "repeat": "daily", "timezone": "America/Los_Angeles"}
    times = list(routine_times(data, datetime(2026, 3, 9, 12, 0, tzinfo=UTC)))
    assert all(moment.astimezone().tzinfo is not None for moment in times)
    assert datetime(2026, 3, 9, 14, 0, tzinfo=UTC) in times  # Still 7 AM, an hour earlier in UTC.


def test_a_routine_that_starts_later_has_no_times_before_then():
    from datetime import UTC, datetime
    start = datetime(2026, 12, 1, 15, 0, tzinfo=UTC)
    data = {"reminder_at": start.isoformat(), "repeat": "daily", "timezone": "UTC"}
    assert list(routine_times(data, datetime(2026, 11, 1, tzinfo=UTC))) == []


def test_a_broken_schedule_has_no_times():
    from datetime import UTC, datetime
    moment = datetime(2026, 11, 1, tzinfo=UTC)
    assert list(routine_times({"reminder_at": "soon", "repeat": "daily", "timezone": "UTC"}, moment)) == []
    assert list(routine_times({"reminder_at": moment.isoformat(), "repeat": "daily", "timezone": "Mars/Base"}, moment)) == []


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_upcoming_leaves_routines_out_since_a_phone_has_its_own_schedule(push):
    await routine(push, now() + timedelta(hours=1))
    await report(push, {})
    await rows_of(push)
    response = await push.client.get("/api/v1/baby/reminders/upcoming", headers=CURRENT)
    assert response.json()["items"] == []


# When they stop.


@pytest.mark.parametrize("baby_api", [61], indirect=True)
@pytest.mark.parametrize("change", [
    {"enabled": False},
    {"routine_type": "checklist", "items": [{"id": "a", "label": "A", "done": True}]},
])
async def test_off_or_finished_means_no_reminder(push, change):
    row = await routine(push, now() + timedelta(hours=1))
    await report(push, {})
    assert len(await rows_of(push)) == 1
    response = await push.client.patch(f"{RECORDS}/{row['id']}", headers=WRITE, json={"revision": row["revision"], "data": {**row["data"], **change}})
    assert response.status_code == 200, response.text
    push.worker.people.add("owner")
    assert [item for item in await rows_of(push) if item.dismissed_at is None] == []


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_a_new_time_moves_it(push):
    moment = now()
    row = await routine(push, moment + timedelta(hours=1))
    await report(push, {})
    await rows_of(push)
    later = moment + timedelta(hours=3)
    response = await push.client.patch(f"{RECORDS}/{row['id']}", headers=WRITE, json={"revision": row["revision"], "data": {**row["data"], "reminder_at": later.isoformat()}})
    assert response.status_code == 200, response.text
    push.worker.people.add("owner")
    live = [item for item in await rows_of(push) if item.dismissed_at is None]
    assert [abs((item.due_at - later).total_seconds()) < 2 for item in live] == [True]


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_todays_one_replaces_yesterdays_on_today(push):
    moment = now()
    await routine(push, moment - timedelta(days=2) - timedelta(hours=1), repeat="daily")
    await report(push, {})
    await rows_of(push)
    async with push.sessions() as db:
        await db.execute(update(BabyNotification).where(BabyNotification.kind == "routine", BabyNotification.due_at <= moment).values(
            status="accepted", due_at=BabyNotification.due_at))
        await db.commit()
    assert len((await push.client.get(DUE, headers=CURRENT)).json()["items"]) <= 1


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_quiet_hours_hold_a_push_for_a_phone_that_doesnt_hold_it(push):
    moment = now()
    await push.client.patch("/api/v1/baby/push/prefs", headers=WRITE, json={"quiet_hours": {
        "start": (moment - timedelta(hours=1)).strftime("%H:%M"), "end": (moment + timedelta(hours=1)).strftime("%H:%M"), "timezone": "UTC",
    }})
    await routine(push, moment + timedelta(minutes=30))
    await report(push, {})
    await rows_of(push)
    await come_due(push)
    await push.worker.tick()
    assert push.expo.messages == []


# Erasure and privacy.


@pytest.mark.parametrize("baby_api", [61], indirect=True)
async def test_erasing_a_person_takes_their_phones_reports(push):
    await report(push, {str(uuid4()): "x"})
    response = await push.client.delete("/api/v1/baby/data?generation=1", headers=WRITE)
    assert response.status_code in {200, 204}, response.text
    async with push.engine.connect() as connection:
        assert await connection.scalar(text("SELECT count(*) FROM baby_device_routines")) == 0
