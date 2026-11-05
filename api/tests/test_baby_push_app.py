"""What the phone asks about its reminders: whether they're on, and one it was tapped on."""

import os
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyNotification
from tests.test_baby_push_worker import CURRENT, baby_api, push, queue, reminders  # noqa: F401

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
