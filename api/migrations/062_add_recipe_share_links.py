"""Add optional hashed unlisted grants. Old code and public pages do not need this table."""
import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.recipe_links import RecipeLink


async def run_migration(*, migration_engine=None):
    async with (migration_engine or engine).begin() as db:
        await db.execute(text('SELECT pg_advisory_xact_lock(7340062)'))
        await db.execute(text("SET LOCAL lock_timeout = '5s'"))
        if get_settings().environment == 'production' and not os.getenv('MIGRATION_062_RESTORE_POINT', '').strip():
            raise RuntimeError('MIGRATION_062_RESTORE_POINT must name a verified restore point')
        await db.run_sync(lambda sync: RecipeLink.__table__.create(sync, checkfirst=True))
        await db.execute(text("INSERT INTO schema_migrations(version,name) VALUES(62,'unlisted recipe links') ON CONFLICT(version) DO NOTHING"))


if __name__ == '__main__':
    asyncio.run(run_migration())
