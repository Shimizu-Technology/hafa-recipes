"""Safe load failure evidence and partial aggregate recovery, no Docker/network."""

import asyncio
import json
import os
import subprocess
import sys
from types import SimpleNamespace

import httpx
import pytest
from capacity.ci_run import Coordinator
from capacity.ci_safety import public_receipt
from capacity.driver_diagnostics import (
    AcceptanceFailure,
    failure_code,
    partial_metadata,
)
from capacity.events import STAGES

PRIVATE = "private-owner-http://private.invalid"


def test_hosted_coordinator_import_requires_only_standard_library():
    result = subprocess.run(
        [
            sys.executable,
            "-S",
            "-c",
            "from capacity.ci_run import Coordinator; from capacity.driver_diagnostics import partial_metadata; assert partial_metadata({})['driver_failure_code'] is None",
        ],
        env={**os.environ, "PYTHONPATH": "experiments/workouts-capacity"},
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def saved_report():
    return {
        "completed": False,
        "failure_type": "AcceptanceFailure",
        "failure_code": "cold_cover_fallback_missing",
        "percentile_method": "nearest_rank",
        "routes": {},
        "saved_outcomes": {
            "distinct_recipe_jobs_submitted": 5,
            "distinct_saved_recipe_links": 5,
            "accepted_workout_count": 0,
            "fallback_jobs_submitted": 1,
            "recipes_states": {"completed": 5, PRIVATE: 100},
            "workouts_states": {},
            "private_ids": [PRIVATE],
            "stage_checkpoints": {
                "before": {
                    "stage_counts": {
                        stage: {"start": 0, "end": 0, "failed": 0} for stage in STAGES
                    }
                },
                "after": {
                    "stage_counts": {
                        stage: {
                            "start": 5,
                            "end": 5 if stage != "cover_frames" else 0,
                            "failed": 0,
                        }
                        for stage in STAGES
                    },
                    "cover_scenarios": {
                        "cached": {"observed": 5, "completed": 5, "linked_recipes": 5},
                        "fallback": {
                            "observed": 1,
                            "completed": 0,
                            "linked_recipes": 0,
                        },
                        PRIVATE: {"observed": 42},
                    },
                },
            },
        },
    }


def test_fixed_failures_never_copy_provider_or_transport_messages():
    for error, expected in [
        (
            AcceptanceFailure("cold_cover_fallback_missing"),
            "cold_cover_fallback_missing",
        ),
        (httpx.ReadTimeout(PRIVATE), "driver_request_timeout"),
        (httpx.ConnectError(PRIVATE), "driver_transport_failed"),
        (asyncio.CancelledError(PRIVATE), "driver_cancelled"),
        (RuntimeError(PRIVATE), "driver_unexpected_failure"),
    ]:
        assert failure_code(error) == expected
    with pytest.raises(ValueError, match="Unknown fixed load failure"):
        AcceptanceFailure(PRIVATE)


def test_partial_aggregate_projection_filters_private_keys_and_preserves_unknown():
    projected = partial_metadata(saved_report())
    assert projected["driver_failure_code"] == "cold_cover_fallback_missing"
    assert projected["recipes_states"] == {"completed": 5}
    assert (
        projected["stage_checkpoints"]["after"]["stage_counts"]["cover_frames"]["end"]
        == 0
    )
    receipt = public_receipt({"phases": {"baseline": {"partial_outcomes": projected}}})
    phase = receipt["phases"]["baseline"]
    assert (
        phase["recipe_jobs_drained"] is None and phase["workout_jobs_drained"] is None
    )
    assert phase["partial_outcomes"] == projected
    assert PRIVATE not in json.dumps(receipt)
    assert partial_metadata({}) == {
        "driver_failure_code": None,
        "saved_outcomes_available": False,
    }
    with pytest.raises(ValueError):
        partial_metadata({"failure_code": PRIVATE})
    malformed = saved_report()
    malformed["saved_outcomes"]["accepted_workout_count"] = float("nan")
    with pytest.raises(ValueError):
        partial_metadata(malformed)


@pytest.mark.parametrize("available", [False, True])
def test_failed_load_partial_receipt_retains_report_and_queries_drain_only_if_available(
    tmp_path, available
):
    instance = Coordinator(tmp_path, tmp_path / "work", tmp_path / "receipt.json")
    instance.active_phase = "baseline"
    instance.plan_root = tmp_path
    (tmp_path / "results").mkdir()
    (tmp_path / "results/baseline.json").write_text(json.dumps(saved_report()))
    instance.pg = "a" * 64
    instance.ledger = SimpleNamespace(state={"containers": {}})
    instance.phase_before_counts = {
        "recipe_active": 0,
        "workout_active": 0,
        "recipes": 1000,
    }

    def counts():
        if not available:
            raise OSError(PRIVATE)
        return {"recipe_active": 0, "workout_active": 0, "recipes": 1011}

    instance.saved_counts = counts
    instance.capture_partial()
    phase = public_receipt(instance.summary)["phases"]["baseline"]
    assert not phase["passed"] and not phase["observer_completed"]
    assert phase["partial_outcomes"]["distinct_saved_recipe_links"] == 5
    assert (
        phase["partial_outcomes"]["driver_failure_code"]
        == "cold_cover_fallback_missing"
    )
    assert phase["recipe_jobs_drained"] is (True if available else None)
    assert phase["saved_count_deltas"] == (
        {"recipes": 11, "recipe_active": 0, "workout_active": 0} if available else {}
    )
    assert PRIVATE not in json.dumps(phase)


@pytest.mark.asyncio
async def test_real_driver_stage_acceptance_failure_is_saved_with_exact_fixed_code(
    tmp_path, monkeypatch
):
    from capacity import driver as module

    driver = module.Driver(tmp_path)
    original = saved_report()["saved_outcomes"]

    async def checkpoint(name):
        driver.checkpoints[name] = original["stage_checkpoints"][name]

    monkeypatch.setattr(driver, "checkpoint", checkpoint)
    driver.recipe_submission_ids = {str(index) for index in range(5)}
    driver.recipe_saved_links = {str(index) for index in range(5)}
    driver.outcomes["recipes"] = {str(index): "completed" for index in range(5)}

    async def no_work(*args):
        return None

    monkeypatch.setattr(driver, "lightweight", no_work)
    monkeypatch.setattr(driver, "media_and_chat", no_work)
    monkeypatch.setattr(driver, "poll", no_work)
    monkeypatch.setattr(module, "Driver", lambda _: driver)
    monkeypatch.setattr(module.asyncio, "sleep", no_work)
    target = tmp_path / "load.json"
    with pytest.raises(AcceptanceFailure, match="cold_cover_fallback_missing"):
        await module.run(
            SimpleNamespace(
                fixtures=tmp_path, profile="recipes-baseline", seconds=0, output=target
            )
        )
    result = json.loads(target.read_text())
    assert result["failure_code"] == "cold_cover_fallback_missing"
    assert result["saved_outcomes"]["distinct_saved_recipe_links"] == 5
    assert driver.client.is_closed
