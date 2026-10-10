"""PostgreSQL acceptance for opt-in projections and intentional capability links."""

import asyncio
import base64
import importlib
import os
from datetime import date, timedelta
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, Request
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser, get_current_user
from app.config import Settings
from app.db import get_db
from app.db.database import Base as RecipesBase
from app.domains.workouts import lifecycle, security, sharing_service
from app.domains.workouts.connection_lifecycle import connection_export_page, erase_connections_data
from app.domains.workouts.connection_models import (
    CONNECTION_TABLES,
    RecipeConnectionReceipt,
    WorkoutCopyReceipt,
    WorkoutShare,
)
from app.domains.workouts.connection_router import router as connection_router
from app.domains.workouts.connection_runtime import verify_connections_schema
from app.domains.workouts.lifecycle import now
from app.domains.workouts.models import WorkoutRecord, WorkoutsMembership, WorkoutsProgram
from app.domains.workouts.programming import build_program
from app.domains.workouts.router import router as account_router
from app.domains.workouts.schemas import TrainingProfile
from app.models.identity import AppUser
from app.models.meal_plan import MealPlanEntry
from app.models.moderation import UserBlock
from app.models.recipe import Recipe, SavedRecipe
from tests.database_safety import require_disposable_test_database
from tests.test_workouts_coach_integration import action, coach_api  # noqa: F401
from tests.test_workouts_data_integration import data_api  # noqa: F401

DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
migration34 = importlib.import_module("migrations.034_add_workouts_domain")
migration37 = importlib.import_module("migrations.037_add_workouts_connections_sharing")
ENROLL = {
    "adult_confirmed": True,
    "shared_account_deletion_acknowledged": True,
    "disclosure_version": 1,
}
GENERATION = {"X-Workouts-Generation": "1"}
PRIVATE = "PRIVATE_HEALTH_OR_CREATOR_CONTEXT"
WORKOUT = {
    "title": "Squat practice",
    "notes": [PRIVATE],
    "source_url": "https://example.test/original",
    "equipment_required": [],
    "blocks": [
        {
            "id": "private_source_block",
            "label": PRIVATE,
            "exercises": [
                {
                    "exercise_id": "private_integration_reference",
                    "name": "Squat",
                    "sets": 2,
                    "reps_min": 8,
                    "reps_max": 12,
                    "notes": PRIVATE,
                    "effort": PRIVATE,
                    "tempo": PRIVATE,
                    "evidence": [{"field": "sets", "wording": PRIVATE}],
                }
            ],
        }
    ],
}


def settings():
    return Settings(
        database_url="postgresql://localhost/hafa_connections_test",
        openai_api_key="test",
        environment="test",
        workouts_api_enabled=True,
        workouts_public_access_enabled=True,
    )


@pytest.fixture
async def api(monkeypatch):
    require_disposable_test_database(DATABASE_URL)
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.run_sync(RecipesBase.metadata.create_all)
        await connection.execute(
            text("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT)")
        )
        await connection.execute(text("INSERT INTO schema_migrations VALUES(33,'fixture core')"))
    await migration34.run_migration(configured=settings(), migration_engine=engine)
    async with engine.begin() as connection:
        # Parent's 035 owns this ledger expansion. This fixture is explicit;
        # it does not pretend the proposal/jobs migration ran in this worktree.
        await connection.execute(
            text(
                "ALTER TABLE workouts_schema_migrations DROP CONSTRAINT workouts_schema_migrations_version_check"
            )
        )
        await connection.execute(
            text(
                "ALTER TABLE workouts_schema_migrations ADD CONSTRAINT workouts_schema_versions CHECK(version>=34)"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO workouts_schema_migrations(version,release_id) VALUES(35,'fixture prerequisite')"
            )
        )
    await migration37.run_migration(configured=settings(), migration_engine=engine)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        db.add_all(
            [AppUser(id=identifier) for identifier in ("publisher", "recipient", "stranger")]
        )
        await db.commit()
    app = FastAPI()
    app.include_router(account_router)
    app.include_router(connection_router)

    async def db_override():
        async with sessions() as db:
            yield db

    async def auth_override(request: Request):
        identifier = request.headers.get("X-Test-User", "publisher")
        return ClerkUser(
            id=identifier,
            clerk_user_id=f"user_private_{identifier}",
            clerk_issuer="https://example.test",
            clerk_environment="test",
            first_name=PRIVATE,
            email="private@example.test",
        )

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[get_current_user] = auth_override
    monkeypatch.setattr(security, "get_settings", settings)
    monkeypatch.setenv(
        "WORKOUTS_SHARE_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"x" * 32).decode()
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for identifier in ("publisher", "recipient", "stranger"):
            response = await client.post(
                "/api/v1/workouts/enrollment", json=ENROLL, headers={"X-Test-User": identifier}
            )
            assert response.status_code == 200
        yield SimpleNamespace(client=client, sessions=sessions, engine=engine, app=app)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
    await engine.dispose()


async def create_workout(api, identifier="publisher"):
    response = await api.client.post(
        "/api/v1/workouts/library", json=WORKOUT, headers={**GENERATION, "X-Test-User": identifier}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def create_share(api, identifier="publisher", *, include_source=False):
    workout = await create_workout(api, identifier)
    preview = await api.client.post(
        "/api/v1/workouts/sharing/previews",
        json={
            "workout_id": workout["id"],
            "expected_revision": 1,
            "include_source_url": include_source,
        },
        headers={**GENERATION, "X-Test-User": identifier},
    )
    assert preview.status_code == 201, preview.text
    confirmed = await api.client.post(
        f"/api/v1/workouts/sharing/previews/{preview.json()['id']}/confirm",
        json={
            "preview_digest": preview.json()["preview_digest"],
            "confirm_public_snapshot": True,
            "disclosure_version": 1,
        },
        headers={**GENERATION, "X-Test-User": identifier},
    )
    assert confirmed.status_code == 201, confirmed.text
    return workout, preview.json(), confirmed.json()


async def grant(api, scopes):
    response = await api.client.put(
        "/api/v1/workouts/grants", json={"scopes": scopes}, headers=GENERATION
    )
    assert response.status_code == 200


async def recipe_fixture(api):
    async with api.sessions() as db:

        def recipe(owner, title, public=False):
            return Recipe(
                user_id=owner,
                is_public=public,
                moderation_status="active",
                source_url=f"https://private.example/{PRIVATE}",
                source_type="manual",
                raw_text=PRIVATE,
                extracted={
                    "title": title,
                    "sourceUrl": PRIVATE,
                    "notes": PRIVATE,
                    "servings": 4,
                    "ingredients": [
                        {"name": "Rice", "quantity": 2, "unit": "cups", "notes": PRIVATE}
                    ],
                    "nutrition": {
                        "perServing": {"calories": 200, "protein": 8},
                        "servingBasis": "recipe_servings",
                    },
                    "derivedData": {"nutrition": {"status": "current", "reason": PRIVATE}},
                },
            )

        own = recipe("publisher", "Owned")
        saved = recipe("recipient", "Saved public", True)
        private = recipe("recipient", "Other private")
        unsaved = recipe("stranger", "Unsaved public", True)
        db.add_all([own, saved, private, unsaved])
        await db.flush()
        db.add_all(
            [
                SavedRecipe(user_id="publisher", recipe_id=saved.id),
                SavedRecipe(user_id="publisher", recipe_id=private.id),
                MealPlanEntry(
                    user_id="publisher",
                    date=date(2025, 1, 1),
                    meal_type="dinner",
                    recipe_id=own.id,
                    recipe_title="Cached private title",
                    notes=PRIVATE,
                    servings="2",
                ),
                MealPlanEntry(
                    user_id="recipient",
                    date=date(2025, 1, 1),
                    meal_type="dinner",
                    recipe_id=saved.id,
                    recipe_title="Other actor",
                    notes=PRIVATE,
                ),
            ]
        )
        await db.commit()
        return own.id, saved.id, private.id, unsaved.id


async def test_recipe_connections_require_actual_explicit_grant(api):
    await recipe_fixture(api)
    response = await api.client.get("/api/v1/workouts/connections/recipes", headers=GENERATION)
    assert response.status_code == 403
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(RecipeConnectionReceipt)) == 0


async def test_library_projection_is_bounded_owned_or_saved_visible_only(api):
    own, saved, private, unsaved = await recipe_fixture(api)
    await grant(api, ["recipes_library_context"])
    result = await api.client.get("/api/v1/workouts/connections/recipes", headers=GENERATION)
    assert result.status_code == 200 and result.headers["Cache-Control"] == "no-store"
    body = result.json()
    assert {item["id"] for item in body["library"]} == {str(own), str(saved)}
    assert body["meal_plan"] == []
    assert PRIVATE not in result.text and "private@example.test" not in result.text
    assert all(item["ingredients"][0]["quantity"] == "2" for item in body["library"])
    assert all(item["nutrition"]["calories"] == 200 for item in body["library"])
    assert str(private) not in result.text and str(unsaved) not in result.text
    receipt = (await api.client.get("/api/v1/workouts/connections/receipts")).json()[0]
    assert set(receipt["recipe_ids"]) == {str(own), str(saved)}


async def test_meal_plan_projection_uses_own_dates_and_current_recipe_only(api):
    await recipe_fixture(api)
    await grant(api, ["recipes_meal_plan_context"])
    result = await api.client.get(
        "/api/v1/workouts/connections/recipes?start_date=2025-01-01&end_date=2025-01-07",
        headers=GENERATION,
    )
    assert result.status_code == 200
    assert result.json()["library"] == []
    assert len(result.json()["meal_plan"]) == 1
    assert result.json()["meal_plan"][0]["recipe"]["title"] == "Owned"
    assert (
        PRIVATE not in result.text
        and "Cached private title" not in result.text
        and "Other actor" not in result.text
    )
    receipt = (await api.client.get("/api/v1/workouts/connections/receipts")).json()[0]
    assert len(receipt["meal_plan_ids"]) == len(receipt["recipe_ids"]) == 1


async def test_recipe_permission_revocation_and_visibility_change_stop_context(api):
    own, saved, _, _ = await recipe_fixture(api)
    await grant(api, ["recipes_library_context"])
    async with api.sessions() as db:
        row = await db.get(Recipe, saved)
        row.is_public = False
        await db.commit()
    response = await api.client.get("/api/v1/workouts/connections/recipes", headers=GENERATION)
    assert [item["id"] for item in response.json()["library"]] == [str(own)]
    await grant(api, [])
    assert (
        await api.client.get("/api/v1/workouts/connections/recipes", headers=GENERATION)
    ).status_code == 403


async def test_blocked_contributor_is_not_in_saved_recipe_context(api):
    own, _, _, _ = await recipe_fixture(api)
    await grant(api, ["recipes_library_context"])
    async with api.sessions() as db:
        db.add(UserBlock(blocker_user_id="publisher", blocked_user_id="recipient"))
        await db.commit()
    response = await api.client.get("/api/v1/workouts/connections/recipes", headers=GENERATION)
    assert [item["id"] for item in response.json()["library"]] == [str(own)]


async def test_coaching_context_requires_current_ai_consent(api):
    await recipe_fixture(api)
    await grant(api, ["recipes_library_context"])
    assert (
        await api.client.get(
            "/api/v1/workouts/connections/recipes?purpose=coach", headers=GENERATION
        )
    ).status_code == 403
    await api.client.put(
        "/api/v1/workouts/ai-consent",
        json={"accepted": True, "disclosure_version": 1},
        headers=GENERATION,
    )
    assert (
        await api.client.get(
            "/api/v1/workouts/connections/recipes?purpose=coach", headers=GENERATION
        )
    ).status_code == 200
    await api.client.put(
        "/api/v1/workouts/ai-consent",
        json={"accepted": False, "disclosure_version": 1},
        headers=GENERATION,
    )
    assert (
        await api.client.get(
            "/api/v1/workouts/connections/recipes?purpose=coach", headers=GENERATION
        )
    ).status_code == 403


async def test_shared_preview_never_exposes_private_context_or_record_identity(api):
    workout, preview, share = await create_share(api)
    response = await api.client.get(share["api_path"])
    assert response.status_code == 200
    body = response.json()
    assert PRIVATE not in response.text and "private@example.test" not in response.text
    assert workout["id"] not in response.text and "publisher" not in response.text
    assert body["content"]["id"] is None and body["content"]["source_url"] is None
    assert body["attribution"]["shared_by_display_name"] == "Håfa member"
    assert body["content"]["blocks"][0]["exercises"][0]["reps_min"] == 8
    assert body["content"]["blocks"][0]["exercises"][0]["exercise_id"] is None
    assert (
        await api.client.get(
            f"/api/v1/workouts/sharing/{share['id']}", headers={"X-Test-User": "recipient"}
        )
    ).status_code == 404


async def test_confirmation_is_explicit_and_returns_same_encrypted_link_on_retry(api):
    _, preview, share = await create_share(api)
    token = share["api_path"].rsplit("/", 1)[-1]
    assert share["website_path"] == f"/shared#{token}"
    assert share["app_path"] == f"hafaworkouts://shared/{token}"
    response = await api.client.post(
        f"/api/v1/workouts/sharing/previews/{preview['id']}/confirm",
        json={
            "preview_digest": preview["preview_digest"],
            "confirm_public_snapshot": True,
            "disclosure_version": 1,
        },
        headers=GENERATION,
    )
    assert response.status_code == 201 and response.json() == share
    assert (await api.client.get(f"/api/v1/workouts/sharing/{share['id']}")).json() == share
    async with api.sessions() as db:
        row = await db.get(WorkoutShare, share["id"])
        assert share["api_path"].split("/")[-1] not in row.encrypted_token
        assert await db.scalar(select(func.count()).select_from(WorkoutShare)) == 1
    false = await api.client.post(
        f"/api/v1/workouts/sharing/previews/{preview['id']}/confirm",
        json={
            "preview_digest": preview["preview_digest"],
            "confirm_public_snapshot": False,
            "disclosure_version": 1,
        },
        headers=GENERATION,
    )
    assert false.status_code == 422


async def test_preview_and_digest_staleness_do_not_publish_changed_content(api):
    row = await create_workout(api)
    preview = (
        await api.client.post(
            "/api/v1/workouts/sharing/previews",
            json={"workout_id": row["id"], "expected_revision": 1},
            headers=GENERATION,
        )
    ).json()
    await api.client.put(
        f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
        json={**WORKOUT, "title": "Edited"},
        headers=GENERATION,
    )
    changed = await api.client.post(
        f"/api/v1/workouts/sharing/previews/{preview['id']}/confirm",
        json={
            "preview_digest": preview["preview_digest"],
            "confirm_public_snapshot": True,
            "disclosure_version": 1,
        },
        headers=GENERATION,
    )
    assert changed.status_code == 409
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutShare)) == 0


async def test_missing_sharing_key_does_not_block_account_or_recipes_features(api, monkeypatch):
    row = await create_workout(api)
    preview = (
        await api.client.post(
            "/api/v1/workouts/sharing/previews",
            json={"workout_id": row["id"], "expected_revision": 1},
            headers=GENERATION,
        )
    ).json()
    monkeypatch.delenv("WORKOUTS_SHARE_ENCRYPTION_KEY")
    assert (await api.client.get("/api/v1/workouts/profile")).status_code == 200
    assert (await api.client.get("/api/v1/workouts/library")).status_code == 200
    confirmed = await api.client.post(
        f"/api/v1/workouts/sharing/previews/{preview['id']}/confirm",
        json={
            "preview_digest": preview["preview_digest"],
            "confirm_public_snapshot": True,
            "disclosure_version": 1,
        },
        headers=GENERATION,
    )
    assert confirmed.status_code == 503
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutShare)) == 0


async def test_source_credit_is_explicit_and_secret_bearing_source_urls_are_rejected(api):
    _, _, share = await create_share(api, include_source=True)
    assert (await api.client.get(share["api_path"])).json()["content"][
        "source_url"
    ] == "https://example.test/original"
    row = await create_workout(api)
    await api.client.put(
        f"/api/v1/workouts/library/{row['id']}?expected_revision=1",
        json={**WORKOUT, "source_url": "https://example.test/asset?X-Amz-Signature=private"},
        headers=GENERATION,
    )
    assert (
        await api.client.post(
            "/api/v1/workouts/sharing/previews",
            json={"workout_id": row["id"], "expected_revision": 2, "include_source_url": True},
            headers=GENERATION,
        )
    ).status_code == 422


async def test_copy_is_private_idempotent_and_survives_source_revocation(api):
    _, _, share = await create_share(api)
    body = {
        "copy_request_id": str(uuid4()),
        "snapshot_digest": share["snapshot_digest"],
        "acknowledge_not_personalized": True,
    }
    path = share["api_path"] + "/copy"
    headers = {**GENERATION, "X-Test-User": "recipient"}
    first = await api.client.post(path, json=body, headers=headers)
    assert first.status_code == 201, first.text
    private = first.json()["record"]
    assert private["content"]["id"] == private["id"] and private["generation"] == 1
    await api.client.delete(f"/api/v1/workouts/sharing/{share['id']}", headers=GENERATION)
    assert (await api.client.get(share["api_path"])).status_code == 404
    replay = await api.client.post(path, json=body, headers=headers)
    assert replay.status_code == 200 and replay.json() == first.json()
    assert (
        await api.client.post(path, json={**body, "copy_request_id": str(uuid4())}, headers=headers)
    ).status_code == 404
    assert (
        await api.client.get(
            f"/api/v1/workouts/library/{private['id']}", headers={"X-Test-User": "recipient"}
        )
    ).status_code == 200


async def test_expired_links_and_preview_are_unavailable(api, monkeypatch):
    _, _, share = await create_share(api)
    monkeypatch.setattr(sharing_service, "now", lambda: now() + timedelta(days=31))
    assert (await api.client.get(share["api_path"])).status_code == 404


async def test_published_snapshots_and_receipts_are_database_immutable(api):
    _, _, share = await create_share(api)
    body = {
        "copy_request_id": str(uuid4()),
        "snapshot_digest": share["snapshot_digest"],
        "acknowledge_not_personalized": True,
    }
    await api.client.post(
        share["api_path"] + "/copy", json=body, headers={**GENERATION, "X-Test-User": "recipient"}
    )
    for table in ("workouts_shares", "workouts_copy_receipts"):
        async with api.sessions() as db:
            with pytest.raises(DBAPIError, match="immutable"):
                await db.execute(text(f"UPDATE {table} SET generation=2"))
            await db.rollback()


async def test_generation_and_deleted_publisher_invalidate_pending_shares_and_copies(api):
    _, _, share = await create_share(api)
    await api.client.delete("/api/v1/workouts/data", headers=GENERATION)
    assert (await api.client.get(share["api_path"])).status_code == 404
    assert (
        await api.client.post(
            share["api_path"] + "/copy",
            json={
                "copy_request_id": str(uuid4()),
                "snapshot_digest": share["snapshot_digest"],
                "acknowledge_not_personalized": True,
            },
            headers={**GENERATION, "X-Test-User": "recipient"},
        )
    ).status_code == 404


async def test_reciprocal_copies_do_not_deadlock_or_change_source_ownership(api):
    original_a, _, a = await create_share(api, "publisher")
    original_b, _, b = await create_share(api, "recipient")

    async def do_copy(share, actor):
        return await api.client.post(
            share["api_path"] + "/copy",
            json={
                "copy_request_id": str(uuid4()),
                "snapshot_digest": share["snapshot_digest"],
                "acknowledge_not_personalized": True,
            },
            headers={**GENERATION, "X-Test-User": actor},
        )

    results = await asyncio.wait_for(
        asyncio.gather(do_copy(a, "recipient"), do_copy(b, "publisher")), timeout=10
    )
    assert all(response.status_code == 201 for response in results)
    async with api.sessions() as db:
        assert (await db.get(WorkoutRecord, original_a["id"])).app_user_id == "publisher"
        assert (await db.get(WorkoutRecord, original_b["id"])).app_user_id == "recipient"


async def program_share(api):
    proposal = build_program(
        TrainingProfile(
            adult_confirmed=True,
            equipment=[],
            available_days=[0, 2, 5],
            session_minutes=30,
            readiness="ready",
        ),
        date(2025, 1, 6),
        weeks=1,
    )
    request = {"title": PRIVATE, "proposal": proposal.model_dump(mode="json")}
    request["proposal"]["assumptions"] = [PRIVATE]
    row = (
        await api.client.post("/api/v1/workouts/programs", json=request, headers=GENERATION)
    ).json()
    preview = await api.client.post(
        "/api/v1/workouts/sharing/previews",
        json={
            "kind": "program",
            "program_id": row["id"],
            "expected_revision": 1,
            "allow_incomplete": True,
        },
        headers=GENERATION,
    )
    assert preview.status_code == 201, preview.text
    confirmed = await api.client.post(
        f"/api/v1/workouts/sharing/previews/{preview.json()['id']}/confirm",
        json={
            "preview_digest": preview.json()["preview_digest"],
            "confirm_public_snapshot": True,
            "disclosure_version": 1,
        },
        headers=GENERATION,
    )
    assert confirmed.status_code == 201, confirmed.text
    return request, row, confirmed.json()


async def test_program_preview_removes_dates_private_titles_and_assumptions(api):
    original, row, share = await program_share(api)
    public = await api.client.get(share["api_path"])
    assert public.status_code == 200 and public.json()["kind"] == "program"
    assert PRIVATE not in public.text and row["id"] not in public.text
    assert all(session["date"] not in public.text for session in original["proposal"]["sessions"])
    source_dates = [date.fromisoformat(item["date"]) for item in original["proposal"]["sessions"]]
    assert [item["day_offset"] for item in public.json()["content"]["sessions"]] == [
        (value - min(source_dates)).days for value in source_dates
    ]
    assert (
        "assumptions" not in public.json()["content"] and "warnings" not in public.json()["content"]
    )


async def test_program_copy_preserves_spacing_requires_start_and_does_not_claim_fit(api):
    _, _, share = await program_share(api)
    path = share["api_path"] + "/copy"
    headers = {**GENERATION, "X-Test-User": "recipient"}
    body = {
        "copy_request_id": str(uuid4()),
        "snapshot_digest": share["snapshot_digest"],
        "acknowledge_not_personalized": True,
    }
    assert (await api.client.post(path, json=body, headers=headers)).status_code == 422
    body["start_date"] = "2026-11-02"
    copied = await api.client.post(path, json=body, headers=headers)
    assert copied.status_code == 201, copied.text
    proposal = copied.json()["record"]["content"]["proposal"]
    assert proposal["status"] == "needs_information" and proposal["questions"]
    assert proposal["assumptions"] == [] and proposal["source_ids"] == []
    dates = [date.fromisoformat(item["date"]) for item in proposal["sessions"]]
    assert [(value - date(2026, 11, 2)).days for value in dates] == [
        item["day_offset"] for item in share["content"]["sessions"]
    ]
    changed = await api.client.post(
        path, json={**body, "start_date": "2026-12-01"}, headers=headers
    )
    assert changed.status_code == 409


async def test_unknown_or_health_derived_programs_are_not_publicly_shared(api):
    _, row, _ = await program_share(api)
    async with api.sessions() as db:
        record = await db.get(WorkoutsProgram, row["id"])
        record.content = {**record.content, "health_context_used": True}
        await db.commit()
    response = await api.client.post(
        "/api/v1/workouts/sharing/previews",
        json={
            "kind": "program",
            "program_id": row["id"],
            "expected_revision": 1,
            "allow_incomplete": True,
        },
        headers=GENERATION,
    )
    assert response.status_code == 422


async def test_disabled_connections_never_authenticate_or_query(api, monkeypatch):
    monkeypatch.setattr(
        security,
        "get_settings",
        lambda: Settings(
            database_url="postgresql://localhost/test", openai_api_key="test", environment="test"
        ),
    )

    def fail():
        raise AssertionError("Disabled product cannot authenticate or query")

    api.app.dependency_overrides[get_current_user] = fail
    api.app.dependency_overrides[get_db] = fail
    assert (await api.client.get("/api/v1/workouts/connections/recipes")).status_code == 404
    assert (await api.client.get("/api/v1/workouts/shared/invalid")).status_code == 404


async def test_optional_migration_and_readiness_are_database_free_when_off():
    class Forbidden:
        def begin(self):
            raise AssertionError("Disabled migration touched database")

        def __call__(self):
            raise AssertionError("Disabled readiness touched database")

    configured = Settings(
        database_url="postgresql://localhost/test", openai_api_key="test", environment="test"
    )
    await migration37.run_migration(configured=configured, migration_engine=Forbidden())
    await verify_connections_schema(Forbidden(), settings=configured)


async def test_migration_tables_use_separate_metadata_and_readiness_checks(api):
    assert not any(table.name in RecipesBase.metadata.tables for table in CONNECTION_TABLES)
    await verify_connections_schema(api.sessions, settings=settings())
    async with api.engine.begin() as connection:
        await connection.execute(
            text(
                "ALTER TABLE workouts_shares DISABLE TRIGGER immutable_published_training_snapshot"
            )
        )
    with pytest.raises(RuntimeError, match="snapshot protections"):
        await verify_connections_schema(api.sessions, settings=settings())


async def test_copy_requires_enrolled_adult_recipient_and_authentication(api):
    _, _, share = await create_share(api)
    async with api.sessions() as db:
        db.add(AppUser(id="newcomer"))
        await db.commit()
    body = {
        "copy_request_id": str(uuid4()),
        "snapshot_digest": share["snapshot_digest"],
        "acknowledge_not_personalized": True,
    }
    assert (
        await api.client.post(
            share["api_path"] + "/copy",
            json=body,
            headers={**GENERATION, "X-Test-User": "newcomer"},
        )
    ).status_code == 409
    del api.app.dependency_overrides[get_current_user]
    assert (await api.client.get(share["api_path"])).status_code == 200
    assert (
        await api.client.post(share["api_path"] + "/copy", json=body, headers=GENERATION)
    ).status_code == 401


async def test_copy_waiting_on_revoke_observes_revocation(api, monkeypatch):
    _, _, share = await create_share(api)
    entered = asyncio.Event()
    original = sharing_service.public_share

    async def observed(db, token, *, lock=False):
        if lock:
            entered.set()
        return await original(db, token, lock=lock)

    async with api.sessions() as db:
        await lifecycle.lock_owner(db, "publisher")
        row = await db.scalar(
            select(WorkoutShare).where(WorkoutShare.id == share["id"]).with_for_update()
        )
        monkeypatch.setattr(sharing_service, "public_share", observed)
        pending = asyncio.create_task(
            api.client.post(
                share["api_path"] + "/copy",
                json={
                    "copy_request_id": str(uuid4()),
                    "snapshot_digest": share["snapshot_digest"],
                    "acknowledge_not_personalized": True,
                },
                headers={**GENERATION, "X-Test-User": "recipient"},
            )
        )
        await asyncio.wait_for(entered.wait(), timeout=5)
        row.revoked_at = now()
        await db.commit()
        assert (await asyncio.wait_for(pending, timeout=5)).status_code == 404
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutCopyReceipt)) == 0


async def test_projection_waiting_for_revocation_does_not_make_new_receipt(api, monkeypatch):
    await recipe_fixture(api)
    await grant(api, ["recipes_library_context"])
    entered = asyncio.Event()
    original = lifecycle.lock_owner

    async def observed(db, identifier):
        entered.set()
        await original(db, identifier)

    from sqlalchemy import delete

    from app.domains.workouts.models import WorkoutsGrant

    async with api.sessions() as db:
        await original(db, "publisher")
        monkeypatch.setattr(lifecycle, "lock_owner", observed)
        pending = asyncio.create_task(
            api.client.get("/api/v1/workouts/connections/recipes", headers=GENERATION)
        )
        await asyncio.wait_for(entered.wait(), timeout=5)
        await db.execute(delete(WorkoutsGrant).where(WorkoutsGrant.app_user_id == "publisher"))
        await db.commit()
        assert (await asyncio.wait_for(pending, timeout=5)).status_code == 403
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(RecipeConnectionReceipt)) == 0


async def test_connection_erasure_hooks_purge_own_rows_without_erasing_recipient_copy(api):
    _, _, share = await create_share(api)
    copied = await api.client.post(
        share["api_path"] + "/copy",
        json={
            "copy_request_id": str(uuid4()),
            "snapshot_digest": share["snapshot_digest"],
            "acknowledge_not_personalized": True,
        },
        headers={**GENERATION, "X-Test-User": "recipient"},
    )
    await recipe_fixture(api)
    await grant(api, ["recipes_library_context"])
    await api.client.get("/api/v1/workouts/connections/recipes", headers=GENERATION)
    async with api.sessions() as db:
        await lifecycle.lock_owner(db, "publisher")
        membership = await db.get(WorkoutsMembership, "publisher")
        await erase_connections_data(db, "publisher")
        await lifecycle.erase_product_data(db, membership, 1)
        await db.commit()
        for table in CONNECTION_TABLES:
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(table)
                    .where(table.c.app_user_id == "publisher")
                )
                == 0
            )
        assert await db.get(WorkoutRecord, copied.json()["record"]["id"]) is not None
        assert await db.scalar(select(func.count()).select_from(WorkoutCopyReceipt)) == 1


async def test_connection_export_excludes_tokens_ciphertext_and_private_sources(api):
    _, _, share = await create_share(api)
    async with api.sessions() as db:
        exported = await connection_export_page(db, "publisher", 1)
    serialized = str(exported)
    assert share["api_path"].split("/")[-1] not in serialized
    assert (
        "encrypted_token" not in serialized
        and "token_hash" not in serialized
        and PRIVATE not in serialized
    )


async def test_stale_nutrition_is_not_presented_as_current_dietary_evidence(api):
    own, _, _, _ = await recipe_fixture(api)
    async with api.sessions() as db:
        row = await db.get(Recipe, own)
        row.extracted = {**row.extracted, "derivedData": {"nutrition": {"status": "stale"}}}
        await db.commit()
    await grant(api, ["recipes_library_context"])
    response = await api.client.get(
        f"/api/v1/workouts/connections/recipes?recipe_ids={own}", headers=GENERATION
    )
    assert response.json()["library"][0]["nutrition_status"] == "stale"
    assert response.json()["library"][0]["nutrition"]["calories"] is None


@pytest.mark.parametrize("include_source", [False, True])
async def test_shared_workout_copy_saves_unchanged_without_invented_url(api, include_source):
    original, _, share = await create_share(api, include_source=include_source)
    headers = {**GENERATION, "X-Test-User": "recipient"}
    copied = await api.client.post(
        share["api_path"] + "/copy",
        headers=headers,
        json={
            "copy_request_id": str(uuid4()),
            "snapshot_digest": share["snapshot_digest"],
            "acknowledge_not_personalized": True,
        },
    )
    assert copied.status_code == 201, copied.text
    record = copied.json()["record"]
    content = record["content"]
    assert content["provenance"] == "source"
    assert content["source_url"] == (WORKOUT["source_url"] if include_source else None)
    assert all(
        exercise["provenance"] == "source"
        for block in content["blocks"]
        for exercise in block["exercises"]
    )
    unchanged = {
        key: value
        for key, value in content.items()
        if key not in {"id", "version", "parent_version_id"}
    }
    saved = await api.client.put(
        f"/api/v1/workouts/library/{record['id']}?expected_revision=1",
        json=unchanged,
        headers=headers,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["content"]["capture_kind"] == "shared"
    assert saved.json()["content"]["source_url"] == content["source_url"]
    source = await api.client.get(f"/api/v1/workouts/library/{original['id']}")
    assert source.json()["revision"] == original["revision"]


async def test_shared_program_copy_keeps_review_guard_then_saves_unchanged_prescriptions(api):
    _, _, share = await program_share(api)
    headers = {**GENERATION, "X-Test-User": "recipient"}
    copied = await api.client.post(
        share["api_path"] + "/copy",
        headers=headers,
        json={
            "copy_request_id": str(uuid4()),
            "snapshot_digest": share["snapshot_digest"],
            "acknowledge_not_personalized": True,
            "start_date": "2026-11-02",
        },
    )
    assert copied.status_code == 201, copied.text
    record = copied.json()["record"]
    content = record["content"]
    for item in content["proposal"]["sessions"]:
        assert item["workout"]["provenance"] == "source"
        assert item["workout"]["source_url"] is None
    path = f"/api/v1/workouts/programs/{record['id']}?expected_revision=1"
    # Copying alone must not bypass the existing explicit personal-review gate.
    blocked = await api.client.put(path, json=content, headers=headers)
    assert blocked.status_code == 422 and "Resolve program questions" in blocked.text
    # A manually reviewed plan retains its exact copied workout prescriptions.
    reviewed = {**content, "proposal": {**content["proposal"], "status": "ready", "questions": []}}
    saved = await api.client.put(path, json=reviewed, headers=headers)
    assert saved.status_code == 200, saved.text
    assert saved.json()["content"]["proposal"]["sessions"] == content["proposal"]["sessions"]
    assert all(
        item["workout"]["capture_kind"] == "shared"
        for item in saved.json()["content"]["proposal"]["sessions"]
    )


async def test_shared_copy_can_enter_coach_adaptation_acceptance_without_invented_source(
    coach_api,  # noqa: F811 -- imported pytest fixture
    monkeypatch,
):
    api = coach_api
    await migration37.run_migration(configured=settings(), migration_engine=api.engine)
    api.app.include_router(connection_router)
    monkeypatch.setenv(
        "WORKOUTS_SHARE_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"x" * 32).decode()
    )
    monkeypatch.setitem(WORKOUT, "estimated_minutes", 20)
    monkeypatch.setitem(WORKOUT["blocks"][0]["exercises"][0], "exercise_id", "bodyweight_squat")
    _, _, share = await create_share(api, "owner")
    copied = await api.client.post(
        share["api_path"] + "/copy",
        headers=GENERATION,
        json={
            "copy_request_id": str(uuid4()),
            "snapshot_digest": share["snapshot_digest"],
            "acknowledge_not_personalized": True,
        },
    )
    assert copied.status_code == 201, copied.text
    record = copied.json()["record"]
    api.provider.action = (
        "adapt_saved_workout",
        {"workout_id": record["id"], "expected_revision": 1, "minutes": None},
    )
    accepted, _ = await action(api)
    assert accepted.status_code == 200, accepted.text
    adapted = await api.client.get(f"/api/v1/workouts/library/{accepted.json()['record_id']}")
    assert adapted.status_code == 200, adapted.text
    assert adapted.json()["content"]["capture_kind"] == "shared"
    assert adapted.json()["content"]["source_url"] is None
    assert adapted.json()["id"] != record["id"]
    source = await api.client.get(f"/api/v1/workouts/library/{record['id']}")
    assert source.json()["content"] == record["content"] and source.json()["revision"] == 1
