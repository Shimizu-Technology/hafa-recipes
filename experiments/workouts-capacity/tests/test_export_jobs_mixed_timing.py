"""Fixed-time handshake/traffic/tail regressions; no actual runtime acceptance."""

import json
import sys
import time
from types import SimpleNamespace

import pytest
from capacity import export_jobs_mixed_timing as timing
from capacity.export_jobs_mixed_receipt import mixed_public_receipt


def timing_records():
    return (
        {
            "start_at": 100,
            "traffic_first_start": 100.2,
            "traffic_last_end": 400,
            "namespace_inode": 33,
            "unsettled_requests": 0,
        },
        {
            "start_at": 100,
            "observer_started_at": 100,
            "first_sample_at": 100.1,
            "observer_ended_at": 550,
            "namespace_inode": 33,
            "completed": True,
        },
    )


def test_exact300_plus150_proof_and_only_relative_numeric_publication():
    traffic, observer = timing_records()
    proof = timing.timing_proof(traffic, observer)
    assert proof["passed"] and proof["actual_tail_seconds"] == 150
    safe = mixed_public_receipt(
        {
            "passed": True,
            "cleaned_owned_resources": True,
            "phases": {"baseline": {"passed": True, "timing_proof": proof}},
        }
    )
    assert safe["passed"] and safe["phases"]["baseline"]["timing_proof"]["passed"]
    text = json.dumps(safe)
    assert (
        "namespace_inode" not in text
        and "observer_ended_at" not in text
        and "start_at" not in text
    )


@pytest.mark.parametrize(
    "record,key,value",
    [
        ("traffic", "traffic_last_end", 400.01),
        ("traffic", "traffic_first_start", 101.01),
        ("traffic", "traffic_first_start", 100.05),
        ("traffic", "namespace_inode", 34),
        ("observer", "namespace_inode", True),
        ("traffic", "unsettled_requests", 1),
        ("observer", "observer_ended_at", 549.99),
        ("observer", "completed", False),
        ("observer", "first_sample_at", float("nan")),
        ("observer", "observer_started_at", None),
        ("observer", "start_at", 101),
    ],
)
def test_missing_late_shifted_or_unsettled_timing_cannot_pass(record, key, value):
    traffic, observer = timing_records()
    (traffic if record == "traffic" else observer)[key] = value
    proof = timing.timing_proof(traffic, observer)
    assert not proof["passed"]
    safe = mixed_public_receipt(
        {
            "passed": True,
            "cleaned_owned_resources": True,
            "phases": {"mixed": {"passed": True, "timing_proof": proof}},
        }
    )
    assert not safe["passed"]


def test_preparation_cannot_silently_shift_traffic_past_observer_tail():
    traffic, observer = timing_records()
    # Original monitor origin stays100 while a30s preparation shift moves traffic.
    traffic.update(start_at=130, traffic_first_start=130.2, traffic_last_end=430)
    observer["start_at"] = 130
    assert not timing.timing_proof(traffic, observer)["passed"]
    assert not timing.timing_proof(None, observer)["passed"]
    assert not timing.timing_proof(traffic, {})["passed"]


def test_private_control_is_bounded_once_only_and_refuses_malformed_or_symlink(
    tmp_path,
):
    value = {
        "schema_version": 1,
        "phase": "baseline",
        "namespace_inode": 33,
        "start_at": 100,
    }
    timing.write_state(tmp_path, "start.json", value)
    assert timing.read_state(tmp_path, "start.json") == value
    with pytest.raises(FileExistsError):
        timing.write_state(tmp_path, "start.json", {**value, "start_at": 101})
    assert timing.read_state(tmp_path, "start.json") == value
    assert not (tmp_path / "start.json.pending").exists()
    for text in ("broken json", json.dumps({"schema_version": True}), "x" * 4097):
        (tmp_path / "observing.json").write_text(text)
        with pytest.raises(timing.TimingError):
            timing.read_state(tmp_path, "observing.json")
    (tmp_path / "observing.json").unlink()
    (tmp_path / "observing.json").symlink_to(tmp_path / "start.json")
    with pytest.raises(timing.TimingError):
        timing.read_state(tmp_path, "observing.json")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "ack", ["valid", "missing", "late", "wrong_namespace", "future"]
)
async def test_actual_client_handshake_releases_only_after_valid_observing_ack(
    monkeypatch, tmp_path, ack
):
    clock = SimpleNamespace(now=100.2)

    async def sleep(seconds):
        clock.now += seconds

    monkeypatch.setattr(timing, "time", SimpleNamespace(monotonic=lambda: clock.now))
    monkeypatch.setattr(timing, "asyncio", SimpleNamespace(sleep=sleep))
    monkeypatch.setattr(timing, "namespace", lambda: 33)
    timing.write_state(
        tmp_path,
        "start.json",
        {
            "schema_version": 1,
            "phase": "baseline",
            "namespace_inode": 33,
            "start_at": 100,
        },
    )
    observing = {
        "schema_version": 1,
        "start_at": 100,
        "namespace_inode": 33,
        "observer_started_at": 100,
        "first_sample_at": 100.1,
    }
    if ack == "late":
        clock.now = 101.01
    if ack == "wrong_namespace":
        observing["namespace_inode"] = 34
    if ack == "future":
        observing["first_sample_at"] = 100.3
    if ack != "missing":
        timing.write_state(tmp_path, "observing.json", observing)
    if ack == "valid":
        start, _ = await timing.client_start(tmp_path, "baseline", 160)
        assert start == 100 and clock.now == 100.2
    else:
        with pytest.raises(timing.TimingError):
            await timing.client_start(tmp_path, "baseline", 160)
    assert timing.read_state(tmp_path, "load-prepared.json")["namespace_inode"] == 33


@pytest.mark.asyncio
@pytest.mark.parametrize("finish,allowed", [(399.5, True), (400.01, False)])
async def test_actual_traffic_window_stops_before_reconciliation_after_late_export(
    monkeypatch, finish, allowed
):
    from capacity import export_jobs_mixed_driver as module

    clock = SimpleNamespace(now=100.2)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock.now))

    # The absolute wrapper is real; a controlled completed workload places its final export atfinish.
    async def workload(driver, mixed, seconds, *, started):
        assert mixed and seconds == 300 and started == 100
        clock.now = finish

    monkeypatch.setattr(module, "run_workload", workload)
    calls = []

    async def poll():
        calls.append("poll")
        clock.now += 0.1

    async def checkpoint(name):
        calls.append(name)
        clock.now += 0.1

    driver = SimpleNamespace(poll=poll, checkpoint=checkpoint)
    if allowed:
        await module.traffic_window(driver, True, 100)
        assert calls == ["poll", "after"] and driver.traffic_start == 100
    else:
        with pytest.raises(timing.TimingError):
            await module.traffic_window(driver, True, 100)
        assert calls == []  # No post300s request, replay or observer extension.
    assert clock.now >= finish


@pytest.mark.asyncio
async def test_final_http_reconciliation_cannot_extend300s_window(monkeypatch):
    from capacity import export_jobs_mixed_driver as module

    clock = SimpleNamespace(now=100.2)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock.now))

    async def workload(*args, **kwargs):
        clock.now = 399.9

    monkeypatch.setattr(module, "run_workload", workload)
    calls = []

    async def poll():
        calls.append("poll")
        clock.now = 400.01

    async def checkpoint(name):
        calls.append(name)

    # Explicit postpoll boundary ensures a slow poll cannot begin another HTTP checkpoint.
    with pytest.raises(timing.TimingError):
        await module.traffic_window(
            SimpleNamespace(poll=poll, checkpoint=checkpoint), True, 100
        )
    assert calls == ["poll"]


def test_every_final_http_end_is_recorded_even_outside_public_span_categories(
    monkeypatch,
):
    from capacity import export_jobs_mixed_driver as module

    clock = SimpleNamespace(now=100.2)
    monkeypatch.setattr(
        module,
        "time",
        SimpleNamespace(monotonic=lambda: clock.now, time=lambda: 1000 + clock.now),
    )
    driver = module.MixedDriver.__new__(module.MixedDriver)
    driver.trace_stream = None
    driver.traffic_active = True
    driver.traffic_first_start = driver.traffic_last_end = None
    driver.pending = {}
    driver.spans = []
    driver.origin = 1000
    driver.dropped = 0
    driver.trace(1, "start", "/capacity/status")
    clock.now = 399.9
    driver.trace(1, "end", "/capacity/status", milliseconds=10, status=200)
    assert driver.traffic_first_start == 100.2 and driver.traffic_last_end == 399.9
    assert driver.spans == [] and driver.pending == {}
    driver.trace(2, "start", "/capacity/status")
    clock.now = 400.01
    driver.trace(2, "failed", "/capacity/status", milliseconds=10, status=0)
    assert driver.traffic_last_end == 400.01


@pytest.mark.parametrize("completed", [True, False])
def test_new_monitor_calls_unchanged450s_sampler_and_records_actual_end(
    monkeypatch, tmp_path, completed
):
    from capacity import export_jobs_mixed_monitor as module

    api, pg = "a" * 64, "b" * 64
    ledger = tmp_path / "ledger.json"
    ledger.write_text(
        json.dumps(
            {
                "owner": "capacity_ci",
                "cleaned": False,
                "containers": {"api": api, "pg": pg},
            }
        )
    )
    control = tmp_path / "control"
    control.mkdir()
    clock = SimpleNamespace(now=100.0)

    def sleep(seconds):
        clock.now += seconds

    monkeypatch.setattr(
        module, "time", SimpleNamespace(monotonic=lambda: clock.now, sleep=sleep)
    )
    monkeypatch.setattr(module, "namespace", lambda: 33)
    monkeypatch.setattr(timing, "time", SimpleNamespace(monotonic=lambda: clock.now))
    monkeypatch.setattr(timing, "namespace", lambda: 33)
    timing.write_state(
        control,
        "start.json",
        {
            "schema_version": 1,
            "phase": "baseline",
            "namespace_inode": 33,
            "start_at": 102,
        },
    )
    validated = []
    monkeypatch.setattr(
        module.HostMonitor,
        "validate",
        lambda self, identifier, role: validated.append(role),
    )
    monkeypatch.setattr(
        module.HostMonitor, "snapshot", lambda self: {"stop_required": False}
    )
    calls = []

    def sampler(monitor, output, seconds, interval):
        calls.append((seconds, interval))
        monitor.snapshot()
        clock.now += 450 if completed else 10
        return {
            "completed": completed,
            "local_memory_gate": "passed" if completed else "failed",
        }

    monkeypatch.setattr(module, "run_monitor", sampler)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "monitor",
            "--ledger",
            str(ledger),
            "--api-id",
            api,
            "--pg-id",
            pg,
            "--run-id",
            "test",
            "--phase",
            "baseline",
            "--output",
            str(tmp_path / "samples"),
            "--control",
            str(control),
        ],
    )
    assert module.main() == (0 if completed else 2)
    assert validated == ["api", "pg"] and calls == [(450, 0.5)]
    assert timing.read_state(control, "observer-prepared.json")["namespace_inode"] == 33
    ended = timing.read_state(control, "observer-ended.json")
    assert ended["completed"] is completed and ended["observer_ended_at"] == 102 + (
        450 if completed else 10
    )
    ack = timing.read_state(control, "observing.json")
    assert ack["first_sample_at"] == 102 and ack["observer_started_at"] == 102
    assert (
        time.monotonic is not module.time.monotonic
    )  # Global clocks were never replaced.
