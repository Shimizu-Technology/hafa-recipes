"""Deterministic coach contracts; no real provider calls or native acceptance claims."""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from app.domains.workouts.coach import (
    CoachFailure,
    ProductionCoachProvider,
    fit_source_flow_context,
    normalize_usage,
    response_parts,
    source_flow_context,
    validate_inspected_ids,
)
from app.domains.workouts.coach_actions import health_derived, tool_definitions
from tests.test_workouts_data_integration import settings
from tests.workouts_provider_fakes import FakeBudget


@pytest.fixture
def streamed_provider(monkeypatch):
    """Use the real HTTPX stream lifecycle with an entirely synthetic transport."""
    from app import ai_governance
    from app.domains.workouts import coach

    configured = settings(workouts_ai_enabled=True).model_copy(update={"environment": "production"})
    monkeypatch.setattr(coach, "get_settings", lambda: configured)
    state = SimpleNamespace(chunks=[], error=None, block=None, status=200, content_type="text/event-stream",
                            sent=[], tracked=[], closed=0, clients_closed=0, position=-1)

    class Bytes(httpx.AsyncByteStream):
        async def __aiter__(self):
            for index, chunk in enumerate(state.chunks):
                state.position = index
                yield chunk
            if state.block:
                await state.block.wait()
            if state.error:
                raise state.error

        async def aclose(self):
            state.closed += 1

    def handle(request):
        state.sent.append((str(request.url), json.loads(request.content), request.headers["accept"]))
        return httpx.Response(state.status, headers={"content-type": state.content_type}, stream=Bytes())

    client_type = httpx.AsyncClient

    class Client(client_type):
        def __init__(self, **kwargs):
            assert kwargs["timeout"] == 45
            assert isinstance(kwargs["transport"], httpx.AsyncHTTPTransport)
            super().__init__(timeout=45, transport=httpx.MockTransport(handle))

        async def __aexit__(self, *args):
            try:
                return await super().__aexit__(*args)
            finally:
                state.clients_closed += 1

    class Tracker:
        def __init__(self, **kwargs):
            self.model = kwargs["primary_model"]
            self.record = {"configuration": kwargs, "terminal": [], "exits": 0}
            state.tracked.append(self.record)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            self.record["exits"] += 1
            return False

        def succeed(self, data):
            self.record["terminal"].append(("success", data))

        def fail(self, code):
            self.record["terminal"].append(("failed", code))

    monkeypatch.setattr(coach.httpx, "AsyncClient", Client)
    monkeypatch.setattr(ai_governance, "AIInvocationTracker", Tracker)
    return state


def stream_frame(kind, **data):
    return f"event: {kind}\r\ndata: {json.dumps({'type': kind, **data}, ensure_ascii=False)}\r\n\r\n".encode()


def stream_result(text="Reply 🌴"):
    return {"id": "response", "status": "completed", "usage": {"input_tokens": 5, "output_tokens": 2},
            "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}]}


async def test_stream_delivers_real_fragmented_unicode_only_and_accounts_final_once(streamed_provider):
    state, deltas, budget = streamed_provider, [], FakeBudget()
    first = b"\xef\xbb\xbf: keepalive\r\n\r\n" + stream_frame("response.reasoning_text.delta", delta="PRIVATE REASONING")
    first += stream_frame("response.function_call_arguments.delta", delta="PRIVATE ARGUMENTS")
    text = stream_frame("response.output_text.delta", delta="Reply 🌴")
    final = stream_result()
    state.chunks = [first, *[text[index:index + 1] for index in range(len(text))],
                    stream_frame("response.completed", response=final)]

    async def receive(delta):
        assert state.position < len(state.chunks) - 1 and state.closed == 0
        deltas.append(delta)

    result = await ProductionCoachProvider(budget_guard=budget).respond([], tools=[], on_text_delta=receive)
    assert result == final and deltas == ["Reply 🌴"]
    assert state.closed == state.clients_closed == 1
    assert len(state.sent) == len(budget.reservations) == len(state.tracked) == 1
    url, body, accept = state.sent[0]
    assert url.endswith("/v1/responses") and accept == "text/event-stream"
    assert body["stream"] is True and body["store"] is False and body["max_output_tokens"] == 1800
    assert body["parallel_tool_calls"] is False and body["service_tier"] == "default"
    assert budget.reservations[0][2].sdk_max_retries == 0 and budget.outcomes == ["success"]
    assert budget.reservations[0][2].includes_images is False
    assert state.tracked[0]["exits"] == 1
    assert state.tracked[0]["terminal"] == [("success", normalize_usage(final))]
    assert "PRIVATE" not in json.dumps(state.tracked)


async def test_stream_callback_backpressure_does_not_consume_final_early(streamed_provider):
    state, entered, release = streamed_provider, asyncio.Event(), asyncio.Event()
    state.chunks = [stream_frame("response.output_text.delta", delta="Reply"),
                    stream_frame("response.completed", response=stream_result("Reply"))]

    async def receive(_delta):
        entered.set()
        await release.wait()

    task = asyncio.create_task(ProductionCoachProvider(budget_guard=FakeBudget()).respond([], tools=[], on_text_delta=receive))
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        assert state.position == 0 and not task.done()
        release.set()
        assert (await task)["status"] == "completed"
    finally:
        release.set()
        if not task.done():
            task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


async def test_stream_multiline_sse_and_tool_turn_do_not_expose_arguments(streamed_provider):
    state, deltas, budget = streamed_provider, [], FakeBudget()
    final = stream_result() | {"output": [
        {"type": "reasoning", "summary": [{"text": "PRIVATE REASONING"}]},
        {"type": "function_call", "call_id": "call", "name": "propose_training_plan", "arguments": "{}"}]}
    event = {"type": "response.completed", "response": final}
    # Multi-line SSE data is JSON whitespace, not several independent events.
    multiline = "event: response.completed\r" + "\r".join(
        "data: " + line for line in json.dumps(event, indent=2).splitlines()) + "\r\r"
    state.chunks = [stream_frame("response.output_text.delta", delta="Provisional text"),
                    stream_frame("response.function_call_arguments.delta", delta="PRIVATE ARGUMENTS"),
                    multiline.encode()]

    async def receive(delta):
        deltas.append(delta)

    result = await ProductionCoachProvider(budget_guard=budget).respond([], tools=tool_definitions(), on_text_delta=receive)
    assert result == final and deltas == ["Provisional text"]
    assert response_parts(result, allow_tools=True)[0] == ""  # Caller must reset the provisional turn.
    assert budget.outcomes == ["success"] and state.closed == 1
    assert "PRIVATE" not in json.dumps(state.tracked)


@pytest.mark.parametrize("stalled", ["reader", "callback"])
async def test_stream_whole_turn_deadline_closes_stalled_io(streamed_provider, monkeypatch, stalled):
    from app.domains.workouts import coach

    state, budget = streamed_provider, FakeBudget()
    state.chunks = [stream_frame("response.output_text.delta", delta="Partial")]
    wait = asyncio.Event()
    if stalled == "reader":
        state.block = wait
    real_timeout = asyncio.timeout

    def deadline(seconds):
        assert seconds == 45
        return real_timeout(0.01)

    async def receive(_delta):
        if stalled == "callback":
            await wait.wait()

    monkeypatch.setattr(coach.asyncio, "timeout", deadline)
    with pytest.raises(CoachFailure, match="provider_unavailable"):
        await ProductionCoachProvider(budget_guard=budget).respond([], tools=[], on_text_delta=receive)
    assert state.closed == state.clients_closed == 1 and budget.outcomes == ["failed"]
    assert len(state.tracked) == len(state.tracked[0]["terminal"]) == state.tracked[0]["exits"] == 1


@pytest.mark.parametrize("case", ["missing", "truncated", "incomplete", "bad_json", "utf8", "bad_delta", "text_limit",
    "frame_limit", "wire_limit", "missing_usage", "final_limit", "tool", "refusal", "headers", "status",
    "timeout", "disconnect", "cancel", "callback"])
async def test_stream_failure_closes_io_and_never_marks_partial_success(streamed_provider, monkeypatch, case):
    state, budget, deltas = streamed_provider, FakeBudget(), []
    final = stream_result()
    terminal = stream_frame("response.completed", response=final)
    state.chunks = [stream_frame("response.output_text.delta", delta="Partial"), terminal]
    if case == "missing":
        state.chunks.pop()
    if case == "truncated":
        state.chunks[-1] = terminal.rstrip(b"\r\n")
    if case == "incomplete":
        state.chunks[-1] = stream_frame("response.incomplete", response=final)
    if case == "bad_json":
        state.chunks[-1] = b"data: PRIVATE INVALID JSON\n\n"
    if case == "utf8":
        state.chunks[-1] = b"data: \xff\n\n"
    if case == "bad_delta":
        state.chunks[-1] = stream_frame("response.output_text.delta", delta={"private": True})
    if case == "text_limit":
        state.chunks[-1] = stream_frame("response.output_text.delta", delta="🌴" * 12001)
    if case == "frame_limit":
        state.chunks[-1] = b"data: " + b"x" * 260001
    if case == "wire_limit":
        from app.domains.workouts import coach_stream

        monkeypatch.setattr(coach_stream, "MAX_WIRE_BYTES", 64)
        state.chunks = [b": heartbeat\n\n"] * 6
    if case == "missing_usage":
        state.chunks[-1] = stream_frame("response.completed", response=final | {"usage": None})
    if case == "final_limit":
        state.chunks[-1] = stream_frame("response.completed", response=final | {"padding": "x" * 256001})
    if case == "tool":
        state.chunks[-1] = stream_frame("response.completed", response=final | {"output": [
            {"type": "function_call", "call_id": "call", "name": "private", "arguments": "{}"}]})
    if case == "refusal":
        state.chunks[-1] = stream_frame("response.completed", response=final | {"output": [
            {"type": "message", "content": [{"type": "refusal", "refusal": "PRIVATE"}]}]})
    if case == "headers":
        state.content_type = "application/json"
    if case == "status":
        state.status = 503
    if case in {"timeout", "disconnect", "cancel"}:
        state.chunks.pop()
        state.error = {"timeout": TimeoutError(), "disconnect": httpx.RemoteProtocolError("PRIVATE"),
                       "cancel": asyncio.CancelledError()}[case]

    async def receive(delta):
        deltas.append(delta)
        if case == "callback":
            raise RuntimeError("PRIVATE CONSUMER DETAILS")

    with pytest.raises(asyncio.CancelledError if case == "cancel" else CoachFailure) as failure:
        await ProductionCoachProvider(budget_guard=budget).respond([], tools=[], on_text_delta=receive)
    assert state.closed == state.clients_closed == 1
    assert len(state.sent) == len(budget.reservations) == len(state.tracked) == 1
    assert budget.outcomes == ["cancelled" if case == "cancel" else "failed"]
    assert len(state.tracked[0]["terminal"]) == state.tracked[0]["exits"] == 1
    assert "PRIVATE" not in str(failure.value) and "PRIVATE" not in json.dumps(state.tracked)


async def test_stream_budget_denial_never_opens_http(streamed_provider):
    budget = FakeBudget(deny_at=1)

    async def receive(_delta):
        raise AssertionError("No callback without admission")

    with pytest.raises(CoachFailure, match="workouts_ai_budget_exceeded"):
        await ProductionCoachProvider(budget_guard=budget).respond([], tools=[], on_text_delta=receive)
    assert not streamed_provider.sent and not budget.outcomes
    assert len(streamed_provider.tracked) == 1 and streamed_provider.tracked[0]["exits"] == 1


def test_all_function_schemas_are_strict_and_required():
    tools = tool_definitions()
    assert len(tools) == 9
    for tool in tools:
        assert tool["strict"] is True
        schema = tool["parameters"]
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == set(schema["properties"])


@pytest.mark.parametrize(
    "data",
    [
        {"status": "incomplete", "output": []},
        {
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "private"}]}],
        },
        {
            "status": "completed",
            "output": [{"type": "function_call", "call_id": "a", "name": "x", "arguments": "[]"}],
        },
        {"status": "completed", "output": [{"type": "web_search_call"}]},
    ],
)
def test_refusal_truncation_unknown_output_and_bad_args_are_fail_closed(data):
    with pytest.raises(CoachFailure):
        response_parts(data, allow_tools=True)


def test_final_turn_cannot_request_more_tools():
    with pytest.raises(CoachFailure):
        response_parts(
            {
                "status": "completed",
                "output": [
                    {"type": "function_call", "call_id": "a", "name": "x", "arguments": "{}"}
                ],
            },
            allow_tools=False,
        )


def test_ids_must_have_been_inspected_in_context():
    with pytest.raises(CoachFailure):
        validate_inspected_ids(
            [("a", "adapt_saved_workout", {"workout_id": "unknown", "expected_revision": 1})],
            {"library": [], "programs": []},
        )


def test_nested_health_and_restricted_provider_derivatives_excluded():
    assert health_derived({"snapshot": {"origin_id": "unknown-health-origin"}})
    assert health_derived({"source_url": "https://strava.com/activities/1"})
    assert not health_derived({"origin_id": None, "name": "Manual basketball"})


def test_responses_usage_is_normalized_without_private_content():
    result = normalize_usage(
        {
            "id": "rsp",
            "output": [{"secret": True}],
            "usage": {
                "input_tokens": 100,
                "output_tokens": 12,
                "input_tokens_details": {"cached_tokens": 40},
                "output_tokens_details": {"reasoning_tokens": 3},
            },
        }
    )
    assert "secret" not in json.dumps(result)
    assert result["usage"]["prompt_tokens"] == 100
    assert result["usage"]["completion_tokens_details"]["reasoning_tokens"] == 3


@pytest.mark.parametrize(
    "environment,opt_in,injected,expected",
    [
        ("test", True, "dev", False),
        ("development", False, "dev", False),
        ("development", True, None, False),
        ("development", True, "dev", True),
        ("production", False, None, True),
    ],
)
def test_production_adapter_requires_explicit_dev_key_and_opt_in(
    monkeypatch, environment, opt_in, injected, expected
):
    from app.domains.workouts import coach

    configured = settings(workouts_ai_enabled=True).model_copy(
        update={"environment": environment, "allow_paid_ai_in_development": opt_in}
    )
    monkeypatch.setattr(coach, "get_settings", lambda: configured)
    assert bool(ProductionCoachProvider(development_api_key=injected).enabled) is expected


async def test_real_adapter_response_contract_and_safe_accounting(monkeypatch):
    from app import ai_governance
    from app.domains.workouts import coach

    configured = settings(workouts_ai_enabled=True).model_copy(
        update={"environment": "production", "workout_coach_model": "configured-model"}
    )
    monkeypatch.setattr(coach, "get_settings", lambda: configured)
    captured, tracked = [], []

    class Tracker:
        def __init__(self, **kwargs):
            tracked.append(kwargs)
            self.model = kwargs["primary_model"]

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def succeed(self, data):
            tracked.append(data)

        def fail(self, error):
            tracked.append(error)

    class Response:
        status_code = 200
        content = b"synthetic"

        def json(self):
            return {
                "id": "r",
                "status": "completed",
                "usage": {"input_tokens": 5, "output_tokens": 2},
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "SYNTHETIC PRIVATE RESPONSE"}],
                    }
                ],
            }

    class Client:
        def __init__(self, **kwargs):
            assert kwargs["timeout"] == 45

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **kwargs):
            captured.append((url, kwargs["json"]))
            return Response()

    monkeypatch.setattr(ai_governance, "AIInvocationTracker", Tracker)
    monkeypatch.setattr(coach.httpx, "AsyncClient", Client)
    budget = FakeBudget()
    result = await ProductionCoachProvider(budget_guard=budget).respond(
        [{"role": "user", "content": "synthetic"}], tools=tool_definitions()
    )
    assert result["status"] == "completed"
    url, body = captured[0]
    assert url.endswith("/v1/responses") and body["model"] == "configured-model"
    assert body["store"] is False and body["parallel_tool_calls"] is False
    assert body["max_output_tokens"] == 1800 and body["tools"][0]["strict"]
    assert body["service_tier"] == "default"
    assert budget.outcomes == ["success"]
    assert tracked[0]["capability"] == "workout_coach"
    assert "PRIVATE" not in json.dumps(tracked)


async def test_provider_error_never_exposes_response_details(monkeypatch):
    from app import ai_governance
    from app.domains.workouts import coach

    configured = settings(workouts_ai_enabled=True).model_copy(update={"environment": "production"})
    monkeypatch.setattr(coach, "get_settings", lambda: configured)

    class Tracker:
        def __init__(self, **kwargs):
            self.model = "synthetic"

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def fail(self, error):
            assert error == "provider_unavailable"

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            raise RuntimeError("PRIVATE PROVIDER DETAILS")

    monkeypatch.setattr(ai_governance, "AIInvocationTracker", Tracker)
    monkeypatch.setattr(coach.httpx, "AsyncClient", Client)
    with pytest.raises(CoachFailure) as error:
        await ProductionCoachProvider(budget_guard=FakeBudget()).respond([], tools=[])
    assert str(error.value) == "provider_unavailable"


def test_source_flow_preserves_only_grounded_retained_quotations_and_never_private_notes():
    flow = "Repeat the circuit for 20 minutes."
    workout = {
        "provenance": "source",
        "notes": [flow, "PRIVATE NOTE"],
        "blocks": [{"evidence": [
            {"field": "workout_notes", "wording": flow, "location": "caption"},
            {"field": "notes", "wording": "PRIVATE NOTE", "location": "caption"},
            {"field": "workout_notes", "wording": "UNRETAINED SOURCE", "location": "caption"},
            {"field": "workout_notes", "wording": "PRIVATE NOTE", "location": None},
        ]}],
    }
    before = json.dumps(workout)
    assert source_flow_context(workout) == [flow]
    assert json.dumps(workout) == before
    assert source_flow_context(workout | {"provenance": "user"}) == []
    assert source_flow_context(workout | {"provenance": "suggestion"}) == []
    assert source_flow_context(workout | {"notes": []}) == []


def test_source_flow_bounds_whole_quotes_and_supports_legacy_grouping_evidence():
    notes = ["AMRAP: repeat for 20 minutes.", "x" * 2001] + [f"Repeat round {i}" for i in range(10)]
    workout = {"provenance": "source", "notes": notes, "blocks": [{"evidence": [
        {"field": "grouping" if i == 0 else "workout_notes", "wording": note, "location": "caption"}
        for i, note in enumerate(notes)
    ]}]}
    result = source_flow_context(workout)
    assert result[0] == notes[0] and notes[1] not in result
    assert len(result) == 6 and sum(map(len, result)) <= 2000
    assert all(quote in notes for quote in result)


def test_title_only_edit_trimming_notes_preserves_original_creator_quote():
    quote = "  Repeat the circuit for 20 minutes.\n"
    workout = {
        "title": "Original title", "provenance": "source", "notes": [quote],
        "blocks": [{"evidence": [
            {"field": "workout_notes", "wording": quote, "location": "caption"},
        ]}],
    }
    edited = workout | {"title": "My title", "notes": [quote.strip()]}
    assert source_flow_context(edited) == [quote]
    assert source_flow_context(edited | {"notes": ["Repeat it for 15 minutes."]}) == []


@pytest.mark.parametrize("quote", ["Repeat the circuit for 20 minutes.", "Repeat \u00e9 " * 200])
def test_source_quotes_fit_remaining_serialized_item_budget_without_splitting_instructions(quote):
    item = {"id": "workout", "revision": 1, "content": {"title": "Source circuit"}}
    item["content"]["padding"] = "x" * (13999 - len(json.dumps(item | {"content": item["content"] | {"padding": ""}})))
    original = json.loads(json.dumps(item))
    workout = {"provenance": "source", "notes": [quote], "blocks": [{"evidence": [
        {"field": "workout_notes", "wording": quote, "location": "caption"},
    ]}]}
    assert fit_source_flow_context(item, workout)
    assert item == original and len(json.dumps(item)) == 13999


def test_source_quote_budget_can_keep_a_later_whole_short_quote():
    long_quote, short_quote = "Repeat \u00e9 " * 100, "Rest as needed."
    workout = {"provenance": "source", "notes": [long_quote, short_quote], "blocks": [{"evidence": [
        {"field": "workout_notes", "wording": quote, "location": "caption"}
        for quote in [long_quote, short_quote]
    ]}]}
    item = {"id": "workout", "revision": 1, "content": {"padding": "x" * 13800}}
    assert fit_source_flow_context(item, workout)
    assert item["content"]["source_instructions"] == [short_quote]
    assert len(json.dumps(item)) < 14000


def test_coach_reads_new_grounded_instructions_without_legacy_private_annotations():
    quote = "Rest after each round."
    workout = {"provenance": "source", "instructions": [quote], "notes": ["Private health note"],
        "blocks": [{"evidence": [{"field": "workout_instructions", "wording": quote, "location": "caption"},
            {"field": "workout_notes", "wording": "Private health note", "location": "caption"}]}]}
    assert source_flow_context(workout) == [quote]


async def test_image_provider_attempt_truthfully_admits_vision_and_only_uses_supplied_private_input(streamed_provider):
    state, budget = streamed_provider, FakeBudget()
    state.chunks = [stream_frame("response.completed", response=stream_result())]
    items = [{"role": "user", "content": [{"type": "input_image", "image_url": "https://signed.test/owned?ttl=60", "detail": "high"}]}]
    async def receive(_delta):
        pass
    await ProductionCoachProvider(budget_guard=budget).respond(items, tools=tool_definitions(), on_text_delta=receive)
    envelope = budget.reservations[0][2]
    assert envelope.includes_images is True and envelope.function_tools is True
    assert envelope.max_output_tokens == 1800 and envelope.sdk_max_retries == 0
    assert state.sent[0]["input"] == items and state.sent[0]["store"] is False
    assert len(budget.reservations) == 1 and budget.outcomes == ["success"]
