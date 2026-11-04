"""Rules that don't depend on a model: urgent replies are fixed, and doses never get through."""

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.domains.baby.ask_research import is_trusted
from app.domains.baby.ask_safety import (
    BABY_UNWELL,
    DOSE_REFUSAL,
    HARM,
    MESSAGES,
    SAFETY_RULES,
    URGENT_MATERNAL,
    VACCINE_CLOSING,
    VACCINE_SOURCES,
    answer_checks,
    classify,
)
from app.domains.baby.models import BabyAIAdmission, BabyMessage
from tests import test_baby_integration as shared
from tests.test_baby_ask_research import research_call, search_reply
from tests.test_baby_ask_tools import HEADERS, add, add_child
from tests.test_baby_ask_v2 import answered, enable, stub, tool_call  # noqa: F401

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


@pytest.mark.parametrize(
    "message",
    [
        "I keep thinking about hurting myself.",
        "I want to kill myself",
        "Sometimes I have thoughts of harming the baby.",
        "I don't want to wake up anymore",
        "I wish I wasn't here",
        "Is it normal to think about suicide after birth? I saved a video about it",
    ],
)
def test_harm_always_gets_the_numbers(message):
    assert classify(message).kind == HARM
    for number in ("911", "988", "1-833-TLC-MAMA", "1-833-852-6262"):
        assert number in MESSAGES[HARM]


# The packet's 15 CDC signs, in a person's own words.
@pytest.mark.parametrize(
    "message",
    [
        "I have a headache that won't go away",
        "I've had a bad headache all day and it's getting worse",
        "I feel dizzy and I fainted earlier",
        "My vision is blurry",
        "I have a fever of 100.6",
        "My hands and face are really swollen",
        "I'm having trouble breathing",
        "My chest hurts and my heart is racing",
        "I have severe nausea and can't stop throwing up",
        "I have severe belly pain that won't go away",
        "I haven't felt the kicks since yesterday",
        "I'm 30 weeks and bleeding",
        "My water is leaking fluid",
        "I'm 2 weeks postpartum and bleeding heavily with clots",
        "I have foul smelling discharge",
        "My leg is swollen and red and it hurts",
        "I have overwhelming tiredness",
    ],
)
def test_urgent_maternal_signs_get_the_fixed_reply(message):
    assert classify(message, ["Sunny"]).kind == URGENT_MATERNAL
    assert "Seek medical care now" in MESSAGES[URGENT_MATERNAL] and "911" in MESSAGES[URGENT_MATERNAL]


@pytest.mark.parametrize(
    "message",
    ["Sunny is really floppy and hard to wake up", "My baby has a fever", "The baby fell off the bed",
     "She won't stop crying and seems sick", "He is turning blue"],
)
def test_a_sick_or_hurt_baby_gets_call_the_doctor(message):
    assert classify(message, ["Sunny"]).kind == BABY_UNWELL
    assert "baby's doctor" in MESSAGES[BABY_UNWELL] and "911" in MESSAGES[BABY_UNWELL]


@pytest.mark.parametrize(
    "message",
    [
        "How many poos this week?",
        "What did I save about the hospital bag?",
        "How was yesterday?",
        "Which video talks about chest pain?",
        "What are the warning signs of preeclampsia?",
        "Summarize the post about bleeding after birth",
        "When's my next appointment?",
        "What are good baptism gifts?",
        "What did I save about bleeding?",
        "When did she fall asleep?",
        "She fell asleep at 7, how long was the nap?",
        "She stopped crying after the bottle",
        "What was my blood pressure at the visit?",
        "My back hurts me from nursing",
        "The cream hurt her skin? I want to shake the bottle first for the baby",
        "How long until she ended her nap?",
        "What do sources say about fever in babies?",
        "The baby has a blue hat",
    ],
)
def test_ordinary_questions_go_to_ask(message):
    assert classify(message, ["Sunny"]) is None


def test_saying_it_is_happening_outweighs_the_word_saved():
    assert classify("I saved a video but I have a bad headache that won't go away").kind == URGENT_MATERNAL


def answer(message="An answer", **fields):
    return SimpleNamespace(message=message, safety=None, citation_ids=[], **fields)


@pytest.mark.parametrize(
    "message",
    ["Take 500 mg every 6 hours.", "A typical amount is 2 tablets a day.", "Give her 2.5 mL per dose of Tylenol."],
)
def test_a_dose_in_an_answer_is_replaced(message):
    assert answer_checks("How much Tylenol can I take?", answer(message))[0] == DOSE_REFUSAL


def test_a_logged_dose_she_asks_about_can_be_reported():
    logged = SimpleNamespace(message="You logged Tylenol 500 mg at 9 AM.", safety=None, citation_ids=["x"])
    assert answer_checks("When did I last log Tylenol?", logged)[0] == logged.message


def test_bottle_amounts_are_not_doses():
    assert answer_checks("How much did she drink?", answer("She had 120 ml in the bottle."))[0] == "She had 120 ml in the bottle."


def test_a_models_safety_flag_replaces_its_own_words():
    flagged = SimpleNamespace(message="It's probably fine, try resting.", safety=URGENT_MATERNAL, citation_ids=[])
    assert answer_checks("How do I feel better?", flagged) == (MESSAGES[URGENT_MATERNAL], URGENT_MATERNAL, [])


def test_vaccine_answers_get_both_schedules_and_the_doctor():
    message, _, extra = answer_checks("Which vaccine schedule should I follow?", answer("AAP says this; CDC says that."))
    assert message.endswith(VACCINE_CLOSING) and extra == list(VACCINE_SOURCES)
    assert all(is_trusted(item["url"]) for item in extra)
    # Already said once is enough.
    said = answer_checks("Which shots are due?", answer("Ask your pediatrician."))[0]
    assert said == "Ask your pediatrician."


def test_vaccine_rules_hard_code_no_position():
    # The packet says the situation changed, so no date, court, or disagreement is written into code.
    for stale in ("January 2026", "court", "Hepatitis B birth", "disagreed"):
        assert stale not in SAFETY_RULES
    assert "without choosing one" in SAFETY_RULES and "ask the pediatrician" in SAFETY_RULES


def test_maternal_mental_health_adds_the_hotline_and_keeps_the_answer():
    message, kind, _ = answer_checks("I feel so depressed since the birth", answer("Here is what you saved."))
    assert kind == "mental_health" and message.startswith("Here is what you saved.") and "1-833-TLC-MAMA" in message


# Through the real endpoint.
async def ask(baby_api, message):
    return await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json={
        "request_id": str(uuid4()), "message": message, "ask_v2": True})


@needs_database
async def test_urgent_means_no_model_no_cost_and_the_help_screen(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    result = await ask(baby_api, "I have a bad headache that won't go away and my vision is blurry")
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["message"] == MESSAGES[URGENT_MATERNAL] and body["help"] == URGENT_MATERNAL
    assert body["citations"] == [] and body["sources"] == [] and body["proposal"] is None
    assert stub.sent == []
    async with baby_api.sessions() as db:
        assert list(await db.scalars(select(BabyAIAdmission))) == []
    detail = await baby_api.client.get(f"/api/v1/baby/conversations/{body['conversation_id']}", headers=HEADERS)
    assert detail.json()["messages"][-1]["help"] == URGENT_MATERNAL


@needs_database
async def test_a_child_named_in_an_urgent_question_is_recognized(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    await add_child(baby_api, HEADERS, name="Sunny")
    result = await ask(baby_api, "Sunny is limp")
    assert result.json()["help"] == BABY_UNWELL and stub.sent == []


@needs_database
async def test_the_prompt_flag_covers_what_the_patterns_miss(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    post = await add(baby_api, HEADERS, kind="source", title="Latch", data={"source_text": "nursing"})
    stub.replies = [answered("Rest and you'll be fine.", safety=HARM, citation_ids=[post])]
    # An invented citation fails the answer even when it was flagged, as any other would.
    assert (await ask(baby_api, "Everything feels pointless lately")).status_code == 503
    stub.replies = [answered("Rest and you'll be fine.", safety=HARM)]
    body = (await ask(baby_api, "Everything feels pointless lately")).json()
    assert body["message"] == MESSAGES[HARM] and body["help"] == HARM


@needs_database
async def test_vaccine_questions_look_it_up_first_and_show_both_schedules(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    cdc = VACCINE_SOURCES[1]["url"]
    stub.replies = [research_call("What do AAP and CDC recommend for infant vaccines?"), search_reply(urls=[cdc]),
                    answered("AAP says this, CDC says that [S1].", source_urls=[cdc])]
    body = (await ask(baby_api, "Which vaccine schedule should I follow?")).json()
    assert stub.sent[0]["tool_choice"] == {"type": "function", "name": "research_trusted"}
    assert stub.sent[2]["tool_choice"] == "auto"
    assert {item["url"] for item in body["sources"]} == {item["url"] for item in VACCINE_SOURCES}
    assert body["message"].endswith(VACCINE_CLOSING)


@needs_database
async def test_a_tool_is_still_answered_when_a_model_flags_safety_after_reading(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    post = await add(baby_api, HEADERS, kind="source", title="Latch", data={"source_text": "nursing"})
    stub.replies = [tool_call("open_entry", json.dumps({"record_id": post})), answered("Worrying text", safety=URGENT_MATERNAL, citation_ids=[post])]
    body = (await ask(baby_api, "I feel strange")).json()
    assert body["message"] == MESSAGES[URGENT_MATERNAL] and body["citations"] == []
    async with baby_api.sessions() as db:
        saved = await db.scalar(select(BabyMessage).where(BabyMessage.role == "assistant"))
    assert saved.content["citations"] == [] and "Worrying text" not in json.dumps(saved.content)
