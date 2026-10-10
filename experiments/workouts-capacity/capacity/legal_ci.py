"""Separate bounded native x86 legal-image job; same safety ledger and budgets."""

import json
import subprocess
import sys
import time
from pathlib import Path

from capacity.ci_run import Coordinator
from capacity.ci_safety import (
    OWNER,
    READS,
    SafetyError,
    number,
    numeric_timeline,
    partial_trace_report,
    phase_receipt,
)
from capacity.legal_contract import CASES, case_passed


def receipt(report, samples, baseline):
    failures = int(
        report.get("percentile_method") != "nearest_rank"
        or baseline.get("percentile_method") != "nearest_rank"
    )
    routes = {}
    for route in READS:
        row = report.get("routes", {}).get(route, {})
        routes[route] = row
        prior = baseline["routes"][route]
        if (
            (
                not row.get("count")
                or row.get("unexpected")
                or set(row.get("statuses", {})) != {"200"}
                or row.get("p95_ms") is None
                or row.get("p99_ms") is None
            )
            or row["p95_ms"] > 500
            or row["p95_ms"] > prior["p95_ms"] * 1.25
            or row["p99_ms"] > prior["p99_ms"] * 2
        ):
            failures += 1
    cases = report.get("cases", {})
    failures += sum(not case_passed(case, cases.get(case, {})) for case in CASES)
    if (
        not report.get("completed")
        or report.get("failure_type")
        or any(row.get("unexpected") for row in report.get("routes", {}).values())
    ):
        failures += 1
    peak = max((number(row["memory_peak"]) for row in samples), default=0)
    if (
        not samples
        or peak > 410 * 2**20
        or any(
            row.get("stop_required")
            or row.get("oom")
            or row.get("oom_kill")
            or row.get("protected_5xx")
            for row in samples
        )
    ):
        failures += 1
    metrics = phase_receipt(report, samples, "baseline")
    return {
        **{
            key: metrics[key]
            for key in (
                "cpu_usage_usec",
                "cpu_throttled_usec",
                "cpu_throttled_periods",
                "peak_cpu_percent",
                "peak_process_count",
            )
        },
        "passed": failures == 0,
        "failure_count": failures,
        "peak_bytes": peak,
        "final_bytes": number(samples[-1]["memory_current"]) if samples else None,
        "sample_count": len(samples),
        "routes": routes,
        "cases": cases,
    }


class LegalCoordinator(Coordinator):
    def runtime_argv(self, name, **kwargs):
        argv = super().runtime_argv(name, **kwargs)
        if kwargs.get("phase"):
            argv += ["-e", "CAPACITY_LEGAL_MATRIX=true"]
        return argv

    def run(self):
        self.prepare()
        argv = self.runtime_argv("legal-fixtures", readonly_fixtures=False)
        argv += [
            "--memory",
            "1g",
            "--memory-swap",
            "1g",
            "--cpus",
            "1",
            "-v",
            f"{self.plan_root / 'fixtures'}:/fixtures",
            self.image,
            "python",
            "-m",
            "capacity.legal_fixtures",
            "/fixtures",
        ]
        self.finite_container("legal-fixtures", argv, 120)
        self.finite_container(
            "legal-seed",
            self.runtime_argv("legal-seed")
            + [
                "--memory",
                "256m",
                "--memory-swap",
                "256m",
                self.image,
                "python",
                "-m",
                "capacity.legal_seed",
            ],
            60,
        )
        self.phase("baseline", retain_api=True)
        self.active_phase = "legal"
        root = self.plan_root / "results"
        memory = root / "legal-external.jsonl"
        with (self.work / "legal-monitor.log").open("w") as log:
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
                    "baseline",
                    "--seconds",
                    "450",
                    "--output",
                    str(memory),
                ],
                stdout=log,
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
                    "capacity.legal_driver",
                    "--output",
                    "/results/legal.json",
                ],
            )
            until = time.monotonic() + 470
            while time.monotonic() < until:
                state = self.ledger.inspect(load)["State"]
                if (not state["Running"] and state["ExitCode"]) or (
                    monitor.poll() is not None and monitor.returncode
                ):
                    raise SafetyError("legal_phase_failed")
                if not state["Running"] and monitor.poll() is not None:
                    break
                time.sleep(0.5)
            else:
                raise SafetyError("legal_phase_deadline")
        report = json.loads((root / "legal.json").read_text())
        samples = [json.loads(line) for line in memory.read_text().splitlines()]
        observation = json.loads(Path(str(memory) + ".summary.json").read_text())
        result = receipt(report, samples, self.baseline)
        result["observer_completed"] = observation["completed"]
        result["timeline"] = numeric_timeline(
            samples, str(root / "legal.json") + ".requests.jsonl"
        )
        result["passed"] &= (
            observation["completed"] and observation["local_memory_gate"] == "passed"
        )
        self.summary["phases"]["legal"] = result
        self.summary["legal_nonjpeg_boundary_tested"] = report.get(
            "completed"
        ) is True and len(report.get("cases", {})) == len(CASES)
        if not result["passed"]:
            raise SafetyError("legal_acceptance_failed")
        self.summary["passed"] = True

    def capture_partial(self):
        if self.active_phase != "legal":
            return super().capture_partial()
        if "legal" in self.summary["phases"]:
            return
        root = self.plan_root / "results"
        try:
            report = json.loads((root / "legal.json").read_text())
        except (ValueError, OSError):
            report = {"completed": False}
        recovered = partial_trace_report(str(root / "legal.json") + ".requests.jsonl")
        report.update(recovered)
        samples = []
        memory = root / "legal-external.jsonl"
        lines = memory.read_text().splitlines() if memory.exists() else []
        for index, line in enumerate(lines):
            try:
                samples.append(json.loads(line))
            except ValueError:
                if index != len(lines) - 1:
                    raise SafetyError("corrupt_observation_interior")
        result = receipt(report, samples, self.baseline)
        result["passed"] = False
        result["observer_completed"] = False
        if self.ledger and "api" in self.ledger.state["containers"]:
            result["container_oom_killed"] = self.ledger.inspect(self.api)["State"][
                "OOMKilled"
            ]
        result["timeline"] = numeric_timeline(
            samples, str(root / "legal.json") + ".requests.jsonl"
        )
        self.summary["phases"]["legal"] = result
