"""Migration 030: owner-scoped retry IDs for saving extracted captures."""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine

settings = get_settings()


def _require_production_restore_point(*, migration_already_applied: bool) -> None:
    """Require a verified restore reference before the first production write."""
    if settings.environment != "production" or migration_already_applied:
        return
    if not (settings.migration_030_restore_point or "").strip():
        raise RuntimeError(
            "MIGRATION_030_RESTORE_POINT must name a verified production restore "
            "point before migration 030 can run"
        )


async def run_migration() -> None:
    """Add nullable capture receipts without rewriting existing recipe rows."""
    async with engine.begin() as connection:
        prior_ready = await connection.scalar(text("""
            SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 29)
        """))
        if not prior_ready:
            raise RuntimeError("Migration 029 must run before migration 030")
        applied = await connection.scalar(text("""
            SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 30)
        """))
        _require_production_restore_point(migration_already_applied=bool(applied))
        if applied:
            return
        await connection.execute(text("""
            ALTER TABLE recipes ADD COLUMN IF NOT EXISTS capture_id UUID,
                ADD COLUMN IF NOT EXISTS capture_request_hash VARCHAR(64)
        """))
        await connection.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conrelid = 'recipes'::regclass
                    AND conname = 'uq_recipes_owner_capture'
                ) THEN
                    ALTER TABLE recipes ADD CONSTRAINT uq_recipes_owner_capture
                        UNIQUE (user_id, capture_id);
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conrelid = 'recipes'::regclass
                    AND conname = 'ck_recipes_capture_identity'
                ) THEN
                    ALTER TABLE recipes ADD CONSTRAINT ck_recipes_capture_identity CHECK (
                        (capture_id IS NULL AND capture_request_hash IS NULL) OR
                        (capture_id IS NOT NULL AND user_id IS NOT NULL
                         AND capture_request_hash IS NOT NULL AND length(capture_request_hash) = 64)
                    );
                END IF;
            END $$
        """))
        await connection.execute(text("""
            INSERT INTO schema_migrations (version, name)
            VALUES (30, 'capture save idempotency')
        """))
    print("Capture save idempotency ready")


if __name__ == "__main__":
    asyncio.run(run_migration())
