"""Prepare by default; execute only an explicitly reviewed local ARM plan.

No CI dispatch, API server, provider access, production recovery or image prune.
The existing audited Ledger owns exact labelled Docker resources and cleanup.
"""

import argparse
import hashlib
import json
import os
import platform
import re
import signal
import subprocess
import time
from pathlib import Path

from capacity.ci_safety import OWNER, Ledger, SafetyError
from capacity.export_jobs_death_binding import (
    selected,
    unselected,
    validate_shape,
    verify_binding,
    verify_context,
)
from capacity.export_jobs_death_postgres import (
    ARM_CONFIG,
    ARM_IMAGE,
    SOURCE,
    local_pg_argv,
    verify_pg_image,
)
from capacity.export_jobs_death_python import ARM_IMAGE as PYTHON_ARM_IMAGE
from capacity.export_jobs_death_python import SOURCE as PYTHON_SOURCE
from capacity.export_jobs_death_python import local_build_argv, verify_base_image
from capacity.plan import build_plan
from capacity.safety import ensure

OVERRIDES = {
    "CAPACITY_LINUX_DEATH": "true",
    "WORKOUTS_AI_ENABLED": "false",
    "WORKOUTS_IMPORTS_ENABLED": "false",
    "WORKOUTS_EXPORT_JOBS_ENABLED": "true",
    "JOB_WORKER_ENABLED": "true",
    "DELETION_CLEANUP_WORKER_ENABLED": "false",
    "CAPACITY_COVER_SCENARIOS": "false",
}
STEPS = {
    "build_after_root_inspection",
    "start_owned_postgres",
    "verify_postgres_ready_before_seed",
    "seed_actual_migrations_once_empty_owned_db",
}
BOOL_KEYS = {
    "live_source_slot_retained",
    "suspended_expired_lease_slot_retained",
    "default_operator_verifier_refused",
    "killed_reaped_identity_absent",
    "same_namespace_death_audit",
    "wrong_namespace_default_deny",
    "old_uuid_never_restarted",
    "fresh_uuid_actual_end",
    "artifacts_zero",
    "slot_idle",
    "passed",
}
PROBE = """import hashlib,importlib.metadata,json,platform
from pathlib import Path
from pip._vendor.packaging.requirements import Requirement
from capacity.export_jobs_death_python import verify_runtime
text=Path('/api/requirements.txt').read_text(); pins={}
for line in text.splitlines():
 line=line.strip()
 if not line or line.startswith('#'): continue
 r=Requirement(line)
 if r.marker is None or r.marker.evaluate():
  v=importlib.metadata.version(r.name)
  assert r.specifier.contains(v,prereleases=True)
  pins[r.name.lower()]=v
verify_runtime(platform.machine(),platform.python_version())
print(json.dumps({'architecture':platform.machine(),'python':platform.python_version(),'requirements_sha256':hashlib.sha256(text.encode()).hexdigest(),'packages':pins},sort_keys=True))
"""
START_GATE = """import os,sys,time
from pathlib import Path
until=time.monotonic()+50
while not Path('/tmp/linux-death-start').exists():
 if time.monotonic()>=until: raise SystemExit(2)
 time.sleep(.05)
os.execvp(sys.argv[1],sys.argv[1:])
"""


def require(value):
    if not value:
        raise SafetyError("linux_death_local_plan_rejected")


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n"


def check_scenario(value):
    require(
        isinstance(value, dict)
        and set(value) == BOOL_KEYS
        and all(item is True for item in value.values())
    )


def gate_argv(argv, image):
    position = argv.index(image)
    command = argv[3] if argv[1:2] == ["--context"] else argv[1]
    require(
        position >= 2
        and argv[0] == "docker"
        and command == "run"
        and position < len(argv) - 1
    )
    return argv[: position + 1] + ["python", "-c", START_GATE] + argv[position + 1 :]


def lifecycle_id(identifier, present):
    """Canonical helper records Docker's unique12-character collector ID."""
    require(re.fullmatch(r"[0-9a-f]{64}", identifier) and present == [identifier])
    return identifier[:12]


def git(repository, *args):
    return subprocess.check_output(
        ["git", "-C", str(repository), *args], text=True, timeout=10
    ).strip()


def prepare(repository, output, run_id, binding, api_reference):
    repository, output = Path(repository).resolve(), Path(output).resolve()
    validate_shape(binding)
    require(
        not git(
            repository,
            "diff",
            api_reference,
            "HEAD",
            "--",
            "api/app",
            "api/migrations",
            "api/requirements.txt",
        )
    )
    baseline = build_plan(
        repository,
        output,
        run_id,
        1,
        target_platform="linux/arm64",
        owner=OWNER,
        fixture_overrides={"WORKOUTS_EXPORT_JOBS_ENABLED": "true"},
    )
    environment = dict(
        line.split("=", 1) for line in (output / "fixture.env").read_text().splitlines()
    )
    ensure(environment)
    manifest = {
        name: sha(output / "context" / name) for name in baseline["context_files"]
    }
    common = [
        "docker",
        "run",
        "-d",
        "--platform",
        "linux/arm64",
        "--network",
        f"container:{baseline['resource_names']['postgres']}",
        "--env-file",
        str(output / "fixture.env"),
        "--label",
        f"hafa.capacity.owner={OWNER}",
        "--label",
        f"hafa.capacity.run={run_id}",
    ]
    for key, value in sorted(OVERRIDES.items()):
        common += ["-e", f"{key}={value}"]
    image = next(
        step["argv"][step["argv"].index("-t") + 1]
        for step in baseline["commands"]
        if step["step"] == "build_after_root_inspection"
    )
    plan = {
        "executed": False,
        "candidate_commit": baseline["candidate_commit"],
        "api_reference": api_reference,
        "api_parity_verified": True,
        "docker_binding": binding,
        "platform": "linux/arm64",
        "run_id": run_id,
        "resource_names": baseline["resource_names"],
        "image_tag": image,
        "context_manifest": manifest,
        "fixture_env_sha256": sha(output / "fixture.env"),
        "requirements_sha256": manifest["api/requirements.txt"],
        "api_manifest_sha256": hashlib.sha256(
            encoded(
                {k: v for k, v in manifest.items() if k.startswith("api/")}
            ).encode()
        ).hexdigest(),
        "commands": {
            step["step"]: step["argv"]
            for step in baseline["commands"]
            if step["step"] in STEPS
        },
        "inventory_argv": common
        + [
            "--name",
            f"capacity-inventory-{run_id}",
            "--memory",
            "256m",
            "--memory-swap",
            "256m",
            image,
            "python",
            "-c",
            PROBE,
        ],
        "driver_argv": common
        + [
            "--name",
            f"capacity-death-{run_id}",
            "--memory",
            "512m",
            "--memory-swap",
            "512m",
            "--cpus",
            "1",
            image,
            "python",
            "-m",
            "capacity.export_jobs_death_driver",
        ],
        "deadlines_seconds": {
            "whole": 1000,
            "build": 600,
            "inventory": 60,
            "ready": 30,
            "seed": 180,
            "driver": 130,
            "cleanup": 120,
        },
        "scope": "one local ARM Linux kernel death scenario; not x86, capacity, Render, operator or rollout acceptance",
    }
    plan["commands"] = {
        key: selected(argv, binding["context"])
        for key, argv in plan["commands"].items()
    }
    plan["commands"]["start_owned_postgres"] = local_pg_argv(
        plan["commands"]["start_owned_postgres"]
    )
    plan["postgres_source"] = dict(SOURCE)
    plan["commands"]["build_after_root_inspection"] = local_build_argv(
        plan["commands"]["build_after_root_inspection"]
    )
    plan["python_source"] = dict(PYTHON_SOURCE)
    plan["python_pull_argv"] = selected(
        ["docker", "pull", "--platform", "linux/arm64", PYTHON_ARM_IMAGE],
        binding["context"],
    )
    plan["deadlines_seconds"]["python_pull"] = 120
    plan["postgres_pull_argv"] = selected(
        ["docker", "pull", "--platform", "linux/arm64", ARM_IMAGE], binding["context"]
    )
    plan["deadlines_seconds"]["postgres_pull"] = 120
    for key in ("inventory_argv", "driver_argv"):
        plan[key] = selected(plan[key], binding["context"])
    path = output / "linux-death-plan.json"
    path.write_text(encoded(plan))
    path.chmod(0o600)
    return {
        "prepared": True,
        "plan_sha256": sha(path),
        "candidate_commit": plan["candidate_commit"],
    }


def validate_plan(repository, output, approved_sha):
    repository, output = Path(repository).resolve(), Path(output).resolve()
    path = output / "linux-death-plan.json"
    require(len(approved_sha) == 64 and sha(path) == approved_sha)
    plan = json.loads(path.read_text())
    validate_shape(plan["docker_binding"])
    require(plan["postgres_source"] == SOURCE)
    require(plan["python_source"] == PYTHON_SOURCE)
    require(
        "PYTHON_BASE=" + PYTHON_ARM_IMAGE
        in plan["commands"]["build_after_root_inspection"]
    )
    require(plan["commands"]["start_owned_postgres"][-1] == ARM_IMAGE)
    require(not plan["executed"] and plan["platform"] == "linux/arm64")
    require(git(repository, "rev-parse", "HEAD") == plan["candidate_commit"])
    require(not git(repository, "status", "--porcelain", "--untracked-files=no"))
    require(sha(output / "fixture.env") == plan["fixture_env_sha256"])
    ensure(
        dict(
            line.split("=", 1)
            for line in (output / "fixture.env").read_text().splitlines()
        )
    )
    for name, digest in plan["context_manifest"].items():
        path = output / "context" / name
        require(
            not path.is_symlink() and path.resolve().is_relative_to(output / "context")
        )
        require(sha(path) == digest)
        source = repository / (
            "experiments/workouts-capacity/" + name
            if not name.startswith("api/")
            else name
        )
        require(sha(source) == digest)
    require(
        not git(
            repository,
            "diff",
            plan["api_reference"],
            "HEAD",
            "--",
            "api/app",
            "api/migrations",
            "api/requirements.txt",
        )
    )
    return plan


class LocalRunner:
    def __init__(self, repository, output, plan, session):
        self.repository, self.output, self.plan, self.session = (
            Path(repository).resolve(),
            Path(output).resolve(),
            plan,
            session,
        )
        self.helper = str(Path.home() / ".local/bin/dev-lifecycle")
        self.started = time.monotonic()
        self.cleaning = None
        self.claimed = set()
        self.lifecycle_unknown = False
        self.ledger = Ledger(
            self.output / "linux-death-ledger.json",
            plan["run_id"],
            command=self.command,
        )
        require(not self.ledger.state["cleaned"] and not self.ledger.state["intents"])
        self.result = {
            "passed": False,
            "cleanup_passed": False,
            "candidate_commit": plan["candidate_commit"],
            "local_arm_linux_only": True,
        }

    def raw(self, argv, timeout=30):
        limit = (
            (
                self.plan["deadlines_seconds"]["cleanup"]
                - (time.monotonic() - self.cleaning)
            )
            if self.cleaning
            else (
                self.plan["deadlines_seconds"]["whole"]
                - (time.monotonic() - self.started)
            )
        )
        require(limit > 0)
        environment = {
            **os.environ,
            "DOCKER_CONTEXT": self.plan["docker_binding"]["context"],
        }
        environment.pop("DOCKER_HOST", None)
        done = subprocess.run(
            argv,
            cwd=self.repository,
            capture_output=True,
            text=True,
            timeout=max(1, min(timeout, limit)),
            env=environment,
        )
        with (self.output / "linux-death-private-command.log").open("a") as log:
            log.write(done.stdout + done.stderr)
        require(done.returncode == 0)
        return done.stdout.strip()

    def verify_environment(self):
        binding = self.plan["docker_binding"]
        context = json.loads(
            self.raw(
                selected(
                    [
                        "docker",
                        "context",
                        "inspect",
                        binding["context"],
                        "--format",
                        "{{json .}}",
                    ],
                    binding["context"],
                ),
                15,
            )
        )
        verify_context(binding, context)  # Refuse changed/remote host BEFORE info.
        daemon = json.loads(
            self.raw(
                selected(
                    [
                        "docker",
                        "info",
                        "--format",
                        '{"ID":{{json .ID}},"OSType":{{json .OSType}},"Architecture":{{json .Architecture}},"Name":{{json .Name}}}',
                    ],
                    binding["context"],
                ),
                15,
            )
        )
        verify_binding(binding, context, daemon)

    def command(self, argv, timeout=30):
        if argv[0] == "docker" or argv[0] == self.helper:
            self.verify_environment()
        if argv[0] == "docker":
            argv = selected(argv, self.plan["docker_binding"]["context"])
        return self.raw(argv, timeout)

    def claim(self, identifier):
        self.ledger.inspect(identifier)  # Full identity/labels remain authoritative.
        present = self.command(
            [
                "docker",
                "ps",
                "-a",
                "--no-trunc",
                "--filter",
                f"id={identifier[:12]}",
                "--format",
                "{{.ID}}",
            ]
        ).splitlines()
        helper_id = lifecycle_id(identifier, present)
        try:
            self.command(
                [
                    self.helper,
                    "claim",
                    "--session",
                    self.session,
                    "--owner",
                    "linux_recovery_preflight",
                    "--reason",
                    "isolated local ARM Linux death acceptance",
                    "container",
                    helper_id,
                ],
                35,
            )
        except BaseException:
            self.lifecycle_unknown = True  # Never override helper rejection/timeout.
            raise
        self.claimed.add(identifier)

    def release(self, identifier):
        if identifier in self.claimed:
            require(identifier in self.ledger.state.get("removed", {}).values())
            self.command(
                [
                    self.helper,
                    "release",
                    "--session",
                    self.session,
                    "container",
                    identifier[:12],
                ],
                35,
            )
            self.claimed.remove(identifier)

    def create(self, role, argv):
        identifier = self.ledger.create_container(
            role, unselected(argv, self.plan["docker_binding"]["context"])
        )
        self.claim(identifier)
        return identifier

    def finite(self, role, argv, seconds):
        identifier = self.create(role, gate_argv(argv, self.result["image_id"]))
        try:
            # The original command cannot finish before the ordinary lifecycle
            # claim. Only this owned container's gate is opened after claiming.
            self.ledger.inspect(identifier)
            self.command(
                [
                    "docker",
                    "exec",
                    identifier,
                    "python",
                    "-c",
                    "from pathlib import Path;Path('/tmp/linux-death-start').touch()",
                ],
                5,
            )
            code = int(self.command(["docker", "wait", identifier], seconds))
            output = self.command(["docker", "logs", identifier])
            (self.output / ("linux-death-" + role + ".log")).write_text(output + "\n")
            require(
                code == 0 and not self.ledger.inspect(identifier)["State"]["OOMKilled"]
            )
            return output
        finally:
            self.ledger.remove_container(role)
            self.release(identifier)

    def run(self):
        try:
            require(platform.machine() == "arm64")
            self.verify_environment()
            commands, limits = self.plan["commands"], self.plan["deadlines_seconds"]
            # A declared ARM app label cannot qualify an x86 base/interpreter.
            self.command(self.plan["python_pull_argv"], limits["python_pull"])
            python_image = json.loads(
                self.command(["docker", "image", "inspect", PYTHON_ARM_IMAGE])
            )
            require(len(python_image) == 1)
            self.result["python_source"] = verify_base_image(python_image[0])
            (self.output / "linux-death-python-base-inventory.json").write_text(
                encoded(self.result["python_source"])
            )
            # Refuse an incompatible DB image BEFORE build/network/DB startup.
            self.command(self.plan["postgres_pull_argv"], limits["postgres_pull"])
            pg_image = json.loads(
                self.command(["docker", "image", "inspect", ARM_IMAGE])
            )
            require(len(pg_image) == 1)
            self.result["postgres_source"] = verify_pg_image(pg_image[0])
            (self.output / "linux-death-postgres-inventory.json").write_text(
                encoded(self.result["postgres_source"])
            )
            self.command(commands["build_after_root_inspection"], limits["build"])
            image = json.loads(
                self.command(["docker", "image", "inspect", self.plan["image_tag"]])
            )[0]
            require(
                image["Architecture"] == "arm64"
                and image["Config"]["Labels"]["org.opencontainers.image.revision"]
                == self.plan["candidate_commit"]
            )
            image_id = image["Id"]
            self.result["image_id"] = image_id

            def pinned(argv):
                return [
                    image_id if word == self.plan["image_tag"] else word
                    for word in argv
                ]

            self.ledger.create_network(self.plan["resource_names"]["network"])
            pg = self.create("pg", commands["start_owned_postgres"])
            require(self.ledger.inspect(pg)["Image"] == ARM_CONFIG)
            until = time.monotonic() + limits["ready"]
            while True:
                try:
                    self.command(commands["verify_postgres_ready_before_seed"], 5)
                    break
                except SafetyError:
                    require(time.monotonic() < until)
                    time.sleep(0.2)
            inventory = json.loads(
                self.finite(
                    "inventory",
                    pinned(self.plan["inventory_argv"]),
                    limits["inventory"],
                )
            )
            require(
                inventory["architecture"] == "aarch64"
                and inventory["requirements_sha256"] == self.plan["requirements_sha256"]
            )
            (self.output / "linux-death-inventory.json").write_text(encoded(inventory))
            seed = pinned(commands["seed_actual_migrations_once_empty_owned_db"])
            position = seed.index(image_id)
            overrides = [
                part
                for key, value in sorted(OVERRIDES.items())
                for part in ("-e", f"{key}={value}")
            ]
            seed[position:position] = overrides
            self.finite("seed", seed, limits["seed"])
            numeric = json.loads(
                self.finite("death", pinned(self.plan["driver_argv"]), limits["driver"])
            )
            check_scenario(numeric)
            require(not self.ledger.inspect(pg)["State"]["OOMKilled"])
            self.result.update(scenario=numeric, passed=True)
        finally:
            self.cleaning = time.monotonic()
            try:
                ids = list(self.ledger.state["containers"].values())
                self.ledger.cleanup()
                for identifier in ids:
                    self.release(identifier)
                require(not self.claimed and not self.lifecycle_unknown)
                self.result["cleanup_passed"] = True
            finally:
                self.result["lifecycle_reconciliation_required"] = (
                    self.lifecycle_unknown or bool(self.claimed)
                )
                (self.output / "linux-death-result.json").write_text(
                    encoded(self.result)
                )
        return self.result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--run-id")
    parser.add_argument("--docker-context")
    parser.add_argument("--docker-endpoint")
    parser.add_argument("--docker-daemon-id")
    parser.add_argument("--docker-daemon-name")
    parser.add_argument(
        "--api-reference", default="7139ccf7ec5a1b593f4a7dd6cb091382fe4e2b4e"
    )
    parser.add_argument("--approved-plan-sha")
    parser.add_argument("--session")
    args = parser.parse_args()
    require(args.prepare != args.execute)
    if args.prepare:
        require(
            args.run_id
            and args.docker_context
            and args.docker_endpoint
            and args.docker_daemon_id
            and args.docker_daemon_name
        )
        result = prepare(
            args.repository,
            args.output,
            args.run_id,
            {
                "context": args.docker_context,
                "endpoint": args.docker_endpoint,
                "daemon_id": args.docker_daemon_id,
                "daemon_name": args.docker_daemon_name,
            },
            args.api_reference,
        )
    else:
        require(args.approved_plan_sha and args.session)
        plan = validate_plan(args.repository, args.output, args.approved_plan_sha)
        signal.signal(
            signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt())
        )
        result = LocalRunner(args.repository, args.output, plan, args.session).run()
    print(encoded(result))
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except BaseException:  # noqa: BLE001 - private command logs, fixed public error
        print("linux_death_local_failed")
        code = 2
    raise SystemExit(code)
