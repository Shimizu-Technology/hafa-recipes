"""Privacy and classification tests for aggregate recipe correction events."""

from uuid import uuid4

from app.models.recipe import Recipe
from app.recipe_corrections import build_recipe_correction_event, measure_recipe_correction
from app.recipe_review import apply_recipe_review


def _recipe_data(*, quantity=None, title="Red Rice", step="Cook the rice.") -> dict:
    """Build canonical recipe content with controllable correction fields."""

    return {
        "title": title,
        "sourceUrl": "https://example.com/red-rice",
        "servings": 4,
        "times": {"prep": None, "cook": "20 minutes", "total": None},
        "components": [
            {
                "name": "Main",
                "ingredients": [
                    {
                        "name": "rice",
                        "quantity": quantity,
                        "unit": "cups" if quantity else None,
                        "notes": None,
                    }
                ],
                "steps": [step],
                "notes": None,
            }
        ],
        "equipment": ["pot"],
        "notes": None,
        "tags": ["local"],
        "mealTypes": ["dinner"],
    }


def _recipe() -> Recipe:
    """Build an unsaved imported recipe for correction-event unit tests."""

    return Recipe(
        id=uuid4(),
        source_url="https://example.com/red-rice",
        source_type="youtube",
        extracted={},
        extraction_method="whisper",
        user_id="stable_user",
        is_public=False,
    )


def test_measurement_counts_field_categories_without_returning_values():
    """Field-level quality signals contain counts, never recipe strings."""

    metrics = measure_recipe_correction(
        _recipe_data(),
        _recipe_data(quantity="2", title="Family Red Rice", step="Simmer the rice."),
    )

    assert metrics.quantity_change_count == 1
    assert metrics.unit_change_count == 1
    assert metrics.step_change_count == 1
    assert metrics.title_changed is True
    assert metrics.changed_field_count == 4
    assert all(
        not isinstance(value, str)
        for value in metrics.__dict__.values()
    )


def test_measurement_falls_back_to_legacy_fields_when_components_are_empty():
    """Empty canonical components must not hide corrections from legacy clients."""

    before = {
        **_recipe_data(),
        "components": [],
        "ingredients": [{"name": "rice", "quantity": None, "unit": None}],
        "steps": ["Cook the rice."],
    }
    after = {
        **before,
        "ingredients": [{"name": "rice", "quantity": "2", "unit": "cups"}],
    }

    metrics = measure_recipe_correction(before, after)

    assert metrics.quantity_change_count == 1
    assert metrics.unit_change_count == 1


def test_initial_review_correction_records_resolution_and_state_transition():
    """Correcting an unstated amount is distinguishable from later customization."""

    recipe = _recipe()
    before = _recipe_data()
    apply_recipe_review(recipe, before)
    before_state = recipe.review_state
    before_evidence = dict(recipe.extraction_evidence)

    apply_recipe_review(
        recipe,
        _recipe_data(quantity="2"),
        user_reviewed=True,
        increment_revision=True,
    )
    event = build_recipe_correction_event(
        recipe=recipe,
        user_id="stable_user",
        before_extracted=before,
        before_review_state=before_state,
        before_evidence=before_evidence,
    )

    assert event is not None
    assert event.event_kind == "review_correction"
    assert event.from_review_state == "needs_review"
    assert event.to_review_state == "ready"
    assert event.quantity_change_count == 1
    assert event.resolved_missing_quantity_count == 1
    assert event.content_revision == 2
    forbidden_names = {"extracted", "raw_text", "field_path", "before_value", "after_value"}
    assert forbidden_names.isdisjoint(event.__table__.columns.keys())


def test_review_verification_can_record_zero_content_changes():
    """A human verification is useful quality feedback even without an edit."""

    recipe = _recipe()
    before = _recipe_data(quantity="2")
    apply_recipe_review(recipe, before)
    before_state = recipe.review_state
    before_evidence = dict(recipe.extraction_evidence)
    apply_recipe_review(
        recipe,
        before,
        user_reviewed=True,
        increment_revision=True,
    )

    event = build_recipe_correction_event(
        recipe=recipe,
        user_id="stable_user",
        before_extracted=before,
        before_review_state=before_state,
        before_evidence=before_evidence,
    )

    assert event is not None
    assert event.event_kind == "review_verification"
    assert event.changed_field_count == 0
