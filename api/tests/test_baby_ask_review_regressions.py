"""What the independent reviews of Ask proved holds, kept so it goes on holding. Fakes only."""

import asyncio
import json
import logging

import httpx
import pytest
from sqlalchemy import delete, func, select

from app.domains.baby import ask_check, ask_tools, ask_v2, budget
from app.domains.baby.models import BabyAIAdmission, BabyConversation, BabyMembership, BabyMessage
from tests import test_baby_access as foundation
from tests import test_baby_family_records as records
from tests.test_baby_ask_tools import HEADERS, add, family_setup
from tests.test_baby_ask_v2 import answered, ask, enable, stub, tool_call  # noqa: F401

baby_api, family, pytestmark = foundation.baby_api, foundation.family, foundation.pytestmark


async def test_the_real_removal_endpoint_mid_round_stops_the_next_read(baby_api, family, stub, monkeypatch):  # noqa: F811
    mine, _ = await family_setup(baby_api)
    headers = records.headers(mine, generation=1)
    await baby_api.client.patch("/api/v1/baby/profile", headers=headers, json={"ai_consent": True, "acknowledge_ai_consent_version": 1})
    post = await add(baby_api, records.headers(family), kind="source", title="Not yet read", data={"source_text": "UNREAD_AFTER_REMOVAL"})
    reply = tool_call("baby_profile", "{}", call_id="first")
    reply["output"].append({"type": "function_call", "id": "fc_2", "call_id": "second", "name": "open_entry", "arguments": json.dumps({"record_id": post})})
    stub.replies = [reply, answered("After removal"), answered("After removal")]
    real, calls = ask_tools.AskTools.call, []

    async def remove_between(self, db, owner, call):
        result = await real(self, db, owner, call)
        calls.append(call["name"])
        if len(calls) == 1:
            removal = await baby_api.client.delete(f"/api/v1/baby/family/{family}/members/owner", headers=records.headers(family, "other", 7))
            assert removal.status_code == 200, removal.text
        return result

    monkeypatch.setattr(ask_tools.AskTools, "call", remove_between)
    response = await ask(baby_api, headers=headers)
    assert response.status_code == 200, response.text
    assert calls == ["baby_profile"] and "UNREAD_AFTER_REMOVAL" not in json.dumps(stub.sent)


@pytest.mark.parametrize("failure", ["timeout", "refusal", "malformed_json", "missing_call_id"])
async def test_bad_provider_shapes_save_nothing_and_leak_nothing(baby_api, stub, failure):  # noqa: F811
    await enable(baby_api)
    if failure == "timeout":
        real = stub.handler

        def timeout(request):
            if ask_check.CHECK_FORMAT.encode() in request.content:
                return real(request)
            stub.sent.append(json.loads(request.content))
            raise httpx.ReadTimeout("PRIVATE_TIMEOUT_PAYLOAD", request=request)

        stub.handler = timeout
    elif failure == "refusal":
        stub.replies = [{"status": "completed", "usage": {}, "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "PRIVATE_REFUSAL"}]}]}]
    elif failure == "malformed_json":
        reply = answered()
        reply["output"][0]["content"][0]["text"] = "PRIVATE_NOT_JSON"
        stub.replies = [reply]
    else:
        reply = tool_call("baby_profile")
        del reply["output"][1]["call_id"]
        stub.replies = [reply]
    response = await ask(baby_api)
    assert response.status_code == 503 and "PRIVATE_" not in response.text
    assert len(stub.sent) == 1
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyMessage).where(BabyMessage.role == "assistant")) == 0
        assert await db.scalar(select(func.count()).select_from(BabyAIAdmission).where(BabyAIAdmission.capability == "baby_ask")) == 1


async def test_retries_each_reserve_and_stop_at_three(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    request_id = "9a0c3f1e-53a2-4c1d-8b62-0d5e8c7a1f00"
    stub.replies = [httpx.Response(500, text="PRIVATE_ERROR") for _ in range(9)]
    for _ in range(3):
        assert (await ask(baby_api, request_id=request_id)).status_code == 503
    assert (await ask(baby_api, request_id=request_id)).status_code == 429
    # Three attempts at the question, and three tries in each.
    assert len(stub.sent) == 9
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyAIAdmission).where(BabyAIAdmission.capability == "baby_ask")) == 9


async def test_a_slow_answer_stops_at_the_limit_and_keeps_its_reservation(baby_api, stub, monkeypatch):  # noqa: F811
    await enable(baby_api)
    monkeypatch.setattr(ask_v2, "QUESTION_SECONDS", 3)

    real = stub.handler

    async def slow(request):
        if ask_check.CHECK_FORMAT.encode() in request.content:
            return real(request)
        stub.sent.append(json.loads(request.content))
        await asyncio.sleep(8)
        return httpx.Response(200, json=answered())

    stub.handler = slow
    assert (await ask(baby_api)).status_code == 503
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyAIAdmission).where(BabyAIAdmission.capability == "baby_ask")) == 1
        assert await db.scalar(select(func.count()).select_from(BabyMessage).where(BabyMessage.role == "assistant")) == 0


async def test_logs_and_error_reports_hold_no_content(baby_api, stub, caplog):  # noqa: F811
    await enable(baby_api)
    with caplog.at_level(logging.INFO):
        assert (await ask(baby_api, message="PRIVATE_REQUEST_WORDS")).status_code == 200
    assert "PRIVATE_REQUEST_WORDS" not in caplog.text
    from app.domains.workouts.privacy import redact_workouts_event, redact_workouts_transaction

    event = {"request": {"url": "https://test/api/v1/baby/chat", "data": "PRIVATE_REQUEST_WORDS"},
             "exception": {"values": [{"value": "PRIVATE_REQUEST_WORDS"}]}, "breadcrumbs": [{"message": "PRIVATE_REQUEST_WORDS"}]}
    assert "PRIVATE_REQUEST_WORDS" not in json.dumps(redact_workouts_event(event))
    assert redact_workouts_transaction(event) is None


async def test_deleting_chats_resets_the_question_count_but_not_the_money(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    async with baby_api.sessions() as db:
        conversation = BabyConversation(app_user_id="owner", generation=1, title="Seed", scope="all")
        db.add(conversation)
        await db.flush()
        db.add_all(BabyMessage(app_user_id="owner", generation=1, conversation_id=conversation.id, role="user", content={"message": "seed"}) for _ in range(50))
        await db.commit()
    assert (await ask(baby_api)).status_code == 429
    async with baby_api.sessions() as db:
        await db.execute(delete(BabyMessage).where(BabyMessage.app_user_id == "owner"))
        await db.execute(delete(BabyConversation).where(BabyConversation.app_user_id == "owner"))
        db.add(BabyAIAdmission(app_user_id="owner", generation=1, capability="baby_ask", reserved_microusd=budget.OWNER_DAILY_CAP))
        await db.commit()
    assert (await ask(baby_api)).status_code == 429 and stub.sent == []


async def test_erasing_and_rejoining_does_not_reset_spending(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    async with baby_api.sessions() as db:
        db.add(BabyAIAdmission(app_user_id="owner", generation=1, capability="baby_ask", reserved_microusd=budget.OWNER_DAILY_CAP))
        await db.commit()
    response = await baby_api.client.delete("/api/v1/baby/data?generation=1", headers=HEADERS)
    assert response.status_code == 200 and response.json()["generation"] == 2
    next_generation = {**HEADERS, "X-Baby-Generation": "2"}
    assert (await baby_api.client.post("/api/v1/baby/enroll", headers=next_generation)).status_code == 200
    await baby_api.client.patch("/api/v1/baby/profile", headers=next_generation, json={"ai_consent": True, "acknowledge_ai_consent_version": 1})
    assert (await ask(baby_api, headers=next_generation)).status_code == 429 and stub.sent == []


async def test_a_chats_history_is_bounded(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
        conversation = BabyConversation(app_user_id="owner", space_id=personal, generation=1, title="history", scope="all")
        db.add(conversation)
        await db.flush()
        db.add_all(BabyMessage(app_user_id="owner", generation=1, conversation_id=conversation.id, role="assistant", content={"message": "h" * 5000}) for _ in range(20))
        await db.commit()
        identifier = str(conversation.id)
    assert (await ask(baby_api, conversation_id=identifier)).status_code == 200
    history = json.loads(stub.sent[0]["input"][0]["content"])["recent_conversation"]
    assert len(history) == 12 and all(len(item["message"]) <= 3000 for item in history)


async def test_a_vague_question_still_finds_what_is_recent(baby_api, stub):  # noqa: F811
    await enable(baby_api)
    post = await add(baby_api, HEADERS, kind="source", title="Hospital bag", data={"source_text": "robe and slippers"})
    stub.replies = [tool_call("search_saved", json.dumps({"query": "Ask what has happened"})), answered("Bag", citation_ids=[post])]
    assert (await ask(baby_api, message="Ask what has happened")).status_code == 200
    result = json.loads(stub.sent[1]["input"][-1]["output"])["untrusted_data"]
    assert result["entries"][0]["id"] == post and result["matched_words"] is False
