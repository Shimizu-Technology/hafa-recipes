from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.models.identity import AppUser
from app.publishing import PUBLISHING_DISCLOSURE_VERSION
from app.routers.recipes import RecipeSharingUpdate, toggle_recipe_sharing


class FakeResult:
    def __init__(self, recipe):
        self.recipe = recipe

    def scalar_one_or_none(self):
        return self.recipe


class FakeSession:
    def __init__(self, recipe, accepted_version=PUBLISHING_DISCLOSURE_VERSION):
        self.recipe = recipe
        self.app_user = AppUser(
            id=recipe.user_id,
            publishing_disclosure_version=accepted_version,
        )
        self.commit_count = 0

    async def execute(self, query):
        entity = query.column_descriptions[0].get("entity")
        return FakeResult(self.app_user if entity is AppUser else self.recipe)

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


@pytest.mark.asyncio
async def test_share_rejects_an_account_without_current_disclosure_acceptance():
    recipe = SimpleNamespace(user_id="owner", is_public=False)
    session = FakeSession(recipe, accepted_version=PUBLISHING_DISCLOSURE_VERSION - 1)

    with pytest.raises(HTTPException) as error:
        await toggle_recipe_sharing(
            UUID("11111111-1111-4111-8111-111111111111"),
            RecipeSharingUpdate(is_public=True),
            session,
            SimpleNamespace(id="owner"),
        )

    assert error.value.status_code == 409
    assert recipe.is_public is False
    assert session.commit_count == 0
