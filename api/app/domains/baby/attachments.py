"""Private S3 assets. Durable cleanup intent always precedes external writes."""

import asyncio
import hashlib
import re
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Header, HTTPException, Response, UploadFile
from sqlalchemy import func, select

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
    prior = await db.get(BabyAttachment, identifier, populate_existing=True)
    if prior:
        if (
            prior.app_user_id != user.id
            or prior.generation != generation
            or prior.byte_hash != byte_hash
        ):
            raise HTTPException(409, "This upload identity has different content")
        if prior.state == "ready":
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
