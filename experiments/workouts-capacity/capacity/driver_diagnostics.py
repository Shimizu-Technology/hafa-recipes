"""Fixed load diagnostics and bounded numeric saved outcomes, never private data."""

import asyncio

from capacity.events import STAGES

FAILURES = {
    "mixed_timing_failed",
    "workload_slot_missed",
    "metadata_checkpoint_unavailable",
    "metadata_checkpoint_invalid",
    "diagnostic_metadata_invalid",
    "cold_job_not_distinct",
    "source_acceptance_failed",
    "completed_recipe_missing_link",
    "unexpected_workload_status",
    "cold_evidence_frames_missing",
    "cold_cover_reuse_missing",
    "cold_cover_fallback_missing",
    "cold_cover_compare_missing",
    "cold_saved_outcomes_missing",
    "cold_saved_links_not_distinct",
    "cold_jobs_not_drained",
    "protected_category_failed",
    "driver_request_timeout",
    "driver_transport_failed",
    "driver_cancelled",
    "driver_unexpected_failure",
}
JOB_STATES = {
    "claimed",
    "queued",
    "processing",
    "completed",
    "ready",
    "incomplete",
    "failed",
    "expired",
    "cancelled",
    "superseded",
}


class AcceptanceFailure(RuntimeError):
    def __init__(self, code):
        if not isinstance(code, str) or code not in FAILURES:
            raise ValueError("Unknown fixed load failure")
        self.code = code
        super().__init__(code)


def failure_code(error):
    import httpx  # Driver-only dependency; hosted coordinator remains stdlib.

    if isinstance(error, AcceptanceFailure):
        return error.code
    if isinstance(error, (asyncio.CancelledError, KeyboardInterrupt, SystemExit)):
        return "driver_cancelled"
    if isinstance(error, (httpx.TimeoutException, TimeoutError)):
        return "driver_request_timeout"
    if isinstance(error, httpx.TransportError):
        return "driver_transport_failed"
    return "driver_unexpected_failure"


def count(value):
    if type(value) is not int or not 0 <= value <= 1_000_000_000:
        raise ValueError("Invalid bounded load aggregate")
    return value


def partial_metadata(report):
    code = report.get("failure_code")
    if code is not None and (not isinstance(code, str) or code not in FAILURES):
        raise ValueError("Unknown fixed load failure")
    saved = report.get("saved_outcomes")
    output = {
        "driver_failure_code": code,
        "saved_outcomes_available": isinstance(saved, dict),
    }
    if not isinstance(saved, dict):
        return output
    for key in (
        "accepted_workout_count",
        "distinct_recipe_jobs_submitted",
        "distinct_saved_recipe_links",
        "fallback_jobs_submitted",
    ):
        output[key] = count(saved[key]) if key in saved else None
    for kind in ("recipes", "workouts"):
        values = saved.get(kind + "_states")
        output[kind + "_states"] = (
            {key: count(value) for key, value in values.items() if key in JOB_STATES}
            if isinstance(values, dict)
            else None
        )
    output["stage_checkpoints"] = {}
    checkpoints = saved.get("stage_checkpoints", {})
    for name in ("before", "after"):
        values = checkpoints.get(name, {}).get("stage_counts")
        if not isinstance(values, dict):
            continue
        output["stage_checkpoints"][name] = {
            "stage_counts": {
                stage: {
                    event: count(events[event])
                    for event in ("start", "end", "failed")
                    if event in events
                }
                for stage, events in values.items()
                if stage in STAGES and isinstance(events, dict)
            }
        }
        scenarios = checkpoints.get(name, {}).get("cover_scenarios")
        if isinstance(scenarios, dict):
            output["stage_checkpoints"][name]["cover_scenarios"] = {
                scenario: {
                    field: count(row[field])
                    for field in ("observed", "completed", "linked_recipes")
                    if field in row
                }
                for scenario, row in scenarios.items()
                if scenario in {"cached", "fallback"} and isinstance(row, dict)
            }
    return output
