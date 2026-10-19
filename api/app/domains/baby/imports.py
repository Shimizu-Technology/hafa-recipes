"""Durable capture API. A source bookmark exists before any media/AI work."""

from datetime import timedelta
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.domains.baby.dependencies import Database, Generation, User
from app.domains.baby.lifecycle import digest, membership_for, now, owned, validate_relations
from app.domains.baby.models import BabyImport, BabyRecord
from app.domains.baby.schemas import ImportCreate, SourceData
from app.domains.baby.security import BabyRoute

router = APIRouter(tags=["baby"], route_class=BabyRoute)


def import_response(row):
    return {
        "id": str(row.id),
        "status": row.status,
        "record_id": str(row.record_id),
        "error": row.error,
    }


@router.post("/imports")
async def create_import(body: ImportCreate, user: User, db: Database, generation: Generation):
    member = await membership_for(db, user.id, generation=generation, write=True)
    request = body.model_dump(mode="json")
    fingerprint = digest(request)
    prior = await db.get(BabyImport, body.id)
    if prior:
        if (
            prior.app_user_id != user.id
            or prior.generation != generation
            or prior.creation_hash != fingerprint
        ):
            raise HTTPException(
                409, "This capture identity was already used with different content"
            )
        return import_response(prior)
    await validate_relations(
        db, user.id, generation, body.child_id, {"attachment_ids": body.attachment_ids}
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
            BabyImport.generation == generation,
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
        source = await owned(db, BabyRecord, user.id, generation, body.record_id)
        if source.kind != "source":
            raise HTTPException(422, "Only saved sources can be processed")
        active = await db.scalar(
            select(BabyImport.id)
            .where(
                BabyImport.app_user_id == user.id,
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
            db, user.id, generation, source.child_id, {"attachment_ids": request["attachment_ids"]}
        )
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
            generation=generation,
            kind="source",
            title=title_text.splitlines()[0][:100] if title_text else "Saved source",
            body="",
            child_id=body.child_id,
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
    await db.commit()
    from app.domains.baby.runtime import baby_worker

    baby_worker.notify()
    return import_response(row)


@router.get("/imports/{identifier}")
async def get_import(identifier: UUID, user: User, db: Database):
    member = await membership_for(db, user.id)
    return import_response(await owned(db, BabyImport, user.id, member.generation, identifier))


@router.post("/imports/{identifier}/retry")
async def retry_import(identifier: UUID, user: User, db: Database, generation: Generation):
    member = await membership_for(db, user.id, generation=generation, write=True)
    row = await owned(db, BabyImport, user.id, generation, identifier)
    if row.status in {"queued", "processing", "ready"}:
        return import_response(row)
    if row.attempts >= 5:
        raise HTTPException(429, "This source reached the retry limit; the original remains saved")
    source = await owned(db, BabyRecord, user.id, generation, row.record_id)
    await validate_relations(
        db,
        user.id,
        generation,
        source.child_id,
        {"attachment_ids": row.request.get("attachment_ids", [])},
    )
    row.status, row.error, row.consent_epoch = "queued", None, member.consent_epoch
    row.lease_token, row.lease_until, row.updated_at = None, None, now()
    source.data = {**source.data, "status": "queued"}
    source.revision, source.updated_at = source.revision + 1, now()
    await db.commit()
    from app.domains.baby.runtime import baby_worker

    baby_worker.notify()
    return import_response(row)


@router.post("/imports/{identifier}/cancel")
async def cancel_import(identifier: UUID, user: User, db: Database, generation: Generation):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned(db, BabyImport, user.id, generation, identifier)
    if row.status in {"queued", "processing"}:
        row.status, row.error, row.lease_token, row.lease_until, row.updated_at = (
            "cancelled",
            None,
            None,
            None,
            now(),
        )
        source = await owned(db, BabyRecord, user.id, generation, row.record_id)
        source.data = {**source.data, "status": "cancelled"}
        source.revision, source.updated_at = source.revision + 1, now()
    await db.commit()
    return import_response(row)
