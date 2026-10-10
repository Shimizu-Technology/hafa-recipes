"""Local engineering gates only; mocks/emulation never close release acceptance."""

import argparse
import json
from pathlib import Path

READS = {"recipes/list", "recipes/search", "recipes/detail", "/up"}
WRITES = {
    "recipes/manual-write",
    "workouts/activity-write",
    "workouts/session-write",
    "workouts/session-replay",
    "workouts/manual-workout",
}


def evaluate(baseline, mixed, samples):
    failures, blocked = [], []
    if (
        baseline.get("percentile_method") != "nearest_rank"
        or mixed.get("percentile_method") != "nearest_rank"
    ):
        blocked.append(
            "Unknown or mismatched percentile method; fresh matching reports required"
        )
    if not samples:
        blocked.append("No API cgroup samples; resource acceptance unavailable")
    peaks = [
        value["memory_peak"]
        for value in samples
        if value.get("memory_peak") is not None
    ]
    if not peaks and samples:
        blocked.append("No Linux cgroup memory.peak; resource acceptance unavailable")
    if peaks and max(peaks) > 410 * 1024 * 1024:
        failures.append("Combined memory peak exceeds410MiB reserve gate")
    if any(
        value.get("stop_required") or value.get("oom") or value.get("oom_kill")
        for value in samples
    ):
        failures.append("460MiB stop or OOM condition observed")
    for label, row in mixed.get("routes", {}).items():
        if row["unexpected"]:
            failures.append(f"Unexpected statuses on {label}")
        if label in READS | WRITES:
            limit = 500 if label in READS else 1000
            if row["p95_ms"] is None or row["p95_ms"] > limit:
                failures.append(f"Protected latency exceeded on {label}")
        if label in READS:
            old = baseline.get("routes", {}).get(label)
            if old is None:
                blocked.append(f"Missing baseline for {label}")
            elif (
                row["p95_ms"] > old["p95_ms"] * 1.25
                or row["p99_ms"] > old["p99_ms"] * 2
            ):
                failures.append(f"Baseline degradation on {label}")
    for label in READS:
        if label not in mixed.get("routes", {}):
            blocked.append(f"Missing protected route {label}")
    return {
        "local_gate": "failed" if failures else "blocked" if blocked else "passed",
        "failures": failures,
        "blocked": blocked,
        "peak_mib": max(peaks) / 1024 / 1024 if peaks else None,
        "r04_closed": False,
        "limits": [
            "Synthetic provider/auth/acquisition/storage boundaries",
            "Architecture/Render runtime parity unverified",
            "Neon/provider network and billing excluded",
            "Three repetitions, drained-memory and restart/rollback review still required",
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--mixed", required=True)
    parser.add_argument("--memory", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    samples = [
        json.loads(line)
        for line in Path(args.memory).read_text().splitlines()
        if line.strip()
    ]
    result = evaluate(
        json.loads(Path(args.baseline).read_text()),
        json.loads(Path(args.mixed).read_text()),
        samples,
    )
    Path(args.output).write_text(json.dumps(result, indent=2))
    print(json.dumps({"local_gate": result["local_gate"], "r04_closed": False}))
