"""Real finalization flow with controlled Docker replies; no runtime resources."""

import asyncio
import json
import subprocess
from types import SimpleNamespace

import pytest
from capacity.ci_run import Coordinator, execute, finish
from capacity.ci_safety import SafetyError

PRIVATE = "private-owner-token-http://private.invalid"


def coordinator(tmp_path):
    instance = Coordinator(tmp_path, tmp_path / "work", tmp_path / "receipt.json")
    instance.run = lambda: instance.summary.update(passed=True)
    return instance


@pytest.mark.parametrize(
    "error,code",
    [
        (
            subprocess.TimeoutExpired(["docker", "stop", PRIVATE], 30),
            "finite_command_timeout",
        ),
        (KeyboardInterrupt(PRIVATE), "interrupted"),
        (asyncio.CancelledError(PRIVATE), "partial_evidence_failed"),
    ],
)
@pytest.mark.parametrize("prior_failure", [False, True])
def test_actual_stop_traffic_exception_still_captures_cleans_and_writes_safe_receipt(
    tmp_path, monkeypatch, error, code, prior_failure
):
    instance = coordinator(tmp_path)
    calls = []
    state = {"containers": {"load": PRIVATE}}
    instance.ledger = SimpleNamespace(
        state=state,
        save=lambda: calls.append("persist"),
        inspect=lambda _: {"State": {"Running": True}},
        cleanup=lambda: calls.append("targeted_cleanup"),
    )

    def docker_hang(argv, **kwargs):
        assert argv == ["docker", "stop", "--timeout", "2", PRIVATE]
        calls.append("stop_traffic")
        raise error

    monkeypatch.setattr("capacity.ci_run.subprocess.run", docker_hang)
    instance.capture_partial = lambda: calls.append("partial")
    if prior_failure:
        instance.run = lambda: (_ for _ in ()).throw(
            SafetyError("api_startup_deadline")
        )
    assert execute(instance) == 2
    assert calls == ["persist", "stop_traffic", "partial", "targeted_cleanup"]
    receipt = json.loads(instance.receipt.read_text())
    assert not receipt["passed"] and receipt["cleaned_owned_resources"]
    assert receipt["failure"] == {
        "code": "api_startup_deadline" if prior_failure else code,
        "phase": "setup" if prior_failure else "finalization",
    }
    assert PRIVATE not in instance.receipt.read_text()


def test_failed_deadline_persistence_never_resets_budget_or_skips_cleanup(
    tmp_path, monkeypatch
):
    instance = coordinator(tmp_path)
    calls = []
    monkeypatch.setattr("capacity.ci_run.time.monotonic", lambda: 2000)

    def persistence_failure():
        raise KeyboardInterrupt(PRIVATE)

    instance.ledger = SimpleNamespace(
        state={"containers": {}, "finalization_started": 1950},
        save=persistence_failure,
        cleanup=lambda: calls.append("cleanup"),
    )
    assert execute(instance) == 2
    assert instance.cleaning_started == 1950
    assert calls == ["cleanup"]
    finish(instance)
    assert instance.cleaning_started == 1950  # A second cleanup cannot buy 120s again.
    monkeypatch.setattr("capacity.ci_run.time.monotonic", lambda: 2071)
    with pytest.raises(SafetyError, match="whole_experiment_deadline"):
        instance.command(["docker", "inspect", PRIVATE])


@pytest.mark.parametrize("stage", ["capture_partial", "cleanup"])
def test_interrupted_capture_or_cleanup_produces_failed_receipt(tmp_path, stage):
    instance = coordinator(tmp_path)
    calls = []

    def fail():
        calls.append(stage)
        raise KeyboardInterrupt(PRIVATE)

    instance.capture_partial = fail if stage == "capture_partial" else lambda: None
    instance.cleanup = (
        fail
        if stage == "cleanup"
        else lambda: (
            calls.append("cleanup"),
            instance.summary.update(cleaned_owned_resources=True),
        )
    )
    assert execute(instance) == 2
    assert "cleanup" in calls
    receipt = json.loads(instance.receipt.read_text())
    assert receipt["failure"]["code"] == "interrupted"
    assert receipt["cleaned_owned_resources"] is (stage != "cleanup")
    assert PRIVATE not in instance.receipt.read_text()


@pytest.mark.parametrize("prior_failure", [False, True])
def test_serialization_failure_writes_minimal_safe_fallback_after_cleanup(
    tmp_path, monkeypatch, prior_failure
):
    instance = coordinator(tmp_path)
    instance.summary["phases"] = {"private": {"data": PRIVATE}}
    if prior_failure:
        instance.run = lambda: (_ for _ in ()).throw(
            SafetyError("api_startup_deadline")
        )

    def serialization_failure(_):
        raise ValueError(PRIVATE)

    monkeypatch.setattr("capacity.ci_run.public_receipt", serialization_failure)
    assert execute(instance) == 2
    receipt = json.loads(instance.receipt.read_text())
    assert receipt["receipt_fallback"] and receipt["cleaned_owned_resources"]
    assert not receipt["passed"] and not receipt["r04_closed"]
    assert receipt["failure"] == {
        "code": "api_startup_deadline" if prior_failure else "receipt_failed",
        "phase": "setup" if prior_failure else "receipt",
    }
    assert PRIVATE not in instance.receipt.read_text() and "phases" not in receipt


def test_fallback_strips_unknown_fields_and_invalid_failure_values(tmp_path):
    instance = coordinator(tmp_path)
    instance.summary["failure"] = {
        "code": "interrupted",
        "phase": "cleanup",
        "private": PRIVATE,
    }
    instance.write_failed_receipt()
    assert PRIVATE not in instance.receipt.read_text()
    instance.summary["failure"] = {"code": [], "phase": "cleanup"}
    instance.write_failed_receipt()
    assert json.loads(instance.receipt.read_text())["failure"] == {
        "code": "receipt_failed",
        "phase": "receipt",
    }


def test_unwritable_fallback_is_fixed_text_only_and_never_false_pass(tmp_path, capsys):
    instance = coordinator(tmp_path)
    instance.receipt.write_text('{"passed":true}')

    def disk_failure():
        raise OSError(PRIVATE)

    instance.write_receipt = disk_failure
    instance.write_failed_receipt = disk_failure
    assert execute(instance) == 2
    assert capsys.readouterr().err == "capacity_receipt_failed\n"
    assert instance.summary["cleaned_owned_resources"]
    assert instance.summary["failure"] == {"code": "receipt_failed", "phase": "receipt"}
    assert not instance.receipt.exists()  # Never upload an older passing file.


def test_cleanup_only_exception_returns_failure_after_attempt_without_raw_trace(
    tmp_path,
):
    instance = coordinator(tmp_path)
    calls = []

    def cleanup_failure():
        calls.append("cleanup")
        raise subprocess.TimeoutExpired(["docker", "rm", PRIVATE], 30)

    instance.cleanup = cleanup_failure
    assert execute(instance, cleanup_only=True) == 2
    assert calls == ["cleanup"] and not instance.summary["cleaned_owned_resources"]
    receipt = json.loads(instance.receipt.read_text())
    assert not receipt["passed"] and not receipt["cleaned_owned_resources"]


def test_stop_and_cleanup_timeout_preserve_first_cause_and_failed_cleanup_flag(
    tmp_path,
):
    instance = coordinator(tmp_path)

    def timeout():
        raise subprocess.TimeoutExpired(["docker", "stop", PRIVATE], 30)

    instance.stop_traffic = timeout
    instance.cleanup = timeout
    assert execute(instance) == 2
    receipt = json.loads(instance.receipt.read_text())
    assert receipt["failure"] == {
        "code": "finite_command_timeout",
        "phase": "finalization",
    }
    assert not receipt["passed"] and not receipt["cleaned_owned_resources"]


def test_cleanup_only_success_leaves_previous_receipt_untouched(tmp_path):
    instance = coordinator(tmp_path)
    instance.receipt.write_text('{"passed":false,"original":true}')
    assert execute(instance, cleanup_only=True) == 0
    assert instance.receipt.read_text() == '{"passed":false,"original":true}'
