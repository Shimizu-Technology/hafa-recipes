"""Keep optional culinary estimates separate from facts supplied by a source."""

from __future__ import annotations

import re
from copy import deepcopy
from fractions import Fraction

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

_NULLISH = {"", "null", "none", "n/a", "not stated", "unknown"}
ESTIMATE_ONLY_WARNING = "AI-estimated amounts are marked."
_FLEXIBLE = ("to taste", "as needed", "as desired", "for garnish", "optional")
_DIAGNOSTIC = re.compile(
    r"\b(?:(?:the )?(?:source|description|caption|transcript|video|image)|extraction|extracted from)\b"
    r".*\b(?:does not (?:provide|include|contain)|could not|not (?:provided|available|stated)|"
    r"missing|limited (?:metadata|information)|no (?:clear|full|complete))\b",
    re.I | re.S,
)
_INCOMPLETE = re.compile(
    r"\b(?:does not (?:provide|include|contain)|missing|no (?:full|complete)|without)\b"
    r".{0,140}\b(?:ingredient list|ingredients|(?:detailed |cooking )?instructions|cooking method)\b",
    re.I | re.S,
)


# Narrow compatibility rule for diagnostic notes emitted by older extractors.
# Avoid classifying ordinary recipe tips or human-authored recipes by keywords.
LEGACY_INCOMPLETE_PATTERN = (
    r"^(?:the )?(?:description|caption|transcript|source)\b.{0,250}\b"
    r"(?:does not provide a (?:full|complete) ingredient list|"
    r"does not (?:include|contain) (?:the )?(?:ingredients|cooking instructions)|"
    r"provides only a (?:dish )?description)\b"
)
LEGACY_INCOMPLETE_SQL_PATTERN = "(?is)" + LEGACY_INCOMPLETE_PATTERN.replace(r"\b", r"\y")


def source_is_incomplete(extracted: dict | None, *, extraction_method: str | None = None) -> bool:
    """Recognize explicit incompleteness and known older extractor diagnostics."""
    if not isinstance(extracted, dict):
        return False
    if extracted.get("sourceIncomplete") is True:
        return True
    notes = extracted.get("notes")
    return bool(
        extraction_method not in (None, "manual")
        and isinstance(notes, str)
        and re.search(LEGACY_INCOMPLETE_PATTERN, notes.strip(), re.I | re.S)
    )


class QuantityEstimate(BaseModel):
    """An approximate amount, never a transcription of a source measurement."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    quantity: str = Field(min_length=1, max_length=30)
    unit: str | None = Field(default=None, max_length=40)
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("quantity")
    @classmethod
    def positive_amount(cls, value: str) -> str:
        """Accept a single positive number or fraction, not arbitrary prose."""
        if not re.fullmatch(r"(?:\d+(?:\.\d+)?|\d+/\d+|\d+ \d+/\d+)", value):
            raise ValueError("Estimate must be a positive number or fraction")
        try:
            amount = sum(Fraction(part) for part in value.split())
        except (ValueError, ZeroDivisionError) as exc:
            raise ValueError("Invalid estimated amount") from exc
        if amount <= 0 or amount > 100_000:
            raise ValueError("Estimated amount is outside supported bounds")
        return value


def has_source_quantity(ingredient: dict) -> bool:
    """Recognize source amounts, including explicitly flexible instructions."""
    quantity = ingredient.get("quantity")
    if quantity is not None and str(quantity).strip().lower() not in _NULLISH:
        return True
    text = " ".join(str(ingredient.get(key) or "") for key in ("name", "unit", "notes")).lower()
    return any(phrase in text for phrase in _FLEXIBLE)


def valid_quantity_estimate(ingredient: dict) -> dict | None:
    """Validate public estimate metadata without accepting hidden provider fields."""
    if has_source_quantity(ingredient) or not str(ingredient.get("name") or "").strip():
        return None
    try:
        return QuantityEstimate.model_validate(ingredient.get("quantityEstimate")).model_dump()
    except ValidationError:
        return None


def normalize_recipe_estimates(
    extracted: dict, *, clean_import_notes: bool = False, infer_source_incomplete: bool = True
) -> dict:
    """Normalize imports without replacing source quantities or fabricating gaps."""
    result = deepcopy(extracted)
    diagnostics: list[str] = []
    if clean_import_notes:
        for record in [result, *(result.get("components") or [])]:
            if not isinstance(record, dict):
                continue
            notes = record.get("notes")
            if not isinstance(notes, str):
                continue
            useful: list[str] = []
            removed = False
            for sentence in re.split(r"(?<=[.!?])\s+", notes.strip()):
                if _DIAGNOSTIC.search(sentence):
                    diagnostics.append(sentence)
                    removed = True
                elif not sentence or re.fullmatch(
                    r"(?:no (?:additional |specific )?notes(?: (?:provided|available))?|n/a|none)[.!]?",
                    sentence,
                    re.I,
                ):
                    removed = True
                else:
                    useful.append(sentence)
            if removed:
                record["notes"] = " ".join(useful) or None
    if result.get("confidenceWarning") == ESTIMATE_ONLY_WARNING:
        # Estimated amounts already have located review issues. Avoid turning
        # their summary into a second unrelated acknowledgment requirement.
        result["confidenceWarning"] = None
        result["lowConfidence"] = False
    if diagnostics:
        result["lowConfidence"] = True
        if not result.get("confidenceWarning"):
            result["confidenceWarning"] = diagnostics[0][:500]
        if infer_source_incomplete and any(_INCOMPLETE.search(note) for note in diagnostics):
            result["sourceIncomplete"] = True
    incomplete = result.get("sourceIncomplete") is True
    if "sourceIncomplete" in result:
        result["sourceIncomplete"] = incomplete
    had_estimates = False
    for record in [result, *(result.get("components") or [])]:
        if not isinstance(record, dict):
            continue
        for ingredient in record.get("ingredients") or []:
            if not isinstance(ingredient, dict):
                continue
            had_estimates = had_estimates or "quantityEstimate" in ingredient
            estimate = None if incomplete else valid_quantity_estimate(ingredient)
            if estimate is not None:
                ingredient["quantityEstimate"] = estimate
            else:
                ingredient.pop("quantityEstimate", None)
    if had_estimates and result.get("components"):
        # Released clients consume the flat list: preserve the same source facts
        # and estimate annotations on both views of an imported ingredient.
        result["ingredients"] = [
            ingredient
            for component in result["components"]
            if isinstance(component, dict)
            for ingredient in component.get("ingredients") or []
        ]
    return result


def preserve_unchanged_estimates(old: dict, new: dict) -> dict:
    """Carry old-client omissions only while all cooking dependencies are unchanged."""
    result = deepcopy(new)

    def records(recipe: dict) -> list[dict]:
        return [
            item
            for component in recipe.get("components") or []
            for item in component.get("ingredients") or []
        ]

    def basis(recipe: dict) -> tuple:
        return (
            recipe.get("servings"),
            tuple(
                (
                    component.get("name"),
                    tuple(component.get("steps") or []),
                    tuple(
                        tuple(
                            str(item.get(key) or "").strip()
                            for key in ("name", "quantity", "unit", "notes")
                        )
                        for item in component.get("ingredients") or []
                    ),
                )
                for component in recipe.get("components") or []
            ),
        )

    unchanged = basis(old) == basis(result)
    for before, after in zip(records(old), records(result)):
        if unchanged and "quantityEstimate" not in after and valid_quantity_estimate(before):
            after["quantityEstimate"] = valid_quantity_estimate(before)
    if not unchanged:
        for ingredient in records(result):
            ingredient.pop("quantityEstimate", None)
    # A title/tag edit cannot clear a source-completeness warning. Deliberate
    # ingredient/method changes can form a new human-authored cooking basis.
    if old.get("sourceIncomplete") is True:

        def structure(recipe: dict) -> tuple:
            return (
                tuple(
                    sorted(
                        str(step).strip().casefold()
                        for component in recipe.get("components") or []
                        for step in component.get("steps") or []
                    )
                ),
                tuple(
                    sorted(
                        str(item.get("name") or "").strip().casefold() for item in records(recipe)
                    )
                ),
            )

        result["sourceIncomplete"] = structure(old) == structure(result)
    result["ingredients"] = records(result)
    return normalize_recipe_estimates(result)
