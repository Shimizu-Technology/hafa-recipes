"""Add opt-in numeric plan servings; legacy plans and clients remain unchanged."""

import asyncio
import os
import re

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine


async def run_migration(*, configured=None, migration_engine=None):
    configured = configured or get_settings()
    async with (migration_engine or engine).begin() as db:
        await db.execute(text("SET LOCAL lock_timeout = '5s'"))
        await db.execute(text("SELECT pg_advisory_xact_lock(7340053)"))
        restore = os.environ.get("MIGRATION_053_RESTORE_POINT", "").strip()
        if len(restore) > 160 or any(ord(char) < 32 for char in restore):
            raise RuntimeError("Invalid migration053 restore point")
        if configured.environment == "production" and not restore:
            raise RuntimeError("MIGRATION_053_RESTORE_POINT must name a verified restore point")
        await db.execute(
            text("ALTER TABLE meal_plan_entries ADD COLUMN IF NOT EXISTS planned_servings INTEGER")
        )
        column = (
            await db.execute(
                text("""
            SELECT format_type(atttypid,atttypmod),attnotnull,atthasdef FROM pg_attribute
            WHERE attrelid='meal_plan_entries'::regclass AND attname='planned_servings' AND NOT attisdropped
        """)
            )
        ).one()
        if tuple(column) != ("integer", False, False):
            raise RuntimeError(
                "Migration053 schema drift: expected nullable INTEGER without a default"
            )
        name = "ck_meal_plan_entries_planned_servings"
        constraint = await db.scalar(
            text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='meal_plan_entries'::regclass AND conname=:name"
            ),
            {"name": name},
        )
        if constraint is None:
            await db.execute(
                text(
                    f"ALTER TABLE meal_plan_entries ADD CONSTRAINT {name} CHECK (planned_servings BETWEEN 1 AND 1000) NOT VALID"
                )
            )
        elif re.sub(r'[\s()"]', "", constraint).upper() not in {
            "CHECKPLANNED_SERVINGS>=1ANDPLANNED_SERVINGS<=1000",
            "CHECKPLANNED_SERVINGS>=1ANDPLANNED_SERVINGS<=1000NOTVALID",
        }:
            raise RuntimeError("Migration053 schema drift: unexpected servings constraint")
        await db.execute(text(f"ALTER TABLE meal_plan_entries VALIDATE CONSTRAINT {name}"))
        await db.execute(
            text(
                "INSERT INTO schema_migrations(version,name) VALUES(53,'explicit plan servings') ON CONFLICT(version) DO NOTHING"
            )
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
