"""Deterministic recipe readiness and privacy-bounded extraction evidence."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException

ReviewState = Literal["source_incomplete", "needs_review", "ready"]

EVIDENCE_VERSION = 2
EXPLICIT_FLEXIBLE_QUANTITIES = (
    "to taste",
    "as needed",
    "as desired",
    "for garnish",
    "optional",
)
NULLISH_SOURCE_VALUES = {"", "null", "none", "n/a", "not stated", "unknown"}
_SOURCE_EVIDENCE_UNSET = object()
_PREVIOUS_EVIDENCE_UNSET = object()


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

    if value is None:
        return False
    return str(value).strip().lower() not in NULLISH_SOURCE_VALUES


def is_missing_quantity(value: object) -> bool:
    """Return whether a source quantity is absent or a serialized null sentinel."""

    return not _has_stated_source_value(value)


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


def _normalized_review_value(value: object) -> object:
    """Normalize harmless serialization differences before comparing revisions."""

    if not _has_stated_source_value(value):
        return None
    return value.strip() if isinstance(value, str) else value


def _review_fields(extracted: dict) -> tuple[list[dict], dict[str, object]]:
    """Build privacy-safe field evidence plus an in-memory comparison map."""

    fields: list[dict] = []
    values: dict[str, object] = {}

    def add_field(
        path: str,
        value: object,
        *,
        status: str = "supported",
        quantity_status: str | None = None,
    ) -> None:
        field = {"path": path, "status": status}
        if quantity_status is not None:
            field["quantityStatus"] = quantity_status
        fields.append(field)
        values[path] = _normalized_review_value(value)

    if _has_stated_source_value(extracted.get("title")):
        add_field("title", extracted.get("title"))
    if _has_stated_source_value(extracted.get("servings")):
        add_field("servings", extracted.get("servings"))

    times = extracted.get("times")
    if isinstance(times, dict):
        for key in ("prep", "cook", "total"):
            if _has_stated_source_value(times.get(key)):
                add_field(f"times.{key}", times.get(key))

    for component_index, component in enumerate(_components(extracted)):
        ingredients = component.get("ingredients") or []
        for ingredient_index, ingredient in enumerate(ingredients):
            if not isinstance(ingredient, dict) or not _has_stated_source_value(
                ingredient.get("name")
            ):
                continue
            prefix = f"components.{component_index}.ingredients.{ingredient_index}"
            add_field(f"{prefix}.name", ingredient.get("name"))

            has_quantity = _has_stated_source_value(ingredient.get("quantity"))
            flexible = _has_explicit_flexible_quantity(ingredient)
            quantity_status = "supported" if has_quantity or flexible else "not_stated"
            add_field(
                f"{prefix}.quantity",
                ingredient.get("quantity"),
                status=quantity_status,
                quantity_status=quantity_status,
            )
            if _has_stated_source_value(ingredient.get("unit")):
                add_field(f"{prefix}.unit", ingredient.get("unit"))

        for step_index, step in enumerate(component.get("steps") or []):
            if _has_stated_source_value(step):
                add_field(
                    f"components.{component_index}.steps.{step_index}",
                    step,
                )

    return fields, values


def evidence_user_verified_paths(evidence: dict | None) -> set[str]:
    """Return only exact v2 paths explicitly recorded as user verified."""

    if not isinstance(evidence, dict) or evidence.get("version") != EVIDENCE_VERSION:
        return set()
    fields = evidence.get("fields")
    if not isinstance(fields, list):
        return set()
    return {
        field["path"]
        for field in fields
        if isinstance(field, dict)
        and isinstance(field.get("path"), str)
        and field.get("status") == "user_verified"
    }


def evidence_uses_field_review(evidence: dict | None) -> bool:
    """Return whether evidence follows the current granular review protocol."""

    return isinstance(evidence, dict) and evidence.get("version") == EVIDENCE_VERSION


def reviewable_recipe_paths(extracted: dict) -> set[str]:
    """Return the current allowlisted paths without exposing their values."""

    _, values = _review_fields(extracted)
    return set(values)


def _record_siblings(path: str, values: dict[str, object]) -> tuple[tuple, ...]:
    """Return an ingredient field with the identity-bearing fields beside it."""

    parts = path.split(".")
    if (
        len(parts) == 5
        and parts[0] == "components"
        and parts[2] == "ingredients"
        and parts[4] in {"name", "quantity", "unit"}
    ):
        prefix = ".".join(parts[:4])
        return tuple(
            (sibling, f"{prefix}.{sibling}" in values, values.get(f"{prefix}.{sibling}"))
            for sibling in ("name", "quantity", "unit")
        )
    return ((path, path in values, values.get(path)),)


def _source_provenance(source_evidence: dict | None) -> dict:
    """Allow only privacy-safe modality and frame timestamp provenance."""

    if not isinstance(source_evidence, dict):
        return {}
    allowed_modalities = {
        "metadata",
        "audio_transcript",
        "video_frames",
        "slideshow_images",
        "website_data",
        "manual",
    }
    raw_modalities = source_evidence.get("modalities")
    if not isinstance(raw_modalities, list):
        raw_modalities = []
    modalities = [
        value
        for value in raw_modalities
        if isinstance(value, str) and value in allowed_modalities
    ]
    raw_frames = source_evidence.get("frames")
    if not isinstance(raw_frames, list):
        raw_frames = []
    frames = []
    for frame in raw_frames[:12]:
        if not isinstance(frame, dict):
            continue
        timestamp = frame.get("timestampSeconds")
        if isinstance(timestamp, (int, float)) and 0 <= timestamp <= 14_400:
            frames.append({"timestampSeconds": round(float(timestamp), 2)})
    provenance = {}
    if modalities:
        provenance["modalities"] = list(dict.fromkeys(modalities))
    if frames:
        provenance["frames"] = frames
    if source_evidence.get("sourceArtifactsRetained") is False:
        provenance["sourceArtifactsRetained"] = False
    return provenance


def assess_recipe_review(
    extracted: dict,
    *,
    source_type: str,
    extraction_method: str | None,
    content_revision: int,
    user_reviewed: bool = False,
    source_evidence: dict | None = None,
    previous_extracted: dict | None = None,
    previous_evidence: dict | None = None,
    verified_paths: Collection[str] | None = None,
) -> ReviewAssessment:
    """Assess cooking readiness without pretending that absence is evidence.

    ``user_reviewed`` means a human reviewed the editable draft. It never turns
    a structurally incomplete recipe into a ready one.
    """

    components = _components(extracted)
    ingredient_count = sum(
        1
        for component in components
        for ingredient in component.get("ingredients") or []
        if isinstance(ingredient, dict)
        and _has_stated_source_value(ingredient.get("name"))
    )
    step_count = sum(
        1
        for component in components
        for step in component.get("steps") or []
        if _has_stated_source_value(step)
    )
    field_evidence, current_values = _review_fields(extracted)

    is_direct_human_entry = source_type == "manual" and extraction_method == "manual"
    verified: set[str] = set()
    if user_reviewed or is_direct_human_entry:
        verified = set(current_values)
    elif verified_paths is not None:
        requested = set(verified_paths)
        unknown = sorted(requested - current_values.keys())
        if unknown:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "INVALID_RECIPE_REVIEW_PATH",
                    "message": "One or more review fields are not part of this recipe revision.",
                    "paths": unknown[:10],
                },
            )

        previous_values: dict[str, object] = {}
        if previous_extracted is not None:
            _, previous_values = _review_fields(previous_extracted)
        prior_verified = evidence_user_verified_paths(previous_evidence)
        if (
            isinstance(previous_evidence, dict)
            and previous_evidence.get("version") != EVIDENCE_VERSION
            and evidence_was_user_reviewed(previous_evidence)
        ):
            prior_verified = set(previous_values)

        if prior_verified and previous_extracted is None:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "MISSING_PREVIOUS_RECIPE_REVISION",
                    "message": "Previous recipe content is required to carry review status.",
                },
            )

        carried = {
            path
            for path in prior_verified
            if path in current_values
            and path in previous_values
            and current_values[path] == previous_values[path]
            and _record_siblings(path, current_values)
            == _record_siblings(path, previous_values)
        }
        # Positional recipe paths can shift after a reorder or deletion. Only
        # the client knows which current fields the person actually corrected;
        # inferring that every positional difference was reviewed would clear
        # unrelated warnings. The client therefore submits corrected and
        # explicitly accepted paths together in ``verified_paths``.
        verified = requested | carried

    for field in field_evidence:
        if field["path"] in verified:
            field["status"] = "user_verified"

    missing_quantity_count = sum(
        field.get("quantityStatus") == "not_stated" for field in field_evidence
    )
    unresolved_missing_quantity_count = sum(
        field.get("quantityStatus") == "not_stated"
        and field.get("status") != "user_verified"
        for field in field_evidence
    )
    verified_field_count = sum(
        field.get("status") == "user_verified" for field in field_evidence
    )
    unverified_field_count = len(field_evidence) - verified_field_count
    reasons: list[str] = []
    if ingredient_count == 0:
        reasons.append("No ingredients were found in the source.")
    if step_count == 0:
        reasons.append("No cooking instructions were found in the source.")

    source_incomplete = ingredient_count == 0 or step_count == 0
    is_exact_website_recipe = source_type == "website" and extraction_method in {
        "json-ld",
        "schema.org",
        "website-jsonld",
    }
    fully_verified_by_person = (
        bool(field_evidence) and unverified_field_count == 0
    ) or is_direct_human_entry
    model_reported_uncertainty = extracted.get("lowConfidence") is True

    if source_incomplete:
        state: ReviewState = "source_incomplete"
        summary = "Source incomplete — save it now and add the missing details when you can."
    elif (
        fully_verified_by_person
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
        reasons.append("The imported details have not been fully verified by a person yet.")
        if unresolved_missing_quantity_count:
            reasons.append(
                f"{unresolved_missing_quantity_count} ingredient "
                f"{'quantity is' if unresolved_missing_quantity_count == 1 else 'quantities are'} not stated."
            )
        if model_reported_uncertainty and extracted.get("confidenceWarning"):
            reasons.append(str(extracted["confidenceWarning"]).strip())
        summary = "Needs review — compare the draft with the original before cooking."

    uncertainty_count = _count_uncertainties(
        reasons,
        unresolved_missing_quantity_count,
    )
    source = {
        "type": source_type,
        "method": extraction_method,
        **_source_provenance(source_evidence),
    }
    evidence = {
        "version": EVIDENCE_VERSION,
        "contentRevision": content_revision,
        "source": source,
        "assessment": {
            "ingredientCount": ingredient_count,
            "stepCount": step_count,
            "missingQuantityCount": missing_quantity_count,
            "unresolvedMissingQuantityCount": unresolved_missing_quantity_count,
            "verifiedFieldCount": verified_field_count,
            "unverifiedFieldCount": unverified_field_count,
            "uncertaintyCount": uncertainty_count,
            "userReviewed": fully_verified_by_person,
            "reasons": reasons,
        },
        "fields": field_evidence,
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


def evidence_source_provenance(evidence: dict | None) -> dict | None:
    """Recover validated provenance when restoring a historical version."""

    if not isinstance(evidence, dict):
        return None
    source = evidence.get("source")
    if not isinstance(source, dict):
        return None
    provenance = _source_provenance(source)
    return provenance or None


def apply_recipe_review(
    recipe,
    extracted: dict,
    *,
    user_reviewed: bool = False,
    increment_revision: bool = False,
    source_evidence: dict | None | object = _SOURCE_EVIDENCE_UNSET,
    previous_extracted: dict | None = None,
    previous_evidence: dict | None | object = _PREVIOUS_EVIDENCE_UNSET,
    verified_paths: Collection[str] | None = None,
) -> ReviewAssessment:
    """Persist a new deterministic assessment and old-client warning fields."""

    revision = int(getattr(recipe, "content_revision", None) or 1)
    if previous_evidence is _PREVIOUS_EVIDENCE_UNSET:
        previous_evidence = getattr(recipe, "extraction_evidence", None)
    if increment_revision:
        revision += 1
    if source_evidence is _SOURCE_EVIDENCE_UNSET:
        source_evidence = evidence_source_provenance(
            getattr(recipe, "extraction_evidence", None)
        )
    elif not isinstance(source_evidence, dict):
        source_evidence = None
    assessment = assess_recipe_review(
        extracted,
        source_type=recipe.source_type,
        extraction_method=recipe.extraction_method,
        content_revision=revision,
        user_reviewed=user_reviewed,
        source_evidence=source_evidence,
        previous_extracted=previous_extracted,
        previous_evidence=previous_evidence,
        verified_paths=verified_paths,
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
