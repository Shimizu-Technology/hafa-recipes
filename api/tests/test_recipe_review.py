from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.recipe_review import (
    apply_recipe_review,
    assess_recipe_review,
    require_recipe_publishable,
)
from app.routers.recipes import ManualComponent, RecipeEdit, _serialize_edit_components


def _recipe_data(*, quantity: str | None = "2", steps: list[str] | None = None) -> dict:
    ingredient = {"name": "rice", "quantity": quantity, "unit": "cups"}
    return {
        "title": "Red Rice",
        "components": [
            {
                "name": "Main",
                "ingredients": [ingredient],
                "steps": ["Cook the rice."] if steps is None else steps,
            }
        ],
    }


def test_imported_recipe_requires_review_even_when_it_looks_complete():
    assessment = assess_recipe_review(
        _recipe_data(),
        source_type="tiktok",
        extraction_method="whisper",
        content_revision=1,
    )

    assert assessment.state == "needs_review"
    assert assessment.evidence["contentRevision"] == 1
    assert "raw_text" not in assessment.evidence


def test_structurally_incomplete_source_can_be_saved_but_not_published():
    recipe = SimpleNamespace(
        source_type="tiktok",
        extraction_method="source-draft",
        content_revision=1,
        is_public=True,
    )

    assessment = apply_recipe_review(
        recipe,
        {"title": "Saved TikTok recipe", "components": []},
    )

    assert assessment.state == "source_incomplete"
    assert recipe.is_public is False
    assert recipe.extracted["lowConfidence"] is True
    with pytest.raises(HTTPException) as error:
        require_recipe_publishable(recipe)
    assert error.value.status_code == 409


def test_missing_quantity_is_not_rewritten_as_to_taste():
    assessment = assess_recipe_review(
        _recipe_data(quantity=None),
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )

    field = assessment.evidence["fields"][0]
    assert field["quantityStatus"] == "not_stated"
    assert assessment.evidence["assessment"]["missingQuantityCount"] == 1


def test_explicit_to_taste_is_supported_source_language():
    assessment = assess_recipe_review(
        _recipe_data(quantity="to taste"),
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )

    assert assessment.evidence["fields"][0]["quantityStatus"] == "supported"


def test_human_review_makes_complete_recipe_ready_but_not_incomplete_recipe():
    complete = assess_recipe_review(
        _recipe_data(),
        source_type="photo",
        extraction_method="ocr",
        content_revision=2,
        user_reviewed=True,
    )
    incomplete = assess_recipe_review(
        _recipe_data(steps=[]),
        source_type="photo",
        extraction_method="ocr",
        content_revision=2,
        user_reviewed=True,
    )

    assert complete.state == "ready"
    assert incomplete.state == "source_incomplete"


def test_legacy_recipe_remains_publishable_for_old_client_compatibility():
    require_recipe_publishable(SimpleNamespace(review_state=None))


def test_partial_edit_can_be_saved_without_fake_placeholder_content():
    components = _serialize_edit_components(
        RecipeEdit(
            title="Saved source",
            components=[ManualComponent(name="Main", ingredients=[], steps=[])],
        )
    )

    assert components == [
        {"name": "Main", "ingredients": [], "steps": [], "notes": None}
    ]
