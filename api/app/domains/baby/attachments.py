"""Private S3 assets. Durable cleanup intent always precedes external writes."""

import asyncio
import hashlib
import re
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Header, HTTPException, Response, UploadFile
from sqlalchemy import String, and_, cast, func, or_, select

from app.config import get_settings
from app.domains.baby import storage
from app.domains.baby.dependencies import Database, Generation, User
from app.domains.baby.lifecycle import membership_for, now, owned
from app.domains.baby.models import BabyAttachment, BabyImport, BabyRecord
from app.domains.baby.security import BabyRoute, BabyUploadRoute
from app.image_validation import (
    ImageValidationError,
    normalize_thumbnail_image,
    validate_image_bytes,
)
from app.media_lifecycle import acquire_recipe_media_lock
from app.models.deletion import DeletionCleanupJob
from app.services.storage import storage_service

MAX_BYTES = 25 * 1024 * 1024
MAX_TOTAL_BYTES = 250 * 1024 * 1024
ALLOWED = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/ogg",
}
router = APIRouter(tags=["baby"], route_class=BabyRoute)
upload_router = APIRouter(tags=["baby"], route_class=BabyUploadRoute)


def attachment_prefix(identifier, owner, generation):
    owner_hash = hashlib.sha256(owner.encode()).hexdigest()
    return f"baby-private/{owner_hash}/{generation}/{UUID(str(identifier))}/"


def cleanup_job(owner, prefixes, *, after=None):
    return DeletionCleanupJob(
        kind="baby_media",
        app_user_id=owner,
        storage_prefixes=prefixes,
        storage_prefix_count=len(prefixes),
        next_attempt_at=after,
        max_attempts=get_settings().deletion_cleanup_max_attempts,
    )


def metadata(row):
    return {"id": str(row.id), "name": row.name, "mime_type": row.mime_type, "size": row.size}


def attachment_references(owner, generation, identifier):
    """Only live content and executable imports retain private asset bytes."""
    identifiers = func.jsonb_build_array(cast(identifier, String))
    record = (
        select(BabyRecord.id)
        .where(
            BabyRecord.app_user_id == owner,
            BabyRecord.generation == generation,
            BabyRecord.deleted_at.is_(None),
            BabyRecord.data["attachment_ids"].contains(identifiers),
        )
        .exists()
    )
    capture = (
        select(BabyImport.id)
        .where(
            BabyImport.app_user_id == owner,
            BabyImport.generation == generation,
            BabyImport.status.in_(["queued", "processing"]),
            BabyImport.request["attachment_ids"].contains(identifiers),
        )
        .exists()
    )
    return or_(record, capture)


async def retire_unreferenced_attachments(db, owner, generation, identifiers):
    """Release candidates without unlinking another record or a live import.

    Account-first locking serializes saves/import admission with this check.
    Asset locks also fence external cleanup and any already-admitted SDK write.
    The caller commits the tombstone and durable cleanup together with its edit.
    """
    with db.no_autoflush:
        await membership_for(db, owner, generation=generation, write=True)
    await db.flush()
    candidates = sorted({UUID(str(value)) for value in identifiers})
    if not candidates:
        return 0
    # The owner lock makes references stable for the whole batch, avoiding one
    # separate scan per file on the shared production database.
    rows = list(
        await db.scalars(
            select(BabyAttachment)
            .where(
                BabyAttachment.id.in_(candidates),
                BabyAttachment.app_user_id == owner,
                BabyAttachment.generation == generation,
                BabyAttachment.state != "deleted",
                ~attachment_references(owner, generation, BabyAttachment.id),
            )
            .order_by(BabyAttachment.id)
            .execution_options(populate_existing=True)
        )
    )
    retired = 0
    for row in rows:
        await acquire_recipe_media_lock(db, row.id)
        db.add(cleanup_job(owner, [attachment_prefix(row.id, owner, generation)]))
        row.state = "deleted"
        retired += 1
    return retired


async def reconcile_attachment_quota(db, owner, generation, *, retaining=None):
    """Bounded upload-admission maintenance, without touching active uploads.

    Failed cleanup never frees an abandoned pending reservation. Ready uploads
    that were never attached/discarded are eligible after seven days; live
    records and queued/processing imports always retain their files. Completed
    captures whose files were removed can be reclaimed after a short ACK grace.
    """
    with db.no_autoflush:
        await membership_for(db, owner, generation=generation, write=True)
    await db.flush()
    cutoff = now() - timedelta(hours=1)
    pending = list(
        await db.scalars(
            select(BabyAttachment)
            .join(
                DeletionCleanupJob,
                DeletionCleanupJob.id == BabyAttachment.cleanup_job_id,
            )
            .where(
                BabyAttachment.app_user_id == owner,
                BabyAttachment.generation == generation,
                BabyAttachment.state == "pending",
                BabyAttachment.created_at <= cutoff,
                DeletionCleanupJob.app_user_id == owner,
                DeletionCleanupJob.kind == "baby_media",
                DeletionCleanupJob.status == "completed",
                DeletionCleanupJob.completed_at.is_not(None),
                DeletionCleanupJob.completed_at >= BabyAttachment.created_at,
                DeletionCleanupJob.attempt_count > 0,
                DeletionCleanupJob.storage_prefix_count == 1,
                DeletionCleanupJob.storage_prefixes == [],
                DeletionCleanupJob.last_error.is_(None),
                DeletionCleanupJob.lease_token.is_(None),
                ~attachment_references(owner, generation, BabyAttachment.id),
            )
            .order_by(BabyAttachment.created_at, BabyAttachment.id)
            .limit(100)
        )
    )
    reclaimed = 0
    for row in pending:
        await acquire_recipe_media_lock(db, row.id)
        if row.object_key != attachment_prefix(row.id, owner, generation) + "asset":
            continue
        row.state = "deleted"
        reclaimed += 1  # The matching persisted cleanup already completed.
    terminal_capture = (
        select(BabyImport.id)
        .where(
            BabyImport.app_user_id == owner,
            BabyImport.generation == generation,
            BabyImport.status.not_in(["queued", "processing"]),
            BabyImport.request["attachment_ids"].contains(
                func.jsonb_build_array(cast(BabyAttachment.id, String))
            ),
        )
        .exists()
    )
    last_confirmed = func.greatest(
        BabyAttachment.created_at,
        func.coalesce(DeletionCleanupJob.updated_at, BabyAttachment.created_at),
    )
    abandoned = list(
        await db.scalars(
            select(BabyAttachment.id)
            .outerjoin(
                DeletionCleanupJob,
                and_(
                    DeletionCleanupJob.id == BabyAttachment.cleanup_job_id,
                    DeletionCleanupJob.app_user_id == owner,
                    DeletionCleanupJob.kind == "baby_media",
                ),
            )
            .where(
                BabyAttachment.app_user_id == owner,
                BabyAttachment.generation == generation,
                BabyAttachment.state == "ready",
                or_(
                    last_confirmed < now() - timedelta(days=7),
                    and_(terminal_capture, last_confirmed < now() - timedelta(minutes=5)),
                ),
                BabyAttachment.id != retaining if retaining else True,
                ~attachment_references(owner, generation, BabyAttachment.id),
            )
            .order_by(BabyAttachment.created_at, BabyAttachment.id)
            .limit(100)
        )
    )
    if abandoned:
        reclaimed += await retire_unreferenced_attachments(db, owner, generation, abandoned)
    return reclaimed


async def _shielded_write(**kwargs):
    task = asyncio.create_task(
        asyncio.to_thread(
            storage.put,
            kwargs["Key"],
            kwargs["Body"],
            kwargs["ContentType"],
            service=storage_service,
        )
    )
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        # Do not release account/media locks while an uninterruptible SDK write
        # can still recreate an object behind the cleanup worker.
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        if task.done() and not task.cancelled():
            task.exception()
        raise


async def validate_payload(payload, mime):
    if mime.startswith("image/"):
        try:
            valid = await asyncio.to_thread(
                validate_image_bytes, payload, max_bytes=8 * 1024 * 1024, declared_content_type=mime
            )
            image = await asyncio.to_thread(normalize_thumbnail_image, valid, max_dimension=2000)
            return image.data, "image/webp"
        except ImageValidationError:
            raise HTTPException(422, "Choose a valid image up to 8 MiB") from None
    if mime == "application/pdf":
        if len(payload) > 2 * 1024 * 1024 or not payload.startswith(b"%PDF-"):
            raise HTTPException(422, "Choose a PDF up to 2 MiB")
        from app.domains.workouts.extraction import _pdf_parts

        try:
            await _pdf_parts(payload)
        except Exception:
            raise HTTPException(422, "Choose an unencrypted PDF with up to 30 pages") from None
        return payload, mime
    with TemporaryDirectory(prefix="baby-verify-") as directory:
        from app.domains.baby.media import EXTENSIONS, matches_container, probe

        if not matches_container(payload, mime):
            raise HTTPException(422, "This file does not match the selected media type")
        path = Path(directory) / ("media" + EXTENSIONS[mime])
        path.write_bytes(payload)
        try:
            duration = await probe(path, mime=mime)
        except Exception:
            duration = None
        if type(duration) not in {float, int} or not 0 < duration <= 1800:
            raise HTTPException(422, "Choose readable audio or video up to 30 minutes")
    return payload, mime


@upload_router.post("/attachments")
async def upload_attachment(
    user: User,
    db: Database,
    generation: Generation,
    file: UploadFile = File(...),
    upload_id: UUID | None = Header(default=None, alias="Idempotency-Key"),
):
    await membership_for(db, user.id, generation=generation, write=True)
    if not storage.available(storage_service):
        raise HTTPException(503, "Private file storage is temporarily unavailable")
    mime = (file.content_type or "").split(";")[0].lower()
    if mime not in ALLOWED:
        raise HTTPException(422, "Choose an image, PDF, audio, or video file")
    payload = await file.read(MAX_BYTES + 1)
    await file.close()
    if not payload or len(payload) > MAX_BYTES:
        raise HTTPException(413, "Choose a file up to 25 MiB")
    byte_hash = hashlib.sha256(mime.encode() + b"\0" + payload).hexdigest()
    identifier = upload_id or uuid4()
    # Persist bounded reclamation even if remaining reservations still exceed
    # quota, so the next admission can make further progress instead of rolling
    # back the same batch forever.
    if await reconcile_attachment_quota(db, user.id, generation, retaining=identifier):
        await db.commit()
        await membership_for(db, user.id, generation=generation, write=True)
    prior = await db.get(BabyAttachment, identifier, populate_existing=True)
    if prior:
        if (
            prior.app_user_id != user.id
            or prior.generation != generation
            or prior.byte_hash != byte_hash
        ):
            raise HTTPException(409, "This upload identity has different content")
        if prior.state == "ready":
            await acquire_recipe_media_lock(db, identifier)
            receipt = (
                await db.get(DeletionCleanupJob, prior.cleanup_job_id, populate_existing=True)
                if prior.cleanup_job_id
                else None
            )
            if receipt is None:
                # Retained assets can outlive an administratively pruned receipt.
                # Restore content-free confirmation metadata, without writing bytes.
                receipt = cleanup_job(user.id, [attachment_prefix(identifier, user.id, generation)])
                receipt.id, receipt.status, receipt.completed_at = uuid4(), "completed", now()
                receipt.storage_prefixes, receipt.next_attempt_at = [], None
                db.add(receipt)
                prior.cleanup_job_id = receipt.id
            elif (
                receipt.app_user_id != user.id
                or receipt.kind != "baby_media"
                or receipt.status != "completed"
            ):
                raise HTTPException(409, "This attachment needs a fresh upload")
            receipt.updated_at = now()
            await db.commit()  # Renew grace across the following record-save request.
            return metadata(prior)
        if prior.state == "deleted":
            raise HTTPException(410, "This attachment was removed")
    total = await db.scalar(
        select(func.coalesce(func.sum(BabyAttachment.size), 0)).where(
            BabyAttachment.app_user_id == user.id,
            BabyAttachment.generation == generation,
            BabyAttachment.state != "deleted",
        )
    )
    count = await db.scalar(
        select(func.count())
        .select_from(BabyAttachment)
        .where(
            BabyAttachment.app_user_id == user.id,
            BabyAttachment.created_at > now() - timedelta(days=1),
        )
    )
    if total - (prior.size if prior else 0) + len(payload) > MAX_TOTAL_BYTES or (
        prior is None and count >= 100
    ):
        raise HTTPException(429, "Private file allowance reached; remove unused attachments")
    if prior is None:
        intent = cleanup_job(
            user.id,
            [attachment_prefix(identifier, user.id, generation)],
            after=now() + timedelta(hours=1),
        )
        db.add(intent)
        await db.flush()
        name = re.sub(r"[\x00-\x1f\x7f/\\]", "_", file.filename or "Attachment")[:180]
        prior = BabyAttachment(
            id=identifier,
            app_user_id=user.id,
            generation=generation,
            name=name,
            mime_type=mime,
            size=len(payload),
            object_key=attachment_prefix(identifier, user.id, generation) + "asset",
            byte_hash=byte_hash,
            state="pending",
            cleanup_job_id=intent.id,
        )
        db.add(prior)
    await db.commit()  # Crash/cancellation after admission leaves a cleanup receipt.
    payload, validated_mime = await validate_payload(payload, mime)
    await membership_for(db, user.id, generation=generation, write=True)
    await acquire_recipe_media_lock(db, identifier)
    row = await owned(db, BabyAttachment, user.id, generation, identifier)
    guard = await db.get(DeletionCleanupJob, row.cleanup_job_id, populate_existing=True)
    if (
        row.state == "deleted"
        or guard is None
        or guard.status != "queued"
        or guard.next_attempt_at <= now()
    ):
        raise HTTPException(410, "Upload expired; choose the file again")
    try:
        await _shielded_write(
            Bucket=storage_service.bucket_name,
            Key=row.object_key,
            Body=payload,
            ContentType=validated_mime,
            ServerSideEncryption="AES256",
            CacheControl="private, no-store",
        )
    except asyncio.CancelledError:
        raise
    except Exception:
        raise HTTPException(503, "Upload did not finish; please retry") from None
    row.state, row.mime_type, row.size = "ready", validated_mime, len(payload)
    guard.status, guard.completed_at, guard.storage_prefixes = "completed", now(), []
    await db.commit()
    return metadata(row)


async def read_bytes(row):
    if not storage.available(storage_service):
        raise HTTPException(503, "Private file storage is temporarily unavailable")

    def read():
        payload = storage.read(row.object_key, MAX_BYTES, service=storage_service)
        if len(payload) > MAX_BYTES or len(payload) != row.size:
            raise ValueError("Asset size mismatch")
        return payload

    try:
        return await asyncio.to_thread(read)
    except Exception:
        raise HTTPException(503, "This private attachment is temporarily unavailable") from None


@router.get("/attachments/{identifier}/metadata")
async def get_attachment_metadata(identifier: UUID, user: User, db: Database):
    member = await membership_for(db, user.id)
    row = await owned(db, BabyAttachment, user.id, member.generation, identifier)
    if row.state != "ready":
        raise HTTPException(404, "Attachment unavailable")
    return metadata(row)


@router.get("/attachments/{identifier}")
async def get_attachment(identifier: UUID, user: User, db: Database):
    member = await membership_for(db, user.id, write=True)
    row = await owned(db, BabyAttachment, user.id, member.generation, identifier)
    if row.state != "ready":
        raise HTTPException(404, "Attachment unavailable")
    await acquire_recipe_media_lock(db, identifier)
    payload = await read_bytes(row)
    from urllib.parse import quote

    return Response(
        payload,
        media_type=row.mime_type,
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(row.name)}",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/attachments/{identifier}/release", status_code=204)
async def release_attachment(identifier: UUID, user: User, db: Database, generation: Generation):
    """Discard an uploaded draft asset; shared/processing files are retained."""
    await retire_unreferenced_attachments(db, user.id, generation, [identifier])
    await db.commit()
    return Response(status_code=204)


@router.delete("/attachments/{identifier}", status_code=204)
async def delete_attachment(identifier: UUID, user: User, db: Database, generation: Generation):
    await membership_for(db, user.id, generation=generation, write=True)
    await acquire_recipe_media_lock(db, identifier)
    row = await owned(db, BabyAttachment, user.id, generation, identifier)
    if row.state != "deleted":
        db.add(cleanup_job(user.id, [attachment_prefix(identifier, user.id, generation)]))
        row.state = "deleted"
        for record in await db.scalars(
            select(BabyRecord).where(
                BabyRecord.app_user_id == user.id, BabyRecord.generation == generation
            )
        ):
            if str(identifier) in record.data.get("attachment_ids", []):
                record.data = {
                    **record.data,
                    "attachment_ids": [
                        value for value in record.data["attachment_ids"] if value != str(identifier)
                    ],
                }
                record.revision, record.updated_at = record.revision + 1, now()
        for job in await db.scalars(
            select(BabyImport).where(
                BabyImport.app_user_id == user.id,
                BabyImport.generation == generation,
                BabyImport.status.in_(["queued", "processing"]),
            )
        ):
            if str(identifier) in job.request.get("attachment_ids", []):
                job.status, job.error, job.lease_token, job.lease_until = (
                    "cancelled",
                    "An attachment was removed. Your original source is saved.",
                    None,
                    None,
                )
                source = await db.get(BabyRecord, job.record_id)
                if (
                    source
                    and source.app_user_id == user.id
                    and source.generation == generation
                    and source.deleted_at is None
                ):
                    source.data = {**source.data, "status": "cancelled"}
                    source.revision, source.updated_at = source.revision + 1, now()
    await db.commit()
    return Response(status_code=204)
