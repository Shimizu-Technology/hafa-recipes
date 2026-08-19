from types import SimpleNamespace
from uuid import UUID

import pytest

from app.routers.recipes import RecipeSharingUpdate, toggle_recipe_sharing


class FakeResult:
    def __init__(self, recipe):
        self.recipe = recipe

    def scalar_one_or_none(self):
        return self.recipe


class FakeSession:
    def __init__(self, recipe):
        self.recipe = recipe
        self.commit_count = 0

    async def execute(self, _query):
        return FakeResult(self.recipe)

    async def commit(self):
        self.commit_count += 1


@pytest.mark.asyncio
async def test_explicit_share_target_is_retry_safe():
    recipe = SimpleNamespace(user_id="owner", is_public=False)
    session = FakeSession(recipe)
    user = SimpleNamespace(id="owner")
    recipe_id = UUID("11111111-1111-4111-8111-111111111111")

    first = await toggle_recipe_sharing(
        recipe_id,
        RecipeSharingUpdate(is_public=True),
        session,
        user,
    )
    second = await toggle_recipe_sharing(
        recipe_id,
        RecipeSharingUpdate(is_public=True),
        session,
        user,
    )

    assert first["is_public"] is True
    assert second["is_public"] is True
    assert recipe.is_public is True
    assert session.commit_count == 2


@pytest.mark.asyncio
async def test_no_body_share_path_remains_compatible_with_released_clients():
    recipe = SimpleNamespace(user_id="owner", is_public=False)
    session = FakeSession(recipe)

    response = await toggle_recipe_sharing(
        UUID("11111111-1111-4111-8111-111111111111"),
        None,
        session,
        SimpleNamespace(id="owner"),
    )

    assert response["is_public"] is True
