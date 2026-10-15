"""Optional private coach image receipts; independent of optional cover048."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.coach_attachment_models import CoachAttachment
from app.domains.workouts.coach_attachments import schema_complete


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not configured.workouts_api_enabled:
        return
    async with (migration_engine or engine).begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
        await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        if not await connection.scalar(text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")):
            raise RuntimeError("Workouts migration047 must precede049")
        if not await connection.scalar(text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=47)")):
            raise RuntimeError("Workouts migration047 must precede049")
        recorded = await connection.scalar(text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=49)"))
        if recorded:
            if not await schema_complete(connection):
                raise RuntimeError("Private coach attachment schema does not match migration049")
            return
        restore = os.environ.get("MIGRATION_049_RESTORE_POINT", "").strip()
        if (configured.environment == "production" and not restore) or len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("MIGRATION_049_RESTORE_POINT must name a verified restore point")
        await connection.run_sync(lambda sync: CoachAttachment.__table__.create(sync, checkfirst=True))
        if not await schema_complete(connection):
            raise RuntimeError("Private coach attachment schema does not match migration049")
        await connection.execute(text("""INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(49,:restore,:release) ON CONFLICT(version) DO NOTHING"""),
            {"restore": restore or None, "release": configured.app_release_id})


if __name__ == "__main__":
    asyncio.run(run_migration())
