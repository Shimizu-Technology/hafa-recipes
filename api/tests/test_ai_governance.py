"""Privacy, accounting, routing, and extraction-gate coverage."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

import app.routers.chat as chat_router_module
from app import ai_governance
from app.ai_governance import (
    AIInvocationTracker,
    ai_request_context,
    estimate_cost_microusd,
    extract_token_usage,
    select_ai_model,
)
from app.auth import ClerkUser
from app.config import Settings
from app.models.ai import AIInvocation
from app.routers.chat import ChatRequest, chat_about_recipe
from app.services.llm_client import LLMService


def test_usage_and_cost_include_cached_tokens_without_double_counting():
    response = SimpleNamespace(
        usage=SimpleNamespace(
            prompt_tokens=1_000,
            completion_tokens=200,
            prompt_tokens_details=SimpleNamespace(cached_tokens=400),
            completion_tokens_details=SimpleNamespace(reasoning_tokens=50),
        )
    )

    usage = extract_token_usage(response)

    assert usage == {
        "input_tokens": 1_000,
        "cached_input_tokens": 400,
        "output_tokens": 200,
        "reasoning_tokens": 50,
    }
    assert (
        estimate_cost_microusd(
            "gpt-5.6-luna",
            **{
                "input_tokens": usage["input_tokens"],
                "cached_input_tokens": usage["cached_input_tokens"],
                "output_tokens": usage["output_tokens"],
            },
        )
        == 368
    )
    assert (
        estimate_cost_microusd(
            "unknown-model",
            input_tokens=1,
            cached_input_tokens=0,
            output_tokens=1,
        )
        is None
    )


def test_canary_is_deterministic_and_zero_percent_rolls_back(monkeypatch):
    configured = SimpleNamespace(
        ai_canary_models={"recipe_extraction": "candidate-model"},
        ai_canary_percentages={"recipe_extraction": 100},
    )
    monkeypatch.setattr(ai_governance, "get_settings", lambda: configured)

    with ai_request_context(request_id="request_one"):
        first = select_ai_model("recipe_extraction", "primary-model")
        second = select_ai_model("recipe_extraction", "primary-model")

    assert first == second
    assert first.model == "candidate-model"
    assert first.variant == "canary"

    configured.ai_canary_percentages["recipe_extraction"] = 0
    with ai_request_context(request_id="request_one"):
        rolled_back = select_ai_model("recipe_extraction", "primary-model")
    assert rolled_back.model == "primary-model"
    assert rolled_back.variant == "primary"


def test_config_rejects_invalid_canary_and_pricing():
    with pytest.raises(ValueError, match="between 0 and 100"):
        Settings(
            database_url="postgresql://user:pass@example.com/db",
            openai_api_key="test",
            ai_canary_models={"ocr": "candidate"},
            ai_canary_percentages={"ocr": 101},
        )

    with pytest.raises(ValueError, match="missing required token rates"):
        Settings(
            database_url="postgresql://user:pass@example.com/db",
            openai_api_key="test",
            ai_model_pricing={"candidate": {"input_per_million": 1.0}},
        )


@pytest.mark.asyncio
async def test_tracker_records_safe_context_and_validated_outcome(monkeypatch):
    recorded = AsyncMock()
    monkeypatch.setattr(ai_governance, "record_ai_invocation", recorded)
    monkeypatch.setattr(
        ai_governance,
        "get_settings",
        lambda: SimpleNamespace(ai_canary_models={}, ai_canary_percentages={}),
    )

    with ai_request_context(
        request_id="request_safe",
        user_id="user_internal",
        job_id="11111111-1111-4111-8111-111111111111",
    ):
        async with AIInvocationTracker(
            capability="ocr",
            primary_model="model-a",
            prompt_version="prompt-v1",
            schema_version="schema-v1",
        ) as invocation:
            invocation.fail(
                "invalid_schema",
                {
                    "id": "provider_request",
                    "usage": {"prompt_tokens": 12, "completion_tokens": 3},
                    "private_output": "must not be forwarded as a field",
                },
            )

    kwargs = recorded.await_args.kwargs
    assert kwargs["capability"] == "ocr"
    assert kwargs["status"] == "failed"
    assert kwargs["error_code"] == "invalid_schema"
    assert "private_output" not in kwargs


@pytest.mark.asyncio
async def test_recipe_chat_marks_success_before_tracker_exits(monkeypatch):
    recipe = SimpleNamespace(
        user_id="user_chat_tracker",
        is_public=False,
        extracted={"title": "Soup", "components": []},
    )

    class FakeResult:
        def scalar_one_or_none(self):
            return recipe

    class FakeDatabase:
        async def execute(self, _statement):
            return FakeResult()

    provider_response = SimpleNamespace(
        id="provider_request",
        choices=[SimpleNamespace(message=SimpleNamespace(content="Use low heat."))],
        usage=None,
    )
    monkeypatch.setattr(
        chat_router_module.openai_client.chat.completions,
        "create",
        AsyncMock(return_value=provider_response),
    )
    recorded = AsyncMock()
    monkeypatch.setattr(ai_governance, "record_ai_invocation", recorded)

    response = await chat_about_recipe(
        UUID("31111111-1111-4111-8111-111111111111"),
        ChatRequest(message="How should I heat this?"),
        db=FakeDatabase(),
        user=ClerkUser(
            id="user_chat_tracker",
            clerk_user_id="clerk_chat_tracker",
            clerk_issuer="https://example.clerk.accounts.dev",
            clerk_environment="development",
        ),
    )

    assert response.response == "Use low heat."
    assert recorded.await_args.kwargs["status"] == "success"
    assert recorded.await_args.kwargs["error_code"] is None


def test_provenance_schema_has_no_prompt_or_content_columns():
    columns = set(AIInvocation.__table__.columns.keys())
    forbidden = {"prompt", "response", "content", "source_url", "raw_text", "chat"}
    assert forbidden.isdisjoint(columns)


@pytest.mark.parametrize(
    ("recipe", "expected"),
    [
        (None, "invalid_json"),
        ({"title": "Soup", "components": ["bad"]}, "invalid_components"),
        ({"title": "", "components": []}, "missing_title"),
        (
            {"title": "Soup", "components": [{"ingredients": [], "steps": ["Cook"]}]},
            "missing_ingredients",
        ),
        (
            {"title": "Soup", "components": [{"ingredients": [{"name": "water"}], "steps": []}]},
            "missing_steps",
        ),
    ],
)
def test_recipe_fallback_gate_is_deterministic(recipe, expected):
    raw_error = LLMService._raw_recipe_validation_error(recipe)
    if raw_error:
        assert raw_error == expected
    else:
        assert LLMService._recipe_validation_error(recipe) == expected
