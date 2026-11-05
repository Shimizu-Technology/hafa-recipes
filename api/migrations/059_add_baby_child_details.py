"""Optional setup answers on a child profile. No ORM mapping yet, so running code is unaffected."""
import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from migrations._baby_expand import finish, prepare


async def verify_details(db):
    # The API that maps this column refuses to start unless it is jsonb and NOT NULL, so check that here.
    row = (await db.execute(text("""SELECT udt_name, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema='public' AND table_name='baby_children' AND column_name='details'"""))).first()
    if row is None or row[0] != "jsonb" or row[1] != "NO" or not (row[2] or "").startswith("'{}'"):
        raise RuntimeError("Baby059 schema drift: baby_children.details")


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not getattr(configured, "baby_api_enabled", False):
        return
    # One transaction, and a constant default rewrites no rows. Applied while old code runs.
    async with (migration_engine or engine).begin() as db:
        recorded = await prepare(db, configured, 59, 58)
        if not recorded:
            await db.execute(text("""ALTER TABLE baby_children
                ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb"""))
        await verify_details(db)
        await finish(db, 59, "Baby child details")


if __name__ == "__main__":
    asyncio.run(run_migration())
