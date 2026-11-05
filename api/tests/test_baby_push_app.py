"""What the phone asks about its reminders: whether they're on, and one it was tapped on."""

import os
from datetime import datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyNotification
from tests.test_baby_push_worker import (  # noqa: F401
    CURRENT,
    PREFS,
    WRITE,
    baby_api,
    push,
    queue,
    reminders,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="Disposable TEST_DATABASE_URL required"
)
BOOTSTRAP = "/api/v1/baby/bootstrap"
REMINDER = "/api/v1/baby/reminders"


async def test_bootstrap_says_nothing_about_reminders_with_the_flag_off(baby_api):  # noqa: F811
    baby_api.settings.baby_push_enabled = False
    for client in ("2", "3"):
        assert "reminders" not in (await baby_api.client.get(BOOTSTRAP, headers={"X-Baby-Client": client})).json()


async def test_bootstrap_says_reminders_are_on_at_any_client_level(push):  # noqa: F811
    for client in ("2", "3"):
        response = await push.client.get(BOOTSTRAP, headers={"X-Baby-Client": client})
        assert response.json()["reminders"] == {"push": True}


async def test_a_tap_finds_its_reminder(push):  # noqa: F811
    row = await queue(push)
    response = await push.client.get(f"{REMINDER}/{row.id}/tap", headers=CURRENT)
    assert response.status_code == 200
    item = response.json()
    assert (item["id"], item["kind"], item["space_id"], item["identity"]) == (
        str(row.id), "event", str(row.space_id), row.collapse_id)


async def test_a_tap_on_one_that_is_gone_finds_nothing(push):  # noqa: F811
    assert (await push.client.get(f"{REMINDER}/{uuid4()}/tap", headers=CURRENT)).status_code == 404
    row = await queue(push)
    await push.client.post(f"{REMINDER}/{row.id}/dismiss", headers=CURRENT)
    assert (await push.client.get(f"{REMINDER}/{row.id}/tap", headers=CURRENT)).status_code == 404


async def test_a_tap_on_one_whose_reason_went_finds_nothing(push, monkeypatch):  # noqa: F811
    row = await queue(push)

    async def gone(db, row, access, prefs):
        return None

    monkeypatch.setattr(reminders, "RESOLVERS", {"event": gone})
    assert (await push.client.get(f"{REMINDER}/{row.id}/tap", headers=CURRENT)).status_code == 404


async def test_a_tap_on_one_not_due_yet_finds_nothing(push):  # noqa: F811
    await queue(push, key="later", due=now() + timedelta(hours=1))
    async with push.sessions() as db:
        row = await db.scalar(select(BabyNotification))
    assert (await push.client.get(f"{REMINDER}/{row.id}/tap", headers=CURRENT)).status_code == 404


async def test_a_tap_on_someone_elses_reminder_finds_nothing(push):  # noqa: F811
    row = await queue(push)
    response = await push.client.get(f"{REMINDER}/{row.id}/tap", headers={**CURRENT, "X-Test-Owner": "other"})
    assert response.status_code in {404, 409}
    assert "event" not in response.text


async def test_flag_off_has_no_lookup(push):  # noqa: F811
    row = await queue(push)
    push.settings.baby_push_enabled = False
    assert (await push.client.get(f"{REMINDER}/{row.id}/tap", headers=CURRENT)).status_code == 404


async def upcoming(api, owner="owner"):
    response = await api.client.get(f"{REMINDER}/upcoming", headers={**CURRENT, "X-Test-Owner": owner})
    assert response.status_code == 200, response.text
    return response.json()["items"]


async def test_upcoming_lists_what_is_waiting_with_only_lock_screen_words(push):  # noqa: F811
    due = now() + timedelta(hours=1)
    await queue(push, key="soon", due=due)
    await queue(push, key="now")
    items = await upcoming(push)
    assert len(items) == 1
    assert set(items[0]) == {"id", "kind", "space_id", "identity", "fire_at", "text", "time_sensitive", "data"}
    assert items[0]["text"] == reminders.lock_screen("event")
    assert items[0]["time_sensitive"] is False
    assert datetime.fromisoformat(items[0]["fire_at"]) == due


async def test_upcoming_waits_out_quiet_hours_unless_it_breaks_through(push):  # noqa: F811
    moment = now().astimezone(ZoneInfo("UTC"))
    start, end = moment + timedelta(minutes=30), moment + timedelta(hours=2)
    await push.client.patch(PREFS, headers=WRITE, json={"quiet_hours": {
        "start": start.strftime("%H:%M"), "end": end.strftime("%H:%M"), "timezone": "UTC",
    }})
    await queue(push, key="soon", due=moment + timedelta(hours=1))
    [item] = await upcoming(push)
    assert datetime.fromisoformat(item["fire_at"]).strftime("%H:%M") == end.strftime("%H:%M")
    await push.client.patch(PREFS, headers=WRITE, json={"kinds": {"event": {"break_through": True}}})
    [item] = await upcoming(push)
    assert datetime.fromisoformat(item["fire_at"]) == moment + timedelta(hours=1)
    assert item["time_sensitive"] is True


async def test_upcoming_skips_dismissed_cleared_and_other_peoples(push, monkeypatch):  # noqa: F811
    await queue(push, key="soon", due=now() + timedelta(hours=1))
    [item] = await upcoming(push)
    assert await upcoming(push, owner="other") == []
    await push.client.post(f"{REMINDER}/{item['id']}/dismiss", headers=CURRENT)
    assert await upcoming(push) == []

    async def gone(db, row, access, prefs):
        return None

    await queue(push, key="later", due=now() + timedelta(hours=1))
    monkeypatch.setattr(reminders, "RESOLVERS", {"event": gone})
    assert await upcoming(push) == []


async def test_an_alert_is_only_an_alert_and_nothing_wakes_the_app(push):  # noqa: F811
    await queue(push)
    await push.worker.tick()
    assert "_contentAvailable" not in push.expo.messages[0]


async def test_a_change_sends_nothing_to_a_phone(push):  # noqa: F811
    push.worker.plan_soon("owner")
    await push.worker.tick()
    assert push.expo.sent == []
