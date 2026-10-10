"""No Docker/resources: exercise actual CLI selection, fences and interruption."""

import json

import pytest
from capacity import events
from capacity import host_monitor as module

API, PG = "a" * 64, "b" * 64
RUN = "sampler-test"


class Docker:
    def __init__(self):
        self.calls = []
        self.running = True
        self.owner = module.OWNER
        self.current = 300 * 1048576
        self.peak = 350 * 1048576
        self.oom = 0

    def __call__(self, args):
        self.calls.append(args)
        if args[1] == "inspect":
            role = "api" if args[-1] == API else "pg"
            return json.dumps(
                {
                    "id": args[-1],
                    "name": f"/capacity-{role}-{RUN}",
                    "run": RUN,
                    "owner": self.owner,
                    "running": self.running if role == "api" else True,
                    "oom_killed": False,
                    "memory": 512 * 1048576,
                    "memory_swap": 512 * 1048576,
                    "ports": {},
                }
            )
        if args[1] == "stop":
            self.running = False
            return API
        if args[1:4] == ["exec", API, "cat"]:
            return f"{self.current}\n{self.peak}\nlow 0\nhigh 0\nmax 0\noom {self.oom}\noom_kill 0\n"
        if args[1] == "top":
            return "PID PPID RSS COMMAND\n24 0 200000 python\n25 24 96000 ffmpeg\n26 24 12 private-name\n"
        if args[1] == "stats":
            return json.dumps(
                {
                    "ID": API[:12],
                    "CPUPerc": "49.8%",
                    "PIDs": "12",
                    "private": "must not retain",
                }
            )
        if args[1:4] == ["exec", PG, "psql"]:
            return json.dumps(
                {
                    "recipes": [
                        {
                            "job_kind": "extract",
                            "status": "processing",
                            "current_step": "private",
                            "count": 2,
                            "oldest_age_seconds": 15,
                        }
                    ],
                    "workouts": [],
                }
            )
        if args[1] == "logs":
            return "private log must not retain\nCAPACITY_STAGE " + json.dumps(
                {
                    "sequence": 1,
                    "phase": "baseline",
                    "stage": "thumbnail_normalize",
                    "event": "start",
                    "timestamp": 123,
                    "input_bytes": 288911,
                    "private": "never retain",
                }
            )
        raise AssertionError(args)


def monitor(docker):
    return module.HostMonitor(
        {"owner": module.OWNER, "containers": {"api": API, "pg": PG}},
        API,
        PG,
        RUN,
        "baseline",
        runner=docker,
    )


def test_exact_metadata_commands_do_not_run_python_or_read_private_fields():
    docker = Docker()
    target = monitor(docker)
    row = target.snapshot()
    assert row["memory_peak"] == 350 * 1048576
    assert row["queues"]["recipes"][0]["step"] == "other"
    assert row["processes"][-1]["name"] == "other"
    assert row["stages"][0]["input_bytes"] == 288911
    assert "private" not in json.dumps(row)
    assert row["python_observer_inside_api"] is False
    assert row["tiny_exec_overhead_included"] is True
    assert ["docker", "top", API, "-eo", "pid,ppid,rss,comm"] in docker.calls
    assert all(
        "python" not in command and "environ" not in str(command)
        for command in docker.calls
    )
    assert not target.snapshot()["stages"]  # overlapping log interval is deduplicated


@pytest.mark.parametrize("gate", ["current", "peak", "oom"])
def test_gate_stops_exact_owned_api_before_slower_auxiliary_queries(gate):
    docker = Docker()
    if gate == "oom":
        docker.oom = 1
    else:
        setattr(docker, gate, 460 * 1048576)
    row = monitor(docker).snapshot()
    assert row["stopped"] and row["stop_required"]
    assert ["docker", "stop", "--timeout", "2", API] in docker.calls
    assert not any(c[1] in {"stats", "top", "logs"} for c in docker.calls)
    assert not any(c[1] == "stop" and c[-1] == PG for c in docker.calls)


def test_wrong_owner_rejected_without_probe_or_stop():
    docker = Docker()
    docker.owner = "root"
    with pytest.raises(module.MonitorError, match="label_mismatch"):
        monitor(docker).snapshot()
    assert all(c[1] == "inspect" for c in docker.calls)
    with pytest.raises(module.MonitorError, match="invalid_target"):
        module.HostMonitor(
            {"owner": module.OWNER, "containers": {}},
            API[:12],
            PG,
            RUN,
            "baseline",
            docker,
        )
    with pytest.raises(module.MonitorError, match="target_not_owned"):
        module.HostMonitor(
            {"owner": "root", "containers": {"api": API, "pg": PG}},
            API,
            PG,
            RUN,
            "baseline",
            docker,
        )


def test_interrupted_numeric_report_retained_and_private_error_excluded(tmp_path):
    docker = Docker()
    target = monitor(docker)

    def interrupt(_):
        raise KeyboardInterrupt("private detail")

    output = tmp_path / "external.jsonl"
    with pytest.raises(KeyboardInterrupt):
        module.run_monitor(target, output, seconds=1, interval=0.5, sleeper=interrupt)
    summary = json.loads((tmp_path / "external.jsonl.summary.json").read_text())
    assert summary["samples"] == 1 and summary["completed"] is False
    assert (
        summary["local_memory_gate"] == "failed"
        and summary["failure_type"] == "KeyboardInterrupt"
    )
    assert (
        summary["stop_bytes"] == 460 * 1048576
        and summary["pass_peak_bytes"] == 410 * 1048576
    )
    assert "private" not in json.dumps(summary) and not docker.running
    with pytest.raises(FileExistsError):
        module.run_monitor(target, output, 1, 0.5)


def test_invalid_cgroup_and_nonfinite_queue_metadata_fail_closed():
    with pytest.raises(module.MonitorError):
        module.cgroup("100\n200\noom 0\n")
    with pytest.raises(module.MonitorError):
        module.numeric(float("nan"))
    with pytest.raises(module.MonitorError):
        module.numeric(float("inf"))
    with pytest.raises(module.MonitorError):
        module.statistics(
            json.dumps({"ID": "c" * 12, "CPUPerc": "1%", "PIDs": "1"}), API
        )


def test_repeated_protected_5xx_stop_ignores_private_access_urls():
    docker = Docker()

    def runner(args):
        if args[1] == "logs":
            return "\n".join(
                f'2026-10-10T01:00:0{n}.000000000Z INFO: private-ip - "GET /api/recipes/private-id?private-query HTTP/1.1" 500 Internal Server Error'
                for n in range(3)
            )
        return docker(args)

    row = monitor(docker)
    row.runner = runner
    sample = row.snapshot()
    assert sample["protected_5xx"] == 3 and sample["stop_reason"] == "protected_5xx"
    assert sample["stopped"] and "private" not in json.dumps(sample)


async def test_stage_wrapper_preserves_results_cancellation_and_excludes_inputs(capsys):
    import asyncio

    sentinel = object()

    async def original(*args, **kwargs):
        return sentinel

    wrapped = events.traced(
        "cover_compare", "baseline", original, lambda *a, **k: {"input_bytes": 20}
    )
    assert await wrapped("private-url", secret="private") is sentinel
    lines = capsys.readouterr().out
    assert "private" not in lines and "start" in lines and "end" in lines

    async def cancelled(*a, **k):
        raise asyncio.CancelledError("private")

    with pytest.raises(asyncio.CancelledError):
        await events.traced("cover_frames", "baseline", cancelled)("private")
    output = capsys.readouterr().out
    assert "failed" in output and "private" not in output
    with pytest.raises(ValueError):
        events.emit("cover_frames", "baseline", "start", url="private")
