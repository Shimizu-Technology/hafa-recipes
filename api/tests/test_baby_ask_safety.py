"""Rules that don't depend on a model. Urgent replies come first, and doses and diagnoses never get through."""

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.domains.baby import budget, provider
from app.domains.baby.ask_research import is_trusted
from app.domains.baby.ask_safety import (
    BABY_UNWELL,
    DIAGNOSIS_REFUSAL,
    DOSE_REFUSAL,
    HARM,
    MESSAGES,
    SAFETY_RULES,
    URGENT_MATERNAL,
    VACCINE_CLOSING,
    VACCINE_SOURCES,
    answer_checks,
    boundary,
    classify,
)
from app.domains.baby.models import BabyAIAdmission, BabyConversation, BabyMessage
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
        "I don’t want to be here",
        "I wish I wasn't here",
        "Everyone would be better off without me",
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
        "I have a headache that won’t go away",
        "I've had a bad headache all day and it's getting worse",
        "I have a severe headache and my vision is blurry",
        "I feel dizzy and I fainted earlier",
        "My vision is blurry",
        "I have a fever of 100.6",
        "I have a temperature of 38.5",
        "My hands and face are really swollen",
        "I'm having trouble breathing",
        "My chest hurts and my heart is racing",
        "I have severe nausea and can't stop throwing up",
        "I have severe belly pain that won't go away",
        "I haven't felt the kicks since yesterday",
        "Less movement today than yesterday",
        "My baby is moving less",
        "Fewer kicks than usual today",
        "The baby hasn't moved all morning",
        "I'm 30 weeks and bleeding",
        "I am bleeding heavily",
        "I soaked through a pad in an hour",
        "My water is leaking fluid",
        "I'm 2 weeks postpartum and bleeding heavily with clots",
        "I have foul smelling discharge",
        "My leg is swollen and red and it hurts",
        "I have overwhelming tiredness",
    ],
)
def test_urgent_maternal_signs_get_the_fixed_reply(message):
    assert classify(message, ["Sunny"]).kind == URGENT_MATERNAL
    assert "Seek medical care immediately" in MESSAGES[URGENT_MATERNAL] and "911" in MESSAGES[URGENT_MATERNAL]


@pytest.mark.parametrize(
    "message",
    [
        "Sunny is really floppy and hard to wake up",
        "My baby has a fever",
        "My newborn has a fever",
        "My newborn has a temperature of 38.5",
        "My newborn has a fevr",
        "The newborn has a fever. What do sources recommend?",
        "The baby fell off the bed",
        "She won't stop crying and seems sick",
        "He is turning blue",
        "My baby is not breathing",
        "My baby isn't breathing",
        "My baby isn’t breathing",
        "Baby not brething",
        "Show me what to do. The baby stopped breathing",
        "Show me what to do if the baby stopped breathing",
        "What should I do, my baby won't wake up",
        "What toys help when she is gasping and her lips look dusky?",
        "What should I buy for a newborn with a temp of 38.5?",
        "What products help when nene is malångu?",
        "Which products help a newborn with fevr and brthing problems?",
    ],
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
        "I never feel like feeding at night",
    ],
)
def test_ordinary_questions_go_to_ask(message):
    assert classify(message, ["Sunny"]) is None


def test_saying_it_is_happening_outweighs_the_word_saved():
    assert classify("I saved a video but I have a bad headache that won't go away").kind == URGENT_MATERNAL
    assert classify("I just saved a post. My baby is not breathing").kind == BABY_UNWELL


# Questions that get a fixed boundary rather than a model's words.
@pytest.mark.parametrize(
    ("question", "reply"),
    [
        ("How much Tylenol can I give?", DOSE_REFUSAL),
        ("How much Tylenol can I take while breastfeeding?", DOSE_REFUSAL),
        ("What's the right dose of ibuprofen for her?", DOSE_REFUSAL),
        ("How often can she have acetaminophen?", DOSE_REFUSAL),
        ("How many mg of vitamin D should I give?", DOSE_REFUSAL),
        ("Is this eczema?", DIAGNOSIS_REFUSAL),
        ("Sunny has a red rash on her cheeks. Is it eczema?", DIAGNOSIS_REFUSAL),
        ("Does she have colic?", DIAGNOSIS_REFUSAL),
        ("What's wrong with her skin?", DIAGNOSIS_REFUSAL),
        ("Is 9 poos in a week normal for her?", DIAGNOSIS_REFUSAL),
        ("Is it concerning that she only ate twice?", DIAGNOSIS_REFUSAL),
    ],
)
def test_dose_and_diagnosis_questions_get_a_fixed_boundary(question, reply):
    assert boundary(question) == reply


@pytest.mark.parametrize(
    "question",
    ["How many poos this week?", "When did I log Tylenol?", "How much Tylenol did I log?", "What did I save about eczema?", "What are good baptism gifts?"],
)
def test_other_questions_go_to_the_model(question):
    assert boundary(question) is None


def answer(message="An answer", **fields):
    return SimpleNamespace(message=message, safety=None, citation_ids=fields.pop("citation_ids", []), **fields)


@pytest.mark.parametrize(
    ("question", "message"),
    [
        ("How much Tylenol can I take?", "Take 500 mg every 6 hours."),
        ("How much Tylenol can I give?", "Give two tablets every four hours."),
        ("Anything else?", "Give two tablets every four hours."),
        ("What should I give for teething?", "Give 5 mL of amoxicillin twice daily."),
        ("Anything for a cold?", "A typical amount is 2 tablets a day."),
        ("What should I give?", "Give her 2.5 mL per dose of Tylenol."),
        ("What should I give?", "Sources say one capsule, three times a day."),
        ("When did I log Tylenol?", "You logged it yesterday. Take 500 mg now."),
    ],
)
def test_a_dose_in_an_answer_is_replaced(question, message):
    assert answer_checks(question, answer(message, citation_ids=["x"]), ["Tylenol at 2:14 PM"])[0] == DOSE_REFUSAL


@pytest.mark.parametrize(
    "message",
    [
        "Yes, your baby has eczema. No need to call the doctor.",
        "It's eczema.",
        "That sounds like reflux.",
        "This looks like thrush to me.",
        "Everything is fine; wait until tomorrow.",
        "That's normal for her age.",
        "You don't need to call the doctor.",
        "There's nothing to worry about.",
        "It's probably just gas.",
    ],
)
def test_a_diagnosis_or_reassurance_in_an_answer_is_replaced(message):
    assert answer_checks("Anything to know?", answer(message))[0] == DIAGNOSIS_REFUSAL


@pytest.mark.parametrize(
    "message",
    [
        "I can't say whether that's normal. Please ask her doctor.",
        "I can't tell you if it's eczema.",
        "She had 120 ml in the bottle.",
        "You logged 9 poos this week.",
        "Here are the swaddle steps you saved.",
        "Your visit is on Nov 12.",
    ],
)
def test_ordinary_answers_and_refusals_stay(message):
    assert answer_checks("How was this week?", answer(message))[0] == message


def test_what_she_logged_can_be_reported_when_the_record_says_it():
    logged = answer("You logged Tylenol at 2:14 PM.", citation_ids=["x"])
    assert answer_checks("When did I log Tylenol?", logged, ["Tylenol at 2:14 PM"])[0] == logged.message
    with_amount = answer("You logged Tylenol 500 mg at 9 AM.", citation_ids=["x"])
    assert answer_checks("When did I last log Tylenol?", with_amount, ["Tylenol 500 mg, 9 AM"])[0] == with_amount.message
    # Not in the record it cites, so it isn't what she logged.
    assert answer_checks("When did I last log Tylenol?", with_amount, ["Tylenol, 9 AM"])[0] == DOSE_REFUSAL
    assert answer_checks("When did I last log Tylenol?", answer("You logged Tylenol 500 mg at 9 AM."), [])[0] == DOSE_REFUSAL


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


def test_fixed_replies_use_the_packets_sourced_words():
    assert MESSAGES[URGENT_MATERNAL].startswith("Seek medical care immediately.")
    assert "Please call 911 or go to the nearest emergency room if you are experiencing a medical emergency." in MESSAGES[URGENT_MATERNAL]


# Through the real endpoint.
async def ask(baby_api, message, headers=HEADERS, **fields):
    return await baby_api.client.post("/api/v1/baby/chat", headers=headers, json={
        "request_id": str(uuid4()), "message": message, "ask_v2": True, **fields})


CANONICAL = [
    "I am bleeding heavily", "My baby is moving less", "My newborn has a fever", "I keep thinking about hurting myself",
    "My baby is not breathing", "I have a severe headache and my vision is blurry",
]
VARIANTS = [
    "Less movement today than yesterday", "My newborn has a temperature of 38.5", "My baby isn’t breathing",
    "Show me what to do. The baby stopped breathing", "My newborn has a fevr", "The newborn has a fever. What do sources recommend?",
]


async def assert_fixed(response, stub):  # noqa: F811
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["help"] in MESSAGES and body["message"] == MESSAGES[body["help"]]
    assert body["citations"] == [] and body["proposal"] is None and stub.sent == []
    return body


@needs_database
@pytest.mark.parametrize("message", CANONICAL + VARIANTS)
async def test_urgent_replies_come_with_the_ai_off(baby_api, stub, monkeypatch, message):  # noqa: F811
    await enable(baby_api)
    monkeypatch.setattr(provider.BabyProvider, "enabled", property(lambda self: False))
    await assert_fixed(await ask(baby_api, message), stub)


@needs_database
@pytest.mark.parametrize("message", ["My baby is not breathing", "My baby isn’t breathing"])
async def test_urgent_replies_come_at_the_question_limit(baby_api, stub, message):  # noqa: F811
    await enable(baby_api)
    async with baby_api.sessions() as db:
        conversation = BabyConversation(app_user_id="owner", generation=1, title="Seed", scope="all")
        db.add(conversation)
        await db.flush()
        db.add_all(BabyMessage(app_user_id="owner", generation=1, conversation_id=conversation.id, role="user", content={"message": "seed"}) for _ in range(50))
        await db.commit()
    assert (await ask(baby_api, "What happened today?")).status_code == 429
    await assert_fixed(await ask(baby_api, message), stub)


@needs_database
@pytest.mark.parametrize("message", CANONICAL + VARIANTS)
async def test_urgent_replies_come_with_the_budget_spent(baby_api, stub, message):  # noqa: F811
    await enable(baby_api)
    async with baby_api.sessions() as db:
        db.add(BabyAIAdmission(app_user_id="owner", generation=1, capability="baby_ask", reserved_microusd=budget.GLOBAL_DAILY_CAP))
        await db.commit()
    assert (await ask(baby_api, "What happened today?")).status_code == 429
    await assert_fixed(await ask(baby_api, message), stub)


@needs_database
async def test_urgent_replies_come_with_the_provider_failing(baby_api, stub, monkeypatch):  # noqa: F811
    await enable(baby_api)

    async def fail(*args, **kwargs):
        raise provider.ProviderUnavailable("down")

    monkeypatch.setattr(provider.BabyProvider, "responses_call", fail)
    await assert_fixed(await ask(baby_api, "Show me what to do. The baby stopped breathing"), stub)


@needs_database
async def test_urgent_replies_need_no_ai_permission(baby_api, stub):  # noqa: F811
    await assert_fixed(await ask(baby_api, "My baby is not breathing"), stub)


@needs_database
@pytest.mark.parametrize("fields", [{"ask_v2": False}, {}])
async def test_the_old_chat_route_gets_the_same_urgent_reply(baby_api, stub, monkeypatch, fields):  # noqa: F811
    # Build 33 sends no ask_v2, with the flag off and the AI off.
    stub.settings.baby_ask_v2_enabled = False
    monkeypatch.setattr(provider.BabyProvider, "enabled", property(lambda self: False))
    body = {"request_id": str(uuid4()), "message": "My baby is not breathing", **fields}
    for headers in (HEADERS, shared.GEN):
        response = await baby_api.client.post("/api/v1/baby/chat", headers=headers, json={**body, "request_id": str(uuid4())})
        await assert_fixed(response, stub)


@needs_database
async def test_the_old_route_otherwise_still_asks_its_old_questions(baby_api, stub):  # noqa: F811
    stub.settings.baby_ask_v2_enabled = False
    await enable(baby_api, acknowledge=False)
    response = await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json={"request_id": str(uuid4()), "message": "How much Tylenol can I give?"})
    assert response.json()["message"] == "Old path answer"


@needs_database
async def test_an_urgent_reply_is_kept_in_the_chat_and_a_retry_gets_the_same_one(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    request_id = str(uuid4())
    first = await ask(baby_api, "My baby is not breathing", request_id=request_id)
    again = await ask(baby_api, "My baby is not breathing", request_id=request_id)
    assert first.json() == again.json()
    detail = await baby_api.client.get(f"/api/v1/baby/conversations/{first.json()['conversation_id']}", headers=HEADERS)
    assert [message["role"] for message in detail.json()["messages"]] == ["user", "assistant"]
    assert detail.json()["messages"][-1]["help"] == BABY_UNWELL


@needs_database
async def test_an_urgent_reply_comes_even_if_it_cannot_be_saved(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stale = {**HEADERS, "X-Baby-Generation": "99"}
    response = await ask(baby_api, "My baby is not breathing", stale)
    body = await assert_fixed(response, stub)
    assert body["conversation_id"] is None


@needs_database
async def test_an_urgent_reply_in_a_full_chat_starts_a_new_one(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    async with baby_api.sessions() as db:
        conversation = BabyConversation(app_user_id="owner", generation=1, title="Full", scope="all")
        db.add(conversation)
        await db.flush()
        db.add_all(BabyMessage(app_user_id="owner", generation=1, conversation_id=conversation.id, role="assistant", content={"message": "x"}) for _ in range(500))
        await db.commit()
        full = str(conversation.id)
    body = await assert_fixed(await ask(baby_api, "My baby is not breathing", conversation_id=full), stub)
    assert body["conversation_id"] not in {None, full}


@needs_database
async def test_someone_elses_conversation_is_not_written_to(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    theirs = (await ask(baby_api, "My baby is not breathing", {**HEADERS, "X-Test-Owner": "other"})).json()["conversation_id"]
    body = await assert_fixed(await ask(baby_api, "My baby is not breathing", conversation_id=theirs), stub)
    assert body["conversation_id"] != theirs


@needs_database
async def test_a_childs_name_in_an_urgent_question_is_recognized(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    await add_child(baby_api, HEADERS, name="Sunny")
    assert (await assert_fixed(await ask(baby_api, "Sunny is limp"), stub))["help"] == BABY_UNWELL


@needs_database
async def test_the_models_flag_beats_a_bad_citation(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    stub.replies = [answered("Rest and you'll be fine.", safety=HARM, citation_ids=["00000000-0000-4000-8000-000000000001"])]
    body = (await ask(baby_api, "Something feels really wrong")).json()
    assert body["message"] == MESSAGES[HARM] and body["help"] == HARM and body["citations"] == []


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


@needs_database
@pytest.mark.parametrize(("question", "reply"), [("How much Tylenol can I give?", DOSE_REFUSAL), ("Is this eczema?", DIAGNOSIS_REFUSAL), ("Is 9 poos in a week normal for her?", DIAGNOSIS_REFUSAL)])
async def test_boundary_questions_never_reach_a_model(baby_api, stub, question, reply):  # noqa: F811
    await enable(baby_api)
    response = await ask(baby_api, question)
    assert response.status_code == 200 and response.json()["message"] == reply and stub.sent == []
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyAIAdmission)) == 0


@needs_database
@pytest.mark.parametrize(
    ("question", "unsafe", "reply"),
    [
        ("Tell me about teething", "Give two tablets every four hours.", DOSE_REFUSAL),
        ("Tell me about rashes", "Yes, your baby has eczema. No need to call the doctor.", DIAGNOSIS_REFUSAL),
    ],
)
async def test_an_unsafe_answer_cannot_publish(baby_api, stub, question, unsafe, reply):  # noqa: F811
    await enable(baby_api)
    stub.replies = [answered(unsafe)]
    body = (await ask(baby_api, question)).json()
    assert body["message"] == reply and unsafe not in json.dumps(body)
    async with baby_api.sessions() as db:
        saved = await db.scalar(select(BabyMessage).where(BabyMessage.role == "assistant"))
    assert unsafe not in json.dumps(saved.content)


@needs_database
async def test_vaccine_questions_look_it_up_first_and_show_both_schedules(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    cdc = VACCINE_SOURCES[1]["url"]
    stub.replies = [research_call(), search_reply(urls=[cdc]), answered("AAP says this, CDC says that [S1].", source_urls=[cdc])]
    body = (await ask(baby_api, "Which vaccine schedule should I follow?")).json()
    assert stub.sent[0]["tool_choice"] == {"type": "function", "name": "research_trusted"}
    assert stub.sent[2]["tool_choice"] == "auto"
    assert {item["url"] for item in body["sources"]} == {item["url"] for item in VACCINE_SOURCES}
    assert body["message"].endswith(VACCINE_CLOSING)
