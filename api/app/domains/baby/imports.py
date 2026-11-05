"""Durable capture API. A source bookmark exists before any media/AI work."""

from datetime import timedelta
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.domains.baby.access import access_for, touch
from app.domains.baby.dependencies import Access, Database, Generation, User
from app.domains.baby.lifecycle import (
    digest,
    membership_for,
    now,
    owned,
    personal_child_link,
    validate_relations,
)
from app.domains.baby.models import BabyImport, BabyRecord
from app.domains.baby.schemas import DEFAULT_SOURCE_TITLE, ImportCreate, SourceData
from app.domains.baby.security import BabyRoute

router = APIRouter(tags=["baby"], route_class=BabyRoute)


def import_response(row, access=None):
    result = {
        "id": str(row.id),
        "status": row.status,
        "record_id": str(row.record_id),
        "error": row.error,
    }
    if getattr(access, "enabled", False) and access.client == "3":
        result.update(space_id=str(row.space_id), generation=row.generation)
    return result


@router.post("/imports")
async def create_import(body: ImportCreate, user: User, db: Database, generation: Generation,
                        access: Access = None):
    return await admit_import(
        body, user, db, generation, automatic=getattr(body, "automatic", False), access=access
    )


async def admit_import(body, user, db, generation, *, automatic=False, access=None, stored_space_id=None):
    if access is None:
        access = await access_for(db, user.id, generation=None, stored_space_id=stored_space_id, write=True)
    member = access.member
    if access.enabled and access.target.role == "caregiver":
        raise HTTPException(403, "This role cannot create saved sources")
    if automatic and not (
        member.profile.get("ai_consent") and member.profile.get("auto_process_shares")
    ):
        raise HTTPException(403, "Automatic processing permission is off; the original stays saved")
    if automatic and getattr(body, "automatic_epoch", 0) != member.profile.get(
        "auto_process_epoch", 0
    ):
        raise HTTPException(403, "Automatic permission changed; the original stays saved")
    request = body.model_dump(mode="json")
    request.pop("automatic_epoch", None)
    if automatic and getattr(body, "automatic_epoch", 0):
        request["automatic_epoch"] = body.automatic_epoch
    request.pop("automatic", None)
    if automatic:
        request["automatic"] = True
    fingerprint = digest(request)
    if not access.enabled:
        access.check_generation(generation)
    prior = await db.get(BabyImport, body.id)
    if prior:
        if access.enabled:
            access.grant(prior)
        if (
            prior.app_user_id != user.id
            or (not access.enabled and prior.generation != generation)
            or prior.creation_hash != fingerprint
        ):
            raise HTTPException(
                409, "This capture identity was already used with different content"
            )
        return import_response(prior, access)
    access.check_generation(generation)
    child_id = await personal_child_link(db, access, body.child_id, "import", body.attachment_ids)
    if child_id != body.child_id:
        request["child_id"] = None
    await validate_relations(
        db, access, generation, child_id, {"attachment_ids": body.attachment_ids}, kind="import"
    )
    count = await db.scalar(
        select(func.count())
        .select_from(BabyImport)
        .where(BabyImport.app_user_id == user.id, BabyImport.created_at > now() - timedelta(days=1))
    )
    active_count = await db.scalar(
        select(func.count())
        .select_from(BabyImport)
        .where(
            BabyImport.app_user_id == user.id,
            (BabyImport.generation == generation) if not access.enabled else True,
            BabyImport.status.in_(["queued", "processing"]),
        )
    )
    if active_count >= 5:
        raise HTTPException(
            429, "Five sources are already waiting; let them finish before adding more"
        )
    if count >= 30:
        raise HTTPException(429, "Daily import allowance reached; your library is still available")
    if body.record_id:
        source = await owned(db, BabyRecord, access, generation, body.record_id)
        if source.kind != "source":
            raise HTTPException(422, "Only saved sources can be processed")
        active = await db.scalar(
            select(BabyImport.id)
            .where(
                (BabyImport.space_id == access.target.id) if access.enabled else (BabyImport.app_user_id == user.id),
                BabyImport.generation == generation,
                BabyImport.record_id == source.id,
                BabyImport.status.in_(["queued", "processing"]),
            )
            .limit(1)
        )
        if active:
            raise HTTPException(409, "This source is already processing")
        source_id = source.id
        request = {
            **request,
            "url": body.url or source.data.get("url"),
            "text": body.text or source.data.get("source_text"),
            "attachment_ids": request["attachment_ids"] or source.data.get("attachment_ids", []),
            "topics": request["topics"] or source.data.get("topics", []),
            "child_id": str(source.child_id) if source.child_id else None,
        }
        await validate_relations(
            db, access, generation, source.child_id, {"attachment_ids": request["attachment_ids"]}
        )
        original_text = (source.data.get("source_text") or "").strip()
        caption_title = original_text.splitlines()[0][:100] if original_text else DEFAULT_SOURCE_TITLE
        if automatic and source.revision == 1 and source.title in {DEFAULT_SOURCE_TITLE, caption_title}:
            request["automatic_title"] = source.title
        source.data = {**source.data, "status": "queued"}
        source.revision, source.updated_at = source.revision + 1, now()
    else:
        source_id = uuid5(NAMESPACE_URL, f"hafa-baby-source:{user.id}:{generation}:{body.id}")
        data = SourceData(
            url=body.url,
            source_text=body.text,
            topics=body.topics,
            attachment_ids=body.attachment_ids,
            status="queued",
        ).model_dump(mode="json")
        title_text = (body.text or "").strip()
        source = BabyRecord(
            id=source_id,
            app_user_id=user.id,
            space_id=access.target.id if access.enabled else member.personal_space_id,
            generation=generation,
            kind="source",
            title=title_text.splitlines()[0][:100] if title_text else DEFAULT_SOURCE_TITLE,
            body="",
            child_id=child_id,
            occurred_at=now(),
            data=data,
            revision=1,
            creation_hash=fingerprint,
            created_at=now(),
            updated_at=now(),
        )
        db.add(source)
    row = BabyImport(
        id=body.id,
        app_user_id=user.id,
        space_id=access.target.id if access.enabled else member.personal_space_id,
        generation=generation,
        consent_epoch=member.consent_epoch,
        creation_hash=fingerprint,
        request=request,
        status="queued",
        record_id=source_id,
        attempts=0,
        created_at=now(),
        updated_at=now(),
    )
    db.add(row)
    await touch(source, access.grant(source) if access.enabled else None)
    await touch(row, access.target)
    await db.commit()
    from app.domains.baby.runtime import baby_worker

    baby_worker.notify()
    return import_response(row, access)


async def pending_capture(db, owner, generation, identifier):
    from app.domains.baby.share_models import BabyShareCapture
    from app.domains.baby.share_router import share_schema_available

    if await share_schema_available(db):
        capture = await db.get(BabyShareCapture, identifier)
        if getattr(owner, "enabled", False):
            return await owner.row(db, BabyShareCapture, identifier,
                                   write=owner.target is not None and owner.target.transaction is not None)
        if capture and capture.app_user_id == getattr(owner, "actor", owner) and capture.generation == generation:
            return capture
    raise HTTPException(404, "Saved processing request not found")


def capture_progress(capture):
    return {
        "id": str(capture.id),
        "record_id": str(capture.record_id),
        "status": "deferred" if capture.status == "deferred" else "saved",
        "error": None,
    }


@router.get("/imports/{identifier}")
async def get_import(identifier: UUID, user: User, db: Database, access: Access = None):
    member = access.member
    if not access.enabled:
        await membership_for(db, user.id, write=True)
    if await db.get(BabyImport, identifier) is not None:
        return import_response(await owned(db, BabyImport, access, member.generation, identifier), access)
    return capture_progress(await pending_capture(db, access, member.generation, identifier))


@router.post("/imports/{identifier}/retry")
async def retry_import(identifier: UUID, user: User, db: Database, generation: Generation,
                       access: Access = None):
    access.check_generation(generation)
    member = access.member
    row = await owned(db, BabyImport, access, generation, identifier)
    if access.enabled and row.app_user_id != user.id:
        raise HTTPException(403, "Only the requester can retry this import; start your own import")
    if row.status in {"queued", "processing", "ready"}:
        return import_response(row, access)
    if row.attempts >= 5:
        raise HTTPException(429, "This source reached the retry limit; the original remains saved")
    source = await owned(db, BabyRecord, access, generation, row.record_id)
    await validate_relations(
        db,
        access,
        generation,
        source.child_id,
        {"attachment_ids": row.request.get("attachment_ids", [])},
    )
    if access.enabled:
        member = await membership_for(db, row.app_user_id)
    # Retry is an explicit request, independent of automatic-share permission.
    if row.request.get("automatic"):
        row.request = {
            key: value
            for key, value in row.request.items()
            if key not in {"automatic", "automatic_epoch", "automatic_title"}
        }
    row.status, row.error, row.consent_epoch = "queued", None, member.consent_epoch
    row.lease_token, row.lease_until, row.updated_at = None, None, now()
    source.data = {**source.data, "status": "queued"}
    source.revision, source.updated_at = source.revision + 1, now()
    await touch(source, access.grant(source) if access.enabled else None)
    await touch(row, access.grant(row) if access.enabled else None)
    await db.commit()
    from app.domains.baby.runtime import baby_worker

    baby_worker.notify()
    return import_response(row, access)


@router.post("/imports/{identifier}/cancel")
async def cancel_import(identifier: UUID, user: User, db: Database, generation: Generation,
                        access: Access = None):
    access.check_generation(generation)
    if await db.get(BabyImport, identifier) is None:
        capture = await pending_capture(db, access, generation, identifier)
        if access.enabled and capture.app_user_id != user.id:
            raise HTTPException(403, "Only the requester can cancel this capture")
        capture.status = "saved"
        await touch(capture, access.grant(capture) if access.enabled else None)
        await db.commit()
        return capture_progress(capture)
    row = await owned(db, BabyImport, access, generation, identifier)
    if row.status in {"queued", "processing"}:
        row.status, row.error, row.lease_token, row.lease_until, row.updated_at = (
            "cancelled",
            None,
            None,
            None,
            now(),
        )
        await touch(row, access.grant(row) if access.enabled else None)
        source = await owned(db, BabyRecord, access, generation, row.record_id)
        source.data = {**source.data, "status": "cancelled"}
        source.revision, source.updated_at = source.revision + 1, now()
        await touch(source, access.grant(source) if access.enabled else None)
        await touch(row, access.grant(row) if access.enabled else None)
    await db.commit()
    return import_response(row, access)
