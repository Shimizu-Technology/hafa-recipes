"""Add optional private original-page receipts without changing recipe projections."""
import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.recipe_source_pages import RecipeSourcePages


async def run_migration(*, migration_engine=None):
    async with (migration_engine or engine).begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340054)"))
        await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        registry = await connection.scalar(text("SELECT to_regclass('public.schema_migrations') IS NOT NULL"))
        if not registry:
            raise RuntimeError("Apply the active migration chain before migration054")
        applied = await connection.scalar(text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=54)"))
        exists = await connection.scalar(text("SELECT to_regclass('public.recipe_source_pages') IS NOT NULL"))
        if not applied and get_settings().environment == "production" and not os.getenv("MIGRATION_054_RESTORE_POINT", "").strip():
            raise RuntimeError("MIGRATION_054_RESTORE_POINT must name a verified restore point")
        if applied and not exists:
            raise RuntimeError("Migration054 schema drift: original pages table is missing")
        await connection.run_sync(lambda sync: RecipeSourcePages.__table__.create(sync, checkfirst=True))
        columns = (await connection.execute(text("""
            SELECT column_name,data_type,is_nullable FROM information_schema.columns
            WHERE table_schema='public' AND table_name='recipe_source_pages' ORDER BY column_name
        """))).all()
        cascade = await connection.scalar(text("""
            SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='recipe_source_pages'::regclass
              AND confrelid='recipes'::regclass AND contype='f' AND confdeltype='c')
        """))
        if [tuple(row) for row in columns] != [("pages", "jsonb", "NO"), ("recipe_id", "uuid", "NO")] or not cascade:
            raise RuntimeError("Migration054 schema drift: unexpected original pages schema")
        await connection.execute(text("""INSERT INTO schema_migrations(version,name)
            VALUES(54,'private original recipe pages') ON CONFLICT(version) DO NOTHING"""))


if __name__ == "__main__":
    asyncio.run(run_migration())
