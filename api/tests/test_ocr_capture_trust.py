from app.ai_governance import PROMPT_VERSIONS
from app.services.extraction_confidence import (
    DEFAULT_CONFIDENCE_WARNING,
    normalize_extraction_confidence,
)
from app.services.llm_client import LLMService
from app.services.prompts import get_multi_image_ocr_prompt, get_ocr_extraction_prompt


def test_single_image_ocr_prompt_marks_uncertainty_instead_of_inventing_measurements():
    prompt = get_ocr_extraction_prompt("Guam")

    assert "Do not silently guess" in prompt
    assert "use null rather than inventing a measurement" in prompt
    assert '"lowConfidence": false' in prompt
    assert '"confidenceWarning": null' in prompt


def test_multi_image_ocr_prompt_applies_the_same_trust_contract():
    prompt = get_multi_image_ocr_prompt(3, "Guam")

    assert "3 images" in prompt
    assert "Do not silently guess" in prompt
    assert "use null rather than inventing a measurement" in prompt
    assert "Set lowConfidence to true" in prompt


def test_ocr_prompt_version_tracks_the_trust_contract_change():
    assert PROMPT_VERSIONS["ocr"] == "recipe-ocr-v2"


def test_ocr_confidence_is_normalized_for_a_reliable_mobile_warning():
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


def test_direct_ocr_save_input_gets_the_same_bounded_confidence_contract():
    recipe = {"lowConfidence": True, "confidenceWarning": {"not": "text"}}

    low_confidence, warning = normalize_extraction_confidence(recipe)

    assert low_confidence is True
    assert warning == DEFAULT_CONFIDENCE_WARNING
    assert recipe["confidenceWarning"] == DEFAULT_CONFIDENCE_WARNING
