"""Explicit owned cover replacement with frozen requests and durable cleanup."""

import asyncio
import hashlib
from datetime import timedelta
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from sqlalchemy import select, text

from app.db.database import AsyncSessionLocal
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.models import WorkoutRecord, WorkoutVersion
from app.domains.workouts.router import (
    bounded_content,
    library_responses,
    owned_record,
    refresh_library_source,
)
from app.domains.workouts.source_media import (
    asset_prefix,
    cleanup_job,
    media_ready,
    retain_source_cover,
)
from app.domains.workouts.source_media_models import WorkoutSourceMedia
from app.image_validation import ImageValidationError, validate_image_bytes
from app.media_lifecycle import acquire_recipe_media_lock
from app.models.deletion import DeletionCleanupJob
from app.services.storage import storage_service

MAX_COVER_BYTES = 2 * 1024 * 1024  # Existing bounded bulk ingress allows multipart overhead.


async def upload_ready(db):
    if not await media_ready(db):
        return False
    return bool(
        await db.scalar(
            text("""SELECT
        EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=48)
        AND (SELECT count(*)=2 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='workouts_source_media'
          AND column_name IN ('upload_request_hash','cover_origin'))
        AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='workouts_source_media'::regclass
          AND conname='ck_workouts_source_media_owner' AND convalidated
          AND pg_get_constraintdef(oid) LIKE '%upload%')""")
        )
    )


async def registered_origin(db, identifier):
    # Deliberately unmapped: 047 imports and startup remain usable before 048.
    if not identifier or not await upload_ready(db):
        return None
    return await db.scalar(
        text("SELECT cover_origin FROM workouts_source_media WHERE id=:id"), {"id": identifier}
    )


async def save_cover(workout_id, expected_revision, request_id, image, user, db, generation):
    await membership_for(db, user.id, generation=generation, write=True)
    if not await upload_ready(db) or not storage_service.is_enabled:
        raise HTTPException(503, "Workout cover uploads are not available yet")
    await owned_record(db, WorkoutRecord, workout_id, user.id, generation)
    await db.rollback()  # CPU work and independently committed receipt must precede final locks.
    try:
        data = await image.read(MAX_COVER_BYTES + 1)
        validated = await asyncio.to_thread(
            validate_image_bytes,
            data,
            max_bytes=MAX_COVER_BYTES,
            declared_content_type=image.content_type,
        )
    except ImageValidationError as error:
        raise HTTPException(422, str(error)) from None
    finally:
        await image.close()
    digest = hashlib.sha256(f"{workout_id}:{expected_revision}:".encode() + data).hexdigest()
    identifier = uuid5(
        NAMESPACE_URL, f"hafa-workouts-cover:v1:{user.id}:{generation}:upload:{request_id}"
    )

    async def locked(db):
        await membership_for(db, user.id, generation=generation, write=True)
        row = await owned_record(db, WorkoutRecord, workout_id, user.id, generation)
        receipt = await db.get(WorkoutSourceMedia, identifier, populate_existing=True)
        if receipt:
            frozen = await db.scalar(
                text("SELECT upload_request_hash FROM workouts_source_media WHERE id=:id"),
                {"id": identifier},
            )
            if frozen != digest or receipt.purpose != "upload":
                raise HTTPException(409, "Cover upload request changed; choose the photo again")
            applied = (
                await db.scalar(
                    select(WorkoutVersion.id).where(
                        WorkoutVersion.workout_id == workout_id,
                        WorkoutVersion.app_user_id == user.id,
                        WorkoutVersion.generation == generation,
                        WorkoutVersion.revision == expected_revision + 1,
                        WorkoutVersion.content["source_thumbnail_url"].astext
                        == receipt.canonical_url,
                    )
                )
                if receipt.canonical_url
                else None
            )
            if applied:
                return row, receipt, True
            guard = await db.get(DeletionCleanupJob, receipt.cleanup_job_id)
            if (
                receipt.retained
                or not guard
                or guard.status != "queued"
                or guard.next_attempt_at <= now()
            ):
                raise HTTPException(409, "Cover upload expired; choose the photo again")
        if row.revision != expected_revision:
            raise HTTPException(409, "Workout changed; refresh before changing its cover")
        return row, receipt, False

    async with AsyncSessionLocal() as receipt_db:
        row, receipt, applied = await locked(receipt_db)
        if applied:
            return (await library_responses(receipt_db, [row]))[0]
        if receipt is None:
            cleanup = cleanup_job(
                user.id, [asset_prefix(identifier)], after=now() + timedelta(hours=24)
            )
            receipt_db.add(cleanup)
            await receipt_db.flush()
            await receipt_db.execute(
                text("""INSERT INTO workouts_source_media
                (id,app_user_id,generation,source_id,purpose,cleanup_job_id,upload_request_hash,cover_origin)
                VALUES(:id,:owner,:generation,:request,'upload',:cleanup,:hash,'user')"""),
                {
                    "id": identifier,
                    "owner": user.id,
                    "generation": generation,
                    "request": request_id,
                    "cleanup": cleanup.id,
                    "hash": digest,
                },
            )
        await receipt_db.commit()  # Exact cleanup is durable BEFORE any object writes.
    variants = await storage_service.prepare_thumbnail_variants(validated)
    async with AsyncSessionLocal() as final:
        row, receipt, applied = await locked(final)
        if applied:
            return (await library_responses(final, [row]))[0]
        await acquire_recipe_media_lock(final, identifier)
        if not receipt.canonical_url:
            receipt.canonical_url = (
                await storage_service.store_prepared_workouts_thumbnail_variants_locked(
                    variants, f"workouts-{identifier}"
                )
            )
        prior = await final.scalar(
            select(WorkoutVersion.id).where(
                WorkoutVersion.workout_id == workout_id, WorkoutVersion.revision == row.revision
            )
        )
        content = bounded_content(
            {
                **row.content,
                "source_thumbnail_url": receipt.canonical_url,
                "cover_origin": "user",
                "version": row.revision + 1,
                "parent_version_id": str(prior),
            }
        )
        await retain_source_cover(final, user.id, generation, receipt.canonical_url)
        row.revision += 1
        row.content = content
        row.updated_at = now()
        final.add(
            WorkoutVersion(
                app_user_id=user.id,
                generation=generation,
                workout_id=workout_id,
                revision=row.revision,
                content=row.content,
            )
        )
        await refresh_library_source(final, row)
        await final.flush()
        from app.domains.workouts.discover import refresh_publication_after_edit

        await refresh_publication_after_edit(final, row)
        result = (await library_responses(final, [row]))[0]
        await final.commit()
        return result
