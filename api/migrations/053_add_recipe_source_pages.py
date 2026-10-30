"""Add optional private original-page receipts without changing recipe projections."""
import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.recipe_source_pages import RecipeSourcePages


async def run_migration(*, migration_engine=None):
    async with (migration_engine or engine).begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340053)"))
        await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        exists = await connection.scalar(text("SELECT to_regclass('public.recipe_source_pages') IS NOT NULL"))
        if not exists and get_settings().environment == "production" and not os.getenv("MIGRATION_053_RESTORE_POINT", "").strip():
            raise RuntimeError("MIGRATION_053_RESTORE_POINT must name a verified restore point")
        await connection.run_sync(lambda sync: RecipeSourcePages.__table__.create(sync, checkfirst=True))


if __name__ == "__main__":
    asyncio.run(run_migration())
