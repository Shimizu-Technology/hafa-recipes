"""Environment drift must refuse before a Docker mutation, without Docker."""

import json
import os
import subprocess
import time

import pytest
from capacity.ci_safety import SafetyError
from capacity.export_jobs_death_binding import (
    selected,
    unselected,
    validate_shape,
    verify_binding,
)
from capacity.export_jobs_death_local import LocalRunner, gate_argv


def fixture():
    binding = {
        "context": "colima-owned",
        "endpoint": "unix:///tmp/owned-docker.sock",
        "daemon_id": "00000000-0000-0000-0000-000000000001",
        "daemon_name": "colima-owned",
    }
    context = {
        "Name": binding["context"],
        "Endpoints": {"docker": {"Host": binding["endpoint"]}},
    }
    daemon = {
        "ID": binding["daemon_id"],
        "Name": binding["daemon_name"],
        "OSType": "linux",
        "Architecture": "aarch64",
    }
    return binding, context, daemon


@pytest.mark.parametrize(
    "endpoint",
    [
        "tcp://remote:2375",
        "ssh://remote",
        "unix://remote/tmp/docker.sock",
        "unix:///tmp/../docker.sock",
        "unix:///tmp/docker.sock?redirect=1",
    ],
)
def test_remote_or_ambiguous_endpoint_is_rejected(endpoint):
    binding, _, _ = fixture()
    with pytest.raises(SafetyError):
        validate_shape({**binding, "endpoint": endpoint})


@pytest.mark.parametrize(
    "drift", ["context", "endpoint", "daemon", "name", "os", "architecture"]
)
def test_observed_environment_drift_is_rejected(drift):
    binding, context, daemon = fixture()
    if drift == "context":
        context["Name"] = "other"
    elif drift == "endpoint":
        context["Endpoints"]["docker"]["Host"] = "unix:///tmp/other.sock"
    else:
        key, value = {
            "daemon": ("ID", "00000000-0000-0000-0000-000000000002"),
            "name": ("Name", "other"),
            "os": ("OSType", "windows"),
            "architecture": ("Architecture", "x86_64"),
        }[drift]
        daemon[key] = value
    with pytest.raises(SafetyError):
        verify_binding(binding, context, daemon)


def test_verified_local_environment_passes_without_name_whitelist():
    verify_binding(*fixture())


def test_context_selection_is_explicit_and_idempotent():
    argv = ["docker", "stop", "owned"]
    pinned = selected(argv, "colima-owned")
    assert pinned == ["docker", "--context", "colima-owned", "stop", "owned"]
    assert selected(pinned, "colima-owned") == pinned
    assert unselected(pinned, "colima-owned") == argv
    with pytest.raises(SafetyError):
        selected(pinned, "other")


def test_runner_checks_binding_then_selects_context_even_if_default_changes(
    monkeypatch,
):
    binding, _, _ = fixture()
    runner = object.__new__(LocalRunner)
    runner.plan, runner.helper = {"docker_binding": binding}, "helper"
    calls = []
    runner.verify_environment = lambda: calls.append("verified")
    runner.raw = lambda argv, timeout=30: calls.append(argv)
    monkeypatch.setenv("DOCKER_CONTEXT", "unrelated-default")
    runner.command(["docker", "rm", "exact-owned-id"])
    assert calls == [
        "verified",
        ["docker", "--context", "colima-owned", "rm", "exact-owned-id"],
    ]


def test_failed_binding_prevents_command_dispatch():
    runner = object.__new__(LocalRunner)
    runner.helper = "helper"

    def changed():
        raise SafetyError("changed daemon")

    runner.verify_environment = changed
    runner.raw = lambda *_: pytest.fail("mutation dispatched")
    with pytest.raises(SafetyError):
        runner.command(["docker", "rm", "exact-owned-id"])


def test_metadata_probes_select_the_same_pinned_context():
    binding, context, daemon = fixture()
    runner = object.__new__(LocalRunner)
    runner.plan = {"docker_binding": binding}
    calls = []

    def raw(argv, timeout=30):
        calls.append(argv)
        return json.dumps(context if "inspect" in argv else daemon)

    runner.raw = raw
    runner.verify_environment()
    assert len(calls) == 2
    assert all(
        argv[:3] == ["docker", "--context", binding["context"]] for argv in calls
    )


def test_gated_plan_command_keeps_explicit_context():
    argv = [
        "docker",
        "--context",
        "colima-owned",
        "run",
        "-d",
        "image",
        "python",
        "-m",
        "helper",
    ]
    gated = gate_argv(argv, "image")
    assert gated[:6] == argv[:6]
    assert gated[-3:] == argv[-3:]


def test_changed_remote_endpoint_refuses_before_daemon_connection():
    binding, context, _ = fixture()
    context["Endpoints"]["docker"]["Host"] = "ssh://remote"
    runner = object.__new__(LocalRunner)
    runner.plan = {"docker_binding": binding}
    calls = []

    def raw(argv, timeout=30):
        calls.append(argv)
        assert "inspect" in argv
        return json.dumps(context)

    runner.raw = raw
    with pytest.raises(SafetyError):
        runner.verify_environment()
    assert len(calls) == 1


def test_helper_release_keeps_scoped_context_after_default_drift(tmp_path, monkeypatch):
    binding, _, _ = fixture()
    runner = object.__new__(LocalRunner)
    runner.repository, runner.output = tmp_path, tmp_path
    runner.plan = {
        "docker_binding": binding,
        "deadlines_seconds": {"whole": 1000, "cleanup": 120},
    }
    runner.started, runner.cleaning = time.monotonic(), time.monotonic()
    monkeypatch.setenv("DOCKER_CONTEXT", "unrelated-default")
    monkeypatch.setenv("DOCKER_HOST", "tcp://remote:2375")
    observed = []

    def run(argv, **kwargs):
        observed.append((argv, kwargs["env"]))
        return subprocess.CompletedProcess(argv, 0, "released", "")

    monkeypatch.setattr(subprocess, "run", run)
    assert (
        runner.raw(["helper", "release", "container", "synthetic-id"], 35) == "released"
    )
    assert observed[0][1]["DOCKER_CONTEXT"] == binding["context"]
    assert "DOCKER_HOST" not in observed[0][1]
    assert os.environ["DOCKER_CONTEXT"] == "unrelated-default"
    assert os.environ["DOCKER_HOST"] == "tcp://remote:2375"
