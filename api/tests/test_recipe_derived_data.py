import pytest
from pydantic import ValidationError

from app.recipe_derived_data import (
    dependency_fingerprint,
    ensure_derived_metadata,
    invalidate_changed_inputs,
    mark_fresh,
)
from app.routers.recipes import RecipeEdit, _build_edited_extracted


def recipe(*, servings=4, ingredient="rice", nutrition=200, cost=5.0):
    return {
        "title": "Test",
        "servings": servings,
        "components": [
            {
                "name": "Main",
                "ingredients": [{"name": ingredient, "quantity": "1", "unit": "cup"}],
                "steps": ["Cook"],
            }
        ],
        "nutrition": {"perServing": {"calories": nutrition}, "total": {}},
        "totalEstimatedCost": cost,
        "tags": ["dinner"],
        "times": {"total": "20 min"},
    }


def test_fingerprint_is_stable_and_tracks_recipe_inputs():
    original = recipe()
    reordered = {**original, "components": [dict(original["components"][0])]}

    assert dependency_fingerprint(original) == dependency_fingerprint(reordered)
    assert dependency_fingerprint(original) != dependency_fingerprint(recipe(servings=6))
    assert dependency_fingerprint(original) != dependency_fingerprint(recipe(ingredient="noodles"))


def test_fingerprint_ignores_instruction_and_component_label_edits():
    original = recipe()
    relabeled = recipe()
    relabeled["components"][0]["name"] = "Sauce"
    relabeled["components"][0]["steps"] = ["Whisk well"]

    assert dependency_fingerprint(original) == dependency_fingerprint(relabeled)
    assert dependency_fingerprint(original, "times") != dependency_fingerprint(relabeled, "times")


def test_tag_and_time_metadata_stale_only_when_their_inputs_change():
    original = mark_fresh(recipe(), "tags", "times", source="ai_extraction")
    updated = recipe()
    updated["title"] = "Renamed"
    updated["components"][0]["steps"] = ["Cook slowly"]

    result = invalidate_changed_inputs(original, updated)

    assert result["derivedData"]["tags"]["status"] == "stale"
    assert result["derivedData"]["times"]["status"] == "stale"
    assert result["derivedData"]["nutrition"]["status"] == "unverified"


def test_legacy_estimates_are_labeled_unverified_not_current():
    metadata = ensure_derived_metadata(recipe())["derivedData"]

    assert metadata["nutrition"]["status"] == "unverified"
    assert metadata["cost"]["status"] == "unverified"
    assert metadata["nutrition"]["source"] == "unknown"


def test_editing_dependencies_marks_preserved_estimates_stale():
    old = mark_fresh(recipe(), "nutrition", "cost", source="ai_extraction")
    updated = recipe(servings=8)

    result = invalidate_changed_inputs(old, updated)

    assert result["nutrition"]["perServing"]["calories"] == 200
    assert result["derivedData"]["nutrition"]["status"] == "stale"
    assert result["derivedData"]["cost"]["status"] == "stale"


def test_explicit_nutrition_recalculation_marks_only_nutrition_current():
    old = mark_fresh(recipe(), "nutrition", "cost", source="ai_extraction")
    old["nutrition"]["perServing"]["fiber"] = 8
    old["nutrition"]["total"] = {"calories": 800, "fiber": 32}

    result = invalidate_changed_inputs(
        old,
        recipe(ingredient="noodles", nutrition=250),
        nutrition_recalculated=True,
    )

    assert result["derivedData"]["nutrition"]["status"] == "current"
    assert result["derivedData"]["nutrition"]["source"] == "ai_estimate"
    assert result["derivedData"]["cost"]["status"] == "stale"


def test_recipe_edit_clears_unsupported_nutrients_after_recalculation():
    old = recipe()
    old["nutrition"]["perServing"].update({"fiber": 8, "sugar": 4, "sodium": 250})
    old["nutrition"]["total"] = {"calories": 800, "fiber": 32}
    edit = RecipeEdit(
        title="Updated",
        servings=4,
        ingredients=[{"name": "rice"}],
        steps=["Cook"],
        nutrition={"calories": 210, "protein": 4, "carbs": 45, "fat": 1},
        nutrition_recalculated=True,
        nutrition_model="gpt-5.6-luna",
    )

    result = _build_edited_extracted(old, edit)

    assert result["nutrition"]["perServing"] == {
        "calories": 210,
        "protein": 4,
        "carbs": 45,
        "fat": 1,
        "fiber": None,
        "sugar": None,
        "sodium": None,
    }
    assert result["nutrition"]["total"] == {}
    assert result["derivedData"]["nutrition"]["status"] == "current"
    assert result["derivedData"]["nutrition"]["model"] == "gpt-5.6-luna"


@pytest.mark.parametrize(
    ("nutrition", "message"),
    [
        (None, "nutrition is required"),
        ({}, "calories, protein, carbs, and fat are required"),
        (
            {"calories": 200, "protein": 5, "carbs": 40},
            "calories, protein, carbs, and fat are required",
        ),
        (
            {"calories": -1, "protein": 5, "carbs": 40, "fat": 2},
            "greater than or equal to 0",
        ),
    ],
)
def test_recalculation_flag_requires_complete_replacement_nutrition(nutrition, message):
    with pytest.raises(ValidationError, match=message):
        RecipeEdit(
            title="Invalid freshness claim",
            ingredients=[{"name": "rice"}],
            steps=["Cook"],
            nutrition=nutrition,
            nutrition_recalculated=True,
        )


def test_component_aware_edit_preserves_sections_and_legacy_flat_fields():
    old = recipe()
    edit = RecipeEdit(
        title="Layered meal",
        servings=4,
        components=[
            {
                "name": "Sauce",
                "ingredients": [{"name": "soy sauce", "quantity": "2", "unit": "tbsp"}],
                "steps": ["Whisk sauce"],
                "notes": "Make ahead",
            },
            {
                "name": "Rice",
                "ingredients": [{"name": "rice", "quantity": "1", "unit": "cup"}],
                "steps": ["Steam rice"],
            },
        ],
    )

    result = _build_edited_extracted(old, edit)

    assert [component["name"] for component in result["components"]] == ["Sauce", "Rice"]
    assert result["components"][0]["notes"] == "Make ahead"
    assert [ingredient["name"] for ingredient in result["ingredients"]] == ["soy sauce", "rice"]
    assert result["steps"] == ["Whisk sauce", "Steam rice"]


def test_legacy_flat_edit_is_normalized_to_main_component():
    edit = RecipeEdit(
        title="Simple",
        ingredients=[{"name": "egg"}],
        steps=["Cook egg"],
    )

    result = _build_edited_extracted(recipe(), edit)

    assert result["components"] == [
        {
            "name": "Main",
            "ingredients": [{"name": "egg", "quantity": None, "unit": None, "notes": None}],
            "steps": ["Cook egg"],
            "notes": None,
        }
    ]
