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
        # Also upgrade a database which ran the original held migration.
        await db.execute(text('ALTER TABLE recipe_share_links ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()'))
        columns = (await db.execute(text("""
            SELECT column_name,data_type,is_nullable FROM information_schema.columns
            WHERE table_schema='public' AND table_name='recipe_share_links' ORDER BY column_name
        """))).all()
        constraints = await db.scalar(text("""
            SELECT count(*) FROM pg_constraint WHERE conrelid='recipe_share_links'::regclass
            AND (contype IN ('p','u') OR (contype='f' AND confrelid='recipes'::regclass AND confdeltype='c'))
        """))
        required_columns = {('created_at', 'timestamp with time zone', 'NO'), ('recipe_id', 'uuid', 'NO'), ('token_hash', 'character varying', 'NO')}
        if not required_columns.issubset({tuple(row) for row in columns}) or constraints < 3:
            raise RuntimeError('Migration062 schema drift: unexpected recipe link schema')
        await db.execute(text("INSERT INTO schema_migrations(version,name) VALUES(62,'unlisted recipe links') ON CONFLICT(version) DO NOTHING"))


if __name__ == '__main__':
    asyncio.run(run_migration())
