"""Real PostgreSQL fencing/recovery; source/provider/S3 transports are controlled."""

import asyncio
import base64
import io
import json
import os
import threading
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from PIL import Image, ImageDraw
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import cover_jobs, job_worker
from app.auth import ClerkUser
from app.db.database import Base
from app.image_validation import validate_image_bytes
from app.media_lifecycle import acquire_recipe_media_lock
from app.models import ai, deletion, grocery, identity, meal_plan, moderation  # noqa: F401
from app.models.identity import AppUser
from app.models.recipe import ExtractionJob, Recipe
from app.routers.extract import get_job_status, list_extraction_jobs
from app.services.cover_selection import CoverCandidate, CoverSelectionResult
from app.services.storage import StorageService
from app.services.video import VideoFrame, VideoFrameExtractionResult, VideoMetadata
from tests.database_safety import require_disposable_test_database

DATABASE = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE, reason="Disposable PostgreSQL required")


def photo(color="orange"):
    image = Image.new("RGB", (320, 240), "white")
    ImageDraw.Draw(image).ellipse((40, 30, 280, 210), fill=color, outline="black", width=5)
    output = io.BytesIO()
    image.save(output, format="JPEG")
    return output.getvalue()


@pytest_asyncio.fixture
async def database(monkeypatch):
    require_disposable_test_database(DATABASE)
    engine = create_async_engine(DATABASE)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.run_sync(Base.metadata.create_all)
    monkeypatch.setattr(cover_jobs, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(job_worker, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(cover_jobs, "candidate_cache", cover_jobs.CandidateCache())
    monkeypatch.setattr(cover_jobs.settings, "recipe_cover_selection_enabled", True)
    monkeypatch.setattr(cover_jobs.settings, "job_worker_enabled", True)
    monkeypatch.setattr(StorageService, "is_enabled", property(lambda _: True))
    image = validate_image_bytes(photo(), max_bytes=100000)
    monkeypatch.setattr(
        cover_jobs.storage_service, "fetch_thumbnail_source", AsyncMock(return_value=image)
    )
    monkeypatch.setattr(
        cover_jobs.storage_service,
        "store_prepared_thumbnail_variants_locked",
        AsyncMock(side_effect=["https://owned.test/original.webp", "https://owned.test/best.webp"]),
    )
    monkeypatch.setattr(
        cover_jobs.video_service,
        "get_video_metadata_ytdlp",
        AsyncMock(return_value=VideoMetadata()),
    )
    monkeypatch.setattr(
        cover_jobs.video_service,
        "extract_cover_frames",
        AsyncMock(
            return_value=VideoFrameExtractionResult(
                success=True, frames=[VideoFrame(90, base64.b64encode(photo("red")).decode())]
            )
        ),
    )
    try:
        yield sessions
    finally:
        await engine.dispose()


async def enqueue(sessions, *, preloaded=True):
    async with sessions() as db:
        db.add(AppUser(id="cover_owner"))
        recipe = Recipe(
            source_url="https://www.youtube.com/watch?v=coverqa1234",
            source_type="youtube",
            user_id="cover_owner",
            content_revision=1,
            extracted={
                "title": "Rice",
                "sourceUrl": "https://www.youtube.com/watch?v=coverqa1234",
                "lowConfidence": True,
                "confidenceWarning": "Check the salt.",
                "components": [
                    {
                        "name": "Main",
                        "ingredients": [{"name": "rice", "quantity": "2", "unit": "cups"}],
                        "steps": ["Cook the rice."],
                    }
                ],
                "media": {"thumbnail": None},
            },
            is_public=False,
        )
        db.add(recipe)
        await db.flush()
        result = SimpleNamespace(
            thumbnail_url="https://source.test/thumb.jpg",
            cover_images=None,
            cover_frames=[VideoFrame(90, base64.b64encode(photo("red")).decode())]
            if preloaded
            else None,
        )
        job = cover_jobs.enqueue_cover_job(db, recipe, result)
        await db.commit()
        return recipe.id, job.id


async def run(sessions, job_id):
    worker = cover_jobs.CoverJobWorker()
    assert await worker.claim_next_job() == job_id
    await worker.execute_claimed_job(job_id)


@pytest.mark.asyncio
async def test_durable_selection_preserves_recipe_and_reuses_acquired_frames(database, monkeypatch):
    recipe_id, job_id = await enqueue(database)

    async def select_cover(candidates, *_):
        return CoverSelectionResult(
            next(c for c in candidates if c.source_kind == "video_frame"),
            {"status": "selected", "timestampSeconds": 90},
        )

    monkeypatch.setattr(
        cover_jobs.cover_selection_service, "select", AsyncMock(side_effect=select_cover)
    )
    await run(database, job_id)
    async with database() as db:
        recipe, job = await db.get(Recipe, recipe_id), await db.get(ExtractionJob, job_id)
        assert recipe.thumbnail_url == "https://owned.test/best.webp"
        assert recipe.extracted["media"]["thumbnail"] == recipe.thumbnail_url
        assert recipe.extracted["confidenceWarning"] == "Check the salt."
        assert recipe.extracted["components"][0]["ingredients"][0]["quantity"] == "2"
        assert (
            recipe.content_revision == 1
            and recipe.user_id == "cover_owner"
            and not recipe.is_public
        )
        assert job.status == "completed" and job.notes == "{}"
        assert cover_jobs.cover_pending_until(recipe) is None
    cover_jobs.video_service.extract_cover_frames.assert_not_awaited()


@pytest.mark.asyncio
async def test_restart_reacquires_media_and_job_kind_partition_excludes_consumer_inbox(
    database, monkeypatch
):
    recipe_id, job_id = await enqueue(database)
    cover_jobs.candidate_cache.take(job_id)  # Simulate process restart/cross-replica claim.
    assert await job_worker.DurableJobWorker().claim_next_job() is None
    monkeypatch.setattr(
        cover_jobs.cover_selection_service,
        "select",
        AsyncMock(
            side_effect=lambda candidates, *_: CoverSelectionResult(
                candidates[0], {"status": "retained"}
            )
        ),
    )
    await run(database, job_id)
    user = ClerkUser(
        id="cover_owner",
        clerk_user_id="clerk_cover",
        clerk_issuer="https://example.test",
        clerk_environment="test",
    )
    async with database() as db:
        assert (
            await list_extraction_jobs(
                db=db, user=user, limit=8, active_only=False, include_cancelled=True, job_kind=None
            )
            == []
        )
        with pytest.raises(Exception) as denied:
            await get_job_status(job_id=job_id, db=db, user=user)
        assert denied.value.status_code == 404
        assert (await db.get(Recipe, recipe_id)).thumbnail_url
    cover_jobs.video_service.extract_cover_frames.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["revision", "photo", "owner", "delete", "lease"])
async def test_late_selection_cannot_overwrite_newer_work_or_deleted_recipe(
    database, monkeypatch, change
):
    recipe_id, job_id = await enqueue(database)

    async def intervene(candidates, *_):
        async with database() as db:
            recipe = await db.get(Recipe, recipe_id)
            if change == "revision":
                recipe.content_revision = 2
            elif change == "photo":
                recipe.thumbnail_url = "https://owned.test/user.webp"
            elif change == "owner":
                db.add(AppUser(id="another_owner"))
                await db.flush()
                recipe.user_id = "another_owner"
            elif change == "delete":
                await db.execute(delete(ExtractionJob).where(ExtractionJob.id == job_id))
                await db.delete(recipe)
            else:
                job = await db.get(ExtractionJob, job_id)
                job.lease_token = "new_worker_lease"
            await db.commit()
        return CoverSelectionResult(
            next(c for c in candidates if c.source_kind == "video_frame"), {"status": "selected"}
        )

    monkeypatch.setattr(
        cover_jobs.cover_selection_service, "select", AsyncMock(side_effect=intervene)
    )
    await run(database, job_id)
    async with database() as db:
        recipe = await db.get(Recipe, recipe_id)
        if change == "delete":
            assert recipe is None
        else:
            assert recipe.thumbnail_url != "https://owned.test/best.webp"
        assert cover_jobs.storage_service.store_prepared_thumbnail_variants_locked.await_count == 1


@pytest.mark.asyncio
async def test_grading_failure_retries_but_preserves_original_then_ends_pending(
    database, monkeypatch
):
    recipe_id, job_id = await enqueue(database)
    monkeypatch.setattr(
        cover_jobs.cover_selection_service,
        "select",
        AsyncMock(
            side_effect=lambda candidates, *_: CoverSelectionResult(
                candidates[0], {"status": "fallback"}, "timeout"
            )
        ),
    )
    await run(database, job_id)
    async with database() as db:
        assert (await db.get(Recipe, recipe_id)).thumbnail_url == "https://owned.test/original.webp"
        job = await db.get(ExtractionJob, job_id)
        assert job.status == "queued" and job.attempt_count == 1
        job.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    await run(database, job_id)
    async with database() as db:
        recipe, job = await db.get(Recipe, recipe_id), await db.get(ExtractionJob, job_id)
        assert recipe.thumbnail_url == "https://owned.test/original.webp"
        assert cover_jobs.cover_pending_until(recipe) is None
        assert job.status == "failed" and job.notes == "{}"


@pytest.mark.asyncio
async def test_unreachable_thumbnail_and_disabled_grading_keep_frame_fallback(
    database, monkeypatch
):
    recipe_id, job_id = await enqueue(database, preloaded=False)
    monkeypatch.setattr(
        cover_jobs.storage_service,
        "fetch_thumbnail_source",
        AsyncMock(side_effect=ValueError("expired")),
    )
    monkeypatch.setattr(
        cover_jobs.cover_selection_service,
        "select",
        AsyncMock(
            side_effect=lambda candidates, *_: CoverSelectionResult(
                candidates[0], {"status": "disabled"}
            )
        ),
    )
    await run(database, job_id)
    async with database() as db:
        assert (await db.get(Recipe, recipe_id)).thumbnail_url == "https://owned.test/original.webp"
        assert (await db.get(ExtractionJob, job_id)).status == "completed"


@pytest.mark.asyncio
async def test_expiry_discards_source_urls_without_rewriting_recipe(database):
    recipe_id, job_id = await enqueue(database)
    async with database() as db:
        job = await db.get(ExtractionJob, job_id)
        job.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    assert await cover_jobs.CoverJobWorker().claim_next_job() is None
    async with database() as db:
        job = await db.get(ExtractionJob, job_id)
        assert job.status == "expired" and job.notes == "{}"
        assert (await db.get(Recipe, recipe_id)).content_revision == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("parent_status", ["processing", "cancelled", "completed"])
async def test_cover_waits_for_original_import_and_cancellation_never_starts_media(
    database, monkeypatch, parent_status
):
    recipe_id, job_id = await enqueue(database)
    async with database() as db:
        parent = ExtractionJob(
            url="https://www.youtube.com/watch?v=coverqa1234",
            user_id="cover_owner",
            job_kind="extract",
            status=parent_status,
            recipe_id=recipe_id,
        )
        db.add(parent)
        await db.flush()
        job = await db.get(ExtractionJob, job_id)
        payload = json.loads(job.notes)
        payload["parentJob"] = str(parent.id)
        job.notes = json.dumps(payload)
        await db.commit()
    monkeypatch.setattr(
        cover_jobs.cover_selection_service,
        "select",
        AsyncMock(
            side_effect=lambda candidates, *_: CoverSelectionResult(
                candidates[0], {"status": "retained"}
            )
        ),
    )
    await run(database, job_id)
    async with database() as db:
        job = await db.get(ExtractionJob, job_id)
        if parent_status == "processing":
            assert job.status == "queued" and job.attempt_count == 0
            assert job.next_attempt_at and job.next_attempt_at > datetime.now(UTC)
        else:
            assert job.status == "completed"
        if parent_status != "completed":
            cover_jobs.storage_service.fetch_thumbnail_source.assert_not_awaited()
            cover_jobs.storage_service.store_prepared_thumbnail_variants_locked.assert_not_awaited()


@pytest.mark.asyncio
async def test_stale_cover_lease_recovers_without_creating_duplicate_jobs_or_recipes(
    database, monkeypatch
):
    recipe_id, job_id = await enqueue(database)
    async with database() as db:
        job = await db.get(ExtractionJob, job_id)
        job.status = "processing"
        job.attempt_count = 1
        job.lease_token = "dead_worker"
        job.leased_until = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    monkeypatch.setattr(
        cover_jobs.cover_selection_service,
        "select",
        AsyncMock(
            side_effect=lambda candidates, *_: CoverSelectionResult(
                candidates[0], {"status": "retained"}
            )
        ),
    )
    await run(database, job_id)
    async with database() as db:
        assert len((await db.scalars(select(Recipe))).all()) == 1
        assert len((await db.scalars(select(ExtractionJob))).all()) == 1
        job = await db.get(ExtractionJob, job_id)
        assert job.status == "completed" and job.attempt_count == 2
        assert (await db.get(Recipe, recipe_id)).thumbnail_url


@pytest.mark.asyncio
async def test_recipe_and_cover_queue_rollback_is_atomic(database):
    async with database() as db:
        db.add(AppUser(id="atomic_owner"))
        item = Recipe(
            source_url="https://www.youtube.com/watch?v=atomicqa123",
            source_type="youtube",
            user_id="atomic_owner",
            content_revision=1,
            extracted={
                "title": "Rice",
                "components": [
                    {
                        "name": "Main",
                        "ingredients": [{"name": "rice", "quantity": "2"}],
                        "steps": ["Cook rice."],
                    }
                ],
            },
        )
        db.add(item)
        await db.flush()
        cover_jobs.enqueue_cover_job(
            db, item, SimpleNamespace(thumbnail_url=None, cover_frames=None, cover_images=None)
        )
        await db.rollback()
    async with database() as db:
        assert not (await db.scalars(select(Recipe))).all()
        assert not (await db.scalars(select(ExtractionJob))).all()


@pytest.mark.asyncio
async def test_admin_cover_cancel_scrubs_urls_and_terminal_retry_is_rejected(database, monkeypatch):
    from fastapi import HTTPException

    from app.routers import admin

    recipe_id, job_id = await enqueue(database)
    actor = ClerkUser(
        id="cover_owner",
        clerk_user_id="clerk_cover",
        clerk_issuer="https://example.test",
        clerk_environment="test",
        role="admin",
    )
    monkeypatch.setattr(admin, "cover_job_worker", cover_jobs.CoverJobWorker())
    async with database() as db:
        await admin.cancel_job(
            job_id, admin.AdminReason(reason="Cancel owned photo QA fixture"), db, actor
        )
    async with database() as db:
        job = await db.get(ExtractionJob, job_id)
        assert job.status == "cancelled" and job.notes == "{}"
        assert cover_jobs.cover_pending_until(await db.get(Recipe, recipe_id)) is None
        job.status = "failed"
        await db.commit()
        with pytest.raises(HTTPException) as refused:
            await admin.retry_job(
                job_id,
                admin.AdminReason(reason="Verify scrubbed photo replay is refused"),
                db,
                actor,
            )
        assert refused.value.status_code == 409
        assert job.status == "failed" and job.expires_at < datetime.now(UTC) + timedelta(minutes=6)


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ["async", "legacy"])
@pytest.mark.parametrize("photo_kind", ["selected", "user"])
async def test_reextraction_keeps_current_video_cover_and_synchronizes_media(
    database, monkeypatch, route, photo_kind
):
    from uuid import uuid4

    from app.routers import extract, recipes
    from app.services import recipe_extractor
    from app.services.extractor import FullExtractionResult

    recipe_id, _ = await enqueue(database)
    cover_url = f"https://owned.test/{photo_kind}.webp"
    async with database() as db:
        item = await db.get(Recipe, recipe_id)
        item.thumbnail_url = cover_url
        item.extracted = {**item.extracted, "media": {"thumbnail": cover_url}}
        updated = {
            **item.extracted,
            "title": "Updated Rice",
            "media": {"thumbnail": "https://source.test/platform.jpg"},
        }
        job_id = uuid4()
        db.add(
            ExtractionJob(
                id=job_id,
                url=item.source_url,
                user_id=item.user_id,
                job_kind="reextract",
                status="processing",
                target_recipe_id=recipe_id,
                lease_token="owned_reextract",
                max_attempts=3,
            )
        )
        await db.commit()
    import app.db.database as database_module

    monkeypatch.setattr(database_module, "AsyncSessionLocal", database)
    monkeypatch.setattr(
        recipe_extractor,
        "extract",
        AsyncMock(
            return_value=FullExtractionResult(
                success=True,
                recipe=updated,
                thumbnail_url="https://source.test/platform.jpg",
                extraction_method="whisper",
                extraction_quality="high",
                has_audio_transcript=True,
            )
        ),
    )
    monkeypatch.setattr(extract, "enrich_nutrition", AsyncMock(side_effect=lambda data, **_: data))
    ordinary_upload, locked_upload = AsyncMock(), AsyncMock()
    monkeypatch.setattr(cover_jobs.storage_service, "upload_thumbnail_from_url", ordinary_upload)
    monkeypatch.setattr(
        cover_jobs.storage_service, "upload_thumbnail_from_url_locked", locked_upload
    )
    if route == "async":
        await extract.run_re_extraction_job(
            str(job_id),
            str(recipe_id),
            "https://www.youtube.com/watch?v=coverqa1234",
            "Guam",
            "cover_owner",
            "owned_reextract",
        )
    else:
        actor = ClerkUser(
            id="cover_owner",
            clerk_user_id="clerk_cover",
            clerk_issuer="https://example.test",
            clerk_environment="test",
        )
        async with database() as db:
            await recipes.re_extract_recipe(
                recipe_id, recipes.ReExtractRequest(location="Guam"), db, actor
            )
    async with database() as db:
        item = await db.get(Recipe, recipe_id)
        assert item.thumbnail_url == item.extracted["media"]["thumbnail"] == cover_url
        assert item.extracted["title"] == "Updated Rice" and item.content_revision == 2
    ordinary_upload.assert_not_awaited()
    locked_upload.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancelled_s3_thread_holds_media_lock_until_deletion_can_clean(database, monkeypatch):
    recipe_id, job_id = await enqueue(database)
    worker = cover_jobs.CoverJobWorker()
    await worker.claim_next_job()
    async with database() as db:
        job = await db.get(ExtractionJob, job_id)
        job.status = "processing"
        token = job.lease_token
        await db.commit()
    started, release = threading.Event(), threading.Event()
    objects = {}

    def put(**kwargs):
        started.set()
        assert release.wait(10)
        objects[kwargs["Key"]] = kwargs["Body"]

    service = StorageService()
    monkeypatch.setattr(
        StorageService, "client", property(lambda _: SimpleNamespace(put_object=put))
    )
    monkeypatch.setattr(
        cover_jobs.storage_service,
        "store_prepared_thumbnail_variants_locked",
        service.store_prepared_thumbnail_variants_locked,
    )
    task = asyncio.create_task(
        worker._store_candidate(
            job_id,
            token,
            CoverCandidate("frame", photo(), "video_frame"),
            1,
            expected_thumbnail=None,
        )
    )
    assert await asyncio.to_thread(started.wait, 3)
    task.cancel()
    deleted = asyncio.Event()

    async def delete_after_lock():
        async with database() as db:
            await acquire_recipe_media_lock(db, recipe_id)
            await db.execute(delete(ExtractionJob).where(ExtractionJob.recipe_id == recipe_id))
            await db.execute(delete(Recipe).where(Recipe.id == recipe_id))
            objects.clear()
            await db.commit()
            deleted.set()

    deletion_task = asyncio.create_task(delete_after_lock())
    await asyncio.sleep(0.05)
    assert not deleted.is_set()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.wait_for(deletion_task, 3)
    assert not objects
