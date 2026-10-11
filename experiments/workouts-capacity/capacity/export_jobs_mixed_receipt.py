"""Fixed numeric five-cycle acceptance, never bodies, job IDs or raw timestamps."""

from capacity.ci_safety import (
    EXTRA_READS,
    EXTRA_WRITES,
    READS,
    number,
    phase_receipt,
    public_receipt,
)
from capacity.export_diagnostic_metrics import STAGES
from capacity.export_diagnostic_receipt import complete_stages
from capacity.export_jobs_diagnostic_contract import OUTCOME_BOOLEANS, OUTCOME_NUMBERS
from capacity.export_jobs_overlap import overlap_evidence

JOB_READS = {"workouts/export-status"}
JOB_WRITES = {"workouts/export-admit", "workouts/export-cancel"}


def mixed_phase_receipt(report, samples, phase, baseline=None):
    return phase_receipt(
        report,
        samples,
        phase,
        baseline,
        extra_reads=EXTRA_READS | JOB_READS,
        extra_writes=(
            EXTRA_WRITES - {"workouts/export-build", "workouts/export-remove"}
        )
        | JOB_WRITES,
    )


def cycle_proofs(report):
    cycles = report.get("job_cycles", [])
    if not isinstance(cycles, list) or len(cycles) != 5:
        return [], False
    result = []
    reads = [row for row in report.get("spans", []) if row.get("route") in READS]
    for index, cycle in enumerate(cycles, 1):
        out, checks = cycle.get("outcome", {}), cycle.get("job_checks", {})
        evidence = {**report, "spans": reads + cycle.get("page_spans", [])}
        overlap = overlap_evidence(
            evidence, cycle.get("metrics", {}), expected_reads=150, request_limit=1024
        )
        metrics = cycle.get("metrics", {})
        stages = metrics.get("stages", {})
        good = (
            set(stages) == STAGES
            and complete_stages(report, metrics, stages)
            and stages.get("aes_encrypt", {}).get("bytes", 0) >= 61231576
            and all(out.get(key) is True for key in OUTCOME_BOOLEANS)
            and out.get("pages_read") == 19
            and out.get("workouts_rows") == 190
            and out.get("versions_rows") == 190
            and out.get("dataset_count") == 2
            and out.get("total_rows") == 380
            and type(out.get("admission_ms")) in (int, float)
            and 0 <= out["admission_ms"] <= 1000
            and checks.get("cycle_count") == index
            and checks.get("cancelled_count") == index
            and checks.get("job_count") == 1
            and checks.get("status_code") == 5
            and checks.get("actual_end_ack_count") == 1
            and type(checks.get("ack_completion_ms")) in (int, float)
            and 0 <= checks["ack_completion_ms"] <= 120000
            and checks.get("deadline_window_ms") == 120000
            and checks.get("expiry_window_ms") == 600000
            and checks.get("slot_rows") == 1
            and checks.get("global_slot_idle") is True
            and checks.get("source_frames_retired") is True
            and all(
                checks.get(key) == 0
                for key in (
                    "active_slot_count",
                    "snapshot_count",
                    "page_count",
                    "running_registry_count",
                    "worker_active_task_count",
                    "worker_active_execution_count",
                    "worker_heartbeat_task_count",
                    "worker_retirement_task_count",
                    "worker_pending_ack_count",
                )
            )
        )
        # Exact cadence is not moved to create witnesses. Missing actual overlap remains unavailable.
        good = good and overlap["responsive_concurrency"]
        result.append(
            {
                "passed": good,
                "outcome": out,
                "ack_completion_ms": checks.get("ack_completion_ms"),
                "cipher_bytes": stages.get("aes_encrypt", {}).get("bytes"),
                **overlap,
            }
        )
    identical_cipher = len({row["cipher_bytes"] for row in result}) == 1
    return result, identical_cipher and all(row["passed"] for row in result)


def check_scenario(report, receipt, phase):
    rows = report.get("routes", {})
    counts_good = all(
        rows.get(route, {}).get("count") == 150
        and rows[route].get("statuses") == {"200": 150}
        for route in READS
    )
    if phase == "mixed":
        proofs, good = cycle_proofs(report)
        receipt["background_export_cycles"] = proofs
        counts_good = (
            counts_good
            and good
            and all(
                rows.get(route, {}).get("count") == count
                for route, count in {
                    "workouts/export-admit": 5,
                    "workouts/export-page": 95,
                    "workouts/export-cancel": 5,
                }.items()
            )
        )
    receipt["passed"] = receipt["passed"] and counts_good


def mixed_public_receipt(summary):
    safe = public_receipt(summary, additional_routes=JOB_READS | JOB_WRITES)
    phase = summary.get("phases", {}).get("mixed", {})
    if "mixed" in safe["phases"]:
        values = []
        for row in phase.get("background_export_cycles", [])[:5]:
            value = {
                key: row.get(key) is True
                for key in (
                    "passed",
                    "protected_reads_during_build",
                    "protected_reads_during_pages",
                    "responsive_concurrency",
                )
            }
            value["outcome"] = {
                key: number(item)
                for key, item in row.get("outcome", {}).items()
                if key in OUTCOME_NUMBERS
            }
            value["outcome"].update(
                {
                    key: row.get("outcome", {}).get(key) is True
                    for key in OUTCOME_BOOLEANS
                }
            )
            value["cipher_bytes"] = (
                number(row["cipher_bytes"])
                if row.get("cipher_bytes") is not None
                else None
            )
            value["ack_completion_ms"] = (
                number(row["ack_completion_ms"])
                if row.get("ack_completion_ms") is not None
                else None
            )
            for key in ("overlap_counts", "overlap_p95_ms"):
                value[key] = {
                    phase: {
                        route: number(item) if item is not None else None
                        for route, item in row.get(key, {}).get(phase, {}).items()
                        if route in READS
                    }
                    for phase in ("build", "pages")
                }
            values.append(value)
        safe["phases"]["mixed"]["background_export_cycles"] = values
    for phase in ("baseline", "mixed"):
        if phase in safe["phases"]:
            raw = summary.get("phases", {}).get(phase, {}).get("timing_proof", {})
            safe["phases"][phase]["timing_proof"] = {
                "passed": raw.get("passed") is True,
                **{
                    key: number(raw[key]) if raw[key] is not None else None
                    for key in (
                        "planned_traffic_seconds",
                        "planned_observation_seconds",
                        "first_traffic_delay_seconds",
                        "last_traffic_offset_seconds",
                        "observer_duration_seconds",
                        "actual_tail_seconds",
                    )
                    if key in raw
                },
            }
            if raw.get("passed") is not True:
                safe["phases"][phase]["passed"] = False
                safe["passed"] = False
    return safe
