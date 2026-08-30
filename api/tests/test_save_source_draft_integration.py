import os
from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser
from app.db.database import Base
from app.models import ai, deletion, grocery, identity, meal_plan, moderation, recipe  # noqa: F401
from app.models.identity import AppUser
from app.models.recipe import ExtractionJob, Recipe
from app.routers.extract import save_failed_extraction_as_draft

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


def _user(user_id: str) -> ClerkUser:
    return ClerkUser(
        id=user_id,
        clerk_user_id=f"clerk_{user_id}",
        clerk_issuer="https://clerk.example.test",
        clerk_environment="test",
    )


@pytest.mark.asyncio
async def test_failed_source_draft_is_private_empty_idempotent_and_owner_scoped():
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    owner = _user("draft_owner")
    other = _user("other_owner")

    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.run_sync(Base.metadata.create_all)

        async with sessions() as db:
            db.add_all([AppUser(id=owner.id), AppUser(id=other.id)])
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
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
