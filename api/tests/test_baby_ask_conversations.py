"""Renaming and deleting conversations. Delete removes the messages from the server, not just the list."""

import json
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app.domains.baby import ask_gate, chat, provider
from app.domains.baby.models import BabyConversation, BabyMembership, BabyMessage
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests import test_baby_integration as shared
from tests.test_baby_ask_tools import HEADERS, OTHER, add
from tests.test_baby_ask_v2 import answered, enable, stub, tool_call  # noqa: F401

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


# "Ask about this": a focus the first round has to read, and suggestions that only ever wait for review.
async def ask_focus(baby_api, **fields):
    return await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json={
        "request_id": str(uuid4()), "message": "Tell me about this", "ask_v2": True, **fields})


async def test_a_focused_entry_is_read_first_and_named(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    post = await add(baby_api, HEADERS, kind="source", title="Latch", data={"source_text": "nursing"})
    stub.replies = [tool_call("open_entry", json.dumps({"record_id": post})), answered("About the latch", citation_ids=[post])]
    response = await ask_focus(baby_api, record_id=post)
    assert response.status_code == 200, response.text
    assert stub.sent[0]["tool_choice"] == {"type": "function", "name": "open_entry"}
    assert json.loads(stub.sent[0]["input"][0]["content"])["focus"] == {"kind": "entry", "record_id": post}
    assert stub.sent[1]["tool_choice"] == "auto"
    assert response.json()["citations"][0]["id"] == post


async def test_a_focused_day_reads_that_days_log_first(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [tool_call("day_log", json.dumps({"date": "2026-11-03", "child_id": None})), answered("A quiet day")]
    response = await ask_focus(baby_api, focus_date="2026-11-03")
    assert response.status_code == 200, response.text
    assert stub.sent[0]["tool_choice"] == {"type": "function", "name": "day_log"}
    assert json.loads(stub.sent[0]["input"][0]["content"])["focus"] == {"kind": "day", "date": "2026-11-03"}


async def test_a_focused_category_comes_with_its_members(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    member = await add(baby_api, HEADERS, kind="source", title="Swaddle", data={"source_text": "wrap"})
    outside = await add(baby_api, HEADERS, kind="source", title="Other", data={"source_text": "other"})
    category = await add(baby_api, HEADERS, kind="collection", title="Sleep", data={"record_ids": [member]})
    stub.replies = [tool_call("open_entry", json.dumps({"record_id": category})), answered("One post", citation_ids=[member])]
    response = await ask_focus(baby_api, record_id=category)
    assert response.status_code == 200, response.text
    found = json.loads(stub.sent[1]["input"][-1]["output"])["untrusted_data"]
    assert [item["id"] for item in found["members"]] == [member] and outside not in json.dumps(found)
    assert response.json()["citations"][0]["id"] == member


async def test_someone_elses_entry_cannot_be_the_focus(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    theirs = await add(baby_api, OTHER, kind="source", title="Theirs", data={"source_text": "x"})
    response = await ask_focus(baby_api, record_id=theirs)
    assert response.status_code == 404 and stub.sent == []


async def test_a_retry_without_a_focus_still_matches_older_questions(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    identifier = str(uuid4())
    body = {"request_id": identifier, "message": "How was today?", "ask_v2": False}
    assert (await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json=body)).status_code == 200
    # The same question sent again through the new Ask is the same question.
    again = await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json={**body, "ask_v2": True})
    assert again.status_code == 200 and again.json()["message"] == "Old path answer"


EVENT = {
    "kind": "event", "title": "Well visit", "body": "", "occurred_at": "2026-11-12T09:30:00+10:00",
    "data": {"timezone": "Pacific/Guam", "all_day": False, "end": None, "category": None, "location": None},
}


@pytest.mark.parametrize(
    "proposal",
    [
        EVENT,
        {"kind": "question", "title": "Ask about the rash", "body": "", "data": {}},
        {"kind": "journal", "title": "Today", "body": "A draft", "data": {}},
    ],
)
async def test_each_kind_of_suggestion_waits_for_review_and_nothing_saves(baby_api, stub, proposal):  # noqa: F811
    await enable(baby_api)
    stub.replies = [answered("Here is a suggestion", proposal=proposal)]
    before = (await baby_api.client.get("/api/v1/baby/records", headers=HEADERS)).json()["total"]
    response = await ask_focus(baby_api)
    assert response.status_code == 200, response.text
    assert response.json()["proposal"]["title"] == proposal["title"]
    if proposal["kind"] == "event":
        assert response.json()["proposal"]["occurred_at"].startswith("2026-11-12T09:30")
    assert (await baby_api.client.get("/api/v1/baby/records", headers=HEADERS)).json()["total"] == before
    detail = await baby_api.client.get(f"{URL}/{response.json()['conversation_id']}", headers=HEADERS)
    assert detail.json()["messages"][-1]["proposal"]["kind"] == proposal["kind"]


@pytest.mark.parametrize(
    "proposal",
    [
        {**EVENT, "data": {**EVENT["data"], "recurrence": {"frequency": "daily", "interval": 1}}},
        {**EVENT, "data": {**EVENT["data"], "attachment_ids": [str(uuid4())]}},
        {**EVENT, "occurred_at": "soon"},
        {**EVENT, "child_id": str(uuid4())},
        {"kind": "routine", "title": "Reminder", "body": "", "data": {"routine_type": "schedule", "items": [], "enabled": True, "repeat": "daily"}},
        {"kind": "feeding", "title": "Fed", "body": "", "data": {}},
        {"kind": "question", "title": "Clinician said", "body": "", "data": {"provenance": "clinician_instruction"}},
        {"kind": "question", "title": "x", "body": "", "data": {}, "occurred_at": "2026-11-12T09:30:00+10:00"},
    ],
)
async def test_a_suggestion_outside_the_rules_is_left_out_and_the_answer_stays(baby_api, stub, proposal):  # noqa: F811
    await enable(baby_api)
    stub.replies = [answered("Here is the answer", proposal=proposal)]
    response = await ask_focus(baby_api)
    assert response.status_code == 200, response.text
    assert response.json()["proposal"] is None and response.json()["message"] == "Here is the answer"


async def test_the_old_path_still_cannot_suggest_an_event(baby_api, stub):  # noqa: F811
    from app.domains.baby.chat import reviewed_proposal

    with pytest.raises(ValueError):
        reviewed_proposal(EVENT)


CHECKLIST = {"kind": "routine", "title": "Hospital bag", "body": "", "data": {"routine_type": "checklist", "items": [{"id": "a", "label": "Robe", "done": False}], "enabled": False, "repeat": "none"}}


async def on_the_old_path(baby_api, stub, proposal):  # noqa: F811
    await enable(baby_api, acknowledge=False)
    real = stub.handler

    def medical(request):
        response = real(request)
        reply = response.json()
        reply["choices"][0]["message"]["content"] = json.dumps({"message": "Old answer", "citation_ids": [], "proposal": proposal})
        return httpx.Response(200, json=reply)

    stub.handler = medical
    response = await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json={"request_id": str(uuid4()), "message": "Suggest a plan"})
    assert response.status_code == 200, response.text
    return response.json()


# Ask doesn't propose routines or checklists in this release, whatever they say.
ROUTINES = [
    CHECKLIST,
    {**CHECKLIST, "title": "Feed baby at 8am, noon and 4pm"},
    {**CHECKLIST, "title": "Insulin at breakfast and bedtime"},
]


@pytest.mark.parametrize("proposal", ROUTINES)
async def test_ask_never_proposes_a_routine_on_the_new_path(baby_api, stub, proposal):  # noqa: F811
    await enable(baby_api)
    stub.replies = [answered("Here is the answer", proposal=proposal)]
    body = (await ask_focus(baby_api)).json()
    assert body["proposal"] is None and body["message"] == "Here is the answer"


@pytest.mark.parametrize("proposal", ROUTINES)
async def test_ask_never_proposes_a_routine_on_the_old_path(baby_api, stub, proposal):  # noqa: F811
    body = await on_the_old_path(baby_api, stub, proposal)
    assert body["proposal"] is None and body["message"] == "Old answer"


def test_no_prompt_offers_a_routine_any_more():
    from app.domains.baby import ask_v2

    assert "routine" not in ask_v2.BASE_INSTRUCTIONS and "checklist" not in ask_v2.BASE_INSTRUCTIONS
    source = Path(provider.__file__).read_text()
    assert "editable checklists" not in source and "A routine proposal data" not in source


# Every field a model writes gets the same checks as its answer.
JOURNAL = {"kind": "journal", "title": "Today", "body": "A draft", "data": {}}
QUESTION = {"kind": "question", "title": "Ask about the rash", "body": "", "data": {}}


@pytest.mark.parametrize(
    "proposal",
    [
        {**JOURNAL, "body": "Take two tablets every four hours."},
        {**JOURNAL, "title": "Give 5 mL of Tylenol"},
        {**JOURNAL, "body": "Feed baby at 8am, noon and 4pm"},
        {**JOURNAL, "body": "Insulin at breakfast and bedtime"},
        {**JOURNAL, "body": "It sounds like eczema, no need to call."},
        {**JOURNAL, "body": "Toma dos tabletas cada cuatro horas para la fiebre."},
        {**QUESTION, "body": "Should she get one and a half teaspoons?"},
        {**QUESTION, "title": "This looks like thrush"},
        {**EVENT, "title": "Insulin at breakfast"},
        {**EVENT, "body": "Feed baby at 8am, noon and 4pm"},
        {**EVENT, "data": {**EVENT["data"], "location": "Take two tablets at the clinic"}},
        {**EVENT, "title": "Take 500 mg acetaminophen"},
    ],
)
async def test_every_generated_field_gets_the_medical_checks(baby_api, stub, proposal):  # noqa: F811
    await enable(baby_api)
    stub.replies = [answered("Here is the answer", proposal=proposal)]
    body = (await ask_focus(baby_api)).json()
    assert body["proposal"] is None and body["message"] == "Here is the answer"


@pytest.mark.parametrize("proposal", [JOURNAL, {**JOURNAL, "body": "She slept better after the walk."}, QUESTION, {**QUESTION, "body": "Is vitamin D right for her?"}, EVENT])
async def test_plain_suggestions_still_come_through(baby_api, stub, proposal):  # noqa: F811
    await enable(baby_api)
    stub.replies = [answered("Here is the answer", proposal=proposal)]
    assert (await ask_focus(baby_api)).json()["proposal"]["title"] == proposal["title"]


async def test_a_medical_journal_suggestion_is_dropped_on_the_old_path_too(baby_api, stub):  # noqa: F811
    body = await on_the_old_path(baby_api, stub, {**JOURNAL, "body": "Take two tablets every four hours."})
    assert body["proposal"] is None and body["message"] == "Old answer"


def test_the_mark_on_suggested_routines_is_gone():
    from app.domains.baby.schemas import RoutineData

    with pytest.raises(ValidationError):
        RoutineData.model_validate({"routine_type": "checklist", "items": [], "ai_origin": True})


async def test_her_own_reminders_still_work(baby_api):
    record = {"kind": "routine", "title": "Give Tylenol", "body": "", "id": str(uuid4()), "occurred_at": "2026-11-05T09:00:00+10:00",
              "data": {"routine_type": "schedule", "items": [], "enabled": True, "reminder_at": "2026-11-06T09:00:00+10:00", "timezone": "Pacific/Guam", "repeat": "daily"}}
    saved = await baby_api.client.post("/api/v1/baby/records", headers=HEADERS, json=record)
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["enabled"] is True


# Reopening a day's chat.
async def test_a_days_chat_keeps_its_day_when_reopened(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [tool_call("day_log", json.dumps({"date": "2026-11-03", "child_id": None})), answered("A quiet day")]
    first = (await ask_focus(baby_api, focus_date="2026-11-03")).json()
    detail = (await baby_api.client.get(f"{URL}/{first['conversation_id']}", headers=HEADERS)).json()
    assert detail["focus_date"] == "2026-11-03"
    stub.replies = [tool_call("day_log", json.dumps({"date": "2026-11-03", "child_id": None})), answered("More")]
    # A build that only knows the conversation still gets the day.
    follow = await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json={
        "request_id": str(uuid4()), "message": "And feeds?", "ask_v2": True, "conversation_id": first["conversation_id"]})
    assert follow.status_code == 200, follow.text
    sent = stub.sent[-2]
    assert json.loads(sent["input"][0]["content"])["focus"] == {"kind": "day", "date": "2026-11-03"}
    assert sent["tool_choice"] == {"type": "function", "name": "day_log"}


async def test_a_day_focus_offers_the_day_log_whatever_the_question_says(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [tool_call("day_log", json.dumps({"date": "2026-11-03", "child_id": None})), answered("A quiet day")]
    await ask_focus(baby_api, focus_date="2026-11-03", message="Tell me about this")
    assert "day_log" in {tool["name"] for tool in stub.sent[0]["tools"]}


async def test_an_ordinary_chat_has_no_focus_date(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    identifier = await asked(baby_api)
    assert (await baby_api.client.get(f"{URL}/{identifier}", headers=HEADERS)).json()["focus_date"] is None
