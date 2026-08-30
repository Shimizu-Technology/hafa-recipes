from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.recipe_review import (
    apply_recipe_review,
    assess_recipe_review,
    evidence_was_user_reviewed,
    require_recipe_publishable,
    review_response_fields,
)
from app.routers.recipes import ManualComponent, RecipeEdit, _serialize_edit_components


def _recipe_data(*, quantity: str | None = "2", steps: list[str] | None = None) -> dict:
    """Build the smallest component recipe used by readiness tests."""

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
    """Model-derived imports remain unverified until a person reviews them."""

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
    """Incomplete sources remain editable and private."""

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
    """Absent evidence stays absent instead of becoming flexible language."""

    assessment = assess_recipe_review(
        _recipe_data(quantity=None),
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )

    field = assessment.evidence["fields"][0]
    assert field["quantityStatus"] == "not_stated"
    assert assessment.evidence["assessment"]["missingQuantityCount"] == 1
    assert assessment.uncertainty_count == 2


def test_each_missing_quantity_is_counted_once():
    """The aggregate reason must not double-count its individual missing fields."""

    extracted = _recipe_data(quantity=None)
    extracted["components"][0]["ingredients"].append(
        {"name": "water", "quantity": None, "unit": None}
    )
    assessment = assess_recipe_review(
        extracted,
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )

    assert assessment.evidence["assessment"]["missingQuantityCount"] == 2
    assert assessment.evidence["assessment"]["uncertaintyCount"] == 3
    assert assessment.uncertainty_count == 3


def test_serialized_null_values_are_not_treated_as_recipe_evidence():
    """Provider string sentinels must not make an incomplete recipe look complete."""

    missing_quantity = assess_recipe_review(
        _recipe_data(quantity="null"),
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )
    missing_steps = assess_recipe_review(
        _recipe_data(steps=[None, "null"]),  # type: ignore[list-item]
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )

    assert missing_quantity.evidence["assessment"]["missingQuantityCount"] == 1
    assert missing_steps.state == "source_incomplete"


def test_explicit_to_taste_is_supported_source_language():
    """Literal flexible language is preserved as supported source evidence."""

    assessment = assess_recipe_review(
        _recipe_data(quantity="to taste"),
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )

    assert assessment.evidence["fields"][0]["quantityStatus"] == "supported"


def test_structured_website_with_unstated_quantity_still_needs_review():
    """Structured markup is not exact enough when a cooking amount is absent."""

    assessment = assess_recipe_review(
        _recipe_data(quantity=None),
        source_type="website",
        extraction_method="website-jsonld",
        content_revision=1,
    )

    assert assessment.state == "needs_review"
    assert assessment.evidence["assessment"]["missingQuantityCount"] == 1


def test_structured_website_with_reported_uncertainty_still_needs_review():
    """A parser confidence warning overrides the structured-source shortcut."""

    extracted = _recipe_data()
    extracted["lowConfidence"] = True
    extracted["confidenceWarning"] = "Ambiguous ingredient text"
    assessment = assess_recipe_review(
        extracted,
        source_type="website",
        extraction_method="website-jsonld",
        content_revision=1,
    )

    assert assessment.state == "needs_review"


def test_ready_state_alone_does_not_claim_a_person_reviewed_the_recipe():
    """Preserve the distinction between exact structured data and human review."""

    structured = assess_recipe_review(
        _recipe_data(),
        source_type="website",
        extraction_method="website-jsonld",
        content_revision=1,
    )
    reviewed = assess_recipe_review(
        _recipe_data(),
        source_type="tiktok",
        extraction_method="whisper",
        content_revision=1,
        user_reviewed=True,
    )

    assert structured.state == "ready"
    assert evidence_was_user_reviewed(structured.evidence) is False
    assert reviewed.state == "ready"
    assert evidence_was_user_reviewed(reviewed.evidence) is True


def test_review_response_contract_matches_evidence_schema_and_privacy_boundary():
    """Owner responses expose the documented evidence envelope; public ones do not."""

    assessment = assess_recipe_review(
        _recipe_data(quantity=None),
        source_type="tiktok",
        extraction_method="whisper",
        content_revision=3,
    )
    recipe = SimpleNamespace(
        review_state=assessment.state,
        extraction_evidence=assessment.evidence,
        content_revision=3,
    )

    owner_fields = review_response_fields(recipe, include_evidence=True)
    public_fields = review_response_fields(recipe, include_evidence=False)

    assert owner_fields == {
        "review_state": "needs_review",
        "review_summary": "Needs review — compare the draft with the original before cooking.",
        "uncertainty_count": 2,
        "extraction_evidence": assessment.evidence,
        "content_revision": 3,
    }
    assert assessment.evidence["fields"][0] == {
        "path": "components.0.ingredients.0",
        "status": "not_stated",
        "quantityStatus": "not_stated",
    }
    assert public_fields["extraction_evidence"] is None


def test_human_review_makes_complete_recipe_ready_but_not_incomplete_recipe():
    """Human review cannot replace missing cooking-critical structure."""

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
    """Historical rows outside the new contract keep released-client behavior."""

    require_recipe_publishable(SimpleNamespace(review_state=None))


def test_partial_edit_can_be_saved_without_fake_placeholder_content():
    """Editable source drafts may keep empty components without filler content."""

    components = _serialize_edit_components(
        RecipeEdit(
            title="Saved source",
            components=[ManualComponent(name="Main", ingredients=[], steps=[])],
        )
    )

    assert components == [
        {"name": "Main", "ingredients": [], "steps": [], "notes": None}
    ]
