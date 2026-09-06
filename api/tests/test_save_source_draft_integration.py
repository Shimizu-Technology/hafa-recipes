import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser
from app.db.database import Base
from app.models import ai, deletion, grocery, identity, meal_plan, moderation, recipe  # noqa: F401
from app.models.identity import AppUser
from app.models.recipe import (
    ExtractionJob,
    Recipe,
    RecipeCorrectionEvent,
    RecipeVersion,
)
from app.publishing import PUBLISHING_DISCLOSURE_VERSION
from app.recipe_review import apply_recipe_review, evidence_was_user_reviewed
from app.routers.extract import save_failed_extraction_as_draft
from app.routers.recipes import (
    RecipeEdit,
    RecipeUpdate,
    edit_recipe,
    restore_original_recipe,
    restore_recipe_version,
    update_recipe,
)
from tests.database_safety import require_disposable_test_database

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


def _user(user_id: str) -> ClerkUser:
    """Build an authenticated principal with distinct stable and Clerk IDs."""

    return ClerkUser(
        id=user_id,
        clerk_user_id=f"clerk_{user_id}",
        clerk_issuer="https://clerk.example.test",
        clerk_environment="test",
    )


@pytest.mark.asyncio
async def test_failed_source_draft_is_private_empty_idempotent_and_owner_scoped():
    """Exercise draft recovery, identity isolation, and trust-preserving edits."""

    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    owner = _user("draft_owner")
    other = _user("other_owner")

    try:
        require_disposable_test_database(TEST_DATABASE_URL)
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.run_sync(Base.metadata.create_all)

        async with sessions() as db:
            db.add_all([
                AppUser(
                    id=owner.id,
                    publishing_disclosure_version=PUBLISHING_DISCLOSURE_VERSION,
                ),
                AppUser(id=other.id),
            ])
            job = ExtractionJob(
                url="https://www.tiktok.com/@cook/video/1234567890123456789",
                user_id=owner.id,
                location="Guam",
                status="failed",
                current_step="error",
                message="Could not read the source",
                error_message="Could not read the source",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            db.add(job)
            await db.commit()

            with pytest.raises(HTTPException) as denied:
                await save_failed_extraction_as_draft(job.id, db, other)
            assert denied.value.status_code == 404

            first = await save_failed_extraction_as_draft(job.id, db, owner)
            second = await save_failed_extraction_as_draft(job.id, db, owner)

            assert first["is_existing"] is False
            assert second == {"recipe_id": first["recipe_id"], "is_existing": True}

            saved = await db.scalar(select(Recipe).where(Recipe.id == job.recipe_id))
            await db.refresh(job)
            assert saved is not None
            assert saved.user_id == owner.id
            assert saved.is_public is False
            assert saved.review_state == "source_incomplete"
            assert saved.raw_text is None
            assert saved.extracted["ingredients"] == []
            assert saved.extracted["steps"] == []
            assert "to taste" not in str(saved.extracted).lower()
            assert job.status == "failed"
            assert str(job.recipe_id) == first["recipe_id"]

            legacy_recipe = Recipe(
                id=uuid4(),
                source_url="manual://legacy",
                source_type="manual",
                extracted={
                    "title": "Legacy recipe",
                    "sourceUrl": "",
                    "components": [{
                        "name": "Main",
                        "ingredients": [{"name": "rice", "quantity": "1", "unit": "cup"}],
                        "steps": ["Cook the rice."],
                    }],
                    "ingredients": [{"name": "rice", "quantity": "1", "unit": "cup"}],
                    "steps": ["Cook the rice."],
                    "tags": [],
                    "nutrition": {"perServing": {}, "total": {}},
                },
                extraction_method="manual",
                has_audio_transcript=False,
                user_id=owner.id,
                is_public=True,
                review_state=None,
            )
            db.add(legacy_recipe)
            await db.commit()

            updated = await update_recipe(
                legacy_recipe.id,
                RecipeUpdate(title="Renamed legacy recipe"),
                db,
                owner,
            )
            assert updated.extracted.title == "Renamed legacy recipe"
            assert updated.is_public is True
            assert updated.review_state is None
            assert legacy_recipe.content_revision == 2
            legacy_event = await db.scalar(
                select(RecipeCorrectionEvent).where(
                    RecipeCorrectionEvent.recipe_id == legacy_recipe.id
                )
            )
            assert legacy_event is not None
            assert legacy_event.event_kind == "customization"
            assert legacy_event.title_changed is True

            uncertain_extracted = {
                "title": "Unverified red rice",
                "sourceUrl": "https://example.com/video",
                "servings": None,
                "times": {"prep": None, "cook": None, "total": None},
                "components": [{
                    "name": "Main",
                    "ingredients": [{"name": "rice", "quantity": None, "unit": None}],
                    "steps": ["Cook the rice."],
                    "notes": None,
                }],
                "equipment": [],
                "notes": None,
                "tags": [],
                "mealTypes": [],
                "nutrition": {"perServing": {}, "total": {}},
            }
            uncertain_recipe = Recipe(
                id=uuid4(),
                source_url="https://example.com/video",
                source_type="youtube",
                extracted=uncertain_extracted,
                extraction_method="whisper",
                has_audio_transcript=True,
                user_id=owner.id,
                is_public=False,
            )
            apply_recipe_review(uncertain_recipe, uncertain_extracted)
            db.add(uncertain_recipe)
            await db.commit()

            corrected = await edit_recipe(
                uncertain_recipe.id,
                RecipeEdit(
                    title="Unverified red rice",
                    ingredients=[{"name": "rice", "quantity": "2", "unit": "cups"}],
                    steps=["Cook the rice."],
                ),
                db,
                owner,
            )
            correction = await db.scalar(
                select(RecipeCorrectionEvent).where(
                    RecipeCorrectionEvent.recipe_id == uncertain_recipe.id
                )
            )
            assert corrected.review_state == "ready"
            assert correction is not None
            assert correction.event_kind == "review_correction"
            assert correction.quantity_change_count == 1
            assert correction.resolved_missing_quantity_count == 1
            assert correction.changed_field_count >= 1

            field_review_recipe = Recipe(
                id=uuid4(),
                source_url="https://example.com/field-review",
                source_type="youtube",
                extracted=uncertain_extracted,
                extraction_method="whisper",
                has_audio_transcript=True,
                user_id=owner.id,
                is_public=False,
            )
            field_review_recipe_id = field_review_recipe.id
            apply_recipe_review(field_review_recipe, uncertain_extracted)
            db.add(field_review_recipe)
            await db.commit()

            partially_reviewed = await edit_recipe(
                field_review_recipe_id,
                RecipeEdit(
                    title="Better unverified red rice",
                    ingredients=[{"name": "rice", "quantity": None, "unit": None}],
                    steps=["Cook the rice."],
                    review_content_revision=1,
                    verified_paths=["title"],
                ),
                db,
                owner,
            )
            assert partially_reviewed.review_state == "needs_review"
            assert partially_reviewed.content_revision == 2
            assert partially_reviewed.extraction_evidence is not None
            amount = next(
                field
                for field in partially_reviewed.extraction_evidence["fields"]
                if field["path"] == "components.0.ingredients.0.quantity"
            )
            assert amount["status"] == "not_stated"

            with pytest.raises(HTTPException) as stale:
                await edit_recipe(
                    field_review_recipe_id,
                    RecipeEdit(
                        title="Stale change",
                        ingredients=[{"name": "rice", "quantity": None, "unit": None}],
                        steps=["Cook the rice."],
                        review_content_revision=1,
                        verified_paths=[],
                    ),
                    db,
                    owner,
                )
            assert stale.value.status_code == 409
            await db.rollback()

            current_paths = [
                field["path"]
                for field in partially_reviewed.extraction_evidence["fields"]
            ]
            fully_reviewed = await edit_recipe(
                field_review_recipe_id,
                RecipeEdit(
                    title="Better unverified red rice",
                    ingredients=[{"name": "rice", "quantity": None, "unit": None}],
                    steps=["Cook the rice."],
                    review_content_revision=2,
                    verified_paths=current_paths,
                ),
                db,
                owner,
            )
            assert fully_reviewed.review_state == "ready"
            assert fully_reviewed.extraction_evidence is not None
            assert fully_reviewed.extraction_evidence["assessment"][
                "missingQuantityCount"
            ] == 1
            assert fully_reviewed.extraction_evidence["assessment"][
                "unresolvedMissingQuantityCount"
            ] == 0

            published = await update_recipe(
                field_review_recipe_id,
                RecipeUpdate(is_public=True),
                db,
                owner,
            )
            assert published.is_public is True
            assert published.review_state == "ready"

            renamed_reviewed = await update_recipe(
                field_review_recipe_id,
                RecipeUpdate(title="Family red rice"),
                db,
                owner,
            )
            assert renamed_reviewed.is_public is True
            assert renamed_reviewed.review_state == "ready"
            assert renamed_reviewed.extracted.title == "Family red rice"
            assert renamed_reviewed.extraction_evidence is not None
            title_evidence = next(
                field
                for field in renamed_reviewed.extraction_evidence["fields"]
                if field["path"] == "title"
            )
            assert title_evidence["status"] == "user_verified"

            reviewed_original_extracted = {
                **uncertain_extracted,
                "title": "Reviewed original recipe",
                "media": {"thumbnail": "https://legacy.example/original.jpg"},
                "components": [{
                    "name": "Main",
                    "ingredients": [
                        {"name": "rice", "quantity": "2", "unit": "cups"}
                    ],
                    "steps": ["Cook the rice."],
                    "notes": None,
                }],
                "ingredients": [
                    {"name": "rice", "quantity": "2", "unit": "cups"}
                ],
            }
            reviewed_original_recipe = Recipe(
                id=uuid4(),
                source_url="https://example.com/reviewed-original",
                source_type="youtube",
                extracted=reviewed_original_extracted,
                extraction_method="whisper",
                has_audio_transcript=True,
                user_id=owner.id,
                is_public=True,
                thumbnail_url="https://media.hafa.example/current-normalized.webp",
            )
            original_assessment = apply_recipe_review(
                reviewed_original_recipe,
                reviewed_original_extracted,
                user_reviewed=True,
            )
            db.add(reviewed_original_recipe)
            await db.flush()
            db.add(
                RecipeVersion(
                    recipe_id=reviewed_original_recipe.id,
                    version_number=1,
                    extracted=reviewed_original_extracted,
                    thumbnail_url="https://legacy.example/original.jpg",
                    review_state=original_assessment.state,
                    extraction_evidence=original_assessment.evidence,
                    content_revision=1,
                    change_type="re-extract",
                    created_by=owner.id,
                )
            )
            reviewed_original_recipe.original_extracted = reviewed_original_extracted
            edited_extracted = {
                **reviewed_original_extracted,
                "title": "Reviewed edited recipe",
                "media": {
                    "thumbnail": "https://media.hafa.example/current-normalized.webp"
                },
            }
            apply_recipe_review(
                reviewed_original_recipe,
                edited_extracted,
                user_reviewed=True,
                increment_revision=True,
            )
            await db.commit()

            restored_original = await restore_original_recipe(
                reviewed_original_recipe.id,
                db,
                owner,
            )
            assert restored_original.extracted.title == "Reviewed original recipe"
            assert restored_original.thumbnail_url == (
                "https://media.hafa.example/current-normalized.webp"
            )
            assert restored_original.extracted.media.thumbnail == (
                "https://media.hafa.example/current-normalized.webp"
            )
            assert restored_original.review_state == "ready"
            assert restored_original.is_public is True
            assert restored_original.extraction_evidence is not None
            assert all(
                field["status"] == "user_verified"
                for field in restored_original.extraction_evidence["fields"]
            )

            partially_verified_original = {
                **reviewed_original_extracted,
                "title": "Partially reviewed original",
            }
            apply_recipe_review(
                reviewed_original_recipe,
                partially_verified_original,
                increment_revision=True,
            )
            partial_original_assessment = apply_recipe_review(
                reviewed_original_recipe,
                partially_verified_original,
                increment_revision=True,
                previous_extracted=partially_verified_original,
                verified_paths={"title"},
            )
            reviewed_original_recipe.original_extracted = partially_verified_original
            db.add(
                RecipeVersion(
                    recipe_id=reviewed_original_recipe.id,
                    version_number=2,
                    extracted=partially_verified_original,
                    review_state=partial_original_assessment.state,
                    extraction_evidence=partial_original_assessment.evidence,
                    content_revision=reviewed_original_recipe.content_revision,
                    change_type="re-extract",
                    created_by=owner.id,
                )
            )
            current_extracted = {
                **reviewed_original_extracted,
                "title": "Current reviewed recipe",
            }
            apply_recipe_review(
                reviewed_original_recipe,
                current_extracted,
                user_reviewed=True,
                increment_revision=True,
            )
            reviewed_original_recipe.is_public = True
            await db.commit()

            restored_partial = await restore_original_recipe(
                reviewed_original_recipe.id,
                db,
                owner,
            )
            assert restored_partial.review_state == "needs_review"
            assert restored_partial.is_public is False
            assert restored_partial.extraction_evidence is not None
            restored_fields = {
                field["path"]: field["status"]
                for field in restored_partial.extraction_evidence["fields"]
            }
            assert restored_fields["title"] == "user_verified"
            assert (
                restored_fields["components.0.ingredients.0.quantity"]
                == "supported"
            )

            structured_extracted = {
                "title": "Structured recipe",
                "sourceUrl": "https://example.com/structured",
                "servings": 4,
                "times": {"prep": "10 minutes", "cook": "20 minutes", "total": "30 minutes"},
                "components": [{
                    "name": "Main",
                    "ingredients": [{"name": "rice", "quantity": "2", "unit": "cups"}],
                    "steps": ["Cook the rice."],
                    "notes": None,
                }],
                "ingredients": [{"name": "rice", "quantity": "2", "unit": "cups"}],
                "steps": ["Cook the rice."],
                "equipment": [],
                "notes": None,
                "tags": [],
                "mealTypes": [],
                "nutrition": {"perServing": {}, "total": {}},
                "media": {"thumbnail": "https://legacy.example/version.jpg"},
            }
            structured_recipe = Recipe(
                id=uuid4(),
                source_url="https://example.com/structured",
                source_type="website",
                extracted=structured_extracted,
                extraction_method="website-jsonld",
                has_audio_transcript=False,
                user_id=owner.id,
                is_public=False,
                thumbnail_url="https://media.hafa.example/structured-current.webp",
            )
            initial_review = apply_recipe_review(structured_recipe, structured_extracted)
            db.add(structured_recipe)
            await db.commit()

            assert initial_review.state == "ready"
            assert evidence_was_user_reviewed(structured_recipe.extraction_evidence) is False

            renamed = await update_recipe(
                structured_recipe.id,
                RecipeUpdate(title="Renamed structured recipe"),
                db,
                owner,
            )
            assert renamed.review_state == "ready"
            assert evidence_was_user_reviewed(structured_recipe.extraction_evidence) is False

            version = RecipeVersion(
                recipe_id=structured_recipe.id,
                version_number=1,
                extracted=structured_extracted,
                thumbnail_url="https://legacy.example/version.jpg",
                review_state=initial_review.state,
                extraction_evidence=initial_review.evidence,
                content_revision=1,
                change_type="edit",
                created_by=owner.id,
            )
            db.add(version)
            structured_recipe.extraction_method = "website-ai"
            apply_recipe_review(
                structured_recipe,
                {
                    **structured_extracted,
                    "media": {
                        "thumbnail": (
                            "https://media.hafa.example/structured-current.webp"
                        )
                    },
                },
                increment_revision=True,
            )
            await db.commit()

            restored = await restore_recipe_version(
                structured_recipe.id,
                version.id,
                db,
                owner,
            )
            assert restored.review_state == "ready"
            assert structured_recipe.extraction_method == "website-jsonld"
            assert structured_recipe.thumbnail_url == (
                "https://media.hafa.example/structured-current.webp"
            )
            assert restored.extracted.media.thumbnail == (
                "https://media.hafa.example/structured-current.webp"
            )
            assert evidence_was_user_reviewed(structured_recipe.extraction_evidence) is False
    finally:
        require_disposable_test_database(TEST_DATABASE_URL)
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
