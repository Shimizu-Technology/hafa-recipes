"""Independent Recipes choice epochs; existing scopes and timestamps stay intact."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.workouts.recipe_grant_models import WorkoutsRecipeGrantEpoch


async def install_recipe_grant_schema(connection):
    table = WorkoutsRecipeGrantEpoch.__table__
    await connection.run_sync(lambda sync: table.metadata.create_all(sync, tables=[table]))
    await connection.execute(
        text("""
        CREATE OR REPLACE FUNCTION protect_workouts_recipe_epoch() RETURNS trigger AS $$
        BEGIN
            IF NEW.app_user_id IS DISTINCT FROM OLD.app_user_id
               OR NEW.generation IS DISTINCT FROM OLD.generation
               OR NEW.revision<>OLD.revision+1 THEN
                RAISE EXCEPTION 'Recipe grant epoch must advance monotonically by one';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    )
    await connection.execute(
        text(
            "DROP TRIGGER IF EXISTS monotonic_workouts_recipe_epoch ON workouts_recipe_grant_epochs"
        )
    )
    await connection.execute(
        text("""
        CREATE TRIGGER monotonic_workouts_recipe_epoch BEFORE UPDATE ON workouts_recipe_grant_epochs
        FOR EACH ROW EXECUTE FUNCTION protect_workouts_recipe_epoch()
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
            raise RuntimeError("Workouts migration035 must precede041")
        if await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM workouts_schema_migrations WHERE version=41)")
        ):
            return
        restore = (
            getattr(settings, "migration_041_restore_point", None)
            or os.environ.get("MIGRATION_041_RESTORE_POINT", "")
        ).strip()
        if settings.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_041_RESTORE_POINT must name a verified restore point")
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("MIGRATION_041_RESTORE_POINT is invalid")
        await install_recipe_grant_schema(connection)
        await connection.execute(
            text("""INSERT INTO workouts_schema_migrations(version,restore_point,release_id)
            VALUES(41,:restore,:release)"""),
            {"restore": restore or None, "release": settings.app_release_id},
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
