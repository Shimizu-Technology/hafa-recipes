"""Optional owned source covers; no media writes occur before this ledger entry."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.source_media_models import WorkoutSourceMedia


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not configured.workouts_api_enabled:
        return
    async with (migration_engine or engine).begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
        await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        if not await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        ) or not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=35)")
        ):
            raise RuntimeError("Workouts migration035 must precede047")
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=47)")
        ):
            return
        restore = os.environ.get("MIGRATION_047_RESTORE_POINT", "").strip()
        if configured.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_047_RESTORE_POINT must name a verified restore point")
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("Invalid migration047 restore point")
        if not await connection.scalar(
            text("SELECT to_regclass('public.deletion_cleanup_jobs') IS NOT NULL")
        ):
            raise RuntimeError("Deletion cleanup migration019 must precede047")
        await connection.run_sync(
            lambda sync: WorkoutSourceMedia.__table__.create(sync, checkfirst=True)
        )
        await connection.execute(
            text("""INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(47,:restore,:release)"""),
            {"restore": restore or None, "release": configured.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
