"""A later release's app may still send these chat fields after a rollback. This one has to accept them."""

from uuid import uuid4

import pytest

from app.domains.baby import provider
from app.domains.baby.lifecycle import digest
from app.domains.baby.provider import AnswerOutput
from app.domains.baby.schemas import ChatRequest
from tests import test_baby_integration as shared

baby_api = shared.baby_api
CHAT = "/api/v1/baby/chat"
needs_database = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


@pytest.mark.parametrize("fields", [{"ask_v2": True}, {"ask_v2": False}, {"focus_date": "2026-11-04"}, {"ask_v2": True, "focus_date": "2026-11-04"}])
def test_the_fields_a_later_app_sends_are_accepted(fields):
    assert ChatRequest.model_validate({"message": "How was today?", **fields}).message == "How was today?"


def test_other_unknown_fields_are_still_refused():
    with pytest.raises(ValueError):
        ChatRequest.model_validate({"message": "How was today?", "something_else": 1})


@pytest.mark.parametrize("fields", [{"ask_v2": "yes"}, {"focus_date": "soon"}])
def test_they_are_still_checked(fields):
    with pytest.raises(ValueError):
        ChatRequest.model_validate({"message": "How was today?", **fields})


def identity_of(request):
    from app.domains.baby.chat import question_identity

    return question_identity(request)


def test_a_question_keeps_the_identity_it_had_before_these_fields():
    request_id = uuid4()
    before = digest({"conversation_id": None, "request_id": str(request_id), "message": "How was today?",
                     "scope": "all", "record_id": None, "child_id": None})
    assert identity_of(ChatRequest(request_id=request_id, message="How was today?")) == before
    assert identity_of(ChatRequest(request_id=request_id, message="How was today?", ask_v2=True)) == before


def test_a_days_question_has_its_own_identity():
    request_id = uuid4()
    plain = identity_of(ChatRequest(request_id=request_id, message="How was today?"))
    assert identity_of(ChatRequest(request_id=request_id, message="How was today?", focus_date="2026-11-04")) != plain


@needs_database
async def test_a_client_with_the_new_ask_still_gets_answers_and_retries_match(baby_api, monkeypatch):
    await baby_api.client.patch("/api/v1/baby/profile", headers=shared.GEN, json={"ai_consent": True})
    answers = []

    async def answer(self, **kwargs):
        answers.append(kwargs["message"])
        return AnswerOutput(message="Old path answer")

    monkeypatch.setattr(provider.BabyProvider, "enabled", property(lambda self: True))
    monkeypatch.setattr(provider.BabyProvider, "answer", answer)
    body = {"request_id": str(uuid4()), "message": "How was the day?", "ask_v2": True, "focus_date": "2026-11-04"}
    first = await baby_api.client.post(CHAT, headers=shared.GEN, json=body)
    assert first.status_code == 200, first.text
    assert first.json()["message"] == "Old path answer"
    retried = await baby_api.client.post(CHAT, headers=shared.GEN, json={**body, "ask_v2": False})
    assert retried.status_code == 200 and retried.json()["message"] == "Old path answer" and len(answers) == 1
    changed = await baby_api.client.post(CHAT, headers=shared.GEN, json={**body, "focus_date": "2026-11-03"})
    assert changed.status_code == 409


