"""Add bounded import/proposal state without touching Recipes tables."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.automation_models import AUTOMATION_TABLES


async def install_automation_schema(connection):
    # 034 initially admitted only its own version. Expand the optional ledger
    # before subsequent domains; the Recipes ledger remains independent.
    constraints = (
        (
            await connection.execute(
                text("""
        SELECT conname FROM pg_constraint
        WHERE conrelid='public.workouts_schema_migrations'::regclass AND contype='c'
    """)
            )
        )
        .scalars()
        .all()
    )
    for name in constraints:
        quoted = '"' + name.replace('"', '""') + '"'
        await connection.execute(
            text(f"ALTER TABLE workouts_schema_migrations DROP CONSTRAINT {quoted}")
        )
    await connection.execute(
        text("""
        ALTER TABLE workouts_schema_migrations ADD CONSTRAINT ck_workouts_optional_version
        CHECK(version>=34)
    """)
    )
    await connection.run_sync(
        lambda sync: AUTOMATION_TABLES[0].metadata.create_all(sync, tables=list(AUTOMATION_TABLES))
    )
    await connection.execute(
        text("""
        CREATE INDEX IF NOT EXISTS ix_workouts_import_dispatch
        ON workouts_import_jobs(status,next_attempt_at,created_at)
    """)
    )


async def run_migration(*, configured=None, migration_engine=None):
    settings = configured or get_settings()
    if not settings.workouts_api_enabled:
        return
    async with (migration_engine or engine).begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
        exists = await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        )
        if not exists or not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=34)")
        ):
            raise RuntimeError("Workouts migration034 must precede035")
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=35)")
        ):
            return
        restore = (
            getattr(settings, "migration_035_restore_point", None)
            or os.environ.get("MIGRATION_035_RESTORE_POINT", "")
        ).strip()
        if settings.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_035_RESTORE_POINT must name a verified restore point")
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("MIGRATION_035_RESTORE_POINT is invalid")
        await install_automation_schema(connection)
        await connection.execute(
            text("""
            INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(35,:restore,:release)
        """),
            {"restore": restore or None, "release": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
