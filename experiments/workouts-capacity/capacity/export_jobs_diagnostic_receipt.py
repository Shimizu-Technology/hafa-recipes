"""Separate async admission/completion contract; no reinterpretation of201 failures."""

import re

from capacity.ci_safety import SafetyError
from capacity.export_diagnostic_receipt import (
    complete_stages,
    numeric,
)
from capacity.export_diagnostic_receipt import (
    diagnostic as synchronous,
)
from capacity.export_diagnostic_receipt import (
    receipt as base_receipt,
)
from capacity.export_jobs_diagnostic_contract import (
    FAILURES,
    JOB_BOOLEANS,
    JOB_NUMBERS,
    OUTCOME_BOOLEANS,
    OUTCOME_NUMBERS,
    READS,
    ROUTES,
)


def summarize(report, samples, observation, counts, oom=None):
    data = synchronous(report, samples, observation, counts, oom)
    metrics = report.get("metrics") or {}
    jobs = metrics.get("job_checks") or {}
    outcome = report.get("job_outcome") or {}
    routes = {
        key: row for key, row in report.get("routes", {}).items() if key in ROUTES
    }
    required = {
        **dict.fromkeys(READS, 80),
        "recipes/chat": 5,
        "workouts/export-admit": 1,
        "workouts/export-page": 19,
        "workouts/export-cancel": 1,
    }
    expected_routes = set(routes) == ROUTES and all(
        row.get("count") == required.get(key, row.get("count"))
        and (key != "workouts/export-status" or 1 <= row.get("count", 0) <= 30)
        and row.get("unexpected") == 0
        and row.get("statuses")
        == {"202" if key == "workouts/export-admit" else "200": row.get("count")}
        for key, row in routes.items()
    )
    settled = (
        outcome.get("pages_read") == 19
        and outcome.get("workouts_rows") == 190
        and outcome.get("versions_rows") == 190
        and outcome.get("poll_count")
        == routes.get("workouts/export-status", {}).get("count")
        and all(outcome.get(key) is True for key in OUTCOME_BOOLEANS)
        and jobs.get("job_count") == 1
        and jobs.get("status_code") == 5
        and jobs.get("slot_rows") == 1
        and jobs.get("active_slot_count") == 0
        and jobs.get("actual_end_ack_count") == 1
        and jobs.get("global_slot_idle") is True
        and jobs.get("source_frames_retired") is True
        and all(
            jobs.get(key) == 0
            for key in (
                "snapshot_count",
                "page_count",
                "running_registry_count",
                "worker_active_task_count",
                "worker_active_execution_count",
                "worker_pending_ack_count",
                "worker_heartbeat_task_count",
            )
        )
        and jobs.get("deadline_window_ms") == 120000
        and jobs.get("expiry_window_ms") == 600000
    )
    completion = jobs.get("ack_completion_ms")
    completion_slo = type(completion) in (int, float) and 0 <= completion <= 120000
    route_slos = expected_routes and all(
        row.get("p95_ms") is not None
        and row["p95_ms"]
        <= (
            500
            if key in READS | {"workouts/export-page", "workouts/export-status"}
            else 1000
        )
        for key, row in routes.items()
    )
    # One observation uses nearest rank: admission outlier cannot be averaged away.
    admission = outcome.get("admission_ms")
    admission_slo = type(admission) in (int, float) and 0 <= admission <= 1000
    complete = (
        complete_stages(report, metrics, data["stages"])
        and expected_routes
        and settled
        and data["workers_idle"]
        and report.get("driver_failure_code") is None
        and (report.get("status") or {}).get("provider_attempts")
        == {"chat": 5, "cover": 0, "extraction": 0}
        and not any(
            row.get("unexpected", 0) for row in report.get("routes", {}).values()
        )
    )
    data.update(
        complete=bool(complete),
        latency_slos_passed=bool(route_slos and admission_slo and completion_slo),
        admission_slo_passed=admission_slo,
        completion_slo_passed=completion_slo,
        routes=routes,
        job_checks=jobs,
        job_outcome=outcome,
        driver_failure_code=report.get("driver_failure_code"),
    )
    return data


def receipt(summary, data):
    safe = base_receipt(summary, data, route_whitelist=ROUTES)
    output = safe.pop("diagnostic")
    output["routes"] = {}
    for route, row in data.get("routes", {}).items():
        if route not in ROUTES:
            raise SafetyError("invalid_numeric_receipt")
        output["routes"][route] = {
            key: numeric(row[key]) if row.get(key) is not None else None
            for key in ("count", "unexpected", "p95_ms", "p99_ms")
        }
        output["routes"][route]["statuses"] = {
            key: numeric(value)
            for key, value in row.get("statuses", {}).items()
            if isinstance(key, str) and re.fullmatch(r"(?:0|[1-5][0-9]{2})", key)
        }
    output["job_checks"] = {
        key: numeric(value) if value is not None else None
        for key, value in data.get("job_checks", {}).items()
        if key in JOB_NUMBERS
    }
    output["job_checks"].update(
        {
            key: value
            if type(value := data.get("job_checks", {}).get(key)) is bool
            else None
            for key in JOB_BOOLEANS
        }
    )
    output["job_outcome"] = {
        key: numeric(value) if value is not None else None
        for key, value in data.get("job_outcome", {}).items()
        if key in OUTCOME_NUMBERS
    }
    output["job_outcome"].update(
        {
            key: value
            if type(value := data.get("job_outcome", {}).get(key)) is bool
            else None
            for key in OUTCOME_BOOLEANS
        }
    )
    output["admission_slo_passed"] = data.get("admission_slo_passed") is True
    output["completion_slo_passed"] = data.get("completion_slo_passed") is True
    failure = data.get("driver_failure_code")
    if failure is not None and failure not in FAILURES:
        raise SafetyError("invalid_public_failure")
    output["driver_failure_code"] = failure
    safe["background_export_diagnostic"] = output
    return safe
