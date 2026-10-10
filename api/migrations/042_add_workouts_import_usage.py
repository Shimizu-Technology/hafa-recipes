"""Content-free rolling allowance receipts; independent of product generations."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.import_usage_models import IMPORT_USAGE_TABLES


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
            raise RuntimeError("Workouts migration035 must precede042")
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=42)")
        ):
            return
        restore = (
            getattr(settings, "migration_042_restore_point", None)
            or os.environ.get("MIGRATION_042_RESTORE_POINT", "")
        ).strip()
        if settings.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_042_RESTORE_POINT must name a verified restore point")
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("MIGRATION_042_RESTORE_POINT is invalid")
        await connection.run_sync(
            lambda sync: IMPORT_USAGE_TABLES[0].metadata.create_all(
                sync, tables=list(IMPORT_USAGE_TABLES)
            )
        )
        # Existing successful jobs have no historical charge ledger. Charge
        # retained usable results once at migration time, conservatively, rather
        # than inventing historical provider-completion timestamps.
        await connection.execute(
            text("""INSERT INTO workouts_import_usage(app_user_id,request_id,charged_at)
            SELECT app_user_id,request_id,CURRENT_TIMESTAMP FROM workouts_import_jobs
            WHERE (status IN ('ready','incomplete') AND result->>'workout' IS NOT NULL)
                OR accepted_workout_id IS NOT NULL
            ON CONFLICT(app_user_id,request_id) DO NOTHING""")
        )
        await connection.execute(
            text("""CREATE TRIGGER immutable_workouts_import_usage
            BEFORE UPDATE ON workouts_import_usage FOR EACH ROW
            EXECUTE FUNCTION prevent_workouts_snapshot_update()""")
        )
        await connection.execute(
            text("""INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(42,:restore,:release)"""),
            {"restore": restore or None, "release": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
