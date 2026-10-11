"""Finite source/protocol tests; not native hosted mixed acceptance."""

import asyncio
import copy
import json
import time
from datetime import datetime, timedelta, timezone
from itertools import pairwise
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
import test_export_diagnostic as original_tests
from capacity.ci_run import TOTAL_SECONDS, Coordinator
from capacity.ci_safety import READS
from capacity.export_jobs_diagnostic_driver import JobProbeFailure
from capacity.export_jobs_diagnostic_prescriptions import (
    expected_content,
    expected_prescriptions,
)
from capacity.export_jobs_mixed_ci import BRANCH, MixedCoordinator
from capacity.export_jobs_mixed_driver import reader_targets
from capacity.export_jobs_mixed_receipt import (
    check_scenario,
    cycle_proofs,
    mixed_public_receipt,
)
from test_export_jobs_diagnostic import checks, report


@pytest.fixture
def isolated_source(monkeypatch):
    yield from original_tests.source.__wrapped__(monkeypatch)


def complete_report():
    value = report()
    value["spans"] = [
        {"route": route, "offset_ms": offset, "duration_ms": 10, "status": 200}
        for route in READS
        for offset in [
            *[1010 + 60000 * n for n in range(5)],
            *[2005 + 60000 * n for n in range(5)],
            *[4000 + 100 * n for n in range(140)],
        ]
    ]
    value["job_cycles"] = []
    for n in range(5):
        cycle = {
            "outcome": copy.deepcopy(value["job_outcome"]),
            "job_checks": copy.deepcopy(value["metrics"]["job_checks"]),
            "metrics": copy.deepcopy(value["metrics"]),
            "page_spans": [
                {
                    "route": "workouts/export-page",
                    "offset_ms": 2000 + 60000 * n + 50 * i,
                    "duration_ms": 20,
                    "status": 200,
                }
                for i in range(19)
            ],
        }
        cycle["job_checks"].update(cycle_count=n + 1, cancelled_count=n + 1)
        cycle["metrics"]["origin_timestamp"] += 60 * n
        cycle["metrics"]["stages"]["aes_encrypt"]["bytes"] = 61231576
        value["job_cycles"].append(cycle)
    for route in READS:
        value["routes"][route].update(count=150, statuses={"200": 150})
    for route, status, count in (
        ("workouts/export-admit", "202", 5),
        ("workouts/export-page", "200", 95),
        ("workouts/export-cancel", "200", 5),
    ):
        value["routes"][route].update(count=count, statuses={status: count})
    return value


def test_both_phases_preserve_same_anchored_recipes_demand():
    assert sum(len(reader_targets(n)) for n in range(8)) == 150
    for n in range(8):
        targets = reader_targets(n, 100)
        assert targets[0] == 100 + 2 * n
        assert all(b - a == 16 for a, b in pairwise(targets))
        assert max(targets) < 400


def test_five_independent_content_ack_and_overlap_proofs():
    proofs, good = cycle_proofs(complete_report())
    assert good and len(proofs) == 5
    assert all(row["responsive_concurrency"] for row in proofs)


@pytest.mark.parametrize(
    "section,key,value",
    [
        ("outcome", "prescriptions_matched", False),
        ("outcome", "versions_rows", 189),
        ("outcome", "pages_read", 18),
        ("outcome", "admission_ms", 1001),
        ("job_checks", "actual_end_ack_count", 0),
        ("job_checks", "ack_completion_ms", 120001),
        ("job_checks", "deadline_window_ms", 120001),
        ("job_checks", "expiry_window_ms", 600001),
        ("job_checks", "source_frames_retired", False),
        ("job_checks", "worker_pending_ack_count", 1),
        ("job_checks", "active_slot_count", 1),
        ("job_checks", "snapshot_count", 1),
        ("job_checks", "cycle_count", 3),
    ],
)
def test_one_bad_cycle_cannot_hide_in_other_four(section, key, value):
    data = complete_report()
    data["job_cycles"][3][section][key] = value
    assert not cycle_proofs(data)[1]


def test_changed_cipher_stage_and_history_volume_fail():
    data = complete_report()
    data["job_cycles"][2]["metrics"]["stages"]["aes_encrypt"]["bytes"] -= 1
    assert not cycle_proofs(data)[1]
    data = complete_report()
    data["job_cycles"][2]["metrics"]["stages"]["page_writer_commit"]["completed"] = 18
    assert not cycle_proofs(data)[1]


@pytest.mark.parametrize(
    "field,value",
    [("unsettled_requests", 1), ("dropped_spans", 1), ("completed", False)],
)
def test_interrupted_or_truncated_evidence_cannot_pass(field, value):
    data = complete_report()
    data[field] = value
    assert not cycle_proofs(data)[1]


def test_empty_gap_is_not_download_overlap_and_slow_witness_fails():
    data = complete_report()
    for row in data["spans"]:
        if row["offset_ms"] == 2005 + 60000 * 3:
            row["offset_ms"] = 2025 + 60000 * 3
    assert not cycle_proofs(data)[1]
    data = complete_report()
    for row in data["spans"]:
        if row["offset_ms"] == 1010 + 60000 * 3:
            row["duration_ms"] = 501
    assert not cycle_proofs(data)[1]


def test_missing_round_or_export_cycle_fails_without_retries():
    data = complete_report()
    receipt = {"passed": True}
    data["routes"]["/up"].update(count=149, statuses={"200": 149})
    check_scenario(data, receipt, "baseline")
    assert not receipt["passed"]
    data = complete_report()
    data["job_cycles"].pop()
    assert not cycle_proofs(data)[1]


def test_public_receipt_is_numeric_and_keeps_cleanup_failure():
    data = complete_report()
    phase = {"passed": True, "routes": data["routes"]}
    check_scenario(data, phase, "mixed")
    phase["background_export_cycles"][0]["outcome"]["private_payload"] = "DO_NOT_COPY"
    safe = mixed_public_receipt(
        {"passed": True, "cleaned_owned_resources": False, "phases": {"mixed": phase}}
    )
    text = json.dumps(safe)
    assert (
        "DO_NOT_COPY" not in text
        and "origin_timestamp" not in text
        and "page_spans" not in text
    )
    assert not safe["passed"] and len(text.encode()) < 100 * 1024
    assert len(safe["phases"]["mixed"]["background_export_cycles"]) == 5


def test_old_defaults_and_new_branch_do_not_dispatch_old_jobs():
    assert Coordinator.driver_module == "capacity.driver"
    assert MixedCoordinator.driver_module == "capacity.export_jobs_mixed_driver"
    assert TOTAL_SECONDS == 1900 and BRANCH == "codex/workouts-export-jobs-mixed"
    root = Path(__file__).resolve().parents[3]
    workflows = root / ".github/workflows"
    old = (workflows / "workouts-capacity.yml").read_text()
    assert old.count("github.head_ref != 'codex/workouts-export-jobs-mixed'") == 2
    assert old.count("github.ref_name != 'codex/workouts-export-jobs-mixed'") == 2
    new = (workflows / "workouts-export-jobs-mixed.yml").read_text()
    assert "timeout-minutes: 35" in new and "persist-credentials: false" in new
    assert "if: always()" in new and "retention-days: 1" in new


@pytest.mark.asyncio
async def test_repeated_instrumentation_is_five_bounded_sequential_builds(
    isolated_source, monkeypatch
):
    svc, _, instrument = isolated_source
    calls = []

    async def original(*args, **kwargs):
        calls.append((args, kwargs))
        return "fixture-only"

    monkeypatch.setattr(svc.PrivateExportService, "create", original)
    cleanup = instrument.install(
        monkeypatch.setattr, wrap_singleton=False, max_builds=5
    )
    try:
        for index in range(5):
            assert await svc.PrivateExportService.create(index) == "fixture-only"
            assert instrument.snapshot()["stages"]["build_total"]["completed"] == 1
        with pytest.raises(RuntimeError):
            await svc.PrivateExportService.create(5)
        assert len(calls) == 5
    finally:
        cleanup()


# Full fixture bytes remain in the test process, outside any API memory budget.
# Independent expected hashes are computed separately from expected_content;
# each successful driver cycle still decodes/checks all190+190 original rows.
@pytest.fixture(scope="module")
def full_transport_fixture():
    hashes = expected_prescriptions()
    pages = []
    placeholder = "00000000-0000-4000-8000-ffffffffffff"
    for page in range(19):
        datasets = {}
        for name in ("workouts", "workout_versions"):
            rows = []
            for index in range(page * 10, (page + 1) * 10):
                content = expected_content(index)
                assert len(content["notes"]) == 40
                assert all(len(note) == 4000 for note in content["notes"])
                rows.append(
                    {
                        "id": f"{name}-{index}",
                        "workout_id": f"workouts-{index}"
                        if name == "workout_versions"
                        else None,
                        "revision": 1,
                        "content": {**content, "id": f"workouts-{index}"},
                    }
                )
            datasets[name] = rows
        body = {
            "snapshot_id": placeholder,
            "page": page,
            "page_count": 19,
            "export": {
                "offset": page * 10,
                "limit": 10,
                "schema_version": 1,
                "enrollment": {"generation": 1},
                "profile_revision": 0,
                "profile": None,
                "grants": [],
                "ai_consent": None,
                "totals": {"workouts": 190, "workout_versions": 190},
                "has_more": {"workouts": page < 18, "workout_versions": page < 18},
                "datasets": datasets,
            },
        }
        pages.append(json.dumps(body, separators=(",", ":")).encode())
    return hashes, tuple(pages), placeholder.encode()


class MixedTransportFixture:
    def __init__(self, full, corruption=None):
        self.hashes, self.pages, self.placeholder = full
        self.corruption = corruption
        self.now = datetime(2026, 10, 11, tzinfo=timezone.utc).timestamp()
        self.sleeps, self.requests, self.jobs, self.cancelled = [], [], [], []
        self.page_count = 0

    async def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds

    def receipt(self, status):
        record = self.jobs[-1]
        value = {
            "schema_version": 1,
            "generation": 1,
            "id": record["id"],
            "request_id": record["request_id"],
            "status": status,
            "admitted_at": record["admitted"].isoformat(),
            "deadline_at": (record["admitted"] + timedelta(seconds=120)).isoformat(),
            "expires_at": (record["admitted"] + timedelta(seconds=600)).isoformat(),
            "cleanup_pending": False,
            "manifest": None,
        }
        if status == "ready":
            value["manifest"] = {
                "schema_version": 1,
                "generation": 1,
                "id": record["snapshot"],
                "page_size": 10,
                "page_count": 19,
                "totals": {"workouts": 190, "workout_versions": 190},
            }
            if self.corruption == "foreign_job":
                value["id"] = str(UUID(int=999))
            elif self.corruption == "foreign_request":
                value["request_id"] = str(UUID(int=998))
            elif self.corruption == "wrong_generation":
                value["generation"] = 2
            elif self.corruption == "refreshed_deadline":
                value["admitted_at"] = (
                    record["admitted"] + timedelta(seconds=4)
                ).isoformat()
                value["deadline_at"] = (
                    record["admitted"] + timedelta(seconds=124)
                ).isoformat()
                value["expires_at"] = (
                    record["admitted"] + timedelta(seconds=604)
                ).isoformat()
        return value

    async def serve(self, request):
        path = request.url.path
        self.requests.append((request.method, path))
        assert request.headers["X-Hafa-Account-ID"] == "capacity-22"
        assert request.headers["X-Workouts-Generation"] == "1"
        if request.method == "POST" and path == "/api/v1/workouts/export/jobs":
            number = len(self.jobs) + 1
            request_id = json.loads(request.content)["request_id"]
            UUID(request_id)
            assert request_id not in {row["request_id"] for row in self.jobs}
            self.jobs.append(
                {
                    "id": str(UUID(int=number)),
                    "snapshot": str(UUID(int=100 + number)),
                    "request_id": request_id,
                    "admitted": datetime.fromtimestamp(self.now, timezone.utc),
                }
            )
            return httpx.Response(202, json=self.receipt("queued"))
        assert self.jobs
        current = self.jobs[-1]
        if (
            request.method == "GET"
            and path == "/api/v1/workouts/export/jobs/" + current["id"]
        ):
            return httpx.Response(200, json=self.receipt("ready"))
        if (
            request.method == "POST"
            and path == "/api/v1/workouts/export/jobs/" + current["id"] + "/cancel"
        ):
            assert current["id"] not in self.cancelled
            self.cancelled.append(current["id"])
            return httpx.Response(200, json=self.receipt("cancelled"))
        if path == "/capacity/export-jobs-mixed":
            status = 5 if current["id"] in self.cancelled else 4
            proof = checks(status)
            proof.update(
                cycle_count=len(self.jobs), cancelled_count=len(self.cancelled)
            )
            if self.corruption == "missing_ack" or (
                self.corruption == "missing_ack_after_cancel" and status == 5
            ):
                proof["actual_end_ack_count"] = 0
            elif self.corruption == "source_not_retired":
                proof["source_frames_retired"] = False
            elif self.corruption == "heartbeat_not_retired":
                proof["worker_heartbeat_task_count"] = 1
            return httpx.Response(200, json={"job_checks": proof})
        assert request.method == "GET" and path.startswith(
            "/api/v1/workouts/export/snapshots/" + current["snapshot"] + "/pages/"
        )
        page = int(path.rsplit("/", 1)[1])
        self.page_count += 1
        payload = self.pages[page].replace(
            self.placeholder, current["snapshot"].encode()
        )
        if page == 0 and self.corruption in {
            "notes",
            "reps",
            "foreign_snapshot",
            "page_generation",
            "cross_cycle_profile",
        }:
            body = json.loads(payload)
            data = body["export"]
            if self.corruption == "notes":
                row = data["datasets"]["workouts"][0]["content"]
                row["notes"][0] = row["notes"][0][:-1]
            elif self.corruption == "reps":
                data["datasets"]["workout_versions"][0]["content"]["blocks"][0][
                    "exercises"
                ][0]["reps_min"] += 1
            elif self.corruption == "foreign_snapshot":
                body["snapshot_id"] = str(UUID(int=999))
            elif self.corruption == "page_generation":
                data["enrollment"]["generation"] = 2
            elif len(self.jobs) == 2:
                data["profile_revision"] = 1
                data["profile"] = {"readiness": "ready"}
            payload = json.dumps(body, separators=(",", ":")).encode()
        return httpx.Response(
            200, content=payload, headers={"content-type": "application/json"}
        )

    async def driver(self, monkeypatch, tmp_path):
        from capacity import export_jobs_mixed_driver as module

        # Rebind THIS module only; never monkeypatch shared asyncio/time objects.
        monkeypatch.setattr(
            module,
            "asyncio",
            SimpleNamespace(sleep=self.sleep, to_thread=asyncio.to_thread),
        )
        monkeypatch.setattr(
            module,
            "time",
            SimpleNamespace(time=lambda: self.now, monotonic=time.monotonic),
        )
        monkeypatch.setattr(module, "expected_prescriptions", lambda: dict(self.hashes))
        driver = module.MixedDriver(tmp_path)
        await driver.client.aclose()
        driver.client = httpx.AsyncClient(
            base_url="http://fixture.invalid", transport=httpx.MockTransport(self.serve)
        )
        driver.begin_trace(tmp_path / "private-full-export.json")
        return driver


@pytest.mark.asyncio
async def test_new_driver_executes_five_full_history_exports_and_same_handle_cancels(
    monkeypatch, tmp_path, full_transport_fixture
):
    transport = MixedTransportFixture(full_transport_fixture)
    original_sleep, original_wall = asyncio.sleep, time.time
    driver = await transport.driver(monkeypatch, tmp_path)
    try:
        for _ in range(5):
            await driver.export_snapshot()
        assert asyncio.sleep is original_sleep and time.time is original_wall
        assert transport.sleeps == [4] * 5
        assert len(driver.cycles) == 5
        assert len({row["id"] for row in transport.jobs}) == 5
        assert len({row["request_id"] for row in transport.jobs}) == 5
        assert transport.cancelled == [row["id"] for row in transport.jobs]
        assert transport.page_count == 95
        routes = driver.report()["routes"]
        for route, count in {
            "workouts/export-admit": 5,
            "workouts/export-page": 95,
            "workouts/export-cancel": 5,
        }.items():
            assert routes[route]["count"] == count and routes[route]["unexpected"] == 0
        for cycle in driver.cycles:
            outcome = cycle["outcome"]
            assert outcome["workouts_rows"] == outcome["versions_rows"] == 190
            assert outcome["pages_read"] == 19 and outcome["prescriptions_matched"]
            assert (
                outcome["ready_actual_end_verified"] and outcome["same_job_cancelled"]
            )
            assert outcome["wire_bytes"] > 61000000
        assert not driver.pending and driver.dropped == 0
    finally:
        driver.trace_stream.close()
        await driver.client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "corruption,error,pages,cancels",
    [
        ("missing_ack", "ack_failed", 0, 0),
        ("source_not_retired", "ack_failed", 0, 0),
        ("heartbeat_not_retired", "ack_failed", 0, 0),
        ("foreign_job", "identity_failed", 0, 0),
        ("foreign_request", "identity_failed", 0, 0),
        ("wrong_generation", "identity_failed", 0, 0),
        ("refreshed_deadline", "deadline_failed", 0, 0),
        ("notes", "pages_failed", 1, 0),
        ("reps", "pages_failed", 1, 0),
        ("foreign_snapshot", "pages_failed", 1, 0),
        ("page_generation", "pages_failed", 1, 0),
        ("missing_ack_after_cancel", "cleanup_failed", 19, 1),
    ],
)
async def test_new_driver_failure_keeps_original_admission_without_replay(
    monkeypatch, tmp_path, full_transport_fixture, corruption, error, pages, cancels
):
    transport = MixedTransportFixture(full_transport_fixture, corruption)
    driver = await transport.driver(monkeypatch, tmp_path)
    try:
        with pytest.raises(JobProbeFailure, match=error):
            await driver.export_snapshot()
        assert len(transport.jobs) == 1 and driver.cycles == []
        assert transport.page_count == pages and len(transport.cancelled) == cancels
        assert (
            sum(
                method == "POST" and path == "/api/v1/workouts/export/jobs"
                for method, path in transport.requests
            )
            == 1
        )
        assert transport.sleeps == [4]
        assert not driver.pending
    finally:
        driver.trace_stream.close()
        await driver.client.aclose()


@pytest.mark.asyncio
async def test_new_driver_rejects_profile_change_across_complete_original_exports(
    monkeypatch, tmp_path, full_transport_fixture
):
    transport = MixedTransportFixture(full_transport_fixture, "cross_cycle_profile")
    driver = await transport.driver(monkeypatch, tmp_path)
    try:
        await driver.export_snapshot()
        assert (
            len(driver.cycles) == 1
            and driver.cycles[0]["outcome"]["prescriptions_matched"]
        )
        with pytest.raises(JobProbeFailure, match="pages_failed"):
            await driver.export_snapshot()
        assert len(driver.cycles) == 1 and len(transport.jobs) == 2
        assert transport.page_count == 20 and len(transport.cancelled) == 1
        assert transport.sleeps == [4, 4]
        assert driver.report()["routes"]["workouts/export-admit"]["count"] == 2
        assert driver.export_static == [0, None, [], None]
        assert not driver.pending
    finally:
        driver.trace_stream.close()
        await driver.client.aclose()


class ImmediateScheduleClock:
    def __init__(self, jitter=0):
        self.now, self.jitter, self.sleeps = 0.0, jitter, []

    async def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds + self.jitter


def scoped_scheduler(monkeypatch, clock, **extra):
    from capacity import export_jobs_mixed_driver as module

    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: clock.now))
    monkeypatch.setattr(module, "asyncio", SimpleNamespace(sleep=clock.sleep, **extra))
    return module


@pytest.mark.asyncio
async def test_actual_heavy_scheduler_stops_before_missed_next_cycle(monkeypatch):
    clock = ImmediateScheduleClock()
    module = scoped_scheduler(monkeypatch, clock)
    calls = []

    async def heavy(index, mixed):
        calls.append((index, mixed, clock.now))
        clock.now += 62  # A valid <=120s export crosses the next60s anchor.

    with pytest.raises(module.AcceptanceFailure, match="workload_slot_missed"):
        await module.heavy_cycles(SimpleNamespace(media_and_chat=heavy), True, 0)
    assert calls == [(0, True, 0)] and clock.sleeps == [0]
    assert clock.now == 62  # No clock reset, catch-up turn or replay.


@pytest.mark.asyncio
async def test_actual_reader_scheduler_stops_before_missed_next_round(monkeypatch):
    clock = ImmediateScheduleClock()
    module = scoped_scheduler(monkeypatch, clock)
    calls = []

    async def read(index, mixed):
        calls.append((index, mixed, clock.now))
        clock.now += 18

    with pytest.raises(module.AcceptanceFailure, match="workload_slot_missed"):
        await module.protected_reader(SimpleNamespace(lightweight=read), 0, False, 0)
    assert calls == [(0, False, 0)] and clock.sleeps == [0] and clock.now == 18


@pytest.mark.asyncio
async def test_post_sleep_lateness_also_fails_before_issuing_any_request(monkeypatch):
    clock = ImmediateScheduleClock(jitter=1.01)
    module = scoped_scheduler(monkeypatch, clock)
    calls = []

    async def read(index, mixed):
        calls.append(index)

    with pytest.raises(module.AcceptanceFailure, match="workload_slot_missed"):
        await module.protected_reader(SimpleNamespace(lightweight=read), 0, False, 0)
    assert calls == [] and clock.sleeps == [0]


@pytest.mark.asyncio
@pytest.mark.parametrize("jitter", [0.2, 1.0])
async def test_actual_schedulers_accept_bounded_jitter_without_anchor_drift(
    monkeypatch, jitter
):
    clock = ImmediateScheduleClock(jitter)
    module = scoped_scheduler(monkeypatch, clock)
    reads = []
    heavies = []

    async def read(index, mixed):
        reads.append((index, mixed, clock.now))

    async def heavy(index, mixed):
        heavies.append((index, mixed, clock.now))

    await module.protected_reader(SimpleNamespace(lightweight=read), 1, True, 0)
    assert [
        round(now - target, 6) for (_, _, now), target in zip(reads, reader_targets(1))
    ] == [jitter] * len(reads)
    heavy_clock = ImmediateScheduleClock(jitter)
    module = scoped_scheduler(monkeypatch, heavy_clock)
    clock = heavy_clock
    await module.heavy_cycles(SimpleNamespace(media_and_chat=heavy), True, 0)
    assert [round(now - 60 * index, 6) for index, _, now in heavies] == [jitter] * 5
    assert [index for index, _, _ in heavies] == list(range(5))


@pytest.mark.asyncio
async def test_actual_workload_settles_all_siblings_on_missed_slot(monkeypatch):
    from capacity import export_jobs_mixed_driver as module

    real_sleep, real_wall, real_monotonic = asyncio.sleep, time.time, time.monotonic
    clock = SimpleNamespace(now=0.0, waiters=[])

    async def controlled_sleep(seconds):
        future = asyncio.get_running_loop().create_future()
        clock.waiters.append((clock.now + seconds, future))
        await future

    clock.sleep = controlled_sleep
    owned_tasks = []

    def start(coroutine):
        task = asyncio.create_task(coroutine)
        owned_tasks.append(task)
        return task

    scoped_scheduler(
        monkeypatch,
        clock,
        create_task=start,
        gather=asyncio.gather,
        timeout=asyncio.timeout,
    )
    entered = []
    retired = []
    heavy_calls = []
    held = asyncio.Event()

    async def read(index, mixed):
        entered.append(index)
        try:
            await held.wait()
        finally:
            retired.append(index)

    async def heavy(index, mixed):
        heavy_calls.append(index)
        await real_sleep(0)
        clock.now = 62

    async def poll():
        pass

    task = asyncio.create_task(
        module.run_workload(
            SimpleNamespace(lightweight=read, media_and_chat=heavy, poll=poll),
            True,
            300,
        )
    )
    try:
        for _ in range(20):
            await real_sleep(0)
        assert len(owned_tasks) == 10
        for target, future in clock.waiters:
            if target == 0 and not future.done():
                future.set_result(None)
        with pytest.raises(module.AcceptanceFailure, match="workload_slot_missed"):
            await asyncio.wait_for(task, 1)
        assert heavy_calls == [0] and entered == retired == [0]
        assert all(child.done() for child in owned_tasks)
        assert all(future.done() for _, future in clock.waiters)
        assert (
            asyncio.sleep is real_sleep
            and time.time is real_wall
            and time.monotonic is real_monotonic
        )
    finally:
        if not task.done():
            task.cancel()
        for child in owned_tasks:
            if not child.done():
                child.cancel()
        await asyncio.gather(task, *owned_tasks, return_exceptions=True)


def test_missed_slot_failure_survives_numeric_partial_receipt():
    from capacity.driver_diagnostics import (
        AcceptanceFailure,
        failure_code,
        partial_metadata,
    )

    error = AcceptanceFailure("workload_slot_missed")
    assert failure_code(error) == "workload_slot_missed"
    partial = partial_metadata({"failure_code": failure_code(error)})
    safe = mixed_public_receipt(
        {
            "cleaned_owned_resources": True,
            "passed": False,
            "phases": {"mixed": {"partial_outcomes": partial}},
        }
    )
    assert (
        safe["phases"]["mixed"]["partial_outcomes"]["driver_failure_code"]
        == "workload_slot_missed"
    )
    assert not safe["passed"]
