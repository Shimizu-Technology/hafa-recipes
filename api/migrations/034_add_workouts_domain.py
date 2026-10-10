"""Optional migration 034, deliberately outside Recipes' active migration chain."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.models import WORKOUTS_TABLES
from app.models.identity import AppUser  # noqa: F401 -- registers the FK target


async def install_workouts_schema(connection):
    await connection.run_sync(
        lambda sync: WORKOUTS_TABLES[0].metadata.create_all(sync, tables=list(WORKOUTS_TABLES))
    )
    await connection.execute(
        text("""
        CREATE OR REPLACE FUNCTION prevent_workouts_snapshot_update()
        RETURNS TRIGGER AS $$ BEGIN
            RAISE EXCEPTION 'Workouts prescription versions and actual snapshots are immutable';
        END $$ LANGUAGE plpgsql
    """)
    )
    for table in ("workouts_library_versions", "workouts_program_versions", "workouts_sessions"):
        await connection.execute(
            text(f"DROP TRIGGER IF EXISTS immutable_workouts_snapshot ON {table}")
        )
        # Erasure and owner cascades are allowed; only rewriting is prohibited.
        await connection.execute(
            text(f"""
            CREATE TRIGGER immutable_workouts_snapshot BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION prevent_workouts_snapshot_update()
        """)
        )
    await connection.execute(
        text("""
        CREATE TABLE IF NOT EXISTS workouts_schema_migrations (
            version INTEGER PRIMARY KEY CHECK(version=34),
            restore_point VARCHAR(160),
            release_id VARCHAR(160) NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    )


async def run_migration(*, configured=None, migration_engine=None):
    settings = configured or get_settings()
    if not settings.workouts_api_enabled:
        return
    target = migration_engine or engine
    async with target.begin() as connection:
        # Serializes optional migration invocations without locking Recipes rows.
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
        ledger_exists = await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        )
        if ledger_exists and await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=34)")
        ):
            return
        restore_point = (
            getattr(settings, "migration_034_restore_point", None)
            or os.environ.get("MIGRATION_034_RESTORE_POINT", "")
        ).strip()
        if settings.environment == "production" and not restore_point:
            raise RuntimeError(
                "MIGRATION_034_RESTORE_POINT must name a verified production restore point"
            )
        if len(restore_point) > 160 or any(ord(char) < 32 for char in restore_point):
            raise RuntimeError("MIGRATION_034_RESTORE_POINT is invalid")
        if not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=33)")
        ):
            raise RuntimeError(
                "Recipes migration chain through 033 must precede optional Workouts migration 034"
            )
        await install_workouts_schema(connection)
        await connection.execute(
            text("""
            INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(34,:restore_point,:release_id)
        """),
            {"restore_point": restore_point or None, "release_id": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
