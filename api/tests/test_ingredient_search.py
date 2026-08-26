from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.models.recipe import Recipe
from app.routers.recipes import (
    extract_ingredient_names,
    match_ingredients,
    search_by_ingredients,
)


def recipe_with_ingredients(
    *,
    components: list[dict],
    legacy: list[dict],
    is_public: bool = True,
    moderation_status: str = "active",
    user_id: str = "recipe-owner",
) -> Recipe:
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
        user_id=user_id,
        is_public=is_public,
        moderation_status=moderation_status,
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
    def __init__(self, recipes: list[Recipe], hidden_owner_ids: set[str] | None = None):
        self.recipes = recipes
        self.hidden_owner_ids = hidden_owner_ids or set()
        self.execute_count = 0

    async def execute(self, query):
        self.execute_count += 1
        compiled_query = str(query)
        assert "recipes.is_public IS true" in compiled_query
        assert "recipes.moderation_status" in compiled_query
        assert "app_users.moderation_status" in compiled_query
        return RecipeResult(
            [
                recipe
                for recipe in self.recipes
                if (
                    recipe.is_public
                    and recipe.moderation_status == "active"
                    and recipe.user_id not in self.hidden_owner_ids
                )
            ]
        )


@pytest.mark.asyncio
async def test_signed_out_search_uses_only_public_recipes_and_scores_unique_ingredients():
    visible_recipe = recipe_with_ingredients(
        components=[
            {
                "name": "Main",
                "ingredients": [{"name": "Chicken breast"}, {"name": "Rice"}],
            }
        ],
        legacy=[{"name": "Chicken breast"}, {"name": "Rice"}],
    )
    private_recipe = recipe_with_ingredients(
        components=[{"name": "Main", "ingredients": [{"name": "Chicken"}]}],
        legacy=[],
        is_public=False,
    )
    hidden_recipe = recipe_with_ingredients(
        components=[{"name": "Main", "ingredients": [{"name": "Chicken"}]}],
        legacy=[],
        moderation_status="hidden",
    )
    hidden_owner_recipe = recipe_with_ingredients(
        components=[{"name": "Main", "ingredients": [{"name": "Chicken"}]}],
        legacy=[],
        user_id="hidden-owner",
    )
    session = RecordingSession(
        [visible_recipe, private_recipe, hidden_recipe, hidden_owner_recipe],
        hidden_owner_ids={"hidden-owner"},
    )

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


@pytest.mark.asyncio
async def test_search_returns_every_missing_ingredient_for_grocery_actions():
    ingredient_names = ["Chicken"] + [f"Ingredient {index}" for index in range(1, 13)]
    visible_recipe = recipe_with_ingredients(
        components=[
            {
                "name": "Main",
                "ingredients": [{"name": name} for name in ingredient_names],
            }
        ],
        legacy=[],
    )
    session = RecordingSession([visible_recipe])

    response = await search_by_ingredients(
        ingredients="chicken",
        include_saved=False,
        include_public=True,
        limit=20,
        db=session,
        user=None,
    )

    assert response.total == 1
    assert response.results[0].missing_ingredients == [
        f"ingredient {index}" for index in range(1, 13)
    ]
