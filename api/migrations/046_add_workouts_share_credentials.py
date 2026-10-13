"""Add native Workouts link capabilities independently of Recipes' credentials."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.share_models import WorkoutShareCredential


async def run_migration(*, configured=None, migration_engine=None):
    settings = configured or get_settings()
    if not settings.workouts_api_enabled:
        return
    async with (migration_engine or engine).begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
        await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        exists = await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        )
        if not exists or not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=35)")
        ):
            raise RuntimeError("Workouts migration035 must precede046")
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=46)")
        ):
            return
        restore = os.environ.get("MIGRATION_046_RESTORE_POINT", "").strip()
        if settings.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_046_RESTORE_POINT must name a verified restore point")
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("Invalid migration046 restore point")
        await connection.run_sync(
            lambda sync: WorkoutShareCredential.__table__.create(sync, checkfirst=True)
        )
        await connection.execute(
            text(
                "INSERT INTO workouts_schema_migrations(version,restore_point,release_id) VALUES(46,:restore,:release)"
            ),
            {"restore": restore or None, "release": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
