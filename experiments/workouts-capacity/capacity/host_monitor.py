"""Host-only Docker observation; no Python observer inside the API cgroup."""

import argparse
import json
import math
import re
import subprocess
import time
from pathlib import Path

OWNER = "native_health_preflight"
PASS_BYTES = 410 * 1024 * 1024
STOP_BYTES = 460 * 1024 * 1024
HEX_ID = re.compile(r"[0-9a-f]{64}")
RUN_ID = re.compile(r"[a-z0-9-]{1,40}")
PHASES = {"baseline", "mixed", "boundaries", "diagnostic"}
STAGES = {"thumbnail_normalize", "cover_compare", "cover_frames", "evidence_frames"}
STEPS = {
    "queued",
    "initializing",
    "fetching_metadata",
    "fetching_video",
    "fetching_audio",
    "transcribing",
    "extracting",
    "extracting_frames",
    "analyzing",
    "saving",
    "completed",
    "failed",
    "processing",
    "reviewing",
    "fetching_images",
    "downloading_images",
}
STATUSES = {
    "queued",
    "processing",
    "completed",
    "failed",
    "expired",
    "cancelled",
    "superseded",
    "ready",
    "incomplete",
    "accepted",
}
PROCESS_NAMES = {
    "python",
    "python3",
    "python3.12",
    "ffmpeg",
    "ffprobe",
    "cat",
    "sh",
    "ps",
    "qemu-x86_64",
}

INSPECT = """{"id":{{json .Id}},"image":{{json .Image}},"name":{{json .Name}},"run":{{json (index .Config.Labels "hafa.capacity.run")}},"owner":{{json (index .Config.Labels "hafa.capacity.owner")}},"running":{{json .State.Running}},"oom_killed":{{json .State.OOMKilled}},"memory":{{.HostConfig.Memory}},"memory_swap":{{.HostConfig.MemorySwap}},"ports":{{json .HostConfig.PortBindings}}}"""
QUEUE_SQL = """SELECT json_build_object('recipes',COALESCE((SELECT json_agg(t) FROM (SELECT job_kind,status,current_step,count(*) AS count,GREATEST(0,EXTRACT(EPOCH FROM (now()-MIN(created_at))))::float AS oldest_age_seconds FROM extraction_jobs GROUP BY job_kind,status,current_step ORDER BY job_kind,status,current_step LIMIT 32) t),'[]'::json),'workouts',COALESCE((SELECT json_agg(t) FROM (SELECT status,count(*) AS count,GREATEST(0,EXTRACT(EPOCH FROM (now()-MIN(created_at))))::float AS oldest_age_seconds FROM workouts_import_jobs GROUP BY status ORDER BY status LIMIT 16) t),'[]'::json));"""


class MonitorError(RuntimeError):
    """Only fixed codes cross the report boundary, never subprocess diagnostics."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def execute(argv):
    try:
        result = subprocess.run(
            argv, check=False, capture_output=True, text=True, timeout=5
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise MonitorError("docker_probe_unavailable") from exc
    if result.returncode or len(result.stdout.encode()) > 1024 * 1024:
        raise MonitorError("docker_probe_failed")
    return result.stdout


def numeric(value):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
        or value > 1e18
    ):
        raise MonitorError("invalid_numeric_metadata")
    return value


def cgroup(raw):
    lines = raw.splitlines()
    if len(lines) < 4 or not all(v.isdecimal() for v in lines[:2]):
        raise MonitorError("invalid_cgroup_metadata")
    events = {}
    for line in lines[2:]:
        fields = line.split()
        if len(fields) != 2 or not fields[1].isdecimal():
            raise MonitorError("invalid_cgroup_metadata")
        if fields[0] in {"oom", "oom_kill", "high", "max"}:
            events[fields[0]] = int(fields[1])
    if not {"oom", "oom_kill"} <= events.keys():
        raise MonitorError("missing_oom_events")
    return {"memory_current": int(lines[0]), "memory_peak": int(lines[1]), **events}


def processes(raw):
    rows = []
    for line in raw.splitlines()[1:]:
        cells = line.split()
        if len(cells) != 4 or not all(s.isdecimal() for s in cells[:3]):
            raise MonitorError("invalid_process_metadata")
        rows.append(
            {
                "pid": int(cells[0]),
                "parent": int(cells[1]),
                "rss_kib": int(cells[2]),
                "name": cells[3] if cells[3] in PROCESS_NAMES else "other",
            }
        )
    return rows


def statistics(raw, identifier):
    value = json.loads(raw)
    short = value.get("ID", "")
    if not re.fullmatch(r"[0-9a-f]{12,64}", short) or not identifier.startswith(short):
        raise MonitorError("stats_identity_mismatch")
    cpu = value.get("CPUPerc", "").removesuffix("%")
    if not re.fullmatch(r"\d+(?:\.\d+)?", cpu):
        raise MonitorError("invalid_cpu_metadata")
    # Docker working-set memory differs from raw cgroup accounting; do not use it
    # for pass/stop. Retain only numeric CPU/PID data from its otherwise rich JSON.
    return {"cpu_percent": numeric(float(cpu)), "pids": numeric(int(value["PIDs"]))}


def queues(raw):
    value = json.loads(raw)
    result = {}
    for domain in ("recipes", "workouts"):
        rows = value.get(domain)
        if not isinstance(rows, list) or len(rows) > 32:
            raise MonitorError("invalid_queue_metadata")
        result[domain] = []
        for row in rows:
            result[domain].append(
                {
                    "kind": row.get("job_kind")
                    if row.get("job_kind") in {"cover", "extract"}
                    else "other",
                    "status": row.get("status")
                    if row.get("status") in STATUSES
                    else "other",
                    "step": row.get("current_step")
                    if row.get("current_step") in STEPS
                    else "other",
                    "count": numeric(row.get("count")),
                    "oldest_age_seconds": numeric(row.get("oldest_age_seconds")),
                }
            )
    return result


class HostMonitor:
    def __init__(self, ledger, api_id, pg_id, run_id, phase, runner=execute):
        if (
            not HEX_ID.fullmatch(api_id)
            or not HEX_ID.fullmatch(pg_id)
            or not RUN_ID.fullmatch(run_id)
            or phase not in PHASES
        ):
            raise MonitorError("invalid_target")
        if (
            ledger.get("owner") != OWNER
            or ledger.get("cleaned")
            or api_id not in ledger.get("containers", {}).values()
            or pg_id not in ledger.get("containers", {}).values()
        ):
            raise MonitorError("target_not_owned")
        self.api, self.pg, self.run_id, self.phase, self.runner = (
            api_id,
            pg_id,
            run_id,
            phase,
            runner,
        )
        self.last_event = 0
        self.last_http_stamp = ""
        self.protected_5xx = 0

    def validate(self, identifier, role, running=True):
        value = json.loads(
            self.runner(["docker", "inspect", "--format", INSPECT, identifier])
        )
        if (
            value.get("id") != identifier
            or value.get("owner") != OWNER
            or value.get("run") != self.run_id
            or value.get("name") != f"/capacity-{role}-{self.run_id}"
            or value.get("ports")
        ):
            raise MonitorError("target_identity_or_label_mismatch")
        if role == "api" and (
            value.get("memory") != 512 * 1024 * 1024
            or value.get("memory_swap") != 512 * 1024 * 1024
        ):
            raise MonitorError("api_budget_mismatch")
        if running and not value.get("running"):
            raise MonitorError("target_not_running")
        return value

    def stop(self):
        value = self.validate(self.api, "api", running=False)
        if value["running"]:
            self.runner(["docker", "stop", "--timeout", "2", self.api])
            if self.validate(self.api, "api", running=False)["running"]:
                raise MonitorError("stop_not_confirmed")

    def snapshot(self):
        before = time.time()
        identity = self.validate(self.api, "api", running=False)
        if not identity["running"]:
            raise MonitorError(
                "api_oom_exit" if identity["oom_killed"] else "api_not_running"
            )
        self.validate(self.pg, "pg")
        memory = cgroup(
            self.runner(
                [
                    "docker",
                    "exec",
                    self.api,
                    "cat",
                    "/sys/fs/cgroup/memory.current",
                    "/sys/fs/cgroup/memory.peak",
                    "/sys/fs/cgroup/memory.events",
                ]
            )
        )
        # Observe/stop before slower auxiliary queries can delay the memory gate.
        stop = (
            max(memory["memory_current"], memory["memory_peak"]) >= STOP_BYTES
            or memory["oom"] > 0
            or memory["oom_kill"] > 0
            or identity["oom_killed"]
        )
        result = {
            "timestamp": before,
            "phase": self.phase,
            **memory,
            "stop_required": stop,
            "observer": "host_docker",
            "tiny_exec_overhead_included": True,
            "python_observer_inside_api": False,
        }
        if stop:
            self.stop()
            result.update(
                stopped=True,
                stop_reason="memory_or_oom_stop",
                probe_finished_at=time.time(),
            )
            return result
        result["processes"] = processes(
            self.runner(["docker", "top", self.api, "-eo", "pid,ppid,rss,comm"])
        )
        result["process_pid_namespace"] = "docker_host_vm"
        result["docker_stats"] = statistics(
            self.runner(
                ["docker", "stats", "--no-stream", "--format", "{{json .}}", self.api]
            ),
            self.api,
        )
        try:
            result["queues"] = queues(
                self.runner(
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
                        QUEUE_SQL,
                    ]
                )
            )
        except MonitorError as exc:
            result["queue_probe_error"] = exc.code
        events = []
        raw = self.runner(
            [
                "docker",
                "logs",
                "--timestamps",
                "--tail",
                "200",
                "--since",
                str(max(0, before - 5)),
                self.api,
            ]
        )
        for line in raw.splitlines():
            # Docker supplies a timestamp even for ordinary access records. Keep
            # only a count, never the URL/IP/request identifier from that record.
            stamp, separator, message = line.partition(" ")
            if separator and re.fullmatch(r"\d{4}-\d{2}-\d{2}T[0-9:.]+Z", stamp):
                line = message
                if 'HTTP/1.1"' in line and stamp > self.last_http_stamp:
                    if re.search(
                        r'"(?:GET|POST|PUT|DELETE) /(?:api/recipes|api/extract|up)[^ ]* HTTP/1.1" 5\d\d ',
                        line,
                    ):
                        self.protected_5xx += 1
                    self.last_http_stamp = stamp
            if not line.startswith("CAPACITY_STAGE "):
                continue
            try:
                event = json.loads(line.removeprefix("CAPACITY_STAGE "))
                sequence = numeric(event["sequence"])
                if (
                    sequence <= self.last_event
                    or event.get("phase") != self.phase
                    or event.get("stage") not in STAGES
                    or event.get("event") not in {"start", "end", "failed"}
                ):
                    continue
                filtered = {
                    "sequence": sequence,
                    "stage": event["stage"],
                    "event": event["event"],
                    "timestamp": numeric(event["timestamp"]),
                }
                for key in ("duration_ms", "input_bytes", "pixels"):
                    if key in event:
                        filtered[key] = numeric(event[key])
                events.append(filtered)
                self.last_event = sequence
            except (ValueError, KeyError, TypeError, MonitorError):
                continue
        result.update(stages=events, probe_finished_at=time.time())
        result["protected_5xx"] = self.protected_5xx
        if self.protected_5xx >= 3:
            self.stop()
            result.update(stop_required=True, stopped=True, stop_reason="protected_5xx")
        return result


def run_monitor(monitor, output, seconds, interval, sleeper=time.sleep):
    if not 1 <= seconds <= 7200 or not 0.5 <= interval <= 10:
        raise MonitorError("invalid_duration")
    output = Path(output)
    summary = {
        "completed": False,
        "phase": monitor.phase,
        "observer": "host_docker",
        "r04_closed": False,
        "pass_peak_bytes": PASS_BYTES,
        "stop_bytes": STOP_BYTES,
        "samples": 0,
        "peak_bytes": None,
        "failure_type": None,
        "failure_code": None,
    }
    deadline = time.monotonic() + seconds
    # Never overwrite the failed historical run or another phase's evidence.
    with output.open("x") as stream:
        try:
            while time.monotonic() < deadline:
                value = monitor.snapshot()
                stream.write(json.dumps(value) + "\n")
                stream.flush()
                summary["samples"] += 1
                summary["peak_bytes"] = max(
                    summary["peak_bytes"] or 0, value["memory_peak"]
                )
                if value["stop_required"]:
                    summary["failure_code"] = value.get(
                        "stop_reason", "memory_or_oom_stop"
                    )
                    return summary
                sleeper(interval)
            summary["completed"] = True
            return summary
        except BaseException as exc:
            summary["failure_type"] = type(exc).__name__
            summary["failure_code"] = (
                exc.code if isinstance(exc, MonitorError) else "interrupted_monitor"
            )
            # No trusted numeric observer remains; fail closed only on a target
            # whose immutable identity and ownership still validate.
            try:
                monitor.stop()
            except MonitorError:
                summary["stop_unconfirmed"] = True
            raise
        finally:
            summary["local_memory_gate"] = (
                "failed"
                if summary["failure_code"] or (summary["peak_bytes"] or 0) > PASS_BYTES
                else "passed"
                if summary["completed"]
                else "blocked"
            )
            output.with_suffix(output.suffix + ".summary.json").write_text(
                json.dumps(summary, indent=2) + "\n"
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for field in ("ledger", "api-id", "pg-id", "run-id", "phase", "output"):
        parser.add_argument("--" + field, required=True)
    parser.add_argument("--seconds", type=int, default=450)
    parser.add_argument("--interval", type=float, default=0.5)
    args = parser.parse_args()
    monitor = HostMonitor(
        json.loads(Path(args.ledger).read_text()),
        args.api_id,
        args.pg_id,
        args.run_id,
        args.phase,
    )
    report = run_monitor(monitor, args.output, args.seconds, args.interval)
    print(json.dumps(report))
    raise SystemExit(2 if report["local_memory_gate"] == "failed" else 0)
