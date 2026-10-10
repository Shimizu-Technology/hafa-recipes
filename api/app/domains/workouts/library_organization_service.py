"""Owner-scoped organization, source hints, and optional-domain integration hooks."""

import hashlib
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, exists, select, text

from app.domains.workouts.library_organization_models import (
    ORGANIZATION_TABLES,
    WorkoutLibraryCollection,
    WorkoutLibraryCollectionMember,
    WorkoutLibraryDuplicateReceipt,
    WorkoutLibraryOrganization,
)
from app.domains.workouts.models import WorkoutRecord
from app.domains.workouts.router import record_response
from app.source_urls import canonicalize_source


def source_key(url):
    """Content-free key; canonicalization performs no fetching."""
    if not url:
        return None
    try:
        key = canonicalize_source(url).key
    except (ValueError, TypeError):
        return None
    return hashlib.sha256(("workouts-source:v1:" + key).encode()).hexdigest() if key else None


def active_library_condition():
    """Attach to existing owner-scoped library SELECT; never substitutes ownership."""
    return ~exists().where(
        WorkoutLibraryOrganization.workout_id == WorkoutRecord.id,
        WorkoutLibraryOrganization.app_user_id == WorkoutRecord.app_user_id,
        WorkoutLibraryOrganization.generation == WorkoutRecord.generation,
        WorkoutLibraryOrganization.archived.is_(True),
    )


async def owned_workout(db, owner, generation, workout_id):
    row = await db.scalar(
        select(WorkoutRecord).where(
            WorkoutRecord.id == workout_id,
            WorkoutRecord.app_user_id == owner,
            WorkoutRecord.generation == generation,
        )
    )
    if row is None:
        raise HTTPException(404, "Workout not found")
    return row


async def organization_for(db, row):
    return await db.scalar(
        select(WorkoutLibraryOrganization).where(
            WorkoutLibraryOrganization.workout_id == row.id,
            WorkoutLibraryOrganization.app_user_id == row.app_user_id,
            WorkoutLibraryOrganization.generation == row.generation,
        )
    )


async def refresh_source_metadata(db, row):
    """Call from each owner-locked save/edit/import/copy transaction, before commit.

    Index maintenance is independent of user-visible organization revision.
    """
    await db.flush()
    organization = await organization_for(db, row)
    if organization is None:
        organization = WorkoutLibraryOrganization(
            workout_id=row.id,
            app_user_id=row.app_user_id,
            generation=row.generation,
            revision=1,
            favorite=False,
            archived=False,
            tags=[],
            tag_keys=[],
        )
        db.add(organization)
    organization.source_key = source_key(row.content.get("source_url"))
    return organization


async def refresh_optional_source_metadata(db, row):
    """Keep migration034-only compatibility for existing private-data fixtures."""
    if await db.scalar(
        text("SELECT to_regclass('public.workouts_library_organization') IS NOT NULL")
    ):
        await refresh_source_metadata(db, row)


async def overlay_organizations(db, rows):
    """Batch overlay for parent list/detail handlers; returns JSON-safe envelopes."""
    if not rows:
        return []
    owner, generation = rows[0].app_user_id, rows[0].generation
    if any(row.app_user_id != owner or row.generation != generation for row in rows):
        raise ValueError("Organization overlay requires a single owner and generation")
    ids = [row.id for row in rows]
    metadata = (
        await db.scalars(
            select(WorkoutLibraryOrganization).where(
                WorkoutLibraryOrganization.workout_id.in_(ids),
                WorkoutLibraryOrganization.app_user_id == owner,
                WorkoutLibraryOrganization.generation == generation,
            )
        )
    ).all()
    by_id = {item.workout_id: item for item in metadata}
    links = (
        await db.execute(
            select(
                WorkoutLibraryCollectionMember.workout_id,
                WorkoutLibraryCollectionMember.collection_id,
            ).where(
                WorkoutLibraryCollectionMember.workout_id.in_(ids),
                WorkoutLibraryCollectionMember.app_user_id == owner,
                WorkoutLibraryCollectionMember.generation == generation,
            )
        )
    ).all()
    memberships = {}
    for workout_id, collection_id in links:
        memberships.setdefault(workout_id, []).append(str(collection_id))
    result = []
    for row in rows:
        item = by_id.get(row.id)
        result.append(
            {
                **record_response(row).model_dump(mode="json"),
                "organization": {
                    "revision": item.revision if item else 0,
                    "favorite": item.favorite if item else False,
                    "archived": item.archived if item else False,
                    "tags": item.tags if item else [],
                    "collection_ids": sorted(memberships.get(row.id, [])),
                    "duplicate_of_workout_id": str(item.duplicate_of_workout_id)
                    if item and item.duplicate_of_workout_id
                    else None,
                    "duplicate_of_revision": item.duplicate_of_revision if item else None,
                },
            }
        )
    return result


async def erase_library_organization(db, owner):
    """Parent invokes inside the shared owner-locked product erasure transaction."""
    for model in (
        WorkoutLibraryDuplicateReceipt,
        WorkoutLibraryCollectionMember,
        WorkoutLibraryOrganization,
        WorkoutLibraryCollection,
    ):
        await db.execute(delete(model).where(model.app_user_id == owner))


async def organization_export_page(db, owner, generation, *, limit=50, offset=0):
    """Bounded export of metadata; source hashes and replay hashes stay internal."""
    if not 1 <= limit <= 50 or not 0 <= offset <= 1_000_000:
        raise ValueError("Invalid export page")
    result = {}
    for model, name, columns in (
        (
            WorkoutLibraryOrganization,
            "library_organization",
            [
                "workout_id",
                "revision",
                "favorite",
                "archived",
                "tags",
                "duplicate_of_workout_id",
                "duplicate_of_revision",
            ],
        ),
        (
            WorkoutLibraryCollection,
            "library_collections",
            ["id", "title", "revision", "created_at", "updated_at"],
        ),
        (
            WorkoutLibraryCollectionMember,
            "library_collection_members",
            ["collection_id", "workout_id"],
        ),
        (
            WorkoutLibraryDuplicateReceipt,
            "library_duplicate_receipts",
            ["id", "source_workout_id", "source_revision", "destination_workout_id", "created_at"],
        ),
    ):
        rows = (
            await db.scalars(
                select(model)
                .where(model.app_user_id == owner, model.generation == generation)
                .order_by(*model.__table__.primary_key.columns)
                .limit(limit + 1)
                .offset(offset)
            )
        ).all()
        result[name] = {
            "items": [
                {
                    column: str(value) if isinstance(value := getattr(row, column), UUID) else value
                    for column in columns
                }
                for row in rows[:limit]
            ],
            "has_more": len(rows) > limit,
        }
    return result


async def verify_organization_schema(engine, settings):
    if not settings.workouts_api_enabled:
        return
    from sqlalchemy import text

    async with engine.connect() as connection:
        installed = await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        )
        if not installed or not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=38)")
        ):
            raise RuntimeError("Workouts library organization migration038 is required")
        for table in ORGANIZATION_TABLES:
            if not await connection.scalar(
                text("SELECT to_regclass(:table) IS NOT NULL"), {"table": "public." + table.name}
            ):
                raise RuntimeError(f"Missing Workouts organization table: {table.name}")
            actual_columns = set(
                (
                    await connection.execute(
                        text("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema='public' AND table_name=:table
            """),
                        {"table": table.name},
                    )
                ).scalars()
            )
            if not set(table.columns.keys()) <= actual_columns:
                raise RuntimeError(f"Incomplete Workouts organization table: {table.name}")
            owner_cascade = await connection.scalar(
                text("""
                SELECT EXISTS(SELECT 1 FROM pg_constraint
                WHERE conrelid=CAST(:table AS regclass) AND contype='f'
                AND confrelid='public.app_users'::regclass AND confdeltype='c')
            """),
                {"table": "public." + table.name},
            )
            if not owner_cascade:
                raise RuntimeError(f"Missing Workouts owner deletion cascade: {table.name}")
        for name, expected in (
            ("workouts_library_organization", 1),
            ("workouts_library_collection_members", 2),
        ):
            composites = await connection.scalar(
                text("""
                SELECT count(*) FROM pg_constraint WHERE conrelid=CAST(:table AS regclass)
                AND contype='f' AND array_length(conkey,1)=3 AND confdeltype='c'
            """),
                {"table": "public." + name},
            )
            if composites != expected:
                raise RuntimeError(f"Missing Workouts collection ownership fence: {name}")
        trigger = await connection.scalar(
            text("""
            SELECT EXISTS(SELECT 1 FROM pg_trigger
            WHERE tgrelid='public.workouts_library_duplicate_receipts'::regclass
            AND tgname='immutable_workouts_duplicate' AND tgenabled IN ('O','A')
            AND tgfoid='public.prevent_workouts_snapshot_update'::regproc
            AND NOT tgisinternal)
        """)
        )
        if not trigger:
            raise RuntimeError("Missing immutable Workouts duplicate receipt trigger")
