"""Small samples must not hide SLO violations in full or interrupted reports."""

import json

import pytest
from capacity.ci_safety import (
    BASE_WRITES,
    EXTRA_READS,
    EXTRA_WRITES,
    READS,
    partial_trace_report,
    phase_receipt,
)
from capacity.driver import Driver, percentile
from capacity.statistics import nearest_rank


@pytest.mark.parametrize(
    "values,q,expected",
    [
        ([], 0.95, None),
        ([6800], 0.95, 6800),
        ([6800], 0.99, 6800),
        ([100, 6800], 0.5, 100),
        ([100, 6800], 0.95, 6800),
        ([100, 100, 100, 100, 6800], 0.95, 6800),
        ([100, 100, 100, 100, 6800], 0.99, 6800),
        (list(range(1, 21)), 0.95, 19),
        (list(range(1, 21)), 0.99, 20),
        (list(range(1, 101)), 0.95, 95),
        (list(range(1, 101)), 0.99, 99),
    ],
)
def test_documented_one_based_nearest_rank(values, q, expected):
    assert nearest_rank(values, q) == expected
    assert percentile(values, q) == expected


@pytest.mark.parametrize(
    "values,q",
    [
        ([float("nan")], 0.95),
        ([float("inf")], 0.95),
        ([-1], 0.95),
        ([True], 0.95),
        ([1], 0),
        ([1], 1.1),
        ([1], True),
    ],
)
def test_invalid_observations_are_not_accepted(values, q):
    with pytest.raises(ValueError):
        percentile(values, q)


async def full_report(tmp_path, overrides=None):
    driver = Driver(tmp_path)
    try:
        for route in (
            READS | EXTRA_READS | BASE_WRITES | EXTRA_WRITES | {"recipes/job-poll"}
        ):
            for value in (overrides or {}).get(route, [100] * 5):
                driver.results.append(
                    {
                        "route": route,
                        "milliseconds": value,
                        "status": 200,
                        "expected": True,
                        "bytes": 0,
                    }
                )
        return {**driver.report(), "completed": True}
    finally:
        await driver.client.aclose()


@pytest.mark.asyncio
async def test_one_slow_export_of_five_fails_actual_report_and_gate(tmp_path):
    baseline = await full_report(tmp_path)
    mixed = await full_report(
        tmp_path, {"workouts/export-build": [100, 100, 100, 100, 6800]}
    )
    assert mixed["routes"]["workouts/export-build"]["p95_ms"] == 6800
    assert mixed["routes"]["workouts/export-build"]["p99_ms"] == 6800
    assert not phase_receipt(
        mixed, [{"memory_peak": 1, "memory_current": 1}], "mixed", baseline
    )["passed"]


@pytest.mark.asyncio
async def test_relative_read_p95_p99_use_same_rank_both_sides(tmp_path):
    baseline = await full_report(tmp_path, {"/up": [10, 10, 10, 10, 100]})
    assert (
        baseline["routes"]["/up"]["p95_ms"]
        == baseline["routes"]["/up"]["p99_ms"]
        == 100
    )
    samples = [{"memory_peak": 1, "memory_current": 1}]
    equal = await full_report(tmp_path, {"/up": [10, 10, 10, 10, 100]})
    assert phase_receipt(equal, samples, "mixed", baseline)["passed"]
    p95_fail = await full_report(tmp_path, {"/up": [10, 10, 10, 10, 126]})
    assert not phase_receipt(p95_fail, samples, "mixed", baseline)["passed"]
    # With100 observations the p95 stays100 while the p99 isolates its own gate.
    baseline_large = await full_report(tmp_path, {"/up": [100] * 100})
    p99_fail = await full_report(tmp_path, {"/up": [100] * 98 + [201, 201]})
    assert p99_fail["routes"]["/up"]["p95_ms"] == 100
    assert p99_fail["routes"]["/up"]["p99_ms"] == 201
    assert not phase_receipt(p99_fail, samples, "mixed", baseline_large)["passed"]


@pytest.mark.asyncio
async def test_interrupted_trace_and_complete_report_use_identical_percentiles(
    tmp_path,
):
    values = [100, 100, 100, 100, 6800]
    path = tmp_path / "requests.jsonl"
    path.write_text(
        "".join(
            json.dumps(
                {
                    "event": "end",
                    "route": "workouts/export-build",
                    "milliseconds": value,
                    "status": 200,
                }
            )
            + "\n"
            for value in values
        )
        + '{"truncated":'
    )
    partial = partial_trace_report(path)
    complete = await full_report(tmp_path, {"workouts/export-build": values})
    for key in ("p95_ms", "p99_ms"):
        assert (
            partial["routes"]["workouts/export-build"][key]
            == complete["routes"]["workouts/export-build"][key]
            == 6800
        )
    assert not partial["completed"]


@pytest.mark.asyncio
async def test_old_or_unknown_baseline_definition_cannot_be_used_for_new_gate(tmp_path):
    from capacity.report import evaluate

    baseline = await full_report(tmp_path)
    report = await full_report(tmp_path)
    samples = [{"memory_peak": 1, "memory_current": 1}]
    old = {**baseline, "percentile_method": "lower_rank"}
    assert not phase_receipt(report, samples, "mixed", old)["passed"]
    missing = dict(baseline)
    del missing["percentile_method"]
    assert not phase_receipt(report, samples, "mixed", missing)["passed"]
    assert evaluate(missing, report, samples)["local_gate"] == "blocked"
