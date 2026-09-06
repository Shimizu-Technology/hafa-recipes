import importlib
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.config import get_settings
from app.public_identity import public_contributor_id, visible_recipe_user_id

if TYPE_CHECKING:
    from app.models.recipe import Recipe


def _load_recipe_routers(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@example.com/db")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    get_settings.cache_clear()

    import app.routers.extract as extract
    import app.routers.recipes as recipes

    return importlib.reload(extract), importlib.reload(recipes)


def _public_recipe() -> "Recipe":
    # Import only after _load_recipe_routers has installed isolated test settings.
    from app.models.recipe import Recipe

    return Recipe(
        id=uuid4(),
        source_url="https://example.com/recipe",
        source_type="website",
        raw_text="private transcript and extraction context",
        extracted={
            "title": "Red Rice",
            "sourceUrl": "https://example.com/recipe",
            "components": [],
            "nutrition": {"perServing": {}, "total": {}},
        },
        created_at=datetime.now(UTC),
        user_id="user_private_clerk_subject",
        extractor_display_name="Test Cook",
        is_public=True,
        has_audio_transcript=False,
    )


def test_public_contributor_id_is_stable_and_opaque():
    first = public_contributor_id("user_private_clerk_subject")
    second = public_contributor_id("user_private_clerk_subject")

    assert first == second
    assert first.startswith("chef_")
    assert "user_private_clerk_subject" not in first
    assert public_contributor_id("user_other_subject") != first


def test_visible_recipe_user_id_preserves_only_the_viewers_own_subject():
    owner_id = "user_private_clerk_subject"

    assert visible_recipe_user_id(owner_id, owner_id) == owner_id
    assert visible_recipe_user_id(owner_id, None) == public_contributor_id(owner_id)
    assert visible_recipe_user_id(owner_id, "user_someone_else") == public_contributor_id(owner_id)


def test_public_detail_redacts_source_text_and_internal_subject(monkeypatch):
    _, recipes = _load_recipe_routers(monkeypatch)
    recipe = _public_recipe()

    response = recipes.recipe_to_detail_response(recipe, viewer_user_id=None)

    assert response.raw_text is None
    assert response.user_id == public_contributor_id(recipe.user_id)
    assert response.contributor_id == public_contributor_id(recipe.user_id)
    assert response.is_owner is False


def test_owner_detail_keeps_owner_debug_fields(monkeypatch):
    _, recipes = _load_recipe_routers(monkeypatch)
    recipe = _public_recipe()

    response = recipes.recipe_to_detail_response(recipe, viewer_user_id=recipe.user_id)

    assert response.raw_text == recipe.raw_text
    assert response.user_id == recipe.user_id
    assert response.contributor_id == public_contributor_id(recipe.user_id)
    assert response.is_owner is True


def test_recipe_responses_choose_list_and_hero_thumbnail_variants(monkeypatch):
    _, recipes = _load_recipe_routers(monkeypatch)
    recipe = _public_recipe()
    version_root = f"https://media.example/thumbnails/{recipe.id}/{'a' * 64}"
    recipe.thumbnail_url = f"{version_root}/hero.webp"

    list_item = recipes.recipe_to_list_item(recipe, viewer_user_id=recipe.user_id)
    detail = recipes.recipe_to_detail_response(recipe, viewer_user_id=recipe.user_id)

    assert list_item.thumbnail_url == f"{version_root}/list.webp"
    assert detail.thumbnail_url == f"{version_root}/hero.webp"


def test_recipe_responses_normalize_legacy_null_audio_state(monkeypatch):
    _, recipes = _load_recipe_routers(monkeypatch)
    recipe = _public_recipe()
    recipe.has_audio_transcript = None

    list_item = recipes.recipe_to_list_item(recipe, viewer_user_id=None)
    detail = recipes.recipe_to_detail_response(recipe, viewer_user_id=None)

    assert list_item.has_audio_transcript is False
    assert detail.has_audio_transcript is False


def test_list_item_exposes_batched_saved_state(monkeypatch):
    _, recipes = _load_recipe_routers(monkeypatch)
    recipe = _public_recipe()

    unsaved = recipes.recipe_to_list_item(recipe, viewer_user_id="viewer")
    saved = recipes.recipe_to_list_item(
        recipe,
        viewer_user_id="viewer",
        is_saved=True,
    )

    assert unsaved.is_saved is None
    assert saved.is_saved is True


@pytest.mark.asyncio
async def test_saved_recipe_ids_are_loaded_once_for_the_page(monkeypatch):
    _, recipes = _load_recipe_routers(monkeypatch)
    first = _public_recipe()
    second = _public_recipe()

    class ScalarResult:
        def scalars(self):
            return self

        def all(self):
            return [second.id]

    class RecordingSession:
        def __init__(self):
            self.statements = []

        async def execute(self, statement):
            self.statements.append(statement)
            return ScalarResult()

    db = RecordingSession()
    saved_ids = await recipes.saved_recipe_ids_for_viewer(
        db,
        "stable_app_user_id",
        [first, second],
    )

    assert saved_ids == {second.id}
    assert len(db.statements) == 1


@pytest.mark.asyncio
async def test_guest_saved_state_does_not_query_the_database(monkeypatch):
    _, recipes = _load_recipe_routers(monkeypatch)

    class FailingSession:
        async def execute(self, statement):
            raise AssertionError(f"guest lookup must not execute {statement}")

    assert await recipes.saved_recipe_ids_for_viewer(
        FailingSession(),
        None,
        [_public_recipe()],
    ) == set()


def test_detail_response_normalizes_legacy_ingredient_quantities(monkeypatch):
    _, recipes = _load_recipe_routers(monkeypatch)
    recipe = _public_recipe()
    ingredients = [
        {"name": "Chicken", "quantity": 2, "unit": "lb"},
        {"name": "Water", "quantity": 0, "unit": "cups"},
        {"name": "Oil", "quantity": False, "unit": "tsp"},
        {"name": "Sugar", "quantity": "   ", "unit": "tsp"},
        {"name": "Salt", "quantity": " null ", "unit": "tsp"},
        {"name": "Pepper", "quantity": {"unexpected": True}, "unit": None},
    ]
    recipe.extracted["components"] = [
        {"name": "Main", "ingredients": ingredients, "steps": []}
    ]
    recipe.extracted["ingredients"] = ingredients

    response = recipes.recipe_to_detail_response(recipe, viewer_user_id=recipe.user_id)

    component_quantities = [
        ingredient.quantity
        for ingredient in response.extracted.components[0].ingredients
    ]
    assert component_quantities == ["2", "0", None, None, None, None]
    assert [ingredient.quantity for ingredient in response.extracted.ingredients] == [
        "2",
        "0",
        None,
        None,
        None,
        None,
    ]
    assert [ingredient["quantity"] for ingredient in recipe.extracted["ingredients"]] == [
        2,
        0,
        False,
        "   ",
        " null ",
        {"unexpected": True},
    ]


def test_recipe_creation_defaults_are_private(monkeypatch):
    extract, recipes = _load_recipe_routers(monkeypatch)

    assert extract.ExtractRequest.model_fields["is_public"].default is False
    assert recipes.ManualRecipeCreate.model_fields["is_public"].default is False
    assert recipes.OCRRecipeCreate.model_fields["is_public"].default is False


def test_idempotency_keys_are_payload_scoped(monkeypatch):
    extract, _ = _load_recipe_routers(monkeypatch)
    from app.models.recipe import ExtractionJob

    job = ExtractionJob(
        id=uuid4(),
        url="https://example.com/recipe",
        user_id="user_test",
        location="Guam",
        notes="family version",
        status="queued",
        job_kind="extract",
        requested_is_public=False,
    )

    extract._validate_idempotent_job(
        job,
        job_kind="extract",
        url=job.url,
        location="Guam",
        notes="family version",
        is_public=False,
    )

    with pytest.raises(HTTPException) as conflict:
        extract._validate_idempotent_job(
            job,
            job_kind="extract",
            url="https://example.com/different",
            location="Guam",
            notes="family version",
            is_public=False,
        )
    assert conflict.value.status_code == 409


def test_blank_idempotency_key_is_rejected(monkeypatch):
    extract, _ = _load_recipe_routers(monkeypatch)

    with pytest.raises(HTTPException) as invalid:
        extract._normalized_idempotency_key("   ")
    assert invalid.value.status_code == 400


def test_active_job_deduplication_rejects_changed_options(monkeypatch):
    extract, _ = _load_recipe_routers(monkeypatch)
    from app.models.recipe import ExtractionJob

    job = ExtractionJob(
        id=uuid4(),
        url="https://example.com/recipe",
        user_id="user_test",
        location="Guam",
        notes="original",
        status="processing",
        job_kind="extract",
        requested_is_public=False,
    )

    with pytest.raises(HTTPException) as conflict:
        extract._require_matching_active_job(
            job,
            job_kind="extract",
            url=job.url,
            location="Guam",
            notes="changed",
            is_public=True,
        )
    assert conflict.value.status_code == 409
    assert "different options" in conflict.value.detail


def test_active_extraction_matching_includes_recipe_attribution(monkeypatch):
    extract, _ = _load_recipe_routers(monkeypatch)
    from app.models.recipe import ExtractionJob

    job = ExtractionJob(
        id=uuid4(),
        url="https://example.com/recipe",
        user_id="user_test",
        location="Guam",
        notes="",
        status="processing",
        job_kind="extract",
        requested_is_public=False,
        requested_display_name="Old Name",
    )

    with pytest.raises(HTTPException) as conflict:
        extract._require_matching_active_job(
            job,
            job_kind="extract",
            url=job.url,
            location="Guam",
            notes="",
            is_public=False,
            display_name="New Name",
        )
    assert conflict.value.status_code == 409
