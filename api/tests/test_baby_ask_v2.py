"""The new Ask's request shape and who reaches it. No paid call: a local stub answers at the HTTP layer."""

import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select

from app.domains.baby import ask_check, ask_gate, ask_research, ask_tools, ask_v2, budget, provider
from app.domains.baby.ask_gate import ASK_CONSENT_VERSION
from app.domains.baby.ask_tools import AskTools
from app.domains.baby.ask_v2 import effort_for, response_text
from app.domains.baby.models import BabyAIAdmission, BabyMembership, BabyMessage
from app.models.ai import AIInvocation
from tests import test_baby_integration as shared

baby_api = shared.baby_api
pytestmark = pytest.mark.skipif(not shared.DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
HEADERS = {**shared.GEN, "X-Baby-Client": "2"}
OLD_PATH_REPLY = shared.OLD_PATH_REPLY
USAGE = {
    "input_tokens": 1000, "output_tokens": 50,
    "input_tokens_details": {"cached_tokens": 200}, "output_tokens_details": {"reasoning_tokens": 10},
}


def answered(message="Stub answer", **fields):
    text = json.dumps({"message": message, "citation_ids": [], "proposal": None, **fields})
    return {
        "id": "resp_1", "status": "completed", "usage": USAGE,
        "output": [{"type": "message", "content": [{"type": "output_text", "text": text, "annotations": []}]}],
    }


def tool_call(name="stub_tool", arguments="{}", call_id="call_1"):
    return {
        "id": "resp_tool", "status": "completed", "usage": USAGE,
        "output": [
            {"type": "reasoning", "id": "rs_1", "encrypted_content": "opaque", "summary": []},
            {"type": "function_call", "id": "fc_1", "call_id": call_id, "name": name, "arguments": arguments},
        ],
    }


class Stub:
    """Stands in for the provider's HTTP endpoints and records exactly what was sent."""

    def __init__(self):
        self.replies, self.sent, self.urls = [], [], []
        self.on_call = None
        # The safety check answers for itself, so each test is about its own calls. These set what it says.
        self.checks, self.question_verdict, self.answer_verdict = [], {}, {}

    def check_reply(self, body):
        self.checks.append(body)
        safe = ({"urgent": "none", "asks_dose": False, "asks_diagnosis": False}, self.question_verdict) if body["instructions"] == ask_check.QUESTION_PROMPT \
            else ({"states_dose": False, "diagnoses": False, "discourages_care": False}, self.answer_verdict)
        verdict = safe[1] if isinstance(safe[1], httpx.Response) else {"id": "check", "status": "completed", "usage": USAGE, "output": [
            {"type": "message", "content": [{"type": "output_text", "text": safe[1] if isinstance(safe[1], str) else json.dumps({**safe[0], **safe[1]})}]}]}
        return verdict if isinstance(verdict, httpx.Response) else httpx.Response(200, json=verdict)

    def handler(self, request):
        body = json.loads(request.content)
        if body.get("text", {}).get("format", {}).get("name") == ask_check.CHECK_FORMAT:
            return self.check_reply(body)
        self.urls.append(str(request.url))
        self.sent.append(body)
        if "chat/completions" in str(request.url):
            content = json.dumps({"message": "Old path answer", "citation_ids": [], "proposal": None})
            return httpx.Response(200, json={
                "id": "chat_1", "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                "choices": [{"finish_reason": "stop", "message": {"content": content}}],
            })
        reply = self.replies.pop(0) if self.replies else answered()
        if isinstance(reply, httpx.Response):
            return reply
        return httpx.Response(200, json=reply)


@pytest.fixture
async def stub(baby_api, monkeypatch):
    fake = Stub()
    monkeypatch.setattr(provider, "RETRY_DELAYS", (0, 0))
    settings = SimpleNamespace(
        baby_ask_v2_enabled=True, baby_ask_model="gpt-6-luna", baby_ask_reasoning_effort="low",
        baby_ai_model="gpt-5.6-luna", recipe_chat_model="gpt-5.6-luna", openai_reasoning_effort="none",
        baby_ask_research_model="", baby_ask_research_reasoning_effort="low",
        baby_ask_safety_model="gpt-6-luna", baby_ask_safety_reasoning_effort="low",
        ai_model_pricing={"gpt-5.6-luna": {"input_per_million": 0.2, "output_per_million": 1.2}},
        is_ai_capability_enabled=lambda _: True,
    )
    fake.settings = settings
    for module in (provider, ask_gate, ask_v2, ask_research, ask_check):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    monkeypatch.setattr(budget, "get_settings", lambda: settings)
    monkeypatch.setattr(budget, "AsyncSessionLocal", baby_api.sessions)
    monkeypatch.setattr("app.db.database.AsyncSessionLocal", baby_api.sessions)
    monkeypatch.setattr("app.db.AsyncSessionLocal", baby_api.sessions)
    monkeypatch.setattr(provider.BabyProvider, "enabled", property(lambda self: True))
    monkeypatch.setattr(provider.BabyProvider, "_key", lambda self, _: "stub-key")
    monkeypatch.setattr(httpx, "AsyncHTTPTransport", lambda retries=0: httpx.MockTransport(lambda request: fake.handler(request)))
    # The shared fixture answers the old path's check, for tests about other things. Here it's real, against this stub.
    monkeypatch.setattr(ask_v2, "old_path_reply", OLD_PATH_REPLY)
    return fake


async def enable(baby_api, *, acknowledge=True):
    body = {"ai_consent": True, **({"acknowledge_ai_consent_version": ASK_CONSENT_VERSION} if acknowledge else {})}
    assert (await baby_api.client.patch("/api/v1/baby/profile", headers=HEADERS, json=body)).status_code == 200


def question(**fields):
    return {"request_id": str(uuid4()), "message": "What happened today?", "ask_v2": True, **fields}


async def ask(baby_api, headers=HEADERS, **fields):
    return await baby_api.client.post("/api/v1/baby/chat", headers=headers, json=question(**fields))


async def test_the_new_ask_uses_responses_without_provider_storage(baby_api, stub):
    await enable(baby_api)
    result = await ask(baby_api)
    assert result.status_code == 200, result.text
    assert result.json()["message"] == "Stub answer"
    assert stub.urls == ["https://api.openai.com/v1/responses"]
    sent = stub.sent[0]
    assert sent["store"] is False and sent["service_tier"] == "default"
    assert sent["model"] == "gpt-6-luna" and sent["reasoning"] == {"effort": "low"}
    assert sent["include"] == ["reasoning.encrypted_content"]
    assert "What happened today?" in sent["input"][0]["content"]
    assert "untrusted DATA" in sent["instructions"]


async def test_reasoning_effort_comes_from_configuration(baby_api, stub):
    await enable(baby_api)
    stub.settings.baby_ask_reasoning_effort = "medium"
    assert (await ask(baby_api)).status_code == 200
    assert stub.sent[0]["reasoning"] == {"effort": "medium"}
    assert effort_for("gpt-6-astra", "none") == "low" and effort_for("gpt-6-luna", "none") == "none"


async def test_usage_and_a_reservation_are_recorded_without_content(baby_api, stub):
    await enable(baby_api)
    assert (await ask(baby_api)).status_code == 200
    async with baby_api.sessions() as db:
        row = await db.scalar(select(AIInvocation).where(AIInvocation.capability != "baby_safety"))
        admission = await db.scalar(select(BabyAIAdmission).where(BabyAIAdmission.capability != "baby_safety"))
    assert (row.capability, row.model, row.status) == ("baby_ask", "gpt-6-luna", "success")
    assert (row.input_tokens, row.cached_input_tokens, row.output_tokens, row.reasoning_tokens) == (1000, 200, 50, 10)
    assert row.prompt_version == "baby-ask-v2-1" and row.provider_request_id == "resp_1"
    assert admission.capability == "baby_ask" and admission.app_user_id == "owner"


@pytest.mark.parametrize(
    "case",
    ["not_acknowledged", "flag_off", "old_build_request", "scoped_conversation", "no_client_header"],
)
async def test_everyone_else_stays_on_the_old_path(baby_api, stub, case):
    await enable(baby_api, acknowledge=case != "not_acknowledged")
    stub.settings.baby_ask_v2_enabled = case != "flag_off"
    fields, headers = {}, HEADERS
    if case == "old_build_request":
        fields["ask_v2"] = False
    if case == "scoped_conversation":
        fields["scope"] = "library"
    if case == "no_client_header":
        headers = shared.GEN
    result = await ask(baby_api, headers, **fields)
    assert result.status_code == 200, result.text
    assert result.json()["message"] == "Old path answer"
    assert stub.urls == ["https://api.openai.com/v1/chat/completions"]
    async with baby_api.sessions() as db:
        # The old answer, and the one question check it now gets ahead of it.
        assert sorted(await db.scalars(select(BabyAIAdmission.capability))) == ["baby_chat", "baby_safety"]
    assert len(stub.checks) == 1 and stub.checks[0]["instructions"] == ask_check.QUESTION_PROMPT


async def test_an_older_questions_retry_still_matches_after_this_field_exists(baby_api, stub):
    await enable(baby_api)
    body = question(ask_v2=False)
    assert (await baby_api.client.post("/api/v1/baby/chat", headers=HEADERS, json=body)).status_code == 200
    async with baby_api.sessions() as db:
        prior = await db.get(BabyMessage, body["request_id"])
        expected = {key: body.get(key) for key in ("message", "request_id")}
        assert prior.content["hash"] != ""
    from app.domains.baby.chat import question_identity
    from app.domains.baby.schemas import ChatRequest

    assert prior.content["hash"] == question_identity(ChatRequest.model_validate(expected))


def stub_tool(monkeypatch):
    calls = []

    async def read(tools, db, owner, arguments):
        calls.append(owner)
        return {"found": "stub"}

    monkeypatch.setitem(ask_tools.TOOLS, "stub_tool", ask_tools.Tool(
        {"description": "Stub", "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False}},
        ask_tools.DomainModel, read))
    return calls


async def test_tool_rounds_send_back_what_the_model_produced_and_stop_at_five(baby_api, stub, monkeypatch):
    calls = stub_tool(monkeypatch)
    await enable(baby_api)
    stub.replies = [tool_call() for _ in range(5)]
    assert (await ask(baby_api)).status_code == 200
    assert len(stub.sent) == 6 and len(calls) == 5
    assert [body["tool_choice"] for body in stub.sent] == ["auto"] * 5 + ["none"]
    second = stub.sent[1]["input"]
    assert [item.get("type") for item in second[1:]] == ["reasoning", "function_call", "function_call_output"]
    assert second[1]["encrypted_content"] == "opaque"
    assert json.loads(second[3]["output"]) == {"untrusted_data": {"found": "stub"}}
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyAIAdmission).where(BabyAIAdmission.capability == "baby_ask")) == 6


async def test_a_model_that_ignores_the_last_round_gets_no_answer_saved(baby_api, stub, monkeypatch):
    stub_tool(monkeypatch)
    await enable(baby_api)
    stub.replies = [tool_call() for _ in range(9)]
    result = await ask(baby_api)
    assert result.status_code == 503 and len(stub.sent) == 6
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyMessage).where(BabyMessage.role == "assistant")) == 0


async def test_a_bad_tool_request_comes_back_as_data_rather_than_failing(baby_api, stub):
    await enable(baby_api)
    stub.replies = [tool_call("no_such_tool"), answered()]
    assert (await ask(baby_api)).status_code == 200
    assert json.loads(stub.sent[1]["input"][-1]["output"]) == {"untrusted_data": {"error": "unknown_tool"}}


@pytest.mark.parametrize(
    "reply",
    [
        {"id": "r", "status": "incomplete", "output": [], "usage": USAGE},
        httpx.Response(500, text="Provider said something private"),
        {"id": "r", "status": "completed", "output": [{"type": "message", "content": []}], "usage": USAGE},
    ],
)
async def test_a_failed_answer_saves_nothing_and_leaks_nothing(baby_api, stub, reply):
    await enable(baby_api)
    stub.replies = [reply, reply, reply]  # A 500 gets two more tries.
    result = await ask(baby_api)
    assert result.status_code == 503 and "private" not in result.text
    async with baby_api.sessions() as db:
        rows = list(await db.scalars(select(BabyMessage)))
    assert [row.role for row in rows] == ["user"] and rows[0].content["status"] == "failed"


async def test_withdrawing_mid_answer_discards_the_answer(baby_api, stub, monkeypatch):
    await enable(baby_api)
    real = provider.BabyProvider.responses_call

    async def revoking(self, **kwargs):
        result = await real(self, **kwargs)
        if kwargs["capability"] == "baby_ask":
            await baby_api.client.patch("/api/v1/baby/profile", headers=HEADERS, json={"ai_consent": False})
        return result

    monkeypatch.setattr(provider.BabyProvider, "responses_call", revoking)
    result = await ask(baby_api)
    assert result.status_code == 403
    async with baby_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(BabyMessage).where(BabyMessage.role == "assistant")) == 0


async def test_withdrawing_between_rounds_stops_the_next_paid_call(baby_api, stub, monkeypatch):
    stub_tool(monkeypatch)
    await enable(baby_api)
    real = provider.BabyProvider.responses_call

    async def revoking(self, **kwargs):
        result = await real(self, **kwargs)
        if kwargs["capability"] == "baby_ask":
            await baby_api.client.patch("/api/v1/baby/profile", headers=HEADERS, json={"ai_consent": False})
        return result

    monkeypatch.setattr(provider.BabyProvider, "responses_call", revoking)
    stub.replies = [tool_call(), answered()]
    assert (await ask(baby_api)).status_code in {403, 503}
    assert len(stub.sent) == 1


async def test_a_new_consent_version_stops_a_person_until_they_acknowledge(baby_api, stub, monkeypatch):
    await enable(baby_api)
    monkeypatch.setattr(ask_gate, "ASK_CONSENT_VERSION", ASK_CONSENT_VERSION + 1)
    result = await ask(baby_api)
    assert result.status_code == 200 and result.json()["message"] == "Old path answer"


def test_only_output_text_counts_as_the_answer():
    assert response_text({"output": [
        {"type": "reasoning", "summary": [{"text": "thinking"}]},
        {"type": "message", "content": [{"type": "refusal", "refusal": "no"}, {"type": "output_text", "text": "{}"}]},
    ]}) == "{}"


async def test_tools_read_with_access_as_of_each_round(baby_api, stub):
    await enable(baby_api)
    async with baby_api.sessions() as db:
        personal = (await db.get(BabyMembership, "owner")).personal_space_id
    family_on = baby_api.settings.baby_family_enabled
    tools = AskTools(user_id="owner", client="2", personal_space_id=personal if family_on else None, family=family_on,
                     generation=1, zone=None, tracked={"records": {}, "children": {}})
    async with baby_api.sessions() as db:
        scope = await tools.scope(db)
    assert getattr(scope, "actor", scope) == "owner"


# Consent is checked before every read and every call, and a paid reply keeps its accounting.
async def test_withdrawing_stops_the_tool_read_that_was_about_to_run(baby_api, stub, monkeypatch):
    reads = stub_tool(monkeypatch)
    await enable(baby_api)
    real = provider.BabyProvider.responses_call

    async def revoking(self, **kwargs):
        reply = await real(self, **kwargs)
        if kwargs["capability"] == "baby_ask":
            await baby_api.client.patch("/api/v1/baby/profile", headers=HEADERS, json={"ai_consent": False})
        return reply

    monkeypatch.setattr(provider.BabyProvider, "responses_call", revoking)
    stub.replies = [tool_call(), answered()]
    assert (await ask(baby_api)).status_code == 403
    assert reads == [] and len(stub.sent) == 1


async def test_a_second_tool_in_a_round_is_stopped_when_consent_goes_after_the_first(baby_api, stub, monkeypatch):
    reads = []

    async def read(tools, db, owner, arguments):
        reads.append(owner)
        await baby_api.client.patch("/api/v1/baby/profile", headers=HEADERS, json={"ai_consent": False})
        return {"found": "stub"}

    monkeypatch.setitem(ask_tools.TOOLS, "stub_tool", ask_tools.Tool(
        {"description": "Stub", "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False}},
        ask_tools.DomainModel, read))
    await enable(baby_api)
    reply = tool_call(call_id="first")
    reply["output"].append({"type": "function_call", "id": "fc_2", "call_id": "second", "name": "stub_tool", "arguments": "{}"})
    stub.replies = [reply]
    assert (await ask(baby_api)).status_code == 403
    assert len(reads) == 1 and len(stub.sent) == 1


@pytest.mark.parametrize(
    "reply",
    [
        {"id": "paid_incomplete", "status": "incomplete", "output": [], "usage": USAGE},
        {"id": "paid_incomplete", "status": "completed", "error": {"code": "x"}, "output": [], "usage": USAGE},
    ],
)
async def test_an_incomplete_reply_keeps_its_usage_and_request_id(baby_api, stub, reply):
    await enable(baby_api)
    stub.replies = [reply]
    assert (await ask(baby_api)).status_code == 503
    async with baby_api.sessions() as db:
        row = await db.scalar(select(AIInvocation).where(AIInvocation.capability != "baby_safety"))
        assert (row.status, row.provider_request_id) == ("failed", "paid_incomplete")
        assert (row.input_tokens, row.output_tokens, row.reasoning_tokens) == (1000, 50, 10)
        assert await db.scalar(select(func.count()).select_from(BabyAIAdmission).where(BabyAIAdmission.capability == "baby_ask")) == 1
        assert await db.scalar(select(func.count()).select_from(BabyMessage).where(BabyMessage.role == "assistant")) == 0


async def test_a_reply_discarded_because_consent_changed_keeps_its_usage(baby_api, stub):
    await enable(baby_api)

    async def withdrawing(request):
        response = fake(request)
        if ask_check.CHECK_FORMAT.encode() not in request.content:
            await baby_api.client.patch("/api/v1/baby/profile", headers=HEADERS, json={"ai_consent": False})
        return response

    fake, stub.handler = stub.handler, withdrawing
    assert (await ask(baby_api)).status_code == 403
    async with baby_api.sessions() as db:
        row = await db.scalar(select(AIInvocation).where(AIInvocation.capability != "baby_safety"))
        assert row.status == "failed" and row.input_tokens == 1000 and row.provider_request_id == "resp_1"
        assert await db.scalar(select(func.count()).select_from(BabyMessage).where(BabyMessage.role == "assistant")) == 0


async def test_a_provider_failure_with_no_reply_records_no_usage(baby_api, stub):
    await enable(baby_api)
    stub.replies = [httpx.Response(500, text="PRIVATE_ERROR") for _ in range(3)]
    response = await ask(baby_api)
    assert response.status_code == 503 and "PRIVATE" not in response.text
    async with baby_api.sessions() as db:
        row = await db.scalar(select(AIInvocation).where(AIInvocation.capability != "baby_safety"))
        assert row.status == "failed" and row.input_tokens is None and row.provider_request_id is None
