"""AAP emergency routes must reach old and V2 clients before consent or a model answer."""
from uuid import uuid4

import pytest

from app.domains.baby import ask_safety, provider
from tests import test_baby_integration as shared
from tests.test_baby_ask_tools import HEADERS
from tests.test_baby_ask_v2 import enable, stub  # noqa: F401

baby_api = shared.baby_api
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
EMERGENCY = "Call 911 now. Your baby may be having a life-threatening emergency."
ER = "Go to the emergency room now for your baby."
DOCTOR = "Call your baby's doctor now or seek urgent care."
CASES = [
    "my baby isn't breathing", "baby's lips are blue", "he won't wake up", "my newborn looks gray",
    "her lips look bluish", "my baby is struggling for each breath", "my newborn is very weak",
    "my baby is grunting with each breath", "my baby is not moving", "baby has a fever. She stopped breathing.",
]


@pytest.mark.parametrize("message", CASES)
def test_emergency_shipped_string_is_911_first(message):
    reply = ask_safety.classify(message)
    assert reply.kind == "baby_unwell"  # Mobile wire compatibility, including builds 34–36.
    assert reply.message == EMERGENCY
    assert "doctor" not in reply.message


@pytest.mark.parametrize("message", ["my newborn is floppy", "baby is vomiting green", "my baby has a weak suck", "she has a strange cry"])
def test_er_signs_do_not_get_a_doctor_first_reply(message):
    assert ask_safety.classify(message).message == ER


@pytest.mark.parametrize("message", ["my baby has a fever", "my baby won't eat"])
def test_other_unwell_signs_keep_the_doctor_now_route(message):
    assert ask_safety.classify(message).message == DOCTOR


@pytest.mark.parametrize("message", ["My baby has blue eyes", "Her blanket is blue", "What does AAP say about blue lips?"])
def test_colors_and_source_lookups_are_not_a_live_emergency(message):
    assert ask_safety.classify(message) is None


@needs_database
@pytest.mark.parametrize("ask_v2", [False, True])
@pytest.mark.parametrize("message", CASES)
async def test_911_first_on_both_paths_even_with_ai_off(baby_api, monkeypatch, ask_v2, message):
    monkeypatch.setattr(provider.BabyProvider, "enabled", property(lambda self: False))
    response = await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json={
        "request_id": str(uuid4()), "message": message, "ask_v2": ask_v2,
    })
    assert response.status_code == 200, response.text
    assert response.json()["message"] == EMERGENCY
    assert response.json()["help"] == "baby_unwell"
    assert response.json()["proposal"] is None and response.json()["citations"] == []


@needs_database
@pytest.mark.parametrize("ask_v2", [False, True])
@pytest.mark.parametrize(("route", "message"), [("baby_emergency", EMERGENCY), ("baby_er", ER), ("baby_unwell", DOCTOR)])
async def test_model_check_route_agrees_without_a_generated_answer(baby_api, stub, ask_v2, route, message):  # noqa: F811
    await enable(baby_api)
    stub.question_verdict = {"urgent": route}
    response = await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json={
        "request_id": str(uuid4()), "message": "Something seems wrong", "ask_v2": ask_v2,
    })
    assert response.status_code == 200, response.text
    assert response.json()["message"] == message and response.json()["help"] == "baby_unwell"
    assert stub.sent == []
