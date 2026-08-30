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
                structured_extracted,
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
            assert evidence_was_user_reviewed(structured_recipe.extraction_evidence) is False
    finally:
        require_disposable_test_database(TEST_DATABASE_URL)
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
