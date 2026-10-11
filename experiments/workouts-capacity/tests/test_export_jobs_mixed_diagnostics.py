"""Observed numeric diagnosis only; no new workload, provider or acceptance waiver."""

import copy
import json

import pytest
import test_export_diagnostic as original_tests
from capacity.export_jobs_diagnostic_contract import READS
from capacity.export_jobs_mixed_diagnostics import (
    BUCKETS,
    STAGE_FIELDS,
    SUBSTAGES,
    phase_diagnostics,
    public_diagnostics,
)
from capacity.export_jobs_mixed_receipt import check_scenario, mixed_public_receipt
from test_export_jobs_mixed import complete_report


def test_actual_intervals_split_route_latency_and_keep_nearest_rank_subsets():
    report = complete_report()
    before = copy.deepcopy(report)
    for row in report["spans"]:
        if row["route"] != "recipes/search":
            continue
        if row["offset_ms"] % 60000 == 1010:
            row["duration_ms"] = 11 + row["offset_ms"] // 60000
        elif row["offset_ms"] % 60000 == 2005:
            row["duration_ms"] = 21 + row["offset_ms"] // 60000
        else:
            row["duration_ms"] = 2
    changed = copy.deepcopy(report)
    result = phase_diagnostics(report, "mixed")
    assert result["available"] and report == changed
    assert result["build_interval_count"] == 5 and result["page_interval_count"] == 95
    assert result["protected_sample_count"] == 600
    row = result["routes"]["recipes/search"]
    assert row["build"] == {"count": 5, "p95_ms": 15, "p99_ms": 15, "max_ms": 15}
    assert row["pages"] == {"count": 5, "p95_ms": 25, "p99_ms": 25, "max_ms": 25}
    assert row["outside"] == {"count": 140, "p95_ms": 2, "p99_ms": 2, "max_ms": 2}
    assert row["shared_build_page_count"] == 0
    assert all(
        gap is None
        for cycle in result["cycles"]
        for values in cycle["missing_witness_gap_ms"].values()
        for gap in values.values()
    )
    assert before["job_cycles"] == report["job_cycles"]


def test_baseline_has_no_inferred_export_work_and_keeps_all150_outside_reads():
    report = complete_report()
    report["job_cycles"] = []
    result = phase_diagnostics(report, "baseline")
    assert result["available"] and result["cycles"] == []
    assert result["build_interval_count"] == result["page_interval_count"] == 0
    for row in result["routes"].values():
        assert row["outside"]["count"] == 150
        for kind in ("build", "pages"):
            assert row[kind] == {
                "count": 0,
                "p95_ms": None,
                "p99_ms": None,
                "max_ms": None,
            }
    assert public_diagnostics(result) == result


@pytest.mark.parametrize("offset,gap", [(62025, 5), (61990, 0), (62020, 0)])
def test_closest_missing_witness_is_to_individual_page_not_empty_envelope(offset, gap):
    report = complete_report()
    target = next(
        row
        for row in report["spans"]
        if row["route"] == "/up" and row["offset_ms"] == 62005
    )
    target["offset_ms"] = offset
    result = phase_diagnostics(report, "mixed")
    assert result["available"]
    assert result["cycles"][1]["missing_witness_gap_ms"]["pages"]["/up"] == gap
    assert result["routes"]["/up"]["pages"]["count"] == 4
    assert result["routes"]["/up"]["outside"]["count"] == 141
    receipt = {"passed": True}
    check_scenario(report, receipt, "mixed")
    assert not receipt["passed"]
    assert not receipt["background_export_cycles"][1]["protected_reads_during_pages"]


def test_crossing_both_intervals_is_explicit_shared_count_not_dropped_or_double_total():
    report = complete_report()
    target = next(
        row
        for row in report["spans"]
        if row["route"] == "/up" and row["offset_ms"] == 1010
    )
    target["duration_ms"] = 1050
    result = phase_diagnostics(report, "mixed")
    assert result["available"]
    row = result["routes"]["/up"]
    assert row["build"]["count"] == 5 and row["pages"]["count"] == 6
    assert row["shared_build_page_count"] == 1
    assert sum(row[kind]["count"] for kind in BUCKETS) - 1 == row["total_count"] == 150
    assert row["build"]["p95_ms"] == row["pages"]["p99_ms"] == 1050


@pytest.mark.parametrize(
    "corruption",
    [
        "missing_route",
        "non200",
        "nan",
        "zero_duration",
        "truncated",
        "unsettled",
        "partial",
        "too_many_requests",
        "missing_cycle",
        "missing_page",
        "failed_page",
        "missing_build",
        "failed_build",
        "unbound_origin",
        "stage_truncated",
        "missing_substage",
        "bad_cpu",
        "failed_substage",
        "page_before_build",
        "page_envelope",
        "overlapping_cycles",
    ],
)
def test_partial_malformed_or_unaligned_diagnostics_remain_unavailable(corruption):
    report = complete_report()
    metric = report["job_cycles"][0]["metrics"]
    if corruption == "missing_route":
        report["spans"].pop()
    elif corruption == "non200":
        report["spans"][0]["status"] = 500
    elif corruption == "nan":
        report["spans"][0]["duration_ms"] = float("nan")
    elif corruption == "zero_duration":
        report["spans"][0]["duration_ms"] = 0
    elif corruption == "truncated":
        report["dropped_spans"] = 1
    elif corruption == "unsettled":
        report["unsettled_requests"] = 1
    elif corruption == "partial":
        report["completed"] = False
    elif corruption == "too_many_requests":
        report["spans"] *= 2
    elif corruption == "missing_cycle":
        report["job_cycles"].pop()
    elif corruption == "missing_page":
        report["job_cycles"][0]["page_spans"].pop()
    elif corruption == "failed_page":
        report["job_cycles"][0]["page_spans"][0]["status"] = 500
    elif corruption == "missing_build":
        metric["spans"] = []
    elif corruption == "failed_build":
        metric["spans"][0]["failed"] = True
    elif corruption == "unbound_origin":
        metric["origin_timestamp"] = report["origin_timestamp"] - 1
    elif corruption == "stage_truncated":
        metric["dropped_spans"] = 1
    elif corruption == "missing_substage":
        metric["stages"].pop("projection")
    elif corruption == "bad_cpu":
        metric["stages"]["json_encode"]["sync_thread_cpu_ms"] = float("nan")
    elif corruption == "failed_substage":
        metric["stages"]["aes_encrypt"]["failed"] = 1
    elif corruption == "page_before_build":
        report["job_cycles"][0]["page_spans"][0]["offset_ms"] = 1050
    elif corruption == "page_envelope":
        report["job_cycles"][0]["page_spans"] = [
            {
                "route": "workouts/export-page",
                "offset_ms": 2000,
                "duration_ms": 920,
                "status": 200,
            }
        ]
    elif corruption == "overlapping_cycles":
        report["job_cycles"][1]["metrics"]["origin_timestamp"] = 101
    assert phase_diagnostics(report, "mixed") == {"available": False}


def test_public_diagnostics_strip_private_fields_and_preserve_failed_acceptance():
    report = complete_report()
    report["private_owner"] = "PRIVATE_DATA"
    report["spans"][0]["raw_url"] = "PRIVATE_DATA"
    receipt = {"passed": False, "failure_count": 4}
    check_scenario(report, receipt, "mixed")
    assert receipt["latency_diagnostics"]["available"] and not receipt["passed"]
    receipt["latency_diagnostics"]["private_clock"] = "PRIVATE_DATA"
    receipt["latency_diagnostics"]["routes"]["PRIVATE_DATA"] = {
        "payload": "PRIVATE_DATA"
    }
    receipt["latency_diagnostics"]["cycles"][0]["export_substages"]["projection"][
        "raw_sql"
    ] = "PRIVATE_DATA"
    safe = mixed_public_receipt(
        {"passed": False, "cleaned_owned_resources": True, "phases": {"mixed": receipt}}
    )
    data = safe["phases"]["mixed"]["latency_diagnostics"]
    text = json.dumps(data, allow_nan=False)
    assert "PRIVATE_DATA" not in text and "origin_timestamp" not in text
    assert set(data["routes"]) == READS and not safe["passed"]
    assert set(data["cycles"][0]["export_substages"]) == set(SUBSTAGES)
    assert set(data["cycles"][0]["export_substages"]["projection"]) == set(STAGE_FIELDS)
    assert data["stage_timings_inclusive"] and not data["stage_timings_summed"]


@pytest.mark.parametrize(
    "corruption",
    [
        "nan",
        "bool_counter",
        "extra_cycle",
        "wrong_cycle",
        "wrong_total",
        "missing_bucket",
        "summed_stages",
        "partial_percentile",
        "reversed_percentile",
        "noninclusive_stage",
    ],
)
def test_second_whitelist_rejects_corrupt_numeric_diagnostics(corruption):
    value = phase_diagnostics(complete_report(), "mixed")
    if corruption == "nan":
        value["routes"]["/up"]["build"]["p95_ms"] = float("nan")
    elif corruption == "bool_counter":
        value["cycles"][0]["export_substages"]["projection"]["calls"] = True
    elif corruption == "extra_cycle":
        value["cycles"].append(value["cycles"][0])
    elif corruption == "wrong_cycle":
        value["cycles"][0]["cycle"] = 5
    elif corruption == "wrong_total":
        value["routes"]["/up"]["total_count"] = 149
    elif corruption == "missing_bucket":
        del value["routes"]["/up"]["outside"]
    elif corruption == "summed_stages":
        value["stage_timings_summed"] = True
    elif corruption == "partial_percentile":
        value["routes"]["/up"]["build"]["p95_ms"] = None
    elif corruption == "reversed_percentile":
        value["routes"]["/up"]["build"]["p95_ms"] = 11
    elif corruption == "noninclusive_stage":
        value["cycles"][0]["export_substages"]["projection"]["max_wall_ms"] = 2
    assert public_diagnostics(value) == {"available": False}


def test_fixed_numeric_shape_fits_retained_receipt_budget_even_for_all_missing_gaps():
    report = complete_report()
    mixed = phase_diagnostics(report, "mixed")
    for cycle in mixed["cycles"]:
        for values in cycle["missing_witness_gap_ms"].values():
            for key in values:
                values[key] = 999999999999999.9
        for row in cycle["export_substages"].values():
            for key in STAGE_FIELDS[3:]:
                row[key] = 999999999999999.9 if "ms" in key else 999999999999999
    report["job_cycles"] = []
    baseline = phase_diagnostics(report, "baseline")
    pair = {
        "phases": {
            "baseline": {"latency_diagnostics": public_diagnostics(baseline)},
            "mixed": {"latency_diagnostics": public_diagnostics(mixed)},
        }
    }
    encoded = json.dumps(pair, indent=2, allow_nan=False).encode()
    assert pair["phases"]["mixed"]["latency_diagnostics"]["available"]
    assert len(encoded) <= 16 * 1024
    # The actual historical receipt stays immutable. Its85521-byte size plus
    # the bounded new section is still within the unchanged100KiB upload gate.
    assert 85521 + len(encoded) <= 100 * 1024


@pytest.fixture
def actual_source(monkeypatch):
    yield from original_tests.source.__wrapped__(monkeypatch)


@pytest.mark.asyncio
async def test_numeric_substages_come_from_actual_existing_json_crypto_wrappers(
    actual_source, monkeypatch
):
    await original_tests.test_actual_original_create_retains_19_pages_encryption_finalization_and_one_shot(
        actual_source, monkeypatch, False
    )
    metrics = actual_source[2].snapshot()
    report = complete_report()
    # Keep this fixture's clock alignment while using actual captured counters
    # and timings. No global clock or existing source implementation is changed.
    report["job_cycles"][0]["metrics"]["stages"] = copy.deepcopy(metrics["stages"])
    result = phase_diagnostics(report, "mixed")
    assert result["available"]
    for stage in SUBSTAGES:
        row = result["cycles"][0]["export_substages"][stage]
        assert row == {key: metrics["stages"][stage][key] for key in STAGE_FIELDS}
        assert row["calls"] == row["completed"] == 19 and row["failed"] == 0
        assert row["inclusive_wall_ms"] > 0
    assert (
        result["cycles"][0]["export_substages"]["json_encode"]["sync_thread_cpu_ms"] > 0
    )
    assert (
        result["cycles"][0]["export_substages"]["aes_encrypt"]["sync_thread_cpu_ms"] > 0
    )
