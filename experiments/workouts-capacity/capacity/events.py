"""Bounded experiment-only stage markers; no source, URL, identity or errors."""

import functools
import itertools
import json
import time

PHASES = {"baseline", "mixed", "boundaries", "diagnostic"}
STAGES = {
    "legal_case",
    "thumbnail_normalize",
    "cover_compare",
    "cover_frames",
    "cover_cache_reuse",
    "evidence_frames",
    "export_build",
    "export_read",
    "loop_lag",
    "gc_pause",
}
_sequence = itertools.count(1)
_counts = {
    stage: {event: 0 for event in ("start", "end", "failed")} for stage in STAGES
}


def stage_counts():
    return {stage: dict(counts) for stage, counts in _counts.items()}


def emit(stage, phase, event, **numbers):
    if (
        stage not in STAGES
        or phase not in PHASES
        or event not in {"start", "end", "failed"}
    ):
        raise ValueError("Unknown experiment marker")
    result = {
        "sequence": next(_sequence),
        "timestamp": time.time(),
        "stage": stage,
        "phase": phase,
        "event": event,
    }
    for key, value in numbers.items():
        if (
            key not in {"duration_ms", "input_bytes", "pixels", "case_index"}
            or isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not 0 <= value <= 1e18
        ):
            raise ValueError("Only bounded numeric stage metadata is allowed")
        result[key] = value
    _counts[stage][event] += 1
    print("CAPACITY_STAGE " + json.dumps(result), flush=True)


def traced(stage, phase, original, metadata=None):
    @functools.wraps(original)
    async def call(*args, **kwargs):
        details = metadata(*args, **kwargs) if metadata else {}
        started = time.monotonic()
        emit(stage, phase, "start", **details)
        try:
            result = await original(*args, **kwargs)
        except BaseException:
            emit(
                stage, phase, "failed", duration_ms=(time.monotonic() - started) * 1000
            )
            raise
        emit(stage, phase, "end", duration_ms=(time.monotonic() - started) * 1000)
        return result

    return call
