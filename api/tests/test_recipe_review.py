from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.recipe_review import (
    apply_recipe_review,
    assess_recipe_review,
    evidence_source_provenance,
    evidence_was_user_reviewed,
    require_recipe_publishable,
    review_response_fields,
)
from app.routers.recipes import (
    ManualComponent,
    RecipeEdit,
    _review_paths_for_edit,
    _serialize_edit_components,
)


def _recipe_data(
    *, quantity: str | int | None = "2", steps: list[str] | None = None
) -> dict:
    """Build the smallest component recipe used by readiness tests."""

    ingredient = {"name": "rice", "quantity": quantity, "unit": "cups"}
    return {
        "title": "Red Rice",
        "components": [
            {
                "name": "Main",
                "ingredients": [ingredient],
                "steps": ["Cook the rice."] if steps is None else steps,
            }
        ],
    }


def _field(evidence: dict, path: str) -> dict:
    """Return one field from the privacy-safe evidence envelope."""

    matches = [field for field in evidence["fields"] if field["path"] == path]
    assert matches, f"no evidence field for path {path}"
    return matches[0]


def test_imported_recipe_requires_review_even_when_it_looks_complete():
    """Model-derived imports remain unverified until a person reviews them."""

    assessment = assess_recipe_review(
        _recipe_data(),
        source_type="tiktok",
        extraction_method="whisper",
        content_revision=1,
    )

    assert assessment.state == "needs_review"
    assert assessment.evidence["contentRevision"] == 1
    assert "raw_text" not in assessment.evidence


def test_structurally_incomplete_source_can_be_saved_but_not_published():
    """Incomplete sources remain editable and private."""

    recipe = SimpleNamespace(
        source_type="tiktok",
        extraction_method="source-draft",
        content_revision=1,
        is_public=True,
    )

    assessment = apply_recipe_review(
        recipe,
        {"title": "Saved TikTok recipe", "components": []},
    )

    assert assessment.state == "source_incomplete"
    assert recipe.is_public is False
    assert recipe.extracted["lowConfidence"] is True
    with pytest.raises(HTTPException) as error:
        require_recipe_publishable(recipe)
    assert error.value.status_code == 409


def test_missing_quantity_is_not_rewritten_as_to_taste():
    """Absent evidence stays absent instead of becoming flexible language."""

    assessment = assess_recipe_review(
        _recipe_data(quantity=None),
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )

    field = _field(
        assessment.evidence,
        "components.0.ingredients.0.quantity",
    )
    assert field["quantityStatus"] == "not_stated"
    assert assessment.evidence["assessment"]["missingQuantityCount"] == 1
    assert assessment.uncertainty_count == 2


def test_numeric_zero_is_preserved_as_a_stated_quantity():
    """A numeric zero is source content, not an empty-value sentinel."""

    assessment = assess_recipe_review(
        _recipe_data(quantity=0),
        source_type="website",
        extraction_method="json-ld",
        content_revision=1,
    )

    quantity = _field(
        assessment.evidence,
        "components.0.ingredients.0.quantity",
    )
    assert quantity["quantityStatus"] == "supported"
    assert assessment.evidence["assessment"]["missingQuantityCount"] == 0


def test_each_missing_quantity_is_counted_once():
    """The aggregate reason must not double-count its individual missing fields."""

    extracted = _recipe_data(quantity=None)
    extracted["components"][0]["ingredients"].append(
        {"name": "water", "quantity": None, "unit": None}
    )
    assessment = assess_recipe_review(
        extracted,
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )

    assert assessment.evidence["assessment"]["missingQuantityCount"] == 2
    assert assessment.evidence["assessment"]["uncertaintyCount"] == 3
    assert assessment.uncertainty_count == 3


def test_serialized_null_values_are_not_treated_as_recipe_evidence():
    """Provider string sentinels must not make an incomplete recipe look complete."""

    missing_quantity = assess_recipe_review(
        _recipe_data(quantity="null"),
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )
    missing_steps = assess_recipe_review(
        _recipe_data(steps=[None, "null"]),  # type: ignore[list-item]
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )

    assert missing_quantity.evidence["assessment"]["missingQuantityCount"] == 1
    assert missing_steps.state == "source_incomplete"


def test_explicit_to_taste_is_supported_source_language():
    """Literal flexible language is preserved as supported source evidence."""

    assessment = assess_recipe_review(
        _recipe_data(quantity="to taste"),
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )

    assert _field(
        assessment.evidence,
        "components.0.ingredients.0.quantity",
    )["quantityStatus"] == "supported"


def test_structured_website_with_unstated_quantity_still_needs_review():
    """Structured markup is not exact enough when a cooking amount is absent."""

    assessment = assess_recipe_review(
        _recipe_data(quantity=None),
        source_type="website",
        extraction_method="website-jsonld",
        content_revision=1,
    )

    assert assessment.state == "needs_review"
    assert assessment.evidence["assessment"]["missingQuantityCount"] == 1


def test_structured_website_with_reported_uncertainty_still_needs_review():
    """A parser confidence warning overrides the structured-source shortcut."""

    extracted = _recipe_data()
    extracted["lowConfidence"] = True
    extracted["confidenceWarning"] = "Ambiguous ingredient text"
    assessment = assess_recipe_review(
        extracted,
        source_type="website",
        extraction_method="website-jsonld",
        content_revision=1,
    )

    assert assessment.state == "needs_review"


def test_ready_state_alone_does_not_claim_a_person_reviewed_the_recipe():
    """Preserve the distinction between exact structured data and human review."""

    structured = assess_recipe_review(
        _recipe_data(),
        source_type="website",
        extraction_method="website-jsonld",
        content_revision=1,
    )
    reviewed = assess_recipe_review(
        _recipe_data(),
        source_type="tiktok",
        extraction_method="whisper",
        content_revision=1,
        user_reviewed=True,
    )

    assert structured.state == "ready"
    assert evidence_was_user_reviewed(structured.evidence) is False
    assert reviewed.state == "ready"
    assert evidence_was_user_reviewed(reviewed.evidence) is True


def test_field_review_verifies_only_changed_paths_and_keeps_other_warnings():
    """A full-form save must not imply that untouched fields were checked."""

    before = _recipe_data(quantity=None)
    initial = assess_recipe_review(
        before,
        source_type="tiktok",
        extraction_method="whisper",
        content_revision=1,
    )
    after = {**before, "title": "Better Red Rice"}

    reviewed = assess_recipe_review(
        after,
        source_type="tiktok",
        extraction_method="whisper",
        content_revision=2,
        previous_extracted=before,
        previous_evidence=initial.evidence,
        verified_paths={"title"},
    )

    assert reviewed.state == "needs_review"
    assert _field(reviewed.evidence, "title")["status"] == "user_verified"
    assert _field(
        reviewed.evidence,
        "components.0.ingredients.0.quantity",
    )["status"] == "not_stated"
    assert _field(
        reviewed.evidence,
        "components.0.steps.0",
    )["status"] == "supported"
    assert reviewed.evidence["assessment"]["unresolvedMissingQuantityCount"] == 1


def test_unchanged_field_review_does_not_make_an_import_ready():
    """Opening and saving the editor is not evidence of human verification."""

    extracted = _recipe_data()
    initial = assess_recipe_review(
        extracted,
        source_type="instagram",
        extraction_method="basic",
        content_revision=1,
    )

    reviewed = assess_recipe_review(
        extracted,
        source_type="instagram",
        extraction_method="basic",
        content_revision=2,
        previous_extracted=extracted,
        previous_evidence=initial.evidence,
        verified_paths=set(),
    )

    assert reviewed.state == "needs_review"
    assert reviewed.evidence["assessment"]["verifiedFieldCount"] == 0
    assert reviewed.evidence["assessment"]["userReviewed"] is False


def test_explicitly_accepted_missing_quantity_stays_honest_and_can_be_ready():
    """Acceptance resolves review work without inventing a source amount."""

    extracted = _recipe_data(quantity=None)
    initial = assess_recipe_review(
        extracted,
        source_type="youtube",
        extraction_method="whisper",
        content_revision=1,
    )
    every_path = {field["path"] for field in initial.evidence["fields"]}

    reviewed = assess_recipe_review(
        extracted,
        source_type="youtube",
        extraction_method="whisper",
        content_revision=2,
        previous_extracted=extracted,
        previous_evidence=initial.evidence,
        verified_paths=every_path,
    )

    quantity = _field(
        reviewed.evidence,
        "components.0.ingredients.0.quantity",
    )
    assert reviewed.state == "ready"
    assert quantity == {
        "path": "components.0.ingredients.0.quantity",
        "status": "user_verified",
        "quantityStatus": "not_stated",
    }
    assert reviewed.evidence["assessment"]["missingQuantityCount"] == 1
    assert reviewed.evidence["assessment"]["unresolvedMissingQuantityCount"] == 0


def test_field_review_rejects_paths_outside_the_current_revision():
    """Clients cannot create arbitrary durable verification claims."""

    with pytest.raises(HTTPException) as error:
        assess_recipe_review(
            _recipe_data(),
            source_type="youtube",
            extraction_method="whisper",
            content_revision=2,
            previous_extracted=_recipe_data(),
            verified_paths={"components.9.ingredients.9.quantity"},
        )

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "INVALID_RECIPE_REVIEW_PATH"


def test_field_review_requires_previous_content_to_carry_verified_paths():
    """A v2 verification claim cannot be carried without its source revision."""

    extracted = _recipe_data()
    previous = assess_recipe_review(
        extracted,
        source_type="youtube",
        extraction_method="whisper",
        content_revision=1,
        user_reviewed=True,
    )

    with pytest.raises(HTTPException) as error:
        assess_recipe_review(
            extracted,
            source_type="youtube",
            extraction_method="whisper",
            content_revision=2,
            previous_evidence=previous.evidence,
            verified_paths=set(),
        )

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "MISSING_PREVIOUS_RECIPE_REVISION"


def test_field_review_carries_prior_work_without_blessing_untouched_fields():
    """Prior confirmations and current edits remain path-specific."""

    before = _recipe_data()
    initial = assess_recipe_review(
        before,
        source_type="youtube",
        extraction_method="whisper",
        content_revision=1,
    )
    partially_verified = assess_recipe_review(
        before,
        source_type="youtube",
        extraction_method="whisper",
        content_revision=2,
        previous_extracted=before,
        previous_evidence=initial.evidence,
        verified_paths={"title"},
    )
    after = _recipe_data(steps=["Cook until tender."])

    reassessed = assess_recipe_review(
        after,
        source_type="youtube",
        extraction_method="whisper",
        content_revision=3,
        previous_extracted=before,
        previous_evidence=partially_verified.evidence,
        verified_paths={"components.0.steps.0"},
    )

    assert reassessed.state == "needs_review"
    assert _field(reassessed.evidence, "title")["status"] == "user_verified"
    assert _field(
        reassessed.evidence,
        "components.0.steps.0",
    )["status"] == "user_verified"
    assert _field(
        reassessed.evidence,
        "components.0.ingredients.0.name",
    )["status"] == "supported"


def test_reordering_ingredients_does_not_verify_shifted_paths():
    """A positional move cannot inherit or manufacture review status."""

    before = _recipe_data()
    before["components"][0]["ingredients"].append(
        {"name": "water", "quantity": "2", "unit": "cups"}
    )
    initial = assess_recipe_review(
        before,
        source_type="youtube",
        extraction_method="whisper",
        content_revision=1,
    )
    partially_verified = assess_recipe_review(
        before,
        source_type="youtube",
        extraction_method="whisper",
        content_revision=2,
        previous_extracted=before,
        previous_evidence=initial.evidence,
        verified_paths={"components.0.ingredients.0.quantity"},
    )
    after = _recipe_data()
    after["components"][0]["ingredients"] = list(
        reversed(before["components"][0]["ingredients"])
    )

    reassessed = assess_recipe_review(
        after,
        source_type="youtube",
        extraction_method="whisper",
        content_revision=3,
        previous_extracted=before,
        previous_evidence=partially_verified.evidence,
        verified_paths=set(),
    )

    assert _field(
        reassessed.evidence,
        "components.0.ingredients.0.quantity",
    )["status"] == "supported"
    assert _field(
        reassessed.evidence,
        "components.0.ingredients.1.quantity",
    )["status"] == "supported"


def test_recipe_edit_requires_both_parts_of_the_review_protocol():
    """The revision and explicit path list form one atomic client contract."""

    with pytest.raises(ValueError):
        RecipeEdit(
            title="Red Rice",
            ingredients=[],
            steps=[],
            verified_paths=[],
        )
    with pytest.raises(ValueError):
        RecipeEdit(
            title="Red Rice",
            ingredients=[],
            steps=[],
            review_content_revision=1,
        )


def test_recipe_edit_allows_only_bounded_reviewable_paths():
    """The client contract accepts every field family but no arbitrary paths."""

    supported = [
        "title",
        "servings",
        "times.prep",
        "components.0.steps.0",
        "components.0.ingredients.0.quantity",
    ]
    edit = RecipeEdit(
        title="Red Rice",
        ingredients=[],
        steps=[],
        review_content_revision=1,
        verified_paths=supported,
    )
    assert edit.verified_paths == supported

    with pytest.raises(ValueError):
        RecipeEdit(
            title="Red Rice",
            ingredients=[],
            steps=[],
            review_content_revision=1,
            verified_paths=["notes"],
        )
    with pytest.raises(ValueError):
        RecipeEdit(
            title="Red Rice",
            ingredients=[],
            steps=[],
            review_content_revision=1,
            verified_paths=[f"components.{('1' * 200)}.steps.0"],
        )


def test_field_review_rejects_a_stale_recipe_revision():
    """An older editor snapshot cannot overwrite newer review work."""

    edit = RecipeEdit(
        title="Red Rice",
        ingredients=[],
        steps=[],
        review_content_revision=2,
        verified_paths=[],
    )

    with pytest.raises(HTTPException) as error:
        _review_paths_for_edit(edit, SimpleNamespace(content_revision=3))

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "STALE_RECIPE_REVIEW"
    assert error.value.detail["content_revision"] == 3


def test_review_response_contract_matches_evidence_schema_and_privacy_boundary():
    """Owner responses expose the documented evidence envelope; public ones do not."""

    assessment = assess_recipe_review(
        _recipe_data(quantity=None),
        source_type="tiktok",
        extraction_method="whisper",
        content_revision=3,
    )
    recipe = SimpleNamespace(
        review_state=assessment.state,
        extraction_evidence=assessment.evidence,
        content_revision=3,
    )

    owner_fields = review_response_fields(recipe, include_evidence=True)
    public_fields = review_response_fields(recipe, include_evidence=False)

    assert owner_fields == {
        "review_state": "needs_review",
        "review_summary": "Needs review — compare the draft with the original before cooking.",
        "uncertainty_count": 2,
        "extraction_evidence": assessment.evidence,
        "content_revision": 3,
    }
    assert _field(
        assessment.evidence,
        "components.0.ingredients.0.quantity",
    ) == {
        "path": "components.0.ingredients.0.quantity",
        "status": "not_stated",
        "quantityStatus": "not_stated",
    }
    assert public_fields["extraction_evidence"] is None


def test_human_review_makes_complete_recipe_ready_but_not_incomplete_recipe():
    """Human review cannot replace missing cooking-critical structure."""

    complete = assess_recipe_review(
        _recipe_data(),
        source_type="photo",
        extraction_method="ocr",
        content_revision=2,
        user_reviewed=True,
    )
    incomplete = assess_recipe_review(
        _recipe_data(steps=[]),
        source_type="photo",
        extraction_method="ocr",
        content_revision=2,
        user_reviewed=True,
    )

    assert complete.state == "ready"
    assert incomplete.state == "source_incomplete"


def test_legacy_recipe_remains_publishable_for_old_client_compatibility():
    """Historical rows outside the new contract keep released-client behavior."""

    require_recipe_publishable(SimpleNamespace(review_state=None))


def test_partial_edit_can_be_saved_without_fake_placeholder_content():
    """Editable source drafts may keep empty components without filler content."""

    components = _serialize_edit_components(
        RecipeEdit(
            title="Saved source",
            components=[ManualComponent(name="Main", ingredients=[], steps=[])],
        )
    )

    assert components == [
        {"name": "Main", "ingredients": [], "steps": [], "notes": None}
    ]


def test_video_provenance_is_allowlisted_and_restorable_without_source_content():
    """Evidence may retain timestamps, but never arbitrary text or image payloads."""

    assessment = assess_recipe_review(
        _recipe_data(),
        source_type="youtube",
        extraction_method="whisper+video-frames",
        content_revision=3,
        source_evidence={
            "modalities": ["audio_transcript", "video_frames", "untrusted"],
            "frames": [
                {"timestampSeconds": 2.345},
                {"timestampSeconds": -1},
                {"timestampSeconds": "raw"},
            ],
            "sourceArtifactsRetained": False,
            "rawText": "private recipe text",
            "imageBase64": "private image",
        },
    )

    assert assessment.evidence["source"] == {
        "type": "youtube",
        "method": "whisper+video-frames",
        "modalities": ["audio_transcript", "video_frames"],
        "frames": [{"timestampSeconds": 2.35}],
        "sourceArtifactsRetained": False,
    }
    assert evidence_source_provenance(assessment.evidence) == {
        "modalities": ["audio_transcript", "video_frames"],
        "frames": [{"timestampSeconds": 2.35}],
        "sourceArtifactsRetained": False,
    }


def test_video_provenance_tolerates_null_collections_and_enforces_bounds():
    """Malformed legacy provenance cannot crash review or escape frame bounds."""

    null_collections = assess_recipe_review(
        _recipe_data(),
        source_type="youtube",
        extraction_method="whisper",
        content_revision=1,
        source_evidence={"modalities": None, "frames": None},
    )
    bounded = assess_recipe_review(
        _recipe_data(),
        source_type="youtube",
        extraction_method="whisper+video-frames",
        content_revision=1,
        source_evidence={
            "frames": [
                *({"timestampSeconds": value} for value in range(13)),
                {"timestampSeconds": 14_401},
            ]
        },
    )

    assert "modalities" not in null_collections.evidence["source"]
    assert "frames" not in null_collections.evidence["source"]
    assert bounded.evidence["source"]["frames"] == [
        {"timestampSeconds": float(value)} for value in range(12)
    ]


def test_explicit_none_clears_provenance_while_omission_preserves_it():
    """New content without frame evidence must not inherit stale provenance."""

    existing_evidence = assess_recipe_review(
        _recipe_data(),
        source_type="youtube",
        extraction_method="whisper+video-frames",
        content_revision=1,
        source_evidence={
            "modalities": ["video_frames"],
            "frames": [{"timestampSeconds": 3.5}],
        },
    ).evidence
    preserved = SimpleNamespace(
        source_type="youtube",
        extraction_method="whisper",
        content_revision=1,
        extraction_evidence=existing_evidence,
        is_public=False,
    )
    cleared = SimpleNamespace(
        source_type="youtube",
        extraction_method="whisper",
        content_revision=1,
        extraction_evidence=existing_evidence,
        is_public=False,
    )

    apply_recipe_review(preserved, _recipe_data())
    apply_recipe_review(cleared, _recipe_data(), source_evidence=None)

    assert preserved.extraction_evidence["source"]["frames"] == [
        {"timestampSeconds": 3.5}
    ]
    assert "frames" not in cleared.extraction_evidence["source"]
