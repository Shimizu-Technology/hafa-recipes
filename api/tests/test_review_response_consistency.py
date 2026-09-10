"""Legacy review projection stays consistent across consumer response surfaces."""

from copy import deepcopy
from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.models.meal_plan import MealPlanEntry
from app.models.recipe import ExtractionJob, Recipe
from app.recipe_review import review_response_fields
from app.routers.collections import get_collection_recipes
from app.routers.extract import _job_status_response
from app.routers.meal_plans import get_day_plan, get_recipe_plan_entries, get_week_plan
from app.routers.recipes import recipe_to_detail_response, recipe_to_list_item


def _legacy_recipe(*, uncertain):
    return Recipe(
        id=uuid4(), user_id="owner", source_type="youtube", extraction_method="whisper",
        source_url="https://example.test/recipe", is_public=True, content_revision=4,
        has_audio_transcript=True, created_at=datetime.now(UTC), moderation_status="active",
        extracted={
            "title": "Rice", "sourceUrl": "https://example.test/recipe",
            "components": [{"name": "Main", "ingredients": [
                {"name": "rice", "quantity": "1", "unit": "cup"},
            ], "steps": ["Cook the rice."]}],
        },
        review_state="ready" if uncertain else "needs_review",
        extraction_evidence={
            "version": 2, "fields": [], "assessment": {
                "reasons": ["The private family note omitted the oven temperature."] if uncertain else [
                    "The imported details have not been fully verified by a person yet.",
                ],
                "uncertaintyCount": 0 if uncertain else 1,
            },
        },
    )


@pytest.mark.parametrize("uncertain", [False, True])
def test_owner_public_list_and_job_agree_without_mutating_recipe_or_exposing_evidence(uncertain):
    recipe = _legacy_recipe(uncertain=uncertain)
    stored_state = recipe.review_state
    stored_evidence = deepcopy(recipe.extraction_evidence)
    expected_state = "needs_review" if uncertain else "ready"
    owner = recipe_to_detail_response(recipe, "owner")
    public = recipe_to_detail_response(recipe, None)
    owner_list = recipe_to_list_item(recipe, "owner")
    public_list = recipe_to_list_item(recipe, None)
    for response in (owner, public, owner_list, public_list):
        assert response.review_state == expected_state
        assert response.uncertainty_count == int(uncertain)
        assert response.review_summary == owner.review_summary
    assert owner.extraction_evidence is not None
    assert public.extraction_evidence is None
    assert "private family note" not in public.model_dump_json()
    assert "private family note" not in public_list.model_dump_json()
    now = datetime.now(UTC)
    job = ExtractionJob(
        id=uuid4(), url=recipe.source_url, job_kind="extract", location="Guam", notes="",
        requested_is_public=True, status="completed", progress=100, current_step="complete",
        message="Saved", recipe_id=recipe.id, attempt_count=1, max_attempts=3,
        created_at=now, updated_at=now, completed_at=now,
    )
    inbox = _job_status_response(job, recipe)
    assert inbox.review_state == expected_state
    assert inbox.review_summary == owner.review_summary
    assert recipe.review_state == stored_state
    assert recipe.extraction_evidence == stored_evidence
    assert recipe.is_public is True
    assert recipe.content_revision == 4


@pytest.mark.parametrize("stored_state", ["ready", "needs_review", "source_incomplete"])
def test_read_projection_cannot_change_persisted_structural_category(stored_state):
    recipe = _legacy_recipe(uncertain=False)
    recipe.review_state = stored_state
    recipe.is_public = stored_state != "source_incomplete"
    if stored_state != "source_incomplete":
        recipe.extracted["components"][0]["steps"] = []
    # Deliberately inconsistent historical data: require a normal save to
    # reconcile structural classification and visibility together.
    for include_evidence in (True, False):
        response = review_response_fields(recipe, include_evidence=include_evidence)
        assert response["review_state"] == stored_state
    assert recipe.is_public is (stored_state != "source_incomplete")


@pytest.mark.asyncio
@pytest.mark.parametrize("uncertain", [False, True])
async def test_collection_and_meal_plans_use_same_projection(uncertain):
    recipe = _legacy_recipe(uncertain=uncertain)
    expected = "needs_review" if uncertain else "ready"
    db = AsyncMock()
    db.execute.side_effect = [
        SimpleNamespace(scalar_one_or_none=lambda: object()),
        SimpleNamespace(all=lambda: [(recipe, datetime.now(UTC))]),
    ]
    collection = await get_collection_recipes(str(uuid4()), SimpleNamespace(id="owner"), db)
    assert collection[0].review_state == expected
    entry = MealPlanEntry(
        id=uuid4(), user_id="owner", date=date.today(), meal_type="dinner",
        recipe_id=recipe.id, recipe_title="Rice", created_at=datetime.now(UTC),
    )
    db = AsyncMock()
    db.execute.return_value = SimpleNamespace(all=lambda: [(entry, recipe)])
    day = await get_day_plan(date.today(), db, SimpleNamespace(id="owner"))
    assert day.dinner[0].recipe_review_state == expected
    week = await get_week_plan(date.today(), db, SimpleNamespace(id="owner"))
    today = next(day for day in week.days if day.date == date.today())
    assert today.dinner[0].recipe_review_state == expected
    relationships = await get_recipe_plan_entries(recipe.id, date.today(), 50, db, SimpleNamespace(id="owner"))
    assert relationships[0].recipe_review_state == expected
