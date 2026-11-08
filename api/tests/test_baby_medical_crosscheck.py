"""Medical cross-check regressions: fixed routing, prompt capture and explicit release approval."""
import json
import re
from types import SimpleNamespace

import pytest

from app.domains.baby import ask_check, ask_gate, ask_safety, ask_tools, ask_v2, provider
from app.domains.baby.provider import AnswerOutput


@pytest.mark.parametrize("audience", [None, "public", "paid", "private_family", "unknown"])
@pytest.mark.parametrize("marker", [None, "", "stale-review"])
def test_flag_and_audience_never_replace_the_review_marker(monkeypatch, audience, marker):
    configured = SimpleNamespace(baby_ask_v2_enabled=True, baby_health_private_users="owner,other", baby_health_release_audience=audience,
                                 baby_health_reviewed_version=marker, baby_ask_clinician_approval="record",
                                 baby_who_chart_permission="record")
    monkeypatch.setattr(ask_gate, "get_settings", lambda: configured)
    assert ask_gate.health_release_allowed("owner") is False and ask_gate.ask_v2_on("owner") is False


def test_private_family_needs_the_exact_current_marker(monkeypatch):
    configured = SimpleNamespace(baby_ask_v2_enabled=True, baby_health_private_users="owner,other", baby_health_release_audience="private_family",
                                 baby_health_reviewed_version=ask_gate.HEALTH_REVIEW_VERSION)
    monkeypatch.setattr(ask_gate, "get_settings", lambda: configured)
    assert ask_gate.ask_v2_on("owner")
    del configured.baby_health_release_audience
    assert not ask_gate.ask_v2_on("owner")  # Even with the marker, an unspecified audience defaults public.


@pytest.mark.parametrize("question,answer", [
    ("do kicks slow down at the end of pregnancy", "Babies often move less near the end of pregnancy because there is less room."),
    ("How about fetal movement?", "Fewer movements are expected as space gets tight."),
    ("What changes in pregnancy?", "Less movement is normal in the last trimester."),
    ("do kicks slow down at the end of pregnancy", "Babies are moving less near the end because there is less room."),
    ("do kicks slow down at the end of pregnancy", "Kicks often slow down late in pregnancy, and that is normal."),
    ("do kicks slow down at the end of pregnancy", "They slow down near the end."),
    ("do kicks slow down at the end of pregnancy", "There is less room."),
    ("do kicks slow down at the end of pregnancy", "It's normal for movements to decrease."),
    ("do kicks slow down at the end of pregnancy", "Nothing to worry about if baby moves less."),
    ("do kicks slow down at the end of pregnancy", "Don't worry if your baby is moving less."),
    ("do kicks slow down at the end of pregnancy", "Kicks slow down. That's normal."),
    ("do kicks slow down at the end of pregnancy", "Kicks slow down, and that's normal."),
    ("do kicks slow down at the end of pregnancy", "Kicks decrease, which is normal."),
    ("do kicks slow down at the end of pregnancy", "Movements decrease, which is expected late in pregnancy."),
    ("do kicks slow down at the end of pregnancy", "Baby moves less; which is completely normal near the end."),
    ("do kicks slow down at the end of pregnancy", "It's normal, but kicks decrease."),
    ("do kicks slow down at the end of pregnancy", "It's normal. Your baby will move less."),
    ("do kicks slow down at the end of pregnancy", "bb movin less rn is ok bc theres less room"),
    ("do kicks slow down at the end of pregnancy", "kicks r slower near ur due date n its normal"),
    ("do kicks slow down at the end of pregnancy", "mvmts decrease late in pregnancy, nbd"),
    ("do kicks slow down at the end of pregnancy", "they slow down near the end so dont worry abt it"),
    ("do kicks slow down at the end of pregnancy", "Babies move less because they're crowded."),
    ("do kicks slow down at the end of pregnancy", "There is less space, so baby is less active."),
    ("How about fetal movement?", "It is not unusual for movements to decrease."),
])
async def test_both_output_paths_stop_movement_reassurance_without_relying_on_the_model(monkeypatch, question, answer):
    assert ask_safety.unsafe_output(question, answer) == ask_safety.MOVEMENT_WARNING
    async def no_check(*args, **kwargs):
        pytest.fail("Code must stop this even if the model check would pass")
    monkeypatch.setattr(ask_check, "check_answer", no_check)
    result = AnswerOutput(message=answer)
    old = await ask_v2.checked_old_answer_reply(None, question, result)
    tools = SimpleNamespace(citable={}, logged={}, notes={}, web_sources=[], research_failed=False)
    new = await ask_v2.checked_answer_reply(None, question, result, tools)
    for published in (old, new):
        assert published["message"].startswith("Baby moving less or stopped? Seek medical care immediately.")
        assert published["help"] == "cant_answer" and published["proposal"] is None
        assert answer not in published["message"]


async def test_actual_old_prompt_contains_the_shared_movement_ban(monkeypatch):
    captured = {}
    async def fake_json(self, capability, **kwargs):
        captured.update(kwargs)
        return AnswerOutput(message="Your saved appointment is on Tuesday.")
    monkeypatch.setattr(provider.BabyProvider, "json_call", fake_json)
    await provider.BabyProvider().answer(message="Do kicks slow down?", context=[], history=[], now_local="2026-11-07T10:00:00+10:00")
    assert "safety:null|a routing label" in captured["instructions"]
    labels = json.loads(re.search(r"Allowed safety labels: (\[[^]]+\])", captured["instructions"])[1])
    assert set(labels) == set(ask_safety.MESSAGES)
    assert "urgent_maternal for a maternal urgent warning sign" in captured["instructions"]
    assert "harm for thoughts of hurting yourself or the baby" in captured["instructions"]
    assert "poisoning for suspected poisoning or accidental overdose" in captured["instructions"]
    assert ask_safety.REDUCED_MOVEMENT_RULE in captured["instructions"]
    assert ask_safety.GENERAL_MOVEMENT_RULE in captured["instructions"]
    assert ask_safety.GENERAL_MOVEMENT_RULE in ask_tools.AskTools.instructions(None, ask_v2.BASE_INSTRUCTIONS)


@pytest.mark.parametrize("question", [
    "I accidentally gave my baby extra Tylenol. How much is okay?",
    "my baby swallowed a button battery", "baby drank bleach", "I took an overdose of my medicine",
])
def test_accidental_overdose_cannot_fall_through_to_a_pharmacist_dose_refusal(question):
    reply = ask_safety.classify(question)
    assert reply and "1-800-222-1222" in reply.message and "call 911 now" in reply.message
    assert "pharmacist" not in reply.message


def test_actual_unconfigured_settings_default_to_public_and_no_review(monkeypatch):
    from app.config import Settings
    monkeypatch.delenv("BABY_HEALTH_RELEASE_AUDIENCE", raising=False)
    monkeypatch.delenv("BABY_HEALTH_REVIEWED_VERSION", raising=False)
    configured = Settings(_env_file=None, database_url="postgresql://localhost/health_test", openai_api_key="test-key", baby_ask_v2_enabled=True)
    assert configured.baby_health_release_audience == "public" and configured.baby_health_reviewed_version == ""
    monkeypatch.setattr(ask_gate, "get_settings", lambda: configured)
    assert not ask_gate.health_release_allowed("owner") and not ask_gate.ask_v2_on("owner")


def test_parent_distress_has_support_routes_without_a_diagnosis_or_unconditional_911():
    reply = ask_safety.classify("I don't want to be a mom anymore")
    assert reply and reply.kind == ask_safety.HARM
    assert reply.message.startswith(ask_safety.CALL_911)
    assert "988" in reply.message and "1-833" in reply.message
    assert "if" in reply.message.lower() and "depression" not in reply.message


@pytest.mark.parametrize("question", ["could this be preeclampsia", "Might it mean an infection?", "Can that indicate sepsis?"])
async def test_personal_condition_questions_refuse_before_the_old_model_check(monkeypatch, question):
    assert ask_safety.boundary(question) == ask_safety.DIAGNOSIS_REFUSAL
    async def no_model(*args, **kwargs):
        pytest.fail("The known personal condition pattern must not need a model")
    monkeypatch.setattr(ask_v2, "question_reply", no_model)
    reply = await ask_v2.old_path_reply(None, question)
    assert reply["help"] == "cant_answer" and reply["proposal"] is None
    assert reply["message"] == ask_safety.cant_answer(ask_safety.DIAGNOSIS_REFUSAL)


@pytest.mark.parametrize("question", ["What is preeclampsia?", "Could this be organized by date?", "What did my doctor write about preeclampsia?"])
def test_general_definitions_organization_and_record_lookup_are_not_personal_diagnoses(question):
    assert ask_safety.boundary(question) is None


@pytest.mark.parametrize("listed,actor,expected", [("", "owner", False), ("other", "owner", False),
    ("owner", None, False), ("owner", "owner", True), ("owner", "clerk-owner", False)])
def test_private_audience_is_a_real_actor_allowlist(monkeypatch, listed, actor, expected):
    configured = SimpleNamespace(baby_health_release_audience="private_family", baby_health_reviewed_version=ask_gate.HEALTH_REVIEW_VERSION,
                                 baby_health_private_users=listed)
    monkeypatch.setattr(ask_gate, "get_settings", lambda: configured)
    assert ask_gate.health_release_allowed(actor) is expected


@pytest.mark.parametrize("message", ["I accidentally forgot my prenatal vitamin", "I accidentally missed my medicine"])
def test_forgotten_medicine_is_not_poisoning(message):
    assert ask_safety.classify(message) is None


@pytest.mark.parametrize("answer", [
    "Babies do not move less because of less room. Fewer kicks are normal near the end of pregnancy.",
    "Babies do not move less, but fewer movements are expected late in pregnancy.",
    "Babies do not move less and fewer kicks are normal near the end of pregnancy.",
])
def test_one_negated_movement_claim_does_not_excuse_another_unsafe_claim(answer):
    assert ask_safety.unsafe_output("How do kicks change?", answer) == ask_safety.MOVEMENT_WARNING


async def test_old_answer_publishes_the_vaccine_closing_and_sources_even_without_a_help_kind(monkeypatch):
    async def checked(*args, **kwargs):
        return SimpleNamespace(states_dose=False, diagnoses=False, discourages_care=False)
    monkeypatch.setattr(ask_check, "check_answer", checked)
    reply = await ask_v2.checked_old_answer_reply(None, "What do sources say about vaccines?", AnswerOutput(message="Ask can show the published positions."))
    assert reply["message"].endswith("Your baby's doctor can tell you what's due.")
    assert reply["help"] is None and reply["sources"] == list(ask_safety.VACCINE_SOURCES)


@pytest.mark.parametrize("value,normalized,allowed", [
    ("private_family", "private_family", True), ("private-family", "private_family", True),
    ("  PRIVATE-FAMILY  ", "private_family", True), ("public", "public", False),
    ("paid", "paid", False), ("", "disabled", False), ("privte-family", "disabled", False),
    ("unknown", "disabled", False), (None, "disabled", False),
])
def test_real_settings_audience_alias_and_invalid_values_do_not_stop_shared_api(monkeypatch, value, normalized, allowed):
    from app.config import Settings
    configured = Settings(_env_file=None, database_url="postgresql://localhost/health_test", openai_api_key="test-key",
                          baby_health_release_audience=value, baby_health_reviewed_version=ask_gate.HEALTH_REVIEW_VERSION,
                          baby_health_private_users="owner", baby_ask_v2_enabled=True)
    assert configured.baby_health_release_audience == normalized
    monkeypatch.setattr(ask_gate, "get_settings", lambda: configured)
    assert ask_gate.health_release_allowed("owner") is allowed
    assert ask_gate.ask_v2_on("owner") is allowed
    assert not ask_gate.health_release_allowed("other")


@pytest.mark.parametrize("route", ["maternal_poisoning", "baby_emergency_poisoning", "maternal_baby_emergency_poisoning",
                                    "maternal_baby_er_poisoning", "maternal_baby_unwell_poisoning"])
def test_poison_composites_are_supported_by_checks_and_generated_safety_schemas(route):
    assert AnswerOutput(message="discard", safety=route).safety == route
    assert route in ask_check.QuestionVerdict.model_json_schema()["properties"]["urgent"]["enum"]
    assert route in ask_v2.ANSWER_SCHEMA["properties"]["safety"]["enum"]
    assert "1-800-222-1222" in ask_safety.MESSAGES[route]


async def test_general_movement_education_passes_both_output_paths_with_conditional_urgent_warning(monkeypatch):
    answer = "Your baby's usual movement pattern matters. If your baby is moving less or has stopped, seek medical care immediately."
    async def checked(*args, **kwargs):
        return SimpleNamespace(states_dose=False, diagnoses=False, discourages_care=False)
    monkeypatch.setattr(ask_check, "check_answer", checked)
    question = "do kicks slow down at the end of pregnancy"
    assert ask_safety.classify(question) is None
    assert ask_safety.boundary(question) is None
    result = AnswerOutput(message=answer, safety=None)
    tools = SimpleNamespace(citable={}, logged={}, notes={}, web_sources=[], research_failed=False)
    assert await ask_v2.checked_old_answer_reply(None, question, result) is None  # The old caller keeps its checked draft.
    published = await ask_v2.checked_answer_reply(None, question, result, tools)
    assert published["message"] == answer
    assert published["help"] is None
    assert not published.get("replaced")
    # An actual decrease remains urgent; a general-topic instruction cannot turn it into education.
    assert ask_safety.classify("my baby's kicks are slower today").kind == ask_safety.URGENT_MATERNAL


@pytest.mark.parametrize("question,route", [
    ("I'm 12 weeks postpartum and my baby isn't moving", "baby_emergency"),
    ("I'm 12 weeks after giving birth and my baby isn't moving", "baby_emergency"),
    ("she kicked a bit then stopped and now she isn't moving", "baby_emergency"),
    ("My baby is 12 weeks old and isn't moving", "baby_emergency"),
    ("I am 35 weeks and my baby isn't moving", "maternal_baby_emergency"),
    ("I'm 35 weeks pregnant and my baby isn't moving", "urgent_maternal"),
    ("I am pregnant and my newborn isn't moving", "baby_emergency"),
    ("I'm pregnant. My toddler is in bed. She isn't moving", "baby_emergency"),
    ("I'm pregnant and my newborn is on my lap. He isn't moving", "baby_emergency"),
    ("My toddler is in bed. I'm pregnant. Now she isn't moving", "baby_emergency"),
    ("My baby is not moving. I'm pregnant. My toddler is in bed. She isn't moving", "maternal_baby_emergency"),
    ("My toddler is in bed. I'm pregnant. My unborn baby is not moving", "urgent_maternal"),
    ("I'm pregnant. My toddler is in bed. I'm bleeding heavily. She isn't moving", "maternal_baby_emergency"),
    ("I'm pregnant. My toddler is not moving", "baby_emergency"),
    ("Im pregnant and my toddler isn't moving", "baby_emergency"),
    ("I'm pregnant. My 2 year old is not moving", "baby_emergency"),
    ("I'm pregnant and my toddler is moving less", "baby_er"),
    ("My baby is not moving. I'm 35 weeks pregnant. My toddler isn't moving", "maternal_baby_emergency"),
    ("I am bleeding heavily 12 weeks postpartum and my baby isn't moving", "maternal_baby_emergency"),
    ("I'm pregnant. My baby is due to be born soon. She isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My baby will be born next month. He isn't moving", 'urgent_maternal'),
    ("My baby is expected to be born next week. She isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My baby isn't born yet. She isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My baby has not been born yet. He isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My baby is not yet born. She isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My baby is going to be born soon. She isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My toddler is in bed. My baby is due to be born soon. She isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My baby is due to be born soon. She isn't moving. My toddler is not moving", 'maternal_baby_emergency'),
    ("I'm pregnant. My newborn was born soon after her due date. She isn't moving", 'baby_emergency'),
    ("My baby will\tbe born soon. She isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My baby is due to be\nborn soon. She isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My baby was not born prematurely. He isn't moving", "baby_emergency"),
    ("My baby was born yesterday. She was scheduled to be born next week. She isn't moving", 'baby_emergency'),
    ("My baby was born two days ago. He wasn't expected to be born until next month. He isn't moving", 'baby_emergency'),
    ("I'm pregnant. My newborn was born last week. My unborn baby is due to be born next month. She isn't moving", 'urgent_maternal'),
    ("My baby was born yesterday. My baby was scheduled to be born next week. She isn't moving", 'baby_emergency'),
    ("My baby was born two days ago. My baby wasn't expected to be born until next month. He isn't moving", 'baby_emergency'),
    ("My baby was born yesterday. My baby was scheduled to be born next week. My baby isn't moving", 'baby_emergency'),
    ("I'm pregnant. My baby was born yesterday. My baby was scheduled to be born next week. She isn't moving", 'baby_emergency'),
    ("My baby was due to be born last week. She isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My newborn was born last week. My unborn baby was due to be born yesterday. She isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My baby hasn't been born. She isn't moving", 'urgent_maternal'),
    ("My baby has not been born and she isn't moving", 'urgent_maternal'),
    ("My baby isn't born. He isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My baby was born yesterday. My baby was scheduled to be born next week. My baby isn't moving", 'baby_emergency'),
    ("I'm pregnant. My toddler is in bed. My baby isn't moving", 'urgent_maternal'),
    ("I'm pregnant. My baby was born yesterday. My baby has not been born prematurely. My baby isn't moving", 'baby_emergency'),
    ("My baby was born yesterday. My baby was supposed to be born next week. My baby isn't moving", 'baby_emergency'),
    ("My toddler was born two years ago. My baby was due to be born last week. She isn't moving", 'urgent_maternal'),
])
def test_movement_context_never_downgrades_born_or_ambiguous_baby_emergencies(question, route):
    reply = ask_safety.classify(question)
    assert reply.kind == ask_safety.help_kind(route)
    assert reply.message == ask_safety.MESSAGES[route]
    if "baby_emergency" in route:
        assert reply.message.startswith("Call 911 now.")


@pytest.mark.parametrize("question,answer", [
    ("do kicks slow down at the end of pregnancy", "If your baby is moving less or has stopped, seek medical care immediately."),
    ("do kicks slow down at the end of pregnancy", "If kicks slow down near the end, seek medical care immediately."),
    ("do kicks slow down at the end of pregnancy", "Movements should not decrease near the end of pregnancy."),
    ("do kicks slow down at the end of pregnancy", "They do not slow down near the end. Seek care immediately for fewer kicks."),
    ("do kicks slow down at the end of pregnancy", "Babies don't move less because of less room."),
    ("do kicks slow down at the end of pregnancy", "It is not expected for movements to decrease. Seek care immediately if this happens."),
    ("do kicks slow down at the end of pregnancy", "Less room doesn't mean fewer kicks."),
    ("How can I organize a small nursery?", "There is less room in a small closet, so use labels."),
    ("What is fetal movement?", "Hiccups are common. If your baby moves less, seek medical care immediately."),
])
def test_movement_floor_keeps_conditional_warnings_negations_and_unrelated_room_text(question, answer):
    assert ask_safety.unsafe_output(question, answer) is None


def test_question_and_generation_schema_routes_match_the_fixed_reply_catalog():
    labels = set(ask_safety.MESSAGES)
    assert set(ask_check.QuestionVerdict.model_json_schema()["properties"]["urgent"]["enum"]) == labels | {"none"}
    assert set(ask_v2.ANSWER_SCHEMA["properties"]["safety"]["enum"]) == labels | {None}
    for label in labels:
        assert AnswerOutput(message="fixed", safety=label).safety == label


def test_safe_movement_negation_keeps_the_existing_diagnosis_floor():
    # The movement floor must not reinterpret a negated claim as reassurance.
    # "Not normal" still hits the separate, pre-existing diagnosis protection.
    assert ask_safety.unsafe_output(
        "do kicks slow down at the end of pregnancy",
        "It is not normal for movements to decrease. Seek care immediately if this happens.",
    ) == ask_safety.DIAGNOSIS_REFUSAL
