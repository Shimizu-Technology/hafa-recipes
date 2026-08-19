"""End-to-end PostgreSQL coverage for the moderation domain workflow."""

import importlib
import os
from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser
from app.db.database import Base
from app.models import ai, deletion, grocery, identity, meal_plan, moderation, recipe  # noqa: F401
from app.models.identity import AppUser
from app.models.meal_plan import MealPlanEntry
from app.models.moderation import AdminAuditEvent
from app.models.recipe import (
    Collection,
    CollectionRecipe,
    ExtractionJob,
    Recipe,
    SavedRecipe,
)
from app.public_identity import public_contributor_id
from app.routers.admin import (
    AdminReason,
    RecipeModerationUpdate,
    ReportReviewUpdate,
    moderate_recipe,
    retry_job,
    review_report,
)
from app.routers.admin import (
    cancel_job as admin_cancel_job,
)
from app.routers.collections import get_collection_recipes, get_collections
from app.routers.community_safety import ReportCreate, block_contributor, create_report
from app.routers.meal_plans import get_week_plan
from app.routers.recipes import get_public_recipes, get_saved_recipes

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


def _user(user_id: str, role: str | None = None) -> ClerkUser:
    return ClerkUser(
        id=user_id,
        clerk_user_id=f"clerk_{user_id}",
        clerk_issuer="https://clerk.example.test",
        clerk_environment="test",
        role=role,
    )


@pytest.mark.asyncio
async def test_report_block_moderate_and_recover_workflow(monkeypatch):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    reporter = _user("workflow_reporter")
    contributor = _user("workflow_contributor")
    admin = _user("workflow_admin", "admin")
    recipe_id = uuid4()
    job_id = uuid4()
    collection_id = uuid4()

    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.run_sync(Base.metadata.create_all)

        for module_name in (
            "migrations.020_add_database_invariants",
            "migrations.021_add_ai_invocation_provenance",
            "migrations.022_add_admin_moderation",
        ):
            migration = importlib.import_module(module_name)
            monkeypatch.setattr(migration, "engine", engine)
            await migration.run_migration()

        async with sessions() as db:
            db.add_all(
                [AppUser(id=reporter.id), AppUser(id=contributor.id), AppUser(id=admin.id)]
            )
            db.add(
                Recipe(
                    id=recipe_id,
                    source_url="https://example.com/private/path?token=secret",
                    source_type="website",
                    extracted={"title": "Workflow recipe", "tags": [], "times": {}},
                    user_id=contributor.id,
                    extractor_display_name="Workflow Cook",
                    is_public=True,
                )
            )
            db.add(
                ExtractionJob(
                    id=job_id,
                    url="https://example.com/private/path?token=secret",
                    user_id=contributor.id,
                    location="Guam",
                    notes="private notes",
                    status="failed",
                    job_kind="extract",
                    progress=0,
                    current_step="error",
                    message="failed",
                    estimated_duration=60,
                    error_code="TIMEOUT",
                    attempt_count=3,
                    max_attempts=3,
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
            )
            await db.flush()
            db.add(SavedRecipe(user_id=reporter.id, recipe_id=recipe_id))
            db.add(
                Collection(
                    id=collection_id,
                    user_id=reporter.id,
                    name="Workflow collection",
                )
            )
            await db.flush()
            db.add(
                CollectionRecipe(collection_id=collection_id, recipe_id=recipe_id)
            )
            db.add(
                MealPlanEntry(
                    user_id=reporter.id,
                    date=date.today(),
                    meal_type="dinner",
                    recipe_id=recipe_id,
                    recipe_title="Workflow recipe",
                )
            )
            await db.commit()

            visible = await get_public_recipes(
                limit=20,
                offset=0,
                source_type="website",
                sort="recent",
                extractor_id=None,
                meal_type=None,
                db=db,
                user=None,
            )
            assert visible.total == 1

            report = await create_report(
                ReportCreate(
                    target_type="recipe",
                    recipe_id=recipe_id,
                    category="spam",
                    details="Synthetic integration report",
                ),
                db,
                reporter,
            )
            assert report.target_id == str(recipe_id)
            await block_contributor(public_contributor_id(contributor.id), db, reporter)
            blocked_view = await get_public_recipes(
                limit=20,
                offset=0,
                source_type="website",
                sort="recent",
                extractor_id=None,
                meal_type=None,
                db=db,
                user=reporter,
            )
            assert blocked_view.total == 0
            saved_view = await get_saved_recipes(20, 0, db, reporter)
            assert saved_view.total == 0
            collections = await get_collections(reporter, db)
            assert collections[0].recipe_count == 0
            assert await get_collection_recipes(str(collection_id), reporter, db) == []
            week = await get_week_plan(date.today(), db, reporter)
            assert not any(
                day.breakfast or day.lunch or day.dinner or day.snack
                for day in week.days
            )

            await review_report(
                report.id,
                ReportReviewUpdate(
                    status="resolved", reason="Synthetic report reviewed"
                ),
                db,
                admin,
            )
            await moderate_recipe(
                recipe_id,
                RecipeModerationUpdate(
                    moderation_status="hidden",
                    is_featured=False,
                    featured_order=None,
                    reason="Synthetic moderation hold",
                ),
                db,
                admin,
            )
            hidden_view = await get_public_recipes(
                limit=20,
                offset=0,
                source_type="website",
                sort="recent",
                extractor_id=None,
                meal_type=None,
                db=db,
                user=None,
            )
            assert hidden_view.total == 0

            retried = await retry_job(
                job_id, AdminReason(reason="Synthetic recovery retry"), db, admin
            )
            assert retried.status == "queued"
            cancelled = await admin_cancel_job(
                job_id, AdminReason(reason="Synthetic recovery cancel"), db, admin
            )
            assert cancelled.status == "cancelled"
            assert await db.scalar(select(func.count(AdminAuditEvent.id))) == 4
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
