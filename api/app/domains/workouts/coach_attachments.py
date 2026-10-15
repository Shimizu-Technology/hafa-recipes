"""Internal private image lifecycle. No route or model-image capability yet.

An upload UUID binds one original byte/MIME hash. A committed cleanup job always
precedes S3 writes; account/asset locks remain held until shielded writes settle.
"""

import asyncio
import hashlib
from datetime import timedelta
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import HTTPException
from sqlalchemy import delete, func, select, text

from app.domains.workouts.coach_attachment_models import CoachAttachment
from app.domains.workouts.imports import require_ai_consent
from app.domains.workouts.lifecycle import membership_for, now, optional_table_exists
from app.domains.workouts.source_media import cleanup_job
from app.image_validation import (
    ImageValidationError,
    normalize_thumbnail_image,
    validate_image_bytes,
)
from app.media_lifecycle import acquire_recipe_media_lock
from app.models.deletion import DeletionCleanupJob
from app.services.storage import storage_service

MAX_BYTES = 2 * 1024 * 1024
MAX_UPLOADS = 50
COLUMNS = {"id": "uuid", "app_user_id": "varchar", "generation": "int4", "upload_id": "uuid",
           "byte_hash": "varchar", "state": "varchar", "consent_at": "timestamptz",
           "expires_at": "timestamptz", "cleanup_job_id": "uuid", "created_at": "timestamptz"}


def attachment_id(owner, generation, upload_id):
    return uuid5(NAMESPACE_URL, f"hafa-workouts-coach-image:v1:{owner}:{generation}:{UUID(str(upload_id))}")


def prefix(identifier):
    return f"workout-coach-images/{UUID(str(identifier))}/"


async def schema_complete(db):
    columns = {name: (kind, nullable) for name, kind, nullable in (await db.execute(text("""SELECT column_name,udt_name,is_nullable
        FROM information_schema.columns WHERE table_schema='public' AND table_name='workouts_coach_attachments'"""))).all()}
    if any(columns.get(name) != (kind, "YES" if name in {"cleanup_job_id", "consent_at"} else "NO") for name, kind in COLUMNS.items()):
        return False
    return bool(await db.scalar(text("""SELECT EXISTS(SELECT 1 FROM pg_constraint
        WHERE conrelid='public.workouts_coach_attachments'::regclass
        AND conname='ck_coach_attachment_state' AND convalidated
        AND pg_get_constraintdef(oid) LIKE '%generation > 0%pending%ready%deleted%'
        AND pg_get_constraintdef(oid) LIKE '%consent_at IS NOT NULL%')
        AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.workouts_coach_attachments'::regclass
        AND contype='p' AND pg_get_constraintdef(oid)='PRIMARY KEY (id)')
        AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.workouts_coach_attachments'::regclass
        AND contype='f' AND convalidated AND pg_get_constraintdef(oid)
        LIKE 'FOREIGN KEY (app_user_id) REFERENCES app_users(id) ON DELETE CASCADE')""")))


async def attachments_ready(db):
    # 048 is optional and unrelated; a higher migration number proves nothing.
    return (await optional_table_exists(db, "workouts_schema_migrations")
            and bool(await db.scalar(text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=49)")))
            and await schema_complete(db))


async def require_schema(db):
    if not await attachments_ready(db):
        raise HTTPException(503, "Private coach images are unavailable")


def normalized_image(data, content_type):
    try:
        valid = validate_image_bytes(data, max_bytes=MAX_BYTES, declared_content_type=content_type)
        image = normalize_thumbnail_image(valid, max_dimension=1600)
        if len(image.data) > MAX_BYTES:
            raise ImageValidationError("Normalized image exceeds limit")
        return image
    except ImageValidationError:
        raise HTTPException(422, "Choose one supported image up to 2 MiB") from None


async def owned(db, owner, generation, identifier):
    row = await db.get(CoachAttachment, identifier, populate_existing=True)
    if not row or row.app_user_id != owner or row.generation != generation:
        raise HTTPException(404, "Private image unavailable")
    return row


async def upload(sessions, owner, generation, upload_id, data, content_type):
    """Internal only: the future bulk route must bound JSON/base64 before decode.

    Returns metadata, never a public URL. Normalization occurs outside owner
    locks; authorization and the exact consent epoch are rechecked before write.
    """
    if not storage_service.is_enabled:
        raise HTTPException(503, "Private coach images are unavailable")
    if not isinstance(data, bytes) or len(data) > MAX_BYTES or content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        raise HTTPException(422, "Choose one supported image up to 2 MiB")
    digest = hashlib.sha256(content_type.encode() + b"\0" + data).hexdigest()
    identifier = attachment_id(owner, generation, upload_id)
    async with sessions() as db:
        await require_schema(db)
        await membership_for(db, owner, generation=generation, write=True)
        consent_at = (await require_ai_consent(db, owner, generation)).accepted_at
        prior = await db.get(CoachAttachment, identifier)
        if prior and (prior.app_user_id != owner or prior.generation != generation):
            raise HTTPException(404, "Private image unavailable")
        if prior and (prior.state == "deleted" or prior.expires_at <= now()):
            raise HTTPException(410, "Private image expired or removed")
        if prior and prior.byte_hash != digest:
            raise HTTPException(409, "This image upload identity has different content")
        if prior and prior.state == "ready":
            return {"id": str(identifier), "expires_at": prior.expires_at}
        await db.rollback()
    image = await asyncio.to_thread(normalized_image, data, content_type)
    async with sessions() as db:
        await require_schema(db)
        await membership_for(db, owner, generation=generation, write=True)
        await require_ai_consent(db, owner, generation, expected=consent_at)
        row = await db.get(CoachAttachment, identifier)
        if row and (row.app_user_id != owner or row.generation != generation):
            raise HTTPException(404, "Private image unavailable")
        if row and (row.state == "deleted" or row.expires_at <= now()):
            raise HTTPException(410, "Private image expired or removed")
        if row and row.byte_hash != digest:
            raise HTTPException(409, "This image upload identity has different content")
        if row is None:
            count = await db.scalar(select(func.count()).select_from(CoachAttachment).where(
                CoachAttachment.app_user_id == owner, CoachAttachment.created_at > now() - timedelta(days=1)))
            if count >= MAX_UPLOADS:
                raise HTTPException(429, "Private image upload allowance reached")
            expires = now() + timedelta(hours=24)
            cleanup = cleanup_job(owner, [prefix(identifier)], after=expires)
            db.add(cleanup)
            await db.flush()
            db.add(CoachAttachment(id=identifier, app_user_id=owner, generation=generation,
                upload_id=UUID(str(upload_id)), byte_hash=digest, consent_at=consent_at,
                expires_at=expires, cleanup_job_id=cleanup.id))
        await db.commit()  # Receipt and exact cleanup survive upload/ACK failures.
    async with sessions() as db:
        await membership_for(db, owner, generation=generation, write=True)
        await require_ai_consent(db, owner, generation, expected=consent_at)
        await acquire_recipe_media_lock(db, identifier)
        row = await owned(db, owner, generation, identifier)
        guard = await db.get(DeletionCleanupJob, row.cleanup_job_id, populate_existing=True)
        if (row.state == "deleted" or row.expires_at <= now() or row.consent_at != consent_at
                or not guard or guard.status != "queued" or guard.next_attempt_at <= now()):
            raise HTTPException(410, "Private image expired or removed")
        if row.state != "ready":
            await storage_service.store_private_coach_image_locked(identifier, image)
            row.state = "ready"
            await db.commit()
        return {"id": str(identifier), "expires_at": row.expires_at}


async def read_url(db, owner, generation, identifier):
    await require_schema(db)
    await membership_for(db, owner, generation=generation, write=True)
    row = await owned(db, owner, generation, identifier)
    expires_in = min(60, int((row.expires_at - now()).total_seconds()))
    if row.state != "ready" or expires_in < 1:
        raise HTTPException(410, "Private image expired or removed")
    url = storage_service.private_coach_image_url(row.id, expires_in=expires_in)
    if not url:
        raise HTTPException(503, "Private image unavailable")
    return {"url": url, "expires_in": expires_in}


async def retire(db, owner, generation, identifier):
    await require_schema(db)
    await membership_for(db, owner, generation=generation, write=True)
    await acquire_recipe_media_lock(db, identifier)
    row = await owned(db, owner, generation, identifier)
    if row.state != "deleted":
        db.add(cleanup_job(owner, [prefix(identifier)]))
        row.state = "deleted"
    # Tombstone preserves exact replay identity/rolling allowance, not an image.


async def retire_upload(db, owner, generation, upload_id):
    """Stop-before-upload/lost-ACK deletion uses the client's original UUID.

    No AI permission is required to discard a photo. Unknown upload IDs receive
    a content-free tombstone so a concurrent/late upload cannot recreate it.
    """
    await require_schema(db)
    await membership_for(db, owner, generation=generation, write=True)
    identifier = attachment_id(owner, generation, upload_id)
    if await db.get(CoachAttachment, identifier):
        await retire(db, owner, generation, identifier)
        return
    count = await db.scalar(select(func.count()).select_from(CoachAttachment).where(
        CoachAttachment.app_user_id == owner, CoachAttachment.created_at > now() - timedelta(days=1)))
    if count >= MAX_UPLOADS:
        raise HTTPException(429, "Private image upload allowance reached")
    db.add(CoachAttachment(id=identifier, app_user_id=owner, generation=generation,
        upload_id=UUID(str(upload_id)), byte_hash="0" * 64, state="deleted",
        expires_at=now() + timedelta(hours=24)))


async def clear_attachments(db, owner, generation=None, *, erase=False):
    # Privacy cleanup cannot depend on a feature marker or healthy optional schema.
    if not await optional_table_exists(db, "workouts_coach_attachments"):
        return
    query = select(CoachAttachment).where(CoachAttachment.app_user_id == owner)
    if generation is not None:
        query = query.where(CoachAttachment.generation == generation)
    for row in await db.scalars(query.order_by(CoachAttachment.id)):
        await acquire_recipe_media_lock(db, row.id)
        db.add(cleanup_job(owner, [prefix(row.id)]))
        row.state = "deleted"
    if erase:
        await db.execute(delete(CoachAttachment).where(CoachAttachment.app_user_id == owner))


async def owned_prefixes(db, owner):
    if not await optional_table_exists(db, "workouts_coach_attachments"):
        return []
    return [prefix(identifier) for identifier in await db.scalars(
        select(CoachAttachment.id).where(CoachAttachment.app_user_id == owner))]
