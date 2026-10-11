"""Controlled overlap/count/cadence proofs; no real traffic or provider claims."""

import ast
import asyncio
import heapq
import math
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from capacity.driver import Driver
from capacity.export_diagnostic_metrics import Metrics
from capacity.export_jobs_diagnostic_contract import READS
from capacity.export_jobs_diagnostic_driver import JobsProbe
from capacity.export_jobs_overlap import (
    active_build,
    overlap_evidence,
    wait_active_build,
)
from capacity.safety import OWNERS
from fastapi import Depends, FastAPI, HTTPException, Request
from test_export_jobs_diagnostic import analyze, report


def test_positive_overlap_is_derived_from_both_time_origins_not_driver_flags():
    value = report()
    evidence = overlap_evidence(value, value["metrics"])
    assert evidence["responsive_concurrency"]
    assert all(
        count == 1
        for phase in evidence["overlap_counts"].values()
        for count in phase.values()
    )
    value["job_outcome"]["protected_reads_during_build"] = False
    assert analyze(value)["responsive_concurrency"]
    value["metrics"]["origin_timestamp"] += 1
    assert not analyze(value)["protected_reads_during_build"]


@pytest.mark.parametrize(
    "corruption",
    [
        "missing",
        "after",
        "touch_start",
        "touch_end",
        "page_gap",
        "failed_status",
        "nan",
        "duration_nan",
        "truncated",
        "missing_unreported",
        "unsettled",
        "failed_build",
    ],
)
def test_missing_false_or_unsettled_overlap_never_passes(corruption):
    value = report()
    assert analyze(value)["complete"]
    target = next(
        row
        for row in value["spans"]
        if row["route"] == "/up" and row["offset_ms"] == 1010
    )
    if corruption == "missing":
        target["offset_ms"] = 6000
    elif corruption == "after":
        target["offset_ms"] = 1101
    elif corruption == "touch_start":
        target["offset_ms"] = 990  # Ends exactly at aligned build start1000.
    elif corruption == "touch_end":
        target["offset_ms"] = 1100
    elif corruption == "page_gap":
        target = next(
            row
            for row in value["spans"]
            if row["route"] == "/up" and row["offset_ms"] == 2005
        )
        target["offset_ms"] = 2030  # Between page0 end2020 and page1 start2050.
    elif corruption == "failed_status":
        target["status"] = 0
    elif corruption == "nan":
        target["offset_ms"] = math.nan
    elif corruption == "duration_nan":
        target["duration_ms"] = math.nan
    elif corruption == "truncated":
        value["dropped_spans"] = 1
    elif corruption == "missing_unreported":
        value["spans"].remove(target)
    elif corruption == "unsettled":
        value["unsettled_requests"] = 1
    elif corruption == "failed_build":
        value["metrics"]["spans"][0]["failed"] = True
    data = analyze(value)
    assert not data["complete"] and not data["responsive_concurrency"]


def test_one_slow_witness_cannot_hide_inside80_fast_global_samples():
    value = report()
    assert analyze(value)["complete"]
    target = next(
        row
        for row in value["spans"]
        if row["route"] == "/up" and row["offset_ms"] == 1010
    )
    target["duration_ms"] = 1800
    # Global80-sample p95 remains10; only the actual phase subset contains1800.
    assert value["routes"]["/up"]["p95_ms"] == 10
    data = analyze(value)
    assert data["protected_reads_during_build"]
    assert data["overlap_p95_ms"]["build"]["/up"] == 1800
    assert not data["responsive_concurrency"] and not data["latency_slos_passed"]
    assert not data["complete"]


@pytest.mark.asyncio
async def test_build_signal_is_real_bounded_and_does_not_hold_the_producer():
    now, checks = 0.0, []

    def read():
        checks.append(now)
        return {
            "complete": False,
            "stages": {
                "build_total": {
                    "calls": int(now >= 0.02),
                    "completed": 0,
                    "failed": 0,
                }
            },
        }

    async def sleep(seconds):
        nonlocal now
        now += seconds

    assert await wait_active_build(read, clock=lambda: now, sleep=sleep)
    assert now == 0.02 and checks == [0, 0.01, 0.02]
    now = 0
    assert not await wait_active_build(lambda: None, clock=lambda: now, sleep=sleep)
    assert now <= 0.45000001
    assert not active_build(
        {
            "complete": True,
            "stages": {"build_total": {"calls": 1, "completed": 1, "failed": 0}},
        }
    )
    assert not active_build(
        {
            "complete": False,
            "stages": {"build_total": {"calls": True, "completed": 0, "failed": 0}},
        }
    )


class Clock:
    def __init__(self):
        self.now, self.sequence, self.waiters = 0.0, 0, []

    async def sleep(self, seconds):
        future = asyncio.get_running_loop().create_future()
        self.sequence += 1
        heapq.heappush(self.waiters, (self.now + seconds, self.sequence, future))
        await future

    async def settle(self, tasks, real_sleep):
        for _ in range(1000):
            # Allow all eight readers/events to register before advancing time.
            for _ in range(20):
                await real_sleep(0)
            if all(task.done() for task in tasks):
                return
            assert self.waiters, "A signal remained unresolved"
            self.now = self.waiters[0][0]
            while self.waiters and self.waiters[0][0] <= self.now:
                _, _, future = heapq.heappop(self.waiters)
                if not future.done():
                    future.set_result(None)
        pytest.fail("Controlled scheduler did not settle")


@pytest.mark.asyncio
async def test_exactly_two_rounds_move_and_all_later_absolute_turns_are_preserved(
    monkeypatch,
):
    from capacity import export_jobs_diagnostic_driver as module

    clock, real_sleep = Clock(), asyncio.sleep
    probe = SimpleNamespace(
        started=0, build_signal=asyncio.Event(), page_signal=asyncio.Event()
    )
    records, requests = [], []

    async def request(method, path, owner=OWNERS[0], *, label=None):
        assert method == "GET" and owner in OWNERS
        requests.append((label or path, clock.now))
        return httpx.Response(200, json={"items": [{"id": "synthetic"}]})

    probe.request = request

    async def lightweight(index, mixed):
        assert mixed is False
        records.append((index, clock.now))
        await Driver.lightweight(probe, index, mixed)

    probe.lightweight = lightweight
    monkeypatch.setattr(module.time, "monotonic", lambda: clock.now)
    monkeypatch.setattr(module.asyncio, "sleep", clock.sleep)

    async def signal(event, at):
        await clock.sleep(at)
        event.set()

    tasks = [asyncio.create_task(JobsProbe.readers(probe, index)) for index in range(8)]
    tasks += [
        asyncio.create_task(signal(probe.build_signal, 48.2)),
        asyncio.create_task(signal(probe.page_signal, 52.1)),
    ]
    try:
        await clock.settle(tasks, real_sleep)
        await asyncio.gather(*tasks)
        assert len(records) == 80  # Each actual round still contains four categories.
        assert {
            route: sum(label == route for label, _ in requests) for route in READS
        } == dict.fromkeys(READS, 80)
        assert len(requests) == 320
        for index in range(8):
            actual = [when for owner, when in records if owner == index]
            expected = [index * 2 + round_number * 16 for round_number in range(10)]
            if index in (0, 1):
                expected[3] = 48.2 if index == 0 else 52.1
            assert actual == expected
        assert [when for owner, when in records if owner == 0][4] == 64
        assert [when for owner, when in records if owner == 1][4] == 66
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


@pytest.mark.asyncio
async def test_cancelled_barrier_reader_never_issues_or_restores_a_round(monkeypatch):
    from capacity import export_jobs_diagnostic_driver as module

    clock = Clock()
    probe = SimpleNamespace(
        started=0, build_signal=asyncio.Event(), page_signal=asyncio.Event()
    )
    calls = []

    async def lightweight(*args):
        calls.append(args)

    probe.lightweight = lightweight

    async def sleep(_):
        clock.now = 48

    monkeypatch.setattr(module.time, "monotonic", lambda: clock.now)
    monkeypatch.setattr(module.asyncio, "sleep", sleep)
    task = asyncio.create_task(JobsProbe.readers(probe, 0))
    # First three normal rounds finish; round3 awaits the real build signal.
    await asyncio.wait_for(asyncio.shield(_wait_registered(task, calls)), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(calls) == 3 and not probe.build_signal.is_set()


async def _wait_registered(task, calls):
    # Yield through the real loop, independent of the controlled sleep patch.
    while len(calls) < 3 and not task.done():
        future = asyncio.get_running_loop().create_future()
        asyncio.get_running_loop().call_soon(future.set_result, None)
        await future


@pytest.mark.asyncio
async def test_actual_observation_handler_refuses_foreign_owner_and_has_no_db_dependencies():
    path = (
        Path(__file__).resolve().parents[1] / "capacity/export_jobs_diagnostic_app.py"
    )
    node = next(
        item
        for item in ast.parse(path.read_text()).body
        if isinstance(item, ast.AsyncFunctionDef) and item.name == "build_start"
    )
    app, metrics, reads = FastAPI(), Metrics(), []

    async def identity(request: Request):
        return SimpleNamespace(id=request.headers.get("X-Capacity-User"))

    def snapshot():
        reads.append(True)
        return metrics.snapshot()

    # Compile the actual handler/decorator, rather than a mirrored endpoint.
    # No DB/provider globals exist; a newly introduced dependency would fail.
    scope = {
        "app": app,
        "Depends": Depends,
        "HTTPException": HTTPException,
        "identity": identity,
        "OWNERS": OWNERS,
        "snapshot": snapshot,
        "wait_active_build": wait_active_build,
    }
    # Execute only this repository's reviewed handler; no user/source payload.
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), scope)  # noqa: S102
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://synthetic.invalid"
    ) as client:
        denied = await client.get(
            "/capacity/export-jobs-diagnostic/build-start",
            headers={"X-Capacity-User": OWNERS[0]},
        )
        assert denied.status_code == 403 and reads == []
        with metrics.measure("build_total"):
            accepted = await client.get(
                "/capacity/export-jobs-diagnostic/build-start",
                headers={"X-Capacity-User": OWNERS[22]},
            )
            assert accepted.status_code == 200 and accepted.json() == {
                "build_started": True
            }
            assert metrics.stats["build_total"]["completed"] == 0
        # The observer did not retain/hold the producer's completed stage.
        assert metrics.stats["build_total"]["completed"] == 1 and reads == [True]
