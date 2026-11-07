"""Mixed-patient urgent replies: actual strings, priority and both HTTP Ask paths."""
from uuid import uuid4

import pytest

from app.domains.baby import ask_check, ask_safety, ask_v2, provider
from app.domains.baby.provider import AnswerOutput
from tests import test_baby_integration as shared
from tests.test_baby_ask_v2 import HEADERS, enable, stub  # noqa: F401

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
MATERNAL = "Seek medical care immediately. Please call 911 or go to the nearest emergency room if you are experiencing a medical emergency."
BABY_911 = "Call 911 now. Your baby may be having a life-threatening emergency."
BABY_ER = "Go to the emergency room now for your baby."
BABY_DOCTOR = "Call your baby's doctor now or seek urgent care. If you think your baby has a life-threatening emergency, call 911."
# Leon's three exact reproductions, followed by ten additional phrasings/orders.
CASES = [
    ("I have heavy bleeding and my baby has a fever", "maternal_baby_unwell", MATERNAL, BABY_DOCTOR),
    ("heavy bleeding and the baby has a fever", "maternal_baby_unwell", MATERNAL, BABY_DOCTOR),
    ("Im bleeding a lot and baby is floppy", "maternal_baby_er", MATERNAL, BABY_ER),
    ("I'm bleeding heavily and my baby isn't breathing", "maternal_baby_emergency", BABY_911, MATERNAL),
    ("My baby won't wake up and I have chest pain", "maternal_baby_emergency", BABY_911, MATERNAL),
    ("My newborn looks gray; severe headache", "maternal_baby_emergency", BABY_911, MATERNAL),
    ("My baby has green vomit and I'm bleeding heavily", "maternal_baby_er", MATERNAL, BABY_ER),
    ("Im having chest pain and my baby has a weak cry", "maternal_baby_er", MATERNAL, BABY_ER),
    ("severe headache and baby won't eat", "maternal_baby_unwell", MATERNAL, BABY_DOCTOR),
    ("I have blurry vision and my newborn has a fever", "maternal_baby_unwell", MATERNAL, BABY_DOCTOR),
    ("my baby is floppy and heavy bleeding", "maternal_baby_er", MATERNAL, BABY_ER),
    ("I can't breathe but my baby has a fever", "maternal_baby_unwell", MATERNAL, BABY_DOCTOR),
    ("baby's lips are blue. Im soaking pads", "maternal_baby_emergency", BABY_911, MATERNAL),
]


@pytest.mark.parametrize("question,route,first,second", CASES)
def test_all_thirteen_mixed_phrasings_keep_both_exact_routes_in_priority_order(question, route, first, second):
    result = ask_safety.classify(question)
    assert result.message == first + "\n\n" + second
    assert result.kind == ("baby_unwell" if route == "maternal_baby_emergency" else "urgent_maternal")


@needs_database
@pytest.mark.parametrize("v2", [False, True])
@pytest.mark.parametrize("question,route,first,second", CASES)
async def test_both_ask_paths_keep_both_routes_with_ai_and_consent_off(baby_api, monkeypatch, v2, question, route, first, second):
    monkeypatch.setattr(provider.BabyProvider, "enabled", property(lambda _: False))
    response = await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS,
        json={"request_id": str(uuid4()), "message": question, "ask_v2": v2})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["message"] == first + "\n\n" + second
    assert body["help"] == ("baby_unwell" if route == "maternal_baby_emergency" else "urgent_maternal")
    assert body["citations"] == [] and body["proposal"] is None
    saved = await baby_api.client.get(f"/api/v1/baby/conversations/{body['conversation_id']}", headers=HEADERS)
    assert saved.json()["messages"][-1]["content"] == body["message"]


@needs_database
@pytest.mark.parametrize("v2", [False, True])
@pytest.mark.parametrize("route,first,second", [
    ("maternal_baby_emergency", BABY_911, MATERNAL),
    ("maternal_baby_er", MATERNAL, BABY_ER),
    ("maternal_baby_unwell", MATERNAL, BABY_DOCTOR),
])
async def test_model_question_check_routes_both_people_on_both_paths(baby_api, stub, v2, route, first, second):  # noqa: F811
    await enable(baby_api)
    stub.question_verdict = {"urgent": route}
    response = await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS,
        json={"request_id": str(uuid4()), "message": "Things feel different for both of us", "ask_v2": v2})
    assert response.status_code == 200, response.text
    assert response.json()["message"] == first + "\n\n" + second
    assert response.json()["help"] == ("baby_unwell" if route == "maternal_baby_emergency" else "urgent_maternal")
    assert stub.sent == []  # No generation may replace the fixed guidance.
    assert route in stub.checks[0]["text"]["format"]["schema"]["properties"]["urgent"]["enum"]
    assert "do not discard either" in stub.checks[0]["instructions"]


@pytest.mark.parametrize("question,expected", [
    ("My baby has a fever", BABY_DOCTOR),
    ("My newborn has a temperature. 38.5 C.", BABY_DOCTOR),
    ("My baby has a fever and a temperature of 38.5", BABY_DOCTOR),
    ("My baby is floppy and has a weak cry", BABY_ER),
    ("My baby is not breathing and her lips are blue", BABY_911),
    ("My baby is bleeding", BABY_DOCTOR),
    ("I have heavy bleeding", MATERNAL),
    ("Im bleeding a lot", MATERNAL),
    ("heavy bleeding", MATERNAL),
])
def test_single_patient_and_fragmented_temperature_routes_do_not_acquire_the_other_person(question, expected):
    assert ask_safety.classify(question).message == expected


def test_mixed_labels_are_validated_and_map_to_existing_mobile_help_values():
    for route in ask_safety.MIXED_BABY.values():
        assert AnswerOutput(message="discard", safety=route).safety == route
        assert route in ask_v2.ANSWER_SCHEMA["properties"]["safety"]["enum"]
        assert route in ask_check.QuestionVerdict.model_json_schema()["properties"]["urgent"]["enum"]


async def test_actual_old_generation_prompt_includes_the_shared_mixed_rule(monkeypatch):
    captured = {}
    async def fake_json(self, **kwargs):
        captured.update(kwargs)
        return AnswerOutput(message="Your saved entry.")
    monkeypatch.setattr(provider.BabyProvider, "json_call", fake_json)
    await provider.BabyProvider().answer(message="What did I save?", context=[], history=[], now_local="2026-11-07T12:00:00+10:00")
    assert ask_safety.MIXED_RULE in captured["instructions"]


@pytest.mark.parametrize("question", [
    "baby had a seizure that lasted 6 minutes",
    "baby has purple spots and a fever",
    "baby has a fever and a stiff neck",
    "she had a seizure with her fever",
    "baby is having trouble breathing",
])
def test_r1_fixed_floor_always_keeps_911_fallback(question):
    result = ask_safety.classify(question)
    assert result is not None
    if "doctor" in result.message:
        assert "call 911" in result.message.lower()
        assert result.message == BABY_DOCTOR


@pytest.mark.parametrize("question,expected", [
    ("I'm soaking a pad every hour and baby has a fever", MATERNAL + "\n\n" + BABY_DOCTOR),
    ("im having chest pain and my baby has a fever", MATERNAL + "\n\n" + BABY_DOCTOR),
    ("my baby has a fever and I have chest pain", MATERNAL + "\n\n" + BABY_DOCTOR),
    ("My water broke. My baby is floppy", MATERNAL + "\n\n" + BABY_ER),
    ("I have a terrible headache and blurry vision. Also baby has a fever of 100.5", MATERNAL + "\n\n" + BABY_DOCTOR),
    ("I'm bleeding heavily, and baby has a fever", MATERNAL + "\n\n" + BABY_DOCTOR),
    ("I have chest pain. my baby is floppy", MATERNAL + "\n\n" + BABY_ER),
])
def test_r2_report_mixed_phrasings_preserve_both(question, expected):
    assert ask_safety.classify(question).message == expected


@pytest.mark.parametrize("question,expected", [
    ("My baby is floppy and not breathing", BABY_911),
    ("I have heavy bleeding my baby has fever", MATERNAL + "\n\n" + BABY_DOCTOR),
    ("My baby has a fever I have chest pain", MATERNAL + "\n\n" + BABY_DOCTOR),
    ("My baby is not moving. I am 35 weeks pregnant. My newborn has a fever", MATERNAL + "\n\n" + BABY_DOCTOR),
])
def test_review_findings_keep_patient_fragments_and_fetal_concerns(question, expected):
    assert ask_safety.classify(question).message == expected
