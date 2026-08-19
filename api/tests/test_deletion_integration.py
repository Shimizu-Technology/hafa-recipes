"""PostgreSQL integration coverage for authoritative local deletion."""

import asyncio
import os
from datetime import date

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.deletion_cleanup as cleanup
import app.media_lifecycle as media_lifecycle
from app.auth import ClerkUser
from app.config import Settings
from app.db.database import Base
from app.deletion_cleanup import DurableDeletionCleanupWorker, hash_auth_identity
from app.models.deletion import DeletedAuthIdentity, DeletionCleanupJob
from app.models.grocery import GroceryList, GroceryListInvite, GroceryListMember
from app.models.identity import AppUser, ClerkIdentity
from app.models.meal_plan import MealPlanEntry
from app.models.recipe import ExtractionJob, Recipe, RecipeVersion
from app.routers.recipes import delete_recipe
from app.routers.users import delete_account

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@pytest.fixture
async def deletion_database():
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield sessions
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()


def _user(user_id: str = "stable_user") -> ClerkUser:
    return ClerkUser(
        id=user_id,
        clerk_user_id="clerk_subject",
        clerk_issuer="https://development.clerk.accounts.dev",
        clerk_environment="development",
    )


def _recipe(owner: str, title: str) -> Recipe:
    return Recipe(
        source_url="manual://test",
        source_type="manual",
        extracted={"title": title},
        user_id=owner,
        is_public=False,
    )


def _cleanup_settings() -> Settings:
    return Settings(
        database_url="postgresql://localhost/hafa_recipes_codex_durable_test",
        database_use_ssl=False,
        openai_api_key="test-openai-key",
        clerk_development_issuer="https://development.clerk.accounts.dev",
        clerk_development_secret_key="development-secret",
    )


@pytest.mark.asyncio
async def test_account_delete_commits_local_erasure_with_cleanup_intent(
    deletion_database,
):
    issuer = "https://development.clerk.accounts.dev"
    async with deletion_database() as db:
        db.add(AppUser(id="stable_user"))
        db.add(
            ClerkIdentity(
                app_user_id="stable_user",
                issuer=issuer,
                clerk_user_id="clerk_subject",
            )
        )
        owned_recipe = _recipe("stable_user", "Owned")
        other_recipe = _recipe("other_user", "Other")
        db.add_all([owned_recipe, other_recipe])
        await db.flush()
        other_version = RecipeVersion(
            recipe_id=other_recipe.id,
            version_number=1,
            extracted={"title": "Other"},
            change_type="edit",
            created_by="stable_user",
        )
        grocery_list = GroceryList(name="Shared")
        db.add_all([other_version, grocery_list])
        await db.flush()
        db.add(
            GroceryListMember(
                list_id=grocery_list.id,
                user_id="stable_user",
                display_name="Deleted Chef",
            )
        )
        db.add(
            GroceryListInvite(
                list_id=grocery_list.id,
                invite_code="DELETE-ME",
                created_by="other_user",
                accepted_by="stable_user",
            )
        )
        await db.commit()
        owned_recipe_id = owned_recipe.id
        other_version_id = other_version.id

        response = await delete_account(db=db, user=_user())

        assert response["cleanup"]["status"] == "queued"
        assert response["deleted"]["recipes"] == 1
        assert await db.get(AppUser, "stable_user") is None
        assert await db.get(Recipe, owned_recipe_id) is None
        remaining_version = await db.get(RecipeVersion, other_version_id)
        assert remaining_version is not None
        assert remaining_version.created_by is None
        assert await db.scalar(select(func.count()).select_from(GroceryListInvite)) == 0

        cleanup_job = await db.scalar(
            select(DeletionCleanupJob).where(
                DeletionCleanupJob.kind == "account",
                DeletionCleanupJob.app_user_id == "stable_user",
            )
        )
        assert cleanup_job is not None
        assert cleanup_job.clerk_identities == [
            {"issuer": issuer, "clerk_user_id": "clerk_subject"}
        ]
        assert f"thumbnails/{owned_recipe_id}/" in cleanup_job.storage_prefixes
        assert "chat-images/stable_user/" in cleanup_job.storage_prefixes
        tombstone = await db.scalar(select(DeletedAuthIdentity))
        assert tombstone is not None
        assert tombstone.clerk_user_id_hash == hash_auth_identity(
            issuer, "clerk_subject"
        )


@pytest.mark.asyncio
async def test_recipe_delete_removes_dependents_and_queues_all_media_keys(
    deletion_database,
):
    async with deletion_database() as db:
        db.add(AppUser(id="stable_user"))
        recipe = _recipe("stable_user", "Delete me")
        db.add(recipe)
        await db.flush()
        recipe_id = recipe.id
        db.add(
            MealPlanEntry(
                user_id="stable_user",
                date=date(2026, 8, 19),
                meal_type="dinner",
                recipe_id=recipe_id,
                recipe_title="Delete me",
            )
        )
        db.add(
            ExtractionJob(
                url="re-extract:test",
                user_id="stable_user",
                location="Guam",
                notes="",
                target_recipe_id=recipe_id,
            )
        )
        await db.commit()

        response = await delete_recipe(recipe_id=recipe_id, db=db, user=_user())

        assert response["cleanup"]["status"] == "queued"
        assert await db.get(Recipe, recipe_id) is None
        assert await db.scalar(select(func.count()).select_from(MealPlanEntry)) == 0
        assert await db.scalar(select(func.count()).select_from(ExtractionJob)) == 0
        cleanup_job = await db.scalar(
            select(DeletionCleanupJob).where(DeletionCleanupJob.kind == "recipe")
        )
        assert cleanup_job.storage_prefixes == [
            f"thumbnails/{recipe_id}.",
            f"thumbnails/{recipe_id}/",
        ]


@pytest.mark.asyncio
async def test_worker_completes_and_minimizes_external_target_snapshots(
    deletion_database,
    monkeypatch,
):
    recipe_id = "11111111-1111-4111-8111-111111111111"
    deleted_prefixes = []
    deleted_subjects = []

    class FakeStorage:
        is_enabled = True

        async def delete_prefix(self, prefix):
            deleted_prefixes.append(prefix)
            return 1

    class FakeClerk:
        def __init__(self, _environment, *, timeout):
            pass

        async def delete_user(self, subject):
            deleted_subjects.append(subject)
            return True

    monkeypatch.setattr(cleanup, "AsyncSessionLocal", deletion_database)
    monkeypatch.setattr(cleanup, "settings", _cleanup_settings())
    monkeypatch.setattr(cleanup, "storage_service", FakeStorage())
    monkeypatch.setattr(cleanup, "ClerkBackendClient", FakeClerk)
    worker = DurableDeletionCleanupWorker()

    async with deletion_database() as db:
        job = DeletionCleanupJob(
            kind="account",
            app_user_id="deleted_user",
            clerk_identities=[
                {
                    "issuer": "https://development.clerk.accounts.dev",
                    "clerk_user_id": "clerk_subject",
                }
            ],
            storage_prefixes=[f"thumbnails/{recipe_id}/"],
            clerk_target_count=1,
            storage_prefix_count=1,
        )
        db.add(job)
        await db.commit()
        job_id = job.id

    assert await worker.claim_next_job() == job_id
    await worker.execute_claimed_job(job_id)

    async with deletion_database() as db:
        completed = await db.get(DeletionCleanupJob, job_id)
        assert completed.status == "completed"
        assert completed.clerk_identities == []
        assert completed.storage_prefixes == []
        assert completed.completed_at is not None
    assert deleted_prefixes == [f"thumbnails/{recipe_id}/"]
    assert deleted_subjects == ["clerk_subject"]


@pytest.mark.asyncio
async def test_worker_retries_failed_storage_after_still_attempting_clerk(
    deletion_database,
    monkeypatch,
):
    recipe_id = "22222222-2222-4222-8222-222222222222"
    deleted_subjects = []

    class FailingStorage:
        is_enabled = True

        async def delete_prefix(self, _prefix):
            raise RuntimeError("temporary storage outage")

    class FakeClerk:
        def __init__(self, _environment, *, timeout):
            pass

        async def delete_user(self, subject):
            deleted_subjects.append(subject)
            return True

    monkeypatch.setattr(cleanup, "AsyncSessionLocal", deletion_database)
    monkeypatch.setattr(cleanup, "settings", _cleanup_settings())
    monkeypatch.setattr(cleanup, "storage_service", FailingStorage())
    monkeypatch.setattr(cleanup, "ClerkBackendClient", FakeClerk)
    monkeypatch.setattr(cleanup.sentry_sdk, "capture_exception", lambda _error: None)
    worker = DurableDeletionCleanupWorker()

    async with deletion_database() as db:
        job = DeletionCleanupJob(
            kind="account",
            app_user_id="deleted_user",
            clerk_identities=[
                {
                    "issuer": "https://development.clerk.accounts.dev",
                    "clerk_user_id": "clerk_subject",
                }
            ],
            storage_prefixes=[f"thumbnails/{recipe_id}/"],
            max_attempts=3,
        )
        db.add(job)
        await db.commit()
        job_id = job.id

    assert await worker.claim_next_job() == job_id
    await worker.execute_claimed_job(job_id)

    async with deletion_database() as db:
        retrying = await db.get(DeletionCleanupJob, job_id)
        assert retrying.status == "queued"
        assert retrying.attempt_count == 1
        assert retrying.next_attempt_at is not None
        assert retrying.storage_prefixes == [f"thumbnails/{recipe_id}/"]
    assert deleted_subjects == ["clerk_subject"]


@pytest.mark.asyncio
async def test_recipe_delete_waits_for_upload_and_blocks_late_uploads(
    deletion_database,
    monkeypatch,
):
    monkeypatch.setattr(
        media_lifecycle,
        "AsyncSessionLocal",
        deletion_database,
    )
    async with deletion_database() as setup:
        setup.add(AppUser(id="stable_user"))
        recipe = _recipe("stable_user", "Race-safe")
        setup.add(recipe)
        await setup.commit()
        recipe_id = recipe.id

    async def delete_in_separate_transaction():
        async with deletion_database() as db:
            return await delete_recipe(recipe_id=recipe_id, db=db, user=_user())

    async with media_lifecycle.recipe_media_upload_guard(recipe_id) as recipe_exists:
        assert recipe_exists is True
        deletion_task = asyncio.create_task(delete_in_separate_transaction())
        await asyncio.sleep(0.1)
        assert deletion_task.done() is False

    response = await deletion_task
    assert response["cleanup"]["status"] == "queued"

    async with media_lifecycle.recipe_media_upload_guard(recipe_id) as recipe_exists:
        assert recipe_exists is False
