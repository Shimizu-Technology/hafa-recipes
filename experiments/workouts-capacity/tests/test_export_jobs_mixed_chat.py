"""Real lazy SDK/fake wait, bounded numeric pairing and default-preserving output."""

import asyncio
import copy
import json
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
import uvloop
from capacity import export_jobs_mixed_chat as chat
from capacity.ci_run import Coordinator
from capacity.driver import Driver
from capacity.events import stage_counts
from capacity.export_jobs_mixed_ci import MixedCoordinator
from capacity.export_jobs_mixed_diagnostics import phase_diagnostics
from capacity.export_jobs_mixed_driver import MixedDriver
from capacity.export_jobs_mixed_receipt import cycle_proofs, mixed_public_receipt
from capacity.plan import environment
from capacity.transport import ProviderTransport
from fastapi import FastAPI
from openai import AsyncOpenAI
from test_export_jobs_mixed import complete_report


def component_rows():
    return {
        "calls_observed": 5,
        "rows": [
            {
                "ordinal": index,
                "complete": True,
                "failed": False,
                "sdk_body_ms": 1400.0,
                "accounting_exit_ms": 20.0,
                "fixture_transport_ms": 250.0,
                "fixture_requested_wait_ms": 250.0,
                "fixture_transport_calls": 1,
            }
            for index in range(1, 6)
        ],
    }


def trace_fixture(tmp_path):
    path = tmp_path / "requests.jsonl"
    events = []
    for index in range(5):
        start = 100.2 + 60 * index
        events.extend(
            [
                {
                    "route": "recipes/chat",
                    "event": "start",
                    "timestamp": start,
                    "request_number": 5 * index + 1,
                },
                {
                    "route": "recipes/chat",
                    "event": "end",
                    "timestamp": start + 1.65,
                    "request_number": 5 * index + 1,
                    "milliseconds": 1650.0,
                    "status": 200,
                },
            ]
        )
    path.write_text("".join(json.dumps(event) + "\n" for event in events))
    samples = [
        {
            "timestamp": 100,
            "stages": [
                {
                    "stage": "gc_pause",
                    "event": "end",
                    "timestamp": 101.3,
                    "duration_ms": 304,
                },
                {
                    "stage": "loop_lag",
                    "event": "end",
                    "timestamp": 101.8,
                    "duration_ms": 1191,
                },
                {
                    "stage": "evidence_frames",
                    "event": "end",
                    "timestamp": 108.7,
                    "duration_ms": 5800,
                },
            ],
        }
    ]
    return path, samples, events


@pytest.fixture
def setup(monkeypatch):
    for key, value in environment().items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("CAPACITY_EXPORT_JOBS_MIXED", "true")
    monkeypatch.setenv("CAPACITY_PHASE", "baseline")
    from app import ai_governance
    from app.config import get_settings

    get_settings.cache_clear()
    accounted = []

    async def account(**_):
        accounted.append(True)  # Do not retain arguments/response/source data.
        await asyncio.sleep(0.002)

    monkeypatch.setattr(ai_governance, "record_ai_invocation", account)
    app = FastAPI()
    calls = []

    @app.get("/capacity/status")
    async def status():
        calls.append(True)
        return {"synthetic": True}

    yield app, ai_governance.AIInvocationTracker, accounted, calls
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_real_sdk_lazy_resources_real250ms_wait_and_accounting_are_observed(
    setup, monkeypatch
):
    app, Tracker, accounted, status_calls = setup
    provider = ProviderTransport(delay=0.25)
    client = AsyncOpenAI(
        api_key="capacity-not-a-provider-credential",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=provider),
    )
    assert "chat" not in client.__dict__
    components = chat.install(app, monkeypatch.setattr)
    assert "chat" not in client.__dict__  # Installation did not warm cached imports.
    try:
        for _ in range(5):
            tracker = Tracker(
                capability="recipe_chat",
                primary_model="gpt-4o-mini",
                prompt_version="fixture",
                allow_canary=False,
            )
            async with tracker:
                assert chat.active.get() is not None
                response = await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a recipe cooking assistant",
                        },
                        {"role": "user", "content": "How can I prepare this?"},
                    ],
                )
                assert response.choices[0].message.content
                tracker.succeed(response)
            assert not hasattr(tracker, "_capacity_chat_pairs")
            assert chat.active.get() is None
        snapshot = components.snapshot()
        assert snapshot["available"] and len(accounted) == 5
        assert provider.delay == 0.25 and provider.calls["chat"] == 5
        assert chat.component_public(snapshot) == snapshot
        for row in snapshot["rows"]:
            assert (
                row["fixture_requested_wait_ms"] == 250
                and row["fixture_transport_calls"] == 1
            )
            assert row["sdk_body_ms"] >= row["fixture_transport_ms"] >= 250
            assert row["accounting_exit_ms"] > 0
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://fixture.invalid"
        ) as control:
            value = (await control.get("/capacity/status")).json()
        assert value == {
            "synthetic": True,
            "recipe_chat_components": snapshot,
            "recipe_chat_observation": {
                "boundary": "none",
                "code": "none",
                "ordinal": 0,
                "count": 5,
            },
        }
        assert status_calls == [True]  # Exactly the original request/handler call.
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "corruption",
    [
        None,
        "snapshot_incomplete",
        "snapshot_count",
        "checkpoint_missing",
        "trace_missing_pair",
        "trace_malformed",
    ],
)
async def test_real_observation_pipeline_with_full813_call_trace(
    setup, monkeypatch, tmp_path, corruption
):
    app, Tracker, accounted, status_calls = setup
    provider = ProviderTransport(delay=0.25)
    sdk = AsyncOpenAI(
        api_key="capacity-not-a-provider-credential",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=provider),
    )
    status_route = next(
        route
        for route in app.routes
        if getattr(route, "path", None) == "/capacity/status"
    )

    async def metadata():
        status_calls.append(True)
        return {
            "synthetic": True,
            "provider_attempts": provider.calls,
            "stage_counts": stage_counts(),
            "diagnostics": {
                "loop_samples": 0,
                "loop_max_ms": 0,
                "loop_over100ms": 0,
                "gc_collections": 0,
                "gc_total_ms": 0,
                "gc_max_ms": 0,
                "interval_ms": 250,
            },
            "cover_scenarios": {
                name: {"observed": 0, "completed": 0, "linked_recipes": 0}
                for name in ("cached", "fallback")
            },
        }

    monkeypatch.setattr(status_route.dependant, "call", metadata)

    @app.get("/fixture")
    async def ordinary():
        return {"synthetic": True}

    @app.post("/fixture-chat")
    async def recipe_chat():
        tracker = Tracker(
            capability="recipe_chat",
            primary_model="gpt-4o-mini",
            prompt_version="fixture",
            allow_canary=False,
        )
        async with tracker:
            response = await sdk.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a recipe cooking assistant"},
                    {"role": "user", "content": "How can I prepare this?"},
                ],
            )
            assert response.choices[0].message.content
            tracker.succeed(response)
        assert not hasattr(tracker, "_capacity_chat_pairs")
        return {"synthetic": True}

    assert "chat" not in sdk.__dict__
    components = chat.install(app, monkeypatch.setattr)
    assert "chat" not in sdk.__dict__
    driver = MixedDriver(tmp_path)
    await driver.client.aclose()
    driver.client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://fixture.invalid"
    )
    driver.phase = "baseline"
    output = tmp_path / "baseline.json"
    trace = Path(str(output) + ".requests.jsonl")
    samples = [{"timestamp": time.time(), "stages": []}]
    driver.begin_trace(output)
    try:
        await driver.checkpoint("before")
        for cycle in range(5):
            for label in (
                "recipes/text",
                "recipes/ocr",
                "recipes/manual-write",
                "recipes/video-submit",
                "recipes/chat-context",
            ):
                await driver.request("GET", "/fixture", label=label)
            if cycle == 0:
                await driver.request(
                    "GET", "/fixture", label="recipes/cover-fallback-submit"
                )
            await driver.request("POST", "/fixture-chat", label="recipes/chat")
            for _ in range(30):
                for label in (
                    "/up",
                    "recipes/list",
                    "recipes/detail",
                    "recipes/search",
                ):
                    await driver.request("GET", "/fixture", label=label)
            for _ in range(12 * (cycle + 1)):
                await driver.request("GET", "/fixture", label="recipes/job-poll")
        assert len(accounted) == provider.calls["chat"] == 5
        if corruption == "snapshot_incomplete":
            components.rows[0]["complete"] = False
        elif corruption == "snapshot_count":
            components.calls = 6
        elif corruption == "checkpoint_missing":
            original_status = status_route.dependant.call

            async def missing_status():
                value = await original_status()
                return {
                    key: item
                    for key, item in value.items()
                    if key not in {"recipe_chat_components", "recipe_chat_observation"}
                }

            monkeypatch.setattr(status_route.dependant, "call", missing_status)
        await driver.checkpoint("after")
        report = driver.report()
        assert driver.request_number == 813 and status_calls == [True, True]
        assert report["unsettled_requests"] == 0 and chat.active.get() is None
        assert all(
            report["routes"][label]["count"] == 150
            for label in ("/up", "recipes/list", "recipes/detail", "recipes/search")
        )
        assert report["routes"]["recipes/job-poll"]["count"] == 180
    finally:
        driver.trace_stream.close()
        await driver.client.aclose()
        await sdk.close()
    events = [json.loads(line) for line in trace.read_text().splitlines()]
    assert (
        len(events) == 1626
        and len([event for event in events if event["route"] == "recipes/chat"]) == 10
    )
    if corruption == "trace_missing_pair":
        events.remove(
            next(
                event
                for event in events
                if event["route"] == "recipes/chat" and event["event"] == "end"
            )
        )
        trace.write_text("".join(json.dumps(event) + "\n" for event in events))
    elif corruption == "trace_malformed":
        trace.write_text(trace.read_text() + "{\n")
    rejected = {}
    result = chat.chat_trace(samples, trace, report["recipe_chat_components"], rejected)
    proof = chat.chat_rejection(result, report["recipe_chat_observation"], rejected)
    expected = {
        "snapshot_incomplete": ("components", "incomplete"),
        "snapshot_count": ("components", "count"),
        "checkpoint_missing": ("checkpoint", "missing"),
        "trace_missing_pair": ("trace", "pairing"),
        "trace_malformed": ("trace", "format"),
    }
    if corruption is None:
        assert result["available"] and len(result["rows"]) == 5
        assert (proof["boundary"], proof["code"], proof["count"]) == ("none", "none", 5)
        assert all(
            row["fixture_transport_calls"] == 1
            and row["fixture_requested_wait_ms"] == 250
            and row["sdk_body_ms"] >= row["fixture_transport_ms"] >= 250
            for row in result["rows"]
        )
    else:
        assert result == {"available": False}
        assert (proof["boundary"], proof["code"]) == expected[corruption]
    safe = mixed_public_receipt(
        {
            "passed": False,
            "phases": {
                "baseline": {
                    "passed": False,
                    "recipe_chat_diagnostics": result,
                    "recipe_chat_rejection": {**proof, "private_source": "PRIVATE"},
                }
            },
        }
    )
    assert (
        not safe["passed"]
        and safe["phases"]["baseline"]["recipe_chat_rejection"] == proof
    )
    assert "PRIVATE" not in json.dumps(safe)


@pytest.mark.asyncio
async def test_nested_unrelated_context_does_not_steal_parent_wait_or_retain_arguments(
    setup, monkeypatch
):
    app, Tracker, _, _ = setup
    clock = SimpleNamespace(now=0.0)
    sentinel, returned = object(), object()

    async def provider_call(provider, request):
        assert request is sentinel
        clock.now += provider.delay
        return returned

    monkeypatch.setattr(ProviderTransport, "handle_async_request", provider_call)
    components = chat.install(app, monkeypatch.setattr, clock=lambda: clock.now)
    provider = ProviderTransport(delay=0.25)
    for _ in range(5):
        tracker = Tracker(
            capability="recipe_chat",
            primary_model="fixture",
            prompt_version="fixture",
            allow_canary=False,
        )
        async with tracker:
            parent = chat.active.get()
            unrelated = Tracker(
                capability="fixture_other",
                primary_model="fixture",
                prompt_version="fixture",
                allow_canary=False,
            )
            async with unrelated:
                assert chat.active.get() is None
                assert await provider.handle_async_request(sentinel) is returned
            assert chat.active.get() is parent
            assert await provider.handle_async_request(sentinel) is returned
            tracker.succeed()
        assert chat.active.get() is None
    snapshot = components.snapshot()
    assert snapshot["available"]
    assert all(
        row["fixture_transport_calls"] == 1 and row["fixture_transport_ms"] == 250
        for row in snapshot["rows"]
    )
    assert not any(
        key in json.dumps(snapshot)
        for key in (
            "request_body",
            "response_body",
            "source_data",
            "timestamp",
            "token",
            "url",
        )
    )


@pytest.mark.asyncio
async def test_concurrent_frames_are_task_local_and_cancellation_cleans_pair(
    setup, monkeypatch
):
    app, Tracker, _, _ = setup
    components = chat.install(app, monkeypatch.setattr)
    ready, held = asyncio.Event(), asyncio.Future()
    tracker = Tracker(
        capability="recipe_chat",
        primary_model="fixture",
        prompt_version="fixture",
        allow_canary=False,
    )

    async def actor():
        async with tracker:
            assert chat.active.get() is not None
            ready.set()
            await held

    task = asyncio.create_task(actor())
    await ready.wait()
    assert chat.active.get() is None
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert held.cancelled() and not hasattr(tracker, "_capacity_chat_pairs")
    assert chat.active.get() is None and components.snapshot() == {"available": False}


@pytest.mark.asyncio
async def test_failed_tracker_without_exception_leaves_numeric_diagnosis_unavailable(
    setup, monkeypatch
):
    app, Tracker, accounted, _ = setup
    components = chat.install(app, monkeypatch.setattr)
    for _ in range(5):
        tracker = Tracker(
            capability="recipe_chat",
            primary_model="fixture",
            prompt_version="fixture",
            allow_canary=False,
        )
        async with tracker:
            tracker.fail("fixture_failure")
        assert chat.active.get() is None and not hasattr(
            tracker, "_capacity_chat_pairs"
        )
    assert len(accounted) == 5 and all(row["failed"] for row in components.rows)
    assert components.snapshot() == {"available": False}


def test_installer_rejects_other_profiles_before_patching(setup, monkeypatch):
    app, Tracker, _, _ = setup
    original = Tracker.__aenter__
    monkeypatch.setenv("CAPACITY_EXPORT_JOBS_MIXED", "false")
    with pytest.raises(RuntimeError):
        chat.install(app, monkeypatch.setattr)
    assert Tracker.__aenter__ is original


@pytest.mark.parametrize(
    "corruption",
    [
        "partial",
        "failed",
        "overflow",
        "wrong_ordinal",
        "nan",
        "bool",
        "multi_provider",
        "changed_delay",
        "missing_field",
        "short_wait",
    ],
)
def test_component_whitelist_refuses_incomplete_or_false_fixture_evidence(corruption):
    value = component_rows()
    if corruption == "partial":
        value["rows"][0]["complete"] = False
    elif corruption == "failed":
        value["rows"][0]["failed"] = True
    elif corruption == "overflow":
        value["calls_observed"] = 6
    elif corruption == "wrong_ordinal":
        value["rows"][0]["ordinal"] = 2
    elif corruption == "nan":
        value["rows"][0]["sdk_body_ms"] = float("nan")
    elif corruption == "bool":
        value["rows"][0]["fixture_transport_calls"] = True
    elif corruption == "multi_provider":
        value["rows"][0]["fixture_transport_calls"] = 2
    elif corruption == "changed_delay":
        value["rows"][0]["fixture_requested_wait_ms"] = 249
    elif corruption == "missing_field":
        del value["rows"][0]["accounting_exit_ms"]
    elif corruption == "short_wait":
        value["rows"][0]["fixture_transport_ms"] = 248.999
    assert chat.component_public(value) == {"available": False}


@pytest.mark.parametrize(
    "elapsed,accepted",
    [
        (249.0, True),
        (249.50137501582503, True),
        (250.0, True),
        (248.999, False),
        (0.0, False),
    ],
)
def test_exact_timer_quantization_boundary_in_component_and_public_checks(
    elapsed, accepted
):
    value = component_rows()
    value["rows"][0]["fixture_transport_ms"] = elapsed
    rejected = {}
    snapshot = chat.component_public(value, rejected)
    rows = [
        {
            "ordinal": row["ordinal"],
            "status": 200,
            "relative_start_ms": (row["ordinal"] - 1) * 60000,
            "duration_ms": 1650,
            **{key: row[key] for key in chat.FIELDS},
            "overlap_counts": dict.fromkeys(chat.STAGES, 0),
        }
        for row in value["rows"]
    ]
    public = chat.chat_public({"available": True, "rows": rows})
    assert snapshot["available"] is public["available"] is accepted
    assert chat.MIN_OBSERVED_WAIT_MS == 249 and chat.TIMER_QUANTIZATION_MS == 1
    if accepted:
        assert (
            snapshot["rows"][0]["fixture_transport_ms"]
            == public["rows"][0]["fixture_transport_ms"]
            == elapsed
        )
        assert public["rows"][0]["fixture_requested_wait_ms"] == 250
    else:
        assert rejected["code"] == "observed_wait"


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("fixture_transport_calls", 0, "transport_calls"),
        ("fixture_transport_calls", 2, "transport_calls"),
        ("fixture_requested_wait_ms", 249, "requested_wait"),
        ("fixture_transport_ms", 248.999, "observed_wait"),
        ("sdk_body_ms", 249, "body_duration"),
    ],
)
def test_four_wait_predicates_have_distinct_closed_rejections(field, value, code):
    metadata = component_rows()
    metadata["rows"][0][field] = value
    rejected = {}
    assert chat.component_public(metadata, rejected) == {"available": False}
    assert rejected == {
        "boundary": "components",
        "code": code,
        "ordinal": 1,
        "count": 0,
    }
    assert chat.rejection_public(rejected) == rejected


def test_actual_uvloop_sdk_preserves_real_wait_and_observed_values(
    setup, monkeypatch, tmp_path
):
    app, Tracker, accounted, _ = setup
    assert uvloop.__version__ == "0.22.1"
    policy, sleep, clock = (
        asyncio.get_event_loop_policy(),
        asyncio.sleep,
        time.monotonic,
    )

    async def observe():
        assert isinstance(asyncio.get_running_loop(), uvloop.Loop)
        provider = ProviderTransport(delay=0.25)
        client = AsyncOpenAI(
            api_key="capacity-not-a-provider-credential",
            max_retries=0,
            http_client=httpx.AsyncClient(transport=provider),
        )
        assert "chat" not in client.__dict__
        components = chat.install(app, monkeypatch.setattr)
        assert "chat" not in client.__dict__
        try:
            for _ in range(5):
                tracker = Tracker(
                    capability="recipe_chat",
                    primary_model="gpt-4o-mini",
                    prompt_version="fixture",
                    allow_canary=False,
                )
                async with tracker:
                    response = await client.chat.completions.create(
                        model="gpt-4o-mini",
                        messages=[
                            {
                                "role": "system",
                                "content": "You are a recipe cooking assistant",
                            },
                            {"role": "user", "content": "How can I prepare this?"},
                        ],
                    )
                    tracker.succeed(response)
                assert chat.active.get() is None and not hasattr(
                    tracker, "_capacity_chat_pairs"
                )
            assert (
                provider.delay == 0.25 and provider.calls["chat"] == len(accounted) == 5
            )
            snapshot = components.snapshot()
            assert snapshot["available"] and len(asyncio.all_tasks()) == 1
            for raw, clean in zip(components.rows, snapshot["rows"]):
                assert (
                    clean["fixture_transport_ms"] == raw["fixture_transport_ms"] >= 249
                )
                assert (
                    clean["fixture_requested_wait_ms"] == 250
                    and clean["fixture_transport_calls"] == 1
                )
            return snapshot
        finally:
            await client.close()

    with asyncio.Runner(loop_factory=uvloop.new_event_loop) as runner:
        snapshot = runner.run(observe())
    path, samples, _ = trace_fixture(tmp_path)
    diagnosis = chat.chat_trace(samples, path, snapshot)
    assert diagnosis["available"]
    assert [row["fixture_transport_ms"] for row in diagnosis["rows"]] == [
        row["fixture_transport_ms"] for row in snapshot["rows"]
    ]
    assert (
        asyncio.get_event_loop_policy() is policy
        and asyncio.sleep is sleep
        and time.monotonic is clock
    )


@pytest.mark.parametrize(
    "invalid",
    [
        None,
        {},
        {"boundary": []},
        {"boundary": "trace", "code": []},
        {"boundary": "PRIVATE", "code": "PRIVATE", "ordinal": 0, "count": 0},
        {"boundary": "trace", "code": "pairing", "ordinal": True, "count": 1},
        {"boundary": "trace", "code": "bounds", "ordinal": 0, "count": 4098},
        {"boundary": "components", "code": "incomplete", "ordinal": 6, "count": 0},
    ],
)
def test_rejection_whitelist_never_publishes_unknown_or_unbounded_fields(invalid):
    assert chat.rejection_public(invalid) == {
        "boundary": "unknown",
        "code": "unavailable",
        "ordinal": 0,
        "count": 0,
    }


def test_component_rejection_preserves_actual_failure_and_original_unavailable_contract():
    components = component_rows()
    components["rows"][2]["failed"] = True
    observed = {}
    assert chat.component_public(components, observed) == {"available": False}
    assert observed == {
        "boundary": "components",
        "code": "incomplete",
        "ordinal": 3,
        "count": 0,
    }
    parsed = {"boundary": "components", "code": "count", "ordinal": 0, "count": 0}
    assert (
        chat.chat_rejection(
            {"available": False}, {**observed, "provider_body": "PRIVATE"}, parsed
        )
        == observed
    )
    assert (
        chat.chat_rejection(
            {"available": False},
            observed,
            {"boundary": "trace", "code": "format", "ordinal": 0, "count": 0},
        )
        == observed
    )
    assert (
        chat.chat_rejection(
            {"available": False},
            {"boundary": "none", "code": "none", "ordinal": 0, "count": 5},
            parsed,
        )
        == parsed
    )
    assert chat.chat_rejection({"available": True}, observed, parsed) == {
        "boundary": "none",
        "code": "none",
        "ordinal": 0,
        "count": 5,
    }


def test_five_trace_pairs_align_to_existing_phase_origin_and_actual_end_intervals(
    tmp_path,
):
    path, samples, _ = trace_fixture(tmp_path)
    result = chat.chat_trace(samples, path, component_rows())
    assert result["available"] and len(result["rows"]) == 5
    first = result["rows"][0]
    assert first["relative_start_ms"] == pytest.approx(200)
    assert first["duration_ms"] == 1650
    assert (
        first["overlap_counts"]["gc_pause"] == first["overlap_counts"]["loop_lag"] == 1
    )
    assert first["overlap_counts"]["evidence_frames"] == 0
    assert result["inclusive_timings"] and not result["nested_timings_summed"]
    assert all(not any(row["overlap_counts"].values()) for row in result["rows"][1:])


@pytest.mark.parametrize(
    "corruption",
    [
        "missing_end",
        "foreign_pair",
        "duplicate_number",
        "backwards_pair",
        "bad_status",
        "nan",
        "zero_duration",
        "before_origin",
        "extra_chat",
        "truncated_json",
        "oversized",
        "bad_stage",
        "failed_stage",
        "bad_components",
    ],
)
def test_partial_bad_pair_or_malformed_trace_never_claims_diagnosis(
    tmp_path, corruption
):
    path, samples, events = trace_fixture(tmp_path)
    components = component_rows()
    if corruption == "missing_end":
        events.pop()
    elif corruption == "foreign_pair":
        events[1]["request_number"] = 999
    elif corruption == "duplicate_number":
        events[2]["request_number"] = events[3]["request_number"] = 1
    elif corruption == "backwards_pair":
        events[2]["timestamp"] = 100.3
    elif corruption == "bad_status":
        events[1]["status"] = 500
    elif corruption == "nan":
        events[1]["milliseconds"] = float("nan")
    elif corruption == "zero_duration":
        events[1]["milliseconds"] = 0
    elif corruption == "before_origin":
        events[0]["timestamp"] = 99
    elif corruption == "extra_chat":
        events.extend(events[:2])
    elif corruption == "bad_stage":
        samples[0]["stages"][0]["duration_ms"] = float("nan")
    elif corruption == "failed_stage":
        samples[0]["stages"][0]["event"] = "failed"
    elif corruption == "bad_components":
        components["calls_observed"] = 4
    path.write_text("".join(json.dumps(event) + "\n" for event in events))
    if corruption == "truncated_json":
        path.write_text(path.read_text() + "{")
    elif corruption == "oversized":
        path.write_text(" " * (2 * 1024 * 1024 + 1))
    rejected = {}
    assert chat.chat_trace(samples, path, components, rejected) == {"available": False}
    assert chat.rejection_public(rejected) == rejected and rejected["boundary"] in {
        "trace",
        "components",
        "stages",
    }
    if corruption == "bad_stage":
        assert (rejected["boundary"], rejected["code"]) == ("stages", "fields")
    elif corruption == "failed_stage":
        assert (rejected["boundary"], rejected["code"]) == ("stages", "failed")


def test_public_rows_strip_private_fields_and_preserve_failed_gate(tmp_path):
    path, samples, _ = trace_fixture(tmp_path)
    data = chat.chat_trace(samples, path, component_rows())
    data["absolute_clock"] = "PRIVATE"
    data["rows"][0].update(
        owner="PRIVATE", url="PRIVATE", provider_body="PRIVATE", sql="PRIVATE"
    )
    summary = {
        "passed": False,
        "cleaned_owned_resources": True,
        "phases": {"baseline": {"passed": False, "recipe_chat_diagnostics": data}},
    }
    safe = mixed_public_receipt(summary)
    text = json.dumps(safe)
    assert not safe["passed"] and "PRIVATE" not in text and "absolute_clock" not in text
    assert (
        safe["phases"]["baseline"]["recipe_chat_diagnostics"]["rows"][0]["duration_ms"]
        == 1650
    )


def test_checkpoint_extension_default_is_noop_and_new_capture_is_numeric_only():
    original = Driver.__new__(Driver)
    assert (
        original.checkpoint_extra("after", {"recipe_chat_components": component_rows()})
        is None
    )
    assert not hasattr(original, "recipe_chat_components")
    mixed = MixedDriver.__new__(MixedDriver)
    mixed.recipe_chat_components = {"available": False}
    metadata = component_rows()
    metadata["private_payload"] = "PRIVATE"
    mixed.checkpoint_extra("before", {"recipe_chat_components": metadata})
    assert mixed.recipe_chat_components == {"available": False}
    mixed.checkpoint_extra("after", {"recipe_chat_components": metadata})
    assert mixed.recipe_chat_components["available"] and "PRIVATE" not in json.dumps(
        mixed.recipe_chat_components
    )


def test_compact_new_writer_retains_complete_numeric_payload_under_original100k(
    tmp_path,
):
    root = Path(__file__).resolve().parents[3]
    payload = {"counts": {"retained": 5}, "rows": [1, 2, 3]}
    old = Coordinator(root, tmp_path / "old", tmp_path / "old.json", env={})
    old.summary = payload
    old.format_public_receipt = lambda value: value
    old.write_receipt()
    assert (
        old.receipt_indent == 2
        and old.receipt.read_text() == json.dumps(payload, indent=2) + "\n"
    )
    new = MixedCoordinator(root, tmp_path / "new", tmp_path / "new.json", env={})
    # Maximal retained stage arrays plus all new fixed numeric fields: no field
    # is dropped just to make publication fit. The real sanitizer is applied.
    path, samples, _ = trace_fixture(tmp_path)
    diagnosis = chat.chat_trace(samples, path, component_rows())
    stage = {
        "stage": "gc_pause",
        "event": "end",
        "offset_seconds": 299.123456789,
        "duration_ms": 999999999999999.9,
        "input_bytes": 999999999999999,
    }
    phases = {
        phase: {
            "passed": False,
            "recipe_chat_diagnostics": diagnosis,
            "recipe_chat_rejection": {
                "boundary": "trace",
                "code": "bounds",
                "ordinal": 5,
                "count": 4097,
            },
            "timeline": {
                "stages": [copy.deepcopy(stage) for _ in range(320)],
                "slow_liveness": [],
                "observed_stage_count": 320,
                "dropped_stage_count": 0,
                "timeline_truncated": False,
            },
        }
        for phase in ("baseline", "mixed")
    }
    report = complete_report()
    phases["mixed"]["latency_diagnostics"] = phase_diagnostics(report, "mixed")
    phases["mixed"]["background_export_cycles"] = cycle_proofs(report)[0]
    phases["mixed"]["routes"] = report["routes"]
    report["job_cycles"] = []
    phases["baseline"]["latency_diagnostics"] = phase_diagnostics(report, "baseline")
    new.summary = {"passed": False, "cleaned_owned_resources": True, "phases": phases}
    expected = mixed_public_receipt(new.summary)
    new.write_receipt()
    assert (
        new.receipt_indent is None and json.loads(new.receipt.read_text()) == expected
    )
    assert all(
        len(expected["phases"][phase]["timeline"]["stages"]) == 320 for phase in phases
    )
    assert len(new.receipt.read_bytes()) <= 100 * 1024
    assert len(new.receipt.read_text().splitlines()) == 1
