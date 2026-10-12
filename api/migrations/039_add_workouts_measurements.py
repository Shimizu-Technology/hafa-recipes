"""Optional self-reported measurements; never infer legacy measurement times."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.measurement_models import MEASUREMENT_TABLES


async def install_measurement_schema(connection):
    await connection.run_sync(
        lambda sync: MEASUREMENT_TABLES[0].metadata.create_all(
            sync, tables=list(MEASUREMENT_TABLES)
        )
    )
    await connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_workouts_measurement_history ON workouts_measurements(app_user_id,generation,kind,recorded_at DESC,id DESC)"
        )
    )
    await connection.execute(
        text(
            "DROP TRIGGER IF EXISTS immutable_workouts_measurement_operation ON workouts_measurement_operations"
        )
    )
    await connection.execute(
        text("""CREATE TRIGGER immutable_workouts_measurement_operation
        BEFORE UPDATE ON workouts_measurement_operations FOR EACH ROW
        EXECUTE FUNCTION prevent_workouts_snapshot_update()""")
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
            raise RuntimeError("Workouts migration035 must precede039")
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=39)")
        ):
            return
        restore = (
            getattr(settings, "migration_039_restore_point", None)
            or os.environ.get("MIGRATION_039_RESTORE_POINT", "")
        ).strip()
        if settings.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_039_RESTORE_POINT must name a verified restore point")
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("MIGRATION_039_RESTORE_POINT is invalid")
        await install_measurement_schema(connection)
        await connection.execute(
            text("""INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(39,:restore,:release)"""),
            {"restore": restore or None, "release": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
