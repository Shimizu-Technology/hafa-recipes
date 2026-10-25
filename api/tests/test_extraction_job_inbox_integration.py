import asyncio
import os
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import ClerkUser
from app.db.database import Base
from app.models import ai, deletion, grocery, identity, meal_plan, moderation  # noqa: F401
from app.models import recipe as recipe_models  # noqa: F401
from app.models.identity import AppUser
from app.models.recipe import ExtractionJob, Recipe
from app.routers.extract import (
    cancel_job,
    get_job_status,
    list_extraction_jobs,
    run_extraction_job,
    save_failed_extraction_as_draft,
)
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
                "Some details may need a quick check before cooking."
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


@pytest_asyncio.fixture
async def cancellation_sessions():
    assert TEST_DATABASE_URL
    require_disposable_test_database(TEST_DATABASE_URL)
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            db.add_all([AppUser(id="cancel_owner"), AppUser(id="cancel_other")])
            await db.commit()
        yield sessions
    finally:
        await engine.dispose()


def _cancel_fixture(status):
    return ExtractionJob(
        url="https://example.com/same-source", user_id="cancel_owner",
        job_kind="extract", status=status, current_step="extracting", progress=30,
        lease_token="old-worker-lease", leased_until=datetime.now(UTC) + timedelta(minutes=1),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["queued", "claimed", "processing", "failed", "expired"])
async def test_cancel_retires_only_owned_attempt_and_is_idempotent(cancellation_sessions, status):
    async with cancellation_sessions() as db:
        selected, same_source = _cancel_fixture(status), _cancel_fixture(status)
        db.add_all([selected, same_source])
        await db.commit()
        with pytest.raises(HTTPException) as forbidden:
            await cancel_job(selected.id, db=db, user=_user("cancel_other"))
        assert forbidden.value.status_code == 404
        await db.rollback()
        await db.refresh(selected)
        await db.refresh(same_source)
        selected_id, same_source_id = selected.id, same_source.id
        response = await cancel_job(selected_id, db=db, user=_user("cancel_owner"))
        assert response["job_id"] == str(selected_id)
        await db.refresh(selected)
        completed_at = selected.completed_at
        assert selected.status == "cancelled"
        assert selected.lease_token is None and selected.leased_until is None
        assert selected.next_attempt_at is None
        assert await cancel_job(selected_id, db=db, user=_user("cancel_owner")) == response
        await db.refresh(selected)
        assert selected.completed_at == completed_at
        await db.refresh(same_source)
        assert same_source.status == status
        assert same_source.lease_token == "old-worker-lease"
        inbox = await list_extraction_jobs(limit=8, active_only=False, include_cancelled=False,
                                          job_kind="extract", db=db, user=_user("cancel_owner"))
        assert [job.id for job in inbox] == [same_source_id]
        assert await db.scalar(select(func.count()).select_from(Recipe)) == 0
        with pytest.raises(HTTPException) as forbidden:
            await cancel_job(selected_id, db=db, user=_user("cancel_other"))
        assert forbidden.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["failed", "expired", "completed", "processing"])
async def test_cancel_preserves_saved_drafts_and_completed_recipes(cancellation_sessions, status):
    async with cancellation_sessions() as db:
        job = _cancel_fixture("failed")
        db.add(job)
        await db.commit()
        saved = await save_failed_extraction_as_draft(job.id, db=db, user=_user("cancel_owner"))
        recipe_id = job.recipe_id
        recipe = await db.get(Recipe, recipe_id)
        original = dict(recipe.extracted)
        job.status = status
        await db.commit()
        with pytest.raises(HTTPException) as rejected:
            await cancel_job(job.id, db=db, user=_user("cancel_owner"))
        assert rejected.value.status_code == 400
        await db.refresh(job)
        await db.refresh(recipe)
        assert job.status == status and str(job.recipe_id) == saved["recipe_id"]
        assert recipe.extracted == original and recipe.user_id == "cancel_owner"
        assert recipe.is_public is False


@pytest.mark.asyncio
@pytest.mark.parametrize("held_stage", ["extraction", "nutrition"])
async def test_cancel_fences_late_worker_recipe_persistence(cancellation_sessions, monkeypatch, held_stage):
    import app.db.database as database_module

    started, finish = asyncio.Event(), asyncio.Event()

    async def extract(**_kwargs):
        if held_stage == "extraction":
            started.set()
            await finish.wait()
        return SimpleNamespace(success=True, recipe={"title": "Late recipe", "components": []},
                               low_confidence=False, extraction_method="website-jsonld")

    async def nutrition(recipe, **_kwargs):
        started.set()
        await finish.wait()
        return recipe

    monkeypatch.setattr(database_module, "AsyncSessionLocal", cancellation_sessions)
    monkeypatch.setattr("app.routers.extract.video_service.detect_platform", lambda _url: "web")
    monkeypatch.setattr("app.services.website.website_service.extract", extract)
    monkeypatch.setattr("app.routers.extract.enrich_nutrition", nutrition)
    async with cancellation_sessions() as db:
        job = _cancel_fixture("processing")
        db.add(job)
        await db.commit()
        job_id = job.id
    worker = asyncio.create_task(run_extraction_job(str(job_id), "https://example.com/same-source",
                                 "Guam", "", "cancel_owner", lease_token="old-worker-lease"))
    try:
        await asyncio.wait_for(started.wait(), timeout=5)
        async with cancellation_sessions() as db:
            await cancel_job(job_id, db=db, user=_user("cancel_owner"))
        finish.set()
        await asyncio.wait_for(worker, timeout=5)
        async with cancellation_sessions() as db:
            job = await db.get(ExtractionJob, job_id)
            assert job.status == "cancelled" and job.recipe_id is None
            assert job.lease_token is None
            assert await db.scalar(select(func.count()).select_from(Recipe)) == 0
    finally:
        finish.set()
        await worker


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["processing", "failed", "completed", "cancelled"])
async def test_request_key_recovery_is_exact_and_owner_scoped(cancellation_sessions, status):
    owner, other = _user("cancel_owner"), _user("cancel_other")
    async with cancellation_sessions() as db:
        own = ExtractionJob(url="https://example.test/claimed", user_id=owner.id,
            idempotency_key="share:lost-confirmation", status=status)
        foreign = ExtractionJob(url="https://example.test/foreign", user_id=other.id,
            idempotency_key="share:lost-confirmation", status="processing")
        sibling = ExtractionJob(url=own.url, user_id=owner.id,
            idempotency_key="share:another-attempt", status="failed")
        db.add_all([own, foreign, sibling])
        await db.commit()
        recovered = await list_extraction_jobs(limit=1, include_cancelled=True,
            job_kind="extract", idempotency_key="share:lost-confirmation", db=db, user=owner)
        assert [job.id for job in recovered] == [own.id]
        assert recovered[0].status == status
        assert await list_extraction_jobs(idempotency_key="share:missing", db=db, user=owner) == []


def _saved_retry_recipe(owner_id, url, **kwargs):
    return Recipe(
        source_url=url, source_type="website", user_id=owner_id, is_public=False,
        extracted={"title": "Saved retry", "ingredients": [], "steps": []},
        extraction_method="website-jsonld", review_state="needs_review", **kwargs,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["failed", "expired"])
@pytest.mark.parametrize("failed_url,saved_url", [
    ("https://www.instagram.com/reel/F4retry/?igshid=old", "https://instagram.com/reel/F4retry/"),
    ("https://youtu.be/f4retry123?si=old", "https://www.youtube.com/watch?v=f4retry123"),
    ("https://example.test/recipe/?utm_source=old", "https://example.test/recipe"),
])
async def test_successful_retry_suppresses_only_activity_not_durable_recovery(
    cancellation_sessions, status, failed_url, saved_url,
):
    owner = _user("cancel_owner")
    now = datetime.now(UTC)
    async with cancellation_sessions() as db:
        failed = ExtractionJob(
            url=failed_url, user_id=owner.id, status=status, job_kind="extract",
            notes="Keep my source notes", idempotency_key="share:original-failure",
            created_at=now - timedelta(hours=1),
        )
        db.add(failed)
        await db.commit()
        assert [job.id for job in await list_extraction_jobs(db=db, user=owner)] == [failed.id]

        recipe = _saved_retry_recipe(owner.id, saved_url)
        db.add(recipe)
        await db.flush()
        success = ExtractionJob(
            url=saved_url, user_id=owner.id, status="completed", job_kind="extract",
            recipe_id=recipe.id, created_at=now, completed_at=now,
        )
        db.add(success)
        await db.commit()
        for limit in (1, 8, 20):
            visible = await list_extraction_jobs(
                limit=limit, job_kind="extract", include_cancelled=False, db=db, user=owner,
            )
            assert [job.id for job in visible] == [success.id]
            assert visible[0].recipe_id == recipe.id
            assert visible[0].review_state == "needs_review"
        recovered = await list_extraction_jobs(
            idempotency_key="share:original-failure", db=db, user=owner,
        )
        assert [job.id for job in recovered] == [failed.id]
        direct = await get_job_status(failed.id, db=db, user=owner)
        assert direct.status == status and direct.can_save_draft
        assert direct.notes == "Keep my source notes"
        await db.refresh(failed)
        assert failed.status == status and failed.recipe_id is None
        assert await db.scalar(select(func.count()).select_from(Recipe)) == 1
        await db.refresh(recipe)
        assert recipe.extracted["title"] == "Saved retry" and recipe.is_public is False


@pytest.mark.asyncio
@pytest.mark.parametrize("preserve_reason", [
    "older_success", "same_time", "different_source", "foreign_success", "foreign_recipe",
    "missing_recipe", "wrong_recipe_source", "source_draft", "incomplete_recipe",
    "reextraction", "completed_without_success", "saved_failure", "active_import",
    "failed_reextraction", "unkeyed_source",
])
async def test_retry_activity_preserves_unsuperseded_attempts(cancellation_sessions, preserve_reason):
    owner = _user("cancel_owner")
    now = datetime.now(UTC)
    url = "https://example.test/recipe"
    async with cancellation_sessions() as db:
        recipe = _saved_retry_recipe(owner.id, url)
        failed = ExtractionJob(
            url=url, user_id=owner.id, status="failed", job_kind="extract",
            created_at=now - timedelta(hours=1),
        )
        success = ExtractionJob(
            url=url, user_id=owner.id, status="completed", job_kind="extract",
            created_at=now, completed_at=now,
        )
        if preserve_reason == "older_success":
            success.created_at = now - timedelta(hours=2)
        elif preserve_reason == "same_time":
            success.created_at = failed.created_at
        elif preserve_reason == "different_source":
            failed.url = "https://example.test/another-recipe"
        elif preserve_reason == "foreign_success":
            success.user_id = recipe.user_id = "cancel_other"
        elif preserve_reason == "foreign_recipe":
            recipe.user_id = "cancel_other"
        elif preserve_reason == "wrong_recipe_source":
            recipe.source_url = "https://example.test/another-recipe"
        elif preserve_reason == "source_draft":
            recipe.extraction_method = "source-draft"
        elif preserve_reason == "incomplete_recipe":
            recipe.review_state = "source_incomplete"
        elif preserve_reason == "reextraction":
            success.job_kind = "reextract"
        elif preserve_reason == "completed_without_success":
            success.status = "processing"
        elif preserve_reason == "active_import":
            failed.status = "processing"
        elif preserve_reason == "failed_reextraction":
            failed.job_kind = "reextract"
        elif preserve_reason == "unkeyed_source":
            failed.url = success.url = recipe.source_url = "manual://recipe"
        db.add(recipe)
        await db.flush()
        if preserve_reason != "missing_recipe":
            success.recipe_id = recipe.id
        if preserve_reason == "saved_failure":
            failed.recipe_id = recipe.id
        db.add_all([failed, success])
        await db.commit()

        visible = await list_extraction_jobs(db=db, user=owner)
        assert failed.id in [job.id for job in visible]
        if preserve_reason == "active_import":
            active = await list_extraction_jobs(active_only=True, db=db, user=owner)
            assert [job.id for job in active] == [failed.id]
        await db.refresh(failed)
        assert failed.status == ("processing" if preserve_reason == "active_import" else "failed")
        assert await db.scalar(select(func.count()).select_from(Recipe)) == 1
