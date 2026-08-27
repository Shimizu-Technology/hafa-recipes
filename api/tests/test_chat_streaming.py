"""Streaming chat protocol, cancellation, and accounting coverage."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

import app.routers.chat as chat_router_module
from app import ai_governance
from app.auth import ClerkUser
from app.rate_limit import RateLimitExceeded
from app.routers.chat import ChatRequest


class FakeProviderStream:
    """Small async iterator matching the OpenAI stream behavior used by chat."""

    def __init__(self, chunks):
        """Store provider chunks and expose an awaitable close spy."""
        self._chunks = iter(chunks)
        self.close = AsyncMock()

    def __aiter__(self):
        """Return this fake as its own asynchronous iterator."""
        return self

    async def __anext__(self):
        """Return the next provider chunk or terminate the async iterator."""
        try:
            return next(self._chunks)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class StalledProviderStream:
    """Provider stream that never produces its next application-level chunk."""

    def __init__(self):
        """Expose an awaitable close spy for timeout assertions."""
        self.close = AsyncMock()

    def __aiter__(self):
        """Return this stalled fake as its asynchronous iterator."""
        return self

    async def __anext__(self):
        """Wait forever unless the production idle timeout cancels the call."""
        await asyncio.Event().wait()


class FakeRequest:
    """Minimal FastAPI request stand-in for disconnect polling."""

    def __init__(self, disconnected: bool = False):
        """Initialize the request with a fixed connection state."""
        self.disconnected = disconnected

    async def is_disconnected(self):
        """Return the configured client connection state."""
        return self.disconnected


def provider_chunk(text: str | None, *, usage=None):
    """Build the portion of an OpenAI stream chunk consumed by the router."""
    choices = [] if text is None else [
        SimpleNamespace(delta=SimpleNamespace(content=text)),
    ]
    return SimpleNamespace(id="provider-stream", choices=choices, usage=usage)


def decode_events(events: list[bytes]) -> list[dict]:
    """Decode newline-delimited JSON event payloads for exact assertions."""
    return [json.loads(event) for event in events]


def stable_user() -> ClerkUser:
    """Return a stable application identity with separate Clerk metadata."""
    return ClerkUser(
        id="stable-stream-user",
        clerk_user_id="replaceable-clerk-subject",
        clerk_issuer="https://example.clerk.accounts.dev",
        clerk_environment="development",
    )


@pytest.mark.asyncio
async def test_chat_stream_emits_bounded_deltas_and_records_success(monkeypatch):
    """A healthy provider stream emits deltas, completion, and usage accounting."""
    usage = SimpleNamespace(prompt_tokens=8, completion_tokens=4)
    provider_stream = FakeProviderStream([
        provider_chunk("Use low "),
        provider_chunk("heat."),
        provider_chunk(None, usage=usage),
    ])
    create = AsyncMock(return_value=provider_stream)
    monkeypatch.setattr(chat_router_module.openai_client.chat.completions, "create", create)
    recorded = AsyncMock()
    monkeypatch.setattr(ai_governance, "record_ai_invocation", recorded)

    events = [event async for event in chat_router_module._stream_chat_events(
        http_request=FakeRequest(),
        messages=[{"role": "user", "content": "How should I warm this?"}],
        user_id=f"stream-success-{uuid4()}",
        capability="cooking_chat",
        model="test-model",
        prompt_version="test-prompt",
    )]

    assert decode_events(events) == [
        {"type": "delta", "text": "Use low "},
        {"type": "delta", "text": "heat."},
        {"type": "done"},
    ]
    assert create.await_args.kwargs["stream"] is True
    assert create.await_args.kwargs["stream_options"] == {"include_usage": True}
    assert recorded.await_args.kwargs["status"] == "success"
    assert recorded.await_args.kwargs["response"].usage is usage
    provider_stream.close.assert_not_awaited()


@pytest.mark.asyncio
async def test_chat_stream_closes_provider_and_records_client_disconnect(monkeypatch):
    """A disconnected client closes the provider and records cancellation."""
    provider_stream = FakeProviderStream([provider_chunk("Never delivered")])
    monkeypatch.setattr(
        chat_router_module.openai_client.chat.completions,
        "create",
        AsyncMock(return_value=provider_stream),
    )
    recorded = AsyncMock()
    monkeypatch.setattr(ai_governance, "record_ai_invocation", recorded)

    events = [event async for event in chat_router_module._stream_chat_events(
        http_request=FakeRequest(disconnected=True),
        messages=[{"role": "user", "content": "Stop this response"}],
        user_id=f"stream-cancel-{uuid4()}",
        capability="cooking_chat",
        model="test-model",
        prompt_version="test-prompt",
    )]

    assert events == []
    provider_stream.close.assert_awaited_once()
    assert recorded.await_args.kwargs["status"] == "cancelled"
    assert recorded.await_args.kwargs["error_code"] == "client_disconnected"


@pytest.mark.asyncio
async def test_chat_stream_returns_safe_provider_error_event(monkeypatch):
    """Provider failures produce a safe public error without leaking details."""
    monkeypatch.setattr(
        chat_router_module.openai_client.chat.completions,
        "create",
        AsyncMock(side_effect=RuntimeError("private provider detail")),
    )
    recorded = AsyncMock()
    monkeypatch.setattr(ai_governance, "record_ai_invocation", recorded)

    events = [event async for event in chat_router_module._stream_chat_events(
        http_request=FakeRequest(),
        messages=[{"role": "user", "content": "Hello"}],
        user_id=f"stream-error-{uuid4()}",
        capability="cooking_chat",
        model="test-model",
        prompt_version="test-prompt",
    )]

    assert decode_events(events) == [{
        "type": "error",
        "status": 500,
        "code": "provider_error",
        "message": "The cooking assistant is temporarily unavailable. Please try again.",
    }]
    assert recorded.await_args.kwargs["status"] == "provider_error"
    assert "private provider detail" not in events[0].decode()


@pytest.mark.asyncio
async def test_chat_stream_times_out_a_stalled_provider(monkeypatch):
    """A provider that stops yielding receives a bounded 504 terminal event."""
    provider_stream = StalledProviderStream()
    monkeypatch.setattr(chat_router_module, "CHAT_STREAM_IDLE_TIMEOUT_SECONDS", 0.001)
    monkeypatch.setattr(
        chat_router_module.openai_client.chat.completions,
        "create",
        AsyncMock(return_value=provider_stream),
    )
    recorded = AsyncMock()
    monkeypatch.setattr(ai_governance, "record_ai_invocation", recorded)

    events = [event async for event in chat_router_module._stream_chat_events(
        http_request=FakeRequest(),
        messages=[{"role": "user", "content": "Hello"}],
        user_id=f"stream-stalled-{uuid4()}",
        capability="cooking_chat",
        model="test-model",
        prompt_version="test-prompt",
    )]

    assert decode_events(events) == [{
        "type": "error",
        "status": 504,
        "code": "provider_stream_stalled",
        "message": "The assistant took too long to continue. Please try again.",
    }]
    provider_stream.close.assert_awaited_once()
    assert recorded.await_args.kwargs["status"] == "failed"
    assert recorded.await_args.kwargs["error_code"] == "provider_stream_stalled"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("chunks", "max_chars", "expected_code"),
    [
        ([provider_chunk(None)], 16_000, "empty_response"),
        ([provider_chunk("four")], 3, "response_too_large"),
    ],
)
async def test_chat_stream_rejects_empty_and_oversized_responses(
    monkeypatch,
    chunks,
    max_chars,
    expected_code,
):
    """Empty and over-budget responses fail with explicit terminal codes."""
    provider_stream = FakeProviderStream(chunks)
    monkeypatch.setattr(chat_router_module, "MAX_CHAT_RESPONSE_CHARS", max_chars)
    monkeypatch.setattr(
        chat_router_module.openai_client.chat.completions,
        "create",
        AsyncMock(return_value=provider_stream),
    )
    recorded = AsyncMock()
    monkeypatch.setattr(ai_governance, "record_ai_invocation", recorded)

    events = [event async for event in chat_router_module._stream_chat_events(
        http_request=FakeRequest(),
        messages=[{"role": "user", "content": "Hello"}],
        user_id=f"stream-terminal-{uuid4()}",
        capability="cooking_chat",
        model="test-model",
        prompt_version="test-prompt",
    )]

    assert decode_events(events)[-1]["code"] == expected_code
    assert recorded.await_args.kwargs["status"] == "failed"
    assert recorded.await_args.kwargs["error_code"] == expected_code
    if expected_code == "response_too_large":
        provider_stream.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_chat_stream_returns_rate_limit_event(monkeypatch):
    """A rejected rate-limit lease becomes a retryable stream event."""

    class RejectedLimit:
        """Async context manager that rejects before provider invocation."""

        async def __aenter__(self):
            """Raise the same structured exception as the real limiter."""
            raise RateLimitExceeded(7, "rate_limit")

        async def __aexit__(self, *_args):
            """Do not suppress errors leaving the fake lease."""
            return False

    def rejected_limit(**_kwargs):
        """Return a rejecting rate-limit context manager."""
        return RejectedLimit()

    monkeypatch.setattr(chat_router_module.ai_rate_limiter, "limit", rejected_limit)

    events = [event async for event in chat_router_module._stream_chat_events(
        http_request=FakeRequest(),
        messages=[{"role": "user", "content": "Hello"}],
        user_id=f"stream-limited-{uuid4()}",
        capability="cooking_chat",
        model="test-model",
        prompt_version="test-prompt",
    )]

    assert decode_events(events) == [{
        "type": "error",
        "status": 429,
        "code": "rate_limit",
        "message": "You have sent too many AI requests. Please try again shortly.",
        "retry_after": 7,
    }]


@pytest.mark.asyncio
async def test_recipe_stream_reuses_recipe_access_policy(monkeypatch):
    """The stream endpoint denies a private recipe owned by another user."""
    recipe = SimpleNamespace(
        user_id="another-user",
        is_public=False,
        extracted={"title": "Private soup", "components": []},
    )

    class FakeResult:
        """Database result returning the inaccessible recipe."""

        def scalar_one_or_none(self):
            """Return the configured recipe record."""
            return recipe

    class FakeDatabase:
        """Minimal async database stand-in used by the route."""

        async def execute(self, _statement):
            """Return a scalar result containing the inaccessible recipe."""
            return FakeResult()

    monkeypatch.setattr(
        chat_router_module,
        "user_can_access_recipe",
        AsyncMock(return_value=False),
    )

    with pytest.raises(HTTPException) as exc_info:
        await chat_router_module.stream_chat_about_recipe(
            UUID("41111111-1111-4111-8111-111111111111"),
            ChatRequest(message="Show me this recipe"),
            FakeRequest(),
            db=FakeDatabase(),
            user=stable_user(),
        )

    assert exc_info.value.status_code == 403
