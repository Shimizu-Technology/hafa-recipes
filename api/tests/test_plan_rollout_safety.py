"""PostgreSQL regressions: expansion ordering, household authority and revisions."""

import asyncio
import os
from datetime import date
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.db.database import Base
from app.models.grocery import GroceryItem, GroceryList, GroceryListMember
from app.models.identity import AppUser
from app.models.meal_plan import MealPlanEntry
from app.models.recipe import Recipe
from app.routers import meal_plans as plans
from tests.database_safety import require_disposable_test_database

DAY = date(2026, 10, 26)


def user(id="cook"):
    return ClerkUser(
        id=id,
        clerk_user_id=f"clerk_{id}",
        clerk_issuer="https://development.clerk.test",
        clerk_environment="development",
        first_name=id,
    )


@pytest.fixture
async def isolated_plan_db():
    url = os.environ["TEST_DATABASE_URL"]
    require_disposable_test_database(url)
    expected_db = urlsplit(url).path.lstrip("/")
    assert "test" in expected_db
    url = url.replace("postgresql://", "postgresql+asyncpg://")
    admin = create_async_engine(url)
    schema = f"r10_rollout_{uuid4().hex}"
    async with admin.begin() as db:
        assert await db.scalar(text("select current_database()")) == expected_db
        await db.execute(text(f"CREATE SCHEMA {schema}"))
    engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
    try:
        async with engine.begin() as db:
            assert await db.scalar(text("select current_database()")) == expected_db
            await db.run_sync(Base.metadata.create_all)
        yield engine, async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()
        async with admin.begin() as db:
            await db.execute(text(f"DROP SCHEMA {schema} CASCADE"))
        await admin.dispose()


async def seed(sessions):
    async with sessions() as db:
        db.add_all([AppUser(id="cook"), AppUser(id="housemate")])
        recipe = Recipe(
            user_id="cook",
            source_url="manual:test",
            source_type="manual",
            is_public=True,
            extracted={
                "title": "Rice",
                "servings": 4,
                "components": [
                    {
                        "ingredients": [{"name": "Rice", "quantity": "2", "unit": "cup"}],
                        "steps": ["Cook"],
                    }
                ],
            },
        )
        grocery = GroceryList(name="Household A")
        other = GroceryList(name="Household B")
        db.add_all([recipe, grocery, other])
        await db.flush()
        db.add_all(
            [
                GroceryListMember(list_id=grocery.id, user_id="cook"),
                GroceryListMember(list_id=grocery.id, user_id="housemate"),
            ]
        )
        await db.commit()
        return recipe.id, grocery.id, other.id


@pytest.mark.asyncio
@pytest.mark.parametrize("expanded", [False, True])
async def test_old_26_client_requests_parse_all_changed_responses_before_and_after_053(
    isolated_plan_db, expanded
):
    engine, sessions = isolated_plan_db
    recipe, _, _ = await seed(sessions)
    if not expanded:
        async with engine.begin() as db:
            await db.execute(text("ALTER TABLE meal_plan_entries DROP COLUMN planned_servings"))
    app = FastAPI()
    app.include_router(plans.router)

    async def database():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/api/meal-plans/",
            json={
                "date": str(DAY),
                "meal_type": "dinner",
                "recipe_id": str(recipe),
                "recipe_title": "Rice",
                "servings": "8",
            },
        )
        assert created.status_code == 200, created.text
        payload = created.json()
        entry_id = payload["id"]

        def old_entry(value):
            UUID(value["id"])
            UUID(value["recipe_id"])
            date.fromisoformat(value["date"])
            assert value["meal_type"] == "dinner" and isinstance(value["recipe_title"], str)
            assert isinstance(value["created_at"], str) and value["servings"] == "8"

        old_entry(payload)
        updated = await client.put(f"/api/meal-plans/{entry_id}", json={"notes": "Old client"})
        assert updated.status_code == 200, updated.text
        old_entry(updated.json())
        for path, key in [
            (f"/week?week_of={DAY}", "days"),
            (f"/day?target_date={DAY}", "dinner"),
            (f"/recipe/{recipe}?start_date={DAY}", None),
        ]:
            response = await client.get("/api/meal-plans" + path)
            assert response.status_code == 200, response.text
            values = response.json()
            if key == "days":
                values = [entry for day in values["days"] for entry in day["dinner"]]
            elif key:
                values = values[key]
            old_entry(values[0])
        copied = await client.post(
            f"/api/meal-plans/copy-week?source_week={DAY}&target_week=2026-11-02"
        )
        assert copied.status_code == 200 and copied.json()["entries_copied"] == 1
        groceries = await client.post(
            "/api/meal-plans/to-grocery", json={"start_date": str(DAY), "end_date": str(DAY)}
        )
        assert groceries.status_code == 200, groceries.text
        result = groceries.json()
        assert (
            isinstance(result["message"], str)
            and result["items_added"] == 1
            and result["recipes_processed"] == 1
        )
        assert result["items_missing_amount"] == 0
        async with sessions() as db:
            assert (await db.scalars(select(GroceryItem))).one().quantity == "2"
        modern = await client.put(f"/api/meal-plans/{entry_id}", json={"planned_servings": 8})
        assert modern.status_code == (200 if expanded else 503), modern.text
        if expanded:
            assert modern.json()["planned_servings"] == 8


async def review_request(db, actor):
    request = plans.AddToGroceryRequest(start_date=DAY, end_date=DAY)
    preview = await plans.preview_plan_grocery(request, db, actor)
    return plans.AddToGroceryRequest(
        start_date=DAY,
        end_date=DAY,
        mutation_id=uuid4(),
        preview_token=preview["preview_token"],
        list_id=preview.get("list_id"),
        review=preview,
    )


async def add_entry(db, recipe, actor="cook"):
    return await plans.add_meal(
        plans.MealPlanEntryCreate(
            date=DAY, meal_type="dinner", recipe_id=recipe, recipe_title="Rice"
        ),
        db,
        user(actor),
    )


@pytest.mark.asyncio
async def test_review_replays_accepted_result_after_plan_changes_and_rejects_household_switch(
    isolated_plan_db,
):
    _, sessions = isolated_plan_db
    recipe, first_list, second_list = await seed(sessions)
    async with sessions() as db:
        entry = await add_entry(db, recipe)
        request = await review_request(db, user())
        accepted = await plans.add_plan_to_grocery(request, db, user())
        await plans.update_meal(entry.id, plans.MealPlanEntryUpdate(planned_servings=8), db, user())
        replay = await plans.add_plan_to_grocery(request, db, user())
        assert replay == {**accepted, "replayed": True}
    async with sessions() as db:
        member = await db.get(GroceryListMember, (first_list, "cook"))
        await db.delete(member)
        await db.flush()
        db.add(GroceryListMember(list_id=second_list, user_id="cook"))
        await db.commit()
    async with sessions() as db:
        with pytest.raises(HTTPException) as error:
            await plans.add_plan_to_grocery(request, db, user())
        assert error.value.status_code == 409
        assert (
            await db.scalar(
                select(func.count())
                .select_from(GroceryItem)
                .where(GroceryItem.list_id == second_list)
            )
            == 0
        )
        assert (
            await db.scalar(
                select(func.count())
                .select_from(GroceryItem)
                .where(GroceryItem.list_id == first_list)
            )
            == 1
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy_second", [False, True])
async def test_two_household_writers_refresh_locked_revision_even_when_preloaded(
    isolated_plan_db, monkeypatch, legacy_second
):
    _, sessions = isolated_plan_db
    recipe, list_id, _ = await seed(sessions)
    async with sessions() as db:
        await add_entry(db, recipe)
        await add_entry(db, recipe, "housemate")
        requests = [await review_request(db, user(actor)) for actor in ["cook", "housemate"]]
    if legacy_second:
        requests[1] = plans.AddToGroceryRequest(start_date=DAY, end_date=DAY)
    ready = asyncio.Event()
    both = 0
    original = plans.get_or_create_user_list

    async def preloaded(db, actor):
        nonlocal both
        row = await original(db, actor)
        assert row.revision == 0
        both += 1
        if both == 2:
            ready.set()
        await asyncio.wait_for(ready.wait(), 5)
        return row

    monkeypatch.setattr(plans, "get_or_create_user_list", preloaded)

    async def write(i):
        async with sessions() as db:
            return await plans.add_plan_to_grocery(requests[i], db, user(["cook", "housemate"][i]))

    await asyncio.wait_for(asyncio.gather(write(0), write(1)), 10)
    async with sessions() as db:
        assert (await db.get(GroceryList, list_id)).revision == 2
        assert await db.scalar(select(func.count()).select_from(GroceryItem)) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("wrong_type", [False, True])
async def test_migration053_verifies_existing_columns_and_marker_drift(
    isolated_plan_db, wrong_type
):
    from importlib import import_module
    from types import SimpleNamespace

    from sqlalchemy import text

    engine, _ = isolated_plan_db
    async with engine.begin() as db:
        await db.execute(
            text("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT)")
        )
        await db.execute(text("INSERT INTO schema_migrations VALUES(53,'old marker')"))
        if wrong_type:
            await db.execute(
                text("ALTER TABLE meal_plan_entries ALTER COLUMN planned_servings TYPE TEXT")
            )
    migration = import_module("migrations.053_add_planned_servings")
    if wrong_type:
        with pytest.raises(RuntimeError, match="schema drift"):
            await migration.run_migration(
                configured=SimpleNamespace(environment="test"), migration_engine=engine
            )
    else:
        await migration.run_migration(
            configured=SimpleNamespace(environment="test"), migration_engine=engine
        )
        async with engine.begin() as db:
            assert (
                await db.scalar(
                    text(
                        "SELECT convalidated FROM pg_constraint WHERE conname='ck_meal_plan_entries_planned_servings' AND conrelid='meal_plan_entries'::regclass"
                    )
                )
                is True
            )


@pytest.mark.asyncio
@pytest.mark.parametrize("accepted_before_switch", [False, True])
async def test_identical_review_never_writes_to_a_second_household(
    isolated_plan_db, accepted_before_switch
):
    _, sessions = isolated_plan_db
    recipe, first_list, second_list = await seed(sessions)
    async with sessions() as db:
        await add_entry(db, recipe)
        request = await review_request(db, user())
        if accepted_before_switch:
            await plans.add_plan_to_grocery(request, db, user())
    async with sessions() as db:
        member = await db.get(GroceryListMember, (first_list, "cook"))
        await db.delete(member)
        await db.flush()
        db.add(GroceryListMember(list_id=second_list, user_id="cook"))
        await db.commit()
    async with sessions() as db:
        with pytest.raises(HTTPException) as error:
            await plans.add_plan_to_grocery(request, db, user())
        assert error.value.status_code == 409
        assert (
            await db.scalar(
                select(func.count())
                .select_from(GroceryItem)
                .where(GroceryItem.list_id == second_list)
            )
            == 0
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("expanded", [False, True])
async def test_current_planner_create_hint_works_end_to_end_before_and_after_053(
    isolated_plan_db, expanded
):
    engine, sessions = isolated_plan_db
    recipe_id, _, _ = await seed(sessions)
    async with sessions() as db:
        recipe = await db.get(Recipe, recipe_id)
        recipe.extracted = {
            **recipe.extracted,
            "components": [
                {
                    "ingredients": [{"name": "Rice", "quantity": "1 1/2", "unit": "cup"}],
                    "steps": ["Cook"],
                }
            ],
        }
        await db.commit()
    if not expanded:
        async with engine.begin() as db:
            await db.execute(text("ALTER TABLE meal_plan_entries DROP COLUMN planned_servings"))
    app = FastAPI()
    app.include_router(plans.router)

    async def database():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        # Exact shape emitted by buildMealPlanEntry for a 4-serving recipe scaled to 6.
        response = await client.post(
            "/api/meal-plans/",
            json={
                "date": str(DAY),
                "meal_type": "dinner",
                "recipe_id": str(recipe_id),
                "recipe_title": "Rice",
                "recipe_thumbnail": None,
                "planned_servings": 6,
            },
        )
        assert response.status_code == 200, response.text
        entry = response.json()
        assert entry["planned_servings"] == (6 if expanded else None)
        week = await client.get(f"/api/meal-plans/week?week_of={DAY}")
        assert week.status_code == 200, week.text
        planned = [entry for day in week.json()["days"] for entry in day["dinner"]]
        assert len(planned) == 1 and planned[0]["id"] == entry["id"]
        preview = await client.post(
            "/api/meal-plans/to-grocery/preview",
            json={"start_date": str(DAY), "end_date": str(DAY)},
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["items"][0]["quantity"] == ("2 1/4" if expanded else "1 1/2")
        assert preview.json()["items_unscaled"] == 0
        added = await client.post(
            "/api/meal-plans/to-grocery", json={"start_date": str(DAY), "end_date": str(DAY)}
        )
        assert added.status_code == 200 and added.json()["items_added"] == 1
        edited = await client.put(f"/api/meal-plans/{entry['id']}", json={"planned_servings": 8})
        assert edited.status_code == (200 if expanded else 503)
    async with sessions() as db:
        rows = (await db.scalars(select(MealPlanEntry))).all()
        assert len(rows) == 1
        await plans.load_planned_servings(db, rows)
        assert rows[0].planned_servings == (8 if expanded else None)
        assert (await db.scalars(select(GroceryItem))).one().quantity == (
            "2 1/4" if expanded else "1 1/2"
        )


@pytest.mark.asyncio
async def test_migration053_releases_expansion_lock_before_validation_and_resumes(isolated_plan_db):
    from importlib import import_module
    from types import SimpleNamespace

    from sqlalchemy import event

    engine, _ = isolated_plan_db
    async with engine.begin() as db:
        await db.execute(
            text("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT)")
        )
        await db.execute(text("ALTER TABLE meal_plan_entries DROP COLUMN planned_servings"))
    migration = import_module("migrations.053_add_planned_servings")
    transactions = {}
    locks = []

    def interrupt_validation(connection, cursor, statement, parameters, context, executemany):
        if "ADD CONSTRAINT ck_meal_plan_entries_planned_servings" in statement:
            transactions["expand"] = connection.exec_driver_sql("SELECT txid_current()").scalar()
        if "VALIDATE CONSTRAINT ck_meal_plan_entries_planned_servings" in statement:
            transactions["validate"] = connection.exec_driver_sql("SELECT txid_current()").scalar()
            locks.extend(
                connection.exec_driver_sql(
                    "SELECT mode FROM pg_locks WHERE pid=pg_backend_pid() AND relation='meal_plan_entries'::regclass"
                ).scalars()
            )
            raise RuntimeError("validation interrupted")

    event.listen(engine.sync_engine, "before_cursor_execute", interrupt_validation)
    try:
        with pytest.raises(RuntimeError, match="validation interrupted"):
            await migration.run_migration(
                configured=SimpleNamespace(environment="test"), migration_engine=engine
            )
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", interrupt_validation)
    assert transactions["expand"] != transactions["validate"]
    assert "AccessExclusiveLock" not in locks
    async with engine.begin() as db:
        assert (
            await db.scalar(
                text(
                    "SELECT convalidated FROM pg_constraint WHERE conrelid='meal_plan_entries'::regclass AND conname='ck_meal_plan_entries_planned_servings'"
                )
            )
            is False
        )
        assert await db.scalar(text("SELECT count(*) FROM schema_migrations WHERE version=53")) == 0
    await migration.run_migration(
        configured=SimpleNamespace(environment="test"), migration_engine=engine
    )
    async with engine.begin() as db:
        assert (
            await db.scalar(
                text(
                    "SELECT convalidated FROM pg_constraint WHERE conrelid='meal_plan_entries'::regclass AND conname='ck_meal_plan_entries_planned_servings'"
                )
            )
            is True
        )
        assert await db.scalar(text("SELECT count(*) FROM schema_migrations WHERE version=53")) == 1
