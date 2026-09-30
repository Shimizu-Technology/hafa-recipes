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
from app.services.video import VideoMetadata, VideoThumbnailResult


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
    source_thumbnail = "https://instagram.example.test/temporary.jpg"
    recipe_data = {**_data(), "media": {"thumbnail": source_thumbnail}}
    monkeypatch.setattr(extract.recipe_extractor, "extract", AsyncMock(return_value=SimpleNamespace(
        success=True, recipe=recipe_data, raw_text="recipe source", thumbnail_url=source_thumbnail,
        extraction_method="whisper", extraction_quality="good", has_audio_transcript=True,
        source_evidence=None, low_confidence=True, confidence_warning="The cooking time was unclear.",
    )))
    upload_thumbnail = AsyncMock(return_value=None)
    monkeypatch.setattr(extract, "_upload_video_thumbnail", upload_thumbnail)
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
    assert saved[0].thumbnail_url is None
    assert "thumbnail" not in saved[0].extracted.get("media", {})
    upload_thumbnail.assert_awaited_once_with(
        source_url=url,
        candidate_url=source_thumbnail,
        recipe_id=str(saved[0].id),
    )
    assert disclosure.await_count == int(public)


@pytest.mark.asyncio
async def test_video_thumbnail_refreshes_stale_platform_url(monkeypatch):
    first = "https://ipv6-only.example.test/temporary.jpg"
    refreshed = "https://ipv4.example.test/refreshed.jpg"
    monkeypatch.setattr(
        type(extract.storage_service),
        "is_enabled",
        property(lambda _service: True),
    )
    upload = AsyncMock(side_effect=[None, "https://media.example.test/hero.webp"])
    monkeypatch.setattr(extract.storage_service, "upload_thumbnail_from_url", upload)
    monkeypatch.setattr(
        extract.video_service,
        "get_video_metadata_ytdlp",
        AsyncMock(return_value=VideoMetadata(thumbnail=refreshed)),
    )
    frame = AsyncMock()
    monkeypatch.setattr(extract.video_service, "extract_thumbnail_frame", frame)

    result = await extract._upload_video_thumbnail(
        source_url="https://www.instagram.com/reel/example/",
        candidate_url=first,
        recipe_id="recipe-id",
    )

    assert result == "https://media.example.test/hero.webp"
    assert upload.await_args_list[0].args == (first, "recipe-id")
    assert upload.await_args_list[1].args == (refreshed, "recipe-id")
    frame.assert_not_awaited()


@pytest.mark.asyncio
async def test_video_thumbnail_falls_back_to_a_source_frame(monkeypatch):
    candidate = "https://ipv6-only.example.test/temporary.jpg"
    monkeypatch.setattr(
        type(extract.storage_service),
        "is_enabled",
        property(lambda _service: True),
    )
    monkeypatch.setattr(
        extract.storage_service,
        "upload_thumbnail_from_url",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        extract.video_service,
        "get_video_metadata_ytdlp",
        AsyncMock(return_value=VideoMetadata(thumbnail=candidate)),
    )
    monkeypatch.setattr(
        extract.video_service,
        "extract_thumbnail_frame",
        AsyncMock(
            return_value=VideoThumbnailResult(success=True, image_data=b"jpeg")
        ),
    )
    upload_bytes = AsyncMock(return_value="https://media.example.test/frame.webp")
    monkeypatch.setattr(extract.storage_service, "upload_thumbnail_from_bytes", upload_bytes)

    result = await extract._upload_video_thumbnail(
        source_url="https://www.instagram.com/reel/example/",
        candidate_url=candidate,
        recipe_id="recipe-id",
    )

    assert result == "https://media.example.test/frame.webp"
    upload_bytes.assert_awaited_once_with(b"jpeg", "recipe-id", "image/jpeg")


@pytest.mark.asyncio
async def test_video_thumbnail_skips_recovery_without_storage(monkeypatch):
    monkeypatch.setattr(
        type(extract.storage_service),
        "is_enabled",
        property(lambda _service: False),
    )
    metadata = AsyncMock()
    frame = AsyncMock()
    monkeypatch.setattr(extract.video_service, "get_video_metadata_ytdlp", metadata)
    monkeypatch.setattr(extract.video_service, "extract_thumbnail_frame", frame)

    result = await extract._upload_video_thumbnail(
        source_url="https://www.instagram.com/reel/example/",
        candidate_url="https://instagram.example.test/temporary.jpg",
        recipe_id="recipe-id",
    )

    assert result is None
    metadata.assert_not_awaited()
    frame.assert_not_awaited()


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
