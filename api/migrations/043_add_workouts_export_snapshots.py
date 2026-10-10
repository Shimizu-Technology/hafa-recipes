"""Optional encrypted temporary exports; no change to Recipes core migrations."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.export_models import EXPORT_TABLES


async def install_export_schema(connection):
    await connection.run_sync(
        lambda sync: EXPORT_TABLES[0].metadata.create_all(sync, tables=list(EXPORT_TABLES))
    )
    await connection.execute(
        text("""CREATE OR REPLACE FUNCTION fence_workouts_export_epoch()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.app_user_id IS DISTINCT FROM OLD.app_user_id OR NEW.generation IS DISTINCT FROM OLD.generation
       OR NEW.revision <> OLD.revision + 1 THEN
        RAISE EXCEPTION 'Workouts export epoch must advance';
    END IF; RETURN NEW; END $$""")
    )
    await connection.execute(
        text("DROP TRIGGER IF EXISTS fence_workouts_export_epoch ON workouts_export_epochs")
    )
    await connection.execute(
        text("""CREATE TRIGGER fence_workouts_export_epoch BEFORE UPDATE
    ON workouts_export_epochs FOR EACH ROW EXECUTE FUNCTION fence_workouts_export_epoch()""")
    )
    await connection.execute(
        text("DROP TRIGGER IF EXISTS immutable_workouts_export_page ON workouts_export_pages")
    )
    await connection.execute(
        text("""CREATE TRIGGER immutable_workouts_export_page BEFORE UPDATE
    ON workouts_export_pages FOR EACH ROW EXECUTE FUNCTION prevent_workouts_snapshot_update()""")
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
            raise RuntimeError("Workouts migration035 must precede043")
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=43)")
        ):
            return
        restore = (
            getattr(settings, "migration_043_restore_point", None)
            or os.environ.get("MIGRATION_043_RESTORE_POINT", "")
        ).strip()
        if settings.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_043_RESTORE_POINT must name a verified restore point")
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("MIGRATION_043_RESTORE_POINT is invalid")
        await install_export_schema(connection)
        await connection.execute(
            text("""INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
        VALUES(43,:restore,:release)"""),
            {"restore": restore or None, "release": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
