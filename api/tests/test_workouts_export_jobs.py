"""Disposable PostgreSQL receipts, shared permits, privacy and fault fences."""

import asyncio
import importlib
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select, text

from app.domains.workouts import export_job_router
from app.domains.workouts.export_job_execution import require_execution
from app.domains.workouts.export_job_models import WorkoutsExportJob, WorkoutsExportJobSlot
from app.domains.workouts.export_job_runtime import verify_export_job_schema
from app.domains.workouts.export_job_service import ExportJobCoordinator
from app.domains.workouts.export_job_worker import ExportJobWorker
from app.domains.workouts.export_models import WorkoutsExportPage, WorkoutsExportSnapshot
from app.domains.workouts.export_service import PrivateExportService, invalidate_export_snapshots
from app.domains.workouts.lifecycle import membership_for
from app.models.identity import AppUser
from tests.test_workouts_data_integration import GENERATION, data_api, settings, user  # noqa: F401
from tests.test_workouts_export_snapshots import (  # noqa: F401
    add,
    assert_error,
    snapshots,
)


@pytest.fixture
async def jobs(snapshots, monkeypatch):  # noqa: F811
    api = snapshots
    configured = settings(workouts_export_jobs_enabled=True, job_worker_enabled=True)
    await importlib.import_module("migrations.045_add_workouts_export_jobs").run_migration(
        configured=configured, migration_engine=api.engine
    )
    api.coordinator = ExportJobCoordinator(api.sessions, settings=configured)
    api.exports = PrivateExportService(api.sessions, settings=configured)
    api.worker = ExportJobWorker(api.coordinator, api.exports)
    monkeypatch.setattr(export_job_router, "get_settings", lambda: configured)
    monkeypatch.setattr(export_job_router, "coordinator", api.coordinator)
    monkeypatch.setattr(export_job_router, "export_job_worker", api.worker)
    api.app.include_router(export_job_router.router)
    yield api
    assert await api.worker.stop()


async def admit(api):
    return await api.coordinator.admit(user(), 1, uuid4())


async def drain(api):
    for _ in range(100):
        await api.worker.tick()
        async with api.sessions() as db:
            if (await db.get(WorkoutsExportJobSlot, 1)).active_job_id is None:
                return
        await asyncio.sleep(0.01)
    pytest.fail("Owned worker did not acknowledge source end")


async def age(api, identifier, seconds):
    # Fault injection only in the disposable DB: preserves120/600 intervals.
    async with api.engine.begin() as db:
        await db.execute(
            text(
                "ALTER TABLE workouts_export_jobs DISABLE TRIGGER fence_workouts_export_job_identity"
            )
        )
        await db.execute(
            text(
                "ALTER TABLE workouts_export_job_slot DISABLE TRIGGER fence_workouts_export_job_slot"
            )
        )
        await db.execute(
            text(
                "UPDATE workouts_export_jobs SET leased_until=leased_until-CAST(:delta AS interval), admitted_at=admitted_at-CAST(:delta AS interval), deadline_at=deadline_at-CAST(:delta AS interval), expires_at=expires_at-CAST(:delta AS interval) WHERE id=:id"
            ),
            {"delta": timedelta(seconds=seconds), "id": identifier},
        )
        await db.execute(
            text(
                "UPDATE workouts_export_job_slot SET leased_until=leased_until-CAST(:delta AS interval), admitted_at=admitted_at-CAST(:delta AS interval), deadline_at=deadline_at-CAST(:delta AS interval) WHERE active_job_id=:id"
            ),
            {"delta": timedelta(seconds=seconds), "id": identifier},
        )
        await db.execute(
            text(
                "ALTER TABLE workouts_export_jobs ENABLE TRIGGER fence_workouts_export_job_identity"
            )
        )
        await db.execute(
            text(
                "ALTER TABLE workouts_export_job_slot ENABLE TRIGGER fence_workouts_export_job_slot"
            )
        )


async def test_http_receipt_same_uuid_lookup_owner_generation(jobs):
    api = jobs
    request_id = uuid4()
    first = await api.client.post(
        "/api/v1/workouts/export/jobs", headers=GENERATION, json={"request_id": str(request_id)}
    )
    assert first.status_code == 202, first.text
    body = first.json()
    assert set(body) == {
        "schema_version",
        "id",
        "request_id",
        "generation",
        "status",
        "admitted_at",
        "deadline_at",
        "expires_at",
        "started_at",
        "finished_at",
        "failure_code",
        "cleanup_pending",
        "manifest",
    }
    assert body["status"] == "queued" and body["manifest"] is None
    again = await api.client.post(
        "/api/v1/workouts/export/jobs", headers=GENERATION, json={"request_id": str(request_id)}
    )
    assert again.json() == body
    lookup = await api.client.get(
        "/api/v1/workouts/export/jobs/by-request/" + str(request_id), headers=GENERATION
    )
    assert lookup.json() == body
    assert (
        await api.client.get(
            "/api/v1/workouts/export/jobs/" + body["id"],
            headers={**GENERATION, "X-Test-User": "other"},
        )
    ).status_code == 404
    assert (
        await api.client.get(
            "/api/v1/workouts/export/jobs/" + body["id"], headers={"X-Workouts-Generation": "2"}
        )
    ).status_code == 409
    cancelled = await api.client.post(
        "/api/v1/workouts/export/jobs/" + body["id"] + "/cancel", headers=GENERATION
    )
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert body["id"] == str((await api.coordinator.admit(user(), 1, request_id)).id)


async def test_two_replicas_idempotency_and_global_busy(jobs):
    api = jobs
    other = ExportJobCoordinator(api.sessions, settings=api.coordinator.settings)
    request = uuid4()
    a, b = await asyncio.gather(
        api.coordinator.admit(user(), 1, request), other.admit(user(), 1, request)
    )
    assert a.id == b.id
    await assert_error(other.admit(user("other"), 1, uuid4()), 429, "export_job_busy")
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportJob)) == 1
    await api.coordinator.cancel(user(), 1, a.id)


async def test_internal_ready_mask_page_fence_and_actual_end(jobs):
    api = jobs
    await add(api)
    receipt = await admit(api)
    execution = await api.coordinator.claim()
    manifest = await api.exports.create(user(), 1, execution=execution)
    masked = await api.coordinator.receipt(user(), 1, receipt.id)
    assert (
        masked.status == "running"
        and masked.cleanup_pending
        and masked.manifest is None
        and masked.finished_at is None
    )
    await assert_error(
        api.exports.read(user(), 1, manifest.id, page=0), 409, "export_snapshot_not_ready"
    )
    await api.coordinator.acknowledge_end(execution, None)
    ready = await api.coordinator.receipt(user(), 1, receipt.id)
    assert ready.status == "ready" and not ready.cleanup_pending and ready.manifest == manifest
    assert (
        len((await api.exports.read(user(), 1, manifest.id, page=0)).export.datasets["workouts"])
        == 1
    )
    await api.coordinator.cancel(user(), 1, receipt.id)
    await assert_error(api.exports.read(user(), 1, manifest.id, page=0), 404)
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportPage)) == 0


async def test_delayed_ack_never_exposes_late_ready(jobs):
    api = jobs
    receipt = await admit(api)
    execution = await api.coordinator.claim()
    await api.exports.create(user(), 1, execution=execution)
    await age(api, receipt.id, 121)
    await api.coordinator.acknowledge_end(execution, None)
    result = await api.coordinator.receipt(user(), 1, receipt.id)
    assert (
        result.status == "expired"
        and result.failure_code == "deadline_exceeded"
        and result.manifest is None
    )
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0


async def test_worker_complete_encrypted_history_and_replay(jobs):
    api = jobs
    for i in range(11):
        await add(api, f"Private job fixture {i}")
    request = uuid4()
    receipt = await api.coordinator.admit(user(), 1, request)
    await drain(api)
    ready = await api.coordinator.receipt(user(), 1, receipt.id)
    assert ready.status == "ready" and ready.manifest.page_count == 2
    assert ready.manifest.totals["workouts"] == ready.manifest.totals["workout_versions"] == 11
    async with api.sessions() as db:
        ciphertext = (await db.scalars(select(WorkoutsExportPage.ciphertext))).all()
        assert len(ciphertext) == 2 and all(
            b"Private job fixture" not in value for value in ciphertext
        )
    assert (await api.coordinator.admit(user(), 1, request)).id == receipt.id


async def test_unknown_started_erase_retains_global_slot(jobs):
    api = jobs
    receipt = await admit(api)
    execution = await api.coordinator.claim()
    async with api.sessions.begin() as db:
        await db.execute(delete(AppUser).where(AppUser.id == "owner"))
    await api.coordinator.maintain()
    async with api.sessions() as db:
        slot = await db.get(WorkoutsExportJobSlot, 1)
        assert slot.active_job_id == receipt.id and slot.started_at is not None
        assert await db.get(WorkoutsExportJob, receipt.id) is None
    await assert_error(api.coordinator.admit(user("other"), 1, uuid4()), 429, "export_job_busy")
    await assert_error(api.coordinator.recover_verified_death({"claim": "dead"}), 409)
    await api.coordinator.acknowledge_end(execution, "interrupted")


async def test_privacy_and_cancel_fence_stale_writer_until_actual_end(jobs):
    api = jobs
    receipt = await admit(api)
    execution = await api.coordinator.claim()
    async with api.sessions.begin() as db:
        await membership_for(db, "owner", generation=1, write=True)
        await invalidate_export_snapshots(db, "owner", 1)
    await assert_error(api.exports.create(user(), 1, execution=execution), 410)
    result = await api.coordinator.receipt(user(), 1, receipt.id)
    assert (
        result.status == "failed"
        and result.cleanup_pending
        and result.failure_code == "privacy_changed"
    )
    await assert_error(api.coordinator.admit(user("other"), 1, uuid4()), 429)
    await api.coordinator.acknowledge_end(execution, "privacy_changed")
    next_job = await admit(api)
    next_execution = await api.coordinator.claim()
    await api.coordinator.cancel(user(), 1, next_job.id)
    async with api.sessions.begin() as db:
        await membership_for(db, "owner", generation=1, write=True)
        await assert_error(require_execution(db, next_execution, "owner", 1), 410)
    await api.coordinator.acknowledge_end(next_execution, "interrupted")
    assert (await api.coordinator.receipt(user(), 1, next_job.id)).status == "cancelled"


async def test_queued_restart_started_never_restarts_and_rate_limit(jobs):
    api = jobs
    queued = await admit(api)
    replica = ExportJobCoordinator(api.sessions, settings=api.coordinator.settings)
    execution = await replica.claim()
    assert execution.job_id == queued.id and await api.coordinator.claim() is None
    await replica.acknowledge_end(execution, "export_failed")
    for _ in range(5):
        receipt = await admit(api)
        await api.coordinator.cancel(user(), 1, receipt.id)
    rate = await assert_error(admit(api), 429, "export_job_rate_limited")
    assert 3500 < int(rate.headers["Retry-After"]) <= 3600
    assert (await api.coordinator.receipt(user(), 1, queued.id)).id == queued.id


async def test_off_routes_before_auth_body_db_and_legacy_installed_fencing(jobs, monkeypatch):
    api = jobs
    configured = settings(workouts_export_jobs_enabled=False)
    monkeypatch.setattr(export_job_router, "get_settings", lambda: configured)

    async def forbidden(*a, **kw):
        pytest.fail("OFF route touched coordinator")

    monkeypatch.setattr(api.coordinator, "admit", forbidden)
    response = await api.client.post(
        "/api/v1/workouts/export/jobs", content=b"invalid", headers={"X-Workouts-Generation": "x"}
    )
    assert response.status_code == 404
    legacy = PrivateExportService(api.sessions, settings=configured)
    manifest = await legacy.create(user(), 1)
    async with api.sessions() as db:
        row = await db.scalar(
            select(WorkoutsExportJob).where(WorkoutsExportJob.snapshot_id == manifest.id)
        )
        assert row.kind == "legacy" and row.status == "ready"
    await verify_export_job_schema(api.engine, settings=configured)


@pytest.mark.parametrize(
    "ddl",
    [
        "ALTER TABLE workouts_export_jobs ALTER COLUMN generation DROP NOT NULL",
        "ALTER TABLE workouts_export_jobs ALTER COLUMN status TYPE varchar(40)",
        "ALTER TABLE workouts_export_jobs DROP CONSTRAINT uq_workouts_export_job_request",
        "ALTER TABLE workouts_export_jobs DROP CONSTRAINT workouts_export_jobs_app_user_id_fkey",
        "ALTER TABLE workouts_export_jobs DROP CONSTRAINT ck_workouts_export_job_deadlines",
        "ALTER TABLE workouts_export_jobs DISABLE TRIGGER fence_workouts_export_job_identity",
        "CREATE OR REPLACE FUNCTION fence_workouts_export_job_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
        "ALTER FUNCTION fence_workouts_export_job_identity() SECURITY DEFINER",
        "ALTER FUNCTION fence_workouts_export_job_identity() SET search_path TO public",
        "ALTER TABLE workouts_export_job_slot ADD COLUMN unexpected_job_fk uuid REFERENCES workouts_export_jobs(id)",
    ],
)
async def test_exact_schema_tamper_fails_even_flag_off(jobs, ddl):
    await verify_export_job_schema(jobs.engine, settings=jobs.coordinator.settings)
    async with jobs.engine.begin() as db:
        await db.execute(text(ddl))
    with pytest.raises(RuntimeError):
        await verify_export_job_schema(
            jobs.engine, settings=settings(workouts_export_jobs_enabled=False)
        )


@pytest.mark.parametrize("race", ["deadline", "erase", "stale_ack"])
async def test_legacy_ack_races_never_return_false201(jobs, monkeypatch, race):
    api = jobs
    original = api.coordinator.acknowledge_end

    async def intercepted(execution, outcome):
        if race == "deadline":
            await age(api, execution.job_id, 121)
        elif race == "erase":
            async with api.sessions.begin() as db:
                await db.execute(delete(AppUser).where(AppUser.id == "owner"))
        if race != "stale_ack":
            await original(execution, outcome)

    monkeypatch.setattr(api.coordinator, "acknowledge_end", intercepted)
    api.exports._job_coordinator = api.coordinator
    await assert_error(api.exports.create(user(), 1), 404 if race == "erase" else 410)
    if race == "stale_ack":
        async with api.sessions() as db:
            row = await db.scalar(select(WorkoutsExportJob))
            execution = api.coordinator.execution(row)
        await original(execution, None)


async def test_async_bound_failure_fixed_code_no_artifacts(jobs, monkeypatch):
    from app.domains.workouts import export_service

    monkeypatch.setattr(export_service, "MAX_TOTAL_BYTES", 1)
    receipt = await admit(jobs)
    await drain(jobs)
    result = await jobs.coordinator.receipt(user(), 1, receipt.id)
    assert (
        result.status == "failed" and result.failure_code == "too_large" and result.manifest is None
    )
    async with jobs.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0


@pytest.mark.parametrize("change", ["expired", "privacy"])
async def test_never_started_terminal_queue_maintenance_release(jobs, change):
    receipt = await admit(jobs)
    if change == "expired":
        await age(jobs, receipt.id, 121)
    else:
        async with jobs.sessions.begin() as db:
            await membership_for(db, "owner", generation=1, write=True)
            await invalidate_export_snapshots(db, "owner", 1)
    await jobs.coordinator.maintain()
    async with jobs.sessions() as db:
        slot = await db.get(WorkoutsExportJobSlot, 1)
        assert slot.active_job_id is None and slot.started_at is None
    await admit(jobs)


async def test_mixed_legacy_async_rate_limit_and_replays(jobs):
    for _ in range(3):
        await jobs.exports.create(user(), 1)
    for _ in range(3):
        request = uuid4()
        receipt = await jobs.coordinator.admit(user(), 1, request)
        await jobs.coordinator.cancel(user(), 1, receipt.id)
        assert (await jobs.coordinator.admit(user(), 1, request)).id == receipt.id
    await assert_error(jobs.exports.create(user(), 1), 429, "export_job_rate_limited")


@pytest.mark.parametrize("async_enabled", [True, False])
async def test_cold_entry_malformed045_fails_safe_async_and_legacy(jobs, async_enabled):
    async with jobs.engine.begin() as db:
        await db.execute(
            text(
                "CREATE OR REPLACE FUNCTION fence_workouts_export_job_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"
            )
        )
    configured = settings(workouts_export_jobs_enabled=async_enabled)
    if async_enabled:
        fresh = ExportJobCoordinator(jobs.sessions, settings=configured)
        await assert_error(fresh.admit(user(), 1, uuid4()), 503, "export_jobs_unavailable")
    else:
        fresh = PrivateExportService(jobs.sessions, settings=configured)
        await assert_error(fresh.create(user(), 1), 503, "export_jobs_unavailable")
    async with jobs.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportJob)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0


@pytest.mark.parametrize("operation", ["cancel", "privacy", "erase"])
async def test_midbuild_stop_retires_task_and_removes_ciphertext(jobs, operation):
    from app.domains.workouts import export_service
    from app.domains.workouts.export_job_lifecycle import erase_export_jobs

    api = jobs
    entered = asyncio.Event()
    hold = asyncio.Event()

    async def blocked_source(db, current_user, limit, offset):
        result = await export_service.approved_export_page(db, current_user, limit, offset)
        entered.set()
        await hold.wait()
        return result

    api.worker.builder = PrivateExportService(
        api.sessions, settings=api.coordinator.settings, page_source=blocked_source
    )
    receipt = await admit(api)
    await api.worker.tick()
    await asyncio.wait_for(entered.wait(), 5)
    if operation == "cancel":
        result = await api.client.post(
            "/api/v1/workouts/export/jobs/" + str(receipt.id) + "/cancel", headers=GENERATION
        )
        assert result.status_code == 200 and result.json()["cleanup_pending"]
    else:
        async with api.sessions.begin() as db:
            await membership_for(db, "owner", generation=1, write=True)
            await invalidate_export_snapshots(db, "owner", 1)
            if operation == "erase":
                await erase_export_jobs(db, "owner")
    await drain(api)
    assert api.worker.active_task is api.worker.heartbeat_task is None
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportPage)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0
        row = await db.get(WorkoutsExportJob, receipt.id)
        if operation == "erase":
            assert row is None
        else:
            assert row.status == ("cancelled" if operation == "cancel" else "failed")


async def test_started_expired_lease_retained_unknown_worker(jobs):
    receipt = await admit(jobs)
    execution = await jobs.coordinator.claim()
    async with jobs.sessions.begin() as db:
        for model in (WorkoutsExportJob, WorkoutsExportJobSlot):
            row = await db.get(model, receipt.id if model is WorkoutsExportJob else 1)
            row.leased_until = await db.scalar(
                select(func.clock_timestamp() - text("interval '1 second'"))
            )
    await jobs.coordinator.maintain()
    result = await jobs.coordinator.receipt(user(), 1, receipt.id)
    assert (
        result.status == "failed"
        and result.failure_code == "interrupted"
        and result.cleanup_pending
    )
    assert await jobs.coordinator.claim() is None
    await assert_error(jobs.coordinator.admit(user("other"), 1, uuid4()), 429)
    await jobs.coordinator.acknowledge_end(execution, "interrupted")


async def test_privacy_rollback_conservatively_stops_without_resurrection(jobs):
    from app.domains.workouts import export_service

    entered = asyncio.Event()

    async def blocked(db, current_user, limit, offset):
        entered.set()
        await asyncio.Event().wait()
        return await export_service.approved_export_page(db, current_user, limit, offset)

    jobs.worker.builder = PrivateExportService(
        jobs.sessions, settings=jobs.coordinator.settings, page_source=blocked
    )
    receipt = await admit(jobs)
    await jobs.worker.tick()
    await asyncio.wait_for(entered.wait(), 5)
    async with jobs.sessions() as db:
        await membership_for(db, "owner", generation=1, write=True)
        await invalidate_export_snapshots(db, "owner", 1)
        await db.rollback()
    await drain(jobs)
    result = await jobs.coordinator.receipt(user(), 1, receipt.id)
    assert (
        result.status == "failed"
        and result.failure_code == "interrupted"
        and result.manifest is None
    )
    async with jobs.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0


@pytest.mark.parametrize("boundary", ["receipt", "legacy_execution"])
@pytest.mark.parametrize("failure", ["cancelled", "database"])
async def test_legacy_postcommit_pre_source_failures_release_exact_nonce(
    jobs, monkeypatch, boundary, failure
):
    from sqlalchemy.exc import SQLAlchemyError

    api = jobs
    original = getattr(api.coordinator, boundary)

    async def fail(*args, **kwargs):
        # The row and slot have committed. No source/view has been created.
        async with api.sessions() as db:
            slot = await db.get(WorkoutsExportJobSlot, 1)
            assert slot.active_job_id is not None and slot.started_at is not None
        if failure == "cancelled":
            raise asyncio.CancelledError()
        raise SQLAlchemyError("synthetic private driver fault")

    monkeypatch.setattr(api.coordinator, boundary, fail)
    api.exports._job_coordinator = api.coordinator
    if failure == "cancelled":
        with pytest.raises(asyncio.CancelledError):
            await api.exports.create(user(), 1)
    else:
        await assert_error(api.exports.create(user(), 1), 503, "export_jobs_unavailable")
    monkeypatch.setattr(api.coordinator, boundary, original)
    async with api.sessions() as db:
        slot = await db.get(WorkoutsExportJobSlot, 1)
        assert slot.active_job_id is None
        row = await db.scalar(select(WorkoutsExportJob))
        assert row.status == "failed" and row.failure_code == "interrupted"
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportPage)) == 0
    await admit(api)


async def test_erasure_before_legacy_admission_returns_releases_captured_slot(jobs, monkeypatch):
    api = jobs
    original = api.coordinator.receipt

    async def erased(user, generation, identifier=None, **kwargs):
        async with api.sessions.begin() as db:
            await db.execute(delete(AppUser).where(AppUser.id == "owner"))
        return await original(user, generation, identifier, **kwargs)

    monkeypatch.setattr(api.coordinator, "receipt", erased)
    api.exports._job_coordinator = api.coordinator
    await assert_error(api.exports.create(user(), 1), 404)
    monkeypatch.setattr(api.coordinator, "receipt", original)
    async with api.sessions() as db:
        assert (await db.get(WorkoutsExportJobSlot, 1)).active_job_id is None
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportJob)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0
    await api.coordinator.admit(user("other"), 1, uuid4())


@pytest.mark.parametrize("failure", ["cancelled", "database"])
async def test_claim_postcommit_pre_source_fault_releases_captured_nonce(
    jobs, monkeypatch, failure
):
    from sqlalchemy.exc import SQLAlchemyError

    receipt = await admit(jobs)
    original = jobs.coordinator.claim

    async def failed(*args, **kwargs):
        execution = await original(*args, **kwargs)
        assert kwargs["capsule"].execution == execution
        if failure == "cancelled":
            raise asyncio.CancelledError()
        raise SQLAlchemyError("synthetic claim commit-ACK fault")

    monkeypatch.setattr(jobs.coordinator, "claim", failed)
    if failure == "cancelled":
        with pytest.raises(asyncio.CancelledError):
            await jobs.worker.tick()
    else:
        await assert_error(jobs.worker.tick(), 503, "export_jobs_unavailable")
    assert jobs.worker.active_task is jobs.worker.claim_capsule is jobs.worker.pending_ack is None
    async with jobs.sessions() as db:
        assert (await db.get(WorkoutsExportJobSlot, 1)).active_job_id is None
        row = await db.get(WorkoutsExportJob, receipt.id)
        assert row.status == "failed" and row.failure_code == "interrupted"
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportPage)) == 0
    await admit(jobs)


async def test_stop_during_claim_releases_proven_never_started_source(jobs, monkeypatch):
    receipt = await admit(jobs)
    original = jobs.coordinator.claim
    entered = asyncio.Event()

    async def held(*args, **kwargs):
        execution = await original(*args, **kwargs)
        entered.set()
        await asyncio.Event().wait()
        return execution

    monkeypatch.setattr(jobs.coordinator, "claim", held)
    jobs.worker.task = asyncio.create_task(jobs.worker.tick())
    await asyncio.wait_for(entered.wait(), 5)
    assert jobs.worker.claim_capsule.execution is not None and jobs.worker.active_task is None
    assert await jobs.worker.stop()
    async with jobs.sessions() as db:
        assert (await db.get(WorkoutsExportJobSlot, 1)).active_job_id is None
        assert (await db.get(WorkoutsExportJob, receipt.id)).status == "failed"
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0
    await admit(jobs)
