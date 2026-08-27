"""Streaming chat protocol, cancellation, and accounting coverage."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

import app.routers.chat as chat_router_module
from app import ai_governance
from app.auth import ClerkUser
from app.routers.chat import ChatRequest


class FakeProviderStream:
    """Small async iterator matching the OpenAI stream behavior used by chat."""

    def __init__(self, chunks):
        self._chunks = iter(chunks)
        self.close = AsyncMock()

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._chunks)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class FakeRequest:
    def __init__(self, disconnected: bool = False):
        self.disconnected = disconnected

    async def is_disconnected(self):
        return self.disconnected


def provider_chunk(text: str | None, *, usage=None):
    choices = [] if text is None else [
        SimpleNamespace(delta=SimpleNamespace(content=text)),
    ]
    return SimpleNamespace(id="provider-stream", choices=choices, usage=usage)


def decode_events(events: list[bytes]) -> list[dict]:
    return [json.loads(event) for event in events]


def stable_user() -> ClerkUser:
    return ClerkUser(
        id="stable-stream-user",
        clerk_user_id="replaceable-clerk-subject",
        clerk_issuer="https://example.clerk.accounts.dev",
        clerk_environment="development",
    )


@pytest.mark.asyncio
async def test_chat_stream_emits_bounded_deltas_and_records_success(monkeypatch):
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
async def test_recipe_stream_reuses_recipe_access_policy(monkeypatch):
    recipe = SimpleNamespace(
        user_id="another-user",
        is_public=False,
        extracted={"title": "Private soup", "components": []},
    )

    class FakeResult:
        def scalar_one_or_none(self):
            return recipe

    class FakeDatabase:
        async def execute(self, _statement):
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
