"""Add opt-in numeric plan servings; legacy plans and clients remain unchanged."""
import os

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    async with (migration_engine or engine).begin() as db:
        await db.execute(text("SET LOCAL lock_timeout = '5s'"))
        await db.execute(text("SELECT pg_advisory_xact_lock(7340053)"))
        if await db.scalar(text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=53)")):
            return
        restore = os.environ.get("MIGRATION_053_RESTORE_POINT", "").strip()
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("Invalid migration053 restore point")
        if configured.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_053_RESTORE_POINT must name a verified restore point")
        await db.execute(text("ALTER TABLE meal_plan_entries ADD COLUMN IF NOT EXISTS planned_servings INTEGER CHECK (planned_servings BETWEEN 1 AND 1000)"))
        await db.execute(text("INSERT INTO schema_migrations(version,name) VALUES(53,'explicit plan servings') ON CONFLICT(version) DO NOTHING"))
