"""Optional estimates retain source provenance through review and older clients."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.models.schemas import RecipeExtracted
from app.recipe_estimates import QuantityEstimate, normalize_recipe_estimates
from app.recipe_review import apply_recipe_review, assess_recipe_review, review_response_fields
from app.routers.recipes import RecipeEdit, _build_edited_extracted
from app.services.llm_client import ExtractionResult, LLMService
from app.services.prompts import (
    RECIPE_SCHEMA,
    get_multi_image_ocr_prompt,
    get_ocr_extraction_prompt,
    get_pasted_text_recipe_extraction_prompt,
    get_recipe_extraction_prompt,
    get_tiktok_slideshow_prompt,
    get_video_frame_extraction_prompt,
)

ESTIMATE = {
    "quantity": "1/2",
    "unit": "cup",
    "reason": "Enough liquid to loosen the sauce for four servings.",
}


def recipe():
    return {
        "title": "Rice with sauce",
        "sourceUrl": "https://example.test/recipe",
        "servings": 4,
        "components": [
            {
                "name": "Main",
                "ingredients": [
                    {"name": "rice", "quantity": "2", "unit": "cups", "notes": None},
                    {
                        "name": "water",
                        "quantity": None,
                        "unit": None,
                        "notes": None,
                        "quantityEstimate": dict(ESTIMATE),
                    },
                ],
                "steps": ["Simmer rice and loosen the sauce with water."],
                "notes": None,
            }
        ],
        "notes": "Let the rice rest before serving.",
    }


def assess(value, **kwargs):
    return assess_recipe_review(
        value, source_type="instagram", extraction_method="video", content_revision=1, **kwargs
    )


def edit(value, **changes):
    payload = {
        "title": value["title"],
        "servings": value["servings"],
        "components": deepcopy(value["components"]),
        "notes": value["notes"],
    }
    return _build_edited_extracted(value, RecipeEdit.model_validate({**payload, **changes}))


def test_source_amount_wins_and_estimate_survives_public_schema():
    value = recipe()
    value["components"][0]["ingredients"][0]["quantityEstimate"] = ESTIMATE
    value["components"][0]["ingredients"][1]["quantityEstimate"]["raw_text"] = "private"
    response = RecipeExtracted.model_validate(value)
    rice, water = response.model_dump()["components"][0]["ingredients"]
    assert rice["quantity"] == "2" and rice["quantityEstimate"] is None
    assert water["quantity"] is None and water["unit"] is None
    assert water["quantityEstimate"] == ESTIMATE
    assert "raw_text" not in response.model_dump_json()


@pytest.mark.parametrize("amount", ["-1", "0", "1/0", "lots", "NaN", "1-2", "100001"])
def test_invalid_estimate_is_dropped_without_replacing_source(amount):
    with pytest.raises(ValidationError):
        QuantityEstimate.model_validate({**ESTIMATE, "quantity": amount})
    value = recipe()
    value["components"][0]["ingredients"][1]["quantityEstimate"]["quantity"] = amount
    ingredient = normalize_recipe_estimates(value)["components"][0]["ingredients"][1]
    assert ingredient["quantity"] is None and "quantityEstimate" not in ingredient


def test_estimate_is_optional_review_never_source_supported():
    value = recipe()
    assessment = assess(value)
    amount = next(
        field
        for field in assessment.evidence["fields"]
        if field["path"] == "components.0.ingredients.1.quantity"
    )
    assert amount == {
        "path": "components.0.ingredients.1.quantity",
        "status": "estimated",
        "quantityStatus": "estimated",
    }
    assert assessment.state == "needs_review"
    assert assessment.evidence["assessment"]["issues"][0]["code"] == "estimated_quantity"
    model = SimpleNamespace(
        source_type="instagram", extraction_method="video", content_revision=1, is_public=True
    )
    apply_recipe_review(model, value)
    assert model.is_public is True
    assert review_response_fields(model, include_evidence=False)["extraction_evidence"] is None
    verified = assess(
        value,
        previous_extracted=value,
        previous_evidence=assessment.evidence,
        verified_paths=["components.0.ingredients.1.quantity"],
    )
    assert verified.state == "ready"
    field = next(
        field
        for field in verified.evidence["fields"]
        if field["path"] == "components.0.ingredients.1.quantity"
    )
    assert field["quantityStatus"] == "estimated" and field["status"] == "user_verified"


def test_legacy_edit_carries_estimate_but_changed_context_invalidates_it():
    value = recipe()
    old_client = deepcopy(value["components"])
    old_client[0]["ingredients"][1].pop("quantityEstimate")
    changed = edit(value, title="Renamed rice", components=old_client)
    assert changed["ingredients"][1]["quantityEstimate"] == ESTIMATE
    assert changed["components"][0]["ingredients"][1]["quantityEstimate"] == ESTIMATE
    for modifications in [
        {"servings": 8},
        {"components": [{**value["components"][0], "steps": ["Make soup instead."]}]},
    ]:
        assert "quantityEstimate" not in edit(value, **modifications)["ingredients"][1]
    corrected = deepcopy(value["components"])
    corrected[0]["ingredients"][1]["quantity"] = "3/4"
    updated = edit(value, components=corrected)
    assert updated["ingredients"][1]["quantity"] == "3/4"
    assert "quantityEstimate" not in updated["ingredients"][1]


def test_incomplete_cookie_description_stays_private_without_estimates_or_diagnostic_notes():
    value = recipe()
    value["title"] = "Pumpkin Cheesecake Cookies"
    value["components"] = [
        {
            "name": "Pumpkin Spice Cookies",
            "ingredients": [
                {"name": "pumpkin", "quantity": None, "unit": None, "quantityEstimate": ESTIMATE},
                {"name": "spices", "quantity": None, "unit": None},
            ],
            "steps": ["Bake pumpkin spice cookies."],
        },
        {
            "name": "Cheesecake Filling",
            "ingredients": [{"name": "cream cheese", "quantity": None, "unit": None}],
            "steps": ["Fill the cookies with creamy cheesecake."],
        },
        {
            "name": "Spiced Sugar Coating",
            "ingredients": [
                {"name": "sugar", "quantity": None, "unit": None},
                {"name": "spices", "quantity": None, "unit": None},
            ],
            "steps": ["Roll the filled cookies in spiced sugar."],
        },
    ]
    value["notes"] = (
        "The description identifies the dish and broad preparation concept but does not provide a full ingredient list, measurements, temperatures, timings, or detailed instructions."
    )
    cleaned = LLMService()._post_process_recipe(value, value["sourceUrl"], "Guam")
    assert cleaned["notes"] is None and cleaned["sourceIncomplete"] is True
    assert all("quantityEstimate" not in item for item in cleaned["ingredients"])
    model = SimpleNamespace(
        source_type="instagram", extraction_method="video", content_revision=1, is_public=True
    )
    assert apply_recipe_review(model, cleaned).state == "source_incomplete"
    assert model.is_public is False
    assert edit(cleaned, title="Renamed cookies")["sourceIncomplete"] is True
    assert edit(cleaned, servings=12)["sourceIncomplete"] is True


def test_source_notes_and_flexible_amounts_remain_unchanged():
    value = recipe()
    value["components"][0]["ingredients"][1]["notes"] = "as needed"
    cleaned = normalize_recipe_estimates(value, clean_import_notes=True)
    assert cleaned["notes"] == value["notes"]
    assert cleaned["components"][0]["ingredients"][1]["notes"] == "as needed"
    assert "quantityEstimate" not in cleaned["components"][0]["ingredients"][1]


def test_all_prompt_paths_offer_separate_estimates_and_require_context():
    prompts = [
        get_pasted_text_recipe_extraction_prompt("source"),
        get_recipe_extraction_prompt("url", "source"),
        get_ocr_extraction_prompt(),
        get_multi_image_ocr_prompt(2),
        get_tiktok_slideshow_prompt(2, "url"),
        get_video_frame_extraction_prompt(
            source_url="url", source_context="source", initial_recipe=None, frame_timestamps=[1.0]
        ),
    ]
    for prompt in prompts:
        assert "quantityEstimate" in prompt and "Never replace a source measurement" in prompt
        assert (
            "Set sourceIncomplete true" in prompt and "Never put extraction diagnostics" in prompt
        )
    ingredient = RECIPE_SCHEMA["properties"]["components"]["items"]["properties"]["ingredients"][
        "items"
    ]
    estimate = ingredient["properties"]["quantityEstimate"]
    assert estimate["additionalProperties"] is False
    assert set(estimate["required"]) == set(estimate["properties"])


@pytest.mark.asyncio
async def test_failed_provider_does_not_fabricate_estimates(monkeypatch):
    service = LLMService()
    service.openai_api_key = "test-key"
    call = AsyncMock(
        return_value=ExtractionResult(
            success=False, error="unavailable", error_code="provider_error"
        )
    )
    monkeypatch.setattr(service, "_try_extraction", call)
    result = await service.extract_from_text(
        "Rice: simmer two cups rice with water for twenty minutes."
    )
    assert result.success is False and result.recipe is None
    assert call.await_count == 2


def test_notes_filter_retains_cooking_advice_and_avoids_duplicate_estimate_review():
    value = recipe()
    value["notes"] = "The source does not provide measurements. Add the water gradually."
    cleaned = normalize_recipe_estimates(value, clean_import_notes=True)
    assert cleaned["notes"] == "Add the water gradually."
    assert cleaned.get("sourceIncomplete") is not True
    value["notes"] = "No additional notes."
    value["lowConfidence"] = True
    value["confidenceWarning"] = "AI-estimated amounts are marked."
    cleaned = LLMService()._post_process_recipe(value, value["sourceUrl"], "Guam")
    assert cleaned["notes"] is None
    assert [issue["code"] for issue in assess(cleaned).evidence["assessment"]["issues"]] == [
        "estimated_quantity"
    ]
    assert cleaned["ingredients"][1] == cleaned["components"][0]["ingredients"][1]


@pytest.mark.parametrize("route", ["/api/recipes/from-capture", "/api/recipes/from-ocr"])
def test_capture_routes_preserve_estimates_and_public_response_hides_evidence(route):
    from datetime import UTC, datetime
    from unittest.mock import Mock
    from uuid import uuid4

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.auth import ClerkUser, get_current_user
    from app.db import get_db
    from app.routers import recipes

    db = AsyncMock()
    captured = {}
    db.add = Mock(side_effect=lambda value: captured.update(recipe=value))

    async def refreshed(value):
        value.id = uuid4()
        value.created_at = datetime.now(UTC)
        value.moderation_status = "active"

    db.refresh.side_effect = refreshed
    app = FastAPI()
    app.include_router(recipes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: ClerkUser(
        id="stable-user",
        clerk_user_id="clerk-user",
        clerk_issuer="https://clerk.example.test",
        clerk_environment="test",
    )
    with TestClient(app) as client:
        response = client.post(
            route, json={"extracted": recipe(), "is_public": False, "source_type": "photo"}
        )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["extracted"]["components"][0]["ingredients"][1]["quantityEstimate"] == ESTIMATE
    saved = captured["recipe"]
    assert saved.user_id == "stable-user"
    public = recipes.recipe_to_detail_response(saved, None).model_dump()
    assert public["extraction_evidence"] is None and public["raw_text"] is None
    assert public["extracted"]["ingredients"][1]["quantity"] is None
    assert public["extracted"]["ingredients"][1]["quantityEstimate"] == ESTIMATE


LEGACY_DIAGNOSTIC = "Description identifies dish and broad preparation concept but does not provide a full ingredient list, measurements, temperatures, timings, or detailed instructions."


@pytest.mark.asyncio
async def test_legacy_diagnostic_is_private_on_owner_projection_and_loaded_public_policy():
    from app.moderation import is_publicly_viewable
    from app.recipe_estimates import source_is_incomplete

    value = recipe()
    value["notes"] = LEGACY_DIAGNOSTIC
    model = SimpleNamespace(
        extracted=value,
        extraction_method="whisper",
        source_type="instagram",
        review_state="needs_review",
        content_revision=1,
        is_public=True,
        moderation_status="active",
    )
    assert source_is_incomplete(value, extraction_method="whisper")
    assert not await is_publicly_viewable(AsyncMock(), model, None)
    assert (
        review_response_fields(model, include_evidence=True)["review_state"] == "source_incomplete"
    )
    # Reading the old recipe neither changes visibility nor rewrites saved data.
    assert model.is_public is True and model.extracted["notes"] == LEGACY_DIAGNOSTIC
    assert not source_is_incomplete(value, extraction_method="manual")
    value["notes"] = "This recipe does not need a full ingredient list. Use what you have."
    assert not source_is_incomplete(value, extraction_method="whisper")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("extracted", "method"),
    [
        ({"notes": LEGACY_DIAGNOSTIC}, "whisper"),
        ({"notes": "The " + LEGACY_DIAGNOSTIC.lower()}, "whisper"),
        ({"notes": LEGACY_DIAGNOSTIC}, "manual"),
        ({"notes": LEGACY_DIAGNOSTIC}, None),
        ({"notes": "This recipe does not need a full ingredient list."}, "whisper"),
        ({"notes": "Add the water gradually."}, "whisper"),
        ({"sourceIncomplete": True}, "whisper"),
        ({"sourceIncomplete": False}, "whisper"),
        ({"sourceIncomplete": "true"}, "whisper"),
        ({}, None),
    ],
)
async def test_postgres_and_python_completeness_policy_match(extracted, method):
    import os

    from sqlalchemy import String, literal, select
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.moderation import source_incomplete_condition
    from app.recipe_estimates import source_is_incomplete

    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("PostgreSQL parity runs in the repository gate with TEST_DATABASE_URL")
    database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            actual = await connection.scalar(
                select(
                    source_incomplete_condition(
                        literal(extracted, type_=JSONB), literal(method, type_=String)
                    )
                )
            )
        assert actual is source_is_incomplete(extracted, extraction_method=method)
    finally:
        await engine.dispose()


@pytest.mark.parametrize(
    ("provided", "normalized"), [("½", "1/2"), ("1½", "1 1/2"), ("1⁄2", "1/2")]
)
def test_common_fraction_typography_does_not_drop_a_valid_estimate(provided, normalized):
    value = recipe()
    value["components"][0]["ingredients"][1]["quantityEstimate"]["quantity"] = provided
    cleaned = normalize_recipe_estimates(value)
    ingredient = cleaned["components"][0]["ingredients"][1]
    assert ingredient["quantityEstimate"]["quantity"] == normalized
    assert ingredient["quantity"] is None


@pytest.mark.parametrize(
    ("extracted", "method", "expected"),
    [
        ({"notes": LEGACY_DIAGNOSTIC}, "whisper", True),
        ({"notes": LEGACY_DIAGNOSTIC}, "manual", False),
        ({"sourceIncomplete": True}, "whisper", True),
        ({"sourceIncomplete": "true"}, "whisper", False),
        ({"notes": "Add the water gradually."}, "whisper", False),
    ],
)
def test_sqlite_completeness_policy_preserves_test_query_semantics(extracted, method, expected):
    from sqlalchemy import String, create_engine, literal, select
    from sqlalchemy.dialects.postgresql import JSONB

    from app.moderation import source_incomplete_condition

    engine = create_engine("sqlite://")
    try:
        with engine.connect() as connection:
            actual = connection.scalar(
                select(
                    source_incomplete_condition(
                        literal(extracted, type_=JSONB), literal(method, type_=String)
                    )
                )
            )
        assert actual is expected
    finally:
        engine.dispose()


def test_ingredient_note_cleanup_preserves_tips_without_repeating_missing_amount():
    value = recipe()
    value["components"][0]["ingredients"][1]["notes"] = "Amount omitted; add the water gradually."
    cleaned = normalize_recipe_estimates(value, clean_import_notes=True)
    ingredient = cleaned["components"][0]["ingredients"][1]
    assert ingredient["notes"] == "add the water gradually."
    assert ingredient["quantityEstimate"] == ESTIMATE
    assert cleaned["ingredients"][1]["notes"] == ingredient["notes"]
    for diagnostic in [
        "Amount omitted.",
        "Amount not stated.",
        "Quantity not provided in the source.",
    ]:
        value["components"][0]["ingredients"][1]["notes"] = diagnostic
        cleaned = normalize_recipe_estimates(value, clean_import_notes=True)
        assert cleaned["components"][0]["ingredients"][1]["notes"] is None
        assert not cleaned.get("confidenceWarning")
