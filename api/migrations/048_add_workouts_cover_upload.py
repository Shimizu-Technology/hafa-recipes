"""Optional cover uploads; legacy 047 readers do not depend on these columns."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not configured.workouts_api_enabled:
        return
    async with (migration_engine or engine).begin() as db:
        await db.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
        await db.execute(text("SET LOCAL lock_timeout = '5s'"))
        if not await db.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=47)")
        ):
            raise RuntimeError("Workouts migration047 must precede048")
        from app.domains.workouts.cover_upload import upload_ready

        if await upload_ready(db):
            return
        restore = os.environ.get("MIGRATION_048_RESTORE_POINT", "").strip()
        if configured.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_048_RESTORE_POINT must name a verified restore point")
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("Invalid migration048 restore point")
        await db.execute(
            text(
                "ALTER TABLE workouts_source_media ADD COLUMN IF NOT EXISTS upload_request_hash VARCHAR(64), ADD COLUMN IF NOT EXISTS cover_origin VARCHAR(16)"
            )
        )
        await db.execute(
            text(
                "ALTER TABLE workouts_source_media DROP CONSTRAINT IF EXISTS ck_workouts_source_media_owner"
            )
        )
        await db.execute(
            text("""ALTER TABLE workouts_source_media ADD CONSTRAINT ck_workouts_source_media_owner
            CHECK (generation>0 AND purpose IN ('import','copy','upload')
            AND (cover_origin IS NULL OR cover_origin='user')
            AND (purpose<>'upload' OR (upload_request_hash IS NOT NULL AND cover_origin IS NOT NULL
              AND upload_request_hash ~ '^[0-9a-f]{64}$' AND cover_origin='user'))) NOT VALID""")
        )
    async with (migration_engine or engine).begin() as db:
        await db.execute(
            text(
                "ALTER TABLE workouts_source_media VALIDATE CONSTRAINT ck_workouts_source_media_owner"
            )
        )
        await db.execute(
            text("""INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(48,:restore,:release) ON CONFLICT(version) DO NOTHING"""),
            {"restore": restore or None, "release": configured.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
