from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.models.recipe import Recipe
from app.routers.recipes import (
    extract_ingredient_names,
    match_ingredients,
    search_by_ingredients,
)


def recipe_with_ingredients(*, components: list[dict], legacy: list[dict]) -> Recipe:
    return Recipe(
        id=uuid4(),
        source_url="https://example.com/recipe",
        source_type="website",
        extracted={
            "title": "Chicken and Rice",
            "components": components,
            "ingredients": legacy,
            "nutrition": {"perServing": {}, "total": {}},
        },
        created_at=datetime.now(UTC),
        user_id="recipe-owner",
        is_public=True,
        moderation_status="active",
    )


def test_components_are_canonical_and_legacy_ingredients_are_not_double_counted():
    recipe = recipe_with_ingredients(
        components=[
            {
                "name": "Main",
                "ingredients": [
                    {"name": "Chicken breast"},
                    {"name": "Rice"},
                    {"name": "Rice"},
                ],
            }
        ],
        legacy=[{"name": "Chicken breast"}, {"name": "Rice"}],
    )

    assert extract_ingredient_names(recipe) == ["chicken breast", "rice"]


def test_legacy_ingredients_are_used_when_components_have_no_ingredients():
    recipe = recipe_with_ingredients(
        components=[{"name": "Main", "ingredients": []}],
        legacy=[{"name": "Garlic"}, "Olive oil", {"name": "Garlic"}],
    )

    assert extract_ingredient_names(recipe) == ["garlic", "olive oil"]


def test_matching_uses_word_boundaries_and_preserves_recipe_order():
    matched, missing = match_ingredients(
        ["chicken breast", "chicken thighs", "champagne vinegar", "rice"],
        ["chicken", "ham", "rice"],
    )

    assert matched == ["chicken breast", "chicken thighs", "rice"]
    assert missing == ["champagne vinegar"]


class RecipeResult:
    def __init__(self, recipes: list[Recipe]):
        self.recipes = recipes

    def scalars(self):
        return self

    def all(self):
        return self.recipes


class RecordingSession:
    def __init__(self, recipes: list[Recipe]):
        self.recipes = recipes
        self.execute_count = 0

    async def execute(self, _query):
        self.execute_count += 1
        return RecipeResult(self.recipes)


@pytest.mark.asyncio
async def test_signed_out_search_uses_only_public_recipes_and_scores_unique_ingredients():
    recipe = recipe_with_ingredients(
        components=[
            {
                "name": "Main",
                "ingredients": [{"name": "Chicken breast"}, {"name": "Rice"}],
            }
        ],
        legacy=[{"name": "Chicken breast"}, {"name": "Rice"}],
    )
    session = RecordingSession([recipe])

    response = await search_by_ingredients(
        ingredients=" Chicken, rice, chicken ",
        include_saved=True,
        include_public=True,
        limit=20,
        db=session,
        user=None,
    )

    assert session.execute_count == 1
    assert response.query_ingredients == ["chicken", "rice"]
    assert response.total == 1
    assert response.results[0].match_count == 2
    assert response.results[0].total_ingredients == 2
    assert response.results[0].match_percentage == 100.0
    assert response.results[0].recipe.is_owner is False
