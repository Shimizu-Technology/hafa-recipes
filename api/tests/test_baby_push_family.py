"""Reminders on the family stack: each parent's own, nothing private crossing, and every exit."""

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from app.domains.baby import push_worker, triggers
from app.domains.baby.lifecycle import now
from app.domains.baby.models import (
    BabyNotification,
    BabyNotificationPref,
    BabyPushDevice,
    BabyRecord,
    BabySpace,
    BabySpaceMember,
)
from app.domains.baby.push_worker import BabyPushWorker
from app.domains.baby.reminders import LOCK_SCREEN
from app.models.identity import AppUser
from tests import test_baby_family_records as records
from tests import test_baby_invites as invites
from tests.test_baby_push_worker import Expo

baby_api, enabled, pytestmark = invites.baby_api, invites.enabled, invites.pytestmark
API = "/api/v1/baby"
PREFS = API + "/push/prefs"
DUE = API + "/reminders/due"
LATE = timedelta(hours=3, minutes=5)  # A feed this long ago, on a 3-hour setting, is due now.


def phone(actor):
    return f"ExponentPushToken[{actor}]"


async def join(api, actor, role="parent", personal=None):
    """Through the real invitation, so the rest runs on memberships a person can actually have."""
    invitation = await invites.create(api, personal, role=role)
    accepted = await invites.accept(api, invitation, actor)
    assert accepted.status_code == 200, accepted.text
    return UUID(invitation["space_id"])


async def setup_person(api, actor, personal, **kinds):
    h = records.headers(personal, actor, 1)
    response = await api.client.put(f"{API}/push/devices/install-{actor}", headers=h,
                                    json={"token": phone(actor), "platform": "ios"})
    assert response.status_code == 200, response.text
    response = await api.client.patch(PREFS, headers=h, json={"kinds": kinds})
    assert response.status_code == 200, response.text
    return response


@pytest.fixture
async def family(baby_api, invites_on):
    """Two parents in one family, each with the feed reminder on, and a caregiver with everything on."""
    baby_api.settings.baby_push_enabled = True
    baby_api.settings.baby_new_kinds_enabled = True
    baby_api.settings.expo_access_token = SecretStr("expo-test-token")
    api, owner_personal = baby_api, invites_on
    async with api.sessions() as db:
        db.add(AppUser(id="sitter"))
        await db.commit()
    for actor in ("other", "sitter"):
        assert (await api.client.post(API + "/bootstrap", headers={"X-Test-Owner": actor})).status_code == 200
    other_personal = await invites.personal(api, "other")
    sitter_personal = await invites.personal(api, "sitter")
    space = await join(api, "other", personal=owner_personal)
    invitation = await api.client.post(API + "/family/invites", headers=records.headers(space, generation=1),
                                       json={"role": "caregiver", "publish_shared": True, "disclosure_version": 1})
    assert invitation.status_code == 201, invitation.text
    accepted = await invites.accept(api, invitation.json(), "sitter")
    assert accepted.status_code == 200, accepted.text
    feed = {"enabled": True, "hours": 3}
    everything = {"feed_interval": feed, "event": {"enabled": True}, "running_timer": {"enabled": True},
                  "pregnancy_week": {"enabled": True}, "visit_prep": {"enabled": True}}
    await setup_person(api, "owner", owner_personal, **everything)
    await setup_person(api, "other", other_personal, **everything)
    await setup_person(api, "sitter", sitter_personal, **everything)
    expo = Expo()
    worker = BabyPushWorker(api.sessions, transport=expo.transport())
    worker.watch()
    yield SimpleNamespace(**vars(api), expo=expo, worker=worker, space=space, owner_personal=owner_personal,
                          other_personal=other_personal, sitter_personal=sitter_personal)
    worker.unwatch()


@pytest.fixture
async def invites_on(baby_api, enabled):
    baby_api.settings.baby_invites_enabled = True
    return enabled


async def log(api, space, actor="owner", kind="feeding", *, at=None, child_id=None, data=None, title="Log"):
    body = {
        "id": str(uuid4()), "kind": kind, "title": title, "occurred_at": (at or now()).isoformat(),
        "child_id": child_id,
        "data": data if data is not None else ({"method": "bottle"} if kind == "feeding" else {}),
    }
    response = await api.client.post(API + "/records", headers=records.headers(space, actor, 1), json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def add_child(api, space, name="Mia", **fields):
    response = await api.client.post(API + "/children", headers=records.headers(space, generation=1),
                                     json={"id": str(uuid4()), "name": name, **fields})
    assert response.status_code == 200, response.text
    return response.json()


async def rows_of(api, kind=None, actor=None):
    await api.worker.maintain()
    async with api.sessions() as db:
        query = select(BabyNotification).where(BabyNotification.dismissed_at.is_(None))
        if kind:
            query = query.where(BabyNotification.kind == kind)
        if actor:
            query = query.where(BabyNotification.app_user_id == actor)
        return list(await db.scalars(query.order_by(BabyNotification.app_user_id)))


async def due(api, actor, space):
    response = await api.client.get(DUE, headers=records.headers(space, actor, 1))
    assert response.status_code == 200, response.text
    return response.json()["items"]


async def test_at_night_a_feed_reminder_goes_to_every_parent_with_the_app(family):
    """The user's own words. Each parent's own row, own phone; a caregiver isn't woken."""
    await log(family, family.space, at=now() - LATE)
    rows = await rows_of(family, "feed_interval")
    assert {row.app_user_id for row in rows} == {"owner", "other"}
    assert {row.space_id for row in rows} == {family.space}
    await family.worker.tick()
    assert {message["to"] for message in family.expo.messages} == {phone("owner"), phone("other")}
    assert {message["body"] for message in family.expo.messages} == {LOCK_SCREEN["feed_interval"]}
    assert len({message["collapseId"] for message in family.expo.messages}) == 2
    assert [item["kind"] for item in await due(family, "other", family.space)] == ["feed_interval"]
    assert await due(family, "sitter", family.space) == []


async def test_a_feed_logged_on_one_phone_moves_it_on_both(family):
    """The plan's N3b gate."""
    await log(family, family.space, at=now() - timedelta(hours=1))
    first = {row.app_user_id: row.due_at for row in await rows_of(family, "feed_interval")}
    assert set(first) == {"owner", "other"}
    fed = now() - timedelta(minutes=1)
    await log(family, family.space, "other", at=fed)
    second = {row.app_user_id: row.due_at for row in await rows_of(family, "feed_interval")}
    assert second == {"owner": fed + timedelta(hours=3), "other": fed + timedelta(hours=3)}


async def test_each_parents_setting_is_their_own(family):
    response = await family.client.patch(PREFS, headers=records.headers(family.other_personal, "other", 1),
                                         json={"kinds": {"feed_interval": {"enabled": False}}})
    assert response.status_code == 200
    family.worker.people.add("other")
    fed = now() - timedelta(hours=1)
    await log(family, family.space, at=fed)
    assert [row.app_user_id for row in await rows_of(family, "feed_interval")] == ["owner"]
    response = await family.client.patch(PREFS, headers=records.headers(family.other_personal, "other", 1),
                                         json={"kinds": {"feed_interval": {"enabled": True, "hours": 1}}})
    assert response.status_code == 200
    family.worker.people.add("other")
    rows = {row.app_user_id: row.due_at for row in await rows_of(family, "feed_interval")}
    assert rows == {"owner": fed + timedelta(hours=3), "other": fed + timedelta(hours=1)}


async def test_a_private_item_never_notifies_the_other_parent(family):
    await log(family, family.owner_personal, at=now() - LATE)
    start = now() + timedelta(minutes=30)
    await log(family, family.owner_personal, kind="event", at=start, title="PRIVATE_VISIT",
              data={"timezone": "Pacific/Guam", "reminder_minutes": [60]})
    await log(family, family.owner_personal, kind="sleep", at=now() - timedelta(hours=5))
    rows = await rows_of(family)
    assert rows and {row.app_user_id for row in rows} == {"owner"}
    await family.worker.tick()
    assert {message["to"] for message in family.expo.messages} == {phone("owner")}
    assert all("PRIVATE_VISIT" not in str(message) for message in family.expo.messages)
    for actor, space in (("other", family.space), ("sitter", family.space)):
        assert await due(family, actor, space) == []


@pytest.mark.parametrize("where", ["personal", "family"])
async def test_a_private_or_just_me_item_stays_generic_on_the_lock_screen(family, where):
    space = family.owner_personal if where == "personal" else family.space
    await log(family, space, kind="event", at=now() + timedelta(minutes=30), title="SECRET_TITLE",
              data={"timezone": "Pacific/Guam", "reminder_minutes": [60], "location": "SECRET_PLACE"})
    await family.worker.tick()
    assert family.expo.messages
    for message in family.expo.messages:
        assert message["body"] == LOCK_SCREEN["event"]
        assert set(message["data"]) == {"notification_id", "space_id", "identity"}
        assert "SECRET" not in str(message)
    assert "SECRET_TITLE" in (await due(family, "owner", family.space))[0]["text"]


async def test_a_caregiver_hears_about_events_and_timers_and_nothing_else(family):
    """Family review: caregiver rules for who receives what, in planning and at the last moment."""
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=30)).date().isoformat())
    await log(family, family.space, kind="event", at=now() + timedelta(minutes=30), title="Clinic",
              data={"timezone": "Pacific/Guam", "reminder_minutes": [60]})
    await log(family, family.space, kind="sleep", at=now() - timedelta(hours=5), child_id=child["id"])
    await log(family, family.space, at=now() - LATE, child_id=child["id"])
    rows = await rows_of(family, actor="sitter")
    assert {row.kind for row in rows} == {"event", "running_timer"}
    # A row that somehow exists for them is stopped at the last moment too.
    async with family.sessions() as db:
        await triggers.schedule(db, owner="sitter", space_id=family.space, kind="feed_interval", key="stray",
                                due_at=now() - timedelta(minutes=1),
                                payload={"record_id": str(uuid4()), "child_id": None})
        await db.commit()
    await family.worker.tick()
    assert LOCK_SCREEN["feed_interval"] not in {
        message["body"] for message in family.expo.messages if message["to"] == phone("sitter")
    }


async def test_a_role_changing_to_caregiver_stops_a_parents_feed_reminder_at_the_last_moment(family):
    await log(family, family.space, at=now() - LATE)
    rows = await rows_of(family, "feed_interval", "other")
    assert len(rows) == 1
    async with family.sessions() as db:
        (await db.get(BabySpaceMember, (family.space, "other"))).role = "caregiver"
        await db.commit()
    family.worker.unwatch()
    family.worker.swept_at = now()
    await family.worker.tick()
    assert phone("other") not in {message["to"] for message in family.expo.messages}
    assert phone("owner") in {message["to"] for message in family.expo.messages}
    assert await due(family, "other", family.space) == []


async def test_a_role_changing_after_the_claim_stops_the_send(family):
    """Finding 1: a caregiver downgrade landing between the first look and the request."""
    await log(family, family.space, at=now() - LATE)
    assert len(await rows_of(family, "feed_interval", "other")) == 1
    original = family.worker.final_check

    async def downgraded_first(*args):
        async with family.sessions() as db:
            (await db.get(BabySpaceMember, (family.space, "other"))).role = "caregiver"
            await db.commit()
        return await original(*args)

    family.worker.final_check = downgraded_first
    await family.worker.tick()
    assert phone("other") not in {message["to"] for message in family.expo.messages}
    assert phone("owner") in {message["to"] for message in family.expo.messages}


async def test_create_family_rebuilds_pending_reminders_for_the_new_space(baby_api, invites_on):
    """Family review: a queued reminder follows its record, keeps its identity, and prefs stay put."""
    api, personal = baby_api, invites_on
    api.settings.baby_push_enabled = api.settings.baby_new_kinds_enabled = True
    api.settings.expo_access_token = SecretStr("expo-test-token")
    await setup_person(api, "owner", personal, feed_interval={"enabled": True, "hours": 3})
    expo = Expo()
    worker = BabyPushWorker(api.sessions, transport=expo.transport())
    worker.watch()
    try:
        fed = now() - timedelta(hours=1)
        await log(api, personal, at=fed)
        just_me = await log(api, personal, at=now() - timedelta(hours=2), kind="source", title="private tip",
                            data={"source_text": "x", "just_me": True})
        await worker.maintain()
        async with api.sessions() as db:
            before = await db.scalar(select(BabyNotification).where(BabyNotification.kind == "feed_interval"))
        assert before.space_id == personal
        invitation = await invites.create(api, personal)
        family = UUID(invitation["space_id"])
        await worker.maintain()
        async with api.sessions() as db:
            after = await db.get(BabyNotification, before.id)
            assert (await db.get(BabyRecord, UUID(just_me["id"]))).space_id == personal
            prefs = list(await db.scalars(select(BabyNotificationPref).where(BabyNotificationPref.app_user_id == "owner")))
        assert after.space_id == family and after.collapse_id == before.collapse_id and after.dismissed_at is None
        assert after.due_at == fed + timedelta(hours=3)
        assert {pref.space_id for pref in prefs} == {personal}
        # The second parent is planned from the moment they join.
        assert (await api.client.post(API + "/bootstrap", headers={"X-Test-Owner": "other"})).status_code == 200
        other = await invites.personal(api, "other")
        await setup_person(api, "other", other, feed_interval={"enabled": True, "hours": 3})
        accepted = await invites.accept(api, invitation, "other")
        assert accepted.status_code == 200, accepted.text
        await worker.maintain()
        async with api.sessions() as db:
            theirs = await db.scalar(select(BabyNotification).where(BabyNotification.app_user_id == "other"))
        assert theirs.space_id == family and theirs.due_at == fed + timedelta(hours=3)
    finally:
        worker.unwatch()


async def test_create_family_with_a_reminder_due_right_then_still_goes_once(baby_api, invites_on):
    api, personal = baby_api, invites_on
    api.settings.baby_push_enabled = True
    api.settings.expo_access_token = SecretStr("expo-test-token")
    await setup_person(api, "owner", personal, feed_interval={"enabled": True, "hours": 3})
    expo = Expo()
    worker = BabyPushWorker(api.sessions, transport=expo.transport())
    worker.watch()
    try:
        await log(api, personal, at=now() - LATE)
        await worker.maintain()
        family = UUID((await invites.create(api, personal))["space_id"])
        await worker.tick()
        assert len(expo.messages) == 1 and expo.messages[0]["data"]["space_id"] == str(family)
        await worker.tick()
        assert len(expo.messages) == 1
    finally:
        worker.unwatch()


@pytest.mark.parametrize("exit", ["leave", "removed"])
async def test_leaving_or_being_removed_cancels_pending_and_clears_today(family, exit):
    await log(family, family.space, at=now() - timedelta(hours=1))
    await log(family, family.space, kind="event", at=now() + timedelta(minutes=30), title="Clinic",
              data={"timezone": "Pacific/Guam", "reminder_minutes": [60]})
    assert {row.kind for row in await rows_of(family, actor="other")} == {"feed_interval", "event"}
    if exit == "leave":
        response = await family.client.post(f"{API}/family/{family.space}/leave",
                                            headers=records.headers(family.space, "other", 1))
    else:
        response = await family.client.delete(f"{API}/family/{family.space}/members/other",
                                              headers=records.headers(family.space, "owner", 1))
    assert response.status_code == 200, response.text
    # In the same transaction as the exit, not whenever the worker next plans.
    async with family.sessions() as db:
        assert not list(await db.scalars(select(BabyNotification).where(
            BabyNotification.app_user_id == "other", BabyNotification.dismissed_at.is_(None))))
    assert await rows_of(family, actor="other") == []
    assert await due(family, "other", family.other_personal) == []
    await log(family, family.space, at=now() - LATE)  # Later feeds don't reach them either.
    await family.worker.tick()
    assert phone("other") not in {message["to"] for message in family.expo.messages}
    assert {row.app_user_id for row in await rows_of(family, "feed_interval")} == {"owner"}


async def test_a_reminder_stops_for_someone_removed_while_it_was_waiting(family):
    """Even if the cancel were missed: membership is read again right before the send."""
    await log(family, family.space, at=now() - LATE)
    assert len(await rows_of(family, "feed_interval", "other")) == 1
    async with family.sessions() as db:
        (await db.get(BabySpaceMember, (family.space, "other"))).status = "removed"
        await db.commit()
    family.worker.unwatch()
    family.worker.swept_at = now()
    await family.worker.tick()
    assert phone("other") not in {message["to"] for message in family.expo.messages}


async def test_deleting_a_child_cancels_its_reminders(family):
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=30)).date().isoformat())
    await log(family, family.space, at=now() - timedelta(hours=1), child_id=child["id"])
    assert {row.kind for row in await rows_of(family, "feed_interval")} == {"feed_interval"}
    response = await family.client.delete(f"{API}/children/{child['id']}?revision={child['revision']}",
                                          headers=records.headers(family.space, generation=1))
    assert response.status_code == 204, response.text
    rows = await rows_of(family)
    assert not [row for row in rows if row.payload.get("child_id") == child["id"]]


async def test_a_record_moved_to_just_me_stops_for_the_other_parent(family):
    """A shared source moved back to its creator's personal space leaves the other parent's reminders."""
    job = await family.client.post(API + "/imports", headers=records.headers(family.space, generation=1),
                                   json={"id": str(uuid4()), "text": "A saved tip"})
    assert job.status_code == 200, job.text
    source = (await family.client.get(f"{API}/records/{job.json()['record_id']}",
                                      headers=records.headers(family.space, generation=1))).json()
    async with family.sessions() as db:
        await triggers.schedule(db, owner="other", space_id=family.space, kind="running_timer", key="stray",
                                due_at=now() - timedelta(minutes=1), payload={"record_id": source["id"]})
        await db.commit()
    moved = await family.client.post(f"{API}/records/{source['id']}/move", headers=records.headers(family.space, generation=1),
                                     json={"space_id": str(family.owner_personal), "revision": source["revision"]})
    assert moved.status_code == 200, moved.text
    assert await due(family, "other", family.space) == []


async def test_data_erasure_clears_everything_of_the_person_and_nobody_elses(family):
    await log(family, family.space, at=now() - timedelta(hours=1))
    await log(family, family.other_personal, "other", at=now() - timedelta(hours=1))
    assert await rows_of(family, actor="other")
    # A client 2 build can erase its personal space while the family stays.
    response = await family.client.delete(
        API + "/data?generation=1",
        headers={"X-Test-Owner": "other", "X-Baby-Client": "2", "X-Baby-Generation": "1"},
    )
    assert response.status_code == 200, response.text
    async with family.sessions() as db:
        for model in (BabyNotification, BabyNotificationPref, BabyPushDevice):
            assert not list(await db.scalars(select(model).where(model.app_user_id == "other")))
        assert list(await db.scalars(select(BabyNotification).where(BabyNotification.app_user_id == "owner")))
    await log(family, family.space, at=now() - LATE)
    await family.worker.tick()
    assert phone("other") not in {message["to"] for message in family.expo.messages}


async def test_erasing_a_family_takes_its_reminders_with_it(baby_api, invites_on):
    api, personal = baby_api, invites_on
    api.settings.baby_push_enabled = True
    await setup_person(api, "owner", personal, feed_interval={"enabled": True, "hours": 3})
    worker = BabyPushWorker(api.sessions, transport=Expo().transport())
    family = UUID((await invites.create(api, personal))["space_id"])
    await log(api, family, at=now() - timedelta(hours=1))
    worker.swept_at = None
    await worker.maintain()
    response = await api.client.delete(f"{API}/family/{family}", headers=records.headers(family, generation=1))
    assert response.status_code == 200, response.text
    async with api.sessions() as db:
        assert list(await db.scalars(select(BabyNotification))) == []
        assert await db.get(BabySpace, family) is None
        assert list(await db.scalars(select(BabyNotificationPref))) != []


async def test_an_older_build_in_a_family_sees_only_its_personal_reminders(family):
    await log(family, family.space, at=now() - LATE)
    await log(family, family.owner_personal, kind="sleep", at=now() - timedelta(hours=5))
    assert await rows_of(family)
    response = await family.client.get(DUE, headers={"X-Baby-Client": "2"})
    assert response.status_code == 200
    assert {item["space_id"] for item in response.json()["items"]} <= {str(family.owner_personal)}


async def test_planning_for_a_family_keeps_change_seq_and_changes_feed_quiet(family):
    await log(family, family.space, at=now() - LATE)
    async with family.sessions() as db:
        before = (await db.get(BabySpace, family.space)).change_seq
    await family.worker.tick()
    assert family.expo.messages
    async with family.sessions() as db:
        assert (await db.get(BabySpace, family.space)).change_seq == before
    response = await family.client.get(API + "/changes", headers=records.headers(family.space, generation=1))
    assert response.status_code == 200 and "baby_notification" not in response.text


async def test_each_person_is_planned_on_their_own_clock_guam_and_new_york(family, monkeypatch):
    """A week starts at 9 AM where each person is; Guam never changes clocks, New York just did."""
    moment = datetime(2026, 11, 1, 5, 0, tzinfo=UTC)
    monkeypatch.setattr(triggers, "now", lambda: moment)
    guam = ZoneInfo("Pacific/Guam")
    york = ZoneInfo("America/New_York")
    response = await family.client.patch(API + "/profile", headers=records.headers(family.other_personal, "other", 1),
                                         json={"timezone": "America/New_York"})
    assert response.status_code == 200, response.text
    first_day = moment.astimezone(guam).date() + timedelta(days=1)
    await add_child(family, family.space, due_date=(first_day + timedelta(days=280 - 37 * 7)).isoformat())
    rows = {row.app_user_id: row.due_at for row in await rows_of(family, "pregnancy_week")}
    assert rows["owner"] == datetime(first_day.year, first_day.month, first_day.day, 9, tzinfo=guam)
    assert rows["other"] == datetime(first_day.year, first_day.month, first_day.day, 9, tzinfo=york)
    assert rows["other"].astimezone(UTC).hour == 14  # 9 AM EST, an hour later in UTC than before the change.


async def test_two_workers_planning_and_sending_at_once_send_each_once(family):
    await log(family, family.space, at=now() - LATE)
    other = BabyPushWorker(family.sessions, transport=family.expo.transport())
    other.swept_at = None
    await asyncio.gather(family.worker.tick(), other.tick())
    await asyncio.gather(family.worker.tick(), other.tick())
    keys = [message["collapseId"] for message in family.expo.messages]
    assert len(keys) == len(set(keys)) == 2


async def test_writes_stay_fast_for_co_members_because_a_plan_holds_no_lock_while_reading(family, monkeypatch):
    """Lock order: planning reads first, unlocked. A log saves while a plan for its space is mid-read."""
    reading, go = asyncio.Event(), asyncio.Event()
    original = triggers.PLANNERS["feed_interval"]

    async def slow(*args):
        reading.set()
        await go.wait()
        return await original(*args)

    monkeypatch.setitem(triggers.PLANNERS, "feed_interval", slow)
    family.worker.people.add("owner")
    plan = asyncio.create_task(family.worker.maintain())
    await asyncio.wait_for(reading.wait(), 5)
    saved = await asyncio.wait_for(log(family, family.space, "other", at=now() - timedelta(minutes=2)), 5)
    assert saved["id"]
    go.set()
    await plan


async def test_a_stuck_person_defers_alone_and_never_blocks_the_rest(family, monkeypatch):
    """A writer holding a person's row: planning waits a bounded time, then that person waits for the sweep."""
    monkeypatch.setattr(push_worker, "LOCK_TIMEOUT", "100ms")
    await log(family, family.space, at=now() - timedelta(hours=1))
    async with family.sessions() as writer:
        await writer.scalar(select(AppUser.id).where(AppUser.id == "other").with_for_update())
        family.worker.people.add("other")
        family.worker.people.add("owner")
        await asyncio.wait_for(family.worker.plan_changed(), 10)
        await writer.rollback()
    await family.worker.maintain()
    assert "owner" in {row.app_user_id for row in await rows_of(family, "feed_interval")}


async def test_membership_row_changes_wake_the_planner(family):
    family.worker.spaces.clear()
    await family.worker.maintain()
    response = await family.client.post(f"{API}/family/{family.space}/leave",
                                        headers=records.headers(family.space, "sitter", 1))
    assert response.status_code == 200, response.text
    assert family.space in family.worker.spaces
