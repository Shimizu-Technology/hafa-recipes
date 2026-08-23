"""Migration 025: persist versioned public-recipe disclosure acceptance."""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.database import engine


async def run_migration() -> None:
    async with engine.begin() as conn:
        migration_024_ready = await conn.scalar(text("""
            SELECT EXISTS (
                SELECT 1 FROM schema_migrations WHERE version = 24
            )
        """))
        if not migration_024_ready:
            raise RuntimeError("Migration 024 must run before migration 025")

        await conn.execute(text("""
            ALTER TABLE app_users
            ADD COLUMN IF NOT EXISTS publishing_disclosure_version INTEGER
                NOT NULL DEFAULT 0
        """))
        await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_app_users_publishing_disclosure_version'
                ) THEN
                    ALTER TABLE app_users
                    ADD CONSTRAINT ck_app_users_publishing_disclosure_version
                    CHECK (publishing_disclosure_version >= 0);
                END IF;
            END $$
        """))
        await conn.execute(text("""
            INSERT INTO schema_migrations (version, name)
            VALUES (25, 'versioned publishing disclosure')
            ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name
        """))

    print("Publishing disclosure schema ready")


if __name__ == "__main__":
    asyncio.run(run_migration())
