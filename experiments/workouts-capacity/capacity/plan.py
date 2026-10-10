"""Prepare a filtered context and an inspectable argv plan. NEVER executes Docker."""

import argparse
import json
import platform
import re
import shutil
import subprocess
from pathlib import Path

from capacity.safety import DATABASE, FAKE_KEY


def environment():
    return {
        "HAFACAPACITY_RUN": "1",
        "ENVIRONMENT": "test",
        "DATABASE_URL": f"postgresql://postgres:capacity_local_only@127.0.0.1:5432/{DATABASE}",
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
        "VIDEO_FRAME_EXTRACTION_ENABLED": "true",
        "JOB_WORKER_ENABLED": "true",
    }


def prepare_context(repository, output):
    repository, output = Path(repository).resolve(), Path(output).resolve()
    if output.exists():
        raise RuntimeError("Context output must be new; no directory is replaced")
    output.mkdir(parents=True)
    ignore = shutil.ignore_patterns(
        "__pycache__", "*.pyc", ".env", ".venv", "node_modules"
    )
    for folder in ["app", "migrations"]:
        shutil.copytree(
            repository / "api" / folder, output / "api" / folder, ignore=ignore
        )
    shutil.copy2(repository / "api/requirements.txt", output / "api/requirements.txt")
    source = repository / "experiments/workouts-capacity"
    shutil.copytree(source / "capacity", output / "capacity", ignore=ignore)
    shutil.copy2(source / "Dockerfile", output / "Dockerfile")
    files = [
        str(path.relative_to(output)) for path in output.rglob("*") if path.is_file()
    ]
    if any(".env" in Path(path).parts or ".git" in Path(path).parts for path in files):
        raise RuntimeError("Forbidden build context content")
    return files


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
                "--memory",
                "1g",
                "--tmpfs",
                "/var/lib/postgresql/data:rw",
                "-e",
                "POSTGRES_PASSWORD=capacity_local_only",
                "-e",
                f"POSTGRES_DB={DATABASE}",
                "postgres:16-alpine",
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
    plan = {
        "executed": False,
        "candidate_commit": commit,
        "host_architecture": platform.machine(),
        "target_platform": target_platform,
        "emulation_is_not_render_latency_acceptance": True,
        "production_dependencies": "api/requirements.txt",
        "mocked_provider": True,
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
