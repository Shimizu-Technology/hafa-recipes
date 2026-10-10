"""Finite CI ownership and numeric public receipt gates; no application imports."""

import json
import math
import re
import subprocess
from pathlib import Path

from capacity.failure_codes import CODES, PHASES
from capacity.statistics import nearest_rank

OWNER = "capacity_ci"
REPOSITORY = "Shimizu-Technology/hafa-recipes"
HEX_ID = re.compile(r"[0-9a-f]{64}")
READS = {"/up", "recipes/list", "recipes/search", "recipes/detail"}
EXTRA_READS = {
    "workouts/library",
    "workouts/activity-list",
    "workouts/import-poll",
    "workouts/export-page",
}
BASE_WRITES = {
    "recipes/manual-write",
    "recipes/chat",
    "recipes/text",
    "recipes/ocr",
    "recipes/video-submit",
}
EXTRA_WRITES = {
    "workouts/activity-write",
    "workouts/coach",
    "workouts/manual-workout",
    "workouts/session-write",
    "workouts/session-replay",
    "workouts/import-submit",
    "workouts/import-accept",
    "workouts/export-build",
    "workouts/export-remove",
}
COUNT_KEYS = {
    "recipes",
    "extract_jobs",
    "cover_jobs",
    "extract_saved",
    "cover_saved",
    "recipe_active",
    "sessions",
    "activities",
    "coach_messages",
    "imports_accepted",
    "workout_active",
    "export_snapshots",
    "export_pages",
}
STAGE_KEYS = {
    "evidence_frames",
    "cover_frames",
    "cover_compare",
    "export_build",
    "export_read",
    "loop_lag",
    "gc_pause",
}
DIAGNOSTIC_KEYS = {
    "loop_samples",
    "loop_max_ms",
    "loop_over100ms",
    "gc_collections",
    "gc_total_ms",
    "gc_max_ms",
    "interval_ms",
}


class SafetyError(RuntimeError):
    pass


def number(value):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not 0 <= value <= 1e18
    ):
        raise SafetyError("invalid_numeric_receipt")
    return value


def verify_context(env, event, commit, host_machine, docker_machine):
    if (
        env.get("GITHUB_ACTIONS") != "true"
        or env.get("GITHUB_REPOSITORY") != REPOSITORY
    ):
        raise SafetyError("untrusted_ci_context")
    if host_machine != "x86_64" or docker_machine not in {"x86_64", "amd64"}:
        raise SafetyError("native_x86_required")
    kind = env.get("GITHUB_EVENT_NAME")
    if kind == "pull_request":
        head = event.get("pull_request", {}).get("head", {})
        if (
            head.get("repo", {}).get("full_name") != REPOSITORY
            or head.get("sha") != commit
        ):
            raise SafetyError("unreviewed_or_foreign_pr")
    elif kind != "workflow_dispatch" or env.get("GITHUB_SHA") != commit:
        raise SafetyError("unsupported_event_or_source")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SafetyError("invalid_source_sha")
    if not all(
        re.fullmatch(r"[0-9]{1,18}", env.get(key, ""))
        for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT")
    ):
        raise SafetyError("invalid_run_identity")
    return f"ci-{env['GITHUB_RUN_ID']}-{env['GITHUB_RUN_ATTEMPT']}"


class Ledger:
    """Records creation intent first; destructive operations recheck exact labels."""

    def __init__(self, file, run_id, command=None):
        self.file = Path(file)
        self.run_id = run_id
        self.command = command or self._command
        self.state = (
            json.loads(self.file.read_text())
            if self.file.exists()
            else {
                "owner": OWNER,
                "run_id": run_id,
                "containers": {},
                "network": None,
                "intents": {},
                "cleaned": False,
            }
        )
        if self.state.get("owner") != OWNER or self.state.get("run_id") != run_id:
            raise SafetyError("foreign_ledger")
        self.save()

    @staticmethod
    def _command(argv, timeout=30):
        completed = subprocess.run(
            argv, check=False, text=True, capture_output=True, timeout=timeout
        )
        if completed.returncode:
            raise SafetyError("docker_command_failed")
        return completed.stdout.strip()

    def save(self):
        self.file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = self.file.with_suffix(".new")
        temporary.write_text(json.dumps(self.state, indent=2) + "\n")
        temporary.chmod(0o600)
        temporary.replace(self.file)

    def inspect(self, identifier, kind="container"):
        if not HEX_ID.fullmatch(identifier):
            raise SafetyError("invalid_resource_id")
        argv = (
            ["docker", "inspect", identifier]
            if kind == "container"
            else ["docker", "network", "inspect", identifier]
        )
        value = json.loads(self.command(argv))[0]
        labels = (
            value.get("Config", {}).get("Labels", {})
            if kind == "container"
            else value.get("Labels", {})
        )
        if (
            value.get("Id") != identifier
            or labels.get("hafa.capacity.owner") != OWNER
            or labels.get("hafa.capacity.run") != self.run_id
        ):
            raise SafetyError("resource_identity_or_owner_changed")
        if kind == "network" and not value.get("Internal"):
            raise SafetyError("external_runtime_network")
        if kind == "container" and value.get("HostConfig", {}).get("PortBindings"):
            raise SafetyError("published_ports_forbidden")
        return value

    def create_container(self, role, argv):
        if self.state["cleaned"] or role in self.state["containers"]:
            raise SafetyError("retired_or_duplicate_creation")
        name = argv[argv.index("--name") + 1]
        if self.command(
            ["docker", "ps", "-a", "--filter", f"name=^/{name}$", "--format", "{{.ID}}"]
        ):
            raise SafetyError("resource_name_exists")
        if role in self.state.get("removed", {}):
            self.state.setdefault("removed_history", []).append(
                self.state["removed"].pop(role)
            )
        sequence = self.state.get("creation_sequence", 0) + 1
        self.state["creation_sequence"] = sequence
        cidfile = self.file.parent / f"{role}-{sequence}.cid"
        self.state["intents"][role] = {"name": name, "cidfile": str(cidfile)}
        self.save()
        command = list(argv)
        if command[:2] != ["docker", "run"]:
            raise SafetyError("explicit_docker_run_required")
        command[1] = "create"
        if "-d" in command:
            command.remove("-d")
        if "--rm" in command:
            command.remove("--rm")
        command[2:2] = ["--cidfile", str(cidfile)]
        try:
            identifier = self.command(command, timeout=60)
        finally:
            # Docker writes this even if its CLI reply is interrupted.
            if cidfile.exists():
                identifier = cidfile.read_text().strip()
                self.inspect(identifier)
                self.state["containers"][role] = identifier
                self.save()
        if role not in self.state["containers"]:
            self.inspect(identifier)
            self.state["containers"][role] = identifier
            self.save()
        self.command(["docker", "start", identifier])
        return identifier

    def create_network(self, name):
        if self.command(
            [
                "docker",
                "network",
                "ls",
                "--filter",
                f"name=^{name}$",
                "--format",
                "{{.ID}}",
            ]
        ):
            raise SafetyError("network_name_exists")
        self.state["network_intent"] = name
        self.save()
        identifier = self.command(
            [
                "docker",
                "network",
                "create",
                "--internal",
                "--label",
                f"hafa.capacity.owner={OWNER}",
                "--label",
                f"hafa.capacity.run={self.run_id}",
                name,
            ]
        )
        self.inspect(identifier, "network")
        self.state["network"] = identifier
        self.save()
        return identifier

    def remove_container(self, role):
        identifier = self.state["containers"][role]
        present = self.command(
            [
                "docker",
                "ps",
                "-a",
                "--filter",
                f"id={identifier}",
                "--format",
                "{{.ID}}",
            ]
        )
        if present:
            info = self.inspect(identifier)
            if info["State"]["Running"]:
                self.command(["docker", "stop", "--timeout", "2", identifier])
            self.inspect(identifier)
            self.command(["docker", "rm", identifier])
        self.state.setdefault("removed", {})[role] = identifier
        del self.state["containers"][role]
        self.save()

    def cleanup(self):
        # Recover an interrupted create reply only from its previously absent,
        # exact named/labelled intent; no broad namespace cleanup.
        for role, intent in self.state["intents"].items():
            if role in self.state["containers"] or role in self.state.get(
                "removed", {}
            ):
                continue
            present = self.command(
                [
                    "docker",
                    "ps",
                    "-a",
                    "--filter",
                    f"name=^/{intent['name']}$",
                    "--format",
                    "{{.ID}}",
                ]
            )
            if present:
                value = json.loads(self.command(["docker", "inspect", intent["name"]]))[
                    0
                ]
                self.inspect(value["Id"])
                self.state["containers"][role] = value["Id"]
        if not self.state.get("network") and self.state.get("network_intent"):
            name = self.state["network_intent"]
            if self.command(
                [
                    "docker",
                    "network",
                    "ls",
                    "--filter",
                    f"name=^{name}$",
                    "--format",
                    "{{.ID}}",
                ]
            ):
                value = json.loads(
                    self.command(["docker", "network", "inspect", name])
                )[0]
                self.inspect(value["Id"], "network")
                self.state["network"] = value["Id"]
        self.save()
        roles = sorted(
            self.state["containers"],
            key=lambda role: {"load": 0, "api": 1, "pg": 10}.get(role, 2),
        )
        for role in roles:
            self.remove_container(role)
        identifier = self.state.get("network")
        if identifier:
            present = self.command(
                [
                    "docker",
                    "network",
                    "ls",
                    "--filter",
                    f"id={identifier}",
                    "--format",
                    "{{.ID}}",
                ]
            )
            if present:
                value = self.inspect(identifier, "network")
                if value.get("Containers"):
                    raise SafetyError("network_not_empty")
                self.command(["docker", "network", "rm", identifier])
            self.state["network"] = None
        self.state["cleaned"] = True
        self.save()


def phase_receipt(report, samples, phase, baseline=None):
    required = READS | BASE_WRITES | {"recipes/job-poll"}
    if phase == "mixed":
        required |= EXTRA_READS | EXTRA_WRITES
    routes, failures = {}, []
    if report.get("percentile_method") != "nearest_rank" or (
        baseline is not None and baseline.get("percentile_method") != "nearest_rank"
    ):
        failures.append("unknown_or_mismatched_percentile_method")
    for route in sorted(required):
        row = report.get("routes", {}).get(route, {})
        statuses = row.get("statuses", {})
        if not statuses or any(not re.fullmatch(r"[0-9]{3}", key) for key in statuses):
            failures.append("missing_route")
        routes[route] = {
            "count": number(row.get("count", 0)),
            "unexpected": number(row.get("unexpected", 0)),
            "p95_ms": number(row["p95_ms"]) if row.get("p95_ms") is not None else None,
            "p99_ms": number(row["p99_ms"]) if row.get("p99_ms") is not None else None,
            "statuses": {key: number(value) for key, value in statuses.items()},
        }
        value = routes[route]
        if not value["count"] or value["unexpected"]:
            failures.append("status_or_count")
        if route in READS and set(statuses) != {"200"}:
            failures.append("protected_non200")
        limit = (
            500 if route in READS | EXTRA_READS or route == "recipes/job-poll" else 1000
        )
        if value["p95_ms"] is None or value["p95_ms"] > limit:
            failures.append("absolute_latency")
        if baseline and route in READS:
            old = baseline["routes"][route]
            if (
                value["p95_ms"] is None
                or value["p99_ms"] is None
                or value["p95_ms"] > old["p95_ms"] * 1.25
                or value["p99_ms"] > old["p99_ms"] * 2
            ):
                failures.append("relative_latency")
    if not report.get("completed") or report.get("failure_type"):
        failures.append("incomplete_traffic")
    if any(row.get("unexpected", 0) for row in report.get("routes", {}).values()):
        failures.append("unexpected_other_route")
    if not samples:
        failures.append("missing_observation")
    peak = max((number(row["memory_peak"]) for row in samples), default=0)
    if peak > 410 * 1024 * 1024 or any(
        row.get("stop_required")
        or row.get("oom")
        or row.get("oom_kill")
        or row.get("protected_5xx")
        for row in samples
    ):
        failures.append("memory_oom_or5xx")
    return {
        "passed": not failures,
        "failure_count": len(failures),
        "peak_bytes": peak,
        "final_bytes": number(samples[-1]["memory_current"]) if samples else None,
        "sample_count": len(samples),
        "cpu_usage_usec": number(samples[-1].get("cpu_stat", {}).get("usage_usec", 0))
        - number(samples[0].get("cpu_stat", {}).get("usage_usec", 0))
        if samples
        else 0,
        "cpu_throttled_usec": number(
            samples[-1].get("cpu_stat", {}).get("throttled_usec", 0)
        )
        - number(samples[0].get("cpu_stat", {}).get("throttled_usec", 0))
        if samples
        else 0,
        "cpu_throttled_periods": number(
            samples[-1].get("cpu_stat", {}).get("nr_throttled", 0)
        )
        - number(samples[0].get("cpu_stat", {}).get("nr_throttled", 0))
        if samples
        else 0,
        "peak_cpu_percent": max(
            (
                number(row.get("docker_stats", {}).get("cpu_percent", 0))
                for row in samples
            ),
            default=0,
        ),
        "peak_process_count": max(
            (number(row.get("docker_stats", {}).get("pids", 0)) for row in samples),
            default=0,
        ),
        "routes": routes,
    }


def public_receipt(summary):
    """Construct from fixed keys; never recursively copy arbitrary private JSON."""
    result = {"schema_version": 1}
    failure = summary.get("failure")
    if failure is not None:
        if (
            not isinstance(failure, dict)
            or not isinstance(failure.get("code"), str)
            or not isinstance(failure.get("phase"), str)
            or failure.get("code") not in CODES
            or failure.get("phase") not in PHASES
        ):
            raise SafetyError("invalid_public_failure")
        result["failure"] = {"code": failure["code"], "phase": failure["phase"]}
    else:
        result["failure"] = None
    for key in (
        "passed",
        "cleaned_owned_resources",
        "render_parity",
        "r04_closed",
        "provider_quality",
        "native_x86",
        "legal_nonjpeg_boundary_tested",
        "longer_repetitions_tested",
        "percentile_nearest_rank",
    ):
        result[key] = summary.get(key) is True
    result["real_provider_calls"] = number(summary.get("real_provider_calls", 0))
    provenance = summary.get("provenance", {})
    result["provenance"] = {}
    for key, pattern in {
        "source_commit": r"[0-9a-f]{40}",
        "image_sha256": r"sha256:[0-9a-f]{64}",
        "requirements_sha": r"[0-9a-f]{64}",
        "python": r"3\.12\.15",
        "architecture": r"x86_64",
        "ffmpeg": r"5\.1\.9-0\+deb12u1",
        "host_kernel": r"[0-9]+(?:\.[0-9]+){1,3}(?:[-.][A-Za-z0-9.-]+)?",
        "docker_version": r"[0-9]+(?:\.[0-9]+){1,3}(?:[-.][A-Za-z0-9.-]+)?",
    }.items():
        if key in provenance:
            if not isinstance(provenance[key], str) or not re.fullmatch(
                pattern, provenance[key]
            ):
                raise SafetyError("invalid_public_provenance")
            result["provenance"][key] = provenance[key]
    if "packages" in provenance:
        allowed = {
            "fastapi",
            "starlette",
            "openai",
            "pydantic",
            "pypdf",
            "pillow",
            "cryptography",
            "sqlalchemy",
            "asyncpg",
            "uvicorn",
        }
        result["provenance"]["packages"] = {}
        for key in allowed:
            value = provenance["packages"].get(key)
            if not isinstance(value, str) or not re.fullmatch(
                r"[0-9]+(?:\.[0-9]+){1,3}", value
            ):
                raise SafetyError("invalid_public_version")
            result["provenance"]["packages"][key] = value
    for key in ("pinned_distribution_count",):
        if key in provenance:
            result["provenance"][key] = number(provenance[key])
    result["phases"] = {}
    for phase in ("baseline", "mixed", "legal"):
        if phase not in summary.get("phases", {}):
            continue
        row = summary["phases"][phase]
        output = {
            key: row.get(key) is True
            for key in (
                "passed",
                "observer_completed",
                "recipe_jobs_drained",
                "workout_jobs_drained",
                "container_oom_killed",
            )
        }
        for key in (
            "failure_count",
            "peak_bytes",
            "final_bytes",
            "sample_count",
            "fresh_recipe_jobs",
            "fresh_recipe_saved_links",
            "accepted_workouts",
            "cpu_usage_usec",
            "cpu_throttled_usec",
            "cpu_throttled_periods",
            "peak_cpu_percent",
            "peak_process_count",
        ):
            if row.get(key) is not None:
                output[key] = number(row[key])
        for key, allowed in (
            ("saved_count_deltas", COUNT_KEYS),
            ("stage_deltas", STAGE_KEYS),
            ("diagnostics", DIAGNOSTIC_KEYS),
            ("provider_attempts", {"extraction", "cover", "chat"}),
        ):
            output[key] = {
                name: number(value)
                for name, value in row.get(key, {}).items()
                if name in allowed
            }
        output["routes"] = {}
        for route in (
            READS | EXTRA_READS | BASE_WRITES | EXTRA_WRITES | {"recipes/job-poll"}
        ):
            if route not in row.get("routes", {}):
                continue
            raw = row["routes"][route]
            clean = {
                key: number(raw[key]) if raw.get(key) is not None else None
                for key in ("count", "unexpected", "p95_ms", "p99_ms")
            }
            clean["statuses"] = {
                key: number(value)
                for key, value in raw.get("statuses", {}).items()
                if re.fullmatch(r"(?:0|[1-5][0-9]{2})", key)
            }
            output["routes"][route] = clean
        timeline = row.get("timeline", {})
        output["timeline"] = {
            "stages": [],
            "slow_liveness": [],
            "observed_stage_count": number(timeline.get("observed_stage_count", 0)),
            "dropped_stage_count": number(timeline.get("dropped_stage_count", 0)),
            "timeline_truncated": timeline.get("timeline_truncated") is True,
        }
        for event in timeline.get("stages", [])[:320]:
            if event.get("stage") not in STAGE_KEYS | {
                "thumbnail_normalize",
                "legal_case",
            } or event.get("event") not in {"start", "end", "failed"}:
                continue
            clean = {"stage": event["stage"], "event": event["event"]}
            for key in (
                "offset_seconds",
                "duration_ms",
                "input_bytes",
                "pixels",
                "case_index",
            ):
                if key in event:
                    clean[key] = number(event[key])
            output["timeline"]["stages"].append(clean)
        for event in timeline.get("slow_liveness", [])[:32]:
            output["timeline"]["slow_liveness"].append(
                {key: number(event[key]) for key in ("offset_seconds", "duration_ms")}
            )
        if phase == "legal":
            from capacity.legal_contract import BOOLEANS, CASES, NUMBERS

            output["cases"] = {}
            for case in CASES:
                if case not in row.get("cases", {}):
                    continue
                raw = row["cases"][case]
                output["cases"][case] = {
                    key: number(raw[key]) for key in NUMBERS if key in raw
                }
                output["cases"][case].update(
                    {key: raw.get(key) is True for key in BOOLEANS}
                )
        result["phases"][phase] = output
    if not result["cleaned_owned_resources"]:
        result["passed"] = False
    return result


def partial_trace_report(path):
    """Recover numeric completed requests after abrupt stop; never mark complete."""
    allowed = READS | EXTRA_READS | BASE_WRITES | EXTRA_WRITES | {"recipes/job-poll"}
    grouped = {}
    if Path(path).exists():
        lines = Path(path).read_text().splitlines()
        for index, line in enumerate(lines):
            try:
                event = json.loads(line)
            except ValueError:
                if index != len(lines) - 1:
                    raise SafetyError("corrupt_request_interior")
                continue
            if (
                event.get("event") not in {"end", "failed"}
                or event.get("route") not in allowed
            ):
                continue
            duration = number(event.get("milliseconds"))
            status = number(event.get("status"))
            if type(status) is not int or not 0 <= status <= 599:
                raise SafetyError("invalid_partial_status")
            grouped.setdefault(event["route"], []).append((duration, status))
    routes = {}
    for route, rows in grouped.items():
        ordered = sorted(duration for duration, _ in rows)
        routes[route] = {
            "count": len(rows),
            "unexpected": sum(status >= 400 or status == 0 for _, status in rows),
            "p95_ms": nearest_rank(ordered, 0.95),
            "p99_ms": nearest_rank(ordered, 0.99),
            "statuses": {
                str(status): sum(value == status for _, value in rows)
                for status in {value for _, value in rows}
            },
        }
    return {
        "completed": False,
        "failure_type": "Interrupted",
        "percentile_method": "nearest_rank",
        "routes": routes,
    }


def numeric_timeline(samples, trace_path):
    """Bounded timestamps and stage enums for overlap diagnosis, never request IDs."""
    origin = samples[0].get("timestamp", 0) if samples else 0
    stages, liveness = [], []
    exports, other_stages = [], []
    stage_total = 0
    for sample in samples:
        for event in sample.get("stages", []):
            if event.get("stage") not in STAGE_KEYS | {
                "thumbnail_normalize",
                "legal_case",
            } or event.get("event") not in {"start", "end", "failed"}:
                continue
            stage_total += 1
            if len(exports) < 256 or len(other_stages) < 64:
                value = {
                    "stage": event["stage"],
                    "event": event["event"],
                    "offset_seconds": number(
                        max(0, event.get("timestamp", origin) - origin)
                    ),
                }
                for key in ("duration_ms", "input_bytes", "pixels", "case_index"):
                    if key in event:
                        value[key] = number(event[key])
                if event["stage"] in {"export_build", "export_read", "legal_case"}:
                    if len(exports) < 256:
                        exports.append(value)
                elif len(other_stages) < 64:
                    other_stages.append(value)
    if Path(trace_path).exists():
        for line in Path(trace_path).read_text().splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if (
                "timestamp" in event
                and event.get("route") == "/up"
                and event.get("event") == "end"
                and event.get("milliseconds", 0) >= 100
                and len(liveness) < 32
            ):
                liveness.append(
                    {
                        "offset_seconds": number(max(0, event["timestamp"] - origin)),
                        "duration_ms": number(event["milliseconds"]),
                    }
                )
    stages = sorted(exports + other_stages, key=lambda item: item["offset_seconds"])
    return {
        "stages": stages,
        "slow_liveness": liveness,
        "observed_stage_count": stage_total,
        "dropped_stage_count": stage_total - len(stages),
        "timeline_truncated": stage_total > len(stages),
    }
