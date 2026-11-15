"""Add optional score history and widen the opt-in HR storage grant."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.heart_rate_erasure import install_heart_rate_erasure
from app.domains.workouts.part_result_models import PartResultRow
from app.domains.workouts.part_results import schema_complete


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not configured.workouts_api_enabled:
        return
    async with (migration_engine or engine).begin() as db:
        await db.execute(text("SET LOCAL lock_timeout = '5s'"))
        await db.execute(text("SET LOCAL statement_timeout = '60s'"))
        await db.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
        if not await db.scalar(text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")) or not await db.scalar(text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=49)")):
            raise RuntimeError("Workouts migration049 must precede063")
        if await db.scalar(text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=63)")):
            if not await schema_complete(db):
                raise RuntimeError("Workouts results schema does not match migration063")
            return
        restore = os.environ.get("MIGRATION_063_RESTORE_POINT", "").strip()
        if (configured.environment == "production" and not restore) or len(restore) > 160 or any(ord(c) < 32 for c in restore):
            raise RuntimeError("MIGRATION_063_RESTORE_POINT must name a verified restore point")
        await install_heart_rate_erasure(db)
        await db.run_sync(lambda sync: PartResultRow.__table__.create(sync, checkfirst=True))
        # This migration and its ledger are atomic; CONCURRENTLY cannot run in
        # its transaction. Operators should prebuild concurrently for large tables.
        await db.execute(text("CREATE INDEX IF NOT EXISTS ix_workouts_session_source ON workouts_sessions(app_user_id,generation,source_workout_id)"))
        await db.execute(text("ALTER TABLE workouts_grants DROP CONSTRAINT ck_workouts_grant_scope"))
        await db.execute(text("ALTER TABLE workouts_grants ADD CONSTRAINT ck_workouts_grant_scope CHECK (scope IN ('recipes_library_context','recipes_meal_plan_context','health_activity_read','health_activity_write','health_body_measurements_read','ai_health_context','health_workout_summary_store'))"))
        if not await schema_complete(db):
            raise RuntimeError("Workouts results schema does not match migration063")
        await db.execute(text("INSERT INTO workouts_schema_migrations(version,restore_point,release_id) VALUES(63,:restore,:release)"), {"restore": restore or None, "release": configured.app_release_id})


if __name__ == "__main__":
    asyncio.run(run_migration())
