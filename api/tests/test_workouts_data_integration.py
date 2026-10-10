"""Real PostgreSQL ownership, optimistic concurrency, and erasure acceptance."""

import asyncio
import importlib
import os
from datetime import date
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, Request
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser, get_current_user
from app.config import Settings
from app.db import get_db
from app.db.database import Base as RecipesBase
from app.domains.workouts import lifecycle, security
from app.domains.workouts.models import (
    WORKOUTS_TABLES,
    WorkoutRecord,
    WorkoutsMembership,
    WorkoutsSession,
    WorkoutVersion,
)
from app.domains.workouts.programming import build_program
from app.domains.workouts.router import router
from app.domains.workouts.runtime import verify_workouts_schema
from app.domains.workouts.schemas import TrainingProfile
from app.models.identity import AppUser, ClerkIdentity
from app.models.recipe import Recipe
from app.routers.users import delete_account
from tests.database_safety import require_disposable_test_database

DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
migration = importlib.import_module("migrations.034_add_workouts_domain")
ENROLL = {
    "adult_confirmed": True,
    "shared_account_deletion_acknowledged": True,
    "disclosure_version": 1,
}
GENERATION = {"X-Workouts-Generation": "1"}
WORKOUT = {
    "title": "Fixture strength",
    "blocks": [
        {
            "id": "strength",
            "label": "Strength",
            "exercises": [{"name": "Squat", "sets": 2, "reps_min": 8, "reps_max": 12}],
        }
    ],
}


def settings(**changes):
    return Settings(
        database_url="postgresql://test:test@localhost/hafa_workouts_test",
        openai_api_key="test",
        environment="test",
        workouts_api_enabled=True,
        workouts_public_access_enabled=True,
        **changes,
    )


def user(identifier="owner"):
    return ClerkUser(
        id=identifier,
        clerk_user_id="user_distinct_subject",
        clerk_issuer="https://example.test",
        clerk_environment="test",
    )


@pytest.fixture
async def data_api(monkeypatch):
    require_disposable_test_database(DATABASE_URL)
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.run_sync(RecipesBase.metadata.create_all)
        await connection.execute(
            text("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT)")
        )
        await connection.execute(
            text("INSERT INTO schema_migrations VALUES (33,'fixture core baseline')")
        )
    await migration.run_migration(configured=settings(), migration_engine=engine)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        db.add_all([AppUser(id="owner"), AppUser(id="other")])
        await db.commit()
    app = FastAPI()
    app.include_router(router)

    async def db_override():
        async with sessions() as db:
            yield db

    async def auth_override(request: Request):
        return user(request.headers.get("X-Test-User", "owner"))

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[get_current_user] = auth_override
    monkeypatch.setattr(security, "get_settings", settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield SimpleNamespace(client=client, sessions=sessions, engine=engine, app=app)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
    await engine.dispose()


async def enroll(api, *, other=False, generation=None):
    payload = dict(ENROLL)
    if generation:
        payload["expected_generation"] = generation
    response = await api.client.post(
        "/api/v1/workouts/enrollment",
        json=payload,
        headers={"X-Test-User": "other"} if other else {},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def workout(api):
    await enroll(api)
    response = await api.client.post("/api/v1/workouts/library", json=WORKOUT, headers=GENERATION)
    assert response.status_code == 201, response.text
    return response.json()


def session_payload(row, **changes):
    payload = {
        "client_session_id": str(uuid4()),
        "workout_id": row["id"],
        "workout_revision": row["revision"],
        "started_at": "2026-10-10T10:00:00+10:00",
        "finished_at": "2026-10-10T10:20:00+10:00",
        "status": "completed",
        "actuals": [
            {
                "block_id": "strength",
                "exercise_index": 0,
                "set_index": 1,
                "reps": 10,
                "completed": True,
            }
        ],
    }
    payload.update(changes)
    return payload


async def test_disabled_product_is_404_before_auth_database_or_json_parsing(data_api, monkeypatch):
    monkeypatch.setattr(
        security,
        "get_settings",
        lambda: Settings(
            database_url="postgresql://localhost/test", openai_api_key="test", environment="test"
        ),
    )

    def forbidden():
        raise AssertionError("Disabled product must not authenticate or use the database")

    data_api.app.dependency_overrides[get_current_user] = forbidden
    data_api.app.dependency_overrides[get_db] = forbidden
    assert (await data_api.client.get("/api/v1/workouts/profile")).status_code == 404
    assert (
        await data_api.client.post("/api/v1/workouts/enrollment", content="not json")
    ).status_code == 404


async def test_allowlist_uses_stable_identity_and_public_flag(data_api, monkeypatch):
    configured = Settings(
        database_url="postgresql://localhost/test",
        openai_api_key="test",
        environment="test",
        workouts_api_enabled=True,
        workouts_tester_user_ids=" owner ,owner ",
    )
    monkeypatch.setattr(security, "get_settings", lambda: configured)
    assert (await data_api.client.get("/api/v1/workouts/enrollment")).status_code == 200
    assert (
        await data_api.client.get("/api/v1/workouts/enrollment", headers={"X-Test-User": "other"})
    ).status_code == 403
    assert "user_distinct_subject" not in configured.workouts_testers


async def test_anonymous_cannot_access_product_data(data_api):
    del data_api.app.dependency_overrides[get_current_user]
    response = await data_api.client.get("/api/v1/workouts/profile")
    assert response.status_code == 401


@pytest.mark.parametrize(
    "path",
    ["profile", "library", "programs", "sessions", "activities", "export", "grants", "ai-consent"],
)
async def test_enrollment_precedes_all_private_datasets(data_api, path):
    assert (await data_api.client.get(f"/api/v1/workouts/{path}")).status_code == 409


@pytest.mark.parametrize(
    "changes",
    [
        {"adult_confirmed": False},
        {"shared_account_deletion_acknowledged": False},
        {"disclosure_version": 2},
        {"adult_confirmed": "true"},
        {"user_id": "other"},
    ],
)
async def test_enrollment_rejects_missing_disclosure_and_untrusted_owner_fields(data_api, changes):
    assert (
        await data_api.client.post("/api/v1/workouts/enrollment", json={**ENROLL, **changes})
    ).status_code == 422
    async with data_api.sessions() as db:
        assert await db.get(WorkoutsMembership, "owner") is None


async def test_enrollment_and_profile_are_persisted_with_optimistic_revision(data_api):
    initial = (await data_api.client.get("/api/v1/workouts/enrollment")).json()
    assert initial["generation"] is None and not initial["enrolled"]
    assert (await enroll(data_api))["generation"] == 1
    empty = await data_api.client.get("/api/v1/workouts/profile")
    assert empty.json() is None and empty.headers["X-Workouts-Revision"] == "0"
    headers = {**GENERATION, "If-Match": '"0"'}
    first = await data_api.client.put(
        "/api/v1/workouts/profile",
        headers=headers,
        json={"weight_kg": 80, "equipment": [], "available_days": [0, 2]},
    )
    assert first.status_code == 200 and first.json()["adult_confirmed"] is True
    assert first.headers["X-Workouts-Revision"] == "1"
    stale = await data_api.client.put(
        "/api/v1/workouts/profile", headers=headers, json={"weight_kg": 90}
    )
    assert stale.status_code == 409
    assert (await data_api.client.get("/api/v1/workouts/profile")).json()["weight_kg"] == 80
    assert (
        await data_api.client.put("/api/v1/workouts/profile", headers=GENERATION, json={})
    ).status_code == 428
    assert (
        await data_api.client.put(
            "/api/v1/workouts/profile",
            headers={**GENERATION, "If-Match": "1"},
            json={"user_id": "other"},
        )
    ).status_code == 422


async def test_concurrent_profile_saves_conflict_instead_of_overwrite(data_api):
    await enroll(data_api)
    responses = await asyncio.gather(
        *(
            data_api.client.put(
                "/api/v1/workouts/profile",
                json={"weight_kg": weight},
                headers={**GENERATION, "If-Match": "0"},
            )
            for weight in (80, 90)
        )
    )
    assert sorted(response.status_code for response in responses) == [200, 409]


async def test_library_versions_preserve_original_and_hide_other_owners(data_api):
    row = await workout(data_api)
    await enroll(data_api, other=True)
    assert (
        await data_api.client.get("/api/v1/workouts/library", headers={"X-Test-User": "other"})
    ).json() == []
    assert (
        await data_api.client.get(
            f"/api/v1/workouts/library/{row['id']}", headers={"X-Test-User": "other"}
        )
    ).status_code == 404
    changed = await data_api.client.put(
        f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
        json={**WORKOUT, "title": "Edited"},
        headers=GENERATION,
    )
    assert changed.status_code == 200 and changed.json()["revision"] == 2
    versions = (await data_api.client.get(f"/api/v1/workouts/library/{row['id']}/versions")).json()
    assert [version["content"]["title"] for version in versions] == ["Edited", "Fixture strength"]
    assert versions[0]["content"]["parent_version_id"] == versions[1]["id"]
    assert (
        await data_api.client.put(
            f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
            json=WORKOUT,
            headers=GENERATION,
        )
    ).status_code == 409


@pytest.mark.parametrize(
    "changes",
    [
        {"id": "forged"},
        {"version": 2},
        {"parent_version_id": "forged"},
        {"app_user_id": "other"},
        {"source_url": "file:///tmp/secret"},
        {"source_url": "https://name:password@example.test"},
        {"provenance": "made_up"},
        {"provenance": "source"},
        {"provenance": "suggestion"},
        {"title": " "},
    ],
)
async def test_library_rejects_untrusted_metadata_and_source_claims(data_api, changes):
    await enroll(data_api)
    assert (
        await data_api.client.post(
            "/api/v1/workouts/library", json={**WORKOUT, **changes}, headers=GENERATION
        )
    ).status_code == 422


async def test_concurrent_workout_updates_allocate_only_one_next_version(data_api):
    row = await workout(data_api)
    responses = await asyncio.gather(
        *(
            data_api.client.put(
                f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
                json={**WORKOUT, "title": title},
                headers=GENERATION,
            )
            for title in ("First", "Second")
        )
    )
    assert sorted(response.status_code for response in responses) == [200, 409]
    async with data_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutVersion)) == 2


async def test_finalized_sessions_are_idempotent_and_snapshot_old_prescription(data_api):
    row = await workout(data_api)
    payload = session_payload(row)
    first = await data_api.client.post(
        "/api/v1/workouts/sessions", json=payload, headers=GENERATION
    )
    assert first.status_code == 201, first.text
    await data_api.client.put(
        f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
        json={**WORKOUT, "title": "Later edit"},
        headers=GENERATION,
    )
    retry = await data_api.client.post(
        "/api/v1/workouts/sessions", json=payload, headers=GENERATION
    )
    assert retry.status_code == 200 and retry.json() == first.json()
    assert retry.json()["content"]["prescription_snapshot"]["title"] == "Fixture strength"
    assert (
        await data_api.client.post(
            "/api/v1/workouts/sessions", json={**payload, "status": "partial"}, headers=GENERATION
        )
    ).status_code == 409
    async with data_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsSession)) == 1


async def test_session_foreign_workout_and_invalid_actual_reference_fail(data_api):
    row = await workout(data_api)
    await enroll(data_api, other=True)
    assert (
        await data_api.client.post(
            "/api/v1/workouts/sessions",
            json=session_payload(row),
            headers={**GENERATION, "X-Test-User": "other"},
        )
    ).status_code == 404
    bad = session_payload(
        row, actuals=[{"block_id": "unknown", "exercise_index": 0, "set_index": 1}]
    )
    assert (
        await data_api.client.post("/api/v1/workouts/sessions", json=bad, headers=GENERATION)
    ).status_code == 422


async def test_corrections_append_actuals_and_do_not_rewrite_original(data_api):
    row = await workout(data_api)
    original = (
        await data_api.client.post(
            "/api/v1/workouts/sessions", json=session_payload(row), headers=GENERATION
        )
    ).json()
    correction = session_payload(
        row,
        supersedes_session_id=original["id"],
        actuals=[
            {
                "block_id": "strength",
                "exercise_index": 0,
                "set_index": 1,
                "reps": 9,
                "completed": True,
            }
        ],
    )
    updated = await data_api.client.post(
        "/api/v1/workouts/sessions", json=correction, headers=GENERATION
    )
    assert updated.status_code == 201
    assert (
        await data_api.client.get(f"/api/v1/workouts/sessions/{original['id']}")
    ).json() == original
    assert len((await data_api.client.get("/api/v1/workouts/sessions")).json()) == 1
    assert (
        len((await data_api.client.get("/api/v1/workouts/sessions?include_superseded=true")).json())
        == 2
    )
    assert (
        await data_api.client.post(
            "/api/v1/workouts/sessions",
            json=session_payload(row, supersedes_session_id=original["id"]),
            headers=GENERATION,
        )
    ).status_code == 409


async def test_database_rejects_rewriting_versions_or_recorded_actuals(data_api):
    row = await workout(data_api)
    await data_api.client.post(
        "/api/v1/workouts/sessions", json=session_payload(row), headers=GENERATION
    )
    for table in ("workouts_library_versions", "workouts_sessions"):
        async with data_api.sessions() as db:
            with pytest.raises(DBAPIError, match="immutable"):
                await db.execute(text(f"UPDATE {table} SET content='{{}}'::jsonb"))
            await db.rollback()


async def test_program_persistence_validates_provenance_and_records_session_snapshot(data_api):
    await enroll(data_api)
    proposal = build_program(
        TrainingProfile(
            adult_confirmed=True,
            equipment=[],
            available_days=[0, 2, 4],
            session_minutes=30,
            readiness="ready",
        ),
        date(2026, 10, 12),
        weeks=1,
    )
    assert proposal.status == "ready"
    payload = {"title": "Fixture program", "proposal": proposal.model_dump(mode="json")}
    first = await data_api.client.post(
        "/api/v1/workouts/programs", json=payload, headers=GENERATION
    )
    assert first.status_code == 201, first.text
    row = first.json()
    scheduled = payload["proposal"]["sessions"][0]
    completed = {
        "client_session_id": str(uuid4()),
        "program_id": row["id"],
        "program_revision": 1,
        "program_session_id": scheduled["id"],
        "started_at": "2026-10-12T00:00:00Z",
        "finished_at": "2026-10-12T00:20:00Z",
        "status": "partial",
        "actuals": [],
    }
    session = await data_api.client.post(
        "/api/v1/workouts/sessions", json=completed, headers=GENERATION
    )
    assert session.status_code == 201
    assert session.json()["content"]["prescription_snapshot"] == scheduled["workout"]
    changed = await data_api.client.put(
        f"/api/v1/workouts/programs/{row['id']}?expected_revision=1",
        json={**payload, "title": "Revised program"},
        headers=GENERATION,
    )
    assert changed.status_code == 200 and changed.json()["revision"] == 2
    versions = (await data_api.client.get(f"/api/v1/workouts/programs/{row['id']}/versions")).json()
    assert [item["content"]["title"] for item in versions] == ["Revised program", "Fixture program"]
    reread = await data_api.client.get(f"/api/v1/workouts/sessions/{session.json()['id']}")
    assert reread.json()["content"]["prescription_snapshot"] == scheduled["workout"]
    bad = {**payload, "proposal": {**payload["proposal"], "rule_version": "invented"}}
    assert (
        await data_api.client.post("/api/v1/workouts/programs", json=bad, headers=GENERATION)
    ).status_code == 422


async def test_ai_and_cross_app_permissions_are_opt_in_and_owner_scoped(data_api):
    await enroll(data_api)
    assert (await data_api.client.get("/api/v1/workouts/grants")).json() == []
    assert (await data_api.client.get("/api/v1/workouts/ai-consent")).json()["accepted"] is False
    saved = await data_api.client.put(
        "/api/v1/workouts/grants",
        json={"scopes": ["recipes_library_context", "health_activity_read"]},
        headers=GENERATION,
    )
    assert saved.status_code == 200 and len(saved.json()) == 2
    assert (
        await data_api.client.put(
            "/api/v1/workouts/grants", json={"scopes": ["recipes_all_health"]}, headers=GENERATION
        )
    ).status_code == 422
    consent = await data_api.client.put(
        "/api/v1/workouts/ai-consent",
        json={"accepted": True, "disclosure_version": 1},
        headers=GENERATION,
    )
    assert consent.json()["accepted"] is True
    await enroll(data_api, other=True)
    assert (
        await data_api.client.get("/api/v1/workouts/grants", headers={"X-Test-User": "other"})
    ).json() == []
    assert (
        await data_api.client.get("/api/v1/workouts/ai-consent", headers={"X-Test-User": "other"})
    ).json()["accepted"] is False
    revoked = await data_api.client.put(
        "/api/v1/workouts/ai-consent",
        json={"accepted": False, "disclosure_version": 1},
        headers=GENERATION,
    )
    assert revoked.json()["accepted"] is False and revoked.json()["accepted_at"] is None


async def test_product_deletion_preserves_recipes_and_fences_stale_replays(data_api):
    row = await workout(data_api)
    await data_api.client.post(
        "/api/v1/workouts/sessions", json=session_payload(row), headers=GENERATION
    )
    async with data_api.sessions() as db:
        recipe = Recipe(
            source_url="manual://fixture",
            source_type="manual",
            extracted={"title": "Preserved"},
            user_id="owner",
        )
        identity = ClerkIdentity(
            app_user_id="owner",
            issuer="https://example.test",
            clerk_user_id="user_distinct_subject",
        )
        db.add_all([recipe, identity])
        await db.commit()
        recipe_id = recipe.id
    deleted = await data_api.client.delete("/api/v1/workouts/data", headers=GENERATION)
    assert (
        deleted.status_code == 200
        and deleted.json()["generation"] == 2
        and not deleted.json()["enrolled"]
    )
    assert (
        await data_api.client.delete("/api/v1/workouts/data", headers=GENERATION)
    ).json() == deleted.json()
    assert (
        await data_api.client.post("/api/v1/workouts/enrollment", json=ENROLL)
    ).status_code == 409
    await enroll(data_api, generation=2)
    assert (
        await data_api.client.post("/api/v1/workouts/library", json=WORKOUT, headers=GENERATION)
    ).status_code == 409
    assert (
        await data_api.client.delete("/api/v1/workouts/data", headers=GENERATION)
    ).status_code == 409
    assert (await data_api.client.get("/api/v1/workouts/library")).json() == []
    async with data_api.sessions() as db:
        assert await db.get(AppUser, "owner") is not None
        assert await db.get(Recipe, recipe_id) is not None
        assert await db.scalar(select(func.count()).select_from(ClerkIdentity)) == 1
        assert await db.scalar(select(func.count()).select_from(WorkoutsSession)) == 0


async def test_waiting_write_observes_product_deletion_tombstone(data_api, monkeypatch):
    await enroll(data_api)
    entered = asyncio.Event()
    original = lifecycle.lock_owner

    async def observed_lock(db, identifier):
        entered.set()
        await original(db, identifier)

    async with data_api.sessions() as deletion_db:
        await original(deletion_db, "owner")
        membership = await deletion_db.get(WorkoutsMembership, "owner")
        monkeypatch.setattr(lifecycle, "lock_owner", observed_lock)
        waiting = asyncio.create_task(
            data_api.client.post("/api/v1/workouts/library", json=WORKOUT, headers=GENERATION)
        )
        await asyncio.wait_for(entered.wait(), timeout=5)
        await lifecycle.erase_product_data(deletion_db, membership, 1)
        await deletion_db.commit()
        assert (await asyncio.wait_for(waiting, timeout=5)).status_code == 409


async def test_legacy_whole_account_delete_cascades_workouts_and_blocks_late_writes(
    data_api, monkeypatch
):
    row = await workout(data_api)
    await data_api.client.post(
        "/api/v1/workouts/sessions", json=session_payload(row), headers=GENERATION
    )
    entered = asyncio.Event()
    original = lifecycle.lock_owner

    async def observed_lock(db, identifier):
        entered.set()
        await original(db, identifier)

    async with data_api.sessions() as deletion_db:
        await original(deletion_db, "owner")
        monkeypatch.setattr(lifecycle, "lock_owner", observed_lock)
        waiting = asyncio.create_task(
            data_api.client.post("/api/v1/workouts/library", json=WORKOUT, headers=GENERATION)
        )
        await asyncio.wait_for(entered.wait(), timeout=5)
        await delete_account(db=deletion_db, user=user())
        assert (await asyncio.wait_for(waiting, timeout=5)).status_code == 404
    async with data_api.sessions() as db:
        assert await db.get(AppUser, "owner") is None
        for table in WORKOUTS_TABLES:
            assert await db.scalar(select(func.count()).select_from(table)) == 0
        assert await db.get(AppUser, "other") is not None


async def test_export_is_paginated_owner_only_and_includes_versions(data_api):
    await workout(data_api)
    await data_api.client.post(
        "/api/v1/workouts/library", json={**WORKOUT, "title": "Second"}, headers=GENERATION
    )
    exported = await data_api.client.get("/api/v1/workouts/export?limit=1")
    assert exported.status_code == 200 and exported.headers["Cache-Control"] == "no-store"
    content = exported.json()
    assert content["totals"]["workouts"] == 2 and content["has_more"]["workouts"] is True
    next_page = (await data_api.client.get("/api/v1/workouts/export?limit=1&offset=1")).json()
    assert next_page["datasets"]["workouts"][0]["id"] != content["datasets"]["workouts"][0]["id"]
    assert content["totals"]["workout_versions"] == 2
    assert content["datasets"]["workout_versions"][0]["workout_id"] is not None
    assert "app_user_id" not in exported.text and "user_distinct_subject" not in exported.text


async def test_manual_activity_cannot_forge_provider_origin(data_api):
    await enroll(data_api)
    assert (
        await data_api.client.post(
            "/api/v1/workouts/activities",
            json={"date": "2026-10-10", "name": "Basketball", "duration_minutes": 45},
            headers=GENERATION,
        )
    ).status_code == 201
    assert (
        await data_api.client.post(
            "/api/v1/workouts/activities",
            json={"date": "2026-10-10", "name": "Basketball", "origin_id": "healthkit:fake"},
            headers=GENERATION,
        )
    ).status_code == 422


async def test_saved_requests_and_read_pages_are_bounded(data_api):
    await enroll(data_api)
    assert (await data_api.client.get("/api/v1/workouts/library?limit=10000")).status_code == 422
    assert (await data_api.client.get("/api/v1/workouts/export?limit=11")).status_code == 422
    assert (
        await data_api.client.put(
            "/api/v1/workouts/profile",
            json={"limitations": ["x" * 5000]},
            headers={**GENERATION, "If-Match": "0"},
        )
    ).status_code == 422
    assert (
        await data_api.client.post(
            "/api/v1/workouts/library", content=b"x" * (256 * 1024 + 1), headers=GENERATION
        )
    ).status_code == 413


async def test_optional_readiness_and_migration_are_noops_when_disabled():
    class ForbiddenEngine:
        def begin(self):
            raise AssertionError("Disabled optional migration must not touch the database")

    class ForbiddenFactory:
        def __call__(self):
            raise AssertionError("Disabled optional readiness must not touch the database")

    configured = Settings(
        database_url="postgresql://localhost/test", openai_api_key="test", environment="test"
    )
    await migration.run_migration(configured=configured, migration_engine=ForbiddenEngine())
    await verify_workouts_schema(ForbiddenFactory(), settings=configured)


async def test_optional_schema_is_verified_and_separate_from_recipes_metadata(data_api):
    assert not any(name.startswith("workouts_") for name in RecipesBase.metadata.tables)
    await verify_workouts_schema(data_api.sessions, settings=settings())
    async with data_api.engine.begin() as connection:
        assert await connection.scalar(text("SELECT MAX(version) FROM schema_migrations")) == 33
        await connection.execute(
            text("ALTER TABLE workouts_sessions DISABLE TRIGGER immutable_workouts_snapshot")
        )
    with pytest.raises(RuntimeError, match="immutable snapshot"):
        await verify_workouts_schema(data_api.sessions, settings=settings())


async def test_production_migration_requires_restore_point_and_is_idempotent(data_api, monkeypatch):
    async with data_api.engine.begin() as connection:
        await connection.execute(text("DELETE FROM workouts_schema_migrations"))
    monkeypatch.delenv("MIGRATION_034_RESTORE_POINT", raising=False)
    configured = Settings(
        database_url="postgresql://localhost/test",
        openai_api_key="test",
        environment="production",
        workouts_api_enabled=True,
    )
    with pytest.raises(RuntimeError, match="MIGRATION_034_RESTORE_POINT"):
        await migration.run_migration(configured=configured, migration_engine=data_api.engine)
    monkeypatch.setenv("MIGRATION_034_RESTORE_POINT", "verified-fixture-restore-point")
    await migration.run_migration(configured=configured, migration_engine=data_api.engine)
    monkeypatch.delenv("MIGRATION_034_RESTORE_POINT")
    await migration.run_migration(configured=configured, migration_engine=data_api.engine)
    async with data_api.sessions() as db:
        assert (
            await db.scalar(
                text("SELECT restore_point FROM workouts_schema_migrations WHERE version=34")
            )
            == "verified-fixture-restore-point"
        )


async def test_database_cascade_is_not_dependent_on_router_cleanup(data_api):
    await workout(data_api)
    async with data_api.sessions() as db:
        await db.execute(delete(AppUser).where(AppUser.id == "owner"))
        await db.commit()
        assert await db.get(WorkoutsMembership, "owner") is None
        assert await db.scalar(select(func.count()).select_from(WorkoutRecord)) == 0


async def test_library_creation_retry_is_idempotent_owner_and_generation_scoped(data_api):
    await enroll(data_api)
    key = str(uuid4())
    headers = {**GENERATION, "Idempotency-Key": key}
    first, second = await asyncio.gather(
        *(
            data_api.client.post("/api/v1/workouts/library", json=WORKOUT, headers=headers)
            for _ in range(2)
        )
    )
    assert sorted([first.status_code, second.status_code]) == [200, 201]
    assert first.json()["id"] == second.json()["id"]
    assert (
        await data_api.client.post(
            "/api/v1/workouts/library", json={**WORKOUT, "title": "Different"}, headers=headers
        )
    ).status_code == 409
    await enroll(data_api, other=True)
    assert (
        await data_api.client.post(
            "/api/v1/workouts/library", json=WORKOUT, headers={**headers, "X-Test-User": "other"}
        )
    ).status_code == 201
    async with data_api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutRecord)) == 2


async def test_program_creation_retry_does_not_duplicate_schedule(data_api):
    await enroll(data_api)
    proposal = build_program(
        TrainingProfile(
            adult_confirmed=True,
            equipment=[],
            available_days=[0, 2, 4],
            session_minutes=30,
            readiness="ready",
        ),
        date(2026, 10, 12),
        weeks=1,
    )
    payload = {"title": "Fixture", "proposal": proposal.model_dump(mode="json")}
    headers = {**GENERATION, "Idempotency-Key": str(uuid4())}
    first = await data_api.client.post("/api/v1/workouts/programs", json=payload, headers=headers)
    second = await data_api.client.post("/api/v1/workouts/programs", json=payload, headers=headers)
    assert first.status_code == 201 and second.status_code == 200
    assert first.json() == second.json()


@pytest.mark.parametrize("global_delete", [False, True])
async def test_every_populated_product_dataset_is_erased(data_api, global_delete):
    row = await workout(data_api)
    await data_api.client.put(
        "/api/v1/workouts/profile", json={"weight_kg": 80}, headers={**GENERATION, "If-Match": "0"}
    )
    await data_api.client.put(
        "/api/v1/workouts/ai-consent",
        json={"accepted": True, "disclosure_version": 1},
        headers=GENERATION,
    )
    await data_api.client.put(
        "/api/v1/workouts/grants",
        json={"scopes": ["recipes_library_context", "ai_health_context"]},
        headers=GENERATION,
    )
    await data_api.client.post(
        "/api/v1/workouts/activities",
        json={"date": "2026-10-10", "name": "Basketball"},
        headers=GENERATION,
    )
    proposal = build_program(
        TrainingProfile(
            adult_confirmed=True,
            equipment=[],
            available_days=[0, 2, 4],
            session_minutes=30,
            readiness="ready",
        ),
        date(2026, 10, 12),
        weeks=1,
    )
    saved_program = await data_api.client.post(
        "/api/v1/workouts/programs",
        json={"title": "Fixture", "proposal": proposal.model_dump(mode="json")},
        headers=GENERATION,
    )
    assert saved_program.status_code == 201
    await data_api.client.post(
        "/api/v1/workouts/sessions", json=session_payload(row), headers=GENERATION
    )
    async with data_api.sessions() as db:
        for table in WORKOUTS_TABLES:
            assert await db.scalar(select(func.count()).select_from(table)) > 0, table.name
    if global_delete:
        async with data_api.sessions() as db:
            await delete_account(db=db, user=user())
    else:
        assert (
            await data_api.client.delete("/api/v1/workouts/data", headers=GENERATION)
        ).status_code == 200
    async with data_api.sessions() as db:
        for table in WORKOUTS_TABLES:
            expected = 1 if table.name == "workouts_memberships" and not global_delete else 0
            assert await db.scalar(select(func.count()).select_from(table)) == expected, table.name


async def test_chunked_request_without_content_length_is_still_bounded(data_api):
    async def chunks():
        for _ in range(4):
            yield b"x" * 100000

    response = await data_api.client.post(
        "/api/v1/workouts/library", content=chunks(), headers=GENERATION
    )
    assert response.status_code == 413


@pytest.mark.parametrize("value", [True, "10", 10.0])
async def test_actual_repetitions_are_numbers_not_coerced_booleans_or_strings(data_api, value):
    row = await workout(data_api)
    payload = session_payload(
        row,
        actuals=[
            {
                "block_id": "strength",
                "exercise_index": 0,
                "set_index": 1,
                "reps": value,
                "completed": True,
            }
        ],
    )
    assert (
        await data_api.client.post("/api/v1/workouts/sessions", json=payload, headers=GENERATION)
    ).status_code == 422


async def test_circuit_rounds_and_unilateral_sides_are_distinct_actuals(data_api):
    row = await workout(data_api)
    actuals = [
        {
            "block_id": "strength",
            "exercise_index": 0,
            "set_index": 1,
            "round_index": round_index,
            "side": side,
            "reps": 10,
            "effort": 7,
            "completed": True,
        }
        for round_index in (1, 2)
        for side in ("left", "right")
    ]
    response = await data_api.client.post(
        "/api/v1/workouts/sessions", json=session_payload(row, actuals=actuals), headers=GENERATION
    )
    assert response.status_code == 201
    assert len(response.json()["content"]["actuals"]) == 4
    duplicate = await data_api.client.post(
        "/api/v1/workouts/sessions",
        json=session_payload(row, actuals=actuals + [actuals[0]]),
        headers=GENERATION,
    )
    assert duplicate.status_code == 422
