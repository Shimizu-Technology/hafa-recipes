"""Keep the approved private criterion separate from the earlier evaluator."""

import copy
import importlib.util
from pathlib import Path

from capacity.report import READS, WRITES
from capacity.report import evaluate as original

spec = importlib.util.spec_from_file_location(
    "private_report", Path(__file__).parents[1] / "private_report.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def reports(p95=100, p99=200):
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


def test_private_100ms_and_2x_p99_inclusive_but_original_relative_gate_unchanged():
    args = reports()
    assert module.evaluate(*args)["local_gate"] == "passed"
    assert original(*args)["local_gate"] == "failed"


def test_private_p95_over_100_still_fails_even_when_relative_change_is_small():
    baseline, mixed, samples = reports(100.001, 200)
    for row in baseline["routes"].values():
        row["p95_ms"] = 100
    assert module.evaluate(baseline, mixed, samples)["local_gate"] == "failed"


def test_p99_relative_limit_not_waived():
    assert module.evaluate(*reports(70, 200.001))["local_gate"] == "failed"


def test_oom_stop_and_memory_reserve_not_waived():
    baseline, mixed, _samples = reports()
    for extra in (
        {"memory_peak": 410 * 1024**2 + 1},
        {"memory_peak": 1, "oom": 1},
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
