"""Allow private Baby uploads to register durable cleanup before writing bytes."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine


async def prepare(connection, configured):
    await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
    await connection.execute(text("SELECT pg_advisory_xact_lock(7340051)"))
    if not await connection.scalar(
        text("""SELECT
        to_regclass('public.schema_migrations') IS NOT NULL
        AND to_regclass('public.deletion_cleanup_jobs') IS NOT NULL""")
    ):
        raise RuntimeError("Shared cleanup and migration baseline must precede Baby052")
    if not await connection.scalar(
        text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=50)")
    ):
        raise RuntimeError("Baby migration050 must precede052")
    recorded = await connection.scalar(
        text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=52)")
    )
    complete = await connection.scalar(
        text("""SELECT EXISTS(SELECT 1 FROM pg_constraint
        WHERE conrelid='public.deletion_cleanup_jobs'::regclass
        AND conname='ck_deletion_cleanup_kind' AND convalidated
        AND pg_get_constraintdef(oid) LIKE '%account%recipe%workout_media%baby_media%')""")
    )
    if recorded and complete:
        return None
    restore = os.environ.get("MIGRATION_052_RESTORE_POINT", "").strip()
    if (
        (configured.environment == "production" and not restore)
        or len(restore) > 160
        or any(ord(char) < 32 for char in restore)
    ):
        raise RuntimeError("MIGRATION_052_RESTORE_POINT must name a verified restore point")
    return restore


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not getattr(configured, "baby_api_enabled", False):
        return
    target = migration_engine or engine
    async with target.begin() as connection:
        if await prepare(connection, configured) is None:
            return
        # Widen atomically, preserving all existing kinds; scan outside this lock.
        await connection.execute(
            text(
                "ALTER TABLE deletion_cleanup_jobs DROP CONSTRAINT IF EXISTS ck_deletion_cleanup_kind"
            )
        )
        await connection.execute(
            text("""ALTER TABLE deletion_cleanup_jobs
            ADD CONSTRAINT ck_deletion_cleanup_kind
            CHECK (kind IN ('account','recipe','workout_media','baby_media')) NOT VALID""")
        )
    async with target.begin() as connection:
        if await prepare(connection, configured) is None:
            return
        await connection.execute(
            text("ALTER TABLE deletion_cleanup_jobs VALIDATE CONSTRAINT ck_deletion_cleanup_kind")
        )
        await connection.execute(
            text("""INSERT INTO schema_migrations(version,name)
            VALUES(52,:name) ON CONFLICT(version) DO NOTHING"""),
            {"name": "Baby media cleanup"},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
