"""Recipe edit/reload disclosure coverage against disposable PostgreSQL."""

import json
import os

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser
from app.db.database import Base
from app.models.identity import AppUser
from app.models.recipe import Recipe
from app.recipe_derived_data import mark_fresh
from app.routers.recipes import RecipeEdit, edit_recipe, edit_recipe_with_image, get_recipe
from tests.database_safety import require_disposable_test_database

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="Disposable TEST_DATABASE_URL required",
)


@pytest.fixture
async def nutrition_database():
    require_disposable_test_database(TEST_DATABASE_URL)
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()


@pytest.mark.parametrize("multipart", [False, True])
@pytest.mark.parametrize("servings,basis", [(4, "recipe_servings"), (None, "whole_recipe")])
async def test_saved_recalculation_reloads_disclosure_and_replaces_old_assumptions(
    nutrition_database, multipart, servings, basis,
):
    owner = ClerkUser(
        id="nutrition_owner", clerk_user_id="clerk_nutrition_owner",
        clerk_issuer="https://clerk.example.test", clerk_environment="test",
    )
    old = {
        "title": "Rice", "sourceUrl": "manual://test", "servings": 8,
        "components": [{"name": "Main", "ingredients": [
            {"name": "rice", "quantity": "1", "unit": "cup"},
        ], "steps": ["Cook"]}],
        "nutrition": {
            "perServing": {"calories": 200, "protein": 4, "carbs": 45, "fat": 1},
            "total": {}, "servingBasis": "source", "servingsUsed": 8,
            "assumptions": ["Previous estimate assumed 1 cup."],
            "sourceServingSize": "1 cookie",
        },
    }
    old = mark_fresh(old, "nutrition", source="source", model="previous-model")
    async with nutrition_database() as db:
        db.add(AppUser(id=owner.id))
        await db.flush()
        recipe = Recipe(
            source_url="manual://test", source_type="manual", extraction_method="manual",
            extracted=old, user_id=owner.id, is_public=False,
        )
        db.add(recipe)
        await db.commit()
        recipe_id = recipe.id

    assumptions = ["Rice: assumed 2 cups.", "Oil: assumed 1 tbsp."]
    payload = {
        "title": "Rice", "servings": servings,
        "ingredients": [{"name": "rice"}], "steps": ["Cook"],
        "nutrition": {"calories": 210, "protein": 4, "carbs": 45, "fat": 1} if servings else {},
        "nutrition_total": {"calories": 840, "protein": 16, "carbs": 180, "fat": 4},
        "nutrition_serving_basis": basis, "nutrition_assumptions": assumptions,
        "nutrition_recalculated": True, "nutrition_model": "replacement-model",
    }
    async with nutrition_database() as db:
        if multipart:
            saved = await edit_recipe_with_image(recipe_id, json.dumps(payload), None, db, owner)
        else:
            saved = await edit_recipe(recipe_id, RecipeEdit(**payload), db, owner)

    # A fresh session exercises persisted JSONB and the GET detail response,
    # rather than inspecting the in-memory edit result alone.
    async with nutrition_database() as db:
        reloaded = await get_recipe(recipe_id, db, owner)
        assert reloaded.user_id == owner.id
        assert reloaded.is_public is False
        assert reloaded.content_revision == saved.content_revision == 2
        for response in (saved, reloaded):
            assert response.extracted.nutrition.assumptions == assumptions
            metadata = response.extracted.derivedData.nutrition
            assert metadata.assumptions == assumptions
            assert metadata.servingBasis == basis
            assert metadata.servingsUsed == servings
            assert metadata.source == "ai_estimate"
            assert metadata.model == "replacement-model"
            assert metadata.status == "current"
            assert response.extracted.nutrition.sourceServingSize is None
            assert response.extracted.nutrition.sourcePerServing is None
            if not servings:
                assert response.extracted.nutrition.perServing.calories is None

        # Recalculating again with explicit amounts and no assumptions must clear
        # both arrays, not resurrect the previous calculation's disclosure.
        payload.update(
            ingredients=[{"name": "rice", "quantity": "2", "unit": "cups"}],
            nutrition_assumptions=[],
        )
        await edit_recipe(recipe_id, RecipeEdit(**payload), db, owner)
    async with nutrition_database() as db:
        reloaded = await get_recipe(recipe_id, db, owner)
        assert reloaded.extracted.nutrition.assumptions == []
        assert reloaded.extracted.derivedData.nutrition.assumptions == []
