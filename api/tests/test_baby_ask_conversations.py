"""Renaming and deleting conversations. Delete removes the messages from the server, not just the list."""

from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.domains.baby import ask_gate, chat, provider
from app.domains.baby.models import BabyConversation, BabyMembership, BabyMessage
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared
from tests.test_baby_ask_tools import HEADERS, OTHER
from tests.test_baby_ask_v2 import answered, enable, stub  # noqa: F401

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark
URL = "/api/v1/baby/conversations"


async def asked(baby_api, headers=HEADERS, message="How was today?"):
    response = await baby_api.client.post("/api/v1/baby/chat", headers=headers, json={
        "request_id": str(uuid4()), "message": message, "ask_v2": True})
    assert response.status_code == 200, response.text
    return response.json()["conversation_id"]


async def message_count(baby_api):
    async with baby_api.sessions() as db:
        return await db.scalar(select(func.count()).select_from(BabyMessage))


async def test_rename_keeps_its_place_and_shows_in_the_list(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    first = await asked(baby_api, message="First question")
    second = await asked(baby_api, message="Second question")
    response = await baby_api.client.patch(f"{URL}/{first}", headers=HEADERS, json={"title": "  Breastfeeding tips  "})
    assert response.status_code == 200 and response.json()["title"] == "Breastfeeding tips"
    items = (await baby_api.client.get(URL, headers=HEADERS)).json()["items"]
    assert [(item["id"], item["title"]) for item in items] == [(second, "Second question"), (first, "Breastfeeding tips")]


@pytest.mark.parametrize("title", ["", "   ", "x" * 101])
async def test_a_title_has_to_be_usable(baby_api, stub, title):  # noqa: F811
    await enable(baby_api)
    identifier = await asked(baby_api)
    assert (await baby_api.client.patch(f"{URL}/{identifier}", headers=HEADERS, json={"title": title})).status_code == 422


async def test_delete_removes_every_message_on_the_server(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    keep = await asked(baby_api, message="Keep this")
    gone = await asked(baby_api, message="Delete this")
    assert await message_count(baby_api) == 4
    assert (await baby_api.client.delete(f"{URL}/{gone}", headers=HEADERS)).status_code == 204
    async with baby_api.sessions() as db:
        assert await db.get(BabyConversation, gone) is None
        rows = list(await db.scalars(select(BabyMessage)))
    assert {str(row.conversation_id) for row in rows} == {keep} and len(rows) == 2
    assert (await baby_api.client.get(f"{URL}/{gone}", headers=HEADERS)).status_code == 404
    assert (await baby_api.client.delete(f"{URL}/{gone}", headers=HEADERS)).status_code == 404


async def test_someone_elses_conversation_cannot_be_renamed_or_deleted(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    identifier = await asked(baby_api)
    assert (await baby_api.client.patch(f"{URL}/{identifier}", headers=OTHER, json={"title": "Mine now"})).status_code == 404
    assert (await baby_api.client.delete(f"{URL}/{identifier}", headers=OTHER)).status_code == 404
    assert await message_count(baby_api) == 2


async def test_these_do_not_exist_with_the_flag_off_or_for_old_builds(baby_api, stub, monkeypatch):  # noqa: F811
    await enable(baby_api)
    identifier = await asked(baby_api)
    assert (await baby_api.client.delete(f"{URL}/{identifier}", headers=shared.GEN)).status_code == 404
    assert (await baby_api.client.patch(f"{URL}/{identifier}", headers=shared.GEN, json={"title": "x"})).status_code == 404
    monkeypatch.setattr(ask_gate, "get_settings", lambda: type("S", (), {"baby_ask_v2_enabled": False})())
    assert (await baby_api.client.delete(f"{URL}/{identifier}", headers=HEADERS)).status_code == 404
    assert await message_count(baby_api) == 2


async def test_an_old_generation_is_refused(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    identifier = await asked(baby_api)
    stale = {**HEADERS, "X-Baby-Generation": "99"}
    assert (await baby_api.client.delete(f"{URL}/{identifier}", headers=stale)).status_code == 409


async def test_deleting_while_an_answer_is_on_its_way_discards_it(baby_api, stub, monkeypatch):  # noqa: F811
    await enable(baby_api)
    identifier = await asked(baby_api)
    real = provider.BabyProvider.responses_call

    async def delete_meanwhile(self, **kwargs):
        reply = await real(self, **kwargs)
        if kwargs["capability"] == "baby_ask":
            assert (await baby_api.client.delete(f"{URL}/{identifier}", headers=HEADERS)).status_code == 204
        return reply

    monkeypatch.setattr(provider.BabyProvider, "responses_call", delete_meanwhile)
    stub.replies = [answered("Too late")]
    response = await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json={
        "request_id": str(uuid4()), "message": "One more", "ask_v2": True, "conversation_id": identifier})
    assert response.status_code == 404
    assert await message_count(baby_api) == 0


async def test_in_a_family_only_the_person_who_asked_can_touch_their_chats(baby_api, family, stub):  # noqa: F811
    async with baby_api.sessions() as db:
        mine = (await db.get(BabyMembership, "owner")).personal_space_id
        theirs = (await db.get(BabyMembership, "other")).personal_space_id
    headers = records.headers(mine, generation=1)
    assert (await baby_api.client.patch("/api/v1/baby/profile", headers=headers, json={
        "ai_consent": True, "acknowledge_ai_consent_version": 1})).status_code == 200
    identifier = await asked(baby_api, headers)
    other = records.headers(theirs, "other", 1)
    assert (await baby_api.client.delete(f"{URL}/{identifier}", headers=other)).status_code == 404
    renamed = await baby_api.client.patch(f"{URL}/{identifier}", headers=headers, json={"title": "Mine"})
    assert renamed.status_code == 200, renamed.text
    assert (await baby_api.client.delete(f"{URL}/{identifier}", headers=headers)).status_code == 204
    assert await message_count(baby_api) == 0


def test_the_routes_are_registered_on_the_chat_router():
    paths = {(route.path, tuple(route.methods)) for route in chat.router.routes}
    assert ("/conversations/{identifier}", ("PATCH",)) in paths and ("/conversations/{identifier}", ("DELETE",)) in paths
