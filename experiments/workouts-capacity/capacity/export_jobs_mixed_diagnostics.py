"""Bounded numeric diagnosis from existing actual spans; never changes traffic."""

from itertools import pairwise

from capacity.export_jobs_diagnostic_contract import READS
from capacity.export_jobs_overlap import _interval, _number, _overlaps
from capacity.statistics import nearest_rank

BUCKETS = ("build", "pages", "outside")
SUBSTAGES = ("projection", "json_encode", "aes_encrypt")
STAGE_FIELDS = (
    "calls",
    "completed",
    "failed",
    "query_count",
    "inclusive_wall_ms",
    "max_wall_ms",
    "sync_thread_cpu_ms",
)
LATENCY_FIELDS = ("count", "p95_ms", "p99_ms", "max_ms")


def _stats(values):
    return {
        "count": len(values),
        "p95_ms": nearest_rank(values, 0.95) if values else None,
        "p99_ms": nearest_rank(values, 0.99) if values else None,
        "max_ms": max(values) if values else None,
    }


def _gap(left, right):
    # Strict positive overlap remains the existing proof. Merely touching an
    # endpoint has gap0 and is still missing a witness.
    return max(0, right[0] - left[1], left[0] - right[1])


def _substage(row):
    if not isinstance(row, dict) or any(
        not _number(row.get(key)) or row[key] > 1e15 for key in STAGE_FIELDS
    ):
        raise ValueError("Incomplete numeric export substage")
    if any(type(row[key]) is not int for key in STAGE_FIELDS[:4]):
        raise ValueError("Noninteger export counters")
    if (row["calls"], row["completed"], row["failed"]) != (19, 19, 0):
        raise ValueError("Incomplete export substage")
    if row["max_wall_ms"] > row["inclusive_wall_ms"]:
        raise ValueError("Invalid inclusive export timing")
    return {key: row[key] for key in STAGE_FIELDS}


def phase_diagnostics(report, phase):
    """Inclusive overlap buckets and nearest absent witnesses, without raw clocks.

    A request crossing both kinds of interval belongs to both buckets. The
    shared count makes count(build)+count(pages)+count(outside)-shared=150.
    Outside is the complement of actual build and individual page intervals,
    not a gap-spanning download envelope. Nested substage timings are not added.
    """
    unavailable = {"available": False}
    try:
        origin, requests = report.get("origin_timestamp"), report.get("spans")
        cycles = report.get("job_cycles", [])
        if (
            phase not in ("baseline", "mixed")
            or report.get("completed") is not True
            or report.get("percentile_method") != "nearest_rank"
            or report.get("dropped_spans") != 0
            or report.get("unsettled_requests") != 0
            or not _number(origin)
            or not isinstance(requests, list)
            or len(requests) > 1024
            or not isinstance(cycles, list)
            or len(cycles) != (5 if phase == "mixed" else 0)
        ):
            return unavailable
        protected = {route: [] for route in sorted(READS)}
        for row in requests:
            if row.get("route") not in READS:
                continue
            if type(row.get("status")) is not int or row["status"] != 200:
                return unavailable
            protected[row["route"]].append((row, _interval(row)))
        if any(len(rows) != 150 for rows in protected.values()):
            return unavailable
        intervals, cycle_data = [], []
        for index, cycle in enumerate(cycles, 1):
            metrics = cycle.get("metrics", {})
            stage_origin = metrics.get("origin_timestamp")
            stage_spans = metrics.get("spans")
            pages = cycle.get("page_spans")
            if (
                not _number(stage_origin)
                or stage_origin < origin
                or metrics.get("complete") is not True
                or metrics.get("dropped_spans") != 0
                or metrics.get("inclusive_timings") is not True
                or metrics.get("summed_nested_timings") is not False
                or not isinstance(stage_spans, list)
                or len(stage_spans) > 160
                or not isinstance(pages, list)
                or len(pages) != 19
                or any(
                    row.get("route") != "workouts/export-page"
                    or type(row.get("status")) is not int
                    or row["status"] != 200
                    for row in pages
                )
            ):
                return unavailable
            builds = [row for row in stage_spans if row.get("stage") == "build_total"]
            if len(builds) != 1 or builds[0].get("failed") is not False:
                return unavailable
            build = _interval(builds[0], (stage_origin - origin) * 1000)
            page_intervals = [_interval(row) for row in pages]
            if (
                any(span[0] < build[1] for span in page_intervals)
                or any(left[1] > right[0] for left, right in pairwise(page_intervals))
                or (intervals and build[0] < intervals[-1]["pages"][-1][1])
            ):
                return unavailable
            intervals.append({"build": [build], "pages": page_intervals})
            missing = {kind: {} for kind in ("build", "pages")}
            for kind, targets in intervals[-1].items():
                for route, rows in protected.items():
                    witnessed = any(
                        _overlaps(span, target)
                        for _, span in rows
                        for target in targets
                    )
                    missing[kind][route] = (
                        None
                        if witnessed
                        else min(
                            _gap(span, target) for _, span in rows for target in targets
                        )
                    )
            cycle_data.append(
                {
                    "cycle": index,
                    "missing_witness_gap_ms": missing,
                    "export_substages": {
                        stage: _substage(metrics.get("stages", {}).get(stage))
                        for stage in SUBSTAGES
                    },
                }
            )
        routes = {}
        for route, rows in protected.items():
            buckets = {kind: [] for kind in BUCKETS}
            shared = 0
            for row, span in rows:
                during = {
                    kind: any(
                        _overlaps(span, target)
                        for cycle in intervals
                        for target in cycle[kind]
                    )
                    for kind in ("build", "pages")
                }
                for kind in ("build", "pages"):
                    if during[kind]:
                        buckets[kind].append(row["duration_ms"])
                shared += int(all(during.values()))
                if not any(during.values()):
                    buckets["outside"].append(row["duration_ms"])
            routes[route] = {
                "total_count": len(rows),
                "shared_build_page_count": shared,
                **{kind: _stats(values) for kind, values in buckets.items()},
            }
        return {
            "available": True,
            "inclusive_overlap_buckets": True,
            "stage_timings_inclusive": True,
            "stage_timings_summed": False,
            "protected_sample_count": 600,
            "build_interval_count": len(cycles),
            "page_interval_count": len(cycles) * 19,
            "routes": routes,
            "cycles": cycle_data,
        }
    except (ValueError, TypeError, AttributeError, KeyError):
        return unavailable


def public_diagnostics(value):
    """Second closed numeric whitelist; discard all raw/request/profile fields."""
    if not isinstance(value, dict) or value.get("available") is not True:
        return {"available": False}
    try:

        def scalar(item, *, nullable=False):
            if item is None and nullable:
                return None
            if not _number(item) or item > 1e15:
                raise ValueError("Invalid diagnostic scalar")
            return item

        if (
            value.get("inclusive_overlap_buckets") is not True
            or value.get("stage_timings_inclusive") is not True
            or value.get("stage_timings_summed") is not False
            or value.get("protected_sample_count") != 600
            or type(value.get("protected_sample_count")) is not int
            or not isinstance(value.get("cycles"), list)
            or len(value["cycles"]) not in (0, 5)
            or type(value.get("build_interval_count")) is not int
            or value["build_interval_count"] != len(value["cycles"])
            or type(value.get("page_interval_count")) is not int
            or value["page_interval_count"] != len(value["cycles"]) * 19
        ):
            raise ValueError("Invalid bounded diagnostic inventory")
        result = {
            "available": True,
            "inclusive_overlap_buckets": value["inclusive_overlap_buckets"] is True,
            "stage_timings_inclusive": value["stage_timings_inclusive"] is True,
            "stage_timings_summed": value["stage_timings_summed"] is True,
            **{
                key: scalar(value[key])
                for key in (
                    "protected_sample_count",
                    "build_interval_count",
                    "page_interval_count",
                )
            },
            "routes": {},
            "cycles": [],
        }
        for route in sorted(READS):
            row = value["routes"][route]
            counts = [row[kind]["count"] for kind in BUCKETS]
            shared = row["shared_build_page_count"]
            if (
                type(row.get("total_count")) is not int
                or row["total_count"] != 150
                or any(
                    type(count) is not int or not 0 <= count <= 150 for count in counts
                )
                or type(shared) is not int
                or not 0 <= shared <= min(counts[:2])
                or sum(counts) - shared != 150
                or any(
                    (row[kind]["count"] == 0) != (row[kind][key] is None)
                    for kind in BUCKETS
                    for key in LATENCY_FIELDS[1:]
                )
                or any(
                    row[kind]["count"]
                    and not (
                        row[kind]["p95_ms"]
                        <= row[kind]["p99_ms"]
                        <= row[kind]["max_ms"]
                    )
                    for kind in BUCKETS
                )
            ):
                raise ValueError("Incomplete latency buckets")
            result["routes"][route] = {
                **{
                    key: scalar(row[key])
                    for key in ("total_count", "shared_build_page_count")
                },
                **{
                    kind: {
                        key: scalar(row[kind][key], nullable=key != "count")
                        for key in LATENCY_FIELDS
                    }
                    for kind in BUCKETS
                },
            }
        for index, cycle in enumerate(value["cycles"], 1):
            if type(cycle["cycle"]) is not int or cycle["cycle"] != index:
                raise ValueError("Invalid cycle index")
            result["cycles"].append(
                {
                    "cycle": index,
                    "missing_witness_gap_ms": {
                        kind: {
                            route: scalar(
                                cycle["missing_witness_gap_ms"][kind][route],
                                nullable=True,
                            )
                            for route in sorted(READS)
                        }
                        for kind in ("build", "pages")
                    },
                    "export_substages": {
                        stage: _substage(cycle["export_substages"][stage])
                        for stage in SUBSTAGES
                    },
                }
            )
        return result
    except (ValueError, TypeError, AttributeError, KeyError):
        return {"available": False}
