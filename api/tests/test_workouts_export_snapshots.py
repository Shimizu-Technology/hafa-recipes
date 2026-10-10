"""Real PostgreSQL snapshots, encryption, owner/generation and privacy races."""

import asyncio
import base64
import importlib
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import DBAPIError

from app.domains.workouts import export_service, security
from app.domains.workouts.export_models import (
    WorkoutsExportEpoch,
    WorkoutsExportPage,
    WorkoutsExportSnapshot,
)
from app.domains.workouts.export_service import (
    ExportManifest,
    ExportSnapshotPage,
    PrivateExportService,
    invalidate_export_snapshots,
    verify_export_schema,
)
from app.domains.workouts.lifecycle import membership_for
from app.domains.workouts.models import WorkoutRecord
from app.domains.workouts.router import Generation, User
from app.domains.workouts.security import WorkoutsRoute
from app.models.identity import AppUser
from tests.test_workouts_data_integration import (
    DATABASE_URL,
    GENERATION,
    WORKOUT,
    data_api,  # noqa: F401 -- reusable disposable fixture
    enroll,
    settings,
    user,
)

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
PREFIX = "/api/v1/workouts"


@pytest.fixture
async def snapshots(data_api, monkeypatch):  # noqa: F811
    configured = settings()
    for name in ["035_add_workouts_automation", "043_add_workouts_export_snapshots"]:
        await importlib.import_module("migrations." + name).run_migration(
            configured=configured, migration_engine=data_api.engine
        )
    monkeypatch.setenv(
        "WORKOUTS_SHARE_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"E" * 32).decode()
    )
    await enroll(data_api)
    await enroll(data_api, other=True)
    data_api.exports = PrivateExportService(data_api.sessions, settings=configured)
    routes = APIRouter(prefix=PREFIX, route_class=WorkoutsRoute)

    @routes.post("/export/snapshots", response_model=ExportManifest, status_code=201)
    async def create_export(current_user: User, generation: Generation):
        return await data_api.exports.create(current_user, generation)

    @routes.get("/export/snapshots/{snapshot_id}", response_model=ExportManifest)
    async def get_export(snapshot_id: UUID, current_user: User, generation: Generation):
        return await data_api.exports.read(current_user, generation, snapshot_id)

    @routes.get("/export/snapshots/{snapshot_id}/pages/{page}", response_model=ExportSnapshotPage)
    async def get_page(snapshot_id: UUID, page: int, current_user: User, generation: Generation):
        return await data_api.exports.read(current_user, generation, snapshot_id, page=page)

    @routes.delete("/export/snapshots/{snapshot_id}", status_code=204)
    async def delete_export(snapshot_id: UUID, current_user: User, generation: Generation):
        await data_api.exports.remove(current_user, generation, snapshot_id)
        return Response(status_code=204)

    data_api.app.include_router(routes)
    return data_api


async def add(api, title="Private fixture"):
    response = await api.client.post(
        PREFIX + "/library", json={**WORKOUT, "title": title}, headers=GENERATION
    )
    assert response.status_code == 201, response.text
    return response.json()


async def assert_error(coro, status, detail=None):
    with pytest.raises(HTTPException) as caught:
        await coro
    assert caught.value.status_code == status
    if detail:
        assert caught.value.detail == detail
    return caught.value


async def test_one_consistent_point_across_pages_after_mutations(snapshots):
    api = snapshots
    rows = [await add(api, f"Private old {index}") for index in range(11)]
    manifest = await api.exports.create(user(), 1)
    assert manifest.page_count == 2 and manifest.totals["workouts"] == 11
    first = await api.exports.read(user(), 1, manifest.id, page=0)
    before = await api.exports.read(user(), 1, manifest.id, page=1)
    await add(api, "New after snapshot")
    async with api.sessions.begin() as db:
        row = await db.get(WorkoutRecord, UUID(rows[0]["id"]))
        row.content = {**row.content, "title": "Edited after snapshot"}
        row.revision += 1
    after = await api.exports.read(user(), 1, manifest.id, page=1)
    assert before == after
    exported = first.export.datasets["workouts"] + after.export.datasets["workouts"]
    assert {row["content"]["title"] for row in exported} == {
        f"Private old {index}" for index in range(11)
    }
    assert first.export.generated_at == after.export.generated_at == manifest.created_at
    assert first.export.totals == after.export.totals
    assert (await api.exports.read(user(), 1, manifest.id)) == manifest


async def test_repeatable_read_during_materialization_not_only_after(snapshots):
    api = snapshots
    rows = [await add(api, f"Original {index}") for index in range(11)]
    acquired, resume = asyncio.Event(), asyncio.Event()

    async def source(db, current_user, limit, offset):
        result = await export_service.approved_export_page(db, current_user, limit, offset)
        if offset == 0:
            acquired.set()
            await resume.wait()
        return result

    service = PrivateExportService(api.sessions, settings=settings(), page_source=source)
    pending = asyncio.create_task(service.create(user(), 1))
    await asyncio.wait_for(acquired.wait(), 5)
    await add(api, "Concurrent insertion")
    async with api.sessions.begin() as db:
        row = await db.get(WorkoutRecord, UUID(rows[0]["id"]))
        row.content = {**row.content, "title": "Concurrent update"}
    resume.set()
    manifest = await asyncio.wait_for(pending, 5)
    second = await service.read(user(), 1, manifest.id, page=1)
    assert manifest.totals["workouts"] == 11
    assert second.export.datasets["workouts"][0]["content"]["title"] == "Original 0"


async def test_ciphertext_only_and_authenticated_page_binding(snapshots):
    api = snapshots
    await add(api, "Private unmistakable sensitive title")
    manifest = await api.exports.create(user(), 1)
    async with api.sessions() as db:
        page = await db.get(WorkoutsExportPage, (manifest.id, 0))
        snapshot = await db.get(WorkoutsExportSnapshot, manifest.id)
        assert b"sensitive title" not in page.ciphertext
        assert b"Private" not in page.ciphertext
        assert len(snapshot.permission_digest) == 32
        with pytest.raises(export_service.InvalidTag):
            export_service.unseal(export_service.export_key(), snapshot, 1, page.ciphertext)
        with pytest.raises(export_service.InvalidTag):
            export_service.unseal(b"Z" * 32, snapshot, 0, page.ciphertext)
    async with api.engine.connect() as db:
        assert (
            await db.scalar(
                text(
                    "SELECT data_type FROM information_schema.columns WHERE table_name='workouts_export_pages' AND column_name='ciphertext'"
                )
            )
            == "bytea"
        )
        assert not await db.scalar(
            text(
                "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name LIKE 'workouts_export_%' AND data_type='jsonb')"
            )
        )


async def test_owner_cannot_read_or_remove_another_snapshot(snapshots):
    api = snapshots
    manifest = await api.exports.create(user(), 1)
    await assert_error(api.exports.read(user("other"), 1, manifest.id, page=0), 404)
    await api.exports.remove(user("other"), 1, manifest.id)
    assert (await api.exports.read(user(), 1, manifest.id)).id == manifest.id
    await assert_error(api.exports.read(user(), 1, uuid4()), 404)


async def test_stale_generation_and_deleted_enrollment(snapshots):
    api = snapshots
    manifest = await api.exports.create(user(), 1)
    await assert_error(api.exports.read(user(), 2, manifest.id), 409)
    await assert_error(api.exports.create(user(), 2), 409)
    async with api.sessions.begin() as db:
        membership = await membership_for(db, "owner", generation=1, write=True)
        await invalidate_export_snapshots(db, "owner", 1)
        membership.generation = 2
        membership.status = "deleted"
        await export_service.erase_export_epochs_after_product_deletion(db, "owner")
    await assert_error(api.exports.read(user(), 1, manifest.id), 409)
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportEpoch)) == 0


async def test_whole_account_delete_cascades_ciphertext_and_epoch(snapshots):
    api = snapshots
    manifest = await api.exports.create(user(), 1)
    async with api.sessions.begin() as db:
        await invalidate_export_snapshots(db, "owner", 1)
    manifest = await api.exports.create(user(), 1)
    async with api.sessions.begin() as db:
        await db.execute(delete(AppUser).where(AppUser.id == "owner"))
    await assert_error(api.exports.read(user(), 1, manifest.id), 404, "Account not found")
    async with api.sessions() as db:
        for model in (WorkoutsExportSnapshot, WorkoutsExportPage, WorkoutsExportEpoch):
            assert await db.scalar(select(func.count()).select_from(model)) == 0
        assert await db.get(AppUser, "other") is not None


async def test_expiry_removes_ciphertext_durably(snapshots):
    api = snapshots
    manifest = await api.exports.create(user(), 1)
    async with api.sessions.begin() as db:
        row = await db.get(WorkoutsExportSnapshot, manifest.id)
        row.created_at -= timedelta(minutes=11)
        row.expires_at -= timedelta(minutes=11)
    await assert_error(api.exports.read(user(), 1, manifest.id), 410)
    async with api.sessions() as db:
        assert await db.get(WorkoutsExportSnapshot, manifest.id) is None
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportPage)) == 0


async def test_permission_changes_invalidate_even_without_cleanup_hook(snapshots):
    api = snapshots
    grant = await api.client.put(
        PREFIX + "/grants", headers=GENERATION, json={"scopes": ["recipes_library_context"]}
    )
    assert grant.status_code == 200
    manifest = await api.exports.create(user(), 1)
    await api.client.put(PREFIX + "/grants", headers=GENERATION, json={"scopes": []})
    await assert_error(api.exports.read(user(), 1, manifest.id), 410)
    async with api.sessions() as db:
        assert await db.get(WorkoutsExportSnapshot, manifest.id) is None


async def test_ai_consent_revocation_invalidates(snapshots):
    api = snapshots
    await api.client.put(
        PREFIX + "/ai-consent", headers=GENERATION, json={"accepted": True, "disclosure_version": 1}
    )
    manifest = await api.exports.create(user(), 1)
    await api.client.put(
        PREFIX + "/ai-consent",
        headers=GENERATION,
        json={"accepted": False, "disclosure_version": 1},
    )
    await assert_error(api.exports.read(user(), 1, manifest.id), 410)


async def test_privacy_invalidation_epoch_no_aba_or_other_owner_loss(snapshots):
    api = snapshots
    owner = await api.exports.create(user(), 1)
    other = await api.exports.create(user("other"), 1)
    async with api.sessions.begin() as db:
        await membership_for(db, "owner", generation=1, write=True)
        await invalidate_export_snapshots(db, "owner", 1)
        await invalidate_export_snapshots(db, "owner", 1)
    await assert_error(api.exports.read(user(), 1, owner.id), 404)
    assert (await api.exports.read(user("other"), 1, other.id)).id == other.id
    async with api.sessions() as db:
        assert (await db.get(WorkoutsExportEpoch, ("owner", 1))).revision == 2
    next_snapshot = await api.exports.create(user(), 1)
    assert (await api.exports.read(user(), 1, next_snapshot.id)).id == next_snapshot.id


async def test_revocation_while_building_cannot_publish(snapshots):
    api = snapshots
    acquired, resume = asyncio.Event(), asyncio.Event()

    async def source(db, current_user, limit, offset):
        result = await export_service.approved_export_page(db, current_user, limit, offset)
        acquired.set()
        await resume.wait()
        return result

    service = PrivateExportService(api.sessions, settings=settings(), page_source=source)
    pending = asyncio.create_task(service.create(user(), 1))
    await asyncio.wait_for(acquired.wait(), 5)
    async with api.sessions.begin() as db:
        await membership_for(db, "owner", generation=1, write=True)
        await invalidate_export_snapshots(db, "owner", 1)
    resume.set()
    failure = await assert_error(asyncio.wait_for(pending, 5), 410)
    assert failure.detail == "export_snapshot_unavailable"
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportPage)) == 0


async def test_replacement_and_explicit_discard(snapshots):
    api = snapshots
    first = await api.exports.create(user(), 1)
    second = await api.exports.create(user(), 1)
    await assert_error(api.exports.read(user(), 1, first.id), 404)
    assert (await api.exports.read(user(), 1, second.id)).id == second.id
    await api.exports.remove(user(), 1, second.id)
    await api.exports.remove(user(), 1, second.id)
    await assert_error(api.exports.read(user(), 1, second.id), 404)


@pytest.mark.parametrize("page", [-1, 512, True, "0"])
async def test_page_bounds(snapshots, page):
    api = snapshots
    manifest = await api.exports.create(user(), 1)
    await assert_error(api.exports.read(user(), 1, manifest.id, page=page), 422)
    await assert_error(api.exports.read(user(), 1, manifest.id, page=1), 422)


async def test_unconfigured_disabled_denied_no_database(snapshots, monkeypatch):
    def no_db():
        raise AssertionError("Unexpected DB call")

    denied = PrivateExportService(no_db, settings=settings())
    # settings helper already supplies public_access; construct through model copy.
    denied.settings = settings().model_copy(
        update={"workouts_public_access_enabled": False, "workouts_testers": ()}
    )
    await assert_error(denied.create(user(), 1), 403)
    disabled = PrivateExportService(
        no_db, settings=settings().model_copy(update={"workouts_api_enabled": False})
    )
    await assert_error(disabled.create(user(), 1), 404)
    monkeypatch.delenv("WORKOUTS_SHARE_ENCRYPTION_KEY")
    service = PrivateExportService(no_db, settings=settings())
    await assert_error(service.create(user(), 1), 503, "export_snapshot_not_configured")


async def test_failures_redacted_and_unfinished_rows_discarded(snapshots):
    api = snapshots

    async def fail(*args):
        raise ValueError("Private email/source/health detail must not leak")

    service = PrivateExportService(api.sessions, settings=settings(), page_source=fail)
    failure = await assert_error(service.create(user(), 1), 503)
    assert failure.detail == "export_snapshot_unavailable"
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0


async def test_size_bound_rejects_without_truncation(snapshots, monkeypatch):
    api = snapshots
    await add(api)
    monkeypatch.setattr(export_service, "MAX_TOTAL_BYTES", 1)
    await assert_error(api.exports.create(user(), 1), 413, "export_snapshot_too_large")
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportPage)) == 0


async def test_schema_readiness_and_immutable_rows(snapshots):
    api = snapshots
    await verify_export_schema(api.engine, settings())
    manifest = await api.exports.create(user(), 1)
    async with api.sessions.begin() as db:
        await invalidate_export_snapshots(db, "owner", 1)
    async with api.sessions() as db:
        with pytest.raises(DBAPIError):
            await db.execute(update(WorkoutsExportEpoch).values(revision=0))
        await db.rollback()
    manifest = await api.exports.create(user(), 1)
    async with api.sessions() as db:
        with pytest.raises(DBAPIError):
            await db.execute(update(WorkoutsExportPage).values(ciphertext=b"wrong"))
        await db.rollback()
    assert (await api.exports.read(user(), 1, manifest.id)).id == manifest.id


async def test_cleanup_bounded_and_optional_034_hook(data_api):  # noqa: F811
    api = data_api
    async with api.sessions.begin() as db:
        await invalidate_export_snapshots(db, "owner", 1)
    configured = settings()
    await importlib.import_module("migrations.035_add_workouts_automation").run_migration(
        configured=configured, migration_engine=api.engine
    )
    migration = importlib.import_module("migrations.043_add_workouts_export_snapshots")
    await migration.run_migration(configured=configured, migration_engine=api.engine)
    await migration.run_migration(configured=configured, migration_engine=api.engine)
    async with api.sessions.begin() as db:
        assert await export_service.cleanup_expired_exports(db) == 0
        with pytest.raises(ValueError):
            await export_service.cleanup_expired_exports(db, limit=101)
    await verify_export_schema(api.engine, configured)


async def test_fresh_publication_observes_revocation_without_erase_hook(snapshots):
    api = snapshots
    await api.client.put(
        PREFIX + "/ai-consent", headers=GENERATION, json={"accepted": True, "disclosure_version": 1}
    )
    acquired, resume = asyncio.Event(), asyncio.Event()

    async def source(db, current_user, limit, offset):
        result = await export_service.approved_export_page(db, current_user, limit, offset)
        acquired.set()
        await resume.wait()
        return result

    service = PrivateExportService(api.sessions, settings=settings(), page_source=source)
    pending = asyncio.create_task(service.create(user(), 1))
    await asyncio.wait_for(acquired.wait(), 5)
    await api.client.put(
        PREFIX + "/ai-consent",
        headers=GENERATION,
        json={"accepted": False, "disclosure_version": 1},
    )
    resume.set()
    await assert_error(asyncio.wait_for(pending, 5), 410)
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0


async def test_health_permission_revision_invalidates(snapshots):
    api = snapshots
    from app.domains.workouts.health_models import HealthConnection

    await importlib.import_module("migrations.036_add_workouts_health").run_migration(
        configured=settings(workouts_health_sync_enabled=True), migration_engine=api.engine
    )
    async with api.sessions.begin() as db:
        db.add(
            HealthConnection(
                app_user_id="owner",
                provider="apple_health",
                generation=1,
                revision=1,
                connected=True,
                read_on_device=True,
                upload_to_server=True,
                use_for_ai=False,
                write_actuals=False,
                disclosure_version=1,
            )
        )
    manifest = await api.exports.create(user(), 1)
    async with api.sessions.begin() as db:
        row = await db.get(HealthConnection, ("owner", "apple_health"))
        row.revision += 1
        row.upload_to_server = False
    await assert_error(api.exports.read(user(), 1, manifest.id), 410)


async def test_cancelled_build_disposes_temp_ciphertext(snapshots):
    api = snapshots
    acquired = asyncio.Event()

    async def source(db, current_user, limit, offset):
        result = await export_service.approved_export_page(db, current_user, limit, offset)
        acquired.set()
        await asyncio.Event().wait()
        return result

    service = PrivateExportService(api.sessions, settings=settings(), page_source=source)
    pending = asyncio.create_task(service.create(user(), 1))
    await asyncio.wait_for(acquired.wait(), 5)
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportPage)) == 0


async def test_sql_size_guard_runs_before_projection_decode(snapshots):
    api = snapshots
    row = await add(api)
    async with api.sessions.begin() as db:
        model = await db.get(WorkoutRecord, UUID(row["id"]))
        model.content = {**model.content, "notes": ["a" * (5 * 1024 * 1024)]}
    # This value could never pass native request bounds; defense-in-depth for
    # internal writers/corruption prevents loading a huge JSON record into RAM.
    await assert_error(api.exports.create(user(), 1), 413, "export_snapshot_too_large")
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0


async def test_optional_migration_gates(data_api):  # noqa: F811
    api = data_api
    migration = importlib.import_module("migrations.043_add_workouts_export_snapshots")

    class NoDatabase:
        def begin(self):
            raise AssertionError("Disabled migration touched DB")

    await migration.run_migration(
        configured=settings().model_copy(update={"workouts_api_enabled": False}),
        migration_engine=NoDatabase(),
    )
    await verify_export_schema(
        NoDatabase(), settings().model_copy(update={"workouts_api_enabled": False})
    )
    with pytest.raises(RuntimeError, match="migration035"):
        await migration.run_migration(configured=settings(), migration_engine=api.engine)
    await importlib.import_module("migrations.035_add_workouts_automation").run_migration(
        configured=settings(), migration_engine=api.engine
    )
    with pytest.raises(RuntimeError, match="verified restore point"):
        await migration.run_migration(
            configured=settings().model_copy(update={"environment": "production"}),
            migration_engine=api.engine,
        )
    async with api.sessions() as db:
        assert not await db.scalar(
            text("SELECT to_regclass('public.workouts_export_snapshots') IS NOT NULL")
        )


async def test_http_manifest_pages_identity_generation_and_no_store(snapshots):
    api = snapshots
    await add(api, "HTTP private export")
    missing_generation = await api.client.post(PREFIX + "/export/snapshots")
    assert missing_generation.status_code == 422
    created = await api.client.post(PREFIX + "/export/snapshots", headers=GENERATION)
    assert created.status_code == 201, created.text
    assert created.headers["cache-control"] == "no-store"
    manifest = created.json()
    assert set(manifest) == {
        "id",
        "generation",
        "schema_version",
        "created_at",
        "expires_at",
        "page_count",
        "page_size",
        "totals",
    }
    path = PREFIX + "/export/snapshots/" + manifest["id"]
    page = await api.client.get(path + "/pages/0", headers=GENERATION)
    assert page.status_code == 200, page.text
    assert page.headers["cache-control"] == "no-store"
    assert (
        page.json()["export"]["datasets"]["workouts"][0]["content"]["title"]
        == "HTTP private export"
    )
    assert (
        await api.client.get(path, headers={**GENERATION, "X-Test-User": "other"})
    ).status_code == 404
    assert (
        await api.client.get(path, headers={**GENERATION, "X-Hafa-Account-ID": "other"})
    ).status_code == 409
    assert (await api.client.get(path + "/pages/512", headers=GENERATION)).status_code == 422
    assert (await api.client.delete(path, headers=GENERATION)).status_code == 204
    assert (await api.client.get(path, headers=GENERATION)).status_code == 404


async def test_http_master_off_before_auth_and_db(snapshots, monkeypatch):
    api = snapshots
    from app.auth import get_current_user

    def forbidden_auth():
        raise AssertionError("Disabled route authenticated")

    api.app.dependency_overrides[get_current_user] = forbidden_auth
    monkeypatch.setattr(
        security,
        "get_settings",
        lambda: settings().model_copy(update={"workouts_api_enabled": False}),
    )
    response = await api.client.post(PREFIX + "/export/snapshots", headers=GENERATION)
    assert response.status_code == 404


async def test_readiness_rejects_disabled_privacy_fence(snapshots):
    api = snapshots
    async with api.engine.begin() as db:
        await db.execute(
            text("ALTER TABLE workouts_export_epochs DISABLE TRIGGER fence_workouts_export_epoch")
        )
    with pytest.raises(RuntimeError, match="fences"):
        await verify_export_schema(api.engine, settings())


async def test_readiness_rejects_missing_account_cascade(snapshots):
    api = snapshots
    async with api.engine.begin() as db:
        constraint = await db.scalar(
            text("""SELECT conname FROM pg_constraint
        WHERE conrelid='workouts_export_snapshots'::regclass AND confrelid='app_users'::regclass""")
        )
        assert constraint == "workouts_export_snapshots_app_user_id_fkey"
        await db.execute(
            text(
                "ALTER TABLE workouts_export_snapshots DROP CONSTRAINT workouts_export_snapshots_app_user_id_fkey"
            )
        )
    with pytest.raises(RuntimeError, match="cascades"):
        await verify_export_schema(api.engine, settings())


async def test_global_creation_slot_cross_instance_failfast_and_reader_independent(snapshots):
    api = snapshots
    existing = await api.exports.create(user("other"), 1)
    acquired, resume = asyncio.Event(), asyncio.Event()

    async def source(db, current_user, limit, offset):
        acquired.set()
        await resume.wait()
        return await export_service.approved_export_page(db, current_user, limit, offset)

    creator = PrivateExportService(api.sessions, settings=settings(), page_source=source)
    pending = asyncio.create_task(creator.create(user(), 1))
    await asyncio.wait_for(acquired.wait(), 5)
    other_instance = PrivateExportService(api.sessions, settings=settings())
    failure = await assert_error(
        asyncio.wait_for(other_instance.create(user("other"), 1), 1), 429, "export_snapshot_busy"
    )
    assert failure.headers == {"Retry-After": "2"}
    assert (
        await other_instance.read(user("other"), 1, existing.id, page=0)
    ).snapshot_id == existing.id
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 2
    resume.set()
    assert (await asyncio.wait_for(pending, 5)).generation == 1
    replacement = await other_instance.create(user("other"), 1)
    assert replacement.id != existing.id


@pytest.mark.parametrize("action", ["revoke", "product_delete"])
async def test_privacy_changes_after_committed_first_page_do_not_wait_for_rr_build(
    snapshots, action
):
    api = snapshots
    for index in range(11):
        await add(api, f"Source {index}")
    acquired, resume = asyncio.Event(), asyncio.Event()

    async def source(db, current_user, limit, offset):
        if offset == 10:
            acquired.set()
            await resume.wait()
        return await export_service.approved_export_page(db, current_user, limit, offset)

    service = PrivateExportService(api.sessions, settings=settings(), page_source=source)
    pending = asyncio.create_task(service.create(user(), 1))
    await asyncio.wait_for(acquired.wait(), 5)
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportPage)) == 1

    async def privacy_change():
        async with api.sessions.begin() as db:
            membership = await membership_for(db, "owner", generation=1, write=True)
            await invalidate_export_snapshots(db, "owner", 1)
            if action == "product_delete":
                membership.status = "deleted"
                membership.generation += 1

    # Original implementation held a page FK lock until all RR pages committed;
    # this revocation would have waited for resume and timed out/rolled back.
    await asyncio.wait_for(privacy_change(), 1)
    assert not pending.done()
    resume.set()
    await assert_error(asyncio.wait_for(pending, 5), 410 if action == "revoke" else 409)
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportPage)) == 0
    if action == "revoke":
        assert (await api.exports.create(user(), 1)).generation == 1
    else:
        assert (await api.exports.create(user("other"), 1)).generation == 1


async def test_global_page_slot_cross_instance_denial_before_ciphertext_load(snapshots):
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    api = snapshots
    first = await api.exports.create(user(), 1)
    other = await api.exports.create(user("other"), 1)
    acquired, resume = asyncio.Event(), asyncio.Event()
    loads = []

    class PausingSession(AsyncSession):
        async def get(self, entity, ident, **kwargs):
            if entity is WorkoutsExportPage:
                loads.append(ident)
                acquired.set()
                await resume.wait()
            return await super().get(entity, ident, **kwargs)

    sessions = async_sessionmaker(api.engine, class_=PausingSession, expire_on_commit=False)
    first_instance = PrivateExportService(sessions, settings=settings())
    pending = asyncio.create_task(first_instance.read(user(), 1, first.id, page=0))
    await asyncio.wait_for(acquired.wait(), 5)
    await assert_error(
        asyncio.wait_for(api.exports.read(user("other"), 1, other.id, page=0), 1),
        429,
        "export_snapshot_busy",
    )
    assert len(loads) == 1
    # Creator has a distinct slot and may replace the other owner's snapshot.
    replacement = await api.exports.create(user("other"), 1)
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert (
        await api.exports.read(user("other"), 1, replacement.id, page=0)
    ).snapshot_id == replacement.id


async def test_expired_reader_releases_global_slot(snapshots):
    api = snapshots
    manifest = await api.exports.create(user(), 1)
    other = await api.exports.create(user("other"), 1)
    async with api.sessions.begin() as db:
        row = await db.get(WorkoutsExportSnapshot, manifest.id)
        row.created_at -= timedelta(minutes=11)
        row.expires_at -= timedelta(minutes=11)
    await assert_error(api.exports.read(user(), 1, manifest.id), 410)
    assert (await api.exports.read(user("other"), 1, other.id)).id == other.id


async def test_cancelled_creation_releases_global_admission(snapshots):
    api = snapshots
    acquired = asyncio.Event()

    async def source(db, current_user, limit, offset):
        acquired.set()
        await asyncio.Event().wait()

    service = PrivateExportService(api.sessions, settings=settings(), page_source=source)
    pending = asyncio.create_task(service.create(user(), 1))
    await asyncio.wait_for(acquired.wait(), 5)
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsExportSnapshot)) == 0
    assert (await api.exports.create(user("other"), 1)).generation == 1
