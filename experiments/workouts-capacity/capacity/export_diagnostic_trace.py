"""Bounded interrupted numeric request recovery; standard library host only."""

import json
from pathlib import Path

from capacity.ci_safety import SafetyError, partial_trace_report
from capacity.export_diagnostic_receipt import ROUTES


def recover(output):
    path = Path(str(output) + ".requests.jsonl")
    if path.exists() and path.stat().st_size > 512 * 1024:
        raise SafetyError("partial_evidence_failed")
    report = partial_trace_report(path)
    report.update(spans=[], dropped_spans=0, unsettled_requests=None)
    if not path.exists():
        return report
    lines = path.read_text().splitlines()
    pending = {}
    for index, line in enumerate(lines):
        try:
            row = json.loads(line)
        except ValueError:
            if index != len(lines) - 1:
                raise SafetyError("corrupt_request_interior") from None
            continue
        if "origin_timestamp" in row:
            report["origin_timestamp"] = row["origin_timestamp"]
        if row.get("route") not in ROUTES:
            continue
        key = row.get("request_number")
        if row.get("event") == "start":
            pending[key] = row
        elif row.get("event") in {"end", "failed"} and key in pending:
            start = pending.pop(key)
            if len(report["spans"]) < 384:
                report["spans"].append(
                    {
                        "route": row["route"],
                        "offset_ms": max(
                            0, start["timestamp"] - report["origin_timestamp"]
                        )
                        * 1000,
                        "duration_ms": row["milliseconds"],
                        "status": row["status"],
                    }
                )
            else:
                report["dropped_spans"] += 1
    report["unsettled_requests"] = len(pending)
    return report
