"""Optional completed-activity metadata; legacy observations remain unchanged."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.activity_log_models import ACTIVITY_LOG_TABLES


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
            raise RuntimeError("Workouts migration035 must precede044")
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=44)")
        ):
            return
        restore = (
            getattr(settings, "migration_044_restore_point", None)
            or os.environ.get("MIGRATION_044_RESTORE_POINT", "")
        ).strip()
        if settings.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_044_RESTORE_POINT must name a verified restore point")
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("MIGRATION_044_RESTORE_POINT is invalid")
        await connection.run_sync(
            lambda sync: ACTIVITY_LOG_TABLES[0].metadata.create_all(
                sync, tables=list(ACTIVITY_LOG_TABLES)
            )
        )
        await connection.execute(
            text("""CREATE TRIGGER immutable_workouts_activity_log_operation
            BEFORE UPDATE ON workouts_activity_log_operations FOR EACH ROW
            EXECUTE FUNCTION prevent_workouts_snapshot_update()""")
        )
        await connection.execute(
            text("""CREATE FUNCTION protect_workouts_activity_log_identity() RETURNS TRIGGER AS $$
            BEGIN
                IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.app_user_id<>OLD.app_user_id
                    OR NEW.generation<>OLD.generation OR NEW.created_at<>OLD.created_at) THEN
                    RAISE EXCEPTION 'workouts activity-log capture identity is immutable';
                END IF;
                IF NEW.status='active' AND NOT EXISTS(SELECT 1 FROM workouts_activities a
                    WHERE a.id=NEW.activity_id AND a.app_user_id=NEW.app_user_id AND a.generation=NEW.generation
                    AND a.content->>'origin_id' IS NULL) THEN
                    RAISE EXCEPTION 'workouts activity-log projection owner/provenance mismatch';
                END IF;
                RETURN NEW;
            END; $$ LANGUAGE plpgsql""")
        )
        await connection.execute(
            text("""CREATE TRIGGER immutable_workouts_activity_log_identity
            BEFORE INSERT OR UPDATE ON workouts_activity_log FOR EACH ROW
            EXECUTE FUNCTION protect_workouts_activity_log_identity()""")
        )
        await connection.execute(
            text("""INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(44,:restore,:release)"""),
            {"restore": restore or None, "release": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
