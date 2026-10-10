"""Dedicated PostgreSQL health consent, sync, erasure and owned-export cases."""

import asyncio
import importlib
import os
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, Request
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser, get_current_user
from app.config import Settings
from app.db import get_db
from app.db.database import Base as RecipesBase
from app.domains.workouts import health_router, security
from app.domains.workouts.health_models import (
    HealthConnection,
    HealthExportIntent,
    HealthObservation,
)
from app.domains.workouts.health_service import (
    erase_health_product_data,
    export_health_page,
    health_activity_exclusion_clause,
    invalidate_health_access,
)
from app.domains.workouts.lifecycle import membership_for
from app.domains.workouts.models import (
    WorkoutsActivity,
    WorkoutsConsent,
    WorkoutsMembership,
    WorkoutsSession,
)
from app.domains.workouts.router import router as data_router
from app.models.identity import AppUser
from tests.database_safety import require_disposable_test_database

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Dedicated disposable PostgreSQL required")
account_migration = importlib.import_module("migrations.034_add_workouts_domain")
health_migration = importlib.import_module("migrations.036_add_workouts_health")
HEADERS = {"X-Workouts-Generation": "1"}
ENROLL = {
    "adult_confirmed": True,
    "shared_account_deletion_acknowledged": True,
    "disclosure_version": 1,
}


def settings(**changes):
    values = dict(
        database_url="postgresql://test:test@localhost/hafa_health_test",
        environment="test",
        openai_api_key="test",
        workouts_api_enabled=True,
        workouts_public_access_enabled=True,
        workouts_health_sync_enabled=True,
    )
    values.update(changes)
    return Settings(**values)


@pytest.fixture
async def api(monkeypatch):
    require_disposable_test_database(URL)
    engine = create_async_engine(URL)
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(RecipesBase.metadata.create_all)
        await conn.execute(
            text("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT)")
        )
        await conn.execute(text("INSERT INTO schema_migrations VALUES(33,'fixture baseline')"))
    await account_migration.run_migration(configured=settings(), migration_engine=engine)
    async with engine.begin() as conn:
        # This slice depends on the 035 ledger, not the jobs tables. Full-chain
        # acceptance belongs to root when its separate 035 implementation lands.
        await conn.execute(
            text(
                "ALTER TABLE workouts_schema_migrations DROP CONSTRAINT workouts_schema_migrations_version_check"
            )
        )
        await conn.execute(
            text(
                "INSERT INTO workouts_schema_migrations(version,release_id) VALUES(35,'synthetic prerequisite ledger')"
            )
        )
    await health_migration.run_migration(configured=settings(), migration_engine=engine)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        db.add_all([AppUser(id="owner"), AppUser(id="other")])
        await db.commit()
    app = FastAPI()
    app.include_router(data_router)
    app.include_router(health_router.router)

    async def db_override():
        async with sessions() as db:
            yield db

    async def user_override(request: Request):
        return ClerkUser(
            id=request.headers.get("X-Test-User", "owner"),
            clerk_user_id="subject",
            clerk_issuer="https://example.test",
            clerk_environment="test",
        )

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[get_current_user] = user_override
    monkeypatch.setattr(security, "get_settings", settings)
    monkeypatch.setattr(health_router, "get_settings", settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for owner in ("owner", "other"):
            response = await client.post(
                "/api/v1/workouts/enrollment", json=ENROLL, headers={"X-Test-User": owner}
            )
            assert response.status_code == 200
        yield SimpleNamespace(client=client, sessions=sessions, engine=engine)
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await engine.dispose()


async def connect(api, provider="apple_health", **changes):
    payload = dict(
        expected_revision=0,
        connected=True,
        read_on_device=True,
        upload_to_server=True,
        use_for_ai=False,
        write_actuals=False,
    )
    payload.update(changes)
    response = await api.client.put(
        f"/api/v1/workouts/health/{provider}/connection", json=payload, headers=HEADERS
    )
    assert response.status_code == 200, response.text
    return response.json()


def observation(provider="apple_health", source="one", **changes):
    value = dict(
        source_id=f"{provider}:{source}",
        provider=provider,
        origin_id="com.example.watch",
        started_at="2026-10-01T10:00:00+10:00",
        ended_at="2026-10-01T10:10:00+10:00",
        duration_seconds=600,
        duration_basis="provider_reported" if provider == "apple_health" else "elapsed_interval",
        activity_type="healthkit:37" if provider == "apple_health" else "health_connect:56",
        ai_eligibility="unknown",
    )
    value.update(changes)
    return value


def page(provider="apple_health", **changes):
    value = dict(
        receipt_id=str(uuid4()),
        expected_revision=1,
        observations=[observation(provider)],
        deleted_source_ids=[],
    )
    value.update(changes)
    return value


async def count(api, model):
    async with api.sessions() as db:
        return await db.scalar(select(func.count()).select_from(model))


async def actual(api, **changes):
    content = dict(
        started_at="2026-10-01T10:00:00+10:00",
        finished_at="2026-10-01T10:10:00+10:00",
        active_seconds=600,
        activity_type="running",
        status="completed",
        actuals=[],
    )
    content.update(changes)
    async with api.sessions() as db:
        row = WorkoutsSession(
            app_user_id="owner",
            generation=1,
            client_session_id=uuid4(),
            request_hash="synthetic",
            content=content,
        )
        db.add(row)
        await db.commit()
        return row


async def test_no_implicit_connection_or_ai_grant(api):
    result = await api.client.get("/api/v1/workouts/health/apple_health/connection")
    assert result.status_code == 200 and not result.json()["connected"]
    assert (
        await api.client.post(
            "/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS
        )
    ).status_code == 409
    assert await count(api, HealthObservation) == 0


async def test_device_only_does_not_authorize_upload(api):
    await connect(api, upload_to_server=False)
    response = await api.client.post(
        "/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS
    )
    assert response.status_code == 403


async def test_sync_retry_dedup_receipt_conflict_and_unknown_ai(api):
    await connect(api)
    payload = page()
    first = await api.client.post(
        "/api/v1/workouts/health/apple_health/sync", json=payload, headers=HEADERS
    )
    second = await api.client.post(
        "/api/v1/workouts/health/apple_health/sync", json=payload, headers=HEADERS
    )
    assert first.status_code == second.status_code == 200 and first.json() == second.json()
    assert await count(api, HealthObservation) == await count(api, WorkoutsActivity) == 1
    modified = {**payload, "observations": [observation(source="different")]}
    assert (
        await api.client.post(
            "/api/v1/workouts/health/apple_health/sync", json=modified, headers=HEADERS
        )
    ).status_code == 409
    result = await api.client.get("/api/v1/workouts/health/apple_health/observations")
    assert result.json()[0]["ai_eligibility"] == "unknown"


async def test_strava_restricted_own_echo_ignored_and_raw_ai_eligibility_rejected(api):
    await connect(api)
    response = await api.client.post(
        "/api/v1/workouts/health/apple_health/sync",
        json=page(
            observations=[
                observation(origin_id="com.strava.app"),
                observation(source="own", origin_id="com.shimizutechnology.hafaworkouts"),
            ]
        ),
        headers=HEADERS,
    )
    assert (
        response.status_code == 200
        and response.json()["accepted"] == response.json()["ignored"] == 1
    )
    result = await api.client.get("/api/v1/workouts/health/apple_health/observations")
    assert result.json()[0]["ai_eligibility"] == "restricted"
    forged = page(observations=[observation(ai_eligibility="eligible")])
    assert (
        await api.client.post(
            "/api/v1/workouts/health/apple_health/sync", json=forged, headers=HEADERS
        )
    ).status_code == 422


async def test_updated_source_replaces_projection_without_duplicate_and_stale_update_ignored(api):
    await connect(api, "health_connect")
    first = observation("health_connect", updated_at="2026-10-02T00:00:00Z")
    second = observation(
        "health_connect",
        ended_at="2026-10-01T10:20:00+10:00",
        duration_seconds=1200,
        updated_at="2026-10-03T00:00:00Z",
    )
    for item in (first, second, first):
        result = await api.client.post(
            "/api/v1/workouts/health/health_connect/sync",
            json=page("health_connect", observations=[item]),
            headers=HEADERS,
        )
        assert result.status_code == 200, result.text
    assert await count(api, HealthObservation) == await count(api, WorkoutsActivity) == 1
    result = await api.client.get("/api/v1/workouts/health/health_connect/observations")
    assert result.json()[0]["duration_seconds"] == 1200


async def test_deletion_is_owned_provider_scoped_and_does_not_erase_manual_activity(api):
    await connect(api)
    await api.client.post("/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS)
    async with api.sessions() as db:
        db.add(
            WorkoutsActivity(
                app_user_id="owner",
                generation=1,
                content={"date": "2026-10-01", "name": "Manual run"},
            )
        )
        await db.commit()
    deleted = await api.client.post(
        "/api/v1/workouts/health/apple_health/sync",
        json=page(observations=[], deleted_source_ids=["apple_health:one"]),
        headers=HEADERS,
    )
    assert deleted.json()["deleted"] == 1
    assert await count(api, HealthObservation) == 0 and await count(api, WorkoutsActivity) == 1


async def test_disconnect_erases_imports_preserves_manual_actuals_and_rejects_late_receipts(api):
    await connect(api)
    old = page()
    await api.client.post("/api/v1/workouts/health/apple_health/sync", json=old, headers=HEADERS)
    await actual(api)
    response = await api.client.put(
        "/api/v1/workouts/health/apple_health/connection",
        json={"expected_revision": 1, "connected": False},
        headers=HEADERS,
    )
    assert response.status_code == 200 and response.json()["revision"] == 2
    assert await count(api, HealthObservation) == await count(api, WorkoutsActivity) == 0
    assert await count(api, WorkoutsSession) == 1
    assert (
        await api.client.post(
            "/api/v1/workouts/health/apple_health/sync", json=old, headers=HEADERS
        )
    ).status_code == 409


async def test_generic_grant_revocation_hook_fences_pending_sync(api):
    await connect(api)
    await api.client.post("/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS)
    async with api.sessions() as db:
        await membership_for(db, "owner", generation=1, write=True)
        await invalidate_health_access(db, "owner", 1, {"health_activity_read"})
        await db.commit()
    assert await count(api, HealthObservation) == 0
    assert (
        await api.client.post(
            "/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS
        )
    ).status_code == 409


async def test_global_ai_disclosure_is_separate_from_health_and_generic_scopes(api):
    bad = await api.client.put(
        "/api/v1/workouts/health/apple_health/connection",
        json={
            "expected_revision": 0,
            "connected": True,
            "read_on_device": True,
            "upload_to_server": True,
            "use_for_ai": True,
        },
        headers=HEADERS,
    )
    assert bad.status_code == 409
    async with api.sessions() as db:
        db.add(
            WorkoutsConsent(
                app_user_id="owner",
                generation=1,
                disclosure_version=1,
                accepted_at=datetime.now(UTC),
            )
        )
        await db.commit()
    await connect(api, use_for_ai=True)
    result = await api.client.post(
        "/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS
    )
    assert result.status_code == 200
    records = await api.client.get("/api/v1/workouts/health/apple_health/observations")
    assert records.json()[0]["ai_eligibility"] == "unknown"


async def test_cross_owner_reads_and_export_intent_are_isolated(api):
    await connect(api)
    await api.client.post("/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS)
    other = await api.client.get(
        "/api/v1/workouts/health/apple_health/connection", headers={"X-Test-User": "other"}
    )
    assert not other.json()["connected"]
    assert (
        await api.client.get(
            "/api/v1/workouts/health/apple_health/observations", headers={"X-Test-User": "other"}
        )
    ).status_code == 409


async def test_export_uses_owned_actuals_permission_and_idempotent_intent(api):
    await connect(api, write_actuals=True)
    row = await actual(api)
    request = {"session_id": str(row.id), "expected_revision": 1}
    first = await api.client.post(
        "/api/v1/workouts/health/apple_health/exports", json=request, headers=HEADERS
    )
    second = await api.client.post(
        "/api/v1/workouts/health/apple_health/exports", json=request, headers=HEADERS
    )
    assert (
        first.status_code == second.status_code == 200
        and first.json()["intent_id"] == second.json()["intent_id"]
    )
    actual_data = first.json()["actual"]
    assert actual_data["canonical_session_id"] == str(row.client_session_id)
    assert actual_data["active_seconds"] == 600 and actual_data["activity"] == "running"
    assert "calories" not in actual_data and "distance" not in actual_data
    acknowledgment = {
        "expected_revision": 1,
        "status": "written",
        "source_id": "apple_health:written",
    }
    endpoint = (
        f"/api/v1/workouts/health/apple_health/exports/{first.json()['intent_id']}/acknowledgment"
    )
    assert (await api.client.post(endpoint, json=acknowledgment, headers=HEADERS)).json()[
        "status"
    ] == "reported_written"
    assert (
        await api.client.post(endpoint, json=acknowledgment, headers=HEADERS)
    ).status_code == 200
    conflicting = {**acknowledgment, "source_id": "apple_health:different"}
    assert (await api.client.post(endpoint, json=conflicting, headers=HEADERS)).status_code == 409
    assert await count(api, HealthExportIntent) == 1


async def test_export_does_not_infer_unrecorded_or_paused_active_time(api):
    await connect(api, write_actuals=True)
    for duration in (None, 400):
        row = await actual(api, active_seconds=duration)
        response = await api.client.post(
            "/api/v1/workouts/health/apple_health/exports",
            json={"session_id": str(row.id), "expected_revision": 1},
            headers=HEADERS,
        )
        assert response.status_code == 200 and response.json()["status"] == "unsupported"
    assert await count(api, HealthExportIntent) == 0


async def test_per_product_health_erasure_helper_and_whole_owner_cascade(api):
    await connect(api)
    await api.client.post("/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS)
    async with api.sessions() as db:
        await membership_for(db, "owner", generation=1, write=True)
        await erase_health_product_data(db, "owner", 1)
        await db.commit()
    assert await count(api, HealthObservation) == await count(api, HealthConnection) == 0
    assert await count(api, WorkoutsMembership) == 2


async def test_whole_owner_cascade_erases_all_health_rows(api):
    await connect(api, write_actuals=True)
    await api.client.post("/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS)
    row = await actual(api)
    await api.client.post(
        "/api/v1/workouts/health/apple_health/exports",
        json={"session_id": str(row.id), "expected_revision": 1},
        headers=HEADERS,
    )
    async with api.sessions() as db:
        await db.execute(delete(AppUser).where(AppUser.id == "owner"))
        await db.commit()
    assert (
        await count(api, HealthConnection)
        == await count(api, HealthObservation)
        == await count(api, HealthExportIntent)
        == 0
    )


async def test_ai_activity_queries_cannot_treat_imported_health_as_manual_context(api):
    await connect(api)
    await api.client.post("/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS)
    async with api.sessions() as db:
        manual = WorkoutsActivity(
            app_user_id="owner",
            generation=1,
            content={"date": "2026-10-01", "name": "Manual activity"},
        )
        db.add(manual)
        await db.commit()
        rows = list(
            (
                await db.scalars(
                    select(WorkoutsActivity).where(
                        WorkoutsActivity.app_user_id == "owner",
                        WorkoutsActivity.generation == 1,
                        health_activity_exclusion_clause("owner", 1),
                    )
                )
            ).all()
        )
        assert [row.id for row in rows] == [manual.id]


async def test_timezone_equivalent_sources_deduplicate_without_update_evidence(api):
    await connect(api)
    await api.client.post("/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS)
    equivalent = observation(started_at="2026-10-01T00:00:00Z", ended_at="2026-10-01T00:10:00Z")
    response = await api.client.post(
        "/api/v1/workouts/health/apple_health/sync",
        json=page(observations=[equivalent]),
        headers=HEADERS,
    )
    assert response.status_code == 200 and response.json()["ignored"] == 1
    assert await count(api, WorkoutsActivity) == 1


async def test_snapshot_reconciliation_requires_complete_window_and_keeps_outside_data(api):
    await connect(api, "health_connect")
    outside = observation(
        "health_connect",
        source="outside",
        started_at="2026-09-01T00:00:00Z",
        ended_at="2026-09-01T00:10:00Z",
    )
    await api.client.post(
        "/api/v1/workouts/health/health_connect/sync",
        json=page("health_connect", observations=[observation("health_connect"), outside]),
        headers=HEADERS,
    )
    cursor = {
        "provider": "health_connect",
        "window_start": "2026-09-20T00:00:00Z",
        "window_end": "2026-10-10T00:00:00Z",
        "phase": "bootstrap",
        "page_token": "next",
    }
    unfinished = page(
        "health_connect", observations=[], next_cursor=cursor, has_more=True, reset_required=True
    )
    await api.client.post(
        "/api/v1/workouts/health/health_connect/sync", json=unfinished, headers=HEADERS
    )
    request = {
        "expected_revision": 1,
        "window_start": cursor["window_start"],
        "window_end": cursor["window_end"],
        "receipt_ids": [unfinished["receipt_id"]],
    }
    assert (
        await api.client.post(
            "/api/v1/workouts/health/health_connect/reconcile", json=request, headers=HEADERS
        )
    ).status_code == 409
    complete = page(
        "health_connect",
        observations=[],
        next_cursor={**cursor, "phase": "changes", "page_token": None, "changes_token": "changes"},
        has_more=False,
    )
    await api.client.post(
        "/api/v1/workouts/health/health_connect/sync", json=complete, headers=HEADERS
    )
    request["receipt_ids"].append(complete["receipt_id"])
    result = await api.client.post(
        "/api/v1/workouts/health/health_connect/reconcile", json=request, headers=HEADERS
    )
    assert result.status_code == 200 and result.json()["deleted"] == 1
    assert await count(api, HealthObservation) == await count(api, WorkoutsActivity) == 1


async def test_write_intent_late_acknowledgment_is_fenced_after_disconnect(api):
    await connect(api, write_actuals=True)
    row = await actual(api)
    prepared = await api.client.post(
        "/api/v1/workouts/health/apple_health/exports",
        json={"session_id": str(row.id), "expected_revision": 1},
        headers=HEADERS,
    )
    await api.client.put(
        "/api/v1/workouts/health/apple_health/connection",
        json={"expected_revision": 1, "connected": False},
        headers=HEADERS,
    )
    endpoint = f"/api/v1/workouts/health/apple_health/exports/{prepared.json()['intent_id']}/acknowledgment"
    response = await api.client.post(
        endpoint,
        json={"expected_revision": 1, "status": "written", "source_id": "apple_health:old-write"},
        headers=HEADERS,
    )
    assert response.status_code == 409


async def test_source_metadata_change_without_revision_is_conflict_not_silent_overwrite(api):
    await connect(api)
    await api.client.post("/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS)
    changed = observation(ended_at="2026-10-01T10:11:00+10:00", duration_seconds=660)
    result = await api.client.post(
        "/api/v1/workouts/health/apple_health/sync",
        json=page(observations=[changed]),
        headers=HEADERS,
    )
    assert result.status_code == 409
    assert await count(api, HealthObservation) == 1


async def test_sync_waiting_on_owner_lock_observes_committed_revocation(api):
    await connect(api)
    async with api.sessions() as revoker:
        await membership_for(revoker, "owner", generation=1, write=True)
        pending = asyncio.create_task(
            api.client.post(
                "/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS
            )
        )
        try:
            # Verify PostgreSQL lock waiting rather than relying on an arbitrary
            # sleep to claim the race actually occurred.
            waiting = False
            for _ in range(100):
                async with api.engine.connect() as inspector:
                    waiting = bool(
                        await inspector.scalar(
                            text(
                                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid())"
                            )
                        )
                    )
                if waiting:
                    break
                await asyncio.sleep(0.01)
            assert waiting, "The sync did not reach its owner lock during this test"
            await invalidate_health_access(revoker, "owner", 1, {"health_activity_read"})
            await revoker.commit()
            assert (await pending).status_code == 409
            assert await count(api, HealthObservation) == 0
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)


async def test_foreign_session_cannot_be_prepared_after_other_owner_connects(api):
    await connect(api, write_actuals=True)
    row = await actual(api)
    other = {**HEADERS, "X-Test-User": "other"}
    result = await api.client.put(
        "/api/v1/workouts/health/apple_health/connection",
        json={"expected_revision": 0, "connected": True, "write_actuals": True},
        headers=other,
    )
    assert result.status_code == 200
    result = await api.client.post(
        "/api/v1/workouts/health/apple_health/exports",
        json={"expected_revision": 1, "session_id": str(row.id)},
        headers=other,
    )
    assert result.status_code == 404


async def test_private_body_metrics_routes_and_forged_health_fields_are_unsupported(api):
    await connect(api)
    bad = observation(weight_kg=90)
    assert (
        await api.client.post(
            "/api/v1/workouts/health/apple_health/sync",
            json=page(observations=[bad]),
            headers=HEADERS,
        )
    ).status_code == 422
    assert (
        await api.client.post(
            "/api/v1/workouts/health/apple_health/sync",
            json=page(observations=[observation(duration_seconds=True)]),
            headers=HEADERS,
        )
    ).status_code == 422
    assert await count(api, HealthObservation) == 0


async def test_health_export_contains_owned_provenance_not_cursors_or_other_owner(api):
    await connect(api)
    await api.client.post("/api/v1/workouts/health/apple_health/sync", json=page(), headers=HEADERS)
    async with api.sessions() as db:
        exported = await export_health_page(db, "owner", 1)
        other = await export_health_page(db, "other", 1)
    assert exported["observations"][0]["origin_id"] == "com.example.watch"
    assert "cursor" not in exported["connections"][0]
    assert other["observations"] == other["connections"] == []


async def test_master_health_disabled_gates_before_auth_and_database(api, monkeypatch):
    monkeypatch.setattr(
        health_router, "get_settings", lambda: settings(workouts_health_sync_enabled=False)
    )
    api.client.headers["X-Test-User"] = "missing-owner"
    assert (
        await api.client.get("/api/v1/workouts/health/apple_health/connection")
    ).status_code == 404


async def test_stale_generation_and_source_provider_mismatch(api):
    await connect(api)
    assert (
        await api.client.post(
            "/api/v1/workouts/health/apple_health/sync",
            json=page(),
            headers={"X-Workouts-Generation": "2"},
        )
    ).status_code == 409
    assert (
        await api.client.post(
            "/api/v1/workouts/health/apple_health/sync",
            json=page(observations=[observation("health_connect")]),
            headers=HEADERS,
        )
    ).status_code == 422
    assert await count(api, HealthObservation) == 0


async def test_health_migration_replays_and_dormant_does_not_connect(api):
    await health_migration.run_migration(configured=settings(), migration_engine=api.engine)

    class Forbidden:
        def begin(self):
            raise AssertionError("Disabled optional migration cannot connect")

    await health_migration.run_migration(
        configured=settings(workouts_health_sync_enabled=False), migration_engine=Forbidden()
    )
    async with api.engine.connect() as conn:
        assert (
            await conn.scalar(
                text("SELECT count(*) FROM workouts_schema_migrations WHERE version=36")
            )
            == 1
        )
