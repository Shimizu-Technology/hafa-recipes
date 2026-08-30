"""Privacy-minimized quality telemetry for user recipe edits."""

from __future__ import annotations

from dataclasses import dataclass
from itertools import zip_longest

from app.models.recipe import RecipeCorrectionEvent


@dataclass(frozen=True)
class CorrectionMetrics:
    """Counts of changed recipe fields without retaining their values."""

    changed_field_count: int
    ingredient_name_change_count: int
    quantity_change_count: int
    unit_change_count: int
    ingredient_note_change_count: int
    step_change_count: int
    time_change_count: int
    title_changed: bool
    servings_changed: bool
    other_change_count: int


def _components(extracted: dict) -> list[dict]:
    """Return component-shaped content for current and legacy recipe JSON."""

    components = extracted.get("components")
    if isinstance(components, list) and components:
        return [value for value in components if isinstance(value, dict)]
    return [
        {
            "name": "Main",
            "ingredients": extracted.get("ingredients") or [],
            "steps": extracted.get("steps") or [],
            "notes": None,
        }
    ]


def _sequence_change_count(before: object, after: object) -> int:
    """Count positional sequence changes without returning either value."""

    old_values = before if isinstance(before, list) else []
    new_values = after if isinstance(after, list) else []
    return sum(
        old_value != new_value
        for old_value, new_value in zip_longest(old_values, new_values)
    )


def measure_recipe_correction(before: dict, after: dict) -> CorrectionMetrics:
    """Measure an edit by field category while discarding recipe content."""

    ingredient_name_changes = 0
    quantity_changes = 0
    unit_changes = 0
    ingredient_note_changes = 0
    step_changes = 0
    other_changes = 0

    for old_component, new_component in zip_longest(
        _components(before),
        _components(after),
        fillvalue={},
    ):
        old_component = old_component if isinstance(old_component, dict) else {}
        new_component = new_component if isinstance(new_component, dict) else {}
        other_changes += int(old_component.get("name") != new_component.get("name"))
        other_changes += int(old_component.get("notes") != new_component.get("notes"))

        old_ingredients = old_component.get("ingredients") or []
        new_ingredients = new_component.get("ingredients") or []
        for old_ingredient, new_ingredient in zip_longest(
            old_ingredients,
            new_ingredients,
            fillvalue={},
        ):
            old_ingredient = old_ingredient if isinstance(old_ingredient, dict) else {}
            new_ingredient = new_ingredient if isinstance(new_ingredient, dict) else {}
            ingredient_name_changes += int(
                old_ingredient.get("name") != new_ingredient.get("name")
            )
            quantity_changes += int(
                old_ingredient.get("quantity") != new_ingredient.get("quantity")
            )
            unit_changes += int(
                old_ingredient.get("unit") != new_ingredient.get("unit")
            )
            ingredient_note_changes += int(
                old_ingredient.get("notes") != new_ingredient.get("notes")
            )

        step_changes += _sequence_change_count(
            old_component.get("steps"),
            new_component.get("steps"),
        )

    old_times = before.get("times") if isinstance(before.get("times"), dict) else {}
    new_times = after.get("times") if isinstance(after.get("times"), dict) else {}
    time_changes = sum(
        old_times.get(key) != new_times.get(key)
        for key in ("prep", "cook", "total")
    )
    title_changed = before.get("title") != after.get("title")
    servings_changed = before.get("servings") != after.get("servings")
    other_changes += int(before.get("notes") != after.get("notes"))
    other_changes += _sequence_change_count(before.get("tags"), after.get("tags"))
    other_changes += _sequence_change_count(
        before.get("equipment"),
        after.get("equipment"),
    )
    other_changes += _sequence_change_count(
        before.get("mealTypes"),
        after.get("mealTypes"),
    )

    changed_field_count = (
        ingredient_name_changes
        + quantity_changes
        + unit_changes
        + ingredient_note_changes
        + step_changes
        + time_changes
        + int(title_changed)
        + int(servings_changed)
        + other_changes
    )
    return CorrectionMetrics(
        changed_field_count=changed_field_count,
        ingredient_name_change_count=ingredient_name_changes,
        quantity_change_count=quantity_changes,
        unit_change_count=unit_changes,
        ingredient_note_change_count=ingredient_note_changes,
        step_change_count=step_changes,
        time_change_count=time_changes,
        title_changed=title_changed,
        servings_changed=servings_changed,
        other_change_count=other_changes,
    )


def _missing_quantity_count(evidence: object) -> int:
    """Read only the aggregate missing-amount count from evidence."""

    if not isinstance(evidence, dict):
        return 0
    assessment = evidence.get("assessment")
    if not isinstance(assessment, dict):
        return 0
    value = assessment.get("missingQuantityCount")
    return max(0, value) if isinstance(value, int) else 0


def build_recipe_correction_event(
    *,
    recipe,
    user_id: str,
    before_extracted: dict,
    before_review_state: str | None,
    before_evidence: dict | None,
) -> RecipeCorrectionEvent | None:
    """Build one transactional aggregate event after review has been reapplied."""

    after_extracted = recipe.extracted if isinstance(recipe.extracted, dict) else {}
    metrics = measure_recipe_correction(before_extracted, after_extracted)
    after_review_state = getattr(recipe, "review_state", None)
    state_changed = before_review_state != after_review_state
    if metrics.changed_field_count == 0 and not state_changed:
        return None

    was_under_review = before_review_state in {"source_incomplete", "needs_review"}
    event_kind = (
        "review_verification"
        if was_under_review and metrics.changed_field_count == 0
        else "review_correction"
        if was_under_review
        else "customization"
    )
    before_missing = _missing_quantity_count(before_evidence)
    after_missing = _missing_quantity_count(getattr(recipe, "extraction_evidence", None))
    return RecipeCorrectionEvent(
        recipe_id=recipe.id,
        user_id=user_id,
        event_kind=event_kind,
        source_type=recipe.source_type,
        extraction_method=recipe.extraction_method,
        from_review_state=before_review_state,
        to_review_state=after_review_state,
        content_revision=int(recipe.content_revision or 1),
        resolved_missing_quantity_count=max(0, before_missing - after_missing),
        **metrics.__dict__,
    )
