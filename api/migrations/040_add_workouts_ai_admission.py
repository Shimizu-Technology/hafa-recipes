"""Anonymous paid-AI admission ledger; no account FK or Recipes migration change."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.budget_models import WorkoutsAIAdmission


async def install_budget_schema(connection):
    await connection.run_sync(lambda sync: WorkoutsAIAdmission.metadata.create_all(sync))
    await connection.execute(
        text("""
        CREATE OR REPLACE FUNCTION protect_workouts_ai_admission() RETURNS trigger AS $$
        BEGIN
            IF (NEW.attempt_id,NEW.capability,NEW.model,NEW.admitted_microusd,NEW.admitted_at)
               IS DISTINCT FROM (OLD.attempt_id,OLD.capability,OLD.model,OLD.admitted_microusd,OLD.admitted_at)
               OR OLD.finished_at IS NOT NULL THEN
                RAISE EXCEPTION 'Workouts AI admission reservation is immutable';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    )
    await connection.execute(
        text("DROP TRIGGER IF EXISTS immutable_workouts_ai_admission ON workouts_ai_admissions")
    )
    await connection.execute(
        text("""
        CREATE TRIGGER immutable_workouts_ai_admission BEFORE UPDATE ON workouts_ai_admissions
        FOR EACH ROW EXECUTE FUNCTION protect_workouts_ai_admission()
    """)
    )


async def run_migration(*, configured=None, migration_engine=None):
    settings = configured or get_settings()
    if not settings.workouts_api_enabled:
        return
    async with (migration_engine or engine).begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
        if not await connection.scalar(
            text("SELECT to_regclass('public.workouts_schema_migrations') IS NOT NULL")
        ) or not await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=35)")
        ):
            raise RuntimeError("Workouts migration035 must precede040")
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=40)")
        ):
            return
        restore = (
            getattr(settings, "migration_040_restore_point", None)
            or os.environ.get("MIGRATION_040_RESTORE_POINT", "")
        ).strip()
        if settings.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_040_RESTORE_POINT must name a verified restore point")
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("MIGRATION_040_RESTORE_POINT is invalid")
        await install_budget_schema(connection)
        await connection.execute(
            text("""
            INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(40,:restore,:release)
        """),
            {"restore": restore or None, "release": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
