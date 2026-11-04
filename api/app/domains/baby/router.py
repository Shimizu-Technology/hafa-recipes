"""Owner-scoped records and product lifecycle. No AI write bypass exists."""

from copy import deepcopy
from dataclasses import replace
from datetime import date, datetime
from typing import Annotated, Literal, get_args
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import AwareDatetime, ValidationError
from sqlalchemy import func, or_, select

from app.domains.baby.access import access_for, family_enabled, touch
from app.domains.baby.attachments import retire_unreferenced_attachments, upload_router
from app.domains.baby.attachments import router as attachments_router
from app.domains.baby.chat import router as chat_router
from app.domains.baby.dependencies import Access, Client, Database, Generation, Limit, Offset, User
from app.domains.baby.events import check_series_cap, day_marks
from app.domains.baby.events import router as events_router
from app.domains.baby.feeds import retimed, same_action
from app.domains.baby.imports import router as imports_router
from app.domains.baby.lifecycle import (
    digest,
    erase_product_data,
    lock_owner,
    membership_for,
    now,
    owned,
    settle_running_feeds,
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
from app.domains.baby.queries import (
    LATEST_PREGNANCY_DAYS,
    child_timing,
    legacy_client,
    records_query,
    stage_filter,
    timing_bounds,
    timing_filter,
)
from app.domains.baby.schemas import (
    NEW_KINDS,
    V1_KINDS,
    ChildCreate,
    ChildPatch,
    CollectionData,
    EventData,
    FeedActionRequest,
    Kind,
    Profile,
    ProfilePatch,
    RecordCreate,
    RecordPatch,
    SessionActionRequest,
    SourceRelevance,
    Stage,
)
from app.domains.baby.security import BabyRoute, new_kinds_enabled
from app.domains.baby.sessions import SESSION_KINDS
from app.domains.baby.stats import MAX_CUSTOM_DAYS, care_summary, number_in
from app.domains.baby.suggestions import router as suggestions_router

router = APIRouter(prefix="/api/v1/baby", tags=["baby"], route_class=BabyRoute)
KindsFilter = Annotated[list[Kind] | None, Query(max_length=len(get_args(Kind)))]


def child_response(row, access=None):
    result = {
        "id": str(row.id),
        "name": row.name,
        "birth_date": row.birth_date,
        "due_date": row.due_date,
        "revision": row.revision,
    }
    if getattr(access, "enabled", False) and access.client == "3":
        result.update(space_id=str(row.space_id), generation=row.generation)
    return result


def record_response(row, access=None):
    result = {
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
    if getattr(access, "enabled", False) and access.client == "3":
        result.update(space_id=str(row.space_id), generation=row.generation)
    return result


# Clients that predate these fields omit them; only an explicit null clears one.
SOURCE_ADDITIONS = ("relevance", "suggested_category")
PATCH_ADDITIONS = {"diaper": ("color",), "journal": ("event_id",), "question": ("event_id",)}


def reconciled_event(data, start):
    """An edited series' data without the changes to dates it no longer has; bad data is left to be refused."""
    try:
        return EventData.model_validate(data).without_orphans(start).model_dump(mode="json")
    except ValidationError:
        return data


def kept_additions(current, patch, keys):
    data = dict(patch)
    for key in keys:
        if key not in data and key in current:
            data[key] = deepcopy(current[key])
    return data


def corrected_by_hand(current, patch):
    if "side" in patch and patch["side"] != current.get("side"):
        return True
    if "duration_minutes" not in patch:
        return False
    return number_in(patch["duration_minutes"]) != number_in(current.get("duration_minutes"))


def feed_patch_data(current, patch):
    """Actions only change through feed-action, and their results follow from them.

    Changing a side or duration by hand is the exception: the parent knows better than the
    taps, so the feed becomes a plain finished entry that a late tap cannot overwrite.
    """
    data = kept_additions(current, patch, ("state", "end_at", "contents"))
    data.pop("actions", None)
    if not current.get("actions"):
        return data
    if corrected_by_hand(current, patch):
        return {**data, "state": "finished"}
    return {
        **data,
        "actions": deepcopy(current["actions"]),
        "side": current.get("side"),
        "duration_minutes": current.get("duration_minutes"),
    }


def session_patch_data(current, patch):
    """Taps and stops only change through session-action, and their results follow from them."""
    data = {key: value for key, value in patch.items() if key != "session_actions"}
    if not current.get("session_actions"):
        return data
    kept = ("session_actions", "count", "end_at")
    return {**data, **{key: deepcopy(current[key]) for key in kept if key in current}}


def visible_to(row, client):
    if legacy_client(client) and row.kind not in V1_KINDS:
        raise HTTPException(404, "Item unavailable")
    return row


def no_event_link_from_legacy(client, data):
    if legacy_client(client) and (data or {}).get("event_id") is not None:
        raise HTTPException(422, "Update Håfa Baby to save this")


def can_create(kind, client):
    if kind not in NEW_KINDS:
        return
    if legacy_client(client):
        raise HTTPException(422, "Update Håfa Baby to save this")
    if not new_kinds_enabled():
        # Retryable, so a client that shipped first keeps its entry queued.
        raise HTTPException(503, "This can't be saved yet; it will try again")


def user_timing(relevance):
    """Timing the parent set. Only extraction writes "source" timing with a quote."""
    return {**relevance, "origin": "user", "quote": None}


def source_patch_data(current, patch):
    data = kept_additions(current, patch, SOURCE_ADDITIONS)
    stored, relevance = current.get("relevance"), data.get("relevance")
    if relevance is None and stored:
        # Clearing is a decision too: an empty user marker keeps reprocessing
        # from restoring the extracted timing. Timing filters never match it.
        data["relevance"] = user_timing({})
    elif isinstance(relevance, dict):
        data["relevance"] = (
            deepcopy(stored) if same_timing(relevance, stored) else user_timing(relevance)
        )
    return data


def same_timing(proposed, current):
    try:
        return timing_values(proposed) == timing_values(current or {})
    except ValidationError:
        return False


def timing_values(relevance):
    return SourceRelevance.model_validate(relevance).model_dump(exclude={"origin", "quote"})


def occurred_between(occurred_from, occurred_to):
    """Half-open, so consecutive days never share an entry. ``ix_baby_records_owner`` covers it."""
    if occurred_from is not None and occurred_to is not None and occurred_from >= occurred_to:
        raise HTTPException(422, "Choose a start before the end")
    conditions = []
    if occurred_from is not None:
        conditions.append(BabyRecord.occurred_at >= occurred_from)
    if occurred_to is not None:
        conditions.append(BabyRecord.occurred_at < occurred_to)
    return conditions


def revision_matches(row, revision):
    if row.revision != revision:
        raise HTTPException(409, "This item changed on another device; reload before saving")


@router.get("/bootstrap")
async def bootstrap(user: User, db: Database, request: Request):
    return await bootstrap_state(user, db, create=False, request=request)


@router.post("/bootstrap")
async def initialize(user: User, db: Database, request: Request):
    return await bootstrap_state(user, db, create=True, request=request)


async def bootstrap_state(user, db, *, create, request):
    access = None
    member = await db.get(BabyMembership, user.id, populate_existing=True)
    if family_enabled() and member is not None:
        access = await access_for(db, user.id, client=request.headers.get("X-Baby-Client"),
                                  write=create, bootstrap=True, active=False)
        member = access.member
    elif create:
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
    if create:
        # GET stays read-only. Every creation site provisions through its write path.
        from app.domains.baby.spaces import ensure_personal_space

        await ensure_personal_space(db, member)
    if family_enabled() and access is None:
        access = await access_for(db, user.id, client=request.headers.get("X-Baby-Client"),
                                  write=create, bootstrap=True, active=False)
    from app.domains.baby.provider import BabyProvider

    children = (
        await db.scalars(
            select(BabyChild)
            .where(
                access.condition(BabyChild) if access else (
                    (BabyChild.app_user_id == user.id) & (BabyChild.generation == member.generation)
                ),
                BabyChild.deleted_at.is_(None),
            )
            .order_by(BabyChild.name)
        )
        if member.status == "active"
        else []
    )
    result = {
        "profile": Profile.model_validate(member.profile).model_dump(),
        "children": [child_response(row, access) for row in children],
        "generation": member.generation,
        "active": member.status == "active",
        "ai_available": BabyProvider().enabled,
    }
    if access and access.client == "3":
        result.update(personal_space_id=str(member.personal_space_id), spaces=[{
            "id": str(g.id), "kind": g.space.kind, "role": g.role,
            "generation": g.generation, "access_version": g.access_version,
        } for g in access.spaces if g.space.status == "active"])
    if create and access:
        personal = next(g for g in access.spaces if g.id == member.personal_space_id)
        await touch(personal.space, personal)
    await db.commit()
    return result


@router.post("/enroll")
async def enroll(user: User, db: Database, generation: Generation, request: Request):
    access = await access_for(db, user.id, client=request.headers.get("X-Baby-Client"),
                              space_id=request.headers.get("X-Baby-Space"),
                              generation=generation, write=True, active=False)
    member = access.member
    if member.status == "deleted":
        member.status = "active"
        member.profile = Profile().model_dump()
        member.updated_at = now()
    from app.domains.baby.spaces import ensure_personal_space

    await ensure_personal_space(db, member)
    if access.enabled:
        personal = next(g for g in access.spaces if g.id == member.personal_space_id)
        await touch(personal.space, personal)
    await db.commit()
    return {"generation": member.generation, "active": True}


@router.patch("/profile")
async def patch_profile(body: ProfilePatch, user: User, db: Database, generation: Generation,
                        access: Access = None):
    access.check_generation(generation)
    member = access.member
    job_access = replace(access, spaces=access.member_spaces) if access.enabled else access
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
                    job_access.condition(BabyImport),
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
                await touch(job, job_access.grant(job) if access.enabled else None)
                source = await db.get(BabyRecord, job.record_id)
                if (
                    source
                    and ((source.space_id == job.space_id and source.generation == job.generation)
                         if access.enabled else (source.app_user_id == user.id and source.generation == generation))
                    and source.deleted_at is None
                ):
                    source.data = {**source.data, "status": "cancelled"}
                    source.revision, source.updated_at = source.revision + 1, now()
                    await touch(source, job_access.grant(source) if access.enabled else None)
    member.profile, member.updated_at = profile.model_dump(), now()
    if not profile.auto_process_shares:
        from app.domains.baby.share_models import BabyShareCapture
        from app.domains.baby.share_router import share_schema_available

        if await share_schema_available(db):
            deferred = await db.scalars(
                select(BabyShareCapture).where(
                    BabyShareCapture.app_user_id == user.id,
                    job_access.condition(BabyShareCapture),
                    BabyShareCapture.status == "deferred",
                )
            )
            for receipt in deferred:
                receipt.status = "saved"
                await touch(receipt, job_access.grant(receipt) if access.enabled else None)
        # Turning off automatic processing does not revoke a deliberately
        # requested manual import. Fence only automatic jobs, including leases.
        automatic_jobs = await db.scalars(
            select(BabyImport).where(
                BabyImport.app_user_id == user.id,
                job_access.condition(BabyImport),
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
            await touch(job, job_access.grant(job) if access.enabled else None)
            source = await db.get(BabyRecord, job.record_id)
            if (
                source
                and ((source.space_id == job.space_id and source.generation == job.generation)
                     if access.enabled else (source.app_user_id == user.id and source.generation == generation))
                and source.deleted_at is None
            ):
                source.data = {**source.data, "status": "cancelled"}
                source.revision, source.updated_at = source.revision + 1, now()
                await touch(source, job_access.grant(source) if access.enabled else None)
    if access.enabled:
        personal = next(g for g in access.member_spaces if g.id == member.personal_space_id)
        await touch(personal.space, personal)
    await db.commit()
    return member.profile


@router.get("/children")
async def children(user: User, db: Database, access: Access = None):
    rows = await db.scalars(
        select(BabyChild)
        .where(
            access.condition(BabyChild),
            BabyChild.deleted_at.is_(None),
        )
        .order_by(BabyChild.name)
    )
    return {"items": [child_response(row, access) for row in rows]}


@router.post("/children")
async def create_child(body: ChildCreate, user: User, db: Database, generation: Generation,
                       access: Access = None):
    member = access.member
    fingerprint = digest(body.model_dump(mode="json"))
    if not access.enabled:
        access.check_generation(generation)
    if access.enabled and access.target.role != "parent":
        raise HTTPException(403, "Only a parent can create a child profile")
    prior = await db.get(BabyChild, body.id)
    if prior:
        if access.enabled:
            access.grant(prior)
        if (
            (not access.enabled and (prior.app_user_id != user.id or prior.generation != generation))
            or prior.creation_hash != fingerprint
        ):
            raise HTTPException(409, "This save identity was already used")
        if prior.deleted_at:
            raise HTTPException(410, "This child profile was removed; create a new profile")
        return child_response(prior, access)
    access.check_generation(generation)
    count = await db.scalar(
        select(func.count())
        .select_from(BabyChild)
        .where(
            access.condition(BabyChild),
            (BabyChild.space_id == access.target.id) if access.enabled else True,
            BabyChild.deleted_at.is_(None),
        )
    )
    if count >= 30:
        raise HTTPException(422, "Child profile limit reached")
    row = BabyChild(
        **body.model_dump(),
        app_user_id=user.id,
        space_id=access.target.id if access.enabled else member.personal_space_id,
        generation=generation,
        revision=1,
        creation_hash=fingerprint,
    )
    db.add(row)
    await touch(row, access.target)
    await db.commit()
    return child_response(row, access)


@router.patch("/children/{identifier}")
async def patch_child(
    identifier: UUID, body: ChildPatch, user: User, db: Database, generation: Generation,
    access: Access = None,
):
    access.check_generation(generation)
    if access.enabled and access.target.role != "parent":
        raise HTTPException(403, "Only a parent can edit a child profile")
    row = await owned(db, BabyChild, access, generation, identifier)
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
    await touch(row, access.target)
    await db.commit()
    return child_response(row, access)


@router.delete("/children/{identifier}", status_code=204)
async def delete_child(
    identifier: UUID,
    user: User,
    db: Database,
    generation: Generation,
    revision: Annotated[int, Query(ge=1)],
    access: Access = None,
):
    access.check_generation(generation)
    row = await owned(db, BabyChild, access, generation, identifier)
    revision_matches(row, revision)
    if access.enabled and access.target.role != "parent":
        raise HTTPException(403, "Only a parent can delete a child profile")
    for model in (BabyRecord, BabyConversation):
        for item in await db.scalars(
            select(model).where(
                access.condition(model),
                ((model.space_id == row.space_id) if model is BabyRecord else (model.app_user_id == user.id))
                if access.enabled else True,
                model.child_id == identifier,
            )
        ):
            item.child_id, item.updated_at = None, now()
            if model is BabyRecord:
                item.revision += 1
            await touch(item, access.grant(item) if access.enabled else None)
    # Pending imports and open conversations cannot reattach a deleted child.
    for job in await db.scalars(
        select(BabyImport).where(
            access.condition(BabyImport),
            (BabyImport.space_id == row.space_id) if access.enabled else True,
        )
    ):
        if job.request.get("child_id") == str(identifier):
            job.request = {**job.request, "child_id": None}
            await touch(job, access.grant(job) if access.enabled else None)
    row.deleted_at, row.name, row.birth_date, row.due_date = now(), "", None, None
    row.revision += 1
    await touch(row, access.target)
    await settle_running_feeds(db, access, generation, None)
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
    client=None,
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
    if legacy_client(client):
        query = query.where(BabyRecord.kind.in_(V1_KINDS))
    for condition in conditions:
        query = query.where(condition)
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = await db.scalars(
        query.order_by(*(order or ()), BabyRecord.occurred_at.desc(), BabyRecord.id)
        .limit(limit)
        .offset(offset)
    )
    return {
        "items": [record_response(row, owner) for row in rows],
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
    today = datetime.now(ZoneInfo(Profile.model_validate(member.profile).timezone)).date()

    def born(child):
        return child.birth_date is not None and child.birth_date <= today

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
        # The ongoing pregnancy is what "now" means beside older siblings.
        expecting = [
            item
            for item in children
            if not born(item)
            and item.due_date is not None
            and 280 - (item.due_date - today).days <= LATEST_PREGNANCY_DAYS
        ]
        if len(expecting) == 1:
            children = expecting
        if len(children) > 1:
            raise HTTPException(422, "Choose which child to show timing for")
        child = children[0] if children else None
    if child is None or not (child.birth_date or child.due_date):
        raise HTTPException(422, "Add a due date or birth date to see what is relevant now")
    timing = child_timing(child, today)
    if timing is None:
        raise HTTPException(
            422,
            "Add a due date to see what is relevant now"
            if child.due_date is None
            else "Add the birth date to see what is relevant now",
        )
    return {"child_id": str(child.id), "basis": "child", "today": today.isoformat(), **timing}


@router.get("/records")
async def records(
    user: User,
    db: Database,
    client: Client = None,
    kind: Kind | None = None,
    kinds: KindsFilter = None,
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
    occurred_from: AwareDatetime | None = None,
    occurred_to: AwareDatetime | None = None,
    limit: Limit = 30,
    offset: Offset = 0,
    access: Access = None,
):
    member = access.member
    conditions, order, extra = occurred_between(occurred_from, occurred_to), None, None
    if stage is not None:
        conditions.append(stage_filter(stage))
    if timing == "now" and within_weeks is not None:
        raise HTTPException(422, "within_weeks works with timing=upcoming")
    if timing is not None:
        context = await timing_context(
            db, user.id, member, timing_child_id, pregnancy_week, baby_age_weeks
        )
        value = context.get("pregnancy_week", context.get("baby_age_weeks"))
        conditions.append(timing_filter(timing, context["stage"], value, within_weeks=within_weeks))
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
        access,
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
        client=client,
    )


@router.get("/search")
async def search(
    user: User,
    db: Database,
    q: Annotated[str, Query(min_length=1, max_length=300)],
    client: Client = None,
    kind: Kind | None = None,
    kinds: KindsFilter = None,
    child_id: UUID | None = None,
    include_general: bool = False,
    collection_id: UUID | None = None,
    uncategorized: bool = False,
    topic: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    occurred_from: AwareDatetime | None = None,
    occurred_to: AwareDatetime | None = None,
    limit: Limit = 30,
    offset: Offset = 0,
    access: Access = None,
):
    member = access.member
    conditions = occurred_between(occurred_from, occurred_to)
    return await record_list(
        db,
        access,
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
        client=client,
    )


@router.get("/care/summary")
async def care_days(
    user: User,
    db: Database,
    first: Annotated[date, Query(alias="from")],
    last: Annotated[date, Query(alias="to")],
    child_id: UUID | None = None,
    client: Client = None,
    access: Access = None,
):
    """Tracker's days and calendar dots. Without a child, the logs that have no child."""
    member = access.member
    if child_id:
        await owned(db, BabyChild, access, member.generation, child_id)
    zone = ZoneInfo(Profile.model_validate(member.profile).timezone)
    # Build 32 knows no events, contractions or kicks, so it gets no dots for them.
    marks = None
    if not legacy_client(client) and first <= last and (last - first).days < MAX_CUSTOM_DAYS:
        marks = await day_marks(db, access, member.generation, child_id, zone, first, last)
    try:
        return await care_summary(db, access, member.generation, child_id, zone, first, last, now(), marks)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None


@router.get("/records/{identifier}")
async def get_record(
    identifier: UUID, user: User, db: Database, client: Client = None, access: Access = None
):
    member = access.member
    row = await owned(db, BabyRecord, access, member.generation, identifier)
    return record_response(visible_to(row, client), access)


@router.post("/records")
async def create_record(
    body: RecordCreate,
    user: User,
    db: Database,
    generation: Generation,
    client: Client = None,
    access: Access = None,
):
    can_create(body.kind, client)
    no_event_link_from_legacy(client, body.data)
    member = access.member
    if body.kind == "source" and body.data.get("relevance") is not None:
        body.data["relevance"] = user_timing(body.data["relevance"])
    fingerprint = digest(body.model_dump(mode="json"))
    if not access.enabled:
        access.check_generation(generation)
    prior = await db.get(BabyRecord, body.id)
    if prior:
        if access.enabled:
            access.grant(prior)
        if (
            not access.enabled and (prior.app_user_id != user.id or prior.generation != generation)
        ) or prior.creation_hash != fingerprint:
            raise HTTPException(409, "This save identity was already used with different content")
        if prior.deleted_at:
            raise HTTPException(410, "This entry was removed; create a new entry")
        return record_response(prior, access)
    access.check_generation(generation)
    await validate_relations(db, access, generation, body.child_id, body.data, record_id=body.id)
    if body.kind == "event":
        await check_series_cap(db, access, generation, body.data, record_id=body.id)
    row = BabyRecord(
        **body.model_dump(),
        app_user_id=user.id,
        space_id=access.target.id if access.enabled else member.personal_space_id,
        generation=generation,
        revision=1,
        creation_hash=fingerprint,
        created_at=now(),
        updated_at=now(),
    )
    db.add(row)
    await touch(row, access.target)
    if row.kind == "feeding":
        await settle_running_feeds(db, access, generation, row.child_id, changed=row.id)
    await db.commit()
    return record_response(row, access)


@router.patch("/records/{identifier}")
async def patch_record(
    identifier: UUID,
    body: RecordPatch,
    user: User,
    db: Database,
    generation: Generation,
    client: Client = None,
    access: Access = None,
):
    access.check_generation(generation)
    row = visible_to(await owned(db, BabyRecord, access, generation, identifier), client)
    revision_matches(row, body.revision)
    no_event_link_from_legacy(client, body.data)
    values = {key: deepcopy(getattr(row, key)) for key in RecordCreate.model_fields}
    values.update(body.model_dump(exclude_unset=True, exclude={"revision"}))
    if row.kind == "source" and isinstance(body.data, dict):
        values["data"] = source_patch_data(row.data, body.data)
    elif row.kind in PATCH_ADDITIONS and isinstance(body.data, dict):
        values["data"] = kept_additions(row.data, body.data, PATCH_ADDITIONS[row.kind])
    elif row.kind == "feeding" and isinstance(body.data, dict):
        values["data"] = feed_patch_data(row.data, body.data)
    elif row.kind in SESSION_KINDS and isinstance(body.data, dict):
        values["data"] = session_patch_data(row.data, body.data)
    if (
        row.kind == "feeding"
        and body.occurred_at
        and isinstance(values["data"], dict)
        and values["data"].get("actions")
    ):
        values["data"] = {
            **values["data"],
            "actions": retimed(values["data"]["actions"], body.occurred_at.isoformat()),
        }
    if row.kind == "event":
        values["data"] = reconciled_event(values["data"], values["occurred_at"])
    try:
        valid = RecordCreate.model_validate(values)
    except ValidationError:
        raise HTTPException(422, "Enter valid details for this entry") from None
    if row.kind == "event":
        await check_series_cap(db, access, generation, valid.data, record_id=row.id)
    await validate_relations(db, access, generation, valid.child_id, valid.data, record_id=row.id)
    removed_attachments = set(row.data.get("attachment_ids", [])) - set(
        valid.data.get("attachment_ids", [])
    )
    previous_child = row.child_id
    for key in ("title", "body", "child_id", "occurred_at", "data"):
        setattr(row, key, getattr(valid, key))
    row.revision, row.updated_at = row.revision + 1, now()
    await touch(row, access.target)
    if removed_attachments:
        await retire_unreferenced_attachments(db, user.id, generation, removed_attachments)
    if row.kind == "feeding":
        for child_id in {previous_child, row.child_id}:
            await settle_running_feeds(db, access, generation, child_id, changed=row.id)
    await db.commit()
    return record_response(row, access)


@router.post("/records/{identifier}/feed-action")
async def feed_action(
    identifier: UUID,
    body: FeedActionRequest,
    user: User,
    db: Database,
    generation: Generation,
    access: Access = None,
):
    """A running feed's tap. Idempotent by its ID, and needs no revision: taps never conflict."""
    access.check_generation(generation)
    row = await owned(db, BabyRecord, access, generation, identifier)
    stored = row.data.get("actions", [])
    if (
        row.kind != "feeding"
        or row.data.get("method") != "breast"
        or not (stored or row.data.get("state") in {"running", "unknown_end"})
    ):
        raise HTTPException(409, "This feed isn't being timed")
    action = body.model_dump(mode="json")
    prior = next((item for item in stored if item["id"] == action["id"]), None)
    if prior:
        if not same_action(prior, action):
            raise HTTPException(409, "This save identity was already used with different content")
        return record_response(row, access)
    values = {key: deepcopy(getattr(row, key)) for key in RecordCreate.model_fields}
    values["data"]["actions"] = [*stored, {**action, "revision": row.revision + 1}]
    try:
        valid = RecordCreate.model_validate(values)
    except ValidationError:
        raise HTTPException(422, "Enter valid details for this entry") from None
    row.data, row.occurred_at = valid.data, valid.occurred_at
    row.revision, row.updated_at = row.revision + 1, now()
    await touch(row, access.target)
    await settle_running_feeds(db, access, generation, row.child_id, changed=row.id)
    await db.commit()
    return record_response(row, access)


@router.post("/records/{identifier}/session-action")
async def session_action(
    identifier: UUID,
    body: SessionActionRequest,
    user: User,
    db: Database,
    generation: Generation,
    client: Client = None,
    access: Access = None,
):
    """A kick session's tap or a contraction's stop. Idempotent by its ID, and needs no revision."""
    access.check_generation(generation)
    row = visible_to(await owned(db, BabyRecord, access, generation, identifier), client)
    stored = row.data.get("session_actions", [])
    # A count from before taps had identities has nothing an action could add to.
    if row.kind not in SESSION_KINDS or (row.data.get("count") and not stored):
        raise HTTPException(409, "This entry isn't being timed")
    action = body.model_dump(mode="json")
    prior = next((item for item in stored if item["id"] == action["id"]), None)
    if prior:
        if not same_action(prior, action):
            raise HTTPException(409, "This save identity was already used with different content")
        return record_response(row, access)
    values = {key: deepcopy(getattr(row, key)) for key in RecordCreate.model_fields}
    values["data"]["session_actions"] = [*stored, {**action, "revision": row.revision + 1}]
    try:
        valid = RecordCreate.model_validate(values)
    except ValidationError:
        raise HTTPException(422, "Enter valid details for this entry") from None
    row.data = valid.data
    row.revision, row.updated_at = row.revision + 1, now()
    await touch(row, access.target)
    await db.commit()
    return record_response(row, access)


@router.delete("/records/{identifier}", status_code=204)
async def delete_record(
    identifier: UUID,
    user: User,
    db: Database,
    generation: Generation,
    revision: Annotated[int, Query(ge=1)],
    client: Client = None,
    access: Access = None,
):
    access.check_generation(generation)
    row = visible_to(await owned(db, BabyRecord, access, generation, identifier), client)
    revision_matches(row, revision)
    # Cancel processing before deleting the source, so completion cannot recreate it.
    for job in await db.scalars(
        select(BabyImport).where(
            access.condition(BabyImport),
            BabyImport.record_id == identifier,
        )
    ):
        job.status, job.lease_token, job.lease_until = "cancelled", None, None
        await touch(job, access.grant(job) if access.enabled else None)
    for collection in await db.scalars(
        select(BabyRecord).where(
            access.condition(BabyRecord),
            (BabyRecord.space_id == row.space_id) if access.enabled else True,
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
            await touch(collection, access.grant(collection) if access.enabled else None)
    if row.kind == "event":
        # A question or note about a visit stays; only its link to the removed event goes.
        for linked in await db.scalars(
            select(BabyRecord).where(
                (BabyRecord.space_id == row.space_id) if access.enabled else (
                    (BabyRecord.app_user_id == user.id) & (BabyRecord.generation == generation)
                ),
                BabyRecord.deleted_at.is_(None),
                BabyRecord.data["event_id"].as_string() == str(identifier),
            )
        ):
            linked.data = {key: value for key, value in linked.data.items() if key != "event_id"}
            linked.revision, linked.updated_at = linked.revision + 1, now()
            await touch(linked, access.grant(linked, kinds=False) if access.enabled else None)
    removed_attachments = row.data.get("attachment_ids", [])
    child_id = row.child_id
    row.deleted_at, row.title, row.body, row.data, row.child_id = now(), "", "", {}, None
    row.revision, row.updated_at = row.revision + 1, now()
    await touch(row, access.target)
    if removed_attachments:
        await retire_unreferenced_attachments(db, user.id, generation, removed_attachments)
    if row.kind == "feeding":
        await settle_running_feeds(db, access, generation, child_id)
    await db.commit()
    return Response(status_code=204)


@router.get("/export")
async def export(user: User, db: Database, client: Client = None):
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
            record_response(row)
            for row in await rows(BabyRecord)
            if row.deleted_at is None and not (legacy_client(client) and row.kind not in V1_KINDS)
        ],
        "attachments": [
            metadata(row) for row in await rows(BabyAttachment) if row.state == "ready"
        ],
        "conversations": [conversation_response(row) for row in await rows(BabyConversation)],
        "messages": [
            message_response(row, legacy=legacy_client(client)) for row in await rows(BabyMessage)
        ],
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
router.include_router(events_router)
