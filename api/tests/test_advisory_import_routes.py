"""Import entry points save usable recipes with advisory warnings and visibility."""

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from app.auth import ClerkUser
from app.models.recipe import ExtractionJob, Recipe
from app.recipe_review import apply_recipe_review
from app.routers import extract, recipes


def _user():
    return ClerkUser(
        id="stable_owner", clerk_user_id="clerk_owner",
        clerk_issuer="https://clerk.example.test", clerk_environment="test",
    )


def _data():
    return {
        "title": "Rice", "sourceUrl": "https://example.test/rice",
        "components": [{"name": "Main", "ingredients": [
            {"name": "rice", "quantity": None, "unit": "cups"},
        ], "steps": ["Cook until tender."]}],
        "lowConfidence": True, "confidenceWarning": "The cooking time was unclear.",
    }


def _database(result=None):
    db = AsyncMock()
    saved = []
    db.add = Mock(side_effect=saved.append)
    db.execute.return_value = SimpleNamespace(scalar_one_or_none=lambda: result)

    async def refresh(recipe):
        recipe.id = recipe.id or uuid4()
        recipe.created_at = datetime.now(UTC)
        recipe.moderation_status = "active"

    async def flush():
        for item in saved:
            if isinstance(item, Recipe):
                await refresh(item)

    db.refresh.side_effect = refresh
    db.flush.side_effect = flush
    return db, saved


def _assert_advisory(recipe, public):
    assert recipe.review_state == "needs_review"
    assert recipe.is_public is public
    assert recipe.user_id == "stable_owner"
    assert recipe.extraction_evidence["assessment"]["userReviewed"] is False
    assert {issue["code"] for issue in recipe.extraction_evidence["assessment"]["issues"]} == {
        "missing_quantity", "source_warning",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("source_type", ["photo", "text"])
@pytest.mark.parametrize("public", [False, True])
async def test_capture_autosave_retains_uncertainty_without_claiming_review(monkeypatch, source_type, public):
    db, saved = _database()
    disclosure = AsyncMock()
    monkeypatch.setattr(recipes, "require_current_publishing_disclosure", disclosure)
    response = await recipes._save_captured_recipe(
        recipes.CaptureRecipeCreate(extracted=_data(), is_public=public, source_type=source_type),
        db, _user(),
    )
    _assert_advisory(saved[0], public)
    assert response.is_public is public
    assert disclosure.await_count == int(public)
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("background", [False, True])
@pytest.mark.parametrize("public", [False, True])
async def test_video_import_sync_and_job_save_advisory_recipes(monkeypatch, background, public):
    job = ExtractionJob(id=uuid4(), status="extracting", lease_token="owned-lease")
    db, saved = _database(job if background else None)
    monkeypatch.setattr(extract.video_service, "normalize_url", AsyncMock(side_effect=lambda url: url))
    monkeypatch.setattr(extract.video_service, "detect_platform", lambda _url: "youtube")
    monkeypatch.setattr(extract.recipe_extractor, "extract", AsyncMock(return_value=SimpleNamespace(
        success=True, recipe=_data(), raw_text="recipe source", thumbnail_url=None,
        extraction_method="whisper", extraction_quality="good", has_audio_transcript=True,
        source_evidence=None, low_confidence=True, confidence_warning="The cooking time was unclear.",
    )))
    disclosure = AsyncMock()
    monkeypatch.setattr(extract, "require_current_publishing_disclosure", disclosure)
    url = "https://www.youtube.com/watch?v=test123"
    if background:
        db.__aenter__.return_value = db
        monkeypatch.setattr("app.db.database.AsyncSessionLocal", lambda: db)
        await extract.run_extraction_job(
            str(job.id), url, "Guam", "", _user().id,
            is_public=public, lease_token="owned-lease",
        )
        assert job.status == "completed"
        assert job.low_confidence is True
        assert job.recipe_id == saved[0].id
    else:
        await extract.extract_recipe(extract.ExtractRequest(url=url, is_public=public), db, _user())
    _assert_advisory(saved[0], public)
    assert disclosure.await_count == int(public)


@pytest.mark.asyncio
@pytest.mark.parametrize("multipart", [False, True])
async def test_edit_routes_resolve_only_selected_warning_at_snapshot_revision(monkeypatch, multipart):
    recipe = Recipe(
        id=uuid4(), source_type="youtube", source_url="https://example.test/rice",
        user_id="stable_owner", is_public=False, extraction_method="whisper",
        extraction_quality="good", has_audio_transcript=True,
    )
    apply_recipe_review(recipe, _data())
    warning = next(issue for issue in recipe.extraction_evidence["assessment"]["issues"] if issue["code"] == "source_warning")
    db, _saved = _database(recipe)
    monkeypatch.setattr(recipes, "create_recipe_version", AsyncMock())
    payload = {
        "title": "Rice", "components": _data()["components"],
        "review_content_revision": 1, "verified_paths": [],
        "resolved_issue_ids": [warning["id"]],
    }
    if multipart:
        result = await recipes.edit_recipe_with_image(recipe.id, json.dumps(payload), None, db, _user())
    else:
        result = await recipes.edit_recipe(recipe.id, recipes.RecipeEdit(**payload), db, _user())
    assert result.review_state == "needs_review"
    assert result.is_public is False
    assert result.content_revision == 2
    assessment = result.extraction_evidence["assessment"]
    assert [issue["code"] for issue in assessment["issues"]] == ["missing_quantity"]
    assert assessment["verifiedFieldCount"] == 0
    assert assessment["userReviewed"] is False
    db.commit.assert_awaited_once()
