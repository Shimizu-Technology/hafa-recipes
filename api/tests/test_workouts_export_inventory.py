"""Private RR context equivalence, lifetime, privacy and real query reduction."""

# ruff: noqa: F811 -- imported reusable fixtures intentionally match test parameters

import asyncio
import importlib
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import event, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.workouts import export_service
from app.domains.workouts.export_context import SnapshotSourceContext, source_context
from app.domains.workouts.models import (
    WorkoutRecord,
    WorkoutsActivity,
    WorkoutsProfile,
    WorkoutVersion,
)
from app.domains.workouts.router import build_export_page, export_data
from tests.test_workouts_data_integration import (  # noqa: F401
    DATABASE_URL,
    WORKOUT,
    data_api,
    enroll,
    settings,
    user,
)
from tests.test_workouts_export_assembly import assembled_exports  # noqa: F401

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")


@pytest.fixture
async def inventory_api(assembled_exports):
    # The reusable assembly fixture intentionally leaves Health disabled.
    # Install the actual optional migration explicitly for these group cases.
    await importlib.import_module("migrations.036_add_workouts_health").run_migration(
        configured=settings(workouts_health_sync_enabled=True),
        migration_engine=assembled_exports.engine,
    )
    return assembled_exports


async def source(api):
    db = api.sessions()
    await db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
    await db.execute(text("SET TRANSACTION READ ONLY"))
    return db


async def records(api, count=25):
    async with api.sessions.begin() as db:
        for index in range(count):
            identifier = uuid4()
            content = {
                **deepcopy(WORKOUT),
                "title": f"Synthetic{index}",
                "id": str(identifier),
                "version": 1,
            }
            db.add(WorkoutRecord(id=identifier, app_user_id="owner", generation=1, content=content))
            db.add(
                WorkoutVersion(
                    workout_id=identifier,
                    app_user_id="owner",
                    generation=1,
                    revision=1,
                    content=content,
                )
            )


def comparable(page):
    result = page.model_dump(mode="json")
    result.pop("generated_at")
    return result


async def private_page(db, context, offset=0):
    token = source_context.set(context)
    try:
        return await export_service.approved_export_page(db, user(), 10, offset)
    finally:
        source_context.reset(token)


async def optional_rows(api):
    from app.domains.workouts.activity_log_models import WorkoutsActivityLog
    from app.domains.workouts.automation_models import (
        WorkoutCoachMessage,
        WorkoutImport,
        WorkoutProposal,
        WorkoutReadiness,
    )
    from app.domains.workouts.connection_models import (
        RecipeConnectionReceipt,
        WorkoutCopyReceipt,
        WorkoutShare,
    )
    from app.domains.workouts.health_models import HealthConnection, HealthObservation
    from app.domains.workouts.import_usage_models import WorkoutImportUsage
    from app.domains.workouts.library_organization_models import WorkoutLibraryCollection
    from app.domains.workouts.measurement_models import (
        WorkoutsMeasurement,
        WorkoutsMeasurementCurrent,
    )
    from app.domains.workouts.recipe_grant_models import WorkoutsRecipeGrantEpoch

    at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with api.sessions.begin() as db:
        db.add(
            WorkoutsProfile(
                app_user_id="owner",
                generation=1,
                content={"adult_confirmed": True, "readiness": "limited"},
                revision=1,
            )
        )
        db.add(
            WorkoutReadiness(
                app_user_id="owner",
                generation=1,
                state="limited",
                confirmed_at=at,
                expires_at=at + timedelta(hours=12),
            )
        )
        for provider in ("apple_health", "health_connect"):
            db.add(HealthConnection(app_user_id="owner", generation=1, provider=provider))
        for index in range(13):
            db.add(
                HealthObservation(
                    app_user_id="owner",
                    generation=1,
                    provider="apple_health",
                    source_id=str(index),
                    origin_id="synthetic",
                    content={"synthetic_order": index},
                    content_hash="a" * 64,
                    created_at=at + timedelta(seconds=index),
                )
            )
        db.add(
            RecipeConnectionReceipt(
                app_user_id="owner",
                generation=1,
                purpose="view",
                scopes=["recipes_library_context"],
                recipe_ids=[],
                meal_plan_ids=[],
            )
        )
        for index in range(12):
            sid = uuid4()
            db.add(
                WorkoutShare(
                    id=sid,
                    app_user_id="owner",
                    generation=1,
                    kind="workout",
                    record_id=uuid4(),
                    source_revision=1,
                    token_hash=f"{index:064x}",
                    encrypted_token="never_export_this",
                    snapshot={"title": f"share{index}"},
                    snapshot_digest="a" * 64,
                    expires_at=at + timedelta(days=1),
                    created_at=at + timedelta(seconds=index),
                )
            )
            db.add(
                WorkoutCopyReceipt(
                    app_user_id="owner",
                    generation=1,
                    kind="workout",
                    record_id=uuid4(),
                    share_id=sid,
                    copy_request_id=uuid4(),
                    source_token_hash="b" * 64,
                    request_hash="c" * 64,
                    snapshot_digest="d" * 64,
                    attribution={"shared_by_display_name": f"Synthetic{index}"},
                    created_at=at + timedelta(seconds=index),
                )
            )
        db.add(WorkoutsRecipeGrantEpoch(app_user_id="owner", generation=1, revision=1))
        # This table deliberately has NO generation. Two receipts span product eras.
        db.add_all(
            [
                WorkoutImportUsage(
                    app_user_id="owner", request_id=uuid4(), charged_at=at + timedelta(hours=n)
                )
                for n in range(2)
            ]
        )
        db.add(WorkoutImportUsage(app_user_id="other", request_id=uuid4(), charged_at=at))
        measurement = WorkoutsMeasurement(
            id=uuid4(),
            app_user_id="owner",
            generation=1,
            kind="weight",
            value=70,
            unit="kg",
            canonical_value=70,
            recorded_at=at,
        )
        db.add(measurement)
        await db.flush()
        db.add(
            WorkoutsMeasurementCurrent(
                app_user_id="owner", generation=1, kind="weight", measurement_id=measurement.id
            )
        )
        db.add(
            WorkoutsMeasurement(app_user_id="owner", generation=1, kind="height", status="removed")
        )
        activity_id = uuid4()
        content = {
            "kind": "walk",
            "date": "2026-01-01",
            "name": "Synthetic walk",
            "duration_minutes": 10,
            "strenuous": False,
            "distance_km": None,
            "notes": None,
        }
        db.add(WorkoutsActivity(id=activity_id, app_user_id="owner", generation=1, content=content))
        await db.flush()
        db.add(
            WorkoutsActivityLog(
                id=activity_id,
                activity_id=activity_id,
                app_user_id="owner",
                generation=1,
                content=content,
            )
        )

        db.add(
            WorkoutLibraryCollection(
                app_user_id="owner", generation=1, title="Synthetic", title_key="synthetic"
            )
        )
        db.add(
            WorkoutImport(
                id=uuid4(),
                app_user_id="owner",
                generation=1,
                request_id=uuid4(),
                request_hash="e" * 64,
                status="failed",
                ai_accepted_at=at,
                expires_at=at + timedelta(hours=1),
                payload={"private_capture": "must_not_be_selected"},
                result=None,
            )
        )
        db.add(
            WorkoutProposal(
                id=uuid4(),
                app_user_id="owner",
                generation=1,
                kind="program",
                profile_revision=1,
                context_hash="f" * 64,
                content={"synthetic": "proposal"},
                expires_at=at + timedelta(hours=1),
            )
        )
        db.add(
            WorkoutCoachMessage(
                id=uuid4(),
                app_user_id="owner",
                generation=1,
                request_id=uuid4(),
                request_hash="0" * 64,
                user_message="Synthetic",
                assistant_message="Synthetic",
                proposals=[],
            )
        )
        from app.domains.workouts.health_models import HealthExportIntent
        from app.domains.workouts.library_organization_models import (
            WorkoutLibraryCollectionMember,
            WorkoutLibraryDuplicateReceipt,
            WorkoutLibraryOrganization,
        )
        from app.domains.workouts.models import (
            WorkoutsProgram,
            WorkoutsProgramVersion,
            WorkoutsSession,
        )

        record = await db.scalar(
            select(WorkoutRecord).where(WorkoutRecord.app_user_id == "owner").limit(1)
        )
        if record is None:
            record = WorkoutRecord(
                id=uuid4(), app_user_id="owner", generation=1, content=deepcopy(WORKOUT)
            )
            db.add(record)
        program = WorkoutsProgram(
            id=uuid4(),
            app_user_id="owner",
            generation=1,
            content={
                "title": "Synthetic program",
                "proposal": {"status": "needs_information", "sessions": []},
            },
        )
        db.add(program)
        session = WorkoutsSession(
            id=uuid4(),
            app_user_id="owner",
            generation=1,
            client_session_id=uuid4(),
            request_hash="a" * 64,
            content={"status": "partial", "actuals": []},
        )
        db.add(session)
        await db.flush()
        db.add(
            WorkoutsProgramVersion(
                program_id=program.id,
                app_user_id="owner",
                generation=1,
                revision=1,
                content=deepcopy(program.content),
            )
        )
        db.add(
            HealthExportIntent(
                app_user_id="owner",
                generation=1,
                provider="apple_health",
                connection_revision=1,
                session_id=session.id,
                canonical_session_id="synthetic-session",
                session_revision=1,
                actual={"synthetic": "private"},
                status="reported_unsupported",
            )
        )
        db.add(
            WorkoutLibraryOrganization(
                workout_id=record.id,
                app_user_id="owner",
                generation=1,
                favorite=True,
                tags=["Synthetic"],
                tag_keys=["synthetic"],
            )
        )
        collection = await db.scalar(
            select(WorkoutLibraryCollection)
            .where(WorkoutLibraryCollection.app_user_id == "owner")
            .limit(1)
        )
        db.add(
            WorkoutLibraryCollectionMember(
                collection_id=collection.id, workout_id=record.id, app_user_id="owner", generation=1
            )
        )
        db.add(
            WorkoutLibraryDuplicateReceipt(
                app_user_id="owner",
                generation=1,
                request_id=uuid4(),
                request_hash="b" * 64,
                source_workout_id=record.id,
                source_revision=1,
                destination_workout_id=record.id,
            )
        )


@pytest.mark.parametrize("offset", [0, 10, 20, 30])
async def test_shared_builder_exact_legacy_equivalence_all_optional_groups(inventory_api, offset):
    api = inventory_api
    await enroll(api, other=True)
    await records(api)
    await optional_rows(api)
    db = await source(api)
    try:
        ctx = await SnapshotSourceContext.prepare(db, "owner", 1)
        expected = await export_data(Response(), user(), db, 10, offset)
        actual = await private_page(db, ctx, offset)
        assert comparable(actual) == comparable(expected)
        assert list(actual.datasets) == list(expected.datasets)
        assert list(actual.totals) == list(expected.totals)
        assert actual.totals["import_allowance_receipts"] == 2
        assert actual.profile.readiness == "limited"
        assert "never_export_this" not in actual.model_dump_json()
        assert "must_not_be_selected" not in actual.model_dump_json()
        ctx.close()
    finally:
        await db.close()


async def test_prepare_scalar_only_and_guard_before_profile_json(inventory_api, monkeypatch):
    api = inventory_api
    async with api.sessions.begin() as db:
        db.add(
            WorkoutsProfile(
                app_user_id="owner",
                generation=1,
                revision=1,
                content={"large": "x" * (4 * 1024 * 1024 + 1)},
            )
        )
    db = await source(api)
    selected = []

    def observe(conn, cursor, sql, params, context, many):
        if "workouts_profiles.content" in sql:
            selected.append(sql)

    event.listen(api.engine.sync_engine, "before_cursor_execute", observe)
    try:
        ctx = await SnapshotSourceContext.prepare(db, "owner", 1)
        assert selected == [] and ctx.static_metadata() is None
        with pytest.raises(ValueError, match="Guard"):
            await build_export_page(Response(), user(), db, 10, 0, source_context=ctx)
        with pytest.raises(HTTPException) as caught:
            await private_page(db, ctx)
        assert caught.value.status_code == 413 and selected == []
        ctx.close()
    finally:
        event.remove(api.engine.sync_engine, "before_cursor_execute", observe)
        await db.close()


async def test_scope_transaction_and_copied_metadata(inventory_api):
    api = inventory_api
    await optional_rows(api)
    db = await source(api)
    other = await source(api)
    try:
        ctx = await SnapshotSourceContext.prepare(db, "owner", 1)
        for target, owner, generation in [(other, "owner", 1), (db, "other", 1), (db, "owner", 2)]:
            with pytest.raises(ValueError):
                ctx.assert_scope(target, owner, generation)
        first = await private_page(db, ctx)
        first.profile.readiness = "ready"
        again = await private_page(db, ctx)
        assert again.profile.readiness == "limited"
        with pytest.raises(TypeError):
            ctx.totals["workouts"] = 999
        with pytest.raises(AttributeError):
            ctx.owner = "other"
        await db.rollback()
        with pytest.raises(ValueError):
            ctx.assert_scope(db, "owner", 1)
        await db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        await db.execute(text("SET TRANSACTION READ ONLY"))
        with pytest.raises(ValueError):
            ctx.assert_scope(db, "owner", 1)
        ctx.close()
        assert ctx.static_metadata() is None
    finally:
        await db.close()
        await other.close()


async def test_context_rejects_non_rr_and_writable_source(data_api):
    api = data_api
    await enroll(api)
    async with api.sessions() as db:
        with pytest.raises(ValueError):
            await SnapshotSourceContext.prepare(db, "owner", 1)
        await db.connection()
        with pytest.raises(ValueError):
            await SnapshotSourceContext.prepare(db, "owner", 1)
    async with api.sessions() as db:
        await db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        with pytest.raises(ValueError):
            await SnapshotSourceContext.prepare(db, "owner", 1)


async def test_034_only_schema_does_not_add_optional_datasets(data_api):
    api = data_api
    await enroll(api)
    # Fixture metadata may include collected optional models; remove only the
    # optional families from this synthetic DB to reproduce034-only availability.
    async with api.engine.begin() as connection:
        for gate in (
            "workouts_import_jobs",
            "workouts_health_connections",
            "workouts_shares",
            "workouts_library_organization",
            "workouts_measurements",
            "workouts_activity_log",
            "workouts_recipe_grant_epochs",
            "workouts_import_usage",
        ):
            await connection.execute(text("DROP TABLE IF EXISTS " + gate + " CASCADE"))
    db = await source(api)
    try:
        ctx = await SnapshotSourceContext.prepare(db, "owner", 1)
        actual = await private_page(db, ctx)
        expected = await export_data(Response(), user(), db, 10, 0)
        assert comparable(actual) == comparable(expected)
        assert set(actual.datasets) == {
            "workouts",
            "workout_versions",
            "programs",
            "program_versions",
            "sessions",
            "activities",
        }
        ctx.close()
    finally:
        await db.close()


async def test_190_versions_query_reduction_and_complete_outputs(inventory_api):
    api = inventory_api
    await records(api, 190)
    db = await source(api)
    counts = {"legacy": 0, "inventory": 0}
    phase = ["legacy"]

    def count(*_):
        counts[phase[0]] += 1

    event.listen(api.engine.sync_engine, "before_cursor_execute", count)
    try:
        expected = [
            comparable(await export_data(Response(), user(), db, 10, offset))
            for offset in range(0, 190, 10)
        ]
        phase[0] = "inventory"
        ctx = await SnapshotSourceContext.prepare(db, "owner", 1)
        actual = [comparable(await private_page(db, ctx, offset)) for offset in range(0, 190, 10)]
        assert actual == expected
        assert sum(len(page["datasets"]["workouts"]) for page in actual) == 190
        assert sum(len(page["datasets"]["workout_versions"]) for page in actual) == 190
        assert counts["inventory"] < counts["legacy"] / 2
        assert actual[-1]["has_more"]["workout_versions"] is False
        print(
            f"INVENTORY_QUERIES legacy={counts['legacy']} optimized_including_prepare_and_guards={counts['inventory']}"
        )
        ctx.close()
    finally:
        event.remove(api.engine.sync_engine, "before_cursor_execute", count)
        await db.close()


async def test_source_view_stays_fixed_after_concurrent_add_and_edit(inventory_api):
    api = inventory_api
    await records(api, 11)
    db = await source(api)
    try:
        ctx = await SnapshotSourceContext.prepare(db, "owner", 1)
        first = await private_page(db, ctx, 0)
        async with api.sessions.begin() as writer:
            row = await writer.scalar(
                select(WorkoutRecord).order_by(WorkoutRecord.created_at, WorkoutRecord.id).limit(1)
            )
            row.content = {**row.content, "title": "Newer committed edit"}
        await records(api, 1)
        last = await private_page(db, ctx, 10)
        assert last.totals["workouts"] == 11 and len(last.datasets["workouts"]) == 1
        assert last.datasets["workouts"][0]["content"]["title"] != "Newer committed edit"
        assert first.totals == last.totals
        ctx.close()
    finally:
        await db.close()


async def test_wrapped_builtin_stays_optimized_and_retires_before_rollback(
    inventory_api, monkeypatch
):
    api = inventory_api
    await records(api, 11)
    captured = []
    original = SnapshotSourceContext.prepare.__func__

    async def prepare(cls, db, owner, generation):
        context = await original(cls, db, owner, generation)
        captured.append((db, context))
        return context

    monkeypatch.setattr(SnapshotSourceContext, "prepare", classmethod(prepare))
    rollback = AsyncSession.rollback

    async def verify(db, *args, **kwargs):
        for source_db, context in captured:
            if source_db is db:
                assert context._closed and context.static_metadata() is None
                assert source_context.get() is None
        return await rollback(db, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, "rollback", verify)
    service = export_service.PrivateExportService(api.sessions, settings=settings())
    builtin = service.page_source

    async def wrapped(db, current, limit, offset):
        assert source_context.get() is captured[-1][1]
        return await builtin(db, current, limit, offset)

    service.page_source = wrapped
    result = await service.create(user(), 1)
    assert result.page_count == 2 and len(captured) == 1
    assert captured[0][1]._closed and source_context.get() is None


@pytest.mark.parametrize("cancel", [False, True])
async def test_failure_and_cancellation_clear_context_before_source_exit(
    inventory_api, monkeypatch, cancel
):
    api = inventory_api
    await records(api, 11)
    captured = []
    original = SnapshotSourceContext.prepare.__func__

    async def prepare(cls, db, owner, generation):
        context = await original(cls, db, owner, generation)
        captured.append((db, context, db.sync_session.get_transaction()))
        return context

    monkeypatch.setattr(SnapshotSourceContext, "prepare", classmethod(prepare))
    from sqlalchemy.orm import Session

    def ended(session, transaction):
        for db, context, source_transaction in captured:
            if session is db.sync_session and transaction is source_transaction:
                assert context._closed and context.static_metadata() is None
                assert source_context.get() is None

    event.listen(Session, "after_transaction_end", ended)
    service = export_service.PrivateExportService(api.sessions, settings=settings())
    builtin = service.page_source

    async def interrupted(db, current, limit, offset):
        await builtin(db, current, limit, offset)
        assert captured[-1][1].static_metadata() is not None
        if cancel:
            raise asyncio.CancelledError()
        raise RuntimeError("Synthetic failure")

    service.page_source = interrupted
    try:
        with pytest.raises(asyncio.CancelledError if cancel else RuntimeError):
            await service.create(user(), 1)
        assert captured[0][1]._closed and source_context.get() is None
    finally:
        event.remove(Session, "after_transaction_end", ended)


async def test_custom_callback_never_prepares_or_inherits_inventory(inventory_api, monkeypatch):
    api = inventory_api

    async def forbidden(*_):
        raise AssertionError("Custom source must not inventory")

    monkeypatch.setattr(SnapshotSourceContext, "prepare", forbidden)
    calls = []

    async def custom(db, current, limit, offset):
        assert source_context.get() is None
        calls.append((limit, offset))
        return await export_data(Response(), current, db, limit, offset)

    service = export_service.PrivateExportService(
        api.sessions, settings=settings(), page_source=custom
    )
    token = source_context.set(object())
    try:
        result = await service.create(user(), 1)
        assert result.page_count == 1 and calls == [(10, 0)]
        assert source_context.get() is not None
    finally:
        source_context.reset(token)


async def test_concurrent_legacy_otherowner_cannot_read_active_context(inventory_api):
    api = inventory_api
    await enroll(api, other=True)
    await records(api, 1)
    db = await source(api)
    try:
        ctx = await SnapshotSourceContext.prepare(db, "owner", 1)
        token = source_context.set(ctx)

        async def legacy():
            async with api.sessions() as other:
                return await export_data(Response(), user("other"), other, 10, 0)

        try:
            page = await asyncio.create_task(legacy())
            assert page.totals["workouts"] == 0 and page.profile is None
        finally:
            source_context.reset(token)
        ctx.close()
    finally:
        await db.close()


async def test_cached_builtin_metadata_cannot_publish_after_privacy_correction(
    inventory_api, monkeypatch
):
    from app.domains.workouts.export_models import WorkoutsExportPage, WorkoutsExportSnapshot
    from app.domains.workouts.export_service import invalidate_export_snapshots
    from app.domains.workouts.lifecycle import membership_for

    api = inventory_api
    await records(api, 11)
    await optional_rows(api)
    committed = asyncio.Event()
    resume = asyncio.Event()
    captured = []
    prepare = SnapshotSourceContext.prepare.__func__

    async def record_context(cls, db, owner, generation):
        ctx = await prepare(cls, db, owner, generation)
        captured.append(ctx)
        return ctx

    monkeypatch.setattr(SnapshotSourceContext, "prepare", classmethod(record_context))
    service = export_service.PrivateExportService(api.sessions, settings=settings())
    original_page = service.page_source

    async def wrapped(db, current, limit, offset):
        assert service._builtin_page_source
        return await original_page(db, current, limit, offset)

    service.page_source = wrapped
    original_write = service._write_page

    async def write(*args):
        await original_write(*args)
        if args[-2] == 0:
            committed.set()
            await resume.wait()

    monkeypatch.setattr(service, "_write_page", write)
    task = asyncio.create_task(service.create(user(), 1))
    try:
        await asyncio.wait_for(committed.wait(), 5)
        assert captured[0].static_metadata()["profile"]["readiness"] == "limited"
        async with api.sessions.begin() as writer:
            await membership_for(writer, "owner", generation=1, write=True)
            profile = await writer.get(WorkoutsProfile, "owner")
            profile.content = {
                **profile.content,
                "weight_kg": 71,
                "weight_recorded_at": "2026-01-01T00:00:00Z",
            }
            profile.revision += 1
            await invalidate_export_snapshots(writer, "owner", 1)
        resume.set()
        with pytest.raises(HTTPException) as caught:
            await task
        assert caught.value.status_code == 410
        assert captured[0]._closed and captured[0].static_metadata() is None
        assert source_context.get() is None
        async with api.sessions() as db:
            assert (await db.scalars(select(WorkoutsExportSnapshot))).all() == []
            assert (await db.scalars(select(WorkoutsExportPage))).all() == []
    finally:
        resume.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
