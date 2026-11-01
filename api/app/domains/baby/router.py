"""Owner-scoped records and product lifecycle. No AI write bypass exists."""

from copy import deepcopy
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import ValidationError
from sqlalchemy import func, or_, select

from app.domains.baby.attachments import retire_unreferenced_attachments, upload_router
from app.domains.baby.attachments import router as attachments_router
from app.domains.baby.chat import router as chat_router
from app.domains.baby.dependencies import Database, Generation, Limit, Offset, User
from app.domains.baby.imports import router as imports_router
from app.domains.baby.lifecycle import (
    digest,
    erase_product_data,
    lock_owner,
    membership_for,
    now,
    owned,
    validate_relations,
)
from app.domains.baby.models import (
    BabyAttachment,
    BabyChild,
    BabyConversation,
    BabyImport,
    BabyMembership,
    BabyMessage,
    BabyRecord,
)
from app.domains.baby.queries import records_query, stage_filter, timing_bounds, timing_filter
from app.domains.baby.schemas import (
    ChildCreate,
    ChildPatch,
    CollectionData,
    Kind,
    Profile,
    ProfilePatch,
    RecordCreate,
    RecordPatch,
    SourceRelevance,
    Stage,
)
from app.domains.baby.security import BabyRoute
from app.domains.baby.suggestions import router as suggestions_router

router = APIRouter(prefix="/api/v1/baby", tags=["baby"], route_class=BabyRoute)


def child_response(row):
    return {
        "id": str(row.id),
        "name": row.name,
        "birth_date": row.birth_date,
        "due_date": row.due_date,
        "revision": row.revision,
    }


def record_response(row):
    return {
        key: getattr(row, key)
        for key in (
            "id",
            "kind",
            "title",
            "body",
            "child_id",
            "occurred_at",
            "data",
            "revision",
            "created_at",
            "updated_at",
        )
    }


# Clients that predate these fields omit them; only an explicit null clears one.
SOURCE_ADDITIONS = ("relevance", "suggested_category")


def source_patch_data(current, patch):
    data = dict(patch)
    for key in SOURCE_ADDITIONS:
        if key not in data and key in current:
            data[key] = deepcopy(current[key])
    relevance = data.get("relevance")
    if isinstance(relevance, dict):
        stored = current.get("relevance") or {}
        # A deliberate timing edit is the user's, and reprocessing keeps it.
        origin = (
            stored.get("origin", "source") if same_timing(relevance, stored) else "user"
        )
        data["relevance"] = {**relevance, "origin": origin}
    return data


def same_timing(proposed, current):
    try:
        return SourceRelevance.model_validate(
            {**proposed, "origin": "source"}
        ) == SourceRelevance.model_validate({**(current or {}), "origin": "source"})
    except ValidationError:
        return False


def revision_matches(row, revision):
    if row.revision != revision:
        raise HTTPException(409, "This item changed on another device; reload before saving")


@router.get("/bootstrap")
async def bootstrap(user: User, db: Database):
    return await bootstrap_state(user, db, create=False)


@router.post("/bootstrap")
async def initialize(user: User, db: Database):
    return await bootstrap_state(user, db, create=True)


async def bootstrap_state(user, db, *, create):
    if create:
        await lock_owner(db, user.id)
    member = await db.get(BabyMembership, user.id, populate_existing=True)
    if member is None:
        if not create:
            raise HTTPException(409, "Open Baby to initialize your private space")
        member = BabyMembership(
            app_user_id=user.id,
            generation=1,
            status="active",
            consent_epoch=0,
            profile=Profile(display_name=user.first_name or "").model_dump(),
        )
        db.add(member)
        await db.flush()
    from app.domains.baby.provider import BabyProvider

    children = (
        await db.scalars(
            select(BabyChild)
            .where(
                BabyChild.app_user_id == user.id,
                BabyChild.generation == member.generation,
                BabyChild.deleted_at.is_(None),
            )
            .order_by(BabyChild.name)
        )
        if member.status == "active"
        else []
    )
    result = {
        "profile": Profile.model_validate(member.profile).model_dump(),
        "children": [child_response(row) for row in children],
        "generation": member.generation,
        "active": member.status == "active",
        "ai_available": BabyProvider().enabled,
    }
    await db.commit()
    return result


@router.post("/enroll")
async def enroll(user: User, db: Database, generation: Generation):
    member = await membership_for(db, user.id, generation=generation, write=True, active=False)
    if member.status == "deleted":
        member.status = "active"
        member.profile = Profile().model_dump()
        member.updated_at = now()
    await db.commit()
    return {"generation": member.generation, "active": True}


@router.patch("/profile")
async def patch_profile(body: ProfilePatch, user: User, db: Database, generation: Generation):
    member = await membership_for(db, user.id, generation=generation, write=True)
    values = {
        **Profile.model_validate(member.profile).model_dump(),
        **body.model_dump(exclude_unset=True),
    }
    try:
        profile = Profile.model_validate(values)
    except ValidationError:
        raise HTTPException(422, "Choose valid profile settings") from None
    if not profile.ai_consent:
        profile.auto_process_shares = False
    previous_automatic = bool(
        member.profile.get("ai_consent") and member.profile.get("auto_process_shares")
    )
    if previous_automatic != bool(profile.ai_consent and profile.auto_process_shares):
        profile.auto_process_epoch += 1
    if profile.ai_consent != bool(member.profile.get("ai_consent")):
        member.consent_epoch += 1
        if not profile.ai_consent:
            jobs = await db.scalars(
                select(BabyImport).where(
                    BabyImport.app_user_id == user.id,
                    BabyImport.generation == generation,
                    BabyImport.status.in_(["queued", "processing"]),
                )
            )
            for job in jobs:
                job.status, job.error, job.lease_token, job.lease_until = (
                    "cancelled",
                    "AI permission was withdrawn. Your original source is saved.",
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
    member.profile, member.updated_at = profile.model_dump(), now()
    if not profile.auto_process_shares:
        from app.domains.baby.share_models import BabyShareCapture
        from app.domains.baby.share_router import share_schema_available

        if await share_schema_available(db):
            deferred = await db.scalars(
                select(BabyShareCapture).where(
                    BabyShareCapture.app_user_id == user.id,
                    BabyShareCapture.generation == generation,
                    BabyShareCapture.status == "deferred",
                )
            )
            for receipt in deferred:
                receipt.status = "saved"
        # Turning off automatic processing does not revoke a deliberately
        # requested manual import. Fence only automatic jobs, including leases.
        automatic_jobs = await db.scalars(
            select(BabyImport).where(
                BabyImport.app_user_id == user.id,
                BabyImport.generation == generation,
                BabyImport.status.in_(["queued", "processing"]),
                BabyImport.request["automatic"].as_boolean().is_(True),
            )
        )
        for job in automatic_jobs:
            job.status, job.error, job.lease_token, job.lease_until = (
                "cancelled",
                "Automatic processing was turned off. Your original is saved.",
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
    return member.profile


@router.get("/children")
async def children(user: User, db: Database):
    member = await membership_for(db, user.id)
    rows = await db.scalars(
        select(BabyChild)
        .where(
            BabyChild.app_user_id == user.id,
            BabyChild.generation == member.generation,
            BabyChild.deleted_at.is_(None),
        )
        .order_by(BabyChild.name)
    )
    return {"items": [child_response(row) for row in rows]}


@router.post("/children")
async def create_child(body: ChildCreate, user: User, db: Database, generation: Generation):
    await membership_for(db, user.id, generation=generation, write=True)
    fingerprint = digest(body.model_dump(mode="json"))
    prior = await db.get(BabyChild, body.id)
    if prior:
        if (
            prior.app_user_id != user.id
            or prior.generation != generation
            or prior.creation_hash != fingerprint
        ):
            raise HTTPException(409, "This save identity was already used")
        if prior.deleted_at:
            raise HTTPException(410, "This child profile was removed; create a new profile")
        return child_response(prior)
    count = await db.scalar(
        select(func.count())
        .select_from(BabyChild)
        .where(
            BabyChild.app_user_id == user.id,
            BabyChild.generation == generation,
            BabyChild.deleted_at.is_(None),
        )
    )
    if count >= 30:
        raise HTTPException(422, "Child profile limit reached")
    row = BabyChild(
        **body.model_dump(),
        app_user_id=user.id,
        generation=generation,
        revision=1,
        creation_hash=fingerprint,
    )
    db.add(row)
    await db.commit()
    return child_response(row)


@router.patch("/children/{identifier}")
async def patch_child(
    identifier: UUID, body: ChildPatch, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned(db, BabyChild, user.id, generation, identifier)
    revision_matches(row, body.revision)
    values = {**child_response(row), **body.model_dump(exclude_unset=True, exclude={"revision"})}
    values.pop("revision", None)
    try:
        valid = ChildCreate.model_validate(values)
    except ValidationError:
        raise HTTPException(422, "Enter valid child details") from None
    for key in ("name", "birth_date", "due_date"):
        setattr(row, key, getattr(valid, key))
    row.revision += 1
    await db.commit()
    return child_response(row)


@router.delete("/children/{identifier}", status_code=204)
async def delete_child(
    identifier: UUID,
    user: User,
    db: Database,
    generation: Generation,
    revision: Annotated[int, Query(ge=1)],
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned(db, BabyChild, user.id, generation, identifier)
    revision_matches(row, revision)
    for model in (BabyRecord, BabyConversation):
        for item in await db.scalars(
            select(model).where(
                model.app_user_id == user.id,
                model.generation == generation,
                model.child_id == identifier,
            )
        ):
            item.child_id, item.updated_at = None, now()
            if model is BabyRecord:
                item.revision += 1
    # Pending imports and open conversations cannot reattach a deleted child.
    for job in await db.scalars(
        select(BabyImport).where(
            BabyImport.app_user_id == user.id, BabyImport.generation == generation
        )
    ):
        if job.request.get("child_id") == str(identifier):
            job.request = {**job.request, "child_id": None}
    row.deleted_at, row.name, row.birth_date, row.due_date = now(), "", None, None
    row.revision += 1
    await db.commit()
    return Response(status_code=204)


async def record_list(
    db,
    owner,
    generation,
    kind,
    child_id,
    q,
    limit,
    offset,
    *,
    kinds=None,
    include_general=False,
    collection_id=None,
    topic=None,
    uncategorized=False,
    conditions=(),
    order=None,
    extra=None,
):
    if kind is not None and kinds is not None:
        raise HTTPException(422, "Choose kind or kinds, not both")
    if uncategorized:
        if collection_id is not None:
            raise HTTPException(422, "Choose a collection or Uncategorized, not both")
        if (kind is not None and kind != "source") or (
            kinds and any(value != "source" for value in kinds)
        ):
            raise HTTPException(422, "Uncategorized contains sources; choose source records")
    record_ids = None
    if collection_id is not None:
        collection = await owned(db, BabyRecord, owner, generation, collection_id)
        if collection.kind != "collection":
            raise HTTPException(404, "Item unavailable")
        if (kind is not None and kind != "source") or (
            kinds and any(value != "source" for value in kinds)
        ):
            raise HTTPException(422, "Collections contain sources; choose source records")
        try:
            record_ids = CollectionData.model_validate(collection.data).record_ids
        except ValidationError:
            raise HTTPException(422, "This collection needs review before opening") from None
        kind = "source"
    if child_id:
        await owned(db, BabyChild, owner, generation, child_id)
    query = records_query(
        owner,
        generation,
        kind=kind,
        child_id=None if include_general else child_id,
        q=q,
        record_ids=record_ids,
        topic=topic,
        uncategorized=uncategorized,
    )
    if kinds:
        query = query.where(BabyRecord.kind.in_(kinds))
    if child_id and include_general:
        query = query.where(or_(BabyRecord.child_id == child_id, BabyRecord.child_id.is_(None)))
    for condition in conditions:
        query = query.where(condition)
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = await db.scalars(
        query.order_by(*(order or ()), BabyRecord.occurred_at.desc(), BabyRecord.id)
        .limit(limit)
        .offset(offset)
    )
    return {
        "items": [record_response(row) for row in rows],
        "total": total,
        "has_more": offset + limit < total,
        **(extra or {}),
    }


async def timing_context(db, owner, member, child_id, pregnancy_week, baby_age_weeks):
    """Where the parent is now: an explicit week/age, or one child's due/birth date."""
    if pregnancy_week is not None and baby_age_weeks is not None:
        raise HTTPException(422, "Choose a pregnancy week or a baby age, not both")
    if pregnancy_week is not None:
        return {"stage": "pregnancy", "pregnancy_week": pregnancy_week, "basis": "query"}
    if baby_age_weeks is not None:
        return {"stage": "baby", "baby_age_weeks": baby_age_weeks, "basis": "query"}
    if child_id is not None:
        child = await owned(db, BabyChild, owner, member.generation, child_id)
    else:
        children = list(
            await db.scalars(
                select(BabyChild).where(
                    BabyChild.app_user_id == owner,
                    BabyChild.generation == member.generation,
                    BabyChild.deleted_at.is_(None),
                    or_(BabyChild.birth_date.is_not(None), BabyChild.due_date.is_not(None)),
                )
            )
        )
        if len(children) > 1:
            raise HTTPException(422, "Choose which child to show timing for")
        child = children[0] if children else None
    if child is None or not (child.birth_date or child.due_date):
        raise HTTPException(422, "Add a due date or birth date to see what is relevant now")
    today = datetime.now(ZoneInfo(Profile.model_validate(member.profile).timezone)).date()
    base = {"child_id": str(child.id), "basis": "child", "today": today.isoformat()}
    if child.birth_date and child.birth_date <= today:
        return {**base, "stage": "baby", "baby_age_weeks": min((today - child.birth_date).days // 7, 520)}
    if child.due_date is None:
        raise HTTPException(422, "Add a due date to see what is relevant now")
    # Gestational age counts 280 days to the due date; weeks are completed weeks.
    days = max(0, min(280 - (child.due_date - today).days, 45 * 7 + 6))
    return {**base, "stage": "pregnancy", "pregnancy_week": days // 7, "pregnancy_day": days % 7}


@router.get("/records")
async def records(
    user: User,
    db: Database,
    kind: Kind | None = None,
    kinds: Annotated[list[Kind] | None, Query(max_length=8)] = None,
    child_id: UUID | None = None,
    include_general: bool = False,
    collection_id: UUID | None = None,
    uncategorized: bool = False,
    topic: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    q: Annotated[str | None, Query(max_length=300)] = None,
    timing: Literal["now", "upcoming"] | None = None,
    timing_child_id: UUID | None = None,
    pregnancy_week: Annotated[int | None, Query(ge=0, le=45)] = None,
    baby_age_weeks: Annotated[int | None, Query(ge=0, le=520)] = None,
    within_weeks: Annotated[int | None, Query(ge=1, le=104)] = None,
    stage: Stage | None = None,
    limit: Limit = 30,
    offset: Offset = 0,
):
    member = await membership_for(db, user.id)
    conditions, order, extra = [], None, None
    if stage is not None:
        conditions.append(stage_filter(stage))
    if timing is not None:
        context = await timing_context(
            db, user.id, member, timing_child_id, pregnancy_week, baby_age_weeks
        )
        value = context.get("pregnancy_week", context.get("baby_age_weeks"))
        conditions.append(
            timing_filter(timing, context["stage"], value, within_weeks=within_weeks)
        )
        if timing == "upcoming":
            order = [timing_bounds(context["stage"])[1].asc()]
        extra = {"timing": {"mode": timing, **context}}
    elif any(
        value is not None
        for value in (timing_child_id, pregnancy_week, baby_age_weeks, within_weeks)
    ):
        raise HTTPException(422, "Choose timing=now or timing=upcoming")
    return await record_list(
        db,
        user.id,
        member.generation,
        kind,
        child_id,
        q,
        limit,
        offset,
        kinds=kinds,
        include_general=include_general,
        collection_id=collection_id,
        topic=topic,
        uncategorized=uncategorized,
        conditions=conditions,
        order=order,
        extra=extra,
    )


@router.get("/search")
async def search(
    user: User,
    db: Database,
    q: Annotated[str, Query(min_length=1, max_length=300)],
    kind: Kind | None = None,
    kinds: Annotated[list[Kind] | None, Query(max_length=8)] = None,
    child_id: UUID | None = None,
    include_general: bool = False,
    collection_id: UUID | None = None,
    uncategorized: bool = False,
    topic: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    limit: Limit = 30,
    offset: Offset = 0,
):
    member = await membership_for(db, user.id)
    return await record_list(
        db,
        user.id,
        member.generation,
        kind,
        child_id,
        q,
        limit,
        offset,
        kinds=kinds,
        include_general=include_general,
        collection_id=collection_id,
        topic=topic,
        uncategorized=uncategorized,
    )


@router.get("/records/{identifier}")
async def get_record(identifier: UUID, user: User, db: Database):
    member = await membership_for(db, user.id)
    return record_response(await owned(db, BabyRecord, user.id, member.generation, identifier))


@router.post("/records")
async def create_record(body: RecordCreate, user: User, db: Database, generation: Generation):
    await membership_for(db, user.id, generation=generation, write=True)
    fingerprint = digest(body.model_dump(mode="json"))
    prior = await db.get(BabyRecord, body.id)
    if prior:
        if (
            prior.app_user_id != user.id
            or prior.generation != generation
            or prior.creation_hash != fingerprint
        ):
            raise HTTPException(409, "This save identity was already used with different content")
        if prior.deleted_at:
            raise HTTPException(410, "This entry was removed; create a new entry")
        return record_response(prior)
    await validate_relations(db, user.id, generation, body.child_id, body.data, record_id=body.id)
    row = BabyRecord(
        **body.model_dump(),
        app_user_id=user.id,
        generation=generation,
        revision=1,
        creation_hash=fingerprint,
        created_at=now(),
        updated_at=now(),
    )
    db.add(row)
    await db.commit()
    return record_response(row)


@router.patch("/records/{identifier}")
async def patch_record(
    identifier: UUID, body: RecordPatch, user: User, db: Database, generation: Generation
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned(db, BabyRecord, user.id, generation, identifier)
    revision_matches(row, body.revision)
    values = {key: deepcopy(getattr(row, key)) for key in RecordCreate.model_fields}
    values.update(body.model_dump(exclude_unset=True, exclude={"revision"}))
    if row.kind == "source" and isinstance(body.data, dict):
        values["data"] = source_patch_data(row.data, body.data)
    try:
        valid = RecordCreate.model_validate(values)
    except ValidationError:
        raise HTTPException(422, "Enter valid details for this entry") from None
    await validate_relations(db, user.id, generation, valid.child_id, valid.data, record_id=row.id)
    removed_attachments = set(row.data.get("attachment_ids", [])) - set(
        valid.data.get("attachment_ids", [])
    )
    for key in ("title", "body", "child_id", "occurred_at", "data"):
        setattr(row, key, getattr(valid, key))
    row.revision, row.updated_at = row.revision + 1, now()
    if removed_attachments:
        await retire_unreferenced_attachments(db, user.id, generation, removed_attachments)
    await db.commit()
    return record_response(row)


@router.delete("/records/{identifier}", status_code=204)
async def delete_record(
    identifier: UUID,
    user: User,
    db: Database,
    generation: Generation,
    revision: Annotated[int, Query(ge=1)],
):
    await membership_for(db, user.id, generation=generation, write=True)
    row = await owned(db, BabyRecord, user.id, generation, identifier)
    revision_matches(row, revision)
    # Cancel processing before deleting the source, so completion cannot recreate it.
    for job in await db.scalars(
        select(BabyImport).where(
            BabyImport.app_user_id == user.id,
            BabyImport.generation == generation,
            BabyImport.record_id == identifier,
        )
    ):
        job.status, job.lease_token, job.lease_until = "cancelled", None, None
    for collection in await db.scalars(
        select(BabyRecord).where(
            BabyRecord.app_user_id == user.id,
            BabyRecord.generation == generation,
            BabyRecord.kind == "collection",
        )
    ):
        if str(identifier) in collection.data.get("record_ids", []):
            collection.data = {
                **collection.data,
                "record_ids": [
                    value for value in collection.data["record_ids"] if value != str(identifier)
                ],
            }
            collection.revision, collection.updated_at = collection.revision + 1, now()
    removed_attachments = row.data.get("attachment_ids", [])
    row.deleted_at, row.title, row.body, row.data, row.child_id = now(), "", "", {}, None
    row.revision, row.updated_at = row.revision + 1, now()
    await retire_unreferenced_attachments(db, user.id, generation, removed_attachments)
    await db.commit()
    return Response(status_code=204)


@router.get("/export")
async def export(user: User, db: Database):
    member = await membership_for(db, user.id, write=True)
    from app.domains.baby.attachments import metadata
    from app.domains.baby.chat import conversation_response, message_response

    async def rows(model):
        return list(
            await db.scalars(
                select(model).where(
                    model.app_user_id == user.id, model.generation == member.generation
                )
            )
        )

    return {
        "format": "hafa-baby-v1",
        "exported_at": now(),
        "generation": member.generation,
        "profile": member.profile,
        "children": [
            child_response(row) for row in await rows(BabyChild) if row.deleted_at is None
        ],
        "records": [
            record_response(row) for row in await rows(BabyRecord) if row.deleted_at is None
        ],
        "attachments": [
            metadata(row) for row in await rows(BabyAttachment) if row.state == "ready"
        ],
        "conversations": [conversation_response(row) for row in await rows(BabyConversation)],
        "messages": [message_response(row) for row in await rows(BabyMessage)],
    }


@router.delete("/data")
async def delete_data(
    user: User,
    db: Database,
    generation: Generation,
    expected: Annotated[int, Query(alias="generation", ge=1)],
):
    if expected != generation:
        raise HTTPException(409, "Deletion generation does not match")
    member = await membership_for(db, user.id, write=True, active=False)
    await erase_product_data(db, member, generation)
    await db.commit()
    return {"deleted": True, "generation": member.generation}


# All routes are registered under one integration entry point.

router.include_router(attachments_router)
router.include_router(upload_router)
router.include_router(chat_router)
router.include_router(imports_router)
router.include_router(suggestions_router)
