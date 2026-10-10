"""Second fixed whitelist; nested inclusive timings are never added together."""

import math

from capacity.ci_safety import SafetyError, phase_receipt, public_receipt
from capacity.export_diagnostic_metrics import STAGES

ROUTES = {
    "/up",
    "recipes/list",
    "recipes/detail",
    "recipes/search",
    "recipes/chat",
    "workouts/export-build",
    "workouts/export-page",
    "workouts/export-remove",
}
FIELDS = {
    "calls",
    "completed",
    "failed",
    "query_count",
    "inclusive_wall_ms",
    "max_wall_ms",
    "sync_thread_cpu_ms",
    "bytes",
}


def numeric(value):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not 0 <= value <= 1e15
    ):
        raise SafetyError("invalid_numeric_receipt")
    return value


def diagnostic(report, samples, observation, counts, oom=None):
    # Use the existing numeric observer summaries, but not its media expectations.
    host = phase_receipt(report, samples, "baseline")
    metrics = report.get("metrics") or {}
    status = report.get("status") or {}
    complete = (
        report.get("completed") is True
        and metrics.get("complete") is True
        and metrics.get("pages") == 19
        and report.get("unsettled_requests") == 0
        and report.get("dropped_spans") == 0
        and metrics.get("dropped_spans") == 0
        and metrics.get("inclusive_timings") is True
        and metrics.get("summed_nested_timings") is False
        and report.get("percentile_method") == "nearest_rank"
    )
    stages = {
        s: {
            k: numeric(v)
            for k, v in metrics.get("stages", {}).get(s, {}).items()
            if k in FIELDS
        }
        for s in STAGES
    }
    expected = {
        "build_total": 1,
        "source_inventory": 1,
        "size_guard": 19,
        "projection": 19,
        "json_encode": 19,
        "aes_encrypt": 19,
        "page_writer_commit": 19,
        "finalization": 1,
    }
    complete &= all(
        stages[s].get("completed") == n
        and stages[s].get("calls") == n
        and not stages[s].get("failed")
        for s, n in expected.items()
    )
    complete &= stages["source_inventory"].get("query_count", 0) > 0
    fetched = stages["source_fetch_decode"]
    complete &= bool(
        fetched.get("completed", 0) > 0
        and fetched.get("query_count", 0) > 0
        and fetched.get("calls") == fetched.get("completed")
        and fetched.get("failed") == 0
        and metrics.get("query_count", 0) > 0
    )
    routes = {k: v for k, v in report.get("routes", {}).items() if k in ROUTES}
    required = {
        "/up": 80,
        "recipes/list": 80,
        "recipes/detail": 80,
        "recipes/search": 80,
        "recipes/chat": 5,
        "workouts/export-build": 1,
        "workouts/export-page": 19,
        "workouts/export-remove": 1,
    }
    statuses = {"workouts/export-build": "201", "workouts/export-remove": "204"}
    expected_routes = (
        all(
            row.get("count", 0) == required[k]
            and not row.get("unexpected")
            and set(row.get("statuses", {})) == {statuses.get(k, "200")}
            and sum(row.get("statuses", {}).values()) == required[k]
            for k, row in routes.items()
        )
        and set(routes) == ROUTES
    )
    complete &= expected_routes
    safety = bool(
        samples
        and oom is False
        and observation.get("completed") is True
        and observation.get("local_memory_gate") == "passed"
        and host["peak_bytes"] <= 410 * 2**20
        and not any(
            s.get("stop_required")
            or s.get("oom")
            or s.get("oom_kill")
            or s.get("protected_5xx")
            for s in samples
        )
    )
    idle = (
        counts is not None
        and counts.get("recipe_active") == 0
        and counts.get("workout_active") == 0
        and counts.get("extract_jobs") == 0
        and counts.get("cover_jobs") == 0
        and counts.get("export_snapshots") == 0
        and counts.get("export_pages") == 0
    )
    complete &= idle and status.get("provider_attempts") == {
        "chat": 5,
        "cover": 0,
        "extraction": 0,
    }
    slos = all(
        row.get("p95_ms") is not None
        and row["p95_ms"]
        <= (
            500
            if k
            in {
                "/up",
                "recipes/list",
                "recipes/detail",
                "recipes/search",
                "workouts/export-page",
            }
            else 1000
        )
        for k, row in routes.items()
    )
    return {
        "complete": bool(complete),
        "safety_passed": safety,
        "latency_slos_passed": slos,
        "workers_idle": idle,
        "routes": routes,
        "stages": stages,
        "stage_spans": metrics.get("spans", []),
        "request_spans": report.get("spans", []),
        "origin_timestamp": report.get("origin_timestamp"),
        "stage_origin_timestamp": metrics.get("origin_timestamp"),
        "query_count": metrics.get("query_count"),
        "observer_completed": observation.get("completed") is True,
        "unsettled_requests": report.get("unsettled_requests"),
        "container_oom_killed": oom,
        "diagnostics": status.get("diagnostics", {}),
        "host": host,
    }


def receipt(summary, data):
    safe = public_receipt(summary)
    # Reuse the original route/diagnostic/host whitelist through a temporary phase.
    intermediary = public_receipt(
        {
            **summary,
            "phases": {
                "baseline": {
                    **data.get("host", {}),
                    "routes": data.get("routes", {}),
                    "diagnostics": data.get("diagnostics", {}),
                }
            },
        }
    )["phases"]["baseline"]
    output = {
        k: data.get(k) is True
        for k in (
            "complete",
            "safety_passed",
            "latency_slos_passed",
            "workers_idle",
            "observer_completed",
        )
    }
    output.update(
        inclusive_timings=True,
        summed_nested_timings=False,
        container_oom_killed=data.get("container_oom_killed")
        if type(data.get("container_oom_killed")) is bool
        else None,
        routes=intermediary["routes"],
        diagnostics=intermediary["diagnostics"],
        host={
            k: intermediary[k]
            for k in (
                "peak_bytes",
                "final_bytes",
                "sample_count",
                "cpu_usage_usec",
                "cpu_throttled_usec",
                "cpu_throttled_periods",
                "peak_cpu_percent",
                "peak_process_count",
            )
            if k in intermediary
        },
    )
    output["unsettled_requests"] = (
        numeric(data["unsettled_requests"])
        if data.get("unsettled_requests") is not None
        else None
    )
    output["stages"] = {
        s: {
            k: numeric(v)
            for k, v in data.get("stages", {}).get(s, {}).items()
            if k in FIELDS
        }
        for s in STAGES
    }
    output["query_count"] = (
        numeric(data["query_count"]) if data.get("query_count") is not None else None
    )
    output["stage_spans"], output["request_spans"] = [], []
    origin = data.get("origin_timestamp")
    stage_origin = data.get("stage_origin_timestamp")
    for row in data.get("stage_spans", [])[:160]:
        if row.get("stage") not in STAGES:
            raise SafetyError("invalid_numeric_receipt")
        if origin is None or stage_origin is None:
            continue  # Aggregate stage timings survive unavailable alignment.
        output["stage_spans"].append(
            dict(
                stage=row["stage"],
                offset_ms=numeric(
                    row["offset_ms"] + max(0, stage_origin - origin) * 1000
                ),
                **{
                    k: numeric(row[k])
                    for k in ("duration_ms", "query_count", "sync_thread_cpu_ms")
                },
                failed=row.get("failed") is True,
            )
        )
    for row in data.get("request_spans", [])[:384]:
        if row.get("route") not in ROUTES:
            raise SafetyError("invalid_numeric_receipt")
        output["request_spans"].append(
            dict(
                route=row["route"],
                **{k: numeric(row[k]) for k in ("offset_ms", "duration_ms", "status")},
            )
        )
    safe["diagnostic"] = output
    safe["r04_closed"] = safe["render_parity"] = safe["provider_quality"] = False
    safe["passed"] = bool(
        safe["cleaned_owned_resources"]
        and output["complete"]
        and output["safety_passed"]
        and output["latency_slos_passed"]
        and summary.get("failure") is None
    )
    return safe
