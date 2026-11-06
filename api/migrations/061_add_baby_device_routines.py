"""What each phone says it already holds of a person's routines. Not mapped in the ORM, so running code is unaffected.

A phone's own schedule keeps firing whatever happens to this table. Without it, or until a phone reports, routines
stay local exactly as they are, so nothing depends on it being there.
"""
import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from migrations._baby_expand import finish, prepare, verify

DDL = (
    """CREATE TABLE IF NOT EXISTS baby_device_routines (
        device_id UUID PRIMARY KEY REFERENCES baby_push_devices(id) ON DELETE CASCADE,
        holds JSONB NOT NULL DEFAULT '{}'::jsonb,
        reported_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
)
COLUMNS = {"baby_device_routines": {"device_id": "uuid", "holds": "jsonb", "reported_at": "timestamptz"}}
CONSTRAINTS = {"baby_device_routines": ("baby_device_routines_pkey",)}


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not getattr(configured, "baby_api_enabled", False):
        return
    async with (migration_engine or engine).begin() as db:
        recorded = await prepare(db, configured, 61, 60)
        if not recorded:
            for ddl in DDL:
                await db.execute(text(ddl))
        await verify(db, COLUMNS, CONSTRAINTS, ())
        await finish(db, 61, "Baby device routines")


if __name__ == "__main__":
    asyncio.run(run_migration())
