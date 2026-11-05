"""Registering phones and per-person reminder settings, behind BABY_PUSH_ENABLED."""

import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.domains.baby.lifecycle import lock_family_data
from app.domains.baby.models import (
    BabyMembership,
    BabyNotification,
    BabyNotificationPref,
    BabyPushDevice,
    BabySpace,
)
from app.domains.baby.push import (
    EPOCH,
    MAX_DEVICES,
    MICROSECOND,
    PERSON_ROW,
    QuietHours,
    quiet_until,
)
from tests import test_baby_integration as shared

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="Disposable TEST_DATABASE_URL required"
)
CURRENT = {"X-Baby-Client": "2"}
WRITE = {**shared.GEN, **CURRENT}
DEVICE = "/api/v1/baby/push/devices/phone-install-1"
PREFS = "/api/v1/baby/push/prefs"
TOKEN = "ExponentPushToken[abcDEF123_-]"


def body(token=TOKEN, platform="ios"):
    return {"token": token, "platform": platform}


@pytest.fixture
def push(baby_api):
    baby_api.settings.baby_push_enabled = True
    return baby_api


async def devices(api, **where):
    async with api.sessions() as db:
        query = select(BabyPushDevice).filter_by(**where)
        return list(await db.scalars(query))


async def register(api, url=DEVICE, payload=None, headers=WRITE):
    response = await api.client.put(url, headers=headers, json=payload or body())
    assert response.status_code == 200, response.text
    return response.json()["registration"]


@needs_database
async def test_flag_off_and_build_32_have_no_routes(baby_api):
    baby_api.settings.baby_push_enabled = False
    c = baby_api.client
    assert (await c.put(DEVICE, headers=WRITE, json=body())).status_code == 404
    assert (await c.delete(DEVICE + "?registration=1", headers=CURRENT)).status_code == 404
    assert (await c.get(PREFS, headers=CURRENT)).status_code == 404
    assert (await c.patch(PREFS, headers=WRITE, json={})).status_code == 404
    baby_api.settings.baby_push_enabled = True
    assert (await c.put(DEVICE, headers=shared.GEN, json=body())).status_code == 404
    assert (await c.get(PREFS)).status_code == 404
    assert await devices(baby_api) == []


@needs_database
@pytest.mark.parametrize("token", [
    "abc", "ExponentPushToken[]", "ExponentPushToken[a b]", "ExponentPushToken[abc]x",
    "https://evil.test/ExponentPushToken[abc]", "ExponentPushToken[" + "a" * 200 + "]",
])
async def test_token_format_is_checked(push, token):
    response = await push.client.put(DEVICE, headers=WRITE, json=body(token))
    assert response.status_code == 422
    assert token not in response.text
    assert await devices(push) == []


@needs_database
async def test_register_is_idempotent_and_never_echoes_the_token(push):
    c = push.client
    for _ in range(2):
        response = await c.put(DEVICE, headers=WRITE, json=body())
        assert response.status_code == 200, response.text
        assert TOKEN not in response.text
    assert [row.token for row in await devices(push)] == [TOKEN]
    newer = "ExpoPushToken[rotated]"
    assert (await c.put(DEVICE, headers=WRITE, json=body(newer))).status_code == 200
    assert [row.token for row in await devices(push)] == [newer]


@needs_database
async def test_rapid_token_updates_are_throttled_per_person_and_sign_out_never_is(push):
    c = push.client
    codes = [(await c.put(DEVICE, headers=WRITE, json=body())).status_code for _ in range(40)]
    assert codes[0] == 200 and codes[-1] == 429 and set(codes) == {200, 429}
    refused = await c.put(DEVICE, headers=WRITE, json=body())
    assert refused.status_code == 429 and int(refused.headers["Retry-After"]) >= 1
    assert TOKEN not in refused.text
    other = {**WRITE, "X-Test-Owner": "other"}
    assert (await c.put(DEVICE, headers=other, json=body("ExpoPushToken[theirs]"))).status_code == 200
    async with push.sessions() as db:
        version = (await db.scalar(select(BabyPushDevice).filter_by(app_user_id="owner"))).updated_at
    registration = (version - EPOCH) // MICROSECOND
    assert (await c.delete(f"{DEVICE}?registration={registration}", headers=CURRENT)).status_code == 204
    assert [row.app_user_id for row in await devices(push)] == ["other"]


@needs_database
async def test_register_needs_the_current_generation(push):
    stale = {**CURRENT, "X-Baby-Generation": "9"}
    assert (await push.client.put(DEVICE, headers=stale, json=body())).status_code == 409
    assert await devices(push) == []


@needs_database
async def test_a_phone_belongs_to_whoever_signed_in_last(push):
    c = push.client
    await register(push)
    other = {**WRITE, "X-Test-Owner": "other"}
    assert (await c.put(DEVICE, headers=other, json=body())).status_code == 200
    assert [row.app_user_id for row in await devices(push)] == ["other"]


@needs_database
async def test_a_reinstall_on_the_same_phone_replaces_its_old_row(push):
    await register(push)
    await register(push, DEVICE + "-again")
    assert [row.installation_id for row in await devices(push)] == ["phone-install-1-again"]


@needs_database
async def test_device_count_is_bounded_oldest_first(push):
    c = push.client
    for n in range(MAX_DEVICES + 1):
        url = f"/api/v1/baby/push/devices/phone-install-{n}"
        assert (await c.put(url, headers=WRITE, json=body(f"ExpoPushToken[t{n}]"))).status_code == 200
    kept = {row.installation_id for row in await devices(push)}
    assert len(kept) == MAX_DEVICES and "phone-install-0" not in kept


@needs_database
async def test_sign_out_removes_only_this_persons_token(push):
    c = push.client
    other = {**WRITE, "X-Test-Owner": "other"}
    mine = await register(push)
    theirs = await register(push, payload=body("ExpoPushToken[theirs]"), headers=other)
    # Sign-out carries no generation: it has to work even from a stale phone.
    assert (await c.delete(f"{DEVICE}?registration={mine}", headers=CURRENT)).status_code == 204
    assert (await c.delete(f"{DEVICE}?registration={mine}", headers=CURRENT)).status_code == 204
    assert (await c.delete(f"{DEVICE}?registration={theirs}", headers=CURRENT)).status_code == 204
    assert [row.app_user_id for row in await devices(push)] == ["other"]


@needs_database
async def test_a_late_sign_out_leaves_the_newer_registration(push):
    """Finding 6: the sign-out from before this sign-in arrives last, and must not end it."""
    c = push.client
    first = await register(push)
    second = await register(push)
    assert int(second) > int(first)
    assert (await c.delete(f"{DEVICE}?registration={first}", headers=CURRENT)).status_code == 204
    assert [row.token for row in await devices(push)] == [TOKEN]
    assert (await c.delete(f"{DEVICE}?registration={second}", headers=CURRENT)).status_code == 204
    assert await devices(push) == []


@needs_database
@pytest.mark.parametrize("suffix", ["", "?registration=soon", "?registration=" + "9" * 18])
async def test_sign_out_must_name_a_registration(push, suffix):
    await register(push)
    assert (await push.client.delete(DEVICE + suffix, headers=CURRENT)).status_code == 422
    assert len(await devices(push)) == 1


@needs_database
async def test_generation_change_removes_tokens_and_settings(push):
    c = push.client
    await register(push)
    patch = {"kinds": {"event": {"enabled": True}}}
    assert (await c.patch(PREFS, headers=WRITE, json=patch)).status_code == 200
    erased = await c.delete("/api/v1/baby/data?generation=1", headers=WRITE)
    assert erased.status_code == 200, erased.text
    assert await devices(push) == []
    async with push.sessions() as db:
        assert list(await db.scalars(select(BabyNotificationPref))) == []
    # The old generation cannot put its phone back.
    assert (await c.put(DEVICE, headers=WRITE, json=body())).status_code == 409


@needs_database
async def test_everything_is_off_until_turned_on(push):
    response = await push.client.get(PREFS, headers=CURRENT)
    assert response.status_code == 200
    state = response.json()
    assert state["quiet_hours"] is None
    assert len(state["kinds"]) == 8
    assert all(not item["enabled"] and not item["break_through"] for item in state["kinds"].values())


@needs_database
async def test_prefs_are_per_person_and_only_named_values_change(push):
    c = push.client
    quiet = {"start": "22:00", "end": "07:00", "timezone": "Pacific/Guam"}
    first = await c.patch(PREFS, headers=WRITE, json={
        "quiet_hours": quiet,
        "kinds": {"event": {"enabled": True, "break_through": True}},
    })
    assert first.status_code == 200, first.text
    second = (await c.patch(PREFS, headers=WRITE, json={"kinds": {"visit_prep": {"enabled": True}}})).json()
    assert second["quiet_hours"] == quiet
    assert second["kinds"]["event"]["break_through"] is True
    third = (await c.patch(PREFS, headers=WRITE, json={"kinds": {"event": {"break_through": False}}})).json()
    assert third["kinds"]["event"] == {**second["kinds"]["event"], "break_through": False}
    fourth = (await c.patch(PREFS, headers=WRITE, json={"quiet_hours": None})).json()
    assert fourth["quiet_hours"] is None and fourth["kinds"]["visit_prep"]["enabled"] is True
    theirs = (await c.get(PREFS, headers={**CURRENT, "X-Test-Owner": "other"})).json()
    assert theirs["quiet_hours"] is None and theirs["kinds"]["event"]["enabled"] is False


@needs_database
async def test_feed_reminder_has_no_default_interval(push):
    c = push.client
    refused = await c.patch(PREFS, headers=WRITE, json={"kinds": {"feed_interval": {"enabled": True}}})
    assert refused.status_code == 422 and "hours" in refused.json()["detail"]
    saved = await c.patch(PREFS, headers=WRITE, json={"kinds": {"feed_interval": {"enabled": True, "hours": 2.5}}})
    assert saved.json()["kinds"]["feed_interval"]["hours"] == 2.5
    cleared = await c.patch(PREFS, headers=WRITE, json={"kinds": {"feed_interval": {"hours": None}}})
    assert cleared.status_code == 422


@needs_database
@pytest.mark.parametrize("patch", [
    {"kinds": {"feed_interval": {"enabled": False, "hours": 0.25}}},
    {"kinds": {"feed_interval": {"hours": 25}}},
    {"kinds": {"event": {"hours": 2}}},
    {"kinds": {"running_timer": {"hours": 2}}},
    {"kinds": {"nope": {"enabled": True}}},
    {"kinds": {"event": {"enabled": "yes"}}},
    {"quiet_hours": {"start": "22:00", "end": "22:00", "timezone": "Pacific/Guam"}},
    {"quiet_hours": {"start": "24:00", "end": "07:00", "timezone": "Pacific/Guam"}},
    {"quiet_hours": {"start": "22:00", "end": "07:00", "timezone": "Mars/Base"}},
    {"show_details": True},  # Lock screens stay generic, so there is no such setting to turn on.
])
async def test_invalid_settings_are_refused(push, patch):
    assert (await push.client.patch(PREFS, headers=WRITE, json=patch)).status_code == 422


@needs_database
@pytest.mark.parametrize("settings", [
    {"hours": "soon"},  # Not a number.
    {"hours": 2},  # A number, but this setting belongs to another reminder.
    ["not", "an", "object"],
])
async def test_unreadable_stored_settings_count_as_off_and_can_be_replaced(push, settings):
    async with push.sessions() as db:
        space = await db.scalar(shared.text(
            "SELECT personal_space_id FROM baby_memberships WHERE app_user_id='owner'"
        ))
        db.add(BabyNotificationPref(space_id=space, app_user_id="owner", kind="event",
                                    enabled=True, settings=settings))
        db.add(BabyNotificationPref(space_id=space, app_user_id="owner", kind=PERSON_ROW,
                                    enabled=False, settings=settings))
        await db.commit()
    response = await push.client.get(PREFS, headers=CURRENT)
    assert response.status_code == 200, response.text
    state = response.json()
    assert state["kinds"]["event"]["enabled"] is False and state["quiet_hours"] is None
    fixed = await push.client.patch(PREFS, headers=WRITE, json={"kinds": {"event": {"enabled": True}}})
    assert fixed.status_code == 200 and fixed.json()["kinds"]["event"]["enabled"] is True


@needs_database
async def test_erasure_discovery_finds_reminders_in_a_space_the_person_has_no_other_link_to(push):
    """A reminder naming a space must take part in the lock order, not only the foreign-key cascade."""
    async with push.sessions() as db:
        space = BabySpace(id=uuid4(), kind="family", generation=1)
        db.add(space)
        await db.flush()
        db.add(BabyNotification(
            space_id=space.id, app_user_id="owner", idempotency_key="k", collapse_id="c", kind="event",
            payload={}, due_at=datetime.now(UTC),
        ))
        await db.commit()
        space_id = space.id
    async with push.sessions() as db:
        grants = await lock_family_data(db, "owner")
        assert space_id in {grant.id for grant in grants}
        await db.rollback()


@needs_database
async def test_deleting_an_account_takes_phones_settings_and_reminders_in_every_space(push):
    c = push.client
    await register(push)
    other = {**WRITE, "X-Test-Owner": "other"}
    await register(push, payload=body("ExpoPushToken[theirs]"), headers=other)
    assert (await c.patch(PREFS, headers=WRITE, json={"kinds": {"event": {"enabled": True}}})).status_code == 200
    assert (await c.patch(PREFS, headers=other, json={"kinds": {"event": {"enabled": True}}})).status_code == 200
    async with push.sessions() as db:
        grants = await lock_family_data(db, "owner")
        from app.domains.baby.lifecycle import erase_baby_account

        await erase_baby_account(db, "owner", grants)
        await db.commit()
    async with push.sessions() as db:
        assert {row.app_user_id for row in await db.scalars(select(BabyPushDevice))} == {"other"}
        assert {row.app_user_id for row in await db.scalars(select(BabyNotificationPref))} == {"other"}
        assert await db.get(BabyMembership, "other") is not None


def test_quiet_hours_cross_midnight_in_their_own_zone():
    quiet = QuietHours(start="22:00", end="07:00", timezone="Pacific/Guam")  # UTC+10
    # 23:00 on Guam is 13:00 UTC; it ends at 07:00 next morning, 21:00 UTC.
    assert quiet_until(quiet, datetime(2026, 11, 4, 13, 0, tzinfo=UTC)) == datetime(2026, 11, 4, 21, 0, tzinfo=UTC)
    # 02:00 on Guam belongs to the window opened the evening before.
    assert quiet_until(quiet, datetime(2026, 11, 4, 16, 0, tzinfo=UTC)) == datetime(2026, 11, 4, 21, 0, tzinfo=UTC)
    # The edges: start is inside and end is outside. 12:00 UTC is 22:00; 21:00 UTC is 07:00.
    assert quiet_until(quiet, datetime(2026, 11, 4, 12, 0, tzinfo=UTC)) is not None
    assert quiet_until(quiet, datetime(2026, 11, 4, 21, 0, tzinfo=UTC)) is None
    assert quiet_until(None, datetime(2026, 11, 4, 13, 0, tzinfo=UTC)) is None


def test_daytime_window_does_not_cross_midnight():
    quiet = QuietHours(start="13:00", end="15:00", timezone="Pacific/Guam")
    assert quiet_until(quiet, datetime(2026, 11, 4, 3, 30, tzinfo=UTC)) == datetime(2026, 11, 4, 5, 0, tzinfo=UTC)
    assert quiet_until(quiet, datetime(2026, 11, 4, 6, 0, tzinfo=UTC)) is None


def test_fall_back_keeps_the_wall_clock_end():
    quiet = QuietHours(start="22:00", end="07:00", timezone="America/New_York")
    # Clocks go back at 2 AM on Nov 1 2026; 07:00 EST is then 12:00 UTC rather than 11:00.
    moment = datetime(2026, 11, 1, 3, 0, tzinfo=UTC)  # 23:00 EDT on Oct 31.
    assert quiet_until(quiet, moment) == datetime(2026, 11, 1, 12, 0, tzinfo=UTC)


def test_spring_forward_keeps_the_wall_clock_end():
    quiet = QuietHours(start="22:00", end="07:00", timezone="America/New_York")
    # Clocks go forward at 2 AM on Mar 14 2027; 07:00 EDT is then 11:00 UTC rather than 12:00.
    moment = datetime(2027, 3, 14, 3, 0, tzinfo=UTC)  # 22:00 EST on Mar 13.
    assert quiet_until(quiet, moment) == datetime(2027, 3, 14, 11, 0, tzinfo=UTC)


def test_an_end_in_the_repeated_hour_is_never_already_past():
    """Finding 3: 01:15 the second time round read as before a 01:30 that happened an hour ago."""
    quiet = QuietHours(start="22:00", end="01:30", timezone="America/New_York")
    second_pass = datetime(2026, 11, 1, 6, 15, tzinfo=UTC)  # 01:15 EST, after 01:30 EDT at 05:30 UTC.
    assert second_pass.astimezone(ZoneInfo("America/New_York")).fold == 1
    until = quiet_until(quiet, second_pass)
    assert until == datetime(2026, 11, 1, 6, 30, tzinfo=UTC)
    assert quiet_until(quiet, until) is None


def test_an_end_in_the_skipped_hour_is_never_already_past():
    quiet = QuietHours(start="22:00", end="02:30", timezone="America/New_York")
    after_the_gap = datetime(2027, 3, 14, 7, 10, tzinfo=UTC)  # 03:10 EDT; 02:30 never happened.
    until = quiet_until(quiet, after_the_gap)
    assert until is not None and until > after_the_gap
    assert quiet_until(quiet, until) is None


@pytest.mark.parametrize("zone", ["America/New_York", "America/Los_Angeles", "Australia/Lord_Howe", "Pacific/Guam"])
@pytest.mark.parametrize("start,end", [
    ("22:00", "07:00"), ("22:00", "01:30"), ("00:30", "01:30"), ("01:30", "02:30"), ("02:30", "03:10"),
    ("23:30", "02:15"), ("01:45", "01:15"), ("13:00", "15:00"),
])
@pytest.mark.parametrize("first", [datetime(2026, 10, 31, tzinfo=UTC), datetime(2027, 3, 13, tzinfo=UTC),
                                   datetime(2026, 10, 3, tzinfo=UTC), datetime(2027, 4, 3, tzinfo=UTC)])
def test_a_deferral_is_always_in_the_future_and_never_more_than_a_day_away(zone, start, end, first):
    """Every five minutes around both US changes, and Lord Howe's half-hour ones; Guam has none."""
    quiet = QuietHours(start=start, end=end, timezone=zone)
    for step in range(0, 3 * 24 * 12):
        moment = first + timedelta(minutes=5 * step)
        until = quiet_until(quiet, moment)
        if until is not None:
            assert moment < until <= moment + timedelta(hours=26), (zone, start, end, moment, until)
            assert quiet_until(quiet, until) != until
