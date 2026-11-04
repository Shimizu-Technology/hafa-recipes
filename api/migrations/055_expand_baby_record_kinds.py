"""Widen storage kinds atomically; request validation remains v1-only."""

import asyncio
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine

KINDS = (
    "source", "journal", "feeding", "sleep", "diaper", "routine", "question", "collection",
    "event", "contraction", "kick_session", "pumping", "medicine", "temperature", "growth",
    "milestone", "custom",
)


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    if not getattr(configured, "baby_api_enabled", False):
        return
    async with (migration_engine or engine).begin() as connection:
        await connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        await connection.execute(text("SELECT pg_advisory_xact_lock(7340051)"))
        if not await connection.scalar(text(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=52)"
        )):
            raise RuntimeError("Baby052 must precede Baby055")
        definition = await connection.scalar(text("""SELECT pg_get_constraintdef(oid)
            FROM pg_constraint WHERE conrelid='baby_records'::regclass
            AND conname='ck_baby_record_kind' AND contype='c' AND convalidated"""))
        recorded = await connection.scalar(text(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=55)"
        ))
        if recorded:
            if not definition or any("'" + kind + "'" not in definition for kind in KINDS):
                raise RuntimeError("Baby055 schema drift: record kinds constraint")
            return
        restore = os.environ.get("MIGRATION_055_RESTORE_POINT", "").strip()
        if ((configured.environment == "production" and not restore)
                or len(restore) > 160 or any(ord(char) < 32 for char in restore)):
            raise RuntimeError("MIGRATION_055_RESTORE_POINT must name a verified restore point")
        await connection.execute(text(
            "ALTER TABLE baby_records DROP CONSTRAINT ck_baby_record_kind"
        ))
        kinds = ",".join("'" + kind + "'" for kind in KINDS)
        await connection.execute(text(f"""ALTER TABLE baby_records
            ADD CONSTRAINT ck_baby_record_kind CHECK (kind IN ({kinds})) NOT VALID"""))
        await connection.execute(text(
            "ALTER TABLE baby_records VALIDATE CONSTRAINT ck_baby_record_kind"
        ))
        await connection.execute(text("""INSERT INTO schema_migrations(version,name)
            VALUES(55,'Baby record kinds') ON CONFLICT(version) DO NOTHING"""))


if __name__ == "__main__":
    asyncio.run(run_migration())
