import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser
from app.db.database import Base
from app.models import ai, deletion, grocery, identity, meal_plan, moderation  # noqa: F401
from app.models import recipe as recipe_models  # noqa: F401
from app.models.identity import AppUser
from app.models.recipe import ExtractionJob, Recipe
from app.routers.extract import list_extraction_jobs
from tests.database_safety import require_disposable_test_database

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
async def test_job_inbox_is_owner_scoped_ordered_filterable_and_review_aware():
    assert TEST_DATABASE_URL
    require_disposable_test_database(TEST_DATABASE_URL)
    engine = create_async_engine(TEST_DATABASE_URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    owner = _user("inbox_owner")
    other = _user("other_owner")
    now = datetime.now(UTC)

    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.run_sync(Base.metadata.create_all)

        async with sessions() as db:
            db.add_all([AppUser(id=owner.id), AppUser(id=other.id)])
            review_recipe = Recipe(
                source_url="https://www.youtube.com/watch?v=review",
                source_type="youtube",
                extracted={
                    "title": "Review me",
                    "sourceUrl": "https://www.youtube.com/watch?v=review",
                    "components": [],
                    "ingredients": [],
                    "steps": [],
                    "nutrition": {"perServing": {}, "total": {}},
                },
                user_id=owner.id,
                is_public=False,
                review_state="needs_review",
            )
            db.add(review_recipe)
            await db.flush()

            completed = ExtractionJob(
                url=review_recipe.source_url,
                user_id=owner.id,
                job_kind="extract",
                status="completed",
                progress=100,
                current_step="complete",
                message="Done",
                recipe_id=review_recipe.id,
                created_at=now - timedelta(hours=3),
                updated_at=now - timedelta(hours=2),
                completed_at=now - timedelta(hours=2),
            )
            failed = ExtractionJob(
                url="https://example.com/failed",
                user_id=owner.id,
                job_kind="extract",
                location="Hawaii",
                notes="Use the caption measurements",
                requested_is_public=True,
                status="failed",
                progress=35,
                current_step="error",
                message="Needs attention",
                error_message="Could not read the page",
                created_at=now - timedelta(hours=1),
                updated_at=now - timedelta(hours=1),
                completed_at=now - timedelta(hours=1),
            )
            active_reextract = ExtractionJob(
                url="https://example.com/reextract",
                user_id=owner.id,
                job_kind="reextract",
                status="processing",
                progress=45,
                current_step="extracting",
                message="Extracting",
                target_recipe_id=review_recipe.id,
                created_at=now,
                updated_at=now,
            )
            other_job = ExtractionJob(
                url="https://example.com/private-to-other-user",
                user_id=other.id,
                job_kind="extract",
                status="processing",
                progress=50,
                current_step="extracting",
                message="Extracting",
                created_at=now + timedelta(minutes=1),
                updated_at=now + timedelta(minutes=1),
            )
            cancelled = ExtractionJob(
                url="https://example.com/cancelled",
                user_id=owner.id,
                job_kind="extract",
                status="cancelled",
                progress=10,
                current_step="cancelled",
                message="Cancelled",
                created_at=now + timedelta(minutes=2),
                updated_at=now + timedelta(minutes=2),
                completed_at=now + timedelta(minutes=2),
            )
            db.add_all([completed, failed, active_reextract, other_job, cancelled])
            await db.commit()

            link_imports = await list_extraction_jobs(
                limit=8,
                active_only=False,
                include_cancelled=False,
                job_kind="extract",
                db=db,
                user=owner,
            )
            assert [str(job.id) for job in link_imports] == [str(failed.id), str(completed.id)]
            assert all("private-to-other-user" not in job.url for job in link_imports)
            assert link_imports[0].location == "Hawaii"
            assert link_imports[0].notes == "Use the caption measurements"
            assert link_imports[0].requested_is_public is True
            assert link_imports[1].review_state == "needs_review"
            assert link_imports[1].review_summary == (
                "Needs review — compare the draft with the original before cooking."
            )
            assert link_imports[1].created_at == completed.created_at

            active_jobs = await list_extraction_jobs(
                limit=1,
                active_only=True,
                include_cancelled=True,
                job_kind=None,
                db=db,
                user=owner,
            )
            assert len(active_jobs) == 1
            assert active_jobs[0].id == active_reextract.id
            assert active_jobs[0].job_kind == "reextract"
    finally:
        await engine.dispose()
