"""Finite source/protocol tests; not native hosted mixed acceptance."""

import copy
import json
from itertools import pairwise
from pathlib import Path

import pytest
import test_export_diagnostic as original_tests
from capacity.ci_run import TOTAL_SECONDS, Coordinator
from capacity.ci_safety import READS
from capacity.export_jobs_mixed_ci import BRANCH, MixedCoordinator
from capacity.export_jobs_mixed_driver import reader_targets
from capacity.export_jobs_mixed_receipt import (
    check_scenario,
    cycle_proofs,
    mixed_public_receipt,
)
from test_export_jobs_diagnostic import report


@pytest.fixture
def isolated_source(monkeypatch):
    yield from original_tests.source.__wrapped__(monkeypatch)


def complete_report():
    value = report()
    value["spans"] = [
        {"route": route, "offset_ms": offset, "duration_ms": 10, "status": 200}
        for route in READS
        for offset in [
            *[1010 + 60000 * n for n in range(5)],
            *[2005 + 60000 * n for n in range(5)],
            *[4000 + 100 * n for n in range(140)],
        ]
    ]
    value["job_cycles"] = []
    for n in range(5):
        cycle = {
            "outcome": copy.deepcopy(value["job_outcome"]),
            "job_checks": copy.deepcopy(value["metrics"]["job_checks"]),
            "metrics": copy.deepcopy(value["metrics"]),
            "page_spans": [
                {
                    "route": "workouts/export-page",
                    "offset_ms": 2000 + 60000 * n + 50 * i,
                    "duration_ms": 20,
                    "status": 200,
                }
                for i in range(19)
            ],
        }
        cycle["job_checks"].update(cycle_count=n + 1, cancelled_count=n + 1)
        cycle["metrics"]["origin_timestamp"] += 60 * n
        cycle["metrics"]["stages"]["aes_encrypt"]["bytes"] = 61231576
        value["job_cycles"].append(cycle)
    for route in READS:
        value["routes"][route].update(count=150, statuses={"200": 150})
    for route, status, count in (
        ("workouts/export-admit", "202", 5),
        ("workouts/export-page", "200", 95),
        ("workouts/export-cancel", "200", 5),
    ):
        value["routes"][route].update(count=count, statuses={status: count})
    return value


def test_both_phases_preserve_same_anchored_recipes_demand():
    assert sum(len(reader_targets(n)) for n in range(8)) == 150
    for n in range(8):
        targets = reader_targets(n, 100)
        assert targets[0] == 100 + 2 * n
        assert all(b - a == 16 for a, b in pairwise(targets))
        assert max(targets) < 400


def test_five_independent_content_ack_and_overlap_proofs():
    proofs, good = cycle_proofs(complete_report())
    assert good and len(proofs) == 5
    assert all(row["responsive_concurrency"] for row in proofs)


@pytest.mark.parametrize(
    "section,key,value",
    [
        ("outcome", "prescriptions_matched", False),
        ("outcome", "versions_rows", 189),
        ("outcome", "pages_read", 18),
        ("outcome", "admission_ms", 1001),
        ("job_checks", "actual_end_ack_count", 0),
        ("job_checks", "ack_completion_ms", 120001),
        ("job_checks", "deadline_window_ms", 120001),
        ("job_checks", "expiry_window_ms", 600001),
        ("job_checks", "source_frames_retired", False),
        ("job_checks", "worker_pending_ack_count", 1),
        ("job_checks", "active_slot_count", 1),
        ("job_checks", "snapshot_count", 1),
        ("job_checks", "cycle_count", 3),
    ],
)
def test_one_bad_cycle_cannot_hide_in_other_four(section, key, value):
    data = complete_report()
    data["job_cycles"][3][section][key] = value
    assert not cycle_proofs(data)[1]


def test_changed_cipher_stage_and_history_volume_fail():
    data = complete_report()
    data["job_cycles"][2]["metrics"]["stages"]["aes_encrypt"]["bytes"] -= 1
    assert not cycle_proofs(data)[1]
    data = complete_report()
    data["job_cycles"][2]["metrics"]["stages"]["page_writer_commit"]["completed"] = 18
    assert not cycle_proofs(data)[1]


@pytest.mark.parametrize(
    "field,value",
    [("unsettled_requests", 1), ("dropped_spans", 1), ("completed", False)],
)
def test_interrupted_or_truncated_evidence_cannot_pass(field, value):
    data = complete_report()
    data[field] = value
    assert not cycle_proofs(data)[1]


def test_empty_gap_is_not_download_overlap_and_slow_witness_fails():
    data = complete_report()
    for row in data["spans"]:
        if row["offset_ms"] == 2005 + 60000 * 3:
            row["offset_ms"] = 2025 + 60000 * 3
    assert not cycle_proofs(data)[1]
    data = complete_report()
    for row in data["spans"]:
        if row["offset_ms"] == 1010 + 60000 * 3:
            row["duration_ms"] = 501
    assert not cycle_proofs(data)[1]


def test_missing_round_or_export_cycle_fails_without_retries():
    data = complete_report()
    receipt = {"passed": True}
    data["routes"]["/up"].update(count=149, statuses={"200": 149})
    check_scenario(data, receipt, "baseline")
    assert not receipt["passed"]
    data = complete_report()
    data["job_cycles"].pop()
    assert not cycle_proofs(data)[1]


def test_public_receipt_is_numeric_and_keeps_cleanup_failure():
    data = complete_report()
    phase = {"passed": True, "routes": data["routes"]}
    check_scenario(data, phase, "mixed")
    phase["background_export_cycles"][0]["outcome"]["private_payload"] = "DO_NOT_COPY"
    safe = mixed_public_receipt(
        {"passed": True, "cleaned_owned_resources": False, "phases": {"mixed": phase}}
    )
    text = json.dumps(safe)
    assert (
        "DO_NOT_COPY" not in text
        and "origin_timestamp" not in text
        and "page_spans" not in text
    )
    assert not safe["passed"] and len(text.encode()) < 100 * 1024
    assert len(safe["phases"]["mixed"]["background_export_cycles"]) == 5


def test_old_defaults_and_new_branch_do_not_dispatch_old_jobs():
    assert Coordinator.driver_module == "capacity.driver"
    assert MixedCoordinator.driver_module == "capacity.export_jobs_mixed_driver"
    assert TOTAL_SECONDS == 1900 and BRANCH == "codex/workouts-export-jobs-mixed"
    root = Path(__file__).resolve().parents[3]
    workflows = root / ".github/workflows"
    old = (workflows / "workouts-capacity.yml").read_text()
    assert old.count("github.head_ref != 'codex/workouts-export-jobs-mixed'") == 2
    assert old.count("github.ref_name != 'codex/workouts-export-jobs-mixed'") == 2
    new = (workflows / "workouts-export-jobs-mixed.yml").read_text()
    assert "timeout-minutes: 35" in new and "persist-credentials: false" in new
    assert "if: always()" in new and "retention-days: 1" in new


@pytest.mark.asyncio
async def test_repeated_instrumentation_is_five_bounded_sequential_builds(
    isolated_source, monkeypatch
):
    svc, _, instrument = isolated_source
    calls = []

    async def original(*args, **kwargs):
        calls.append((args, kwargs))
        return "fixture-only"

    monkeypatch.setattr(svc.PrivateExportService, "create", original)
    cleanup = instrument.install(
        monkeypatch.setattr, wrap_singleton=False, max_builds=5
    )
    try:
        for index in range(5):
            assert await svc.PrivateExportService.create(index) == "fixture-only"
            assert instrument.snapshot()["stages"]["build_total"]["completed"] == 1
        with pytest.raises(RuntimeError):
            await svc.PrivateExportService.create(5)
        assert len(calls) == 5
    finally:
        cleanup()
