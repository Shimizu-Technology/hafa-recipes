"""Optional private Baby domain. Additive and isolated from Recipes metadata."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine
from app.domains.baby.models import BABY_TABLES
from app.domains.baby.runtime import schema_complete


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not getattr(configured, "baby_api_enabled", False):
        return
    async with (migration_engine or engine).begin() as connection:
        await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340051)"))
        if not await connection.scalar(
            text(
                "SELECT to_regclass('public.schema_migrations') IS NOT NULL AND to_regclass('public.app_users') IS NOT NULL AND to_regclass('public.deletion_cleanup_jobs') IS NOT NULL"
            )
        ):
            raise RuntimeError(
                "Shared identity, cleanup and migration baseline must precede Baby050"
            )
        recorded = await connection.scalar(
            text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=50)")
        )
        if recorded:
            if not await schema_complete(connection):
                raise RuntimeError("Baby migration050 schema does not match the recorded migration")
            return
        restore = os.environ.get("MIGRATION_050_RESTORE_POINT", "").strip()
        if (
            (configured.environment == "production" and not restore)
            or len(restore) > 160
            or any(ord(char) < 32 for char in restore)
        ):
            raise RuntimeError("MIGRATION_050_RESTORE_POINT must name a verified restore point")
        await connection.run_sync(
            lambda sync: BABY_TABLES[0].metadata.create_all(sync, tables=list(BABY_TABLES))
        )
        if not await schema_complete(connection):
            raise RuntimeError("Baby schema verification failed")
        await connection.execute(
            text(
                "INSERT INTO schema_migrations(version,name) VALUES (50,'private Baby domain') ON CONFLICT(version) DO NOTHING"
            )
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
