"""Require destinations and retain family history after its creator deletes an account."""
import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.baby.schema import CREATOR_TABLES, SPACE_TABLES, schema_complete
from migrations._baby_expand import finish, prepare
from migrations._baby_v1_schema import BABY_SHARE_V1_TABLES, BABY_V1_ALLOWED_FORMS, BABY_V1_TABLES


async def compatible(db):
    return await schema_complete(db, tables=(*BABY_V1_TABLES, *BABY_SHARE_V1_TABLES),
                                 allowed_forms=BABY_V1_ALLOWED_FORMS)


async def verify_contract(db):
    for table in SPACE_TABLES:
        if await db.scalar(text("""SELECT is_nullable FROM information_schema.columns
            WHERE table_schema='public' AND table_name=:table AND column_name='space_id'"""),
            {"table": table}) != "NO":
            raise RuntimeError(f"Baby058 schema drift: {table}.space_id")
    if not await compatible(db):
        raise RuntimeError("Baby058 schema drift: startup compatibility")
    for table in CREATOR_TABLES:
        nullable = await db.scalar(text("""SELECT is_nullable FROM information_schema.columns
            WHERE table_schema='public' AND table_name=:table AND column_name='app_user_id'"""),
            {"table": table})
        action = await db.scalar(text("""SELECT confdeltype::text FROM pg_constraint
            WHERE conrelid=to_regclass(:table) AND contype='f'
            AND conkey=ARRAY[(SELECT attnum FROM pg_attribute
                WHERE attrelid=to_regclass(:table) AND attname='app_user_id')]"""), {"table": table})
        if nullable != "YES" or action != "n":
            raise RuntimeError(f"Baby058 schema drift: {table}.app_user_id")


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not getattr(configured, "baby_api_enabled", False):
        return
    # No intermediate commit: old and new startup checks reject half-swapped FKs.
    async with (migration_engine or engine).begin() as db:
        recorded = await prepare(db, configured, 58, 57)
        if not recorded:
            if not await compatible(db):
                raise RuntimeError("Baby058 requires the complete pre-F11 schema")
            for table in SPACE_TABLES:
                if await db.scalar(text(f"SELECT EXISTS(SELECT 1 FROM {table} WHERE space_id IS NULL)")):
                    raise RuntimeError(f"Baby058 requires F3 rerun with zero null space IDs: {table}")
            for table in SPACE_TABLES:
                await db.execute(text(f"ALTER TABLE {table} ALTER COLUMN space_id SET NOT NULL"))
            for table in CREATOR_TABLES:
                constraint = await db.scalar(text("""SELECT conname FROM pg_constraint
                    WHERE conrelid=to_regclass(:table) AND contype='f'
                    AND conkey=ARRAY[(SELECT attnum FROM pg_attribute
                        WHERE attrelid=to_regclass(:table) AND attname='app_user_id')]"""), {"table": table})
                quoted = '"' + constraint.replace('"', '""') + '"'
                await db.execute(text(f"""ALTER TABLE {table}
                    ALTER COLUMN app_user_id DROP NOT NULL,
                    DROP CONSTRAINT {quoted},
                    ADD CONSTRAINT {table}_app_user_id_fkey FOREIGN KEY (app_user_id)
                        REFERENCES app_users(id) ON DELETE SET NULL"""))
        await verify_contract(db)
        await finish(db, 58, "Baby space and creator contract")


if __name__ == "__main__":
    asyncio.run(run_migration())
