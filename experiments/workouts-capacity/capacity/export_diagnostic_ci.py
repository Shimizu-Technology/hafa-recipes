"""One finite native x86 attribution probe; production gates remain unchanged."""

import argparse
import json
import os
import platform
import signal
import subprocess
import sys
import time
from pathlib import Path

from capacity.ci_run import Coordinator, execute
from capacity.ci_safety import OWNER, SafetyError
from capacity.export_diagnostic_receipt import diagnostic, receipt
from capacity.export_diagnostic_trace import recover

BRANCH = "codex/workouts-export-diagnostic"


class ExportCoordinator(Coordinator):
    output_name = "export-diagnostic.json"
    measurements_path = "/capacity/export-diagnostic"
    app_module = "capacity.export_diagnostic_app:app"
    driver_module = "capacity.export_diagnostic_driver"
    summarize = staticmethod(diagnostic)
    format_receipt = staticmethod(receipt)
    recover_report = staticmethod(recover)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.data = {}

    def preparation_steps(self):
        # No media generation, source-provider probe or media/import workload.
        return [("seed", "seed_actual_migrations_once_empty_owned_db", 180)]

    def runtime_argv(self, name, **kwargs):
        argv = super().runtime_argv(name, **kwargs)
        if kwargs.get("phase"):
            argv += [
                "-e",
                "CAPACITY_EXPORT_DIAGNOSTIC=true",
                "-e",
                "JOB_WORKER_ENABLED=false",
                "-e",
                "DELETION_CLEANUP_WORKER_ENABLED=false",
                "-e",
                "WORKOUTS_IMPORTS_ENABLED=false",
                "-e",
                "CAPACITY_COVER_SCENARIOS=false",
                "-e",
                "CAPACITY_PHASE=diagnostic",
            ]
        return argv

    def api_command(self):
        return [
            self.image,
            "python",
            "-m",
            "uvicorn",
            self.app_module,
            "--host",
            "127.0.0.1",
            "--port",
            "18047",
        ]

    def collect(self, completed=False):
        root = self.plan_root / "results"
        path = root / self.output_name
        try:
            report = json.loads(path.read_text()) if path.exists() else {}
        except (ValueError, OSError):
            report = {}
        if not report.get("completed"):
            report.update(self.recover_report(path))
        if not report.get("metrics") and getattr(self, "api", None):
            try:
                report["metrics"] = json.loads(
                    self.command(
                        [
                            "docker",
                            "exec",
                            self.pg,
                            "wget",
                            "-qO-",
                            "--header=X-Capacity-User: capacity-22",
                            "http://127.0.0.1:18047" + self.measurements_path,
                        ],
                        timeout=5,
                    )
                )
                report["status"] = json.loads(
                    self.command(
                        [
                            "docker",
                            "exec",
                            self.pg,
                            "wget",
                            "-qO-",
                            "http://127.0.0.1:18047/capacity/status",
                        ],
                        timeout=5,
                    )
                )
            except BaseException:  # noqa: BLE001, S110 - preserve unknown partial metrics
                pass
        memory = root / "diagnostic-external.jsonl"
        samples = []
        lines = memory.read_text().splitlines() if memory.exists() else []
        for index, line in enumerate(lines):
            try:
                samples.append(json.loads(line))
            except ValueError:
                if index != len(lines) - 1:
                    raise SafetyError("corrupt_observation_interior") from None
        summary = Path(str(memory) + ".summary.json")
        try:
            observation = json.loads(summary.read_text()) if summary.exists() else {}
        except (ValueError, OSError):
            observation = {}  # Publication interrupted; keep other evidence, never pass.
        counts, oom = None, None
        if getattr(self, "pg", None):
            try:
                counts = self.saved_counts()
            except BaseException:  # noqa: BLE001, S110 - private evidence unavailable
                pass
        if getattr(self, "api", None):
            try:
                oom = self.ledger.inspect(self.api)["State"]["OOMKilled"]
            except BaseException:  # noqa: BLE001, S110 - never infer absence of OOM
                pass
        if not completed:
            report["completed"] = False
        self.data = self.summarize(report, samples, observation, counts, oom)

    def run(self):
        self.prepare()
        self.active_phase = "diagnostic"
        self.start_api("mixed")
        root = self.plan_root / "results"
        memory = root / "diagnostic-external.jsonl"
        with (self.work / "diagnostic-monitor.log").open("w") as stream:
            monitor = subprocess.Popen(
                [
                    sys.executable,
                    str(
                        self.repo
                        / "experiments/workouts-capacity/capacity/host_monitor.py"
                    ),
                    "--ledger",
                    str(self.ledger.file),
                    "--owner",
                    OWNER,
                    "--api-id",
                    self.api,
                    "--pg-id",
                    self.pg,
                    "--run-id",
                    self.run_id,
                    "--phase",
                    "diagnostic",
                    "--seconds",
                    "210",
                    "--output",
                    str(memory),
                ],
                stdout=stream,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            self.track_process(monitor)
            load = self.ledger.create_container(
                "load",
                self.runtime_argv("load")
                + [
                    "--memory",
                    "256m",
                    "--memory-swap",
                    "256m",
                    "--cpus",
                    "0.5",
                    "-v",
                    f"{root}:/results",
                    self.image,
                    "python",
                    "-m",
                    self.driver_module,
                    "--output",
                    "/results/" + self.output_name,
                ],
            )
            until = time.monotonic() + 230
            while time.monotonic() < until:
                state = self.ledger.inspect(load)["State"]
                if not state["Running"] and state["ExitCode"]:
                    raise SafetyError("load_phase_failed")
                if monitor.poll() is not None and monitor.returncode:
                    raise SafetyError("observer_phase_failed")
                if not state["Running"] and monitor.poll() is not None:
                    break
                time.sleep(0.5)
            else:
                raise SafetyError("phase_deadline")
        self.collect(True)
        self.summary["passed"] = bool(
            self.data["complete"]
            and self.data["safety_passed"]
            and self.data["latency_slos_passed"]
        )
        if not self.summary["passed"]:
            raise SafetyError("phase_acceptance_failed")

    def capture_partial(self):
        if self.active_phase and not self.data:
            self.collect(False)

    def write_receipt(self):
        self.receipt.parent.mkdir(parents=True, exist_ok=True)
        encoded = (
            json.dumps(
                self.format_receipt(self.summary, self.data), allow_nan=False, indent=2
            )
            + "\n"
        )
        if len(encoded.encode()) > 100 * 1024:
            raise SafetyError("public_receipt_too_large")
        self.receipt.write_text(encoded)


def main():
    parser = argparse.ArgumentParser()
    for key in ("repository", "work", "receipt"):
        parser.add_argument("--" + key, required=True)
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args()
    if (
        platform.system() != "Linux"
        or os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("GITHUB_REPOSITORY") != "Shimizu-Technology/hafa-recipes"
        or (os.environ.get("GITHUB_HEAD_REF") or os.environ.get("GITHUB_REF_NAME"))
        != BRANCH
    ):
        raise SafetyError("untrusted_ci_context")
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    return execute(
        ExportCoordinator(args.repository, args.work, args.receipt), args.cleanup_only
    )


if __name__ == "__main__":
    try:
        result = main()
    except BaseException:  # noqa: BLE001 - no private exception traceback
        print("export_diagnostic_coordinator_failed", file=sys.stderr)
        result = 2
    raise SystemExit(result)
