"""A class import calls one model with room for every part; undosed efforts are not a reason to pay twice.

The class rows are synthetic.
"""

import json
from types import SimpleNamespace

import httpx
import pytest

from app.domains.workouts.extraction import (
    CLASS_OUTPUT_TOKENS,
    CLASS_READ_TIMEOUT_SECONDS,
    OUTPUT_TOKENS,
    READ_TIMEOUT_SECONDS,
    ProductionExtractionProvider,
    SourceBundle,
    SourceMetadata,
    SourcePart,
)
from tests.workouts_provider_fakes import FakeBudget

PAGE = "B. Every minute for 8 minutes:\nMinute 1\nSkiErg Max calories\nMinute 2\nMax Plank Shoulder Taps"


def ev(field, wording):
    return {"field": field, "wording": wording, "location": "provided_text"}


def class_output(empty=False):
    exercises = [] if empty else [
        {"name": "SkiErg", "effort": "Max calories", "evidence": [ev("name", "SkiErg"), ev("effort", "Max calories")]},
        {"name": "Plank Shoulder Taps", "effort": "Max", "evidence": [ev("name", "Plank Shoulder Taps")]}]
    return {"title": "Class", "kind": "session", "blocks": [
        {"id": "b", "label": "B", "grouping": "interval", "evidence": [], "exercises": exercises}]}


@pytest.fixture
def provider(monkeypatch):
    import app.ai_governance
    import app.config
    import app.domains.workouts.extraction as module

    settings = SimpleNamespace(
        environment="development", allow_paid_ai_in_development=True, workouts_api_enabled=True,
        workouts_imports_enabled=True, workouts_ai_enabled=True, openai_api_key="unused",
        is_ai_capability_enabled=lambda _: True, workout_extraction_model="primary-test",
        workout_extraction_fallback_model="fallback-test", ocr_model="v", ocr_fallback_model="v",
        openai_reasoning_effort="none")
    monkeypatch.setattr(app.config, "get_settings", lambda: settings)

    class Tracker:
        def __init__(self, **values):
            self.model = values["primary_model"]

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def fail(self, *args, **kwargs):
            pass

        def succeed(self, *args, **kwargs):
            pass

    monkeypatch.setattr(app.ai_governance, "AIInvocationTracker", Tracker)
    state = SimpleNamespace(payloads=[], replies=[])

    def respond(request):
        state.payloads.append(json.loads(request.content))
        value, finish = state.replies[min(len(state.payloads), len(state.replies)) - 1]
        return httpx.Response(200, json={"usage": {"prompt_tokens": 1, "completion_tokens": 1}, "choices": [
            {"finish_reason": finish, "message": {"content": json.dumps(value)}}]})

    actual = httpx.AsyncClient

    def client(**kwargs):
        timeouts.append(kwargs.get("timeout"))
        return actual(**(kwargs | {"transport": httpx.MockTransport(respond)}))

    monkeypatch.setattr(module.httpx, "AsyncClient", client)

    async def run(class_parts, *replies):
        state.replies, state.payloads = list(replies), []
        source = SourceBundle(SourceMetadata(), [SourcePart("provided_text", PAGE)], class_parts=class_parts)
        result = await ProductionExtractionProvider(budget_guard=FakeBudget(), development_api_key="k").extract(source)
        return result, state.payloads

    return run


timeouts = []


@pytest.mark.asyncio
async def test_a_class_with_max_efforts_is_accepted_from_the_first_model(provider):
    result, payloads = await provider(True, (class_output(), "stop"))
    assert [payload["model"] for payload in payloads] == ["primary-test"]
    assert payloads[0]["max_completion_tokens"] == CLASS_OUTPUT_TOKENS > OUTPUT_TOKENS
    assert timeouts[-1] == CLASS_READ_TIMEOUT_SECONDS
    assert [item["name"] for item in result["blocks"][0]["exercises"]] == ["SkiErg", "Plank Shoulder Taps"]


@pytest.mark.asyncio
async def test_a_truncated_or_empty_class_still_gets_the_second_model(provider):
    _, payloads = await provider(True, (class_output(), "length"), (class_output(), "stop"))
    assert [payload["model"] for payload in payloads] == ["primary-test", "fallback-test"]
    _, payloads = await provider(True, (class_output(empty=True), "stop"), (class_output(), "stop"))
    assert [payload["model"] for payload in payloads] == ["primary-test", "fallback-test"]


@pytest.mark.asyncio
async def test_ordinary_imports_keep_their_budget_and_their_dose_check(provider):
    _, payloads = await provider(False, (class_output(), "stop"), (class_output(), "stop"))
    assert [payload["model"] for payload in payloads] == ["primary-test", "fallback-test"]
    assert payloads[0]["max_completion_tokens"] == OUTPUT_TOKENS
    assert timeouts[-1] == READ_TIMEOUT_SECONDS


def test_one_reversed_duration_or_distance_range_is_repaired_not_refetched():
    from app.domains.workouts.extraction import _validate_provider_workout

    raw = {"title": "Class", "kind": "session", "blocks": [{"id": "a", "label": "A", "exercises": [
        {"name": "Run", "distance_meters": 400, "distance_meters_min": 800, "duration_seconds": 40, "duration_seconds_max": 30},
        {"name": "Burpees", "reps_min": 20, "reps_max": 20}]}]}
    warnings = _validate_provider_workout(raw)
    run = raw["blocks"][0]["exercises"][0]
    assert (run["distance_meters"], run["distance_meters_min"], run["duration_seconds"], run["duration_seconds_max"]) == (
        400, None, 40, None)
    assert warnings == ["Reversed range removed from Run; review the original source evidence."] * 2


def test_class_part_slips_that_change_no_prescription_are_repaired():
    from app.domains.workouts.extraction import _validate_provider_workout

    raw = {"title": "Class", "kind": "session", "benchmark": {"key": "summit", "name": "Summit", "block_ids": ["a", "missing"]},
           "blocks": [{"id": "a", "label": "A", "exercises": []}, {"id": "b", "label": "B", "rest_after_seconds": 180, "exercises": []}]}
    assert _validate_provider_workout(raw) == []
    assert raw["benchmark"]["block_ids"] == ["a"] and raw["blocks"][-1]["rest_after_seconds"] is None
