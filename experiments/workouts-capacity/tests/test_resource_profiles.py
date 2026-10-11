"""Profile control and evidence boundaries; no Docker, HTTP or runtime starts."""

import json
from dataclasses import FrozenInstanceError
from pathlib import Path
from types import SimpleNamespace

import pytest
from capacity.ci_run import Coordinator
from capacity.ci_safety import (
    BASE_WRITES,
    EXTRA_READS,
    EXTRA_WRITES,
    READS,
    SafetyError,
    phase_receipt,
    public_receipt,
)
from capacity.comparison_ci import validate_context
from capacity.export_jobs_mixed_ci import MixedCoordinator
from capacity.host_monitor import HostMonitor, MonitorError
from capacity.legal_ci import LegalCoordinator
from capacity.legal_ci import receipt as legal_receipt
from capacity.legal_contract import BOOLEANS, CASES, COUNTS
from capacity.resource_profiles import (
    PROFILES,
    ProfileId,
    checked_metadata,
    cpu_matches,
    resolve,
    same_profile_evidence,
)


@pytest.mark.parametrize("name", ["", "unknown", "2g", True, 2048, {}, object()])
def test_arbitrary_selection_is_refused(name):
    with pytest.raises(ValueError):
        resolve(name)


def test_profiles_are_closed_immutable_and_preserve_exact_headroom():
    old, new = resolve(), resolve(ProfileId.STANDARD)
    assert (old.memory_mib, old.cpus, old.pass_peak_mib, old.stop_mib) == (
        512,
        0.5,
        410,
        460,
    )
    assert (new.memory_mib, new.cpus, new.pass_peak_mib, new.stop_mib) == (
        2048,
        1,
        1640,
        1840,
    )
    with pytest.raises(FrozenInstanceError):
        new.memory_mib = 4096
    with pytest.raises(TypeError):
        PROFILES["custom"] = new


@pytest.mark.parametrize("fault", ["missing", "extra", "bool", "budget", "id"])
def test_metadata_cannot_expand_budgets_or_leak_unknown_fields(fault):
    value = resolve(ProfileId.STANDARD).metadata()
    if fault == "missing":
        value.pop("id")
    elif fault == "extra":
        value["private"] = "secret"
    elif fault == "bool":
        value["cpu_millicores"] = True
    elif fault == "budget":
        value["stop_bytes"] += 1
    else:
        value["id"] = "unknown"
    with pytest.raises(ValueError):
        checked_metadata(value)


@pytest.mark.parametrize("name", list(ProfileId))
def test_actual_cpu_quota_is_required_and_conflicting_limits_refuse(name):
    p = resolve(name)
    observed = {
        "nano_cpus": p.cpu_millicores * 1_000_000,
        "cpu_quota": 0,
        "cpu_period": 0,
    }
    assert cpu_matches(observed, p)
    assert cpu_matches(
        {"nano_cpus": 0, "cpu_quota": p.cpu_millicores * 100, "cpu_period": 100000}, p
    )
    for wrong in (
        {},
        {**observed, "nano_cpus": 0},
        {**observed, "nano_cpus": True},
        {**observed, "nano_cpus": observed["nano_cpus"] + 1},
        {**observed, "cpu_quota": 1, "cpu_period": 100000},
    ):
        assert not cpu_matches(wrong, p)


@pytest.mark.parametrize("name", list(ProfileId))
@pytest.mark.parametrize("fault", [None, "memory", "swap", "cpu", "ports", "owner"])
def test_monitor_checks_actual_budget_before_other_probes(name, fault):
    p = resolve(name)
    api, pg, run = "a" * 64, "b" * 64, "profiles-test"
    value = {
        "id": api,
        "owner": "capacity_ci",
        "run": run,
        "name": f"/capacity-api-{run}",
        "running": True,
        "ports": {},
        "memory": p.memory_bytes,
        "memory_swap": p.memory_bytes,
        "nano_cpus": p.cpu_millicores * 1_000_000,
        "cpu_quota": 0,
        "cpu_period": 0,
    }
    if fault in ("memory", "swap"):
        value["memory" if fault == "memory" else "memory_swap"] += 1
    elif fault == "cpu":
        value["nano_cpus"] = 0
    elif fault == "ports":
        value["ports"] = {"8000/tcp": [{}]}
    elif fault == "owner":
        value["owner"] = "borrowed"
    calls = []

    def docker(argv):
        calls.append(argv)
        assert argv[1] == "inspect"
        return json.dumps(value)

    monitor = HostMonitor(
        {"owner": "capacity_ci", "containers": {"api": api, "pg": pg}},
        api,
        pg,
        run,
        "baseline",
        docker,
        owner="capacity_ci",
        resource_profile=name,
    )
    if fault:
        with pytest.raises(MonitorError):
            monitor.validate(api, "api")
    else:
        assert monitor.validate(api, "api")["memory"] == p.memory_bytes
    assert len(calls) == 1


@pytest.mark.parametrize("cls", [Coordinator, MixedCoordinator, LegalCoordinator])
@pytest.mark.parametrize("name", [None, *ProfileId])
def test_api_profile_does_not_change_load_container_budget_or_backend_flags(
    tmp_path, cls, name
):
    p = resolve(name)
    c = cls(
        tmp_path, tmp_path / "work", tmp_path / "receipt.json", resource_profile=name
    )
    c.run_id, c.pg, c.plan_root = "test", "b" * 64, tmp_path / "plan"
    for phase in ("baseline", "mixed"):
        argv = c.runtime_argv("api", phase=phase)
        assert argv[argv.index("--memory") + 1] == f"{p.memory_mib}m"
        assert argv[argv.index("--memory-swap") + 1] == f"{p.memory_mib}m"
        assert float(argv[argv.index("--cpus") + 1]) == p.cpus
        assert f"WORKOUTS_API_ENABLED={'true' if phase == 'mixed' else 'false'}" in argv
    assert "--memory" not in c.runtime_argv("load")
    assert bool(c.profile_argv()) == (name is not None)
    c.write_failed_receipt()
    value = json.loads(c.receipt.read_text())
    assert value.get("resource_profile") == (p.metadata() if name is not None else None)
    assert (
        not value["passed"] and not value["render_parity"] and not value["r04_closed"]
    )


def evidence(name):
    p = resolve(name)
    routes = {
        r: {
            "count": 150,
            "unexpected": 0,
            "statuses": {"200": 150},
            "p95_ms": 100,
            "p99_ms": 200,
        }
        for r in READS | BASE_WRITES | {"recipes/job-poll"}
    }
    report = {
        "completed": True,
        "percentile_method": "nearest_rank",
        "routes": routes,
        "resource_profile": p.metadata(),
    }
    samples = [
        {
            "memory_peak": p.pass_bytes,
            "memory_current": 100,
            "resource_profile": p.metadata(),
        }
    ]
    return report, samples


@pytest.mark.parametrize("name", list(ProfileId))
def test_selected_budget_boundary_does_not_relax_latency_or_oom(name):
    report, samples = evidence(name)
    assert phase_receipt(report, samples, "baseline", resource_profile=name)["passed"]
    assert not phase_receipt(
        report,
        [{**samples[0], "memory_peak": samples[0]["memory_peak"] + 1}],
        "baseline",
        resource_profile=name,
    )["passed"]
    assert not phase_receipt(
        report, [{**samples[0], "oom": 1}], "baseline", resource_profile=name
    )["passed"]
    report["routes"]["/up"]["p95_ms"] = 501
    assert not phase_receipt(report, samples, "baseline", resource_profile=name)[
        "passed"
    ]


def test_other_profile_or_missing_observer_evidence_cannot_supply_baseline():
    report, samples = evidence(ProfileId.STANDARD)
    old, _ = evidence(ProfileId.STARTER)
    assert same_profile_evidence(ProfileId.STANDARD, report, samples, report)
    assert not same_profile_evidence(ProfileId.STANDARD, report, samples, old)
    assert not same_profile_evidence(ProfileId.STANDARD, report, [], report)
    assert not same_profile_evidence(
        ProfileId.STANDARD,
        report,
        [{**samples[0], "resource_profile": old["resource_profile"]}],
        report,
    )
    selected = phase_receipt(
        report, samples, "baseline", old, resource_profile=ProfileId.STANDARD
    )
    assert not selected["passed"]
    report["routes"]["/up"]["p95_ms"] = 126
    assert not phase_receipt(
        report, samples, "baseline", old, resource_profile=ProfileId.STANDARD
    )["passed"]


@pytest.mark.parametrize("fault", ["p95", "p99", "write"])
def test_larger_profile_still_enforces_original_relative_and_write_limits(fault):
    report, samples = evidence(ProfileId.STANDARD)
    baseline, _ = evidence(ProfileId.STANDARD)
    if fault == "p95":
        report["routes"]["/up"]["p95_ms"] = 126
    elif fault == "p99":
        report["routes"]["/up"]["p99_ms"] = 401
    else:
        report["routes"]["recipes/chat"]["p95_ms"] = 1001
    assert not phase_receipt(
        report, samples, "baseline", baseline, resource_profile=ProfileId.STANDARD
    )["passed"]


def test_new_budget_cannot_reinterpret_a_legacy_512_memory_failure():
    report, samples = evidence(ProfileId.STANDARD)
    samples[0]["memory_peak"] = 500 * 2**20
    assert phase_receipt(
        report, samples, "baseline", resource_profile=ProfileId.STANDARD
    )["passed"]
    old_result = phase_receipt(report, samples, "baseline")
    assert not old_result["passed"] and "resource_profile" not in old_result


def test_legal_receipt_preserves_cases_and_requires_matching_profile_baseline():
    report, samples = evidence(ProfileId.STANDARD)
    baseline, _ = evidence(ProfileId.STANDARD)
    report["cases"] = {
        case: {
            **dict.fromkeys(BOOLEANS, True),
            "normalized": COUNTS[case],
            "stored": COUNTS[case],
            "distinct_recipe_count": COUNTS[case],
            "normalizer_peak": 2,
            "scene_child_count": 1,
            "frames": 1,
            "scene_calls": 1,
        }
        for case in CASES
    }
    assert legal_receipt(
        report, samples, baseline, resource_profile=ProfileId.STANDARD
    )["passed"]
    baseline["resource_profile"] = resolve().metadata()
    assert not legal_receipt(
        report, samples, baseline, resource_profile=ProfileId.STANDARD
    )["passed"]


def test_public_receipt_cannot_relabel_a_phase_or_copy_private_fields():
    p = resolve(ProfileId.STANDARD).metadata()
    summary = {
        "resource_profile": p,
        "private": "secret-unknown-body",
        "phases": {
            "baseline": {"resource_profile": p, "private": "secret-unknown-body"}
        },
    }
    safe = public_receipt(summary)
    assert safe["phases"]["baseline"]["resource_profile"] == p
    assert "secret-unknown-body" not in json.dumps(safe)
    summary["phases"]["baseline"]["resource_profile"] = resolve().metadata()
    with pytest.raises(SafetyError):
        public_receipt(summary)


@pytest.mark.parametrize("fault", ["pull_request", "fork", "local"])
def test_comparison_is_explicit_manual_same_repository_only(monkeypatch, fault):
    env = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": "Shimizu-Technology/hafa-recipes",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
    }
    monkeypatch.setattr("capacity.comparison_ci.platform.system", lambda: "Linux")
    validate_context(env)
    if fault == "pull_request":
        env["GITHUB_EVENT_NAME"] = fault
    elif fault == "fork":
        env["GITHUB_REPOSITORY"] = "foreign/fork"
    else:
        env["GITHUB_ACTIONS"] = "false"
    with pytest.raises(SafetyError):
        validate_context(env)


def test_comparison_workflow_has_no_push_or_pr_trigger_and_binds_exact_sha():
    workflow = (
        Path(__file__).resolve().parents[3]
        / ".github/workflows/workouts-capacity-comparison.yml"
    )
    text = workflow.read_text()
    assert (
        "workflow_dispatch:" in text
        and "pull_request:" not in text
        and "  push:" not in text
    )
    assert "ref: ${{ github.sha }}" in text and "persist-credentials: false" in text
    assert (
        "timeout-minutes: 35" in text
        and "--cleanup-only" in text
        and "if: always()" in text
    )


def test_missing_mixed_baseline_cannot_skip_relative_acceptance():
    report, samples = evidence(ProfileId.STANDARD)
    baseline, _ = evidence(ProfileId.STANDARD)
    report["routes"].update(
        {
            route: {
                "count": 5,
                "unexpected": 0,
                "statuses": {"200": 5},
                "p95_ms": 100,
                "p99_ms": 200,
            }
            for route in EXTRA_READS | EXTRA_WRITES
        }
    )
    good = phase_receipt(
        report, samples, "mixed", baseline, resource_profile=ProfileId.STANDARD
    )
    assert good["passed"] and good["failure_count"] == 0
    refused = phase_receipt(
        report, samples, "mixed", resource_profile=ProfileId.STANDARD
    )
    assert not refused["passed"] and refused["failure_count"] == 1


@pytest.mark.parametrize("fault", ["missing", "wrong-profile"])
def test_cleanup_profile_mismatch_cannot_claim_cleanup_success(
    tmp_path, monkeypatch, fault
):
    from capacity.ci_run import execute

    c = Coordinator(
        tmp_path,
        tmp_path / "work",
        tmp_path / "receipt.json",
        resource_profile=ProfileId.STANDARD,
    )
    state = {"run_id": "ci-123-1", "resource_profile": resolve().metadata()}
    if fault == "missing":
        state.pop("resource_profile")
    (c.work / "resources.json").write_text(json.dumps(state))
    monkeypatch.setattr(
        c, "command", lambda *_: pytest.fail("unknown resource dispatch")
    )
    assert execute(c, cleanup_only=True) == 2
    value = json.loads(c.receipt.read_text())
    assert not value["cleaned_owned_resources"] and not value["passed"]
    assert json.loads((c.work / "resources.json").read_text()) == state


@pytest.mark.parametrize("name", list(ProfileId))
def test_profile_stop_boundary_preserves_exact_owned_target(name):
    p = resolve(name)
    api, pg, run = "a" * 64, "b" * 64, "profile-stop"
    running, calls = True, []

    def docker(argv):
        nonlocal running
        calls.append(argv)
        if argv[1] == "inspect":
            role = "api" if argv[-1] == api else "pg"
            return json.dumps(
                {
                    "id": argv[-1],
                    "name": f"/capacity-{role}-{run}",
                    "owner": "capacity_ci",
                    "run": run,
                    "ports": {},
                    "running": running if role == "api" else True,
                    "oom_killed": False,
                    "memory": p.memory_bytes,
                    "memory_swap": p.memory_bytes,
                    "nano_cpus": p.cpu_millicores * 1_000_000,
                    "cpu_quota": 0,
                    "cpu_period": 0,
                }
            )
        if argv[1] == "exec":
            return f"{p.stop_bytes}\n{p.stop_bytes}\noom 0\noom_kill 0\nusage_usec 1\nnr_periods 1\nnr_throttled 0\nthrottled_usec 0\n"
        if argv[1] == "stop":
            assert argv[-1] == api
            running = False
            return api
        pytest.fail("slow auxiliary query occurred before memory stop")

    monitor = HostMonitor(
        {"owner": "capacity_ci", "containers": {"api": api, "pg": pg}},
        api,
        pg,
        run,
        "baseline",
        docker,
        owner="capacity_ci",
        resource_profile=name,
    )
    sample = monitor.snapshot()
    assert sample["stop_required"] and sample["stopped"]
    assert sample["resource_profile"] == p.metadata()
    assert not running and ["docker", "stop", "--timeout", "2", api] in calls


@pytest.mark.parametrize("cls", [Coordinator, MixedCoordinator, LegalCoordinator])
@pytest.mark.parametrize("name", [None, *ProfileId])
@pytest.mark.parametrize("fault", [None, "image", "memory", "swap", "cpu"])
def test_actual_api_startup_verifies_selected_profile_before_liveness(
    tmp_path, cls, name, fault
):
    p = resolve(name)
    c = cls(
        tmp_path, tmp_path / "work", tmp_path / "receipt.json", resource_profile=name
    )
    c.run_id, c.pg, c.plan_root, c.image = (
        "startup-test",
        "b" * 64,
        tmp_path / "plan",
        "sha256:" + "c" * 64,
    )
    info = {
        "Image": c.image,
        "State": {"Running": True, "OOMKilled": False},
        "HostConfig": {
            "Memory": p.memory_bytes,
            "MemorySwap": p.memory_bytes,
            "NanoCpus": p.cpu_millicores * 1_000_000,
            "CpuQuota": 0,
            "CpuPeriod": 0,
        },
    }
    if fault == "image":
        info["Image"] = "sha256:" + "d" * 64
    elif fault in ("memory", "swap"):
        info["HostConfig"]["Memory" if fault == "memory" else "MemorySwap"] += 1
    elif fault == "cpu":
        info["HostConfig"]["NanoCpus"] += 1
    created, probes = [], []
    c.ledger = SimpleNamespace(
        create_container=lambda role, argv: created.append((role, argv)) or "a" * 64,
        inspect=lambda _: info,
    )
    c.command = lambda argv, timeout=30: probes.append(argv) or '{"status":"ok"}'
    if fault:
        with pytest.raises(SafetyError, match="api_budget_or_image_changed"):
            c.start_api("baseline")
        assert not probes
    else:
        c.start_api("baseline")
        assert len(probes) == 1 and probes[0][2] == c.pg
    assert len(created) == 1 and created[0][0] == "api"


@pytest.mark.parametrize("name", [None, *ProfileId])
def test_actual_startup_quota_alternative_preserves_legacy_nanocpu_policy(
    tmp_path, name
):
    p = resolve(name)
    c = Coordinator(
        tmp_path, tmp_path / "work", tmp_path / "receipt.json", resource_profile=name
    )
    c.run_id, c.pg, c.plan_root, c.image = (
        "quota-start",
        "b" * 64,
        tmp_path / "plan",
        "sha256:" + "c" * 64,
    )
    info = {
        "Image": c.image,
        "State": {"Running": True, "OOMKilled": False},
        "HostConfig": {
            "Memory": p.memory_bytes,
            "MemorySwap": p.memory_bytes,
            "NanoCpus": 0,
            "CpuQuota": p.cpu_millicores * 100,
            "CpuPeriod": 100000,
        },
    }
    c.ledger = SimpleNamespace(
        create_container=lambda *_: "a" * 64, inspect=lambda _: info
    )
    c.command = lambda *_args, **_kwargs: '{"status":"ok"}'
    if name is None:
        with pytest.raises(SafetyError, match="api_budget_or_image_changed"):
            c.start_api("baseline")
    else:
        c.start_api("baseline")


def test_wrong_quota_run_still_cleans_exact_known_owned_ledger(tmp_path):
    from capacity.ci_run import execute
    from capacity.ci_safety import Ledger
    from test_ci_safety import RUN, Docker

    p = resolve(ProfileId.STANDARD)
    c = Coordinator(
        tmp_path, tmp_path / "work", tmp_path / "receipt.json", resource_profile=p.id
    )
    c.run_id, c.pg, c.plan_root, c.image = (
        RUN,
        "b" * 64,
        tmp_path / "plan",
        "sha256:" + "c" * 64,
    )
    docker = Docker()
    borrowed = "b" * 64
    docker.resources[borrowed] = {"borrowed": True}

    def transport(argv, timeout=30):
        value = docker(argv, timeout)
        if argv[1] == "create":
            item = docker.resources[value]
            item["Image"] = c.image
            item["HostConfig"].update(
                Memory=p.memory_bytes,
                MemorySwap=p.memory_bytes,
                NanoCpus=500_000_000,
                CpuQuota=0,
                CpuPeriod=0,
            )
            item["State"]["OOMKilled"] = False
        return value

    c.ledger = Ledger(c.work / "resources.json", RUN, transport)
    c.command = transport
    c.run = lambda: c.start_api("baseline")
    assert execute(c) == 2
    value = json.loads(c.receipt.read_text())
    assert not value["passed"] and value["cleaned_owned_resources"]
    assert c.ledger.state["cleaned"] and not c.ledger.state["containers"]
    assert docker.resources == {borrowed: {"borrowed": True}}
    stopped = [argv[-1] for argv in docker.calls if argv[1] == "stop"]
    assert stopped == ["0" * 63 + "1"]
