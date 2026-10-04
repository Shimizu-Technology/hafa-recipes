"""Meaningful completeness, source preservation and recoverable import contracts."""

from copy import deepcopy
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.models.schemas import NutritionValues, RecipeExtracted
from app.recipe_derived_data import ensure_derived_metadata, mark_fresh
from app.routers.chat import EstimateNutritionRequest, estimate_nutrition
from app.routers.recipes import RecipeEdit, _build_edited_extracted
from app.services import nutrition as service
from app.services.website import WebsiteService

TOTAL = {
    "calories": 800,
    "protein": 40.5,
    "carbs": 100.25,
    "fat": 23.5,
    "fiber": 4.5,
    "sugar": 2.0,
    "sodium": 123.5,
}


def recipe(servings=4):
    return {
        "title": "Rice",
        "sourceUrl": "https://example.com/rice",
        "servings": servings,
        "components": [
            {
                "name": "Rice",
                "ingredients": [{"name": "rice", "quantity": "1", "unit": "cup"}],
                "steps": ["Cook rice"],
            }
        ],
        "nutrition": {"perServing": {}, "total": {}},
    }


@pytest.fixture
async def fake_calculator(monkeypatch):
    calls = []

    async def calculate(extracted, **kwargs):
        calls.append(deepcopy(extracted))
        return TOTAL, [], "test-model"

    monkeypatch.setattr(service, "calculate_totals", calculate)
    return calls


async def test_missing_nutrition_is_estimated_automatically(fake_calculator):
    result = await service.enrich_nutrition(recipe())
    assert result["nutrition"]["perServing"] == {
        "calories": 200,
        "protein": 10.12,
        "carbs": 25.06,
        "fat": 5.88,
        "fiber": 1.12,
        "sugar": 0.5,
        "sodium": 30.88,
    }
    assert result["derivedData"]["nutrition"]["status"] == "current"
    assert result["derivedData"]["nutrition"]["model"] == "test-model"
    assert len(fake_calculator) == 1


async def test_unknown_servings_show_whole_recipe_without_inventing_source_facts(fake_calculator):
    original = recipe(None)
    result = await service.enrich_nutrition(original)
    assert result["servings"] is None
    assert result["nutrition"]["perServing"] == {}
    assert result["nutrition"]["total"] == TOTAL
    assert result["nutrition"]["servingBasis"] == "whole_recipe"
    assert result["nutrition"]["servingsUsed"] is None
    assert RecipeExtracted.model_validate(result).nutrition.total.protein == 40.5
    assert original["nutrition"] == {"perServing": {}, "total": {}}


async def test_source_partial_values_are_preserved(fake_calculator):
    original = recipe()
    original["nutrition"]["perServing"] = {"calories": 150, "protein": 0.5}
    result = await service.enrich_nutrition(original, preserve_source=True)
    assert result["nutrition"]["perServing"]["calories"] == 150
    assert result["nutrition"]["perServing"]["protein"] == 0.5
    assert result["nutrition"]["total"]["calories"] == 600
    assert result["nutrition"]["total"]["protein"] == 2
    assert result["derivedData"]["nutrition"]["source"] == "source_and_ai_estimate"


async def test_complete_source_nutrition_uses_its_source_serving_basis(fake_calculator):
    value = recipe(None)
    value["nutrition"]["perServing"] = {"calories": 0, "protein": 0, "carbs": 0, "fat": 0}
    result = await service.enrich_nutrition(value, preserve_source=True)
    assert result["nutrition"]["servingBasis"] == "source"
    assert result["nutrition"]["total"] == {}
    assert result["nutrition"]["perServing"]["calories"] == 0
    assert fake_calculator == []


async def test_failure_retains_recipe_and_partial_values_with_retry_reason(monkeypatch):
    async def fail(*args, **kwargs):
        raise service.NutritionUnavailable("provider_unavailable", "Try again")

    monkeypatch.setattr(service, "calculate_totals", fail)
    value = recipe()
    value["nutrition"]["perServing"] = {"calories": 150}
    result = await service.enrich_nutrition(value)
    assert result["components"] == value["components"]
    assert result["nutrition"]["perServing"]["calories"] == 150
    assert result["derivedData"]["nutrition"]["status"] == "unavailable"
    assert result["derivedData"]["nutrition"]["reason"] == "Try again"
    with pytest.raises(service.NutritionUnavailable):
        await service.enrich_nutrition(value, raise_on_failure=True)


@pytest.mark.parametrize(
    "bad",
    [
        {},
        {"calories": 200},
        {"calories": 200, "protein": -1, "carbs": 1, "fat": 1},
        {"calories": 200, "protein": float("nan"), "carbs": 1, "fat": 1},
        {"calories": 200, "protein": float("inf"), "carbs": 1, "fat": 1},
        {"calories": 200, "protein": True, "carbs": 1, "fat": 1},
    ],
)
def test_invalid_provider_values_cannot_become_zero_success(bad):
    with pytest.raises(ValidationError):
        service.Calculation.model_validate({"total": bad, "assumptions": []})


def test_zero_macros_and_decimals_are_valid():
    parsed = service.Calculation.model_validate({"total": TOTAL, "assumptions": []})
    assert parsed.total.protein == 40.5
    assert service.complete_values({"calories": 0, "protein": 0, "carbs": 0, "fat": 0})
    with pytest.raises(ValidationError):
        NutritionValues(protein=float("inf"))


def test_partial_nutrition_is_not_marked_current():
    value = recipe()
    value["nutrition"]["perServing"] = {"calories": 200}
    assert (
        mark_fresh(value, "nutrition", source="ai_extraction")["derivedData"]["nutrition"]["status"]
        == "unavailable"
    )
    value["derivedData"] = {"nutrition": {"status": "current"}}
    assert ensure_derived_metadata(value)["derivedData"]["nutrition"]["status"] == "unavailable"


def test_website_parses_decimal_zero_thousands_and_sodium_units():
    result = WebsiteService._convert_jsonld_to_recipe(
        {
            "name": "Rice",
            "recipeIngredient": ["1 cup rice"],
            "recipeInstructions": ["Cook rice"],
            "nutrition": {
                "calories": "1,200 kcal",
                "proteinContent": "0.5 g",
                "carbohydrateContent": "0 g",
                "fatContent": "2.5 g",
                "sodiumContent": "0.2 g",
                "fiberContent": "250 mg",
            },
        },
        "https://example.com/rice",
        "Guam",
        "",
        None,
    )
    assert result["nutrition"]["perServing"] == {
        "calories": 1200,
        "protein": 0.5,
        "carbs": 0,
        "fat": 2.5,
        "sodium": 200,
        "fiber": 0.25,
    }


async def test_legacy_unsaved_estimate_delegates_and_supports_unknown_servings(fake_calculator):
    response = await estimate_nutrition(
        EstimateNutritionRequest(ingredients=["1 cup rice"], servings=None),
        SimpleNamespace(id="owner"),
    )
    assert response.nutrition == {}
    assert response.total["protein"] == 40.5
    assert response.servingBasis == "whole_recipe"
    assert fake_calculator[0]["ingredients"][0]["quantity"] == "1"


def test_unsaved_total_estimate_survives_whole_recipe_edit():
    edit = RecipeEdit(
        title="Rice",
        servings=None,
        ingredients=[{"name": "rice"}],
        steps=["Cook"],
        nutrition_total=TOTAL,
        nutrition_recalculated=True,
        nutrition_serving_basis="whole_recipe",
        nutrition_assumptions=["1 cup rice"],
        nutrition_model="test-model",
    )
    result = _build_edited_extracted(recipe(), edit)
    assert result["nutrition"]["total"] == TOTAL
    assert result["nutrition"]["perServing"] == {}
    assert result["derivedData"]["nutrition"]["status"] == "current"
    assert result["nutrition"]["assumptions"] == ["1 cup rice"]


async def test_incomplete_recipe_is_not_guessed():
    with pytest.raises(service.NutritionUnavailable, match="Complete the ingredient list"):
        await service.calculate_totals({**recipe(), "sourceIncomplete": True})


def test_legacy_flat_ingredients_participate_in_nutrition_fingerprint():
    before = {"ingredients": [{"name": "rice", "quantity": "1"}], "servings": 4}
    after = {"ingredients": [{"name": "rice", "quantity": "2"}], "servings": 4}
    assert service.nutrition_fingerprint(before) != service.nutrition_fingerprint(after)


def test_batch_yield_is_not_mistaken_for_servings_and_source_portion_is_preserved():
    source = {
        "name": "Cookies",
        "recipeIngredient": ["1 cup flour"],
        "recipeInstructions": ["Bake"],
        "recipeYield": "24 cookies",
        "nutrition": {"calories": "100 kcal", "servingSize": "1 cookie"},
    }
    result = WebsiteService._convert_jsonld_to_recipe(
        source, "https://example.com/cookies", "Guam", "", None
    )
    assert result["servings"] is None
    assert result["nutrition"]["sourceServingSize"] == "1 cookie"
    result = WebsiteService._convert_jsonld_to_recipe(
        {**source, "recipeYield": ["24 cookies", "8 servings"]},
        "https://example.com/cookies",
        "Guam",
        "",
        None,
    )
    assert result["servings"] == 8


@pytest.mark.parametrize(
    "content",
    [
        "{}",
        '{"total": {"calories": 200}, "assumptions": []}',
        '{"total": {"calories": 200, "protein": -1, "carbs": 1, "fat": 1}, "assumptions": []}',
        None,
    ],
)
async def test_provider_response_failures_leave_import_saved(monkeypatch, content):
    from contextlib import asynccontextmanager
    from unittest.mock import AsyncMock

    settings = service.get_settings().model_copy(update={"allow_paid_ai_in_development": True})
    monkeypatch.setattr(service, "get_settings", lambda: settings)

    class Tracker:
        model = "test-model"

        def __init__(self, **kwargs):
            self.failed = False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def fail(self, *args):
            self.failed = True

        def succeed(self, *args):
            pass

    monkeypatch.setattr(service, "AIInvocationTracker", Tracker)

    @asynccontextmanager
    async def limit(**kwargs):
        yield

    monkeypatch.setattr(service.ai_rate_limiter, "limit", limit)
    create = AsyncMock(
        return_value=SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
        )
    )

    class Client:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(service, "AsyncOpenAI", Client)
    original = recipe()
    result = await service.enrich_nutrition(original)
    assert result["components"] == original["components"]
    assert result["derivedData"]["nutrition"]["status"] == "unavailable"
    assert result["derivedData"]["nutrition"]["errorCode"] == "invalid_nutrition"
    assert result["nutrition"]["perServing"] == {}
    assert create.await_args.kwargs["response_format"]["json_schema"]["strict"] is True


@pytest.mark.parametrize(
    "action", ["save", "concurrent_edit", "failure", "not_owner", "revision_mismatch"]
)
async def test_owner_refresh_changes_nutrition_only_and_protects_current_content(
    monkeypatch, action
):
    from unittest.mock import AsyncMock
    from uuid import uuid4

    from fastapi import HTTPException

    from app.models.recipe import Recipe
    from app.routers import recipes

    row = Recipe(
        id=uuid4(),
        user_id="owner",
        content_revision=3,
        extracted=recipe(),
        extraction_method="whisper",
    )
    before = deepcopy(row.extracted)
    db = AsyncMock()
    db.execute.return_value = SimpleNamespace(scalar_one_or_none=lambda: row)
    user = SimpleNamespace(id="other" if action == "not_owner" else "owner")
    request = recipes.NutritionRefreshRequest(
        expected_content_revision=2 if action == "revision_mismatch" else 3
    )
    version = AsyncMock()
    monkeypatch.setattr(recipes, "create_recipe_version", version)
    monkeypatch.setattr(recipes, "recipe_to_detail_response", lambda row, user_id: row)

    async def calculate(extracted, **kwargs):
        if action == "failure":
            raise service.NutritionUnavailable("provider_unavailable", "Try again")
        if action == "concurrent_edit":
            row.extracted = {**row.extracted, "notes": "New note"}
        return {
            **extracted,
            "nutrition": {"perServing": {"calories": 200, "protein": 5.5, "carbs": 35, "fat": 3}},
            "derivedData": {"nutrition": {"status": "current", "source": "ai_estimate"}},
        }

    calculator = AsyncMock(side_effect=calculate)
    monkeypatch.setattr(recipes, "enrich_nutrition", calculator)
    if action == "save":
        result = await recipes.refresh_recipe_nutrition(row.id, request, db, user)
        assert result.extracted["components"] == before["components"]
        assert result.extracted["servings"] == 4
        assert result.extracted["nutrition"]["perServing"]["protein"] == 5.5
        assert result.content_revision == 3
        version.assert_awaited_once()
        db.commit.assert_awaited_once()
    else:
        with pytest.raises(HTTPException) as caught:
            await recipes.refresh_recipe_nutrition(row.id, request, db, user)
        assert (
            caught.value.status_code
            == {"not_owner": 403, "failure": 503, "concurrent_edit": 409, "revision_mismatch": 409}[
                action
            ]
        )
        db.commit.assert_not_awaited()
        version.assert_not_awaited()
        if action in {"not_owner", "revision_mismatch"}:
            calculator.assert_not_awaited()


@pytest.mark.parametrize("origin", ["photo", "text", "manual", "website", "video"])
async def test_every_new_recipe_save_flow_enriches_missing_nutrition(
    monkeypatch, fake_calculator, origin
):
    import json
    from unittest.mock import AsyncMock

    from app.routers import extract, recipes
    from tests.test_advisory_import_routes import _database, _user

    db, saved = _database()
    original = recipe()
    if origin in {"photo", "text"}:
        response = await recipes._save_captured_recipe(
            recipes.CaptureRecipeCreate(extracted=original, source_type=origin, is_public=False),
            db,
            _user(),
        )
        values = response.extracted.nutrition.perServing
        assert values.protein == 10.12
    elif origin == "manual":
        response = await recipes.create_manual_recipe(
            recipe_data=json.dumps(
                {
                    "title": original["title"],
                    "servings": 4,
                    "ingredients": original["components"][0]["ingredients"],
                    "steps": original["components"][0]["steps"],
                }
            ),
            image=None,
            db=db,
            user=_user(),
        )
        assert response.extracted.nutrition.perServing.calories == 200
    else:
        monkeypatch.setattr(
            extract.video_service, "normalize_url", AsyncMock(side_effect=lambda url: url)
        )
        monkeypatch.setattr(
            extract.video_service,
            "detect_platform",
            lambda url: "web" if origin == "website" else "youtube",
        )
        result = SimpleNamespace(
            success=True,
            recipe=original,
            raw_text="source",
            thumbnail_url=None,
            extraction_method="website-jsonld" if origin == "website" else "whisper",
            extraction_quality="high",
            has_audio_transcript=False,
            low_confidence=False,
            confidence_warning=None,
            source_evidence=None,
        )
        if origin == "website":
            from app.services.website import website_service

            monkeypatch.setattr(website_service, "extract", AsyncMock(return_value=result))
        else:
            monkeypatch.setattr(extract.recipe_extractor, "extract", AsyncMock(return_value=result))
        response = await extract.extract_recipe(
            extract.ExtractRequest(url="https://example.com/rice", is_public=False), db, _user()
        )
        assert response.recipe["nutrition"]["perServing"]["calories"] == 200
    assert len(fake_calculator) == 1
    assert saved[0].extracted["nutrition"]["total"]["protein"] == 40.5
    assert saved[0].user_id == "stable_owner"


async def test_invalid_ocr_nutrition_does_not_lose_valid_import(monkeypatch, fake_calculator):
    from app.routers import recipes
    from tests.test_advisory_import_routes import _database, _user

    db, saved = _database()
    extracted = recipe()
    extracted["nutrition"]["perServing"] = {"calories": -200, "protein": float("nan")}
    response = await recipes._save_captured_recipe(
        recipes.CaptureRecipeCreate(extracted=extracted, source_type="photo"), db, _user()
    )
    assert response.extracted.components[0].ingredients[0].name == "rice"
    assert response.extracted.nutrition.perServing.calories == 200
    assert len(fake_calculator) == 1


async def test_manual_import_draft_preserves_publisher_portion_through_save(fake_calculator):
    import json

    from app.routers import recipes
    from tests.test_advisory_import_routes import _database, _user

    db, saved = _database()
    source = {"calories": 100, "protein": 1, "carbs": 15, "fat": 4}
    original = recipe()
    response = await recipes.create_manual_recipe(
        recipe_data=json.dumps({"title": "Cookie draft", "servings": 8,
                               "ingredients": original["components"][0]["ingredients"],
                               "steps": original["components"][0]["steps"],
                               "nutrition": source, "nutrition_serving_basis": "source",
                               "nutrition_source_serving_size": "1 cookie",
                               "nutrition_source_per_serving": source}),
        image=None, db=db, user=_user(),
    )
    assert response.extracted.nutrition.sourceServingSize == "1 cookie"
    assert response.extracted.nutrition.sourcePerServing.calories == 100
    assert response.extracted.nutrition.perServing.calories == 100
    assert response.extracted.nutrition.total.calories is None
    assert saved[0].extracted["nutrition"]["servingsUsed"] is None
    assert fake_calculator == []


def test_unusable_existing_draft_has_specific_unavailable_reason():
    from app.models.recipe import Recipe
    from app.routers.recipes import normalized_recipe_extracted

    extracted = normalized_recipe_extracted(
        Recipe(
            extracted={
                "title": "Draft",
                "sourceIncomplete": True,
                "components": [],
                "nutrition": {},
            },
            extraction_method="source-draft",
        )
    )
    assert extracted["derivedData"]["nutrition"]["status"] == "unavailable"
    assert extracted["derivedData"]["nutrition"]["errorCode"] == "incomplete_recipe"


async def test_publisher_cookie_portion_is_not_multiplied_by_recipe_servings(fake_calculator):
    original = WebsiteService._convert_jsonld_to_recipe(
        {
            "name": "Cookies",
            "recipeIngredient": ["1 cup flour"],
            "recipeInstructions": ["Bake"],
            "recipeYield": ["24 cookies", "8 servings"],
            "nutrition": {
                "servingSize": "1 cookie",
                "calories": "100 kcal",
                "proteinContent": "1 g",
                "carbohydrateContent": "15 g",
                "fatContent": "4 g",
            },
        },
        "https://example.com/cookies",
        "Guam",
        "",
        None,
    )
    result = await service.enrich_nutrition(original, preserve_source=True)
    assert result["servings"] == 8
    assert result["nutrition"]["perServing"]["calories"] == 100
    assert result["nutrition"]["sourcePerServing"]["calories"] == 100
    assert result["nutrition"]["total"] == {}
    assert result["nutrition"]["servingBasis"] == "source"
    assert result["nutrition"]["servingsUsed"] is None
    assert fake_calculator == []


async def test_partial_publisher_portion_stays_separate_from_recipe_estimate(fake_calculator):
    original = recipe(8)
    original["nutrition"] = {
        "perServing": {"calories": 100, "protein": 1},
        "total": {},
        "sourceServingSize": "1 cookie",
    }
    result = await service.enrich_nutrition(original, preserve_source=True)
    assert result["nutrition"]["total"] == TOTAL
    assert result["nutrition"]["perServing"]["protein"] == 5.06
    assert result["nutrition"]["sourcePerServing"] == {"calories": 100, "protein": 1}
    assert result["nutrition"]["sourceServingSize"] == "1 cookie"
    assert result["nutrition"]["servingBasis"] == "recipe_servings"
    assert result["nutrition"]["servingsUsed"] == 8
    assert len(fake_calculator) == 1
    assert RecipeExtracted.model_validate(result).nutrition.sourcePerServing.protein == 1


def test_title_only_edit_preserves_publisher_portion():
    original = recipe(8)
    original["components"][0]["ingredients"][0]["notes"] = None
    original["nutrition"] = {
        "perServing": {"calories": 100, "protein": 1, "carbs": 15, "fat": 4},
        "total": {},
        "sourceServingSize": "1 cookie",
        "servingBasis": "source",
        "sourcePerServing": {"calories": 100, "protein": 1, "carbs": 15, "fat": 4},
        "servingsUsed": None,
    }
    original = mark_fresh(original, "nutrition", source="source")
    edit = RecipeEdit(
        title="Renamed cookies",
        servings=8,
        ingredients=original["components"][0]["ingredients"],
        steps=original["components"][0]["steps"],
        nutrition=original["nutrition"]["perServing"],
    )
    result = _build_edited_extracted(original, edit)
    assert result["nutrition"]["sourceServingSize"] == "1 cookie"
    assert result["nutrition"]["sourcePerServing"] == original["nutrition"]["sourcePerServing"]
    assert result["nutrition"]["servingsUsed"] is None
    assert result["derivedData"]["nutrition"]["status"] == "current"


async def test_normal_estimate_canary_is_allowed_but_repair_pins_approved_model(monkeypatch):
    import json
    from contextlib import asynccontextmanager
    from unittest.mock import AsyncMock

    from app import ai_governance

    settings = service.get_settings().model_copy(
        update={
            "allow_paid_ai_in_development": True,
            "ai_canary_models": {"enrichment": "test-canary"},
            "ai_canary_percentages": {"enrichment": 100},
        }
    )
    monkeypatch.setattr(service, "get_settings", lambda: settings)
    monkeypatch.setattr(ai_governance, "get_settings", lambda: settings)
    record = AsyncMock()
    monkeypatch.setattr(ai_governance, "record_ai_invocation", record)

    @asynccontextmanager
    async def limit(**kwargs):
        yield

    monkeypatch.setattr(service.ai_rate_limiter, "limit", limit)
    create = AsyncMock(
        return_value=SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=json.dumps(
                            {
                                "total": TOTAL,
                                "assumptions": [],
                            }
                        )
                    )
                )
            ],
        )
    )

    class Client:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(service, "AsyncOpenAI", Client)
    _, _, model = await service.calculate_totals(recipe(), user_id="owner")
    assert model == "test-canary"
    assert create.await_args.kwargs["model"] == "test-canary"
    _, _, model = await service.calculate_totals(
        recipe(),
        pinned_model=settings.enrichment_model,
        allow_canary=False,
    )
    assert model == settings.enrichment_model
    assert create.await_args.kwargs["model"] == settings.enrichment_model
    assert record.await_args.kwargs["rollout_variant"] == "pinned_repair"
    with pytest.raises(service.NutritionUnavailable) as caught:
        await service.calculate_totals(recipe(), pinned_model="changed-model", allow_canary=False)
    assert caught.value.code == "model_changed"
    assert create.await_count == 2


async def test_forced_refresh_cannot_overlay_prior_ai_totals_for_different_source_portion(
    fake_calculator,
):
    original = recipe(4)
    original["nutrition"] = {
        "perServing": {"calories": 250, "protein": 7, "carbs": 20, "fat": 10},
        "total": {"calories": 1000, "protein": 28, "carbs": 80, "fat": 40},
        "sourceServingSize": "1 cookie",
        "sourcePerServing": {"calories": 100, "protein": 1},
        "servingBasis": "recipe_servings",
        "servingsUsed": 4,
    }
    original["derivedData"] = {
        "nutrition": {"source": "source_and_ai_estimate", "status": "current"}
    }
    result = await service.enrich_nutrition(original, preserve_source=True, force=True)
    assert result["nutrition"]["total"] == TOTAL
    assert result["nutrition"]["perServing"]["calories"] == 200
    assert result["nutrition"]["sourcePerServing"] == {"calories": 100, "protein": 1}
    assert len(fake_calculator) == 1
