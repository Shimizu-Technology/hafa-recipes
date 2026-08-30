"""PostgreSQL coverage for optimistic re-extraction concurrency control."""

import asyncio
import os
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.db.database as database_module
from app.db.database import Base
from app.models import ai, deletion, grocery, identity, meal_plan, moderation, recipe  # noqa: F401
from app.models.identity import AppUser
from app.models.recipe import ExtractionJob, Recipe, RecipeVersion
from app.recipe_review import apply_recipe_review
from app.routers.extract import run_re_extraction_job
from tests.database_safety import require_disposable_test_database

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


def _recipe_data(title: str) -> dict:
    """Return a complete structured website recipe."""

    ingredients = [{"name": "rice", "quantity": "2", "unit": "cups"}]
    steps = ["Cook the rice."]
    return {
        "title": title,
        "sourceUrl": "https://example.com/rice",
        "components": [{
            "name": "Main",
            "ingredients": ingredients,
            "steps": steps,
            "notes": None,
        }],
        "ingredients": ingredients,
        "steps": steps,
        "tags": [],
        "nutrition": {"perServing": {}, "total": {}},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("edit_during_extraction", [True, False])
async def test_reextraction_revision_compare_and_swap(
    monkeypatch,
    edit_during_extraction,
):
    """Reject newer edits while treating a legacy NULL revision as revision one."""

    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    owner_id = "reextract_owner"
    lease_token = "lease-reextract-conflict"
    extraction_started = asyncio.Event()
    finish_extraction = asyncio.Event()

    async def fake_website_extract(**_kwargs):
        extraction_started.set()
        await finish_extraction.wait()
        return SimpleNamespace(
            success=True,
            recipe=_recipe_data("Stale extracted title"),
            raw_text="Structured website recipe",
            thumbnail_url=None,
            extraction_method="website-jsonld",
            extraction_quality="high",
            has_audio_transcript=False,
            low_confidence=False,
            confidence_warning=None,
        )

    try:
        require_disposable_test_database(TEST_DATABASE_URL)
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.run_sync(Base.metadata.create_all)
            if not edit_during_extraction:
                await connection.execute(text(
                    "ALTER TABLE recipes ALTER COLUMN content_revision DROP NOT NULL"
                ))

        async with sessions() as db:
            db.add(AppUser(id=owner_id))
            saved_recipe = Recipe(
                id=uuid4(),
                source_url="https://example.com/rice",
                source_type="website",
                extracted=_recipe_data("Original title"),
                extraction_method="website-jsonld",
                extraction_quality="high",
                has_audio_transcript=False,
                user_id=owner_id,
                is_public=False,
            )
            apply_recipe_review(saved_recipe, saved_recipe.extracted)
            job = ExtractionJob(
                id=uuid4(),
                url=saved_recipe.source_url,
                user_id=owner_id,
                location="Guam",
                status="processing",
                job_kind="reextract",
                target_recipe_id=saved_recipe.id,
                current_step="extracting",
                message="Re-extracting recipe",
                lease_token=lease_token,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            db.add_all([saved_recipe, job])
            await db.commit()
            recipe_id = saved_recipe.id
            job_id = job.id

        if not edit_during_extraction:
            async with engine.begin() as connection:
                await connection.execute(
                    text("UPDATE recipes SET content_revision = NULL WHERE id = :recipe_id"),
                    {"recipe_id": recipe_id},
                )

        monkeypatch.setattr(database_module, "AsyncSessionLocal", sessions)
        monkeypatch.setattr(
            "app.routers.extract.video_service.detect_platform",
            lambda _url: "web",
        )
        monkeypatch.setattr(
            "app.services.website.website_service.extract",
            fake_website_extract,
        )

        worker = asyncio.create_task(
            run_re_extraction_job(
                str(job_id),
                str(recipe_id),
                "https://example.com/rice",
                "Guam",
                owner_id,
                lease_token,
            )
        )
        await asyncio.wait_for(extraction_started.wait(), timeout=5)

        if edit_during_extraction:
            async with sessions() as db:
                edited_recipe = await db.scalar(
                    select(Recipe).where(Recipe.id == recipe_id).with_for_update()
                )
                edited_data = dict(edited_recipe.extracted)
                edited_data["title"] = "Owner's newer edit"
                apply_recipe_review(
                    edited_recipe,
                    edited_data,
                    user_reviewed=True,
                    increment_revision=True,
                )
                await db.commit()

        finish_extraction.set()
        await asyncio.wait_for(worker, timeout=10)

        async with sessions() as db:
            preserved_recipe = await db.get(Recipe, recipe_id)
            failed_job = await db.get(ExtractionJob, job_id)
            version_count = await db.scalar(
                select(func.count()).select_from(RecipeVersion).where(
                    RecipeVersion.recipe_id == recipe_id
                )
            )

            assert preserved_recipe.content_revision == 2
            if edit_during_extraction:
                assert preserved_recipe.extracted["title"] == "Owner's newer edit"
                assert failed_job.status == "failed"
                assert failed_job.error_code == "RECIPE_CHANGED"
                assert "newer edits were preserved" in failed_job.error_message
                assert version_count == 0
            else:
                assert preserved_recipe.extracted["title"] == "Stale extracted title"
                assert failed_job.status == "completed"
                assert failed_job.error_code is None
                assert version_count == 1
    finally:
        finish_extraction.set()
        require_disposable_test_database(TEST_DATABASE_URL)
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
