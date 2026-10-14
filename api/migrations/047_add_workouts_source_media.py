"""Optional owned source covers; register exact cleanup before any media write."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.source_media_models import WorkoutSourceMedia


async def prepare(connection, configured):
    await connection.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
    await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
    if not await connection.scalar(
        text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
    ) or not await connection.scalar(
        text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=35)")
    ):
        raise RuntimeError("Workouts migration035 must precede047")
    if not await connection.scalar(
        text("SELECT to_regclass('public.deletion_cleanup_jobs') IS NOT NULL")
    ):
        raise RuntimeError("Deletion cleanup migration019 must precede047")
    recorded = await connection.scalar(
        text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=47)")
    )
    complete = await connection.scalar(
        text("""SELECT EXISTS(SELECT 1 FROM pg_constraint
        WHERE conrelid='public.deletion_cleanup_jobs'::regclass AND conname='ck_deletion_cleanup_kind'
        AND convalidated AND pg_get_constraintdef(oid) LIKE '%workout_media%')""")
    )
    if (
        recorded
        and complete
        and await connection.scalar(
            text("SELECT to_regclass('public.workouts_source_media') IS NOT NULL")
        )
    ):
        return None
    restore = os.environ.get("MIGRATION_047_RESTORE_POINT", "").strip()
    if configured.environment == "production" and not restore:
        raise RuntimeError("MIGRATION_047_RESTORE_POINT must name a verified restore point")
    if len(restore) > 160 or any(ord(char) < 32 for char in restore):
        raise RuntimeError("Invalid migration047 restore point")
    return restore


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not configured.workouts_api_enabled:
        return
    target = migration_engine or engine
    # Widen the real019 allowlist atomically. NOT VALID avoids a row scan while
    # holding ACCESS EXCLUSIVE; account/recipe values stay valid throughout.
    async with target.begin() as connection:
        if await prepare(connection, configured) is None:
            return
        await connection.execute(
            text(
                "ALTER TABLE deletion_cleanup_jobs DROP CONSTRAINT IF EXISTS ck_deletion_cleanup_kind"
            )
        )
        await connection.execute(
            text("""ALTER TABLE deletion_cleanup_jobs ADD CONSTRAINT ck_deletion_cleanup_kind
            CHECK (kind IN ('account','recipe','workout_media')) NOT VALID""")
        )
        await connection.run_sync(
            lambda sync: WorkoutSourceMedia.__table__.create(sync, checkfirst=True)
        )
    # Validation does not hold the metadata-only phase's ACCESS EXCLUSIVE lock.
    async with target.begin() as connection:
        restore = await prepare(connection, configured)
        if restore is None:
            return
        await connection.execute(
            text("ALTER TABLE deletion_cleanup_jobs VALIDATE CONSTRAINT ck_deletion_cleanup_kind")
        )
        await connection.execute(
            text("""INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(47,:restore,:release) ON CONFLICT(version) DO NOTHING"""),
            {"restore": restore or None, "release": configured.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
