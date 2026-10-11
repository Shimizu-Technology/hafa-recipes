"""New bounded source/branch scenario; old CI and receipts remain independent."""

import argparse
import json
import os
import platform
import signal
import subprocess
import sys
import time
from pathlib import Path

from capacity.ci_run import TOTAL_SECONDS, Coordinator, execute
from capacity.ci_safety import OWNER, SafetyError, numeric_timeline
from capacity.export_jobs_diagnostic_plan import build_jobs_plan
from capacity.export_jobs_mixed_receipt import (
    check_scenario,
    mixed_phase_receipt,
    mixed_public_receipt,
)
from capacity.export_jobs_mixed_timing import (
    PHASE_SECONDS,
    PREPARATION_SECONDS,
    TimingError,
    check_prepared,
    namespace,
    read_state,
    timing_proof,
    write_state,
)

BRANCH = "codex/workouts-export-jobs-mixed"


class MixedCoordinator(Coordinator):
    driver_module = "capacity.export_jobs_mixed_driver"
    make_phase_receipt = staticmethod(mixed_phase_receipt)
    format_public_receipt = staticmethod(mixed_public_receipt)
    check_scenario = staticmethod(check_scenario)

    def phase(self, phase, *, retain_api=False):
        try:
            return self.coordinated_phase(phase, retain_api=retain_api)
        except TimingError:
            raise SafetyError("mixed_timing_failed") from None
        finally:
            stream = getattr(self, "mixed_monitor_log", None)
            if stream is not None and not stream.closed:
                stream.close()

    def coordinated_phase(self, phase, *, retain_api=False):
        self.active_phase = phase
        self.mixed_monitor_log = None
        self.phase_before_counts = None
        before_counts = self.saved_counts()
        self.phase_before_counts = before_counts
        self.start_api(phase)
        result_dir = self.plan_root / "results"
        memory = result_dir / f"{phase}-external.jsonl"
        control = result_dir / f"{phase}-control"
        control.mkdir(
            mode=0o777
        )  # Only this owned synthetic folder; enclosing work stays0700.
        control.chmod(0o777)
        preparation_until = time.monotonic() + PREPARATION_SECONDS
        monitor_log = self.mixed_monitor_log = (
            self.work / f"{phase}-monitor.log"
        ).open("w")
        load_argv = self.runtime_argv("load") + [
            "-v",
            f"{result_dir}:/results",
            self.image,
            "python",
            "-m",
            self.driver_module,
            "--profile",
            "mixed" if phase == "mixed" else "recipes-baseline",
            "--seconds",
            "300",
            "--output",
            f"/results/{phase}.json",
            "--control",
            f"/results/{phase}-control",
        ]
        load = self.ledger.create_container("load", load_argv)
        monitor = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "capacity.export_jobs_mixed_monitor",
                "--ledger",
                str(self.ledger.file),
                "--api-id",
                self.api,
                "--pg-id",
                self.pg,
                "--run-id",
                self.run_id,
                "--phase",
                phase,
                "--output",
                str(memory),
                "--control",
                str(control),
            ],
            stdout=monitor_log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self.track_process(monitor)
        host_namespace = namespace()
        ready = {}
        while time.monotonic() < preparation_until:
            if time.monotonic() - self.started >= TOTAL_SECONDS:
                raise SafetyError("whole_experiment_deadline")
            state = self.ledger.inspect(load)["State"]
            if not state["Running"] or monitor.poll() is not None:
                raise SafetyError("mixed_timing_failed")
            for role in ("load", "observer"):
                value = read_state(control, role + "-prepared.json")
                if value is not None:
                    check_prepared(
                        value, role, phase, host_namespace, preparation_until
                    )
                    ready[role] = value
            if len(ready) == 2:
                break
            time.sleep(0.05)
        else:
            raise SafetyError("mixed_timing_failed")
        if time.monotonic() + 3 > preparation_until:
            raise SafetyError("mixed_timing_failed")
        start = time.monotonic() + 2
        write_state(
            control,
            "start.json",
            {
                "schema_version": 1,
                "phase": phase,
                "namespace_inode": host_namespace,
                "start_at": start,
            },
        )
        until = start + PHASE_SECONDS
        while time.monotonic() < until:
            if TOTAL_SECONDS - (time.monotonic() - self.started) <= 0:
                raise SafetyError("whole_experiment_deadline")
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
        monitor_log.close()
        observer_timing = read_state(control, "observer-ended.json")
        report = json.loads((result_dir / f"{phase}.json").read_text())
        observation = json.loads(Path(str(memory) + ".summary.json").read_text())
        samples = [json.loads(line) for line in memory.read_text().splitlines()]
        receipt = self.make_phase_receipt(
            report, samples, phase, self.baseline if phase == "mixed" else None
        )
        receipt["timing_proof"] = timing_proof(
            report.get("traffic_timing", {}), observer_timing or {}
        )
        traffic_clock = report.get("traffic_timing", {})
        receipt["timing_proof"]["passed"] = (
            receipt["timing_proof"]["passed"]
            and traffic_clock.get("start_at") == start
            and traffic_clock.get("namespace_inode") == host_namespace
            and observer_timing.get("start_at") == start
            and observer_timing.get("namespace_inode") == host_namespace
        )
        receipt["observer_completed"] = observation["completed"]
        receipt["passed"] = (
            receipt["passed"]
            and observation["completed"]
            and observation["local_memory_gate"] == "passed"
            and receipt["timing_proof"]["passed"]
        )
        receipt["timeline"] = numeric_timeline(
            samples, str(result_dir / f"{phase}.json") + ".requests.jsonl"
        )
        self.summary["phases"][phase] = receipt
        after_counts = self.saved_counts()
        receipt["saved_count_deltas"] = {
            key: after_counts[key] - before_counts[key] for key in after_counts
        }
        receipt["recipe_jobs_drained"] = after_counts["recipe_active"] == 0
        receipt["workout_jobs_drained"] = after_counts["workout_active"] == 0
        outcome = report.get("saved_outcomes", {})
        receipt["fresh_recipe_jobs"] = outcome.get("distinct_recipe_jobs_submitted", 0)
        receipt["fresh_recipe_saved_links"] = outcome.get(
            "distinct_saved_recipe_links", 0
        )
        receipt["accepted_workouts"] = outcome.get("accepted_workout_count", 0)
        checkpoints = outcome.get("stage_checkpoints", {})
        receipt["stage_deltas"] = {
            stage: checkpoints.get("after", {})
            .get("stage_counts", {})
            .get(stage, {})
            .get("end", 0)
            - checkpoints.get("before", {})
            .get("stage_counts", {})
            .get(stage, {})
            .get("end", 0)
            for stage in (
                "evidence_frames",
                "cover_frames",
                "cover_cache_reuse",
                "cover_compare",
                "export_build",
                "export_read",
                "loop_lag",
                "gc_pause",
            )
        }
        receipt["diagnostics"] = checkpoints.get("after", {}).get("diagnostics", {})
        receipt["provider_attempts"] = checkpoints.get("after", {}).get(
            "provider_attempts", {}
        )
        if (
            not receipt["recipe_jobs_drained"]
            or not receipt["workout_jobs_drained"]
            or receipt["fresh_recipe_jobs"] != 5
            or receipt["fresh_recipe_saved_links"] != 5
        ):
            receipt["passed"] = False
        if any(
            receipt["saved_count_deltas"][key] != expected
            for key, expected in {
                "recipes": 11,
                "extract_jobs": 5,
                "cover_jobs": 6,
                "extract_saved": 5,
                "cover_saved": 6,
            }.items()
        ):
            receipt["passed"] = False
        if phase == "mixed" and (
            receipt["accepted_workouts"] != 5
            or any(
                receipt["saved_count_deltas"][key] != 5
                for key in (
                    "sessions",
                    "activities",
                    "coach_messages",
                    "imports_accepted",
                )
            )
            or after_counts["export_snapshots"]
            or after_counts["export_pages"]
        ):
            receipt["passed"] = False
        self.check_scenario(report, receipt, phase)
        if phase == "baseline":
            self.baseline = report
        self.ledger.remove_container("load")
        if not retain_api:
            self.ledger.remove_container("api")
        if not receipt["passed"]:
            raise SafetyError("phase_acceptance_failed")

    def preparation_plan(self):
        return build_jobs_plan(self.repo, self.plan_root, self.run_id, owner=OWNER)

    def runtime_argv(self, name, **kwargs):
        argv = super().runtime_argv(name, **kwargs)
        if kwargs.get("phase"):
            argv += [
                "-e",
                "CAPACITY_EXPORT_DIAGNOSTIC=false",
                "-e",
                "CAPACITY_EXPORT_JOBS_DIAGNOSTIC=false",
                "-e",
                "CAPACITY_EXPORT_JOBS_MIXED=true",
                "-e",
                "WORKOUTS_EXPORT_JOBS_ENABLED=true",
                "-e",
                "JOB_WORKER_ENABLED=true",
                "-e",
                "DELETION_CLEANUP_WORKER_ENABLED=false",
            ]
        return argv

    def api_command(self):
        return [
            self.image,
            "python",
            "-m",
            "uvicorn",
            "capacity.export_jobs_mixed_app:app",
            "--host",
            "127.0.0.1",
            "--port",
            "18047",
        ]


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
        MixedCoordinator(args.repository, args.work, args.receipt), args.cleanup_only
    )


if __name__ == "__main__":
    try:
        result = main()
    except BaseException:  # noqa: BLE001 - preserve sanitized interruption/failure
        print("export_jobs_mixed_coordinator_failed", file=sys.stderr)
        result = 2
    raise SystemExit(result)
