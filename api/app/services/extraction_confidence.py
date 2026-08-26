"""Normalize model-provided extraction confidence for storage and clients."""

DEFAULT_CONFIDENCE_WARNING = (
    "Some recipe text was unclear. Check the cooking details before saving."
)


def normalize_extraction_confidence(recipe: dict) -> tuple[bool, str | None]:
    """Keep only a literal boolean flag and a bounded, useful warning."""
    low_confidence = recipe.get("lowConfidence") is True
    confidence_warning = recipe.get("confidenceWarning")
    if low_confidence:
        if not isinstance(confidence_warning, str) or not confidence_warning.strip():
            confidence_warning = DEFAULT_CONFIDENCE_WARNING
        confidence_warning = confidence_warning.strip()[:500]
    else:
        confidence_warning = None

    recipe["lowConfidence"] = low_confidence
    recipe["confidenceWarning"] = confidence_warning
    return low_confidence, confidence_warning
