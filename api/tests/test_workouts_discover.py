"""Discover publishing: optional 045 rollout, allow-listed projection, owner
publish rules and erasure, against real PostgreSQL."""

import importlib
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import text, update

from app.domains.workouts import automation_router, discover
from app.domains.workouts.discover import verify_discover_schema
from app.domains.workouts.optional_runtime import verify_optional_workouts_schema
from app.models.identity import AppUser
from app.routers.users import delete_account
from tests.test_workouts_automation_integration import (  # noqa: F401
    automation_api,
    consent,
    enqueue,
)
from tests.test_workouts_data_integration import (  # noqa: F401
    DATABASE_URL,
    GENERATION,
    data_api,
    enroll,
    settings,
    user,
)
from tests.test_workouts_export_assembly import assembled_exports  # noqa: F401
from tests.test_workouts_optional_chain import legacy_columns

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
migration035 = importlib.import_module("migrations.035_add_workouts_automation")
migration045 = importlib.import_module("migrations.045_add_workouts_discover")
OTHER = {"X-Test-User": "other"}
PRIVATE_NOTE = "private knee note 7c1f"
SOURCE = "https://www.youtube.com/watch?v=abcDEF12345&si=tracking"
REEL = {
    "title": "Ten minute legs",
    "kind": "session",
    "provenance": "source",
    "capture_kind": "url",
    "source_url": SOURCE,
    "source_creator": "Coach Nani",
    "equipment_required": ["Dumbbell"],
    "estimated_minutes": 10,
    "notes": [PRIVATE_NOTE],
    "blocks": [
        {
            "id": "main",
            "label": "Main circuit",
            "rounds": 3,
            "evidence": [{"field": "rounds", "wording": PRIVATE_NOTE}],
            "exercises": [
                {
                    "name": "Goblet squat",
                    "provenance": "source",
                    "sets": 3,
                    "reps_min": 12,
                    "reps_max": 12,
                    "rest_seconds": 45,
                    "effort": PRIVATE_NOTE,
                    "notes": PRIVATE_NOTE,
                    "exercise_id": "private-integration-ref",
                    "evidence": [{"field": "name", "wording": PRIVATE_NOTE}],
                }
            ],
        }
    ],
}
WORKOUT_KEYS = {
    "id", "version", "parent_version_id", "title", "kind", "provenance", "blocks", "source_url",
    "capture_kind", "source_creator", "source_title", "equipment_required", "equipment_optional",
    "estimated_minutes", "notes",
}  # fmt: skip
BLOCK_KEYS = {
    "id",
    "label",
    "grouping",
    "rounds",
    "rest_between_rounds_seconds",
    "exercises",
    "evidence",
}
EXERCISE_KEYS = {
    "exercise_id", "name", "provenance", "sets", "reps_min", "reps_max", "per_side",
    "duration_seconds", "distance_meters", "rest_seconds", "tempo", "load", "load_unit",
    "load_convention", "effort", "notes", "evidence",
}  # fmt: skip


def mount(api):
    api.app.include_router(discover.router)


async def accept_disclosure(api, *owners):
    async with api.sessions.begin() as db:
        await db.execute(
            update(AppUser).where(AppUser.id.in_(owners)).values(publishing_disclosure_version=1)
        )


@pytest.fixture
async def discover_api(data_api):  # noqa: F811
    await migration035.run_migration(configured=settings(), migration_engine=data_api.engine)
    await migration045.run_migration(configured=settings(), migration_engine=data_api.engine)
    mount(data_api)
    await enroll(data_api)
    await enroll(data_api, other=True)
    await accept_disclosure(data_api, "owner", "other")
    return data_api


async def save(api, workout, headers=None):
    response = await api.client.post(
        "/api/v1/workouts/library", json=workout, headers=GENERATION | (headers or {})
    )
    assert response.status_code == 201, response.text
    return response.json()


async def publish(api, workout_id, headers=None, action="publish"):
    return await api.client.post(
        f"/api/v1/workouts/library/{workout_id}/{action}", headers=GENERATION | (headers or {})
    )


async def published_reel(api, workout=REEL, headers=None):
    row = await save(api, workout, headers)
    response = await publish(api, row["id"], headers)
    assert response.status_code == 200, response.text
    return row


async def test_code_runs_without_045_and_reports_discover_unavailable(assembled_exports):  # noqa: F811
    api = assembled_exports
    mount(api)
    configured = settings()
    # Startup readiness at 044 succeeds; Discover is optional until applied.
    await verify_optional_workouts_schema(configured=configured, target_engine=api.engine)
    row = await save(api, REEL)
    listed = await api.client.get("/api/v1/workouts/library")
    assert listed.status_code == 200 and listed.json()[0]["publication"] is None
    edited = await api.client.put(
        f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
        json={**REEL, "title": "Edited"},
        headers=GENERATION,
    )
    assert edited.status_code == 200, edited.text
    response = await publish(api, row["id"])
    assert response.status_code == 503 and "not available" in response.json()["detail"]


async def test_capability_flag_follows_045(automation_api, monkeypatch):  # noqa: F811
    capabilities = await automation_api.client.get("/api/v1/workouts/capabilities")
    assert capabilities.json()["discover"] is False
    await migration045.run_migration(configured=settings(), migration_engine=automation_api.engine)
    capabilities = await automation_api.client.get("/api/v1/workouts/capabilities")
    assert capabilities.json()["discover"] is True


async def test_045_rolls_forward_on_populated_044_database_and_replays(assembled_exports):  # noqa: F811
    api = assembled_exports
    row = await save(api, REEL)
    before = await legacy_columns(api.engine)
    for _ in range(2):
        await migration045.run_migration(configured=settings(), migration_engine=api.engine)
    assert await legacy_columns(api.engine) == before
    await verify_optional_workouts_schema(configured=settings(), target_engine=api.engine)
    async with api.engine.connect() as connection:
        state = (
            await connection.execute(
                text("SELECT is_public,moderation_status,published_at FROM workouts_library")
            )
        ).one()
        assert tuple(state) == (False, "active", None)
        assert (
            await connection.scalar(
                text("SELECT count(*) FROM workouts_schema_migrations WHERE version=45")
            )
            == 1
        )
    listed = await api.client.get(f"/api/v1/workouts/library/{row['id']}")
    assert listed.json()["publication"] == {
        "is_public": False,
        "moderation_status": "active",
        "published_at": None,
        "discover_visible": False,
    }


async def test_recorded_but_incomplete_045_fails_startup(discover_api):
    async with discover_api.engine.begin() as connection:
        await connection.execute(text("ALTER TABLE workouts_library DROP COLUMN source_platform"))
    with pytest.raises(RuntimeError, match="045"):
        await verify_discover_schema(discover_api.engine, settings())


async def test_production_045_requires_restore_point(data_api, monkeypatch):  # noqa: F811
    monkeypatch.delenv("MIGRATION_045_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="035 must precede"):
        await migration045.run_migration(configured=settings(), migration_engine=data_api.engine)
    await migration035.run_migration(configured=settings(), migration_engine=data_api.engine)
    with pytest.raises(RuntimeError, match="restore point"):
        await migration045.run_migration(
            configured=SimpleNamespace(
                workouts_api_enabled=True, environment="production", app_release_id=None
            ),
            migration_engine=data_api.engine,
        )


async def test_public_projection_is_an_allow_list():
    workout, incomplete = discover.public_workout(REEL)
    assert incomplete is False
    assert set(workout) <= WORKOUT_KEYS and workout["notes"] == []
    assert workout["blocks"][0]["label"] == "Main circuit"
    assert workout["source_creator"] == "Coach Nani"
    for block in workout["blocks"]:
        assert set(block) <= BLOCK_KEYS and block["evidence"] == []
        for exercise in block["exercises"]:
            assert set(exercise) <= EXERCISE_KEYS
            assert exercise["exercise_id"] is None and exercise["evidence"] == []
            assert exercise["notes"] is None and exercise["effort"] is None
    assert PRIVATE_NOTE not in json.dumps(workout)
    assert discover.source_identity(SOURCE) == ("youtube:video:abcDEF12345", "youtube")


async def test_publishing_requires_disclosure_completeness_and_ownership(discover_api):
    api = discover_api
    async with api.sessions.begin() as db:
        await db.execute(
            update(AppUser).where(AppUser.id == "owner").values(publishing_disclosure_version=0)
        )
    row = await save(api, REEL)
    assert (await publish(api, row["id"])).status_code == 409
    await accept_disclosure(api, "owner")
    assert (await publish(api, row["id"], OTHER)).status_code == 404
    incomplete = {
        **REEL,
        "blocks": [{"id": "b", "label": "B", "exercises": [{"name": "Plank hold"}]}],
    }
    draft = await save(api, incomplete)
    response = await publish(api, draft["id"])
    assert response.status_code == 422 and "reps, time or distance" in response.text
    state = (await publish(api, row["id"])).json()
    assert state["is_public"] and state["discover_visible"] and state["published_at"]
    # An edit that removes the dose unpublishes instead of exposing a draft.
    edited = await api.client.put(
        f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
        json=incomplete,
        headers=GENERATION,
    )
    assert edited.status_code == 200 and edited.json()["publication"]["is_public"] is False
    unpublished = await publish(api, draft["id"], action="unpublish")
    assert unpublished.status_code == 200 and unpublished.json()["published_at"] is None


async def test_data_and_account_deletion_remove_public_workouts(discover_api):
    api = discover_api
    public = text("SELECT count(*) FROM workouts_library WHERE is_public")
    await published_reel(api)
    erased = await api.client.request("DELETE", "/api/v1/workouts/data", headers=GENERATION)
    assert erased.status_code == 200
    await published_reel(api, headers=OTHER)
    async with api.sessions() as db:
        assert await db.scalar(public) == 1
        await delete_account(db=db, user=user("other"))
    async with api.sessions() as db:
        assert await db.scalar(public) == 0


async def test_import_accept_can_request_public(automation_api, monkeypatch):  # noqa: F811
    api = automation_api
    await migration045.run_migration(configured=settings(), migration_engine=api.engine)
    mount(api)
    await consent(api)
    job = (await enqueue(api)).json()
    await api.worker.tick()
    path = f"/api/v1/workouts/imports/{job['id']}/accept"
    assert (
        await api.client.post(path, headers=GENERATION, json={"is_public": True})
    ).status_code == 409
    await accept_disclosure(api, "owner")
    accepted = await api.client.post(path, headers=GENERATION, json={"is_public": True})
    assert accepted.status_code == 200, accepted.text
    state = await api.client.get(f"/api/v1/workouts/library/{accepted.json()['id']}")
    assert state.json()["publication"]["is_public"] is True
    private_job = (await enqueue(api)).json()
    await api.worker.tick()
    private = await api.client.post(
        f"/api/v1/workouts/imports/{private_job['id']}/accept", headers=GENERATION, json={}
    )
    listed = await api.client.get(f"/api/v1/workouts/library/{private.json()['id']}")
    assert listed.json()["publication"]["is_public"] is False
    assert automation_router.AcceptImport().is_public is False


async def test_045_retry_completes_a_committed_first_phase(data_api):  # noqa: F811
    await migration035.run_migration(configured=settings(), migration_engine=data_api.engine)
    async with data_api.engine.begin() as connection:
        await connection.execute(text(migration045.COLUMNS))
        await connection.execute(
            text(
                "ALTER TABLE workouts_library ADD CONSTRAINT ck_workouts_library_moderation_status"
                " CHECK (moderation_status IN ('active','hidden')) NOT VALID"
            )
        )
    await migration045.run_migration(configured=settings(), migration_engine=data_api.engine)
    await verify_discover_schema(data_api.engine, settings())
    async with data_api.engine.connect() as connection:
        assert await connection.scalar(
            text(
                "SELECT bool_and(convalidated) FROM pg_constraint WHERE conname LIKE 'ck_workouts_library_%'"
            )
        )
