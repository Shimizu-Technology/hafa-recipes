"""New scenario observer handshake; existing450-second host monitor unchanged."""

import argparse
import json
import signal
import time
from pathlib import Path

from capacity.export_jobs_mixed_timing import (
    PREPARATION_SECONDS,
    START_TOLERANCE_SECONDS,
    TimingError,
    checked_start,
    namespace,
    prepared,
    read_state,
    write_state,
)
from capacity.host_monitor import HostMonitor, run_monitor


class MixedMonitor(HostMonitor):
    def begin(self, control, start):
        self.control, self.start, self.first_sample, self.observer_started = (
            control,
            start,
            None,
            time.monotonic(),
        )

    def snapshot(self):
        if self.first_sample is None:
            self.first_sample = time.monotonic()
            if self.first_sample > self.start + START_TOLERANCE_SECONDS:
                raise TimingError("mixed_timing_failed")
            write_state(
                self.control,
                "observing.json",
                {
                    "schema_version": 1,
                    "start_at": self.start,
                    "namespace_inode": namespace(),
                    "observer_started_at": self.observer_started,
                    "first_sample_at": self.first_sample,
                },
            )
        return super().snapshot()


def main():
    parser = argparse.ArgumentParser()
    for key in ("ledger", "api-id", "pg-id", "run-id", "phase", "output", "control"):
        parser.add_argument("--" + key, required=True)
    args = parser.parse_args()
    until = time.monotonic() + PREPARATION_SECONDS
    monitor = MixedMonitor(
        json.loads(Path(args.ledger).read_text()),
        args.api_id,
        args.pg_id,
        args.run_id,
        args.phase,
        owner="capacity_ci",
    )
    monitor.validate(monitor.api, "api")
    monitor.validate(monitor.pg, "pg")
    write_state(
        args.control, "observer-prepared.json", prepared("observer", args.phase)
    )
    value = None
    while time.monotonic() < until:
        value = read_state(args.control, "start.json")
        if value is not None:
            break
        time.sleep(0.05)
    start = checked_start(value, args.phase, namespace())
    time.sleep(max(0, start - time.monotonic()))
    if time.monotonic() > start + START_TOLERANCE_SECONDS:
        raise TimingError("mixed_timing_failed")
    monitor.begin(args.control, start)
    report = {"completed": False}
    try:
        report = run_monitor(monitor, args.output, 450, 0.5)
    finally:
        write_state(
            args.control,
            "observer-ended.json",
            {
                "schema_version": 1,
                "start_at": start,
                "namespace_inode": namespace(),
                "observer_started_at": monitor.observer_started,
                "first_sample_at": monitor.first_sample,
                "observer_ended_at": time.monotonic(),
                "completed": report.get("completed") is True,
            },
        )
    return 0 if report.get("local_memory_gate") == "passed" else 2


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        result = main()
    except BaseException:  # noqa: BLE001 - no raw private arguments in observer output
        print("mixed_observer_failed")
        result = 2
    raise SystemExit(result)
