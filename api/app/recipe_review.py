"""Deterministic recipe readiness and privacy-bounded extraction evidence."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException

ReviewState = Literal["source_incomplete", "needs_review", "ready"]

EVIDENCE_VERSION = 1
EXPLICIT_FLEXIBLE_QUANTITIES = (
    "to taste",
    "as needed",
    "as desired",
    "for garnish",
    "optional",
)
NULLISH_SOURCE_VALUES = {"", "null", "none", "n/a", "not stated", "unknown"}


@dataclass(frozen=True)
class ReviewAssessment:
    state: ReviewState
    summary: str
    uncertainty_count: int
    evidence: dict


def _components(extracted: dict) -> list[dict]:
    """Return canonical components, falling back to legacy flat fields."""

    components = extracted.get("components")
    if isinstance(components, list) and components:
        return [item for item in components if isinstance(item, dict)]
    return [
        {
            "name": "Main",
            "ingredients": extracted.get("ingredients") or [],
            "steps": extracted.get("steps") or [],
        }
    ]


def _has_explicit_flexible_quantity(ingredient: dict) -> bool:
    """Recognize flexible quantity language only when it exists in the source."""

    text = " ".join(
        str(ingredient.get(key) or "")
        for key in ("quantity", "unit", "notes", "name")
    ).lower()
    return any(phrase in text for phrase in EXPLICIT_FLEXIBLE_QUANTITIES)


def _has_stated_source_value(value: object) -> bool:
    """Treat serialized null sentinels as absent source evidence."""

    return str(value or "").strip().lower() not in NULLISH_SOURCE_VALUES


def _count_uncertainties(reasons: list[str], missing_quantity_count: int) -> int:
    """Count each missing field once while retaining other review reasons."""

    has_quantity_summary = (
        any(
            reason.startswith(f"{missing_quantity_count} ingredient ")
            and reason.endswith("not stated.")
            for reason in reasons
        )
        if missing_quantity_count
        else False
    )
    return len(reasons) - int(has_quantity_summary) + missing_quantity_count


def assess_recipe_review(
    extracted: dict,
    *,
    source_type: str,
    extraction_method: str | None,
    content_revision: int,
    user_reviewed: bool = False,
) -> ReviewAssessment:
    """Assess cooking readiness without pretending that absence is evidence.

    ``user_reviewed`` means a human reviewed the editable draft. It never turns
    a structurally incomplete recipe into a ready one.
    """

    components = _components(extracted)
    ingredient_evidence: list[dict] = []
    step_evidence: list[dict] = []
    missing_quantity_count = 0

    for component_index, component in enumerate(components):
        ingredients = component.get("ingredients") or []
        for ingredient_index, ingredient in enumerate(ingredients):
            if not isinstance(ingredient, dict) or not _has_stated_source_value(
                ingredient.get("name")
            ):
                continue
            has_quantity = _has_stated_source_value(ingredient.get("quantity"))
            flexible = _has_explicit_flexible_quantity(ingredient)
            status = "supported" if has_quantity or flexible else "not_stated"
            if status == "not_stated":
                missing_quantity_count += 1
            ingredient_evidence.append(
                {
                    "path": f"components.{component_index}.ingredients.{ingredient_index}",
                    "status": "user_verified" if user_reviewed else status,
                    "quantityStatus": status,
                }
            )

        for step_index, step in enumerate(component.get("steps") or []):
            if _has_stated_source_value(step):
                step_evidence.append(
                    {
                        "path": f"components.{component_index}.steps.{step_index}",
                        "status": "user_verified" if user_reviewed else "supported",
                    }
                )

    ingredient_count = len(ingredient_evidence)
    step_count = len(step_evidence)
    reasons: list[str] = []
    if ingredient_count == 0:
        reasons.append("No ingredients were found in the source.")
    if step_count == 0:
        reasons.append("No cooking instructions were found in the source.")

    source_incomplete = ingredient_count == 0 or step_count == 0
    is_direct_human_entry = source_type == "manual" and extraction_method == "manual"
    is_exact_website_recipe = source_type == "website" and extraction_method in {
        "json-ld",
        "schema.org",
        "website-jsonld",
    }
    model_reported_uncertainty = extracted.get("lowConfidence") is True

    if source_incomplete:
        state: ReviewState = "source_incomplete"
        summary = "Source incomplete — save it now and add the missing details when you can."
    elif (
        user_reviewed
        or is_direct_human_entry
        or (
            is_exact_website_recipe
            and missing_quantity_count == 0
            and not model_reported_uncertainty
        )
    ):
        state = "ready"
        summary = "Ready to cook."
    else:
        state = "needs_review"
        reasons.append("The imported details have not been verified by a person yet.")
        if missing_quantity_count:
            reasons.append(
                f"{missing_quantity_count} ingredient "
                f"{'quantity is' if missing_quantity_count == 1 else 'quantities are'} not stated."
            )
        if model_reported_uncertainty and extracted.get("confidenceWarning"):
            reasons.append(str(extracted["confidenceWarning"]).strip())
        summary = "Needs review — compare the draft with the original before cooking."

    uncertainty_count = _count_uncertainties(reasons, missing_quantity_count)
    evidence = {
        "version": EVIDENCE_VERSION,
        "contentRevision": content_revision,
        "source": {
            "type": source_type,
            "method": extraction_method,
        },
        "assessment": {
            "ingredientCount": ingredient_count,
            "stepCount": step_count,
            "missingQuantityCount": missing_quantity_count,
            "uncertaintyCount": uncertainty_count,
            "userReviewed": user_reviewed or is_direct_human_entry,
            "reasons": reasons,
        },
        "fields": ingredient_evidence + step_evidence,
    }
    return ReviewAssessment(state, summary, uncertainty_count, evidence)


def evidence_was_user_reviewed(evidence: dict | None) -> bool:
    """Return whether durable evidence says a person reviewed this content.

    The field-status fallback supports evidence written by the first release of
    this contract, before ``assessment.userReviewed`` was persisted explicitly.
    A ``ready`` state alone is intentionally insufficient because structured
    website data can be ready without a person reviewing it.
    """

    if not isinstance(evidence, dict):
        return False
    assessment = evidence.get("assessment")
    if isinstance(assessment, dict) and assessment.get("userReviewed") is True:
        return True
    fields = evidence.get("fields")
    return bool(fields) and all(
        isinstance(field, dict) and field.get("status") == "user_verified"
        for field in fields
    )


def evidence_source_method(evidence: dict | None) -> str | None:
    """Read the extraction method from a version's validated evidence envelope."""

    if not isinstance(evidence, dict):
        return None
    source = evidence.get("source")
    if not isinstance(source, dict):
        return None
    method = source.get("method")
    return method.strip() if isinstance(method, str) and method.strip() else None


def apply_recipe_review(
    recipe,
    extracted: dict,
    *,
    user_reviewed: bool = False,
    increment_revision: bool = False,
) -> ReviewAssessment:
    """Persist a new deterministic assessment and old-client warning fields."""

    revision = int(getattr(recipe, "content_revision", None) or 1)
    if increment_revision:
        revision += 1
    assessment = assess_recipe_review(
        extracted,
        source_type=recipe.source_type,
        extraction_method=recipe.extraction_method,
        content_revision=revision,
        user_reviewed=user_reviewed,
    )
    updated = dict(extracted)
    if assessment.state == "ready":
        updated["lowConfidence"] = False
        updated["confidenceWarning"] = None
    else:
        updated["lowConfidence"] = True
        updated["confidenceWarning"] = assessment.summary
    recipe.extracted = updated
    recipe.review_state = assessment.state
    recipe.extraction_evidence = assessment.evidence
    recipe.content_revision = revision
    if assessment.state != "ready":
        recipe.is_public = False
    return assessment


def require_recipe_publishable(recipe) -> None:
    """Allow historical records, but prevent new unreviewed drafts from publishing."""

    if getattr(recipe, "review_state", None) in {"source_incomplete", "needs_review"}:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "RECIPE_REVIEW_REQUIRED",
                "message": "Review and complete this recipe before sharing it to Discover.",
                "review_state": recipe.review_state,
            },
        )


def review_response_fields(recipe, *, include_evidence: bool) -> dict:
    """Return additive response fields without exposing evidence to other users."""

    evidence = getattr(recipe, "extraction_evidence", None) or {}
    assessment = evidence.get("assessment") or {}
    state = getattr(recipe, "review_state", None)
    if state == "source_incomplete":
        summary = "Source incomplete — save it now and add the missing details when you can."
    elif state == "needs_review":
        summary = "Needs review — compare the draft with the original before cooking."
    elif state == "ready":
        summary = "Ready to cook."
    else:
        summary = None
    missing_quantity_count = int(assessment.get("missingQuantityCount") or 0)
    uncertainty_count = assessment.get("uncertaintyCount")
    if not isinstance(uncertainty_count, int):
        uncertainty_count = _count_uncertainties(
            list(assessment.get("reasons") or []),
            missing_quantity_count,
        )
    return {
        "review_state": state,
        "review_summary": summary,
        "uncertainty_count": uncertainty_count,
        "extraction_evidence": evidence if include_evidence and evidence else None,
        "content_revision": int(getattr(recipe, "content_revision", None) or 1),
    }
