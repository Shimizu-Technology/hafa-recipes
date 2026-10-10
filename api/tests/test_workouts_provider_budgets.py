"""Provider-boundary budgets; all transports/audio are fake, never paid."""

# ruff: noqa: F811 -- imported isolated PostgreSQL fixtures
import asyncio
import json

import pytest
from sqlalchemy import select

from app import ai_governance, config
from app.domains.workouts import coach, extraction
from app.domains.workouts.budget import BudgetGuard
from app.domains.workouts.budget_models import WorkoutsAIAdmission
from app.domains.workouts.coach import CoachFailure, ProductionCoachProvider
from app.domains.workouts.extraction import (
    ExtractionFailure,
    ProductionExtractionProvider,
    SourceBundle,
    SourceMetadata,
    SourcePart,
)
from app.services.video import video_service
from tests.test_workout_extraction import TEXT, complete_workout
from tests.test_workouts_ai_budget import budget_api, policy  # noqa: F401
from tests.test_workouts_data_integration import data_api, settings  # noqa: F401
from tests.workouts_provider_fakes import FakeBudget


class Tracker:
    selected_model = None
    attempts = []

    def __init__(self, **values):
        self.model = self.selected_model or values["primary_model"]
        self.status = None
        self.values = values
        self.attempts.append(self)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def succeed(self, response=None):
        self.status = "success"

    def fail(self, code, response=None):
        self.status = code


@pytest.fixture
async def provider_environment(monkeypatch):
    configured = settings(workouts_imports_enabled=True, workouts_ai_enabled=True).model_copy(
        update={
            "environment": "development",
            "allow_paid_ai_in_development": True,
            "workout_extraction_model": "gpt-5.6-luna",
            "workout_extraction_fallback_model": "gpt-5.6-terra",
            "workout_coach_model": "gpt-5.6-luna",
            "transcription_model": "whisper-1",
        }
    )
    monkeypatch.setattr(config, "get_settings", lambda: configured)
    monkeypatch.setattr(coach, "get_settings", lambda: configured)
    monkeypatch.setattr(ai_governance, "AIInvocationTracker", Tracker)
    Tracker.attempts, Tracker.selected_model = [], None
    return configured


def source():
    return SourceBundle(SourceMetadata(), [SourcePart("provided_text", TEXT)])


class Response:
    status_code = 200
    content = b"synthetic"

    def __init__(self, data):
        self.data = data

    def json(self):
        return self.data


def completion(value=None):
    return {
        "choices": [
            {
                "finish_reason": "stop",
                "message": {
                    "content": json.dumps(value if value is not None else complete_workout())
                },
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1},
    }


def coach_response():
    return {
        "id": "fake",
        "status": "completed",
        "usage": {"input_tokens": 2, "output_tokens": 1},
        "output": [
            {"type": "message", "content": [{"type": "output_text", "text": "Synthetic reply"}]}
        ],
    }


def install_http(monkeypatch, *, values=None, callback=None):
    captured = []

    class Transport:
        def __init__(self, *, retries):
            assert retries == 0
            self.retries = retries

    monkeypatch.setattr(extraction.httpx, "AsyncHTTPTransport", Transport)

    class Client:
        def __init__(self, **kwargs):
            self.values = kwargs
            assert kwargs["transport"].retries == 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **kwargs):
            captured.append((url, kwargs["json"]))
            if callback:
                return await callback(captured)
            value = values[len(captured) - 1] if values else completion()
            return Response(value)

    monkeypatch.setattr(extraction.httpx, "AsyncClient", Client)
    return captured


@pytest.mark.parametrize("kind", ["extraction", "coach"])
async def test_denied_admission_means_zero_http_calls(provider_environment, monkeypatch, kind):
    calls = install_http(monkeypatch)
    guard = FakeBudget(deny_at=1)
    if kind == "extraction":
        with pytest.raises(ExtractionFailure) as caught:
            await ProductionExtractionProvider(
                development_api_key="fake", budget_guard=guard
            ).extract(source())
        assert caught.value.code == "workouts_ai_budget_exceeded"
    else:
        with pytest.raises(CoachFailure) as caught:
            await ProductionCoachProvider(development_api_key="fake", budget_guard=guard).respond(
                [], tools=[]
            )
        assert str(caught.value) == "workouts_ai_budget_exceeded"
    assert calls == [] and guard.outcomes == []
    assert Tracker.attempts[0].status == "workouts_ai_budget_exceeded"


async def test_each_fallback_has_separate_selected_model_envelope(
    provider_environment, monkeypatch
):
    calls = install_http(monkeypatch, values=[completion({"ingredients": []}), completion()])
    guard = FakeBudget()
    await ProductionExtractionProvider(development_api_key="fake", budget_guard=guard).extract(
        source()
    )
    assert [model for _, model, _ in guard.reservations] == ["gpt-5.6-luna", "gpt-5.6-terra"]
    assert guard.outcomes == ["failed", "success"]
    for (_, payload), (_, model, envelope) in zip(calls, guard.reservations):
        assert payload["model"] == model
        assert payload["max_completion_tokens"] == envelope.max_output_tokens == 6000
        assert payload["service_tier"] == envelope.service_tier == "default"
        assert payload["store"] is False and envelope.sdk_max_retries == 0


async def test_denied_fallback_does_not_send_second_http_call(provider_environment, monkeypatch):
    calls = install_http(monkeypatch, values=[completion({"ingredients": []})])
    guard = FakeBudget(deny_at=2)
    with pytest.raises(ExtractionFailure, match="workouts_ai_budget_exceeded"):
        await ProductionExtractionProvider(development_api_key="fake", budget_guard=guard).extract(
            source()
        )
    assert len(calls) == 1 and guard.outcomes == ["failed"]


async def test_canary_selected_model_is_reserved_and_sent(provider_environment, monkeypatch):
    Tracker.selected_model = "gpt-5.6-terra"
    calls = install_http(monkeypatch)
    guard = FakeBudget()
    await ProductionExtractionProvider(development_api_key="fake", budget_guard=guard).extract(
        source()
    )
    assert calls[0][1]["model"] == guard.reservations[0][1] == Tracker.selected_model


async def test_each_coach_round_has_own_envelope_and_standard_tier(
    provider_environment, monkeypatch
):
    calls = install_http(monkeypatch, values=[coach_response(), coach_response()])
    guard = FakeBudget()
    provider = ProductionCoachProvider(development_api_key="fake", budget_guard=guard)
    tools = [{"type": "function", "name": "synthetic", "parameters": {}}]
    await provider.respond([], tools=tools)
    await provider.respond([], tools=[])
    assert len(calls) == len(guard.reservations) == 2
    assert guard.outcomes == ["success", "success"]
    for (_, payload), (capability, model, envelope) in zip(calls, guard.reservations):
        assert capability == "workout_coach" and model == payload["model"]
        assert envelope.endpoint == "responses"
        assert payload["max_output_tokens"] == envelope.max_output_tokens == 1800
        assert envelope.function_tools is bool(payload["tools"])
        assert payload["service_tier"] == envelope.service_tier == "default"
        assert payload["store"] is False and envelope.sdk_max_retries == 0


@pytest.mark.parametrize("kind", ["extraction", "coach"])
async def test_provider_cancellation_records_consumed_cancelled_outcome(
    provider_environment, monkeypatch, kind
):
    async def cancel(_):
        raise asyncio.CancelledError()

    calls = install_http(monkeypatch, callback=cancel)
    guard = FakeBudget()
    with pytest.raises(asyncio.CancelledError):
        if kind == "extraction":
            await ProductionExtractionProvider(
                development_api_key="fake", budget_guard=guard
            ).extract(source())
        else:
            await ProductionCoachProvider(development_api_key="fake", budget_guard=guard).respond(
                [], tools=[]
            )
    assert len(calls) == 1 and guard.outcomes == ["cancelled"]
    assert Tracker.attempts[0].status == "cancelled"


def install_audio(monkeypatch, *, value="Synthetic transcript", error=None):
    import openai

    calls, clients = [], []

    class Client:
        def __init__(self, **kwargs):
            clients.append(kwargs)
            self.audio = self
            self.transcriptions = self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def create(self, **kwargs):
            calls.append(kwargs)
            if error:
                raise error
            return value

    monkeypatch.setattr(openai, "AsyncOpenAI", Client)
    return clients, calls


@pytest.mark.parametrize("duration", [None, 0, -1, True, float("nan"), float("inf"), 1801])
async def test_invalid_independent_audio_probe_means_no_provider(
    provider_environment, monkeypatch, tmp_path, duration
):
    async def probe(_):
        return duration

    monkeypatch.setattr(video_service, "_get_media_duration", probe)
    clients, calls = install_audio(monkeypatch)
    guard = FakeBudget()
    with pytest.raises(ExtractionFailure, match="audio_duration_unverified"):
        await ProductionExtractionProvider(
            development_api_key="fake", budget_guard=guard
        ).transcribe(str(tmp_path / "not-required.mp3"))
    assert clients == calls == guard.reservations == []


async def test_probe_failure_is_safe_and_prevents_audio_call(
    provider_environment, monkeypatch, tmp_path
):
    async def probe(_):
        raise RuntimeError("PRIVATE PATH")

    monkeypatch.setattr(video_service, "_get_media_duration", probe)
    clients, calls = install_audio(monkeypatch)
    with pytest.raises(ExtractionFailure, match="audio_duration_unverified"):
        await ProductionExtractionProvider(
            development_api_key="fake", budget_guard=FakeBudget()
        ).transcribe(str(tmp_path / "missing"))
    assert clients == calls == []


async def test_audio_reserves_verified_rounded_bound_and_no_sdk_retry(
    provider_environment, monkeypatch, tmp_path
):
    path = tmp_path / "bounded.mp3"
    path.write_bytes(b"synthetic-not-real-audio")
    observed = []

    async def probe(value):
        observed.append(value)
        return 61.25

    monkeypatch.setattr(video_service, "_get_media_duration", probe)
    clients, calls = install_audio(monkeypatch)
    guard = FakeBudget()
    assert (
        await ProductionExtractionProvider(
            development_api_key="fake", budget_guard=guard
        ).transcribe(str(path))
        == "Synthetic transcript"
    )
    assert observed == [str(path)]
    capability, model, envelope = guard.reservations[0]
    assert capability == "workout_transcription" and model == calls[0]["model"] == "whisper-1"
    assert envelope.audio_duration_verified and envelope.audio_seconds_upper_bound == 62
    assert clients[0]["max_retries"] == envelope.sdk_max_retries == 0
    assert clients[0]["base_url"] == "https://api.openai.com/v1"
    assert guard.outcomes == ["success"]


async def test_audio_budget_denial_creates_no_sdk_client(
    provider_environment, monkeypatch, tmp_path
):
    async def probe(_):
        return 45.0

    monkeypatch.setattr(video_service, "_get_media_duration", probe)
    clients, calls = install_audio(monkeypatch)
    with pytest.raises(ExtractionFailure, match="workouts_ai_budget_exceeded"):
        await ProductionExtractionProvider(
            development_api_key="fake", budget_guard=FakeBudget(deny_at=1)
        ).transcribe(str(tmp_path / "not-opened"))
    assert clients == calls == []


@pytest.mark.parametrize(
    "error", [asyncio.CancelledError(), RuntimeError("PRIVATE PROVIDER AUDIO DETAILS")]
)
async def test_audio_failure_or_cancellation_never_refunds(
    provider_environment, monkeypatch, tmp_path, error
):
    async def probe(_):
        return 40.0

    monkeypatch.setattr(video_service, "_get_media_duration", probe)
    path = tmp_path / "bounded.mp3"
    path.write_bytes(b"synthetic")
    _, calls = install_audio(monkeypatch, error=error)
    guard = FakeBudget()
    with pytest.raises(
        asyncio.CancelledError if isinstance(error, asyncio.CancelledError) else ExtractionFailure
    ):
        await ProductionExtractionProvider(
            development_api_key="fake", budget_guard=guard
        ).transcribe(str(path))
    assert len(calls) == 1
    assert guard.outcomes == [
        "cancelled" if isinstance(error, asyncio.CancelledError) else "failed"
    ]
    assert Tracker.attempts[0].status in {"cancelled", "transcription_failed"}


async def test_default_unconfigured_guard_prevents_http_without_database(
    provider_environment, monkeypatch
):
    calls = install_http(monkeypatch)
    with pytest.raises(ExtractionFailure, match="workouts_ai_budget_unconfigured"):
        await ProductionExtractionProvider(development_api_key="fake").extract(source())
    assert calls == []


async def test_durable_reservation_exists_before_transport_and_denies_next_call(
    budget_api, provider_environment, monkeypatch
):
    guard = BudgetGuard(policy(budget=471800), session_factory=budget_api.sessions)

    async def respond(_):
        async with budget_api.sessions() as db:
            row = await db.scalar(select(WorkoutsAIAdmission))
            assert row and row.outcome == "unknown" and row.finished_at is None
        return Response(completion())

    calls = install_http(monkeypatch, callback=respond)
    provider = ProductionExtractionProvider(development_api_key="fake", budget_guard=guard)
    await provider.extract(source())
    with pytest.raises(ExtractionFailure, match="workouts_ai_budget_exceeded"):
        await provider.extract(source())
    assert len(calls) == 1
    async with budget_api.sessions() as db:
        row = await db.scalar(select(WorkoutsAIAdmission))
        assert row.outcome == "success"


async def test_unknown_canary_model_and_hosted_tools_fail_before_provider(
    budget_api, provider_environment, monkeypatch
):
    calls = install_http(monkeypatch)
    guard = BudgetGuard(policy(), session_factory=budget_api.sessions)
    Tracker.selected_model = "unpriced-canary"
    with pytest.raises(ExtractionFailure, match="workouts_ai_model_unpriced"):
        await ProductionExtractionProvider(development_api_key="fake", budget_guard=guard).extract(
            source()
        )
    Tracker.selected_model = None
    with pytest.raises(CoachFailure, match="workouts_ai_envelope_unsupported"):
        await ProductionCoachProvider(development_api_key="fake", budget_guard=guard).respond(
            [], tools=[{"type": "web_search"}]
        )
    assert calls == []


@pytest.mark.parametrize("failure", ["denied_budget", "failed_provider"])
async def test_provider_failure_returns_only_nonusable_manual_draft(
    provider_environment, monkeypatch, failure
):
    calls = install_http(
        monkeypatch, values=[completion({"ingredients": []}), completion({"ingredients": []})]
    )
    guard = FakeBudget(deny_at=1 if failure == "denied_budget" else None)
    provider = ProductionExtractionProvider(development_api_key="fake", budget_guard=guard)
    result = await extraction.WorkoutExtractor(provider).extract(
        extraction.ExtractionRequest(kind="text", text=TEXT, ai_consent=True)
    )
    assert result.status == "incomplete" and result.workout is not None
    assert result.workout.blocks == []
    assert result.error_code == (
        "workouts_ai_budget_exceeded" if failure == "denied_budget" else "provider_invalid_response"
    )
    assert len(calls) == (0 if failure == "denied_budget" else 2)
