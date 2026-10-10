"""Container-only numeric process/cgroup sampling; never reads argv/environ/content."""

import argparse
import json
import os
import time
from pathlib import Path


def number(path):
    try:
        return int(Path(path).read_text().strip())
    except (OSError, ValueError):
        return None


def sample(root="/sys/fs/cgroup", proc="/proc"):
    root, proc = Path(root), Path(proc)
    processes = []
    for folder in proc.iterdir():
        if not folder.name.isdecimal():
            continue
        try:
            fields = dict(
                line.split(":", 1)
                for line in (folder / "status").read_text().splitlines()
                if ":" in line
            )
            processes.append(
                {
                    "pid": int(folder.name),
                    "parent": int(fields.get("PPid", "0")),
                    "name": fields.get("Name", "").strip(),
                    "rss_kib": int(fields.get("VmRSS", "0 kB").split()[0]),
                    "hwm_kib": int(fields.get("VmHWM", "0 kB").split()[0]),
                    "sampler": int(folder.name) == os.getpid(),
                }
            )
        except (OSError, ValueError):
            continue
    try:
        events = dict(
            line.split() for line in (root / "memory.events").read_text().splitlines()
        )
    except OSError:
        events = {}
    current = number(root / "memory.current")
    return {
        "timestamp": time.time(),
        "memory_current": current,
        "memory_peak": number(root / "memory.peak"),
        "oom": int(events.get("oom", "0")),
        "oom_kill": int(events.get("oom_kill", "0")),
        "processes": processes,
        "stop_required": (current is not None and current >= 460 * 1024 * 1024)
        or int(events.get("oom", "0")) > 0,
        "sampler_overhead_included": True,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=int, default=900)
    parser.add_argument("--interval", type=float, default=0.5)
    args = parser.parse_args()
    if args.seconds < 1 or args.seconds > 7200 or args.interval < 0.1:
        raise SystemExit("Use bounded sampling duration/interval")
    end = time.monotonic() + args.seconds
    while time.monotonic() < end:
        value = sample()
        print(json.dumps(value), flush=True)
        if value["stop_required"]:
            raise SystemExit(2)  # Root must stop exact owned API, not shared resources.
        time.sleep(args.interval)
