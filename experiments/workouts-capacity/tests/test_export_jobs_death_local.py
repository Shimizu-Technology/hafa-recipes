"""Local runner approval/control contracts; no Docker or application imports."""

from types import SimpleNamespace

import pytest
from capacity.ci_safety import SafetyError
from capacity.export_jobs_death_local import (
    BOOL_KEYS,
    START_GATE,
    LocalRunner,
    check_scenario,
    gate_argv,
    lifecycle_id,
    validate_plan,
)


@pytest.mark.parametrize(
    "fault", ["false", "missing", "extra", "numeric", "not-object"]
)
def test_incomplete_or_coerced_death_receipts_cannot_pass(fault):
    receipt = dict.fromkeys(BOOL_KEYS, True)
    key = next(iter(BOOL_KEYS))
    if fault == "false":
        receipt[key] = False
    elif fault == "missing":
        del receipt[key]
    elif fault == "extra":
        receipt["unknown"] = True
    elif fault == "numeric":
        receipt[key] = 1
    else:
        receipt = []
    with pytest.raises(SafetyError):
        check_scenario(receipt)


def test_complete_fixed_receipt_passes():
    check_scenario(dict.fromkeys(BOOL_KEYS, True))


def test_unapproved_plan_refuses_before_git_or_docker(tmp_path, monkeypatch):
    path = tmp_path / "linux-death-plan.json"
    path.write_text('{"executed":false}')
    monkeypatch.setattr(
        "capacity.export_jobs_death_local.git",
        lambda *_: pytest.fail("approval checked too late"),
    )
    with pytest.raises(SafetyError):
        validate_plan(tmp_path, tmp_path, "0" * 64)


def test_container_gate_preserves_image_flags_and_original_exec_arguments():
    original = [
        "docker",
        "run",
        "-d",
        "--name",
        "owned",
        "--network",
        "container:owned-pg",
        "sha256:image",
        "python",
        "-m",
        "capacity.export_jobs_death_driver",
    ]
    gated = gate_argv(original, "sha256:image")
    assert gated[:8] == original[:8]
    assert gated[8:11] == ["python", "-c", START_GATE]
    assert gated[11:] == original[8:]
    assert original[-3:] == ["python", "-m", "capacity.export_jobs_death_driver"]


def test_gate_requires_real_docker_run_command():
    with pytest.raises(SafetyError):
        gate_argv(["docker", "exec", "sha256:image", "python"], "sha256:image")


@pytest.mark.parametrize(
    "present", [[], ["a" * 12 + "b" * 52], ["a" * 64, "a" * 12 + "b" * 52]]
)
def test_ambiguous_or_missing_lifecycle_identity_is_rejected(present):
    with pytest.raises(SafetyError):
        lifecycle_id("a" * 64, present)


def test_helper_uses_short_collector_id_while_ledger_retains_full_identity():
    identifier = "a" * 64
    events = []
    runner = object.__new__(LocalRunner)
    runner.helper, runner.session = "helper", "synthetic-session"
    runner.claimed, runner.lifecycle_unknown = set(), False
    runner.ledger = SimpleNamespace(
        inspect=lambda value: events.append(("inspect", value)),
        state={"removed": {"death": identifier}},
    )

    def command(argv, timeout=30):
        events.append(("command", argv))
        if argv[:2] == ["docker", "ps"]:
            return identifier
        assert argv[-2:] == ["container", identifier[:12]]
        return "canonical helper accepted"

    runner.command = command
    runner.claim(identifier)
    assert runner.claimed == {identifier}
    runner.release(identifier)
    assert runner.claimed == set()
    assert events[0] == ("inspect", identifier)
    helper_commands = [
        argv for event, argv in events if event == "command" and argv[0] == "helper"
    ]
    assert [argv[1] for argv in helper_commands] == ["claim", "release"]
