from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.ai_governance import PROMPT_VERSIONS
from app.auth import ClerkUser, get_current_user
from app.db import get_db
from app.models.recipe import Recipe
from app.routers import recipes
from app.services.extraction_confidence import (
    DEFAULT_CONFIDENCE_WARNING,
    normalize_extraction_confidence,
)
from app.services.llm_client import LLMService
from app.services.prompts import get_multi_image_ocr_prompt, get_ocr_extraction_prompt


def test_single_image_ocr_prompt_marks_uncertainty_instead_of_inventing_measurements():
    """Single-image OCR must disclose uncertainty instead of fabricating values."""
    prompt = get_ocr_extraction_prompt("Guam")

    assert "Do not silently guess" in prompt
    assert "use null rather than inventing a measurement" in prompt
    assert '"lowConfidence": false' in prompt
    assert '"confidenceWarning": null' in prompt


def test_multi_image_ocr_prompt_applies_the_same_trust_contract():
    """Multi-image OCR must preserve stated values and apply the trust contract."""
    prompt = get_multi_image_ocr_prompt(3, "Guam")

    assert "3 images" in prompt
    assert "Do not silently guess" in prompt
    assert "use null rather than inventing a measurement" in prompt
    assert "Set lowConfidence to true" in prompt
    assert "preserve values stated in any image" in prompt
    assert "omitted time/serving estimates do not trigger it" in prompt


def test_ocr_prompt_version_tracks_the_trust_contract_change():
    """Prompt telemetry must distinguish the revised OCR trust contract."""
    assert PROMPT_VERSIONS["ocr"] == "recipe-ocr-v2"


def test_ocr_confidence_is_normalized_for_a_reliable_mobile_warning():
    """Model output must become a strict flag and safe warning for clients."""
    service = LLMService()
    base_recipe = {
        "title": "Red Rice",
        "components": [
            {
                "name": "Main",
                "ingredients": [{"name": "rice", "quantity": "2", "unit": "cups"}],
                "steps": ["Cook the rice."],
            }
        ],
        "lowConfidence": True,
        "confidenceWarning": "  The oven temperature is blurry.  ",
    }

    normalized = service._post_process_recipe(base_recipe, "photo-upload", "Guam")

    assert normalized["lowConfidence"] is True
    assert normalized["confidenceWarning"] == "The oven temperature is blurry."

    normalized_string_flag = service._post_process_recipe(
        {**base_recipe, "lowConfidence": "true", "confidenceWarning": "Untrusted"},
        "photo-upload",
        "Guam",
    )
    assert normalized_string_flag["lowConfidence"] is False
    assert normalized_string_flag["confidenceWarning"] is None


def test_confidence_normalizer_bounds_malformed_warnings():
    """Malformed warning values must become a safe default."""
    recipe = {"lowConfidence": True, "confidenceWarning": {"not": "text"}}

    low_confidence, warning = normalize_extraction_confidence(recipe)

    assert low_confidence is True
    assert warning == DEFAULT_CONFIDENCE_WARNING
    assert recipe["confidenceWarning"] == DEFAULT_CONFIDENCE_WARNING


def test_direct_ocr_save_route_persists_normalized_confidence():
    """The direct OCR-save route must persist normalized confidence fields."""
    captured: dict[str, Recipe] = {}
    db = AsyncMock()

    def capture_recipe(recipe: Recipe) -> None:
        captured["recipe"] = recipe

    async def assign_database_values(recipe: Recipe) -> None:
        recipe.id = uuid4()
        recipe.created_at = datetime.now(UTC)
        recipe.moderation_status = "active"

    db.add = Mock(side_effect=capture_recipe)
    db.refresh.side_effect = assign_database_values

    user = ClerkUser(
        id="stable_user",
        clerk_user_id="clerk_user",
        clerk_issuer="https://clerk.example.test",
        clerk_environment="test",
    )
    test_app = FastAPI()
    test_app.include_router(recipes.router)
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: user

    with TestClient(test_app) as client:
        response = client.post(
            "/api/recipes/from-ocr",
            json={
                "extracted": {
                    "title": "Red Rice",
                    "sourceUrl": "photo-upload",
                    "components": [],
                    "lowConfidence": True,
                    "confidenceWarning": {"not": "text"},
                },
                "is_public": False,
            },
        )

    assert response.status_code == 200
    saved_recipe = captured["recipe"]
    assert saved_recipe.extraction_quality == "low"
    assert saved_recipe.extracted["lowConfidence"] is True
    assert saved_recipe.extracted["confidenceWarning"] == DEFAULT_CONFIDENCE_WARNING
    db.commit.assert_awaited_once()
