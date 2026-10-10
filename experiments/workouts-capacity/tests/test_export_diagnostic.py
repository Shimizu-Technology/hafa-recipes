"""Finite instrumentation/safety checks, not hosted capacity acceptance."""

import asyncio
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from capacity.ci_safety import SafetyError
from capacity.export_diagnostic_ci import ExportCoordinator
from capacity.export_diagnostic_instrument import (
    async_stage,
    rollback_call,
    source_call,
    sync_stage,
)
from capacity.export_diagnostic_metrics import Metrics, active, stack
from capacity.export_diagnostic_receipt import STAGES, diagnostic, receipt
from capacity.plan import environment


@pytest.fixture
def source(monkeypatch):
    for k, v in environment().items():
        monkeypatch.setenv(k, v)
    from app.config import get_settings

    get_settings.cache_clear()
    from app.domains.workouts import export_router
    from app.domains.workouts import export_service as svc
    from capacity import export_diagnostic_instrument as instrument

    monkeypatch.setattr(instrument, "latest", None)
    yield svc, export_router, instrument
    get_settings.cache_clear()


class DB:
    def __init__(self, store):
        self.store = store

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def connection(self, **kwargs):
        return self

    async def execute(self, *args, **kwargs):
        from capacity.export_diagnostic_instrument import query_event

        query_event()

    async def scalar(self, *args, **kwargs):
        await self.execute()
        return datetime.now(timezone.utc)

    async def get(self, model, identifier, **kwargs):
        await self.execute()
        return self.store.get(identifier)

    async def rollback(self):
        await self.execute()

    def add(self, value):
        if hasattr(value, "id"):
            self.store[value.id] = value


class Factory:
    def __init__(self):
        self.store = {}

    def __call__(self):
        return DB(self.store)

    def begin(self):
        return DB(self.store)


@pytest.mark.asyncio
@pytest.mark.parametrize("wrap_singleton", [False, True])
async def test_actual_original_create_retains_19_pages_encryption_finalization_and_one_shot(
    source, monkeypatch, wrap_singleton
):
    svc, router, instrument = source
    factory = Factory()

    async def no_op(*_, **__):
        pass

    async def membership(*_, **__):
        return SimpleNamespace(generation=1)

    async def privacy(*_, **__):
        return b"permission"

    async def guard(db, *_, **__):
        await db.scalar()

    from app.domains.workouts.export_context import SnapshotSourceContext

    prepared = []
    retired = []

    async def prepare(cls, db, owner, generation):
        await db.scalar()
        prepared.append((db, owner, generation))
        return SimpleNamespace(
            generation=generation,
            assert_scope=lambda *args: None,
            approve_page=lambda *args: None,
            require_guard=lambda *args: None,
            close=lambda: retired.append(True),
        )

    monkeypatch.setattr(SnapshotSourceContext, "prepare", classmethod(prepare))

    async def projection(response, user, db, limit, offset, *, source_context=None):
        assert source_context is not None
        await db.execute()
        return svc.ExportResponse(
            schema_version=1,
            generated_at=datetime.now(timezone.utc),
            enrollment={
                "enrolled": True,
                "generation": 1,
                "adult_confirmed": True,
                "shared_account_deletion_acknowledged": True,
                "enrolled_at": None,
            },
            profile=None,
            profile_revision=0,
            offset=offset,
            limit=limit,
            grants=[],
            ai_consent={"accepted": False, "accepted_at": None},
            datasets={"workouts": []},
            totals={"workouts": 190, "workout_versions": 190},
            has_more={"workouts": offset < 180},
        )

    for key, value in {
        "membership_for": membership,
        "privacy_digest": privacy,
        "cleanup_expired_exports": no_op,
        "try_export_slot": no_op,
        "guard_projection_memory": guard,
        "build_export_page": projection,
    }.items():
        monkeypatch.setattr(svc, key, value)
    monkeypatch.setattr(svc.PrivateExportService, "authorize", lambda *_: b"K" * 32)
    cleanup = instrument.install(monkeypatch.setattr, wrap_singleton=wrap_singleton)
    for method in ("execute", "scalar", "get"):
        monkeypatch.setattr(DB, method, source_call(getattr(DB, method)))
    original_rollback = DB.rollback

    async def rollback(db):
        assert retired == [True]
        return await original_rollback(db)

    monkeypatch.setattr(DB, "rollback", rollback_call(rollback))
    service = svc.PrivateExportService(factory)
    # Production instrumentation wraps a constructed builtin singleton. A
    # wrapper must not silently turn off its source inventory optimization.
    if wrap_singleton:
        service.page_source = router.private_exports.page_source
    else:
        assert service.page_source is svc.approved_export_page
        assert service._builtin_page_source is True
    try:
        manifest = await service.create(SimpleNamespace(id="synthetic"), 1)
        assert manifest.page_count == 19
        measured = instrument.snapshot()
        assert measured["complete"] and measured["pages"] == 19
        assert len(prepared) == 1
        assert measured["stages"]["source_inventory"]["completed"] == 1
        assert measured["stages"]["source_inventory"]["query_count"] == 1
        assert measured["stages"]["projection"]["completed"] == 19
        assert measured["stages"]["json_encode"]["completed"] == 19
        assert measured["stages"]["aes_encrypt"]["completed"] == 19
        assert measured["stages"]["page_writer_commit"]["completed"] == 19
        assert measured["stages"]["finalization"]["completed"] == 1
        assert measured["stages"]["size_guard"]["query_count"] == 19
        assert measured["stages"]["source_fetch_decode"]["calls"] > 19
        assert (
            measured["stages"]["source_fetch_decode"]["query_count"]
            == measured["stages"]["source_fetch_decode"]["calls"]
        )
        assert active.get() is None and stack.get() == ()
        with pytest.raises(RuntimeError, match="Only one"):
            await service.create(SimpleNamespace(id="synthetic"), 1)
        assert "synthetic" not in json.dumps(measured)
    finally:
        cleanup()


@pytest.mark.asyncio
async def test_wrappers_preserve_args_result_exceptions_cancellation_and_scope():
    calls = []

    async def original(*args, **kwargs):
        calls.append((args, kwargs))
        return "result"

    wrapped = async_stage("projection", original)
    assert await wrapped(1, k=2) == "result" and calls == [((1,), {"k": 2})]
    state = Metrics()
    token = active.set(state)
    try:
        assert await wrapped(3, k=4) == "result"

        async def blocked():
            raise asyncio.CancelledError()

        with pytest.raises(asyncio.CancelledError):
            await async_stage("projection", blocked)()
        assert state.stats["projection"]["failed"] == 1 and stack.get() == ()
        original_object = {"private": "unchanged"}
        assert sync_stage("json_encode", lambda: original_object)() is original_object
    finally:
        active.reset(token)


def report_fixture():
    stages = {
        s: {
            "calls": 1,
            "completed": 1,
            "failed": 0,
            "query_count": 0,
            "inclusive_wall_ms": 1,
            "max_wall_ms": 1,
            "sync_thread_cpu_ms": 0,
            "bytes": 0,
        }
        for s in STAGES
    }
    for s in (
        "size_guard",
        "projection",
        "json_encode",
        "aes_encrypt",
        "page_writer_commit",
    ):
        stages[s].update(calls=19, completed=19)
    stages["source_fetch_decode"]["query_count"] = 1
    stages["source_inventory"]["query_count"] = 1
    routes = {
        r: {
            "count": {"recipes/chat": 5, "workouts/export-page": 19}.get(r, 1),
            "unexpected": 0,
            "statuses": {
                "201"
                if r == "workouts/export-build"
                else "204"
                if r == "workouts/export-remove"
                else "200": 1
            },
            "p95_ms": 10,
            "p99_ms": 10,
        }
        for r in (
            "/up",
            "recipes/list",
            "recipes/detail",
            "recipes/search",
            "recipes/chat",
            "workouts/export-build",
            "workouts/export-page",
            "workouts/export-remove",
        )
    }
    for name, row in routes.items():
        row["count"] = (
            80
            if name in {"/up", "recipes/list", "recipes/detail", "recipes/search"}
            else row["count"]
        )
        row["statuses"] = {key: row["count"] for key in row["statuses"]}
    return {
        "completed": True,
        "unsettled_requests": 0,
        "dropped_spans": 0,
        "percentile_method": "nearest_rank",
        "metrics": {
            "complete": True,
            "pages": 19,
            "dropped_spans": 0,
            "inclusive_timings": True,
            "summed_nested_timings": False,
            "stages": stages,
            "query_count": 100,
            "spans": [],
            "origin_timestamp": 101,
        },
        "origin_timestamp": 100,
        "routes": routes,
        "spans": [],
        "status": {"provider_attempts": {"chat": 5, "cover": 0, "extraction": 0}},
    }


def observations():
    return [
        {
            "memory_peak": 100,
            "memory_current": 100,
            "cpu_stat": {},
            "processes": [],
            "cpu_percent": 0,
        }
    ]


def test_completed_diagnostic_can_fail_latency_without_waiver_and_never_r04():
    report = report_fixture()
    report["routes"]["workouts/export-build"]["p95_ms"] = 14416
    data = diagnostic(
        report,
        observations(),
        {"completed": True, "local_memory_gate": "passed"},
        {
            "recipe_active": 0,
            "workout_active": 0,
            "extract_jobs": 0,
            "cover_jobs": 0,
            "export_snapshots": 0,
            "export_pages": 0,
        },
        oom=False,
    )
    assert (
        data["complete"] and data["safety_passed"] and not data["latency_slos_passed"]
    )
    safe = receipt({"cleaned_owned_resources": True, "passed": True}, data)
    assert (
        not safe["passed"]
        and not safe["r04_closed"]
        and safe["diagnostic"]["container_oom_killed"] is False
    )


@pytest.mark.parametrize(
    "change",
    [
        lambda r: r.update(completed=False),
        lambda r: r.update(unsettled_requests=1),
        lambda r: r.update(dropped_spans=1),
        lambda r: r["metrics"].update(pages=18),
        lambda r: r["routes"]["recipes/detail"].update(statuses={"404": 1}),
        lambda r: r["status"]["provider_attempts"].update(extraction=1),
    ],
)
def test_partial_wrong_status_or_unintended_work_refuses_complete(change):
    report = report_fixture()
    change(report)
    data = diagnostic(report, [], {}, None)
    assert not data["complete"] and not data["safety_passed"]


def test_public_numeric_whitelist_offsets_and_private_refusal():
    safe = receipt(
        {"cleaned_owned_resources": True},
        {
            "origin_timestamp": 100,
            "stage_origin_timestamp": 101,
            "stage_spans": [
                {
                    "stage": "projection",
                    "offset_ms": 10,
                    "duration_ms": 20,
                    "query_count": 3,
                    "sync_thread_cpu_ms": 0,
                    "private": "DROP",
                }
            ],
            "request_spans": [
                {
                    "route": "recipes/search",
                    "offset_ms": 999,
                    "duration_ms": 30,
                    "status": 200,
                    "secret": "DROP",
                }
            ],
        },
    )
    assert safe["diagnostic"]["stage_spans"][0]["offset_ms"] == 1010
    assert "DROP" not in json.dumps(safe)
    with pytest.raises(SafetyError):
        receipt({}, {"query_count": float("nan")})
    with pytest.raises(SafetyError):
        receipt({}, {"request_spans": [{"route": "/private-URL"}]})


def test_coordinator_preparation_api_flags_limits_and_existing_capacity_skip(tmp_path):
    c = ExportCoordinator(
        Path(__file__).resolve().parents[3], tmp_path / "work", tmp_path / "receipt"
    )
    c.pg = "a" * 64
    c.run_id = "ci-123-1"
    c.plan_root = tmp_path
    c.image = "sha256:" + "b" * 64
    assert c.preparation_steps() == [
        ("seed", "seed_actual_migrations_once_empty_owned_db", 180)
    ]
    args = c.runtime_argv("api", phase="mixed")
    for flag in (
        "JOB_WORKER_ENABLED=false",
        "WORKOUTS_IMPORTS_ENABLED=false",
        "CAPACITY_PHASE=diagnostic",
        "CAPACITY_COVER_SCENARIOS=false",
    ):
        assert flag in args
    assert (
        args[args.index("--memory") + 1] == "512m"
        and args[args.index("--memory-swap") + 1] == "512m"
    )
    assert args[args.index("--cpus") + 1] == "0.5"
    assert c.api_command()[4] == "capacity.export_diagnostic_app:app"
    workflow = (c.repo / ".github/workflows/workouts-capacity.yml").read_text()
    assert workflow.count("github.head_ref != 'codex/workouts-export-diagnostic'") == 2
    assert workflow.count("github.ref_name != 'codex/workouts-export-diagnostic'") == 2
    new = (c.repo / ".github/workflows/workouts-export-diagnostic.yml").read_text()
    assert "pull_request_target" not in new and "persist-credentials: false" in new
    assert "if: always()" in new and "retention-days: 1" in new


def test_host_import_requires_only_standard_library_and_no_provider_import():
    result = subprocess.run(
        [
            sys.executable,
            "-S",
            "-c",
            "import capacity.export_diagnostic_ci;import sys;assert 'httpx' not in sys.modules;assert 'sqlalchemy' not in sys.modules",
        ],
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.asyncio
async def test_actual_driver_request_cancelled_by_run_is_retained_before_atomic_report(
    monkeypatch, tmp_path
):
    import httpx
    from capacity import export_diagnostic_driver as driver

    held = asyncio.Event()

    async def transport(request):
        held.set()
        await asyncio.Event().wait()

    class TestProbe(driver.Probe):
        async def readers(self, index):
            pass

        async def export(self):
            await self.request("GET", "/up")

        async def chat(self):
            await held.wait()
            raise ValueError("private fixture exception")

    original_init = TestProbe.__init__

    def init(self):
        original_init(self)
        # No network call occurred on the replaced empty client.
        self.client = httpx.AsyncClient(
            base_url="http://fixture.invalid", transport=httpx.MockTransport(transport)
        )

    monkeypatch.setattr(TestProbe, "__init__", init)
    monkeypatch.setattr(driver, "Probe", TestProbe)
    path = tmp_path / "partial.json"
    with pytest.raises(ValueError, match="private fixture"):
        await driver.run(path)
    report = json.loads(path.read_text())
    assert not report["completed"] and report["unsettled_requests"] == 0
    assert report["routes"]["/up"]["statuses"] == {"0": 1}
    assert report["spans"][0]["status"] == 0
    assert "private fixture exception" not in path.read_text()
    assert not Path(str(path) + ".tmp").exists()


@pytest.mark.asyncio
async def test_query_attribution_does_not_count_unrelated_request_context():
    from capacity.export_diagnostic_instrument import query_event

    state = Metrics()
    query_event()  # no active export

    async def unrelated():
        assert active.get() is None
        query_event()

    other = asyncio.create_task(unrelated())
    token = active.set(state)
    try:
        with state.measure("projection"):
            query_event()
            await other
        assert state.queries == 1 and state.stats["projection"]["query_count"] == 1
    finally:
        active.reset(token)


def test_json_measurement_never_changes_codec_or_adds_utf8_encoding():
    class Original(str):
        def encode(self, *args, **kwargs):
            raise AssertionError("Unrequested extra encoding")

    token = active.set(Metrics())
    try:
        value = Original("same source JSON")
        assert sync_stage("json_encode", lambda: value)() is value
    finally:
        active.reset(token)


@pytest.mark.parametrize("oom", [True, None])
def test_final_oom_true_or_unknown_cannot_pass_safety(oom):
    data = diagnostic(
        report_fixture(),
        observations(),
        {"completed": True, "local_memory_gate": "passed"},
        {
            "recipe_active": 0,
            "workout_active": 0,
            "extract_jobs": 0,
            "cover_jobs": 0,
            "export_snapshots": 0,
            "export_pages": 0,
        },
        oom=oom,
    )
    assert not data["safety_passed"]
    assert not receipt({"cleaned_owned_resources": True, "passed": True}, data)[
        "passed"
    ]


@pytest.mark.parametrize(
    "change",
    [
        lambda stages, stage: stages.pop(stage),
        lambda stages, stage: stages[stage].update(completed=0),
        lambda stages, stage: stages[stage].update(query_count=0),
        lambda stages, stage: stages[stage].update(failed=1),
    ],
)
@pytest.mark.parametrize("stage", ["source_fetch_decode", "source_inventory"])
def test_missing_source_evidence_is_incomplete(change, stage):
    report = report_fixture()
    counts = {
        "recipe_active": 0,
        "workout_active": 0,
        "extract_jobs": 0,
        "cover_jobs": 0,
        "export_snapshots": 0,
        "export_pages": 0,
    }
    # Missing idle evidence must not make every variant fail trivially.
    assert diagnostic(report, [], {}, counts)["complete"]
    change(report["metrics"]["stages"], stage)
    assert not diagnostic(report, [], {}, counts)["complete"]


def test_recovered_flushed_trace_preserves_origin_end_and_unfinished_request(tmp_path):
    from capacity.export_diagnostic_trace import recover

    output = tmp_path / "report.json"
    rows = [
        {"origin_timestamp": 100},
        {
            "request_number": 1,
            "timestamp": 101,
            "route": "recipes/chat",
            "event": "start",
        },
        {
            "request_number": 1,
            "timestamp": 101.5,
            "route": "recipes/chat",
            "event": "end",
            "milliseconds": 500,
            "status": 200,
        },
        {"request_number": 2, "timestamp": 102, "route": "/up", "event": "start"},
    ]
    trace = Path(str(output) + ".requests.jsonl")
    trace.write_text("\n".join(json.dumps(r) for r in rows) + '\n{"partial"')
    data = recover(output)
    assert not data["completed"] and data["origin_timestamp"] == 100
    assert data["unsettled_requests"] == 1 and data["spans"][0]["offset_ms"] == 1000
    assert data["routes"]["recipes/chat"]["count"] == 1
    trace.write_text("{bad interior}\n" + json.dumps(rows[0]))
    with pytest.raises(SafetyError):
        recover(output)


@pytest.mark.asyncio
async def test_signal_entry_cancels_task_and_waits_for_report_cleanup(monkeypatch):
    from capacity import export_diagnostic_driver as driver

    held = asyncio.Event()
    cleaned = []

    async def fake_run(output):
        try:
            held.set()
            await asyncio.Event().wait()
        finally:
            cleaned.append(True)

    monkeypatch.setattr(driver, "run", fake_run)
    callbacks = {}
    loop = asyncio.get_running_loop()
    monkeypatch.setattr(
        loop, "add_signal_handler", lambda sig, fn: callbacks.update({sig: fn})
    )
    monkeypatch.setattr(loop, "remove_signal_handler", lambda sig: callbacks.pop(sig))
    task = asyncio.create_task(driver.entry("synthetic"))
    await held.wait()
    import signal

    callbacks[signal.SIGTERM]()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cleaned == [True] and not callbacks


def test_interrupted_observer_summary_retains_request_and_stage_attribution(tmp_path):
    c = ExportCoordinator(
        Path(__file__).resolve().parents[3], tmp_path / "work", tmp_path / "receipt"
    )
    c.plan_root = tmp_path
    root = tmp_path / "results"
    root.mkdir()
    report = report_fixture()
    report["spans"] = [
        {"route": "recipes/search", "offset_ms": 12, "duration_ms": 20, "status": 200}
    ]
    (root / "export-diagnostic.json").write_text(json.dumps(report))
    (root / "diagnostic-external.jsonl").write_text(
        json.dumps(observations()[0]) + "\n"
    )
    (root / "diagnostic-external.jsonl.summary.json").write_text("{interrupted")
    c.collect(True)
    assert (
        c.data["query_count"] == 100 and c.data["request_spans"][0]["offset_ms"] == 12
    )
    assert c.data["stages"]["projection"]["completed"] == 19
    assert not c.data["observer_completed"] and not c.data["safety_passed"]
    c.summary["cleaned_owned_resources"] = True
    safe = receipt(c.summary, c.data)
    assert (
        not safe["passed"]
        and safe["diagnostic"]["stages"]["projection"]["completed"] == 19
    )


@pytest.mark.parametrize("count", [1, 79, 81])
def test_protected_schedule_requires_exact_80_calls_per_category(count):
    report = report_fixture()
    report["routes"]["recipes/search"].update(count=count, statuses={"200": count})
    assert not diagnostic(report, [], {}, None)["complete"]
