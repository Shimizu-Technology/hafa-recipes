"""Refresh file medians from complete downloaded green-run artifact directories."""
import argparse
import json
from collections import defaultdict
from pathlib import Path
from statistics import median


def refresh(runs):
    samples = {selection: defaultdict(list) for selection in ("api", "baby")}
    for run in runs:
        for selection, prefix in (("api", "api-shards"), ("baby", "baby-family-shards")):
            totals = defaultdict(float)
            seen = set()
            for shard in range(1, 7):
                path = run / f"{prefix}-{shard}" / ".github/pytest-durations.json"
                timings = json.loads(path.read_text())  # Missing shard fails closed.
                if seen.intersection(timings):
                    raise ValueError(f"duplicate test timings in {run}/{prefix}")
                seen.update(timings)
                for nodeid, seconds in timings.items():
                    totals[nodeid.split("::", 1)[0]] += seconds
            for file, seconds in totals.items():
                samples[selection][file].append(seconds)
    return {"runs": [run.name for run in runs], **{
        selection: {file: round(median(values), 6) for file, values in sorted(files.items())}
        for selection, files in samples.items()
    }}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", type=Path, nargs="+")
    args = parser.parse_args()
    Path(__file__).with_name("file-durations.json").write_text(
        json.dumps(refresh(args.runs), indent=2) + "\n"
    )
