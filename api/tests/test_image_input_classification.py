"""Trust-boundary tests for classifying recipe images before OCR."""

import base64
import io
import json as json_module
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.auth import ClerkUser, get_current_user
from app.routers import extract
from app.services.llm_client import (
    ExtractionResult,
    ImageClassificationResult,
    LLMService,
)
from app.services.prompts import (
    IMAGE_CLASSIFICATION_RESPONSE_FORMAT,
    get_image_classification_prompt,
)


def _png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), color="white").save(buffer, format="PNG")
    return buffer.getvalue()


def _user() -> ClerkUser:
    return ClerkUser(
        id="stable_user",
        clerk_user_id="clerk_user",
        clerk_issuer="https://clerk.example.test",
        clerk_environment="test",
    )


class _ClassificationResponse:
    """Return one provider-shaped response to the fake async client."""

    status_code = 200

    def __init__(self, payload: dict):
        self._payload = payload

    def json(self) -> dict:
        return self._payload


class _ClassificationClient:
    """Capture the strict request and return the configured classification."""

    provider_content = {
        "classification": "recipe_document",
        "hasRecipeText": True,
    }
    payloads: list[dict] = []

    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def post(self, _url: str, *, headers: dict, json: dict):
        assert headers["Authorization"] == "Bearer test-key"
        self.payloads.append(json)
        return _ClassificationResponse(
            {
                "id": "classification_test",
                "choices": [
                    {
                        "message": {
                            "content": json_module.dumps(self.provider_content)
                        }
                    }
                ],
            }
        )


def test_classification_prompt_separates_dish_photos_from_recipe_evidence():
    """A visible dish must never qualify as recipe-document evidence."""

    prompt = get_image_classification_prompt(2)

    assert "Never infer a recipe from how food looks" in prompt
    assert "multiple ordered images contain legible pages" in prompt
    assert "package, title, or decorative food label alone is not recipe text" in prompt
    assert IMAGE_CLASSIFICATION_RESPONSE_FORMAT["json_schema"]["strict"] is True


@pytest.mark.asyncio
async def test_classifier_uses_fallback_after_invalid_primary(monkeypatch):
    """A malformed primary classification may fall back without running recipe OCR."""

    service = LLMService()
    service.openai_api_key = "test-key"
    provider_call = AsyncMock(
        side_effect=[
            ImageClassificationResult(
                success=False,
                error="invalid",
                error_code="invalid_classification",
            ),
            ImageClassificationResult(
                success=True,
                classification="dish_photo",
                has_recipe_text=False,
            ),
        ]
    )
    monkeypatch.setattr(service, "_try_image_classification", provider_call)

    result = await service.classify_recipe_images([base64.b64encode(_png_bytes()).decode()])

    assert result.success is True
    assert result.classification == "dish_photo"
    assert provider_call.await_count == 2
    assert provider_call.await_args_list[1].kwargs["fallback_reason"] == (
        "invalid_classification"
    )


@pytest.mark.asyncio
async def test_provider_classification_uses_strict_schema_and_parses_document(monkeypatch):
    """The real provider boundary must preserve the classification contract."""

    _ClassificationClient.provider_content = {
        "classification": "recipe_document",
        "hasRecipeText": True,
    }
    _ClassificationClient.payloads = []
    monkeypatch.setattr(
        "app.services.llm_client.httpx.AsyncClient",
        _ClassificationClient,
    )
    monkeypatch.setattr("app.ai_governance.record_ai_invocation", AsyncMock())
    service = LLMService()
    service.openai_api_key = "test-key"

    result = await service._call_image_classification(
        config={
            "name": "test-model",
            "model": "test-model",
            "base_url": "https://api.openai.com/v1",
            "timeout": 1,
            "allow_canary": False,
        },
        images_base64=[base64.b64encode(_png_bytes()).decode()],
        fallback_reason=None,
    )

    assert result.success is True
    assert result.classification == "recipe_document"
    assert result.has_recipe_text is True
    assert _ClassificationClient.payloads[0]["response_format"] == (
        IMAGE_CLASSIFICATION_RESPONSE_FORMAT
    )


@pytest.mark.asyncio
async def test_provider_classification_rejects_inconsistent_recipe_text(monkeypatch):
    """A dish-photo label may not claim that usable recipe text was found."""

    _ClassificationClient.provider_content = {
        "classification": "dish_photo",
        "hasRecipeText": True,
    }
    _ClassificationClient.payloads = []
    monkeypatch.setattr(
        "app.services.llm_client.httpx.AsyncClient",
        _ClassificationClient,
    )
    monkeypatch.setattr("app.ai_governance.record_ai_invocation", AsyncMock())
    service = LLMService()
    service.openai_api_key = "test-key"

    result = await service._call_image_classification(
        config={
            "name": "test-model",
            "model": "test-model",
            "base_url": "https://api.openai.com/v1",
            "timeout": 1,
            "allow_canary": False,
        },
        images_base64=[base64.b64encode(_png_bytes()).decode()],
        fallback_reason=None,
    )

    assert result.success is False
    assert result.error_code == "invalid_classification"


@pytest.mark.parametrize(
    ("classification", "expected_code"),
    [
        ("dish_photo", "IMAGE_DISH_PHOTO"),
        ("unreadable", "IMAGE_UNREADABLE"),
        ("unsupported", "IMAGE_UNSUPPORTED"),
    ],
)
def test_non_document_classification_blocks_recipe_extraction(
    monkeypatch,
    classification: str,
    expected_code: str,
):
    """Non-document inputs must fail honestly before recipe generation."""

    monkeypatch.setattr(
        "app.routers.extract.settings.image_input_classification_enabled",
        True,
    )
    classifier = AsyncMock(
        return_value=ImageClassificationResult(
            success=True,
            classification=classification,
            has_recipe_text=False,
            model_used="test-model",
        )
    )
    extractor = AsyncMock()
    monkeypatch.setattr(
        "app.routers.extract.llm_service.classify_recipe_images",
        classifier,
    )
    monkeypatch.setattr(
        "app.routers.extract.llm_service.extract_from_image",
        extractor,
    )
    test_app = FastAPI()
    test_app.include_router(extract.router)
    test_app.dependency_overrides[get_current_user] = _user

    with TestClient(test_app) as client:
        response = client.post(
            "/api/extract/ocr",
            files={"image": ("recipe.png", _png_bytes(), "image/png")},
            data={"location": "Guam"},
        )

    assert response.status_code == 200
    assert response.json()["success"] is False
    assert response.json()["error_code"] == expected_code
    assert response.json()["input_classification"] == classification
    extractor.assert_not_awaited()


def test_recipe_document_classification_allows_ocr(monkeypatch):
    """Legible recipe documents continue through the existing strict OCR path."""

    monkeypatch.setattr(
        "app.routers.extract.settings.image_input_classification_enabled",
        True,
    )
    monkeypatch.setattr(
        "app.routers.extract.llm_service.classify_recipe_images",
        AsyncMock(
            return_value=ImageClassificationResult(
                success=True,
                classification="recipe_document",
                has_recipe_text=True,
            )
        ),
    )
    extractor = AsyncMock(
        return_value=ExtractionResult(
            success=True,
            recipe={"title": "Red Rice", "components": []},
        )
    )
    monkeypatch.setattr(
        "app.routers.extract.llm_service.extract_from_image",
        extractor,
    )
    test_app = FastAPI()
    test_app.include_router(extract.router)
    test_app.dependency_overrides[get_current_user] = _user

    with TestClient(test_app) as client:
        response = client.post(
            "/api/extract/ocr",
            files={"image": ("recipe.png", _png_bytes(), "image/png")},
            data={"location": "Guam"},
        )

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert response.json()["input_classification"] == "recipe_document"
    extractor.assert_awaited_once()


def test_multi_image_classification_preserves_order_and_blocks_ocr(monkeypatch):
    """The multi-image route must classify every ordered page before extraction."""

    monkeypatch.setattr(
        "app.routers.extract.settings.image_input_classification_enabled",
        True,
    )
    classifier = AsyncMock(
        return_value=ImageClassificationResult(
            success=True,
            classification="unsupported",
            has_recipe_text=False,
            model_used="test-model",
        )
    )
    extractor = AsyncMock()
    monkeypatch.setattr(
        "app.routers.extract.llm_service.classify_recipe_images",
        classifier,
    )
    monkeypatch.setattr(
        "app.routers.extract.llm_service.extract_from_images",
        extractor,
    )
    first = _png_bytes()
    second_buffer = io.BytesIO()
    Image.new("RGB", (10, 10), color="black").save(second_buffer, format="PNG")
    second = second_buffer.getvalue()
    test_app = FastAPI()
    test_app.include_router(extract.router)
    test_app.dependency_overrides[get_current_user] = _user

    with TestClient(test_app) as client:
        response = client.post(
            "/api/extract/ocr/multi",
            files=[
                ("images", ("page-1.png", first, "image/png")),
                ("images", ("page-2.png", second, "image/png")),
            ],
            data={"location": "Guam"},
        )

    assert response.status_code == 200
    assert response.json()["error_code"] == "IMAGE_UNSUPPORTED"
    assert classifier.await_args.args[0] == [
        base64.b64encode(first).decode(),
        base64.b64encode(second).decode(),
    ]
    extractor.assert_not_awaited()


def test_classifier_failure_is_fail_closed(monkeypatch):
    """Provider failure must not fall through to inspired recipe generation."""

    monkeypatch.setattr(
        "app.routers.extract.settings.image_input_classification_enabled",
        True,
    )
    monkeypatch.setattr(
        "app.routers.extract.llm_service.classify_recipe_images",
        AsyncMock(
            return_value=ImageClassificationResult(
                success=False,
                error="provider unavailable",
                error_code="provider_http_503",
            )
        ),
    )
    extractor = AsyncMock()
    monkeypatch.setattr(
        "app.routers.extract.llm_service.extract_from_image",
        extractor,
    )
    test_app = FastAPI()
    test_app.include_router(extract.router)
    test_app.dependency_overrides[get_current_user] = _user

    with TestClient(test_app) as client:
        response = client.post(
            "/api/extract/ocr",
            files={"image": ("recipe.png", _png_bytes(), "image/png")},
        )

    assert response.status_code == 200
    assert response.json()["error_code"] == "IMAGE_CLASSIFICATION_UNAVAILABLE"
    extractor.assert_not_awaited()
