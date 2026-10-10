"""Optional health migration, after explicit Workouts account/job migrations."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.health_models import HEALTH_TABLES


async def install_health_schema(connection):
    await connection.run_sync(
        lambda sync: HEALTH_TABLES[0].metadata.create_all(sync, tables=list(HEALTH_TABLES))
    )


async def run_migration(*, configured=None, migration_engine=None):
    settings = configured or get_settings()
    if not settings.workouts_api_enabled or not settings.workouts_health_sync_enabled:
        return
    target = migration_engine or engine
    async with target.begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340036)"))
        exists = await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        )
        if not exists or not await connection.scalar(
            text("SELECT count(*)=2 FROM workouts_schema_migrations WHERE version IN (34,35)")
        ):
            raise RuntimeError("Optional Workouts migrations 034 and 035 must precede 036")
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=36)")
        ):
            return
        restore = (
            getattr(settings, "migration_036_restore_point", None)
            or os.environ.get("MIGRATION_036_RESTORE_POINT", "")
        ).strip()
        if settings.environment == "production" and not restore:
            raise RuntimeError(
                "MIGRATION_036_RESTORE_POINT must name a verified production restore point"
            )
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("MIGRATION_036_RESTORE_POINT is invalid")
        await install_health_schema(connection)
        # Optional domains share an additive ledger independent of Recipes.
        await connection.execute(
            text(
                "ALTER TABLE workouts_schema_migrations DROP CONSTRAINT IF EXISTS workouts_schema_migrations_version_check"
            )
        )
        await connection.execute(
            text(
                "ALTER TABLE workouts_schema_migrations ADD CONSTRAINT workouts_schema_migrations_version_check CHECK(version>=34)"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO workouts_schema_migrations(version,restore_point,release_id) VALUES(36,:restore,:release)"
            ),
            {"restore": restore or None, "release": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
