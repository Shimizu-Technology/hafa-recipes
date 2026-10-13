"""Public Discover: an allow-listed projection of owner-published workouts.

The columns arrive in optional migration 045. Until that version is recorded,
every Discover route answers 503 and private Workouts behave exactly as before,
so this code may be deployed before an operator applies the migration.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import Field
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    cast,
    func,
    literal_column,
    or_,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from app.auth import ClerkUser
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.models import WorkoutRecord, WorkoutsMembership, WorkoutVersion
from app.domains.workouts.router import (
    Database,
    Generation,
    LibraryRecordResponse,
    Limit,
    Offset,
    PublicationResponse,
    User,
    content_digest,
    library_responses,
    owned_record,
    refresh_library_source,
    validated_workout,
)
from app.domains.workouts.schemas import DomainModel, WorkoutContent
from app.domains.workouts.security import WorkoutsRoute
from app.domains.workouts.sharing_service import project_workout
from app.models.identity import AppUser
from app.models.moderation import AdminAuditEvent, ContentReport, UserBlock
from app.moderation import require_admin
from app.public_identity import public_contributor_id
from app.publishing import require_current_publishing_disclosure
from app.source_urls import canonicalize_source

# Discover columns are deliberately not mapped on WorkoutRecord: ORM reads of
# the private library must keep working on a database without migration 045.
LIBRARY = Table(
    "workouts_library",
    MetaData(),
    Column("id", PGUUID(as_uuid=True), primary_key=True),
    Column("app_user_id", String(64)),
    Column("generation", Integer),
    Column("content", JSONB),
    Column("is_public", Boolean),
    Column("moderation_status", String(16)),
    Column("published_at", DateTime(timezone=True)),
    Column("source_canonical_key", String(300)),
    Column("source_platform", String(24)),
    Column("publisher_display_name", String(100)),
)
DISCOVER_COLUMNS = frozenset(column.name for column in LIBRARY.columns)
UNAVAILABLE = "Workouts Discover is not available yet; your library is unaffected"
NOT_FOUND = "Workout not found"
FALLBACK_NAME = "Håfa member"


async def discover_ready(db) -> bool:
    """Request-local capability probe; never cached across requests or deploys."""
    if "workouts_discover_ready" not in db.info:
        ready = bool(
            await db.scalar(
                text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
            )
        ) and bool(
            await db.scalar(
                text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=45)")
            )
        )
        db.info["workouts_discover_ready"] = ready
    return db.info["workouts_discover_ready"]


async def require_discover(db):
    if not await discover_ready(db):
        raise HTTPException(503, UNAVAILABLE)


async def verify_discover_schema(engine, settings):
    """Startup check: 045 is optional, but once recorded it must be complete."""
    if not settings.workouts_api_enabled:
        return
    async with engine.connect() as connection:
        if not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=45)")
        ):
            return
        columns = set(
            (
                await connection.execute(
                    text("""SELECT column_name FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='workouts_library'""")
                )
            ).scalars()
        )
        constraints = await connection.scalar(
            text("""SELECT count(*) FROM pg_constraint WHERE convalidated
            AND conrelid='public.workouts_library'::regclass AND conname IN
            ('ck_workouts_library_moderation_status','ck_workouts_library_public_published')""")
        )
        if not DISCOVER_COLUMNS <= columns or constraints != 2:
            raise RuntimeError("Workouts Discover migration045 is incomplete")


# --- Public projection -------------------------------------------------------


def public_workout(content):
    """Allow-listed prescription plus creator credit; returns (workout, incomplete).

    Built on the reviewed share-link projection: notes, effort, evidence,
    identifiers and anything personal are dropped. Creator-facing block labels
    and source credit are restored because they are part of the prescription.
    """
    projected, incomplete = project_workout(content, include_source_url=True)
    for block, source in zip(projected["blocks"], content.get("blocks") or []):
        block["label"] = source["label"]
    projected["source_creator"] = content.get("source_creator")
    projected["source_title"] = content.get("source_title")
    return projected, incomplete


def source_identity(url):
    if not url:
        return None, None
    key = canonicalize_source(url).key
    return key, (key.split(":", 1)[0] if key else "web")


# --- Owner publication -------------------------------------------------------


async def publication_states(db, workout_ids):
    """Owner-only overlay for library responses; empty until 045 is applied."""
    if not workout_ids or not await discover_ready(db):
        return {}
    rows = await db.execute(select(LIBRARY).where(LIBRARY.c.id.in_(workout_ids)))
    return {
        row.id: PublicationResponse(
            is_public=row.is_public,
            moderation_status=row.moderation_status,
            published_at=row.published_at,
            discover_visible=row.is_public and row.moderation_status == "active",
        )
        for row in rows
    }


async def set_publication(db, row, user: ClerkUser, publish: bool):
    """Caller holds the owner lock and the membership generation fence."""
    await require_discover(db)
    await db.flush()
    if not publish:
        values = dict(is_public=False, published_at=None, source_canonical_key=None)
    else:
        workout, incomplete = public_workout(row.content)
        if incomplete:
            raise HTTPException(
                422, "Give every exercise reps, time or distance before sharing to Discover"
            )
        await require_current_publishing_disclosure(db, row.app_user_id)
        key, platform = source_identity(workout["source_url"])
        current = (await publication_states(db, [row.id])).get(row.id)
        values = dict(
            is_public=True,
            published_at=(current.published_at if current and current.is_public else None) or now(),
            source_canonical_key=key,
            source_platform=platform,
            publisher_display_name=(user.display_name or FALLBACK_NAME)[:100],
        )
    await db.execute(update(LIBRARY).where(LIBRARY.c.id == row.id).values(**values))
    return (await publication_states(db, [row.id]))[row.id]


async def refresh_publication_after_edit(db, row):
    """Keep source identity current; an edit that breaks completeness unpublishes."""
    states = await publication_states(db, [row.id])
    if not states.get(row.id) or not states[row.id].is_public:
        return
    try:
        workout, incomplete = public_workout(row.content)
    except HTTPException:
        workout, incomplete = None, True
    if incomplete:
        values = dict(is_public=False, published_at=None, source_canonical_key=None)
    else:
        key, platform = source_identity(workout["source_url"])
        values = dict(source_canonical_key=key, source_platform=platform)
    await db.execute(update(LIBRARY).where(LIBRARY.c.id == row.id).values(**values))


# --- Routes ------------------------------------------------------------------

router = APIRouter(prefix="/api/v1/workouts", tags=["workouts"], route_class=WorkoutsRoute)


async def owned_library_row(db, user, workout_id, generation):
    await membership_for(db, user.id, generation=generation, write=True)
    return await owned_record(db, WorkoutRecord, workout_id, user.id, generation)


@router.post("/library/{workout_id}/publish", response_model=PublicationResponse)
async def publish(workout_id: UUID, user: User, db: Database, generation: Generation):
    await require_discover(db)
    row = await owned_library_row(db, user, workout_id, generation)
    state = await set_publication(db, row, user, True)
    await db.commit()
    return state


@router.post("/library/{workout_id}/unpublish", response_model=PublicationResponse)
async def unpublish(workout_id: UUID, user: User, db: Database, generation: Generation):
    await require_discover(db)
    row = await owned_library_row(db, user, workout_id, generation)
    state = await set_publication(db, row, user, False)
    await db.commit()
    return state


# --- Discover feed ---------------------------------------------------------

Text = Annotated[str | None, Query(max_length=100)]
Minutes = Annotated[int | None, Query(ge=1, le=1440)]


class Contributor(DomainModel):
    contributor_id: str | None
    display_name: str


class DiscoverCard(DomainModel):
    id: UUID
    title: str
    kind: str
    estimated_minutes: int | None
    equipment_required: list[str]
    equipment_optional: list[str]
    block_count: int
    exercise_count: int
    source_url: str | None
    source_platform: str | None
    source_creator: str | None
    thumbnail_url: str | None
    published_at: datetime
    contributor: Contributor
    is_owner: bool
    saved_workout_id: UUID | None


class DiscoverDetail(DiscoverCard):
    workout: dict


class DiscoverPage(DomainModel):
    items: list[DiscoverCard]
    total: int
    limit: int
    offset: int
    has_more: bool


def save_key(public_id):
    # One private copy per caller and public workout, via the existing
    # (owner, generation, creation_request_id) uniqueness constraint.
    return uuid5(NAMESPACE_URL, f"hafa-workouts:discover-save:{public_id}")


def card(row, viewer_id, saved, *, detail=False):
    workout, _ = public_workout(row.content)
    values = dict(
        id=row.id,
        title=workout["title"],
        kind=workout["kind"],
        estimated_minutes=workout["estimated_minutes"],
        equipment_required=workout["equipment_required"],
        equipment_optional=workout["equipment_optional"],
        block_count=len(workout["blocks"]),
        exercise_count=sum(len(block["exercises"]) for block in workout["blocks"]),
        source_url=workout["source_url"],
        source_platform=row.source_platform,
        source_creator=workout["source_creator"],
        thumbnail_url=None,
        published_at=row.published_at,
        contributor=Contributor(
            contributor_id=public_contributor_id(row.app_user_id),
            display_name=row.publisher_display_name or FALLBACK_NAME,
        ),
        is_owner=row.app_user_id == viewer_id,
        saved_workout_id=saved.get(save_key(row.id)),
    )
    return DiscoverDetail(**values, workout=workout) if detail else DiscoverCard(**values)


# --- Visibility --------------------------------------------------------------


def visible_conditions(viewer_id):
    owner = LIBRARY.c.app_user_id
    return (
        LIBRARY.c.is_public.is_(True),
        LIBRARY.c.moderation_status == "active",
        select(WorkoutsMembership.app_user_id)
        .where(
            WorkoutsMembership.app_user_id == owner,
            WorkoutsMembership.status == "active",
            WorkoutsMembership.generation == LIBRARY.c.generation,
        )
        .exists(),
        ~select(AppUser.id)
        .where(AppUser.id == owner, AppUser.moderation_status == "hidden")
        .exists(),
        ~select(UserBlock.id)
        .where(UserBlock.blocker_user_id == viewer_id, UserBlock.blocked_user_id == owner)
        .exists(),
    )


async def visible_row(db, workout_id, viewer_id):
    row = (
        await db.execute(
            select(LIBRARY).where(LIBRARY.c.id == workout_id, *visible_conditions(viewer_id))
        )
    ).first()
    if row is None:
        raise HTTPException(404, NOT_FOUND)
    return row


async def saved_copies(db, viewer_id, public_ids):
    keys = [save_key(identifier) for identifier in public_ids]
    if not keys:
        return {}
    rows = await db.execute(
        select(WorkoutRecord.creation_request_id, WorkoutRecord.id).where(
            WorkoutRecord.app_user_id == viewer_id, WorkoutRecord.creation_request_id.in_(keys)
        )
    )
    return dict(rows.all())


@router.get("/discover", response_model=DiscoverPage)
async def discover(
    user: User,
    db: Database,
    q: Text = None,
    equipment: Annotated[str | None, Query(pattern=r"^[A-Za-z0-9 _-]{1,60}$")] = None,
    platform: Annotated[str | None, Query(pattern=r"^[a-z]{2,24}$")] = None,
    min_minutes: Minutes = None,
    max_minutes: Minutes = None,
    limit: Limit = 20,
    offset: Offset = 0,
):
    await require_discover(db)
    content = LIBRARY.c.content
    filters = list(visible_conditions(user.id))
    if q and q.strip():
        names = cast(
            func.jsonb_path_query_array(content, literal_column("'$.blocks[*].exercises[*].name'")),
            String,
        )
        filters.append(
            or_(
                *(
                    field.icontains(q.strip(), autoescape=True)
                    for field in (
                        content["title"].astext,
                        content["source_creator"].astext,
                        names,
                    )
                )
            )
        )
    if equipment:
        required = func.lower(cast(content["equipment_required"], String))
        if equipment.lower() in {"none", "bodyweight"}:
            filters.append(func.jsonb_array_length(content["equipment_required"]) == 0)
        else:
            # Match singular/plural and qualified names: "dumbbells" finds
            # "Dumbbell" and "Adjustable dumbbells".
            term = equipment.strip().lower()
            if len(term) > 3 and term.endswith("s"):
                term = term[:-1]
            filters.append(required.contains(term, autoescape=True))
    if platform:
        filters.append(LIBRARY.c.source_platform == platform)
    minutes = cast(content["estimated_minutes"].astext, Integer)
    if min_minutes is not None:
        filters.append(minutes >= min_minutes)
    if max_minutes is not None:
        filters.append(minutes <= max_minutes)
    # One card per source: the earliest visible publication wins; duplicates
    # stay private-library copies and remain reachable by id.
    ranked = (
        select(
            LIBRARY.c.id,
            func.row_number()
            .over(
                partition_by=func.coalesce(
                    LIBRARY.c.source_canonical_key, cast(LIBRARY.c.id, String)
                ),
                order_by=(LIBRARY.c.published_at.asc(), LIBRARY.c.id.asc()),
            )
            .label("rank"),
        )
        .where(*filters)
        .subquery()
    )
    canonical = select(ranked.c.id).where(ranked.c.rank == 1)
    total = await db.scalar(select(func.count()).select_from(canonical.subquery()))
    rows = (
        await db.execute(
            select(LIBRARY)
            .where(LIBRARY.c.id.in_(canonical))
            .order_by(LIBRARY.c.published_at.desc(), LIBRARY.c.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    saved = await saved_copies(db, user.id, [row.id for row in rows])
    items = []
    for row in rows:
        try:
            items.append(card(row, user.id, saved))
        except HTTPException:
            continue  # Content changed outside the publication checks; never 500 the feed.
    return DiscoverPage(
        items=items, total=total, limit=limit, offset=offset, has_more=offset + len(rows) < total
    )


@router.get("/discover/{workout_id}", response_model=DiscoverDetail)
async def discover_detail(workout_id: UUID, user: User, db: Database):
    await require_discover(db)
    row = await visible_row(db, workout_id, user.id)
    return card(row, user.id, await saved_copies(db, user.id, [row.id]), detail=True)


@router.post("/discover/{workout_id}/save", response_model=LibraryRecordResponse, status_code=201)
async def save_discovered(
    workout_id: UUID, response: Response, user: User, db: Database, generation: Generation
):
    await require_discover(db)
    await membership_for(db, user.id, generation=generation, write=True)
    row = await visible_row(db, workout_id, user.id)
    if row.app_user_id == user.id:
        raise HTTPException(409, "This workout is already in your library")
    key = save_key(row.id)
    existing = await db.scalar(
        select(WorkoutRecord).where(
            WorkoutRecord.app_user_id == user.id,
            WorkoutRecord.generation == generation,
            WorkoutRecord.creation_request_id == key,
        )
    )
    if existing is not None:
        response.status_code = 200
        return (await library_responses(db, [existing]))[0]
    workout, _ = public_workout(row.content)
    content = validated_workout(WorkoutContent.model_validate(workout), authored=False)
    identifier = uuid4()
    content.update(id=str(identifier), version=1, parent_version_id=None)
    record = WorkoutRecord(
        id=identifier,
        app_user_id=user.id,
        generation=generation,
        revision=1,
        content=content,
        creation_request_id=key,
        creation_request_hash=content_digest(content),
    )
    db.add(record)
    await db.flush()
    db.add(
        WorkoutVersion(
            app_user_id=user.id,
            generation=generation,
            workout_id=identifier,
            revision=1,
            content=content,
        )
    )
    await refresh_library_source(db, record)
    await db.flush()
    result = (await library_responses(db, [record]))[0]
    await db.commit()
    return result


ReportCategory = Literal["spam", "unsafe", "inappropriate", "copyright", "impersonation", "other"]


class DiscoverReport(DomainModel):
    category: ReportCategory
    details: str | None = Field(default=None, max_length=900)


@router.post("/discover/{workout_id}/report", status_code=201)
async def report_discovered(workout_id: UUID, request: DiscoverReport, user: User, db: Database):
    """Files a contributor report so the existing admin queue reviews it."""
    from app.routers.community_safety import _ensure_report_capacity

    await require_discover(db)
    row = await visible_row(db, workout_id, user.id)
    if row.app_user_id == user.id:
        raise HTTPException(404, NOT_FOUND)
    prefix = f"Workouts Discover {row.id}"
    existing = await db.scalar(
        select(ContentReport).where(
            ContentReport.reporter_user_id == user.id,
            ContentReport.target_user_id == row.app_user_id,
            ContentReport.category == request.category,
            ContentReport.status.in_(("open", "reviewing")),
            ContentReport.details.startswith(prefix, autoescape=True),
        )
    )
    if existing is None:
        await _ensure_report_capacity(db, user.id)
        details = (request.details or "").strip()
        existing = ContentReport(
            reporter_user_id=user.id,
            target_type="contributor",
            target_user_id=row.app_user_id,
            category=request.category,
            details=f"{prefix}: {details}" if details else prefix,
        )
        db.add(existing)
        await db.commit()
        await db.refresh(existing)
    return {"id": existing.id, "status": existing.status, "created_at": existing.created_at}


@router.post("/discover/{workout_id}/block", status_code=201)
async def block_contributor(workout_id: UUID, user: User, db: Database):
    """Hide every workout and recipe by this contributor from the caller.

    Undo with the shared DELETE /api/blocks/{contributor_id}.
    """
    await require_discover(db)
    row = await visible_row(db, workout_id, user.id)
    if row.app_user_id == user.id:
        raise HTTPException(404, NOT_FOUND)
    await db.execute(
        insert(UserBlock)
        .values(blocker_user_id=user.id, blocked_user_id=row.app_user_id)
        .on_conflict_do_nothing(constraint="uq_user_blocks_pair")
    )
    await db.commit()
    return {
        "contributor_id": public_contributor_id(row.app_user_id),
        "display_name": row.publisher_display_name or FALLBACK_NAME,
    }


# --- Administrator moderation -------------------------------------------------

admin_router = APIRouter(
    prefix="/api/v1/workouts/admin/discover", tags=["admin"], route_class=WorkoutsRoute
)
Admin = Annotated[ClerkUser, Depends(require_admin)]


class AdminDiscoverItem(DomainModel):
    id: UUID
    title: str
    contributor_id: str | None
    display_name: str
    is_public: bool
    moderation_status: str
    published_at: datetime | None


class ModerationUpdate(DomainModel):
    moderation_status: Literal["active", "hidden"]
    reason: str = Field(min_length=3, max_length=500)


def admin_item(row):
    return AdminDiscoverItem(
        id=row.id,
        title=(row.content or {}).get("title") or "Untitled workout",
        contributor_id=public_contributor_id(row.app_user_id),
        display_name=row.publisher_display_name or FALLBACK_NAME,
        is_public=row.is_public,
        moderation_status=row.moderation_status,
        published_at=row.published_at,
    )


@admin_router.get("", response_model=list[AdminDiscoverItem])
async def admin_list(
    admin: Admin,
    db: Database,
    moderation_status: Literal["all", "active", "hidden"] = "all",
    limit: Limit = 20,
    offset: Offset = 0,
):
    del admin
    await require_discover(db)
    query = select(LIBRARY).where(
        or_(LIBRARY.c.is_public.is_(True), LIBRARY.c.moderation_status == "hidden")
    )
    if moderation_status != "all":
        query = query.where(LIBRARY.c.moderation_status == moderation_status)
    rows = await db.execute(
        query.order_by(LIBRARY.c.published_at.desc().nullslast(), LIBRARY.c.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return [admin_item(row) for row in rows]


@admin_router.put("/{workout_id}/moderation", response_model=AdminDiscoverItem)
async def admin_moderate(workout_id: UUID, request: ModerationUpdate, admin: Admin, db: Database):
    await require_discover(db)
    before = await db.scalar(
        select(LIBRARY.c.moderation_status)
        .where(
            LIBRARY.c.id == workout_id,
            # Never surface a private, never-published workout to admins.
            or_(LIBRARY.c.is_public.is_(True), LIBRARY.c.moderation_status == "hidden"),
        )
        .with_for_update()
    )
    if before is None:
        raise HTTPException(404, NOT_FOUND)
    await db.execute(
        update(LIBRARY)
        .where(LIBRARY.c.id == workout_id)
        .values(moderation_status=request.moderation_status)
    )
    db.add(
        AdminAuditEvent(
            actor_user_id=admin.id,
            action="workout_moderation_updated",
            target_type="workout",
            target_id=str(workout_id),
            reason=request.reason.strip(),
            before_summary={"moderation_status": before},
            after_summary={"moderation_status": request.moderation_status},
        )
    )
    row = (await db.execute(select(LIBRARY).where(LIBRARY.c.id == workout_id))).first()
    await db.commit()
    return admin_item(row)
