"""Public-link covers with independently owned copies and exact durable cleanup."""

import asyncio
import re
from datetime import timedelta
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import HTTPException
from sqlalchemy import delete, select, text

from app.config import get_settings
from app.db.database import AsyncSessionLocal
from app.domains.workouts.automation_models import WorkoutImport
from app.domains.workouts.lifecycle import membership_for, now, optional_table_exists
from app.domains.workouts.models import WorkoutsConsent
from app.domains.workouts.source_media_models import WorkoutSourceMedia
from app.image_validation import validate_image_bytes
from app.media_lifecycle import acquire_recipe_media_lock
from app.models.deletion import DeletionCleanupJob
from app.services.storage import MAX_THUMBNAIL_BYTES, storage_service

COVER_KEY = re.compile(r"^thumbnails/workouts-([0-9a-f-]{36})/[0-9a-f]{64}/hero\.webp$")


def asset_id(url):
    """Accept only canonical Workouts objects; Recipes/private captures are excluded."""
    if not isinstance(url, str):
        return None
    key = storage_service._owned_storage_key(url)
    match = COVER_KEY.fullmatch(key or "")
    if not match or storage_service.canonical_thumbnail_url(key) != url:
        return None
    try:
        return UUID(match[1])
    except ValueError:
        return None


def asset_prefix(identifier):
    return f"thumbnails/workouts-{UUID(str(identifier))}/"


async def media_ready(db):
    return await optional_table_exists(db, "workouts_source_media") and bool(
        await db.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=47)")
        )
    )


def cleanup_job(owner, prefixes, *, after=None):
    return DeletionCleanupJob(
        kind="workout_media",
        app_user_id=owner,
        storage_prefixes=prefixes,
        storage_prefix_count=len(prefixes),
        next_attempt_at=after,
        max_attempts=get_settings().deletion_cleanup_max_attempts,
    )


async def _eligible(db, owner, generation, source_id, purpose, expected):
    await membership_for(db, owner, generation=generation, write=True)
    if purpose == "copy":
        return now() + timedelta(hours=24)
    job = await db.get(WorkoutImport, source_id, populate_existing=True)
    consent = await db.get(WorkoutsConsent, owner, populate_existing=True)
    if (
        not job
        or job.app_user_id != owner
        or job.generation != generation
        or job.status != "processing"
        or job.expires_at <= now()
        or not job.payload
        or job.payload.get("kind") != "url"
        or not consent
        or consent.generation != generation
        or not consent.accepted_at
        or consent.accepted_at != job.ai_accepted_at
        or (expected is not None and expected != consent.accepted_at)
    ):
        raise HTTPException(409, "Source cover processing is no longer authorized")
    return job.expires_at


async def prepare_source_cover(
    sessions, owner, generation, import_id, url, *, expected_ai_accepted_at=None
):
    """Call BEFORE the caller's final owner lock; returns None without losing text.

    Its own committed receipt precedes S3 writes. Upload holds account and asset
    locks until the existing shielded writer settles, including cancellation.
    The caller must retain_source_cover in the transaction accepting the result.
    """
    return await _prepare(
        sessions, owner, generation, import_id, url, "import", expected_ai_accepted_at
    )


async def prepare_copied_cover(sessions, owner, generation, copy_id, url):
    return await _prepare(sessions, owner, generation, copy_id, url, "copy", None)


async def _prepare(sessions, owner, generation, source_id, url, purpose, expected):
    if not url or not storage_service.is_enabled:
        return None
    identifier = uuid5(
        NAMESPACE_URL, f"hafa-workouts-cover:v1:{owner}:{generation}:{purpose}:{source_id}"
    )

    async def prepare():
        async with sessions() as db:
            if not await media_ready(db):
                return None
            await _eligible(db, owner, generation, source_id, purpose, expected)
            existing = await db.get(WorkoutSourceMedia, identifier)
            if existing:
                guard = await db.get(DeletionCleanupJob, existing.cleanup_job_id)
                if not existing.retained and not (
                    guard and guard.status == "queued" and guard.next_attempt_at > now()
                ):
                    return None
                if existing.canonical_url:
                    return existing.canonical_url
            owned = asset_id(url)
            key = storage_service._owned_storage_key(url)
            if storage_service.thumbnail_origin(url) == "app_owned" and not owned:
                return None
            if key:
                if purpose != "copy" or not owned:
                    return None
                source = await db.get(WorkoutSourceMedia, owned)
                if not source or not source.retained or source.canonical_url != url:
                    return None
            elif purpose == "copy":
                return None
            await db.rollback()
        if owned:
            data, content_type = await asyncio.to_thread(
                storage_service._download_owned_thumbnail, key
            )
        else:
            data, content_type = await storage_service._download_public_url(url)
        image = validate_image_bytes(
            data, max_bytes=MAX_THUMBNAIL_BYTES, declared_content_type=content_type
        )
        variants = await storage_service.prepare_thumbnail_variants(image)
        async with sessions() as db:
            if not await media_ready(db):
                return None
            expires = await _eligible(db, owner, generation, source_id, purpose, expected)
            receipt = await db.get(WorkoutSourceMedia, identifier)
            if receipt is None:
                cleanup = cleanup_job(owner, [asset_prefix(identifier)], after=expires)
                db.add(cleanup)
                await db.flush()
                db.add(
                    WorkoutSourceMedia(
                        id=identifier,
                        app_user_id=owner,
                        generation=generation,
                        source_id=source_id,
                        purpose=purpose,
                        cleanup_job_id=cleanup.id,
                    )
                )
            await db.commit()  # Durable even if upload succeeds but subsequent commits fail.
        async with sessions() as db:
            await _eligible(db, owner, generation, source_id, purpose, expected)
            await acquire_recipe_media_lock(db, identifier)
            receipt = await db.get(WorkoutSourceMedia, identifier, populate_existing=True)
            if not receipt:
                return None
            guard = await db.get(DeletionCleanupJob, receipt.cleanup_job_id, populate_existing=True)
            if not receipt.retained and not (
                guard and guard.status == "queued" and guard.next_attempt_at > now()
            ):
                return None
            if not receipt.canonical_url:
                receipt.canonical_url = (
                    await storage_service.store_prepared_thumbnail_variants_locked(
                        variants, f"workouts-{identifier}"
                    )
                )
                await db.commit()
            return receipt.canonical_url

    try:
        return await asyncio.wait_for(prepare(), timeout=20)
    except asyncio.CancelledError:
        raise
    except Exception:
        return None  # Registered cleanup survives partial uploads and unavailable media.


async def retain_source_cover(db, owner, generation, url):
    if not url:
        return None
    identifier = asset_id(url)
    media = (
        await db.get(WorkoutSourceMedia, identifier)
        if identifier and await media_ready(db)
        else None
    )
    if (
        not media
        or media.app_user_id != owner
        or media.generation != generation
        or media.canonical_url != url
    ):
        raise HTTPException(422, "Source cover is not registered to this workout account")
    was_retained = media.retained
    if media.cleanup_job_id:
        job = await db.scalar(
            select(DeletionCleanupJob)
            .where(DeletionCleanupJob.id == media.cleanup_job_id)
            .with_for_update()
        )
        if (
            not job
            or job.status not in {"queued", "completed"}
            or (not was_retained and (job.status != "queued" or job.next_attempt_at <= now()))
        ):
            raise HTTPException(422, "Source cover expired; save the workout without its cover")
        job.status, job.storage_prefixes, job.storage_prefix_count = "completed", [], 0
        job.completed_at = now()
    # A rejected preview must stay unretained even when the caller catches the
    # error and commits a text-only workout in this same transaction.
    media.retained = True
    return url


async def release_source_cover(db, owner, generation, import_id):
    if not await media_ready(db):
        return
    identifier = uuid5(
        NAMESPACE_URL, f"hafa-workouts-cover:v1:{owner}:{generation}:import:{import_id}"
    )
    media = await db.get(WorkoutSourceMedia, identifier)
    if media and not media.retained:
        db.add(cleanup_job(owner, [asset_prefix(identifier)]))
        await db.delete(media)


async def owned_cleanup_prefixes(db, owner):
    if not await media_ready(db):
        return []
    return [
        asset_prefix(identifier)
        for identifier in await db.scalars(
            select(WorkoutSourceMedia.id).where(WorkoutSourceMedia.app_user_id == owner)
        )
    ]


async def erase_source_media(db, owner):
    prefixes = await owned_cleanup_prefixes(db, owner)
    if prefixes:
        db.add(cleanup_job(owner, prefixes))
        await db.execute(delete(WorkoutSourceMedia).where(WorkoutSourceMedia.app_user_id == owner))


async def copy_cover_before_lock(db, owner, generation, copy_id, url):
    """Read-only phase only: release locks, prepare owned copy, then caller rechecks."""
    if not url or not await media_ready(db):
        return None
    if db.new or db.dirty or db.deleted:
        raise RuntimeError("Prepare source covers before writing the saved copy")
    await db.rollback()
    return await prepare_copied_cover(AsyncSessionLocal, owner, generation, copy_id, url)


async def retire_unused_covers(db, owner, generation):
    """Owner lock held: historical prescriptions and legitimate duplicates retain covers."""
    if not await media_ready(db):
        return
    await db.flush()
    rows = (
        await db.scalars(
            select(WorkoutSourceMedia).where(
                WorkoutSourceMedia.app_user_id == owner,
                WorkoutSourceMedia.generation == generation,
                WorkoutSourceMedia.retained.is_(True),
            )
        )
    ).all()
    for media in rows:
        used = False
        for table in (
            "workouts_library",
            "workouts_library_versions",
            "workouts_programs",
            "workouts_program_versions",
            "workouts_sessions",
        ):
            used = bool(
                await db.scalar(
                    text(f"""SELECT EXISTS(SELECT 1 FROM {table}
                WHERE app_user_id=:owner AND generation=:generation AND jsonb_path_exists(content,
                '$.**.source_thumbnail_url ? (@ == $url)'::jsonpath,
                jsonb_build_object('url',CAST(:url AS text))))"""),
                    {"owner": owner, "generation": generation, "url": media.canonical_url},
                )
            )
            if used:
                break
        if not used:
            db.add(cleanup_job(owner, [asset_prefix(media.id)]))
            await db.delete(media)
