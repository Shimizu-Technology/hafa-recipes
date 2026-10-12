"""Keep the approved private criterion separate from the earlier evaluator."""

import copy
import importlib.util
from pathlib import Path

import pytest
from capacity.report import READS, WRITES
from capacity.report import evaluate as original

spec = importlib.util.spec_from_file_location(
    "private_report", Path(__file__).parents[1] / "private_report.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def reports(p95=500, p99=1000):
    def row(p95, p99):
        return {
            "count": 152,
            "statuses": {"200": 152},
            "unexpected": 0,
            "p95_ms": p95,
            "p99_ms": p99,
        }

    baseline = {
        "completed": True,
        "percentile_method": "nearest_rank",
        "routes": {label: row(40, 100) for label in READS},
    }
    mixed = {
        "completed": True,
        "percentile_method": "nearest_rank",
        "routes": {label: row(p95, p99) for label in READS | WRITES},
    }
    return baseline, mixed, [{"memory_peak": 410 * 1024**2}]


def test_private_absolute_limits_inclusive_but_original_relative_gate_unchanged():
    args = reports()
    assert module.evaluate(*args)["local_gate"] == "passed"
    assert original(*args)["local_gate"] == "failed"


@pytest.mark.parametrize("phase", ["off", "enabled"])
@pytest.mark.parametrize("label", sorted(READS))
@pytest.mark.parametrize("metric,limit", [("p95_ms", 500), ("p99_ms", 1000)])
def test_absolute_limit_applies_to_each_protected_read_in_both_phases(phase, label, metric, limit):
    baseline, mixed, samples = reports()
    target = baseline if phase == "off" else mixed
    target["routes"][label][metric] = limit
    assert module.evaluate(baseline, mixed, samples)["local_gate"] == "passed"
    target["routes"][label][metric] = limit + 0.001
    result = module.evaluate(baseline, mixed, samples)
    assert result["local_gate"] == "failed"
    assert any(f"{phase}/{label}" in failure for failure in result["failures"])


def test_small_baseline_does_not_replace_approved_absolute_p99_limit():
    baseline, mixed, samples = reports(300, 900)
    for row in baseline["routes"].values():
        row["p95_ms"], row["p99_ms"] = 5, 10
    result = module.evaluate(baseline, mixed, samples)
    assert result["local_gate"] == "passed"
    assert result["private_beta_read_p95_ms"] == 500
    assert result["private_beta_read_p99_ms"] == 1000
    assert "p99_relative_limit" not in result
    assert original(baseline, mixed, samples)["local_gate"] == "failed"


@pytest.mark.parametrize("phase", ["off", "enabled"])
def test_missing_p99_in_either_phase_blocks_acceptance(phase):
    baseline, mixed, samples = reports()
    target = baseline if phase == "off" else mixed
    target["routes"]["/up"]["p99_ms"] = None
    assert module.evaluate(baseline, mixed, samples)["local_gate"] == "blocked"


def test_protected_write_limit_and_missing_write_remain_failures():
    baseline, mixed, samples = reports()
    mixed["routes"]["recipes/manual-write"]["p95_ms"] = 1000.001
    assert module.evaluate(baseline, mixed, samples)["local_gate"] == "failed"
    del mixed["routes"]["recipes/manual-write"]
    assert module.evaluate(baseline, mixed, samples)["local_gate"] == "failed"


def test_oom_stop_and_memory_reserve_not_waived():
    baseline, mixed, _samples = reports()
    for extra in (
        {"memory_peak": 410 * 1024**2 + 1},
        {"memory_peak": 1, "oom": 1},
        {"memory_peak": 1, "oom_kill": 1},
        {"memory_peak": 1, "stop_required": True},
    ):
        assert module.evaluate(baseline, mixed, [extra])["local_gate"] == "failed"


def test_unexpected_or_incomplete_workload_fails():
    baseline, mixed, samples = reports()
    failed = copy.deepcopy(mixed)
    failed["routes"]["/up"]["unexpected"] = 1
    assert module.evaluate(baseline, failed, samples)["local_gate"] == "failed"
    mixed["completed"] = False
    assert module.evaluate(baseline, mixed, samples)["local_gate"] == "failed"


def test_missing_route_or_unknown_percentile_method_never_passes():
    baseline, mixed, samples = reports()
    del mixed["routes"]["/up"]
    assert module.evaluate(baseline, mixed, samples)["local_gate"] != "passed"
    baseline["percentile_method"] = "legacy_floor"
    assert module.evaluate(baseline, mixed, samples)["local_gate"] != "passed"
