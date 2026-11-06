"""A provider's passing 429 or 5xx gets two more tries, each admitted again. No database and no paid call."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import HTTPException

from app.domains.baby import provider
from app.domains.baby.provider import AnswerOutput, BabyProvider, ProviderUnavailable

OK = {"choices": [{"finish_reason": "stop", "message": {"content": '{"message": "Answer", "citation_ids": [], "proposal": null}'}}]}


class Tracker:
    """Stands in for the invocation record, which has its own tests."""

    def __init__(self, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def succeed(self, *args):
        pass

    def fail(self, *args):
        pass


class Harness:
    def __init__(self, monkeypatch):
        self.statuses, self.tries, self.reserved, self.slept, self.gates = [], 0, 0, [], 0
        self.monkeypatch = monkeypatch
        harness = self

        async def reserve(self, *args, **kwargs):
            harness.reserved += 1

        async def admitted(self, capability):
            harness.gates += 1

        async def sleep(seconds):
            harness.slept.append(seconds)

        def handler(request):
            harness.tries += 1
            status = harness.statuses.pop(0)
            return httpx.Response(status, json=self.body() if status == 200 else {"error": "busy"})

        real = httpx.AsyncClient
        monkeypatch.setattr(provider, "AIInvocationTracker", Tracker)
        monkeypatch.setattr(BabyProvider, "_reserve", reserve)
        monkeypatch.setattr(BabyProvider, "admitted", admitted)
        monkeypatch.setattr(BabyProvider, "_key", lambda self, _: "stub-key")
        monkeypatch.setattr(provider.asyncio, "sleep", sleep)
        monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: real(transport=httpx.MockTransport(handler), timeout=kwargs.get("timeout")))
        monkeypatch.setattr(provider, "get_settings", lambda: type("S", (), {"baby_ai_model": "gpt-5.6-luna", "openai_reasoning_effort": "none"})())

    def body(self):
        return OK

    async def old_answer(self, capability="baby_chat"):
        return await BabyProvider().json_call(capability=capability, instructions="x", content="y", output_model=AnswerOutput)


@pytest.fixture
def harness(monkeypatch):
    return Harness(monkeypatch)


@pytest.mark.parametrize("statuses", [[503, 200], [429, 200], [500, 502, 200], [503, 429, 200]])
async def test_the_old_answer_comes_through_a_passing_failure(harness, statuses):
    harness.statuses = list(statuses)
    assert (await harness.old_answer()).message == "Answer"
    assert harness.tries == len(statuses)


async def test_each_try_waits_longer_and_is_admitted_again(harness):
    harness.statuses = [503, 503, 200]
    await harness.old_answer()
    assert harness.slept == list(provider.RETRY_DELAYS) and harness.slept[0] < harness.slept[1]
    assert harness.reserved == 3


async def test_three_failures_still_fail_as_they_always_did(harness):
    harness.statuses = [503, 503, 503, 200]
    with pytest.raises(ProviderUnavailable):
        await harness.old_answer()
    assert harness.tries == 3 and harness.statuses == [200]


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
async def test_a_request_the_provider_refuses_is_not_tried_again(harness, status):
    harness.statuses = [status, 200]
    with pytest.raises(ProviderUnavailable):
        await harness.old_answer()
    assert harness.tries == 1


@pytest.mark.parametrize("capability", ["baby_extraction", "baby_timing"])
async def test_nothing_but_the_answer_and_the_check_retries(harness, capability):
    harness.statuses = [503, 200]
    with pytest.raises(ProviderUnavailable):
        await harness.old_answer(capability)
    assert harness.tries == 1 and harness.slept == []


async def test_withdrawing_permission_between_tries_stops_them(harness, monkeypatch):
    harness.statuses = [503, 200]

    async def withdrawn(self, *args, **kwargs):
        if harness.tries:
            raise HTTPException(403, "AI processing permission changed")
        harness.reserved += 1

    monkeypatch.setattr(BabyProvider, "_reserve", withdrawn)
    with pytest.raises(HTTPException):
        await harness.old_answer()
    assert harness.tries == 1


async def test_no_try_starts_after_the_time_limit(harness, monkeypatch):
    clock = iter([0, provider.RETRY_WINDOW_SECONDS + 1])
    monkeypatch.setattr(provider, "time", SimpleNamespace(monotonic=lambda: next(clock)))
    harness.statuses = [503, 200]
    with pytest.raises(ProviderUnavailable):
        await harness.old_answer()
    assert harness.tries == 1 and harness.slept == []

async def test_actual_call_reserves_all_output_and_settles_metered_invalid_result(harness, monkeypatch):
    tracker = Tracker()
    tracker.fail = Mock()
    monkeypatch.setattr(provider, "AIInvocationTracker", lambda **kwargs: tracker)
    ticket = object()
    reservation, settlement = AsyncMock(return_value=ticket), AsyncMock()
    monkeypatch.setattr(BabyProvider, "_reserve", reservation)
    monkeypatch.setattr(provider, "settle", settlement)
    response = {"choices":[{"finish_reason":"length", "message":{"content":"incomplete"}}],
                "usage":{"prompt_tokens":3000,"completion_tokens":6000}}
    monkeypatch.setattr(harness, "body", lambda: response)
    harness.statuses = [200]
    with pytest.raises(ProviderUnavailable):
        await BabyProvider().json_call(capability="baby_extraction", instructions="Read source", content=[
            {"type":"text","text":"Synthetic caption"},
            {"type":"image_url","image_url":{"url":"data:image/webp;base64,synthetic","detail":"high"}},
        ], output_model=AnswerOutput, max_tokens=6000)
    assert reservation.await_args.kwargs["max_output_tokens"] == 6000
    assert reservation.await_args.kwargs["image_count"] == 1
    assert 0 < reservation.await_args.kwargs["input_bytes"] < 2000
    settlement.assert_awaited_once_with(ticket, response)
    tracker.fail.assert_called_once_with("baby_provider_failed", response)

async def test_incomplete_hosted_tool_response_keeps_full_reservation(harness, monkeypatch):
    ticket = object()
    settlement = AsyncMock()
    monkeypatch.setattr(provider, "settle", settlement)
    monkeypatch.setattr(BabyProvider, "admit_ask_call", AsyncMock(return_value=ticket))
    response = {"status": "failed", "output": [], "usage": {"input_tokens": 10, "output_tokens": 1}}
    monkeypatch.setattr(harness, "body", lambda: response)
    harness.statuses = [200]
    with pytest.raises(ProviderUnavailable):
        await BabyProvider().responses_attempt(capability="baby_ask", model="gpt-5.6-luna",
            prompt_version="test", body={"input": "fixture", "max_output_tokens": 100})
    settlement.assert_awaited_once_with(ticket, None, extra_cost=0)
