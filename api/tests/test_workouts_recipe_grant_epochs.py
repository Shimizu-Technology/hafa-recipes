"""Scoped Recipes choices preserve unrelated permissions under concurrent writes."""

import asyncio
import importlib
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import DBAPIError

from app.domains.workouts import security
from app.domains.workouts.connection_router import router
from app.domains.workouts.lifecycle import erase_product_data, membership_for
from app.domains.workouts.models import WorkoutsGrant, WorkoutsMembership
from app.domains.workouts.recipe_grant_models import WorkoutsRecipeGrantEpoch
from app.domains.workouts.recipe_grant_service import (
    advance_recipe_grant_revision,
    erase_recipe_grant_epochs,
    export_recipe_grant_epoch,
    verify_recipe_grant_schema,
)
from app.models.identity import AppUser
from tests.test_workouts_data_integration import (
    DATABASE_URL,
    GENERATION,
    data_api,  # noqa: F401 -- imported reusable disposable fixture
    enroll,
    settings,
)

pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="Disposable TEST_DATABASE_URL required")
PREFIX = "/api/v1/workouts"
PATH = PREFIX + "/connections/recipes/grants"
migration = importlib.import_module("migrations.041_add_workouts_recipe_grant_epochs")
automation = importlib.import_module("migrations.035_add_workouts_automation")


@pytest.fixture
async def scoped_api(data_api):  # noqa: F811 -- reusable fixture
    await automation.run_migration(configured=settings(), migration_engine=data_api.engine)
    await migration.run_migration(configured=settings(), migration_engine=data_api.engine)
    data_api.app.include_router(router)
    await enroll(data_api)
    await enroll(data_api, other=True)
    return data_api


async def snapshot(api, other=False, generation=1):
    response = await api.client.get(
        PATH,
        headers={
            "X-Workouts-Generation": str(generation),
            **({"X-Test-User": "other"} if other else {}),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def choice(api, revision=0, library=False, meal=False, other=False, generation=1):
    return await api.client.put(
        PATH,
        json={"expected_revision": revision, "library_context": library, "meal_plan_context": meal},
        headers={
            "X-Workouts-Generation": str(generation),
            **({"X-Test-User": "other"} if other else {}),
        },
    )


async def test_get_empty_is_private_and_has_no_implicit_data_or_connections(scoped_api):
    api = scoped_api
    assert await snapshot(api) == {
        "generation": 1,
        "revision": 0,
        "library_context": False,
        "meal_plan_context": False,
        "scopes": [],
    }
    response = await api.client.get(PATH, headers=GENERATION)
    assert response.headers["Cache-Control"] == "no-store"
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsRecipeGrantEpoch)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkoutsGrant)) == 0


async def test_scoped_choices_preserve_nonrecipes_and_unchanged_timestamps(scoped_api):
    api = scoped_api
    await api.client.put(
        PREFIX + "/grants",
        json={"scopes": ["health_activity_read", "health_activity_write", "ai_health_context"]},
        headers=GENERATION,
    )
    before = (await api.client.get(PREFIX + "/grants")).json()
    changed = await choice(api, library=True)
    assert changed.status_code == 200, changed.text
    first = changed.json()
    assert first["revision"] == 1 and [row["scope"] for row in first["scopes"]] == [
        "recipes_library_context"
    ]
    no_op = await choice(api, revision=1, library=True)
    assert no_op.json() == first
    second = await choice(api, revision=1, library=True, meal=True)
    assert second.status_code == 200 and second.json()["revision"] == 2
    assert (
        next(row for row in second.json()["scopes"] if row["scope"] == "recipes_library_context")
        == first["scopes"][0]
    )
    after = (await api.client.get(PREFIX + "/grants")).json()
    assert [row for row in after if not row["scope"].startswith("recipes_")] == before


async def test_delayed_recipe_choice_cannot_restore_concurrent_health_or_ai_revocation(scoped_api):
    api = scoped_api
    await api.client.put(
        PREFIX + "/grants",
        json={"scopes": ["health_activity_read", "ai_health_context"]},
        headers=GENERATION,
    )
    pending = await snapshot(api)
    # Native captured Recipes choices before another settings screen revoked all
    # health/AI grants. The narrow command cannot carry these old grants back.
    revoked = await api.client.put(PREFIX + "/grants", json={"scopes": []}, headers=GENERATION)
    assert revoked.status_code == 200
    result = await choice(api, revision=pending["revision"], library=True)
    assert result.status_code == 200, result.text
    all_scopes = (await api.client.get(PREFIX + "/grants")).json()
    assert [row["scope"] for row in all_scopes] == ["recipes_library_context"]


async def test_concurrent_recipe_writers_one_wins_no_lost_choices(scoped_api):
    api = scoped_api
    responses = await asyncio.gather(choice(api, library=True), choice(api, meal=True))
    assert sorted(response.status_code for response in responses) == [200, 409]
    current = await snapshot(api)
    assert current["revision"] == 1 and current["library_context"] != current["meal_plan_context"]
    async with api.sessions() as db:
        assert await db.scalar(select(func.count()).select_from(WorkoutsRecipeGrantEpoch)) == 1
        assert await db.scalar(select(func.count()).select_from(WorkoutsGrant)) == 1


async def test_aba_and_stale_equal_choices_cannot_regrant(scoped_api):
    api = scoped_api
    assert (await choice(api, library=True)).json()["revision"] == 1
    assert (await choice(api, revision=1)).json()["revision"] == 2
    for library in [False, True]:
        response = await choice(api, revision=0, library=library)
        assert response.status_code == 409, response.text
        assert response.headers["Cache-Control"] == "no-store"
    assert (await snapshot(api))["scopes"] == []
    deliberate = await choice(api, revision=2, library=True)
    assert deliberate.status_code == 200 and deliberate.json()["revision"] == 3


async def test_lost_response_retry_requires_refresh_and_never_autoreapplies(scoped_api):
    api = scoped_api
    first = await choice(api, library=True)
    assert first.status_code == 200
    retry = await choice(api, library=True)
    assert retry.status_code == 409
    current = await snapshot(api)
    assert current["revision"] == 1 and current["library_context"]
    # Only a new explicit command naming the fetched revision is accepted.
    assert (await choice(api, revision=current["revision"], library=True)).json() == current


async def test_root_generic_hook_only_recipes_changes_advance(scoped_api):
    api = scoped_api
    async with api.sessions() as db:
        await membership_for(db, "owner", generation=1, write=True)
        assert (
            await advance_recipe_grant_revision(db, "owner", 1, {"health_activity_read"}, set())
            == 0
        )
        assert (
            await advance_recipe_grant_revision(db, "owner", 1, set(), {"recipes_library_context"})
            == 1
        )
        db.add(WorkoutsGrant(app_user_id="owner", generation=1, scope="recipes_library_context"))
        await db.commit()
    async with api.sessions() as db:
        await membership_for(db, "owner", generation=1, write=True)
        assert (
            await advance_recipe_grant_revision(db, "owner", 1, {"recipes_library_context"}, set())
            == 2
        )
        await db.execute(delete(WorkoutsGrant).where(WorkoutsGrant.app_user_id == "owner"))
        await db.commit()
    assert (await choice(api, revision=0, library=True)).status_code == 409
    async with api.sessions() as db:
        await membership_for(db, "owner", generation=1, write=True)
        assert (
            await advance_recipe_grant_revision(db, "owner", 1, set(), {"ai_health_context"}) == 2
        )
        await db.commit()


@pytest.mark.parametrize(
    "body",
    [
        {"expected_revision": True, "library_context": True, "meal_plan_context": False},
        {"expected_revision": 0, "library_context": "true", "meal_plan_context": False},
        {"expected_revision": 0, "library_context": True, "meal_plan_context": None},
        {"expected_revision": 0, "library_context": True},
        {
            "expected_revision": 0,
            "library_context": True,
            "meal_plan_context": False,
            "scopes": ["ai_health_context"],
        },
        {
            "expected_revision": 0,
            "library_context": True,
            "meal_plan_context": False,
            "owner": "other",
        },
    ],
)
async def test_strict_subset_contract_rejects_broad_or_untrusted_fields(scoped_api, body):
    response = await scoped_api.client.put(PATH, json=body, headers=GENERATION)
    assert response.status_code == 422, response.text
    assert (await snapshot(scoped_api))["revision"] == 0


async def test_owner_generation_account_header_and_enrollment_fences(scoped_api):
    api = scoped_api
    assert (await choice(api, library=True)).status_code == 200
    assert (await snapshot(api, other=True))["revision"] == 0
    assert (await choice(api, library=True, generation=2)).status_code == 409
    mismatch = await api.client.put(
        PATH,
        json={"expected_revision": 1, "library_context": True, "meal_plan_context": False},
        headers={**GENERATION, "X-Hafa-Account-ID": "other"},
    )
    assert mismatch.status_code == 409
    async with api.sessions() as db:
        membership = await db.get(WorkoutsMembership, "other")
        membership.status = "deleted"
        await db.commit()
    response = await api.client.get(PATH, headers={**GENERATION, "X-Test-User": "other"})
    assert response.status_code == 409
    assert (await snapshot(api))["library_context"]


async def test_erase_hook_export_and_reenroll_reject_original_generation(scoped_api):
    api = scoped_api
    await choice(api, library=True)
    async with api.sessions() as db:
        exported = await export_recipe_grant_epoch(db, "owner", 1)
        assert exported[0]["revision"] == 1 and "app_user_id" not in str(exported)
        assert await export_recipe_grant_epoch(db, "other", 1) == []
        membership = await membership_for(db, "owner", generation=1, write=True)
        await erase_recipe_grant_epochs(db, "owner")
        await erase_product_data(db, membership, 1)
        await db.commit()
        assert await db.scalar(select(func.count()).select_from(WorkoutsRecipeGrantEpoch)) == 0
    await enroll(api, generation=2)
    current = await snapshot(api, generation=2)
    assert current["revision"] == 0 and not current["library_context"]
    assert (await choice(api, library=True, generation=1)).status_code == 409
    assert (await choice(api, library=True, generation=2)).status_code == 200


async def test_whole_account_cascade_and_epoch_monotonicity(scoped_api):
    api = scoped_api
    await choice(api, library=True)
    async with api.sessions() as db:
        row = await db.get(WorkoutsRecipeGrantEpoch, ("owner", 1))
        row.revision = 0
        with pytest.raises(DBAPIError, match="monotonically"):
            await db.commit()
    async with api.sessions() as db:
        await db.execute(delete(AppUser).where(AppUser.id == "owner"))
        await db.commit()
        assert await db.scalar(select(func.count()).select_from(WorkoutsRecipeGrantEpoch)) == 0


async def test_master_off_before_auth_or_database_and_optional_migration(scoped_api, monkeypatch):
    api = scoped_api
    monkeypatch.setattr(
        security, "get_settings", lambda: SimpleNamespace(workouts_api_enabled=False)
    )
    assert (await api.client.get(PATH)).status_code == 404
    assert (await api.client.put(PATH, json={})).status_code == 404

    class NoDatabase:
        def begin(self):
            raise AssertionError("Disabled migration connected")

        def connect(self):
            raise AssertionError("Disabled readiness connected")

    configured = SimpleNamespace(workouts_api_enabled=False)
    await migration.run_migration(configured=configured, migration_engine=NoDatabase())
    await verify_recipe_grant_schema(NoDatabase(), configured)


async def test_migration_idempotence_restore_point_core_and_readiness(scoped_api, monkeypatch):
    api = scoped_api
    await migration.run_migration(configured=settings(), migration_engine=api.engine)
    await verify_recipe_grant_schema(api.engine, settings())
    async with api.engine.begin() as connection:
        assert (
            await connection.execute(text("SELECT version FROM schema_migrations"))
        ).scalars().all() == [33]
        await connection.execute(text("DELETE FROM workouts_schema_migrations WHERE version=41"))
    monkeypatch.delenv("MIGRATION_041_RESTORE_POINT", raising=False)
    with pytest.raises(RuntimeError, match="verified restore point"):
        await migration.run_migration(
            configured=SimpleNamespace(workouts_api_enabled=True, environment="production"),
            migration_engine=api.engine,
        )
    with pytest.raises(RuntimeError, match="migration041"):
        await verify_recipe_grant_schema(api.engine, settings())
