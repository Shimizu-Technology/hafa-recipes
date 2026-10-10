"""Native x86 hosted-runner experiment. No local execution, deployment or secrets."""

import argparse
import json
import os
import platform
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

from capacity.ci_safety import (
    OWNER,
    Ledger,
    SafetyError,
    numeric_timeline,
    partial_trace_report,
    phase_receipt,
    public_receipt,
    verify_context,
)
from capacity.plan import build_plan

REQUIREMENTS_SHA = "9002549c41b56eb84eda74b5e53875daf8899759ec183b532649a973343b5996"
TOTAL_SECONDS = 1900


class Coordinator:
    def __init__(self, repository, work, receipt, env=os.environ):
        self.repo, self.work, self.receipt = (
            Path(repository).resolve(),
            Path(work).resolve(),
            Path(receipt).resolve(),
        )
        self.env = dict(env)
        self.started = time.monotonic()
        self.work.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.processes = []
        self.ledger = None
        self.cleaning_started = None
        self.active_phase = None
        self.baseline = None
        self.summary = {
            "schema_version": 1,
            "passed": False,
            "cleaned_owned_resources": False,
            "render_parity": False,
            "r04_closed": False,
            "provider_quality": False,
            "real_provider_calls": 0,
            "native_x86": False,
            "legal_nonjpeg_boundary_tested": False,
            "longer_repetitions_tested": False,
            "percentile_nearest_rank": True,
            "phases": {},
            "provenance": {},
        }

    def command(self, argv, timeout=30):
        remaining = (
            (120 - (time.monotonic() - self.cleaning_started))
            if self.cleaning_started
            else TOTAL_SECONDS - (time.monotonic() - self.started)
        )
        if remaining <= 0:
            raise SafetyError("whole_experiment_deadline")
        result = subprocess.run(
            argv,
            check=False,
            text=True,
            capture_output=True,
            timeout=max(1, min(timeout, remaining)),
            cwd=self.repo,
        )
        if result.returncode:
            raise SafetyError("finite_command_failed")
        return result.stdout.strip()

    def track_process(self, process):
        self.processes.append(process)
        # Only this child PID/start ticks; never command lines or environment.
        fields = Path(f"/proc/{process.pid}/stat").read_text().rsplit(")", 1)[1].split()
        self.ledger.state.setdefault("processes", []).append(
            {"pid": process.pid, "start_ticks": int(fields[19])}
        )
        self.ledger.save()

    def finite_container(self, role, argv, deadline=120):
        identifier = self.ledger.create_container(role, argv)
        try:
            code = int(self.command(["docker", "wait", identifier], timeout=deadline))
            log = self.command(["docker", "logs", identifier])
            (self.work / f"{role}.log").write_text(log)
            if code:
                raise SafetyError("finite_container_failed")
            return log
        finally:
            self.ledger.remove_container(role)

    def runtime_argv(self, name, *, phase=None, readonly_fixtures=True):
        argv = [
            "docker",
            "run",
            "-d",
            "--name",
            f"capacity-{name}-{self.run_id}",
            "--platform",
            "linux/amd64",
            "--network",
            f"container:{self.pg}",
            "--env-file",
            str(self.plan_root / "fixture.env"),
            "--label",
            f"hafa.capacity.owner={OWNER}",
            "--label",
            f"hafa.capacity.run={self.run_id}",
        ]
        if readonly_fixtures:
            argv += ["-v", f"{self.plan_root / 'fixtures'}:/fixtures:ro"]
        if phase:
            argv += [
                "--memory",
                "512m",
                "--memory-swap",
                "512m",
                "--cpus",
                "0.5",
                "-e",
                f"WORKOUTS_API_ENABLED={'true' if phase == 'mixed' else 'false'}",
                "-e",
                f"CAPACITY_PHASE={phase}",
            ]
        return argv

    def verify_artifact(self):
        probe = """import hashlib,importlib.metadata,json,platform,subprocess
from pip._vendor.packaging.requirements import Requirement
from pathlib import Path
text=Path('/api/requirements.txt').read_text();pins=[]
for line in text.splitlines():
 line=line.strip()
 if not line or line.startswith('#'):continue
 r=Requirement(line)
 if r.marker is None or r.marker.evaluate():
  version=importlib.metadata.version(r.name)
  if not r.specifier.contains(version,prereleases=True):raise RuntimeError('Runtime graph mismatch')
  pins.append((r.name.lower(),version))
ffmpeg=subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0].split()[2]
print(json.dumps({'requirements_sha':hashlib.sha256(text.encode()).hexdigest(),'python':platform.python_version(),'architecture':platform.machine(),'ffmpeg':ffmpeg,'runtime_graph_verified':True,'pinned_distribution_count':len(pins),'packages':{k:importlib.metadata.version(k) for k in ['fastapi','starlette','openai','pydantic','pypdf','pillow','cryptography','sqlalchemy','asyncpg','uvicorn']}}))
"""
        argv = [
            "docker",
            "run",
            "-d",
            "--name",
            f"capacity-inventory-{self.run_id}",
            "--platform",
            "linux/amd64",
            "--network",
            "none",
            "--memory",
            "256m",
            "--memory-swap",
            "256m",
            "--cpus",
            "0.5",
            "--label",
            f"hafa.capacity.owner={OWNER}",
            "--label",
            f"hafa.capacity.run={self.run_id}",
            self.image,
            "python",
            "-c",
            probe,
        ]
        info = json.loads(self.finite_container("inventory", argv, 60))
        if (
            info["architecture"] != "x86_64"
            or info["python"] != "3.12.15"
            or info["ffmpeg"] != "5.1.9-0+deb12u1"
            or info["requirements_sha"] != REQUIREMENTS_SHA
        ):
            raise SafetyError("artifact_parity_failed")
        expected = {
            "fastapi": "0.122.0",
            "starlette": "0.50.0",
            "openai": "2.8.1",
            "pydantic": "2.12.5",
            "pypdf": "6.20.0",
            "pillow": "12.3.0",
            "cryptography": "46.0.3",
            "sqlalchemy": "2.0.44",
            "asyncpg": "0.31.0",
            "uvicorn": "0.38.0",
        }
        if info["packages"] != expected:
            raise SafetyError("artifact_runtime_versions_failed")
        self.summary["provenance"].update(
            {
                key: info[key]
                for key in (
                    "requirements_sha",
                    "python",
                    "architecture",
                    "ffmpeg",
                    "runtime_graph_verified",
                    "pinned_distribution_count",
                    "packages",
                )
            }
        )

    def start_api(self, phase):
        self.api = self.ledger.create_container(
            "api", self.runtime_argv("api", phase=phase) + [self.image]
        )
        info = self.ledger.inspect(self.api)
        if (
            info["Image"] != self.image
            or info["HostConfig"]["Memory"] != 512 * 2**20
            or info["HostConfig"]["MemorySwap"] != 512 * 2**20
            or info["HostConfig"]["NanoCpus"] != 500_000_000
        ):
            raise SafetyError("api_budget_or_image_changed")
        # Probe from the owned PG namespace; no Python observer inside API.
        until = time.monotonic() + 60
        while time.monotonic() < until:
            info = self.ledger.inspect(self.api)
            if not info["State"]["Running"] or info["State"]["OOMKilled"]:
                raise SafetyError("api_startup_failed")
            try:
                value = self.command(
                    [
                        "docker",
                        "exec",
                        self.pg,
                        "wget",
                        "-qO-",
                        "http://127.0.0.1:18047/up",
                    ],
                    timeout=5,
                )
                if json.loads(value).get("status") == "healthy":
                    return
            except (SafetyError, ValueError):
                pass
            time.sleep(0.5)
        raise SafetyError("api_startup_deadline")

    def saved_counts(self):
        self.ledger.inspect(self.pg)
        sql = """SELECT json_build_object(
        'recipes',(SELECT count(*) FROM recipes),
        'extract_jobs',(SELECT count(*) FROM extraction_jobs WHERE job_kind='extract'),
        'cover_jobs',(SELECT count(*) FROM extraction_jobs WHERE job_kind='cover'),
        'extract_saved',(SELECT count(recipe_id) FROM extraction_jobs WHERE job_kind='extract' AND status='completed'),
        'cover_saved',(SELECT count(recipe_id) FROM extraction_jobs WHERE job_kind='cover' AND status='completed'),
        'recipe_active',(SELECT count(*) FROM extraction_jobs WHERE status IN ('queued','claimed','processing')),
        'sessions',(SELECT count(*) FROM workouts_sessions),
        'activities',(SELECT count(*) FROM workouts_activity_log),
        'coach_messages',(SELECT count(*) FROM workouts_coach_messages),
        'imports_accepted',(SELECT count(accepted_workout_id) FROM workouts_import_jobs),
        'workout_active',(SELECT count(*) FROM workouts_import_jobs WHERE status IN ('queued','processing')),
        'export_snapshots',(SELECT count(*) FROM workouts_export_snapshots),
        'export_pages',(SELECT count(*) FROM workouts_export_pages));"""
        return json.loads(
            self.command(
                [
                    "docker",
                    "exec",
                    self.pg,
                    "psql",
                    "-U",
                    "postgres",
                    "-d",
                    "hafa_workouts_capacity_test",
                    "-At",
                    "-c",
                    sql,
                ]
            )
        )

    def phase(self, phase, *, retain_api=False):
        self.active_phase = phase
        before_counts = self.saved_counts()
        self.start_api(phase)
        result_dir = self.plan_root / "results"
        memory = result_dir / f"{phase}-external.jsonl"
        monitor_log = (self.work / f"{phase}-monitor.log").open("w")
        monitor = subprocess.Popen(
            [
                sys.executable,
                str(
                    self.repo / "experiments/workouts-capacity/capacity/host_monitor.py"
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
                phase,
                "--seconds",
                "450",
                "--output",
                str(memory),
            ],
            stdout=monitor_log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self.track_process(monitor)
        # Only the load container writes synthetic results; PG/database persist.
        load_argv = self.runtime_argv("load") + [
            "-v",
            f"{result_dir}:/results",
            self.image,
            "python",
            "-m",
            "capacity.driver",
            "--profile",
            "mixed" if phase == "mixed" else "recipes-baseline",
            "--seconds",
            "300",
            "--output",
            f"/results/{phase}.json",
        ]
        load = self.ledger.create_container("load", load_argv)
        until = time.monotonic() + 470
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
        report = json.loads((result_dir / f"{phase}.json").read_text())
        observation = json.loads(Path(str(memory) + ".summary.json").read_text())
        samples = [json.loads(line) for line in memory.read_text().splitlines()]
        receipt = phase_receipt(
            report, samples, phase, self.baseline if phase == "mixed" else None
        )
        receipt["observer_completed"] = observation["completed"]
        receipt["passed"] = (
            receipt["passed"]
            and observation["completed"]
            and observation["local_memory_gate"] == "passed"
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
            receipt["saved_count_deltas"][key] != 5
            for key in ("extract_jobs", "cover_jobs", "extract_saved", "cover_saved")
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
        if phase == "baseline":
            self.baseline = report
        self.ledger.remove_container("load")
        if not retain_api:
            self.ledger.remove_container("api")
        if not receipt["passed"]:
            raise SafetyError("phase_acceptance_failed")

    def prepare(self):
        if platform.system() != "Linux":
            raise SafetyError("linux_host_required")
        commit = self.command(["git", "rev-parse", "HEAD"])
        docker = self.command(["docker", "info", "--format", "{{.Architecture}}"])
        event = json.loads(Path(self.env["GITHUB_EVENT_PATH"]).read_text())
        self.run_id = verify_context(
            self.env, event, commit, platform.machine(), docker
        )
        self.summary["native_x86"] = True
        self.summary["provenance"]["host_kernel"] = platform.release()
        self.summary["provenance"]["docker_version"] = self.command(
            ["docker", "version", "--format", "{{.Server.Version}}"]
        )
        self.summary["provenance"]["source_commit"] = commit
        self.ledger = Ledger(self.work / "resources.json", self.run_id, self.command)
        self.plan_root = self.work / "plan"
        plan = build_plan(self.repo, self.plan_root, self.run_id, 0.5, owner=OWNER)
        tag = f"hafa-capacity:{commit[:12]}"
        # Native build from exact public source; never publish the image.
        # Build argv comes directly from the inspected preparation plan.
        build_argv = plan["commands"][0]["argv"]
        with (self.work / "build.log").open("w") as stream:
            process = subprocess.Popen(
                build_argv,
                stdout=stream,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            self.track_process(process)
            remaining = TOTAL_SECONDS - (time.monotonic() - self.started)
            if process.wait(timeout=min(600, remaining)):
                raise SafetyError("image_build_failed")
        image_info = json.loads(self.command(["docker", "image", "inspect", tag]))[0]
        self.image = image_info["Id"]
        if (
            not re.fullmatch(r"sha256:[0-9a-f]{64}", self.image)
            or image_info["Architecture"] != "amd64"
            or image_info["Config"]["Labels"]["org.opencontainers.image.revision"]
            != commit
        ):
            raise SafetyError("image_provenance_failed")
        self.summary["provenance"]["image_sha256"] = self.image
        self.verify_artifact()
        network_name = plan["resource_names"]["network"]
        self.ledger.create_network(network_name)
        pg_argv = next(
            step["argv"]
            for step in plan["commands"]
            if step["step"] == "start_owned_postgres"
        )
        pg_argv[2:2] = ["--memory-swap", "1g"]
        self.pg = self.ledger.create_container("pg", pg_argv)
        for _ in range(60):
            try:
                self.command(
                    [
                        "docker",
                        "exec",
                        self.pg,
                        "pg_isready",
                        "-U",
                        "postgres",
                        "-d",
                        "hafa_workouts_capacity_test",
                    ]
                )
                break
            except SafetyError:
                time.sleep(0.5)
        else:
            raise SafetyError("postgres_startup_deadline")
        for role, step, deadline in [
            ("fixtures", "generate_sources_separate_from_api_budget", 120),
            (
                "source-check",
                "verify_real_source_pipeline_BEFORE_any_workouts_load",
                90,
            ),
            ("seed", "seed_actual_migrations_once_empty_owned_db", 180),
        ]:
            argv = list(
                next(item["argv"] for item in plan["commands"] if item["step"] == step)
            )
            argv = [self.image if word == tag else word for word in argv]
            self.finite_container(role, argv, deadline)

    def run(self):
        self.prepare()
        self.phase("baseline")
        before = self.pg
        self.ledger.inspect(before)
        self.phase("mixed")
        if self.pg != before:
            raise SafetyError("database_identity_changed")
        self.summary["passed"] = True

    def stop_traffic(self):
        if self.ledger and "load" in self.ledger.state["containers"]:
            identifier = self.ledger.state["containers"]["load"]
            state = self.ledger.inspect(identifier)["State"]
            if state["Running"]:
                self.command(["docker", "stop", "--timeout", "2", identifier])
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

    def capture_partial(self):
        if not self.active_phase or self.active_phase in self.summary["phases"]:
            return
        root = self.plan_root / "results"
        path = root / f"{self.active_phase}.json"
        try:
            report = json.loads(path.read_text())
        except (OSError, ValueError):
            report = partial_trace_report(str(path) + ".requests.jsonl")
        report["completed"] = False
        memory = root / f"{self.active_phase}-external.jsonl"
        samples = []
        lines = memory.read_text().splitlines() if memory.exists() else []
        for index, line in enumerate(lines):
            try:
                samples.append(json.loads(line))
            except ValueError:
                if index != len(lines) - 1:
                    raise SafetyError("corrupt_observation_interior")
        receipt = phase_receipt(report, samples, self.active_phase, self.baseline)
        receipt["passed"] = False
        receipt["observer_completed"] = False
        if self.ledger and "api" in self.ledger.state["containers"]:
            state = self.ledger.inspect(self.ledger.state["containers"]["api"])["State"]
            receipt["container_oom_killed"] = state["OOMKilled"]
        receipt["timeline"] = numeric_timeline(samples, str(path) + ".requests.jsonl")
        self.summary["phases"][self.active_phase] = receipt

    def cleanup(self):
        if self.cleaning_started is None:
            self.cleaning_started = time.monotonic()
            if self.ledger:
                self.cleaning_started = self.ledger.state.setdefault(
                    "finalization_started", self.cleaning_started
                )
                self.ledger.save()
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        if self.ledger and not self.ledger.state.get("cleaned"):
            for record in self.ledger.state.get("processes", []):
                stat = Path(f"/proc/{record['pid']}/stat")
                if not stat.exists():
                    continue
                fields = stat.read_text().rsplit(")", 1)[1].split()
                if int(fields[19]) != record["start_ticks"]:
                    raise SafetyError("child_process_identity_changed")
                os.kill(record["pid"], signal.SIGTERM)
                until = time.monotonic() + 5
                while stat.exists() and time.monotonic() < until:
                    time.sleep(0.1)
                if stat.exists():
                    fields = stat.read_text().rsplit(")", 1)[1].split()
                    if int(fields[19]) != record["start_ticks"]:
                        raise SafetyError("child_process_identity_changed")
                    os.kill(record["pid"], signal.SIGKILL)
            self.ledger.cleanup()
        self.summary["cleaned_owned_resources"] = True

    def write_receipt(self):
        self.receipt.parent.mkdir(parents=True, exist_ok=True)
        encoded = (
            json.dumps(public_receipt(self.summary), allow_nan=False, indent=2) + "\n"
        )
        if len(encoded.encode()) > 100 * 1024:
            raise SafetyError("public_receipt_too_large")
        self.receipt.write_text(encoded)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True)
    parser.add_argument("--work", required=True)
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--cleanup-only", action="store_true")
    parser.add_argument("--legal-matrix", action="store_true")
    args = parser.parse_args()
    if (
        platform.system() != "Linux"
        or os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("GITHUB_REPOSITORY") != "Shimizu-Technology/hafa-recipes"
    ):
        raise SafetyError("trusted_linux_ci_required")
    if args.legal_matrix:
        from capacity.legal_ci import LegalCoordinator

        coordinator = LegalCoordinator(args.repository, args.work, args.receipt)
    else:
        coordinator = Coordinator(args.repository, args.work, args.receipt)

    def cancelled(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, cancelled)
    try:
        if args.cleanup_only:
            path = coordinator.work / "resources.json"
            if path.exists():
                state = json.loads(path.read_text())
                coordinator.ledger = Ledger(path, state["run_id"], coordinator.command)
            coordinator.cleanup()
            return 0
        coordinator.run()
    except BaseException:  # noqa: BLE001 - sanitize failure and always clean exact resources
        coordinator.summary["passed"] = False
    finally:
        try:
            if coordinator.cleaning_started is None:
                coordinator.cleaning_started = time.monotonic()
                if coordinator.ledger:
                    coordinator.cleaning_started = coordinator.ledger.state.setdefault(
                        "finalization_started", coordinator.cleaning_started
                    )
                    coordinator.ledger.save()
            coordinator.stop_traffic()
            coordinator.capture_partial()
        except (SafetyError, ValueError, OSError, KeyError):
            coordinator.summary["passed"] = False
        try:
            coordinator.cleanup()
        except BaseException:  # noqa: BLE001 - cleanup failures are explicit failed acceptance
            coordinator.summary["cleaned_owned_resources"] = False
            coordinator.summary["passed"] = False
        if not args.cleanup_only:
            coordinator.write_receipt()
    return 0 if coordinator.summary["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
