"""Real PostgreSQL allowance, erasure, replay and transactional receipt tests."""

# ruff: noqa: F811 -- imported fixtures are registered by pytest
import asyncio
import importlib
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select, text

from app.domains.workouts import import_usage_service as usage
from app.domains.workouts.automation_models import WorkoutImport
from app.domains.workouts.extraction import ExtractionRequest, WorkoutExtractionResult
from app.domains.workouts.import_usage_models import WorkoutImportUsage
from app.domains.workouts.imports import create_import
from app.domains.workouts.lifecycle import membership_for, now
from app.models.identity import AppUser
from tests.test_workouts_automation_integration import (  # noqa: F401
    TEXT,
    automation_api,
    consent,
    enqueue,
)
from tests.test_workouts_data_integration import (  # noqa: F401
    GENERATION,
    data_api,
    enroll,
    settings,
)

migration = importlib.import_module("migrations.042_add_workouts_import_usage")


@pytest.fixture
async def usage_api(automation_api):
    await migration.run_migration(configured=settings(), migration_engine=automation_api.engine)
    await consent(automation_api)
    return automation_api


async def count_receipts(api):
    async with api.sessions() as db:
        return await db.scalar(select(func.count()).select_from(WorkoutImportUsage))


async def complete(api, identifier=None):
    response = await enqueue(api, identifier)
    assert response.status_code == 202, response.text
    assert await api.worker.tick()
    job = (await api.client.get("/api/v1/workouts/imports/" + response.json()["id"])).json()
    assert job["status"] == "ready", job
    return job


async def seed_receipts(api, count, *, hours=0, owner="owner"):
    identifiers = [uuid4() for _ in range(count)]
    async with api.sessions() as db:
        db.add_all(
            [
                WorkoutImportUsage(
                    app_user_id=owner, request_id=i, charged_at=now() - timedelta(hours=hours)
                )
                for i in identifiers
            ]
        )
        await db.commit()
    return identifiers


async def test_fifteen_successes_delete_all_jobs_does_not_refund(usage_api):
    api = usage_api
    jobs = [await complete(api) for _ in range(15)]
    assert await count_receipts(api) == 15
    assert (await enqueue(api)).status_code == 429
    for job in jobs:
        response = await api.client.delete(
            "/api/v1/workouts/imports/" + job["id"], headers=GENERATION
        )
        assert response.status_code == 200, response.text
    assert (await enqueue(api)).status_code == 429
    assert await count_receipts(api) == 15


async def test_product_wipe_reenroll_cannot_reset_allowance_or_replay_success(usage_api):
    api = usage_api
    identifiers = await seed_receipts(api, 15)
    assert (await api.client.delete("/api/v1/workouts/data", headers=GENERATION)).status_code == 200
    assert await count_receipts(api) == 15
    await enroll(api, generation=2)
    # Use the existing header's exact name.
    header = {next(iter(GENERATION)): "2"}
    assert (
        await api.client.put(
            "/api/v1/workouts/ai-consent",
            headers=header,
            json={"accepted": True, "disclosure_version": 1},
        )
    ).status_code == 200
    for identifier, expected in [(uuid4(), 429), (identifiers[0], 410)]:
        response = await api.client.post(
            "/api/v1/workouts/imports",
            headers=header,
            json={
                "request_id": str(identifier),
                "source": {"kind": "text", "text": TEXT, "ai_consent": True},
            },
        )
        assert response.status_code == expected, response.text


async def test_existing_success_replays_safely_without_recharging(usage_api):
    identifier = uuid4()
    job = await complete(usage_api, identifier)
    assert (await enqueue(usage_api, identifier)).json()["id"] == job["id"]
    assert (await enqueue(usage_api, identifier, "different")).status_code == 409
    assert await count_receipts(usage_api) == 1


async def test_pending_and_receipts_union_deduplicates_uuid(usage_api):
    identifiers = await seed_receipts(usage_api, 14)
    pending = (await enqueue(usage_api)).json()
    async with usage_api.sessions() as db:
        row = await db.get(WorkoutImport, UUID(pending["id"]))
        row.request_id = identifiers[0]  # synthetic overlapping reservation
        await db.commit()
    assert (await enqueue(usage_api)).status_code == 202
    assert (await enqueue(usage_api)).status_code == 429


async def test_expired_window_allows_new_identity_retained_uuid_is_tombstoned(usage_api):
    identifiers = await seed_receipts(usage_api, 15, hours=25)
    assert (await enqueue(usage_api)).status_code == 202
    assert (await enqueue(usage_api, identifiers[0])).status_code == 410


async def test_expired_tombstone_can_be_reused_and_purged(usage_api):
    identifiers = await seed_receipts(usage_api, 2, hours=49)
    await complete(usage_api, identifiers[0])
    assert await count_receipts(usage_api) == 2
    await usage_api.worker.purge_expired()
    assert await count_receipts(usage_api) == 1


@pytest.mark.parametrize("status", ["failed", "incomplete"])
async def test_unusable_results_refund_pending_allowance(usage_api, status):
    api = usage_api
    await seed_receipts(api, 14)
    response = await enqueue(api)
    assert response.status_code == 202
    assert (await enqueue(api)).status_code == 429

    async def extract(_):
        return WorkoutExtractionResult(status=status, warnings=["No workout captured"])

    api.worker.extractor.extract = extract
    await api.worker.tick()
    assert await count_receipts(api) == 14
    assert (await enqueue(api)).status_code == 202


async def test_incomplete_usable_capture_is_charged(usage_api):
    original = usage_api.worker.extractor.extract

    async def extract(request):
        result = await original(request)
        return result.model_copy(update={"status": "incomplete"})

    usage_api.worker.extractor.extract = extract
    response = await enqueue(usage_api)
    assert response.status_code == 202
    await usage_api.worker.tick()
    assert await count_receipts(usage_api) == 1


async def test_cancellation_while_provider_pending_cannot_charge(usage_api):
    api = usage_api
    entered, release = asyncio.Event(), asyncio.Event()
    original = api.worker.extractor.extract

    async def extract(request):
        entered.set()
        await release.wait()
        return await original(request)

    api.worker.extractor.extract = extract
    await enqueue(api)
    task = asyncio.create_task(api.worker.tick())
    await asyncio.wait_for(entered.wait(), 5)
    assert (await api.client.delete("/api/v1/workouts/data", headers=GENERATION)).status_code == 200
    release.set()
    await asyncio.wait_for(task, 5)
    assert await count_receipts(api) == 0


async def test_parallel_admissions_serialize_last_slot_and_safe_replay(usage_api):
    api = usage_api
    await seed_receipts(api, 14)

    async def admit(identifier):
        async with api.sessions() as db:
            try:
                row = await create_import(
                    db,
                    "owner",
                    1,
                    identifier,
                    ExtractionRequest(kind="text", text=TEXT, ai_consent=True),
                )
                return (202, row.id)
            except HTTPException as error:
                await db.rollback()
                return (error.status_code, None)

    results = await asyncio.gather(admit(uuid4()), admit(uuid4()))
    assert sorted(status for status, _ in results) == [202, 429]
    async with api.sessions() as db:
        row = await db.scalar(select(WorkoutImport))
        identifier = row.request_id
    replay = await asyncio.gather(admit(identifier), admit(identifier))
    assert replay[0] == replay[1]


async def test_receipt_and_result_rollback_together(usage_api):
    job = (await enqueue(usage_api)).json()
    result = await usage_api.worker.extractor.extract(
        ExtractionRequest(kind="text", text=TEXT, ai_consent=True)
    )
    async with usage_api.sessions() as db:
        row = await db.get(WorkoutImport, UUID(job["id"]))
        await usage.charge_usable_import(db, row, result)
        row.status = result.status
        row.result = result.model_dump(mode="json")
        await db.rollback()
    assert await count_receipts(usage_api) == 0
    await usage_api.worker.tick()
    assert await count_receipts(usage_api) == 1


async def test_generation_fence_rejects_late_charge(usage_api):
    job = (await enqueue(usage_api)).json()
    result = await usage_api.worker.extractor.extract(
        ExtractionRequest(kind="text", text=TEXT, ai_consent=True)
    )
    async with usage_api.sessions() as db:
        old_job = await db.get(WorkoutImport, UUID(job["id"]))
    await usage_api.client.delete("/api/v1/workouts/data", headers=GENERATION)
    async with usage_api.sessions() as db:
        with pytest.raises(HTTPException) as caught:
            await usage.charge_usable_import(db, old_job, result)
        assert caught.value.status_code == 409
        await db.rollback()
    assert await count_receipts(usage_api) == 0


async def test_owner_scoping_and_whole_account_cascade(usage_api):
    identifier = (await seed_receipts(usage_api, 1))[0]
    await enroll(usage_api, other=True)
    async with usage_api.sessions() as db:
        await membership_for(db, "other", generation=1, write=True)
        await usage.enforce_import_allowance(db, "other", 1, identifier)
        await db.rollback()
    async with usage_api.sessions() as db:
        await db.execute(delete(AppUser).where(AppUser.id == "owner"))
        await db.commit()
    assert await count_receipts(usage_api) == 0


async def test_receipt_is_content_free_and_immutable(usage_api):
    await seed_receipts(usage_api, 1)
    assert set(WorkoutImportUsage.__table__.columns.keys()) == {
        "app_user_id",
        "request_id",
        "charged_at",
    }
    async with usage_api.sessions() as db:
        with pytest.raises(Exception, match="immutable"):
            await db.execute(text("UPDATE workouts_import_usage SET charged_at=CURRENT_TIMESTAMP"))
        await db.rollback()


async def test_readiness_requires_042_and_disabled_readiness_queries_nothing(automation_api):
    with pytest.raises(RuntimeError, match="042"):
        await usage.verify_import_usage_schema(
            automation_api.sessions, settings=settings(workouts_imports_enabled=True)
        )

    def forbidden():
        raise AssertionError("disabled readiness must not touch database")

    await usage.verify_import_usage_schema(
        forbidden, settings=settings().model_copy(update={"workouts_api_enabled": False})
    )
    await migration.run_migration(configured=settings(), migration_engine=automation_api.engine)
    await usage.verify_import_usage_schema(
        automation_api.sessions, settings=settings(workouts_imports_enabled=True)
    )


async def test_migration_backfills_usable_once_without_content(automation_api):
    api = automation_api
    await consent(api)
    job = await complete(api)
    assert await api.worker.tick() is False
    await migration.run_migration(configured=settings(), migration_engine=api.engine)
    async with api.sessions() as db:
        receipt = await db.scalar(select(WorkoutImportUsage))
        timestamp = receipt.charged_at
        source_job = await db.get(WorkoutImport, UUID(job["id"]))
        assert receipt.request_id == source_job.request_id
    await migration.run_migration(configured=settings(), migration_engine=api.engine)
    async with api.sessions() as db:
        assert (await db.scalar(select(WorkoutImportUsage))).charged_at == timestamp
    assert await count_receipts(api) == 1


async def test_production_migration_restore_point_guard(automation_api, monkeypatch):
    monkeypatch.delenv("MIGRATION_042_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="RESTORE_POINT"):
        await migration.run_migration(
            configured=settings().model_copy(update={"environment": "production"}),
            migration_engine=automation_api.engine,
        )
    monkeypatch.setenv("MIGRATION_042_RESTORE_POINT", "verified-fixture-restore")
    await migration.run_migration(
        configured=settings().model_copy(update={"environment": "production"}),
        migration_engine=automation_api.engine,
    )
    await usage.verify_import_usage_schema(
        automation_api.sessions, settings=settings(workouts_imports_enabled=True)
    )


async def test_duplicate_charge_does_not_refresh_timestamp(usage_api):
    job = await complete(usage_api)
    result = await usage_api.worker.extractor.extract(
        ExtractionRequest(kind="text", text=TEXT, ai_consent=True)
    )
    async with usage_api.sessions() as db:
        row = await db.get(WorkoutImport, UUID(job["id"]))
        before = (await db.get(WorkoutImportUsage, ("owner", row.request_id))).charged_at
        await usage.charge_usable_import(db, row, result)
        await db.commit()
    async with usage_api.sessions() as db:
        after = (await db.scalar(select(WorkoutImportUsage))).charged_at
        assert before == after


@pytest.mark.parametrize("damage", ["ledger", "trigger", "cascade"])
async def test_enabled_readiness_rejects_damaged_invariants(usage_api, damage):
    async with usage_api.engine.begin() as connection:
        if damage == "ledger":
            await connection.execute(
                text("DELETE FROM workouts_schema_migrations WHERE version=42")
            )
        elif damage == "trigger":
            await connection.execute(
                text("DROP TRIGGER immutable_workouts_import_usage ON workouts_import_usage")
            )
        else:
            await connection.execute(
                text(
                    "ALTER TABLE workouts_import_usage DROP CONSTRAINT workouts_import_usage_app_user_id_fkey"
                )
            )
    with pytest.raises(RuntimeError):
        await usage.verify_import_usage_schema(
            usage_api.sessions, settings=settings(workouts_imports_enabled=True)
        )


async def test_expired_pending_does_not_reserve_slot(usage_api):
    await seed_receipts(usage_api, 14)
    job = (await enqueue(usage_api)).json()
    async with usage_api.sessions() as db:
        row = await db.get(WorkoutImport, UUID(job["id"]))
        row.expires_at = now() - timedelta(seconds=1)
        await db.commit()
    assert (await enqueue(usage_api)).status_code == 202


async def test_migration_requires035_and_disabled_migration_no_database(data_api):
    with pytest.raises(RuntimeError, match="035"):
        await migration.run_migration(configured=settings(), migration_engine=data_api.engine)

    class Forbidden:
        def begin(self):
            raise AssertionError("disabled migration must not query database")

    await migration.run_migration(
        configured=settings().model_copy(update={"workouts_api_enabled": False}),
        migration_engine=Forbidden(),
    )


async def test_fixture_fallback_cannot_enable_real_environment(automation_api, monkeypatch):
    monkeypatch.setattr(
        usage, "get_settings", lambda: settings().model_copy(update={"environment": "development"})
    )
    async with automation_api.sessions() as db:
        with pytest.raises(HTTPException) as caught:
            await usage.usage_schema_present(db)
        assert caught.value.status_code == 503
        await db.rollback()
