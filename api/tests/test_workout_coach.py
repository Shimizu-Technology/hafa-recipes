"""Deterministic coach contracts; no real provider calls or native acceptance claims."""

import json

import pytest

from app.domains.workouts.coach import (
    CoachFailure,
    ProductionCoachProvider,
    normalize_usage,
    response_parts,
    validate_inspected_ids,
)
from app.domains.workouts.coach_actions import health_derived, tool_definitions
from tests.test_workouts_data_integration import settings


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
    result = await ProductionCoachProvider().respond(
        [{"role": "user", "content": "synthetic"}], tools=tool_definitions()
    )
    assert result["status"] == "completed"
    url, body = captured[0]
    assert url.endswith("/v1/responses") and body["model"] == "configured-model"
    assert body["store"] is False and body["parallel_tool_calls"] is False
    assert body["max_output_tokens"] == 1800 and body["tools"][0]["strict"]
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
        await ProductionCoachProvider().respond([], tools=[])
    assert str(error.value) == "provider_unavailable"
