"""Finite ownership/receipt regressions; no Docker, providers or runtime traffic."""

import json
from pathlib import Path

import pytest
from capacity.ci_safety import (
    BASE_WRITES,
    EXTRA_READS,
    EXTRA_WRITES,
    OWNER,
    READS,
    Ledger,
    SafetyError,
    phase_receipt,
    public_receipt,
    verify_context,
)

RUN = "ci-123-1"
SHA = "a" * 40


def context():
    return {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": "Shimizu-Technology/hafa-recipes",
        "GITHUB_EVENT_NAME": "pull_request",
        "GITHUB_RUN_ID": "123",
        "GITHUB_RUN_ATTEMPT": "1",
    }


def test_context_requires_exact_same_repo_head_native_host_and_safe_event():
    event = {
        "pull_request": {
            "head": {
                "sha": SHA,
                "repo": {"full_name": "Shimizu-Technology/hafa-recipes"},
            }
        }
    }
    assert verify_context(context(), event, SHA, "x86_64", "x86_64") == RUN
    for env, payload, host, docker in [
        (
            {**context(), "GITHUB_EVENT_NAME": "pull_request_target"},
            event,
            "x86_64",
            "amd64",
        ),
        (
            context(),
            {
                "pull_request": {
                    "head": {"sha": SHA, "repo": {"full_name": "foreign/fork"}}
                }
            },
            "x86_64",
            "amd64",
        ),
        (context(), event, "arm64", "amd64"),
        (context(), event, "x86_64", "aarch64"),
        ({**context(), "GITHUB_RUN_ID": "123;command"}, event, "x86_64", "amd64"),
    ]:
        with pytest.raises(SafetyError):
            verify_context(env, payload, SHA, host, docker)
    with pytest.raises(SafetyError):
        verify_context(context(), event, "b" * 40, "x86_64", "amd64")


class Docker:
    def __init__(self):
        self.resources = {}
        self.calls = []
        self.sequence = 0
        self.lose_reply = False

    def __call__(self, args, timeout=30):
        self.calls.append(args)
        if args[1:3] == ["network", "ls"]:
            return ""
        if args[1] == "ps":
            condition = args[args.index("--filter") + 1]
            if condition.startswith("id="):
                return condition[3 : 12 + 3] if condition[3:] in self.resources else ""
            return ""
        if args[1] == "create":
            self.sequence += 1
            identifier = f"{self.sequence:064x}"
            name = args[args.index("--name") + 1]
            self.resources[identifier] = {
                "Id": identifier,
                "Name": name,
                "Config": {
                    "Labels": {"hafa.capacity.owner": OWNER, "hafa.capacity.run": RUN}
                },
                "HostConfig": {"PortBindings": {}},
                "State": {"Running": False},
            }
            Path(args[args.index("--cidfile") + 1]).write_text(identifier)
            if self.lose_reply:
                raise SafetyError("lost_cli_reply")
            return identifier
        if args[1] == "inspect":
            return json.dumps([self.resources[args[-1]]])
        if args[1] == "start":
            self.resources[args[-1]]["State"]["Running"] = True
            return args[-1]
        if args[1] == "stop":
            self.resources[args[-1]]["State"]["Running"] = False
            return args[-1]
        if args[1] == "rm":
            del self.resources[args[-1]]
            return args[-1]
        raise AssertionError(args)


def create_args():
    return [
        "docker",
        "run",
        "-d",
        "--name",
        f"capacity-api-{RUN}",
        "--label",
        f"hafa.capacity.owner={OWNER}",
        "--label",
        f"hafa.capacity.run={RUN}",
        "fixture-image",
    ]


def test_lost_create_reply_records_exact_owned_id_and_cleans_only_that(tmp_path):
    docker = Docker()
    docker.lose_reply = True
    ledger = Ledger(tmp_path / "resources.json", RUN, docker)
    with pytest.raises(SafetyError, match="lost_cli"):
        ledger.create_container("api", create_args())
    assert len(ledger.state["containers"]) == 1
    ledger.cleanup()
    assert not docker.resources and ledger.state["cleaned"]
    assert not any("prune" in call or "rm -rf" in call for call in docker.calls)


def test_foreign_label_after_creation_refuses_destructive_cleanup(tmp_path):
    docker = Docker()
    ledger = Ledger(tmp_path / "resources.json", RUN, docker)
    identifier = ledger.create_container("api", create_args())
    docker.resources[identifier]["Config"]["Labels"]["hafa.capacity.owner"] = "borrowed"
    with pytest.raises(SafetyError, match="owner_changed"):
        ledger.cleanup()
    assert identifier in docker.resources
    assert not any(call[1] in {"stop", "rm"} for call in docker.calls)


def test_api_recreation_has_new_cidfile_and_preserves_other_ledger_resources(tmp_path):
    docker = Docker()
    ledger = Ledger(tmp_path / "resources.json", RUN, docker)
    first = ledger.create_container("api", create_args())
    ledger.remove_container("api")
    second = ledger.create_container("api", create_args())
    assert first != second and len(list(tmp_path.glob("api-*.cid"))) == 2
    assert first in ledger.state["removed_history"]
    ledger.cleanup()


def test_cleanup_resumes_when_remove_succeeded_before_ledger_write(tmp_path):
    docker = Docker()
    ledger = Ledger(tmp_path / "resources.json", RUN, docker)
    identifier = ledger.create_container("api", create_args())
    del docker.resources[identifier]  # rm succeeded; simulated crash before save
    ledger.cleanup()
    assert ledger.state["cleaned"] and not ledger.state["containers"]


def healthy_report(phase="mixed"):
    labels = READS | BASE_WRITES | {"recipes/job-poll"}
    if phase == "mixed":
        labels |= EXTRA_READS | EXTRA_WRITES
    return {
        "completed": True,
        "percentile_method": "nearest_rank",
        "failure_type": None,
        "routes": {
            label: {
                "count": 5,
                "unexpected": 0,
                "p95_ms": 100,
                "p99_ms": 150,
                "statuses": {"200": 5},
            }
            for label in labels
        },
    }


def samples():
    return [
        {
            "memory_peak": 300 * 2**20,
            "memory_current": 220 * 2**20,
            "stop_required": False,
            "oom": 0,
            "oom_kill": 0,
            "protected_5xx": 0,
        }
    ]


def test_export_build_has_no_latency_exemption_and_relative_up_stall_fails():
    baseline = healthy_report("baseline")
    report = healthy_report()
    assert phase_receipt(report, samples(), "mixed", baseline)["passed"]
    report["routes"]["workouts/export-build"]["p95_ms"] = 6800
    assert not phase_receipt(report, samples(), "mixed", baseline)["passed"]
    report = healthy_report()
    report["routes"]["/up"]["p95_ms"] = 440
    assert not phase_receipt(report, samples(), "mixed", baseline)["passed"]
    del report["routes"]["recipes/detail"]
    assert not phase_receipt(report, samples(), "mixed", baseline)["passed"]


def test_receipt_discards_payload_ids_unknown_routes_and_rejects_nonfinite():
    private = "private-health-token-http://private.example"
    summary = {
        "passed": True,
        "cleaned_owned_resources": True,
        "account_id": private,
        "provenance": {
            "source_commit": SHA,
            "image_sha256": "sha256:" + "b" * 64,
            "unknown": private,
        },
        "phases": {
            "mixed": {
                "passed": True,
                "routes": {
                    "/up": {
                        "count": 1,
                        "unexpected": 0,
                        "p95_ms": 20,
                        "p99_ms": 20,
                        "statuses": {"200": 1},
                        "body": private,
                    },
                    private: {"count": 1},
                },
                "diagnostics": {"loop_samples": 10, "health": private},
                "provider_attempts": {"extraction": 5, "account": private},
            }
        },
    }
    clean = public_receipt(summary)
    assert private not in json.dumps(clean) and clean["passed"]
    assert clean["provenance"]["image_sha256"].startswith("sha256:")
    summary["phases"]["mixed"]["routes"]["/up"]["p95_ms"] = float("nan")
    with pytest.raises(SafetyError):
        public_receipt(summary)

    summary["provenance"]["source_commit"] = private
    with pytest.raises(SafetyError):
        public_receipt(summary)


def test_partial_numeric_trace_stays_failed_and_excludes_private_fields(tmp_path):
    from capacity.ci_safety import partial_trace_report

    path = tmp_path / "requests.jsonl"
    path.write_text(
        json.dumps(
            {
                "event": "end",
                "timestamp": 1000,
                "route": "/up",
                "status": 200,
                "milliseconds": 440,
                "body": "private health",
                "account_id": "private-id",
            }
        )
        + "\n"
        + '{"truncated":'
    )
    report = partial_trace_report(path)
    assert not report["completed"] and report["routes"]["/up"]["p95_ms"] == 440
    assert "private" not in json.dumps(report)
    assert not phase_receipt(report, samples(), "baseline")["passed"]


def test_cleanup_commands_keep_a_budget_after_work_deadline(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from capacity.ci_run import Coordinator

    coordinator = Coordinator(tmp_path, tmp_path / "work", tmp_path / "receipt.json")
    coordinator.started = 0
    monkeypatch.setattr("capacity.ci_run.time.monotonic", lambda: 2000)
    called = []

    def run(argv, **kwargs):
        called.append(kwargs["timeout"])
        return SimpleNamespace(returncode=0, stdout="ok")

    monkeypatch.setattr("capacity.ci_run.subprocess.run", run)
    with pytest.raises(SafetyError, match="whole_experiment"):
        coordinator.command(["docker", "inspect", "synthetic"])
    coordinator.cleaning_started = 1950
    assert coordinator.command(["docker", "inspect", "synthetic"]) == "ok"
    assert called == [30]


def test_api_flags_and_separate_loader_never_inherit_host_credentials(tmp_path):
    from capacity.ci_run import Coordinator

    coordinator = Coordinator(
        tmp_path,
        tmp_path / "work",
        tmp_path / "receipt.json",
        env={"OPENAI_API_KEY": "never inherit", "GITHUB_TOKEN": "never inherit"},
    )
    coordinator.run_id = RUN
    coordinator.pg = "b" * 64
    coordinator.plan_root = tmp_path / "plan"
    api = coordinator.runtime_argv("api", phase="mixed")
    load = coordinator.runtime_argv("load")
    assert api[api.index("--memory") + 1] == "512m"
    assert api[api.index("--memory-swap") + 1] == "512m"
    assert api[api.index("--cpus") + 1] == "0.5"
    assert "WORKOUTS_API_ENABLED=true" in api and "CAPACITY_PHASE=mixed" in api
    assert "--memory" not in load and "never inherit" not in " ".join(api + load)
    assert "--publish" not in api and "--privileged" not in api


def test_partial_phase_survives_truncated_report_and_observation_tail(tmp_path):
    from capacity.ci_run import Coordinator

    coordinator = Coordinator(tmp_path, tmp_path / "work", tmp_path / "receipt.json")
    coordinator.active_phase = "mixed"
    coordinator.plan_root = tmp_path / "plan"
    result = coordinator.plan_root / "results"
    result.mkdir(parents=True)
    (result / "mixed.json").write_text('{"interrupted":')
    (result / "mixed.json.requests.jsonl").write_text(
        json.dumps({"event": "end", "route": "/up", "status": 200, "milliseconds": 440})
        + "\n"
    )
    (result / "mixed-external.jsonl").write_text(
        json.dumps(samples()[0]) + '\n{"partial":'
    )
    coordinator.capture_partial()
    phase = coordinator.summary["phases"]["mixed"]
    assert not phase["passed"] and phase["sample_count"] == 1
    assert phase["routes"]["/up"]["count"] == 1


def test_cleanup_deadline_is_not_reset_by_second_cleanup(tmp_path, monkeypatch):
    from capacity.ci_run import Coordinator

    coordinator = Coordinator(tmp_path, tmp_path / "work", tmp_path / "receipt.json")
    coordinator.cleaning_started = 100
    monkeypatch.setattr("capacity.ci_run.time.monotonic", lambda: 200)
    coordinator.cleanup()
    assert coordinator.cleaning_started == 100
    monkeypatch.setattr("capacity.ci_run.time.monotonic", lambda: 221)
    with pytest.raises(SafetyError, match="whole_experiment_deadline"):
        coordinator.command(["docker", "inspect", "synthetic"])


def test_timeline_reserves_export_windows_and_discloses_truncation(tmp_path):
    from capacity.ci_safety import numeric_timeline

    events = [
        {"stage": "loop_lag", "event": "end", "timestamp": i, "duration_ms": 20}
        for i in range(200)
    ]
    events += [
        {"stage": "export_build", "event": "start", "timestamp": 201},
        {
            "stage": "export_build",
            "event": "end",
            "timestamp": 208,
            "duration_ms": 7000,
        },
    ]
    value = numeric_timeline([{"timestamp": 0, "stages": events}], tmp_path / "absent")
    assert value["timeline_truncated"] and value["dropped_stage_count"] == 136
    assert sum(event["stage"] == "export_build" for event in value["stages"]) == 2
