"""Observed overlap only: no SQL, provider calls, source holds or clock padding."""

import asyncio
import math
import time

from capacity.export_jobs_diagnostic_contract import READS
from capacity.statistics import nearest_rank


def active_build(value):
    if not isinstance(value, dict) or value.get("complete") is not False:
        return False
    stages = value.get("stages")
    if not isinstance(stages, dict) or not isinstance(
        row := stages.get("build_total"), dict
    ):
        return False
    return all(
        type(row.get(key)) is int and row[key] == expected
        for key, expected in (("calls", 1), ("completed", 0), ("failed", 0))
    )


async def wait_active_build(read, *, clock=time.monotonic, sleep=asyncio.sleep):
    # Leave transport/encoding time inside the unchanged500ms response gate.
    deadline = clock() + 0.45
    while clock() < deadline:
        value = read()
        if active_build(value):
            return True
        if isinstance(value, dict) and value.get("complete") is True:
            return False  # Missing the phase never triggers another build.
        await sleep(min(0.01, max(0, deadline - clock())))
    return False


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def _interval(row, shift=0):
    start, duration = row.get("offset_ms"), row.get("duration_ms")
    if not _number(start) or not _number(duration) or duration <= 0:
        raise ValueError("Invalid observed interval")
    start += shift
    end = start + duration
    if not _number(start) or not _number(end):
        raise ValueError("Invalid aligned interval")
    return start, end


def _overlaps(left, right):
    return min(left[1], right[1]) > max(left[0], right[0])


def overlap_evidence(report, metrics):
    counts = {phase: dict.fromkeys(sorted(READS), 0) for phase in ("build", "pages")}
    p95 = {phase: dict.fromkeys(sorted(READS)) for phase in counts}
    result = {
        "protected_reads_during_build": False,
        "protected_reads_during_pages": False,
        "responsive_concurrency": False,
        "overlap_counts": counts,
        "overlap_p95_ms": p95,
    }
    origin, stage_origin = (
        report.get("origin_timestamp"),
        metrics.get("origin_timestamp"),
    )
    stages, requests = metrics.get("spans"), report.get("spans")
    if (
        not _number(origin)
        or not _number(stage_origin)
        or stage_origin < origin
        or not isinstance(stages, list)
        or not isinstance(requests, list)
        or len(stages) > 160
        or len(requests) > 384
        or report.get("dropped_spans") != 0
        or metrics.get("dropped_spans") != 0
        or report.get("unsettled_requests") != 0
    ):
        return result
    try:
        build_rows = [row for row in stages if row.get("stage") == "build_total"]
        if len(build_rows) != 1 or build_rows[0].get("failed") is not False:
            return result
        build = _interval(build_rows[0], (stage_origin - origin) * 1000)
        relevant = [
            row
            for row in requests
            if row.get("route") in READS | {"workouts/export-page"}
        ]
        if any(
            type(row.get("status")) is not int or row["status"] != 200
            for row in relevant
        ):
            return result
        intervals = [(row, _interval(row)) for row in relevant]
        if any(
            sum(row["route"] == route for row, _ in intervals) != 80 for route in READS
        ):
            return result
        pages = [
            span for row, span in intervals if row["route"] == "workouts/export-page"
        ]
        if len(pages) != 19:
            return result
        witnessed = {phase: {route: [] for route in READS} for phase in counts}
        for row, span in intervals:
            route = row["route"]
            if route not in READS:
                continue
            if _overlaps(span, build):
                witnessed["build"][route].append(row["duration_ms"])
            # An empty gap between downloads is not page overlap.
            if any(_overlaps(span, page) for page in pages):
                witnessed["pages"][route].append(row["duration_ms"])
        for phase, phase_counts in counts.items():
            for route in READS:
                values = witnessed[phase][route]
                phase_counts[route] = len(values)
                p95[phase][route] = nearest_rank(values, 0.95) if values else None
        result["protected_reads_during_build"] = all(counts["build"].values())
        result["protected_reads_during_pages"] = all(counts["pages"].values())
        result["responsive_concurrency"] = (
            result["protected_reads_during_build"]
            and result["protected_reads_during_pages"]
            and all(
                value is not None and value <= 500
                for phase in p95.values()
                for value in phase.values()
            )
        )
    except (ValueError, TypeError, AttributeError, KeyError):
        # Partial or malformed timelines remain unavailable, never inferred.
        return result
    return result
