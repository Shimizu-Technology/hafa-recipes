"""Family news: labor and birth, to the people the sender picks in that family, through the ordinary reminder queue."""

from datetime import timedelta
from uuid import uuid4

from sqlalchemy import delete, update

from app.domains.baby.family_news import clock_words
from app.domains.baby.lifecycle import now
from app.domains.baby.models import BabyNotification, BabyPushDevice, BabySpaceMember
from app.domains.baby.reminders import LOCK_SCREEN
from tests import test_baby_family_records as records
from tests import test_baby_push_family as push_family
from tests.test_baby_push_family import API, PREFS, add_child, due, phone, rows_of

# Fixtures, as the family push tests take theirs.
baby_api, enabled, invites_on, family, pytestmark = (
    push_family.baby_api, push_family.enabled, push_family.invites_on, push_family.family, push_family.pytestmark)

NEWS = API + "/family/news"


async def tell(api, child, to, news="labor", actor="owner", space=None, id=None):
    return await api.client.post(NEWS, headers=records.headers(space or api.space, actor, 1),
                                 json={"id": id or str(uuid4()), "news": news, "child_id": child["id"], "to": to})


async def named(api, actor, personal, name):
    response = await api.client.patch(API + "/profile", headers=records.headers(personal, actor, 1), json={"display_name": name})
    assert response.status_code == 200, response.text


async def test_labor_news_reaches_only_who_she_picked_with_generic_lock_screen_words(family):
    await named(family, "owner", family.owner_personal, "Kami")
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=20)).date().isoformat())
    response = await tell(family, child, ["other"])
    assert response.status_code == 200, response.text
    assert response.json()["sent_to"] == ["other"]
    assert [row.app_user_id for row in await rows_of(family, "family_news")] == ["other"]
    await family.worker.tick()
    assert [message["to"] for message in family.expo.messages] == [phone("other")]
    # No name, no baby, no "labor" on a lock screen.
    assert {message["body"] for message in family.expo.messages} == {LOCK_SCREEN["family_news"]}
    assert "Kami" not in LOCK_SCREEN["family_news"]
    [item] = await due(family, "other", family.space)
    assert item["text"] == "Kami: contractions have started."
    assert await due(family, "sitter", family.space) == []
    assert await due(family, "owner", family.space) == []


async def test_a_caregiver_hears_it_only_when_picked(family):
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=20)).date().isoformat())
    assert (await tell(family, child, ["other", "sitter"])).status_code == 200
    assert [item["kind"] for item in await due(family, "sitter", family.space)] == ["family_news"]


async def test_birth_news_says_the_name_and_time_and_labor_news_ends_at_the_birth(family):
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=2)).date().isoformat())
    assert (await tell(family, child, ["other"])).status_code == 200
    born = await family.client.patch(f"{API}/children/{child['id']}", headers=records.headers(family.space, generation=1),
                                     json={"revision": child["revision"], "name": "Mia", "birth_date": now().date().isoformat(),
                                           "details": {"birth_time": "23:40"}})
    assert born.status_code == 200, born.text
    assert born.json()["details"]["birth_time"] == "23:40"
    # The labor ping is over: Today doesn't still say contractions started.
    assert await due(family, "other", family.space) == []
    assert (await tell(family, born.json(), ["other"], news="birth")).status_code == 200
    texts = [item["text"] for item in await due(family, "other", family.space)]
    assert texts == ["Your family: Mia is here! Born at 11:40 PM."]


async def test_birth_news_before_the_birth_date_is_refused_until_it_lands_then_pushed(family):
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=2)).date().isoformat())
    same = str(uuid4())
    early = await tell(family, child, ["other"], news="birth", id=same)
    # Nothing is queued: the phone keeps the news and sends it again once the birth has synced.
    assert early.status_code == 409
    assert early.json()["detail"]["code"] == "not_born"
    assert await rows_of(family, "family_news") == []
    await family.client.patch(f"{API}/children/{child['id']}", headers=records.headers(family.space, generation=1),
                              json={"revision": child["revision"], "birth_date": now().date().isoformat()})
    assert (await tell(family, child, ["other"], news="birth", id=same)).status_code == 200
    await family.worker.tick()
    assert [message["to"] for message in family.expo.messages] == [phone("other")]
    assert [item["text"] for item in await due(family, "other", family.space)] == ["Your family: Mia is here!"]


async def test_a_retry_is_the_same_news_and_a_stuck_button_is_limited(family):
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=20)).date().isoformat())
    same = str(uuid4())
    assert (await tell(family, child, ["other"], id=same)).status_code == 200
    assert (await tell(family, child, ["other"], id=same)).status_code == 200
    assert len(await rows_of(family, "family_news", "other")) == 1
    # The same id with someone added: still the same news. They weren't told, and are named as skipped.
    changed = await tell(family, child, ["other", "sitter"], id=same)
    assert changed.status_code == 200, changed.text
    assert (changed.json()["sent_to"], changed.json()["skipped"]) == (["other"], ["sitter"])
    assert await rows_of(family, "family_news", "sitter") == []
    # Leaving out someone it went to, or other details, is different news under the same id.
    assert (await tell(family, child, ["sitter"], id=same)).status_code == 409
    assert (await tell(family, child, ["other"], news="birth", id=same)).status_code == 409
    for _ in range(5):
        assert (await tell(family, child, ["other"])).status_code == 200
    refused = await tell(family, child, ["other"])
    assert refused.status_code == 429
    assert refused.json()["detail"]["code"] == "news_limit"


async def test_only_family_members_a_parent_and_never_herself(family):
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=20)).date().isoformat())
    # Someone not in the family is named back, not told; nothing goes.
    stranger = await tell(family, child, ["stranger"])
    assert stranger.status_code == 200, stranger.text
    assert (stranger.json()["sent_to"], stranger.json()["skipped"]) == ([], ["stranger"])
    assert (await tell(family, child, ["owner"])).status_code == 422
    assert (await tell(family, child, ["owner"], actor="sitter", space=family.space)).status_code == 409
    assert await rows_of(family, "family_news") == []


async def test_a_baby_in_her_personal_space_has_no_family_to_tell(family):
    personal = await add_child(family, family.owner_personal)
    response = await tell(family, personal, ["other"], space=family.owner_personal)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "no_family"


async def test_on_unless_turned_off_and_gone_after_a_day(family):
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=20)).date().isoformat())
    prefs = await family.client.get(PREFS, headers=records.headers(family.other_personal, "other", 1))
    assert prefs.json()["kinds"]["family_news"] == {"enabled": True, "break_through": True, "hours": None, "feed_hours": None, "sleep_hours": None}
    off = await family.client.patch(PREFS, headers=records.headers(family.other_personal, "other", 1),
                                    json={"kinds": {"family_news": {"enabled": False}}})
    assert off.status_code == 200, off.text
    assert (await tell(family, child, ["other"])).status_code == 200
    assert await due(family, "other", family.space) == []
    await family.client.patch(PREFS, headers=records.headers(family.other_personal, "other", 1),
                              json={"kinds": {"family_news": {"enabled": True}}})
    assert len(await due(family, "other", family.space)) == 1
    async with family.sessions() as db:
        await db.execute(update(BabyNotification).values(payload=BabyNotification.payload.op("||")(
            {"expires_at": (now() - timedelta(minutes=1)).isoformat()})))
        await db.commit()
    assert await due(family, "other", family.space) == []


async def test_the_sender_learns_who_gets_a_notification_and_nothing_else(family):
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=20)).date().isoformat())
    async with family.sessions() as db:
        await db.execute(delete(BabyPushDevice).where(BabyPushDevice.app_user_id == "sitter"))
        await db.commit()
    same = str(uuid4())
    response = await tell(family, child, ["other", "sitter"], id=same)
    assert response.status_code == 200, response.text
    # Yes or no per person: no tokens, phones or settings.
    assert response.json()["push"] == {"other": True, "sitter": False}
    # Turned off counts as no phone, and a retry answers as things are now.
    await family.client.patch(PREFS, headers=records.headers(family.other_personal, "other", 1),
                              json={"kinds": {"family_news": {"enabled": False}}})
    again = await tell(family, child, ["other", "sitter"], id=same)
    assert again.status_code == 200, again.text
    assert again.json()["push"] == {"other": False, "sitter": False}


async def test_everyone_in_the_family_can_see_who_is_expecting(family):
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=20)).date().isoformat())
    assert child["created_by"] == "owner"
    # On her partner's phone, so the labor card never offers to tell her.
    seen = await family.client.get(API + "/bootstrap", headers=records.headers(family.space, "other", 1))
    assert [kid["created_by"] for kid in seen.json()["children"] if kid["id"] == child["id"]] == ["owner"]


async def test_someone_who_left_is_skipped_and_named_and_the_rest_are_told(family):
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=20)).date().isoformat())
    first = str(uuid4())
    assert (await tell(family, child, ["other", "sitter"], id=first)).status_code == 200
    async with family.sessions() as db:
        await db.execute(update(BabySpaceMember).where(BabySpaceMember.app_user_id == "sitter",
                                                       BabySpaceMember.space_id == family.space).values(status="left"))
        await db.commit()
    response = await tell(family, child, ["other", "sitter"])
    assert response.status_code == 200, response.text
    assert (response.json()["sent_to"], response.json()["skipped"]) == (["other"], ["sitter"])
    assert response.json()["push"] == {"other": True}
    news_id = response.json()["id"]
    assert sorted(row.app_user_id for row in await rows_of(family, "family_news") if row.payload["news_id"] == news_id) == ["other"]
    # A retry of the first, sent before she left, is still the same news: nothing changes, and nothing is refused.
    again = await tell(family, child, ["other", "sitter"], id=first)
    assert again.status_code == 200, again.text
    assert (again.json()["sent_to"], again.json()["skipped"]) == (["other", "sitter"], [])


async def test_in_quiet_hours_the_sender_learns_when_it_will_come(family):
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=20)).date().isoformat())
    start, end = (now() - timedelta(hours=1)).strftime("%H:%M"), (now() + timedelta(hours=2)).strftime("%H:%M")
    quiet = await family.client.patch(PREFS, headers=records.headers(family.other_personal, "other", 1), json={
        "quiet_hours": {"start": start, "end": end, "timezone": "UTC"}, "kinds": {"family_news": {"break_through": False}}})
    assert quiet.status_code == 200, quiet.text
    response = await tell(family, child, ["other", "sitter"])
    assert response.status_code == 200, response.text
    assert response.json()["push"] == {"other": "after_quiet_hours", "sitter": True}
    assert set(response.json()["push_after"]) == {"other"}
    assert response.json()["push_after"]["other"][11:16] == end
    # Coming through quiet hours, as it does unless she changed it, it's simply on its way.
    await family.client.patch(PREFS, headers=records.headers(family.other_personal, "other", 1), json={"kinds": {"family_news": {"break_through": True}}})
    assert (await tell(family, child, ["other"])).json()["push"] == {"other": True}


async def test_held_past_the_moment_it_stops_being_news_is_reported_as_not_coming(family):
    child = await add_child(family, family.space, due_date=(now() + timedelta(days=20)).date().isoformat())
    # Quiet from an hour ago until 13 hours from now: labor news is only news for 12 hours.
    start, end = (now() - timedelta(hours=1)).strftime("%H:%M"), (now() + timedelta(hours=13)).strftime("%H:%M")
    await family.client.patch(PREFS, headers=records.headers(family.other_personal, "other", 1), json={
        "quiet_hours": {"start": start, "end": end, "timezone": "UTC"}, "kinds": {"family_news": {"break_through": False}}})
    response = await tell(family, child, ["other"])
    assert response.json()["push"] == {"other": False}
    assert "push_after" not in response.json()


async def test_who_is_expecting_is_her_creator_until_the_family_says_otherwise(family):
    expecting = await add_child(family, family.space, due_date=(now() + timedelta(days=20)).date().isoformat())
    assert (expecting["details"]["expecting_member"], expecting["details"]["expecting_confirmed"]) == ("owner", False)
    born = await add_child(family, family.space, name="Leo", birth_date=now().date().isoformat())
    assert "expecting_member" not in born["details"]

    async def say(actor, details, child=expecting):
        current = (await family.client.get(API + "/bootstrap", headers=records.headers(family.space, actor, 1))).json()
        revision = next(kid["revision"] for kid in current["children"] if kid["id"] == child["id"])
        return await family.client.patch(f"{API}/children/{child['id']}", headers=records.headers(family.space, actor, 1),
                                         json={"revision": revision, "details": details})

    # Her partner says it's her: stored for everyone, confirmed.
    confirmed = await say("other", {"expecting_member": "owner", "expecting_confirmed": True})
    assert confirmed.status_code == 200, confirmed.text
    seen = await family.client.get(API + "/bootstrap", headers=records.headers(family.space, "owner", 1))
    [kid] = [kid for kid in seen.json()["children"] if kid["id"] == expecting["id"]]
    assert (kid["details"]["expecting_member"], kid["details"]["expecting_confirmed"]) == ("owner", True)
    # Only a parent in this family can be the one expecting.
    assert (await say("other", {"expecting_member": "sitter"})).status_code == 422
    assert (await say("other", {"expecting_member": "stranger"})).status_code == 422
    # Saving something else never trips over it, even after who it names has gone.
    assert (await say("owner", {"sex": "girl"})).status_code == 200


async def test_in_her_personal_space_only_she_can_be_expecting(family):
    own = await add_child(family, family.owner_personal, due_date=(now() + timedelta(days=20)).date().isoformat())
    assert own["details"]["expecting_member"] == "owner"
    refused = await family.client.patch(f"{API}/children/{own['id']}", headers=records.headers(family.owner_personal, "owner", 1),
                                        json={"revision": own["revision"], "details": {"expecting_member": "other"}})
    assert refused.status_code == 422


async def test_bootstrap_says_the_api_can_send_it(family):
    response = await family.client.get(API + "/bootstrap", headers=records.headers(family.space, "owner", 1))
    assert response.json()["reminders"]["family_news"] is True


def test_clock_words():
    assert clock_words("00:05") == "12:05 AM"
    assert clock_words("12:00") == "12:00 PM"
    assert clock_words("23:40") == "11:40 PM"
    assert clock_words("nope") is None
    assert clock_words(None) is None
