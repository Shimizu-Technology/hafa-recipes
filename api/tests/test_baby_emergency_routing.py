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
DOCTOR = "Call your baby's doctor now or seek urgent care. If you think your baby has a life-threatening emergency, call 911."
CASES = [
    "my baby is barely breathing", "my newborn is limp and wont respond", "my 1mo jerking and eyes fixed to one side wont respond", "my baby isn't breathing", "baby's lips are blue", "he won't wake up", "my newborn looks gray",
    "her lips look bluish", "my baby is struggling for each breath", "my newborn is very weak",
    "my baby is grunting with each breath", "my baby is not moving", "baby has a fever. She stopped breathing.",
]


@pytest.mark.parametrize("message", CASES)
def test_emergency_shipped_string_is_911_first(message):
    reply = ask_safety.classify(message)
    assert reply.kind == "baby_unwell"  # Mobile wire compatibility, including builds 34–36.
    assert reply.message == EMERGENCY
    assert "doctor" not in reply.message


@pytest.mark.parametrize("message", ["my newborn is floppy", "she's been throwing up green stuff", "3 week old throwing up bright green stuff twice", "baby is vomiting green", "my baby has a weak suck", "she has a strange cry"])
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


def test_shipped_model_prompt_prioritizes_unresponsiveness_over_other_baby_signs():
    from app.domains.baby.ask_check import QUESTION_PROMPT
    assert "Emergency signs always win" in QUESTION_PROMPT
    assert "not responding, unable to wake" in QUESTION_PROMPT


@pytest.mark.parametrize("message", ["I am pregnant and my baby is not moving", "I am 35 weeks pregnant. My baby is not moving."])
def test_explicit_fetal_movement_still_uses_the_maternal_immediate_care_route(message):
    assert ask_safety.classify(message).message == ask_safety.MESSAGES[ask_safety.URGENT_MATERNAL]


@pytest.mark.parametrize("message", ["I am pregnant and my 3 weeks old baby is not moving", "I'm pregnant. My newborn is not moving.",
                                       "I am pregnant and my baby is not moving and barely breathing", "I am pregnant. My 2-month-old baby is not moving."])
def test_newborn_or_other_emergency_signs_still_lead_with_911(message):
    assert ask_safety.classify(message).message == EMERGENCY


@pytest.mark.parametrize("message", ["My baby is not moving her bowels", "My baby is grunting while pooping"])
def test_explicit_bowel_phrases_are_not_breathing_or_whole_body_emergencies(message):
    assert ask_safety.classify(message) is None


def test_bowel_context_never_excuses_an_independent_emergency():
    assert ask_safety.classify("My baby is grunting while pooping and won't wake up").message == EMERGENCY


@pytest.mark.parametrize("baby,first", [("My baby has a fever", ask_safety.MESSAGES[ask_safety.URGENT_MATERNAL]),
    ("My baby is not breathing", EMERGENCY), ("My baby is floppy", ask_safety.MESSAGES[ask_safety.URGENT_MATERNAL])])
def test_mixed_parent_and_baby_signs_preserve_both_routes(baby, first):
    reply = ask_safety.classify("I am bleeding heavily. " + baby)
    assert reply.message.startswith(first)
    assert ask_safety.MESSAGES[ask_safety.URGENT_MATERNAL] in reply.message
    assert (EMERGENCY if "breathing" in baby else ER if "floppy" in baby else DOCTOR) in reply.message


@pytest.mark.parametrize("label", ["baby_emergency ", " baby_er", "baby_unwell"])
def test_provider_labels_normalize_to_a_supported_fixed_route(label):
    from app.domains.baby.provider import AnswerOutput
    assert AnswerOutput(message="Generated words must not publish", safety=label).safety == label.strip()


@pytest.mark.parametrize("label", ["not_a_route", "baby-emergency", "", 42])
def test_unsupported_non_null_safety_labels_fail_closed(label):
    from pydantic import ValidationError

    from app.domains.baby.provider import AnswerOutput
    with pytest.raises(ValidationError):
        AnswerOutput(message="Generated words must not publish", safety=label)


@needs_database
@pytest.mark.parametrize("ask_v2", [False, True])
@pytest.mark.parametrize("label,expected", [("baby_emergency ", EMERGENCY), ("unsupported_safety", None),
    ("maternal_baby_emergency", ask_safety.MESSAGES["maternal_baby_emergency"]),
    ("maternal_baby_er", ask_safety.MESSAGES["maternal_baby_er"]),
    ("maternal_baby_unwell", ask_safety.MESSAGES["maternal_baby_unwell"])])
async def test_generated_safety_labels_are_checked_on_both_actual_endpoints(baby_api, stub, ask_v2, label, expected):  # noqa: F811
    import json

    import httpx

    from tests.test_baby_ask_v2 import answered
    await enable(baby_api)
    generated = "Generated advice must never publish"
    stub.replies = [answered(generated, safety=label)]
    original = stub.handler
    def reply(request):
        if "chat/completions" in str(request.url):
            return httpx.Response(200, json={"id": "label-test", "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                "choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"message": generated, "safety": label})}}]})
        return original(request)
    stub.handler = reply
    response = await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json={"request_id": str(uuid4()),
        "message": "Please summarize my notes", "ask_v2": ask_v2})
    assert generated not in response.text
    if expected:
        assert response.status_code == 200 and response.json()["message"] == expected
        assert response.json()["help"] == ask_safety.help_kind(label.strip())
    else:
        assert response.status_code in {200, 503}
        if response.status_code == 200:
            assert response.json()["help"] == "cant_answer"
