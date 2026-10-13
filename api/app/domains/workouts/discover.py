"""Public Discover: an allow-listed projection of owner-published workouts.

The columns arrive in optional migration 045. Until that version is recorded,
every Discover route answers 503 and private Workouts behave exactly as before,
so this code may be deployed before an operator applies the migration.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from app.auth import ClerkUser
from app.domains.workouts.lifecycle import membership_for, now
from app.domains.workouts.models import WorkoutRecord
from app.domains.workouts.router import (
    Database,
    Generation,
    PublicationResponse,
    User,
    owned_record,
)
from app.domains.workouts.security import WorkoutsRoute
from app.domains.workouts.sharing_service import project_workout
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
            text("""SELECT count(*) FROM pg_constraint WHERE convalidated AND conname IN
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
