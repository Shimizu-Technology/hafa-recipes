"""Medical cross-check regressions: fixed routing, prompt capture and explicit release approval."""
from types import SimpleNamespace

import pytest

from app.domains.baby import ask_check, ask_gate, ask_safety, ask_v2, provider
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
    assert ask_safety.REDUCED_MOVEMENT_RULE in captured["instructions"]


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
