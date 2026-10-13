"""Optional public Discover columns on workouts_library; additive only.

Serving code treats Discover as unavailable until this version is recorded, so
deploying the code before an operator applies 045 is supported.
"""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine

COLUMNS = """ALTER TABLE workouts_library
    ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(16) NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_canonical_key VARCHAR(300),
    ADD COLUMN IF NOT EXISTS source_platform VARCHAR(24),
    ADD COLUMN IF NOT EXISTS publisher_display_name VARCHAR(100)"""
CONSTRAINTS = {
    "ck_workouts_library_moderation_status": "moderation_status IN ('active','hidden')",
    "ck_workouts_library_public_published": "NOT is_public OR published_at IS NOT NULL",
}
INDEXES = (
    """CREATE INDEX IF NOT EXISTS ix_workouts_library_discover
        ON workouts_library (published_at DESC, id DESC)
        WHERE is_public AND moderation_status = 'active'""",
    """CREATE INDEX IF NOT EXISTS ix_workouts_library_discover_source
        ON workouts_library (source_canonical_key, published_at)
        WHERE is_public AND moderation_status = 'active' AND source_canonical_key IS NOT NULL""",
)


async def prepare(connection, settings):
    """Shared guards; returns the restore point, or None when 045 is recorded."""
    await connection.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
    # Fail fast instead of queueing live library reads behind ALTER TABLE.
    await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
    if not await connection.scalar(
        text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
    ) or not await connection.scalar(
        text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=35)")
    ):
        # 035 widens the optional ledger beyond version 34.
        raise RuntimeError("Workouts migration035 must precede045")
    if await connection.scalar(
        text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=45)")
    ):
        return None
    restore = (
        getattr(settings, "migration_045_restore_point", None)
        or os.environ.get("MIGRATION_045_RESTORE_POINT", "")
    ).strip()
    if settings.environment == "production" and not restore:
        raise RuntimeError("MIGRATION_045_RESTORE_POINT must name a verified restore point")
    if len(restore) > 160 or any(ord(char) < 32 for char in restore):
        raise RuntimeError("MIGRATION_045_RESTORE_POINT is invalid")
    return restore


async def run_migration(*, configured=None, migration_engine=None):
    settings = configured or get_settings()
    if not settings.workouts_api_enabled:
        return
    target = migration_engine or engine
    # Phase 1: metadata-only columns and NOT VALID constraints (no row scan
    # under ACCESS EXCLUSIVE). Each step is guarded so a retry after this
    # phase commits picks up where it stopped.
    async with target.begin() as connection:
        if await prepare(connection, settings) is None:
            return
        await connection.execute(text(COLUMNS))
        for name, check in CONSTRAINTS.items():
            if not await connection.scalar(
                text("""SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conname=:name
                AND conrelid='public.workouts_library'::regclass)"""),
                {"name": name},
            ):
                await connection.execute(
                    text(
                        f"ALTER TABLE workouts_library ADD CONSTRAINT {name} CHECK ({check}) NOT VALID"
                    )
                )
        for statement in INDEXES:
            await connection.execute(text(statement))
    # Phase 2: validation scans under SHARE UPDATE EXCLUSIVE, which does not
    # block library reads or writes; the version is recorded only afterwards.
    async with target.begin() as connection:
        restore = await prepare(connection, settings)
        if restore is None:
            return
        for name in CONSTRAINTS:
            await connection.execute(
                text(f"ALTER TABLE workouts_library VALIDATE CONSTRAINT {name}")
            )
        await connection.execute(
            text("""INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(45,:restore,:release)"""),
            {"restore": restore or None, "release": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
