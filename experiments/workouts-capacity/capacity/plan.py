"""Prepare a filtered context and an inspectable argv plan. NEVER executes Docker."""

import argparse
import json
import platform
import re
import shutil
import subprocess
from pathlib import Path

from capacity.safety import DATABASE, DATABASE_URL, FAKE_KEY

PYTHON_BASE = (
    "python@sha256:2ed6491b93cd49272ee6de2b5a38440c3448360322c089fc23e370722d74179d"
)
POSTGRES_BASE = (
    "postgres@sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551"
)


def environment():
    return {
        "HAFACAPACITY_RUN": "1",
        "ENVIRONMENT": "test",
        "DATABASE_URL": DATABASE_URL,
        "WORKOUTS_AI_BUDGET_DATABASE_URL": DATABASE_URL,
        "DATABASE_USE_SSL": "false",
        "OPENAI_API_KEY": FAKE_KEY,
        "WORKOUTS_DEVELOPMENT_AI_API_KEY": FAKE_KEY,
        "CLERK_DEVELOPMENT_ISSUER": "https://capacity.invalid",
        "CLERK_PRIMARY_ENVIRONMENT": "development",
        "WORKOUTS_API_ENABLED": "true",
        "WORKOUTS_PUBLIC_ACCESS_ENABLED": "true",
        "WORKOUTS_IMPORTS_ENABLED": "true",
        "WORKOUTS_AI_ENABLED": "true",
        "WORKOUTS_HEALTH_SYNC_ENABLED": "true",
        "WORKOUTS_AI_BUDGET_24H_MICROUSD": "5000000",
        "WORKOUTS_SHARE_ENCRYPTION_KEY": "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=",
        "S3_BUCKET_NAME": "capacity-fixtures",
        "RECIPE_MEDIA_BASE_URL": "https://capacity.invalid",
        "AWS_EC2_METADATA_DISABLED": "true",
        "SENTRY_DSN": "",
        "CAPACITY_PROVIDER_DELAY": "0.25",
        "CAPACITY_PHASE": "baseline",
        "VIDEO_FRAME_EXTRACTION_ENABLED": "true",
        "JOB_WORKER_ENABLED": "true",
    }


def prepare_context(repository, output):
    repository, output = Path(repository).resolve(), Path(output).resolve()
    if output.exists():
        raise RuntimeError("Context output must be new; no directory is replaced")
    selected = (
        subprocess.check_output(
            [
                "git",
                "-C",
                str(repository),
                "ls-files",
                "-z",
                "--",
                "api/app",
                "api/migrations",
                "api/requirements.txt",
                "experiments/workouts-capacity/capacity",
                "experiments/workouts-capacity/Dockerfile",
            ]
        )
        .decode()
        .split("\0")
    )
    selected = [name for name in selected if name]
    if not selected:
        raise RuntimeError("Build context requires tracked candidate files")
    mapping = []
    for name in selected:
        source = repository / name
        if source.is_symlink() or not source.resolve().is_relative_to(repository):
            raise RuntimeError("Build context cannot dereference symlinks")
        if any(
            part.startswith(".env")
            or part in {".git", ".venv", "__pycache__", "node_modules"}
            for part in Path(name).parts
        ):
            raise RuntimeError("Forbidden tracked build context content")
        if not source.is_file():
            raise RuntimeError("Tracked context file is missing")
        target = name
        if name.startswith("experiments/workouts-capacity/"):
            target = name.removeprefix("experiments/workouts-capacity/")
        mapping.append((source, target))
    output.mkdir(parents=True)
    for source, target in mapping:
        destination = output / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    return [target for _, target in mapping]


def build_plan(repository, output, run_id, cpus, target_platform="linux/amd64"):
    if not re.fullmatch(r"[a-z0-9-]{1,40}", run_id) or not 0 < cpus <= 8:
        raise ValueError("Use a bounded unique run ID and verified CPU allocation")
    repository, output = Path(repository).resolve(), Path(output).resolve()
    commit = subprocess.check_output(
        ["git", "-C", str(repository), "rev-parse", "HEAD"], text=True
    ).strip()
    dirty = subprocess.check_output(
        ["git", "-C", str(repository), "status", "--porcelain", "--untracked-files=no"],
        text=True,
    )
    if dirty:
        raise RuntimeError("Commit candidate changes before preparing the experiment")
    if output.exists():
        raise RuntimeError("Experiment output must be new")
    output.mkdir(mode=0o700, parents=True)
    files = prepare_context(repository, output / "context")
    for name in ["fixtures", "results"]:
        directory = output / name
        directory.mkdir()
        # Only these synthetic writer directories are shared with UID10001;
        # the enclosing host output stays private0700 and env stays0600.
        directory.chmod(0o777)
    env_file = output / "fixture.env"
    env_file.write_text(
        "".join(f"{key}={value}\n" for key, value in environment().items())
    )
    env_file.chmod(0o600)
    network, postgres, api = [
        f"capacity-{kind}-{run_id}" for kind in ["network", "pg", "api"]
    ]
    image = f"hafa-capacity:{commit[:12]}"
    common = [
        "--platform",
        target_platform,
        "--network",
        f"container:{postgres}",
        "--env-file",
        str(env_file),
        "--label",
        f"hafa.capacity.run={run_id}",
        "--label",
        "hafa.capacity.owner=native_health_preflight",
    ]
    commands = [
        {
            "step": "build_after_root_inspection",
            "argv": [
                "docker",
                "build",
                "--platform",
                target_platform,
                "--build-arg",
                f"SOURCE_COMMIT={commit}",
                "--build-arg",
                f"PYTHON_BASE={PYTHON_BASE}",
                "-t",
                image,
                str(output / "context"),
            ],
        },
        {
            "step": "create_owned_internal_network",
            "argv": [
                "docker",
                "network",
                "create",
                "--internal",
                "--label",
                f"hafa.capacity.run={run_id}",
                "--label",
                "hafa.capacity.owner=native_health_preflight",
                network,
            ],
        },
        {
            "step": "start_owned_postgres",
            "argv": [
                "docker",
                "run",
                "-d",
                "--name",
                postgres,
                "--platform",
                target_platform,
                "--network",
                network,
                "--label",
                f"hafa.capacity.run={run_id}",
                "--label",
                "hafa.capacity.owner=native_health_preflight",
                "--memory",
                "1g",
                "--tmpfs",
                "/var/lib/postgresql/data:rw",
                "-e",
                "POSTGRES_PASSWORD=capacity_local_only",
                "-e",
                f"POSTGRES_DB={DATABASE}",
                POSTGRES_BASE,
            ],
        },
        {
            "step": "verify_postgres_ready_before_seed",
            "argv": [
                "docker",
                "exec",
                postgres,
                "pg_isready",
                "-U",
                "postgres",
                "-d",
                DATABASE,
            ],
        },
        {
            "step": "generate_sources_separate_from_api_budget",
            "argv": [
                "docker",
                "run",
                "--rm",
                "--name",
                f"capacity-fixtures-{run_id}",
                *common,
                "-v",
                f"{output / 'fixtures'}:/fixtures",
                image,
                "python",
                "-m",
                "capacity.fixtures",
                "/fixtures",
            ],
        },
        {
            "step": "verify_real_source_pipeline_BEFORE_any_workouts_load",
            "argv": [
                "docker",
                "run",
                "--rm",
                "--name",
                f"capacity-source-check-{run_id}",
                *common,
                "-v",
                f"{output / 'fixtures'}:/fixtures:ro",
                image,
                "python",
                "-m",
                "capacity.source_check",
                "/fixtures",
            ],
        },
        {
            "step": "seed_actual_migrations_once_empty_owned_db",
            "argv": [
                "docker",
                "run",
                "--rm",
                "--name",
                f"capacity-seed-{run_id}",
                *common,
                image,
                "python",
                "-m",
                "capacity.seed",
            ],
        },
        {
            "step": "start_baseline_api",
            "argv": [
                "docker",
                "run",
                "-d",
                "--name",
                api,
                *common,
                "--label",
                f"hafa.capacity.run={run_id}",
                "--memory",
                "512m",
                "--memory-swap",
                "512m",
                "--cpus",
                str(cpus),
                "-e",
                "WORKOUTS_API_ENABLED=false",
                "-v",
                f"{output / 'fixtures'}:/fixtures:ro",
                image,
            ],
        },
        {
            "step": "run_baseline_separate_load_cgroup",
            "argv": [
                "docker",
                "run",
                "--rm",
                "--name",
                f"capacity-load-{run_id}",
                *common,
                "-v",
                f"{output / 'fixtures'}:/fixtures:ro",
                "-v",
                f"{output / 'results'}:/results",
                image,
                "python",
                "-m",
                "capacity.driver",
                "--profile",
                "recipes-baseline",
                "--seconds",
                "300",
                "--output",
                "/results/baseline.json",
            ],
        },
    ]
    mixed_api = list(
        next(c["argv"] for c in commands if c["step"] == "start_baseline_api")
    )
    mixed_api[mixed_api.index("--name") + 1] = f"capacity-api-{run_id}"
    mixed_api[mixed_api.index("WORKOUTS_API_ENABLED=false")] = (
        "WORKOUTS_API_ENABLED=true"
    )
    image_position = mixed_api.index(image)
    mixed_api[image_position:image_position] = ["-e", "CAPACITY_PHASE=mixed"]
    mixed_load = list(
        next(
            c["argv"]
            for c in commands
            if c["step"] == "run_baseline_separate_load_cgroup"
        )
    )
    mixed_load[mixed_load.index("--name") + 1] = f"capacity-mixed-load-{run_id}"
    mixed_load[mixed_load.index("recipes-baseline")] = "mixed"
    mixed_load[mixed_load.index("/results/baseline.json")] = "/results/mixed.json"
    plan = {
        "executed": False,
        "candidate_commit": commit,
        "host_architecture": platform.machine(),
        "target_platform": target_platform,
        "emulation_is_not_render_latency_acceptance": True,
        "production_dependencies": "api/requirements.txt",
        "mocked_provider": True,
        "cold_media": {
            "phase_distinct_canonical_ids": True,
            "fresh_job_and_frame_checkpoints_required": True,
        },
        "source_preflight": "Must pass all grounded fixture facts before load; PDF blocked under current amd64 emulation. No parser-limit bypass.",
        "financial_guard": "synthetic throughput only; separate real-guard denial tests required",
        "r04_closed": False,
        "thresholds": {
            "pass_peak_mib": 410,
            "stop_current_mib": 460,
            "read_p95_ms": 500,
            "write_p95_ms": 1000,
            "baseline_p95_multiplier": 1.25,
        },
        "resource_names": {"network": network, "postgres": postgres, "api": api},
        "commands": commands,
        "mixed_after_baseline_inspection": {
            "authorized": False,
            "preserve_exact_pg_database": True,
            "no_reset_no_reseed": True,
            "baseline_api_action": "Capture final metrics, stop/remove ONLY exact recorded owned baseline API ID; retain owned PG/network.",
            "commands": [
                {"step": "start_mixed_api_ONLY", "argv": mixed_api},
                {"step": "run_mixed300_separate_load", "argv": mixed_load},
            ],
            "host_monitor_phase": "mixed",
            "host_monitor_seconds": 450,
        },
        "longer_acceptance_cases": {
            "status": "NOT_RUN",
            "cases": [
                "15-minute mixed",
                "three repetitions",
                "upload burst4/8/16",
                "worst legal40MP nonJPEG/concurrent images",
                "ten-minute idle return",
                "restart/replay",
                "rollback",
            ],
            "auto_render_upsize": False,
        },
        "context_files": files,
        "execution_requirements": [
            "Root must inspect and explicitly authorize runtime; this program starts nothing.",
            "Verify names are absent, then claim exact returned container IDs immediately via dev-lifecycle.",
            "Resolve/pin base and PostgreSQL image digests before declaring artifact parity.",
            "Record Render CPU/runtime/binary versions; current plan is a local experiment.",
            "Stop only the recorded owned API container if memory.current>=460MiB or OOM occurs.",
            "For mixed run recreate ONLY the owned API container without WORKOUTS_API_ENABLED=false; do not reset database.",
            "Run three repetitions, burst4/8/16, export backpressure and restart/rollback protocol from README.",
            "Capture memory.peak/events BEFORE stopping each API container.",
            "Cleanup exact owned container IDs and network ID; no shared containers, volume pruning or image pruning.",
        ],
    }
    (output / "plan.json").write_text(json.dumps(plan, indent=2))
    return plan


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--cpus", type=float, required=True)
    parser.add_argument("--platform", default="linux/amd64")
    args = parser.parse_args()
    plan = build_plan(
        args.repository, args.output, args.run_id, args.cpus, args.platform
    )
    print(
        json.dumps(
            {
                "plan_written": True,
                "candidate_commit": plan["candidate_commit"],
                "executed": False,
            }
        )
    )
