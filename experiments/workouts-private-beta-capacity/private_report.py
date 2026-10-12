"""Approved private-beta criteria only; original capacity.report is unchanged."""

import argparse
import json
from pathlib import Path

from capacity.report import READS, WRITES


def evaluate(baseline, mixed, samples):
    failures, blocked = [], []
    for phase, report in (("off", baseline), ("enabled", mixed)):
        if not report.get("completed") or report.get("failure_type"):
            failures.append(f"Incomplete {phase} workload")
        if report.get("percentile_method") != "nearest_rank":
            blocked.append(f"Unknown {phase} percentile method")
        if any(row["unexpected"] for row in report.get("routes", {}).values()):
            failures.append(f"Unexpected {phase} response")
        for label in READS:
            row = report.get("routes", {}).get(label)
            if not row or not row["count"] or set(row["statuses"]) != {"200"}:
                blocked.append(f"Missing successful {phase} reads: {label}")
            else:
                if row["p95_ms"] is None or row["p95_ms"] > 500:
                    failures.append(f"Private-beta p95 exceeds500ms: {phase}/{label}")
                if row["p99_ms"] is None:
                    blocked.append(f"p99 unavailable: {phase}/{label}")
                elif row["p99_ms"] > 1000:
                    failures.append(f"Private-beta p99 exceeds1000ms: {phase}/{label}")
    peaks = [
        row["memory_peak"] for row in samples if row.get("memory_peak") is not None
    ]
    if not peaks:
        blocked.append("API cgroup peak unavailable")
    elif max(peaks) > 410 * 1024**2:
        failures.append("Combined memory peak exceeds410MiB")
    if any(
        row.get("stop_required") or row.get("oom") or row.get("oom_kill")
        for row in samples
    ):
        failures.append("460MiB stop or OOM observed")
    for label in WRITES:
        row = mixed.get("routes", {}).get(label)
        if not row or row["p95_ms"] is None or row["p95_ms"] > 1000:
            failures.append(f"Protected write latency exceeded: {label}")
    return {
        "local_gate": "failed" if failures else "blocked" if blocked else "passed",
        "failures": failures,
        "blocked": blocked,
        "peak_mib": max(peaks) / 1024**2 if peaks else None,
        "private_beta_read_p95_ms": 500,
        "private_beta_read_p99_ms": 1000,
        "financial_admission_tested": False,
        "r04_closed": False,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("baseline", "mixed", "memory", "output"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--baseline-memory", required=True)
    args = parser.parse_args()
    value = evaluate(
        json.loads(Path(args.baseline).read_text()),
        json.loads(Path(args.mixed).read_text()),
        [
            json.loads(line)
            for name in (args.baseline_memory, args.memory)
            for line in Path(name).read_text().splitlines()
        ],
    )
    Path(args.output).write_text(json.dumps(value, indent=2) + "\n")
    print(json.dumps({"local_gate": value["local_gate"]}))
