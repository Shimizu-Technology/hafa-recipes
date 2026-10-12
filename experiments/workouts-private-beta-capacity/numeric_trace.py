"""Bounded numeric evidence from existing traces; no application imports or payloads."""

import json
import math
from pathlib import Path

SELECTED = {"/up", "recipes/list", "recipes/search", "recipes/detail",
            "workouts/export-build", "workouts/export-page", "workouts/import-submit",
            "workouts/import-poll", "workouts/coach"}
LABELS = SELECTED | {
    "recipes/text", "recipes/ocr", "recipes/manual-write", "recipes/video-submit",
    "recipes/chat-context", "recipes/chat", "recipes/job-poll", "workouts/library",
    "workouts/activity-list", "workouts/activity-write", "workouts/coach",
    "workouts/manual-workout", "workouts/session-write", "workouts/session-replay",
    "workouts/import-submit", "workouts/import-poll", "workouts/import-accept",
    "workouts/export-remove", "workouts/bulk-boundary", "workouts/chunked-boundary",
    "workouts/oversized", "workouts/unauthenticated-boundary", "other",
}
STAGES = {"thumbnail_normalize", "cover_compare", "cover_frames", "evidence_frames"}
CPU_KEYS = {"usage_usec", "nr_periods", "nr_throttled", "throttled_usec"}
MAX_INPUT = 8 * 1024**2
MAX_OUTPUT = 1024 * 1024


class TraceError(ValueError):
    pass


def number(value, *, integer=False):
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or not 0 <= value <= 1e18
            or (integer and not isinstance(value, int))):
        raise TraceError("invalid_numeric")
    return value


def records(path):
    if path.stat().st_size > MAX_INPUT:
        raise TraceError("input_limit")
    values = []
    with path.open() as stream:
        for line in stream:
            if len(line.encode()) > 65536 or len(values) >= 8192:
                raise TraceError("record_limit")
            try:
                value = json.loads(line)
            except (ValueError, RecursionError):
                raise TraceError("invalid_json") from None
            if not isinstance(value, dict):
                raise TraceError("invalid_record")
            values.append(value)
    return values


def phase(trace, memory, expected):
    if not trace.exists() and not memory.exists():
        return {"state": "not_started"}
    if not trace.exists() or not memory.exists():
        raise TraceError("missing_input")
    pending, spans, samples, media = {}, [], [], []
    for value in records(trace):
        if (set(value) - {"timestamp", "phase", "request_number", "event", "route",
                         "status", "milliseconds", "bytes"}
                or value.get("phase") != expected or value.get("route") not in LABELS
                or value.get("event") not in {"start", "end", "failed"}):
            raise TraceError("invalid_request_enum")
        stamp = number(value.get("timestamp"))
        sequence = number(value.get("request_number"), integer=True)
        if value["route"] not in SELECTED:
            continue
        if value["event"] == "start":
            if sequence in pending:
                raise TraceError("duplicate_start")
            pending[sequence] = value
            continue
        start = pending.pop(sequence, None)
        if not start or start["route"] != value["route"] or stamp < start["timestamp"]:
            raise TraceError("unpaired_request")
        status = number(value.get("status"), integer=True)
        if status > 599:
            raise TraceError("invalid_status")
        spans.append({"route": value["route"], "event": value["event"],
                      "start": start["timestamp"], "end": stamp,
                      "duration_ms": number(value.get("milliseconds")), "status": status,
                      "bytes": number(value.get("bytes", 0), integer=True)})
        if len(spans) > 1024:
            raise TraceError("span_limit")
    for start in pending.values():
        spans.append({"route": start["route"], "event": "unfinished",
                      "start": start["timestamp"], "end": None,
                      "duration_ms": None, "status": None, "bytes": None})
    if len(spans) > 1024:
        raise TraceError("span_limit")
    for value in records(memory):
        if value.get("phase") != expected:
            raise TraceError("invalid_sample_phase")
        sample = {key: number(value.get(key)) for key in
                  ("timestamp", "memory_current", "memory_peak")}
        cpu = value.get("cpu")
        if cpu is None:
            sample["cpu"] = None
        elif not isinstance(cpu, dict) or set(cpu) != CPU_KEYS:
            raise TraceError("invalid_cpu_fields")
        else:
            sample["cpu"] = {key: number(cpu[key], integer=True) for key in sorted(CPU_KEYS)}
        samples.append(sample)
        if len(samples) > 1024:
            raise TraceError("sample_limit")
        events = value.get("stages", [])
        if not isinstance(events, list):
            raise TraceError("invalid_stages")
        for event in events:
            if (not isinstance(event, dict) or set(event) - {"sequence", "stage", "event",
                    "timestamp", "duration_ms", "input_bytes", "pixels"}
                    or event.get("stage") not in STAGES
                    or event.get("event") not in {"start", "end", "failed"}):
                raise TraceError("invalid_stage_enum")
            item = {"stage": event["stage"], "event": event["event"],
                    "timestamp": number(event.get("timestamp"))}
            for key in ("duration_ms", "input_bytes", "pixels"):
                if key in event:
                    item[key] = number(event[key])
            media.append(item)
            if len(media) > 256:
                raise TraceError("stage_limit")
    origin = min([row["timestamp"] for row in samples] +
                 [row["start"] for row in spans] +
                 [row["timestamp"] for row in media], default=0)
    for row in spans:
        for key in ("start", "end"):
            stamp = row.pop(key)
            row[key + "_offset_seconds"] = None if stamp is None else round(stamp - origin, 6)
    for row in samples + media:
        row["offset_seconds"] = round(row.pop("timestamp") - origin, 6)
    return {"state": "captured", "requests": spans, "media": media, "samples": samples,
            "unfinished_selected_requests": len(pending),
            "samples_without_cpu": sum(row["cpu"] is None for row in samples)}


def collect(work):
    result = {"version": 1, "phases": {}}
    for name, expected in (("off", "baseline"), ("enabled", "mixed")):
        folder = work / name
        try:
            result["phases"][name] = phase(folder / "latency.json.requests.jsonl",
                                          folder / "memory.jsonl", expected)
        except (TraceError, OSError, ValueError, TypeError, RecursionError):
            result["phases"][name] = {"state": "unavailable", "error_class": "TraceError"}
    encoded = json.dumps(result, separators=(",", ":"), allow_nan=False)
    if len(encoded.encode()) > MAX_OUTPUT:
        encoded = json.dumps({"version": 1, "state": "unavailable", "error_class": "OutputLimit"})
    return encoded


if __name__ == "__main__":
    import sys

    destination = Path(sys.argv[1]) / "numeric-trace.json"
    with destination.open("x") as stream:
        stream.write(collect(Path(sys.argv[1])))
