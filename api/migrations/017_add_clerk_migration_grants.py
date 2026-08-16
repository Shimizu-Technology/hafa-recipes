"""Migration 017: add one-use mobile Clerk migration grants.

Raw grants are never stored. The API retains only a SHA-256 digest and uses a
row lock to make redemption single-use. This migration is additive and
idempotent.
"""

import asyncio

from sqlalchemy import text

from app.db.database import engine


async def run_migration() -> None:
    async with engine.begin() as conn:
        app_users_exists = await conn.scalar(
            text("SELECT to_regclass('public.app_users') IS NOT NULL")
        )
        if not app_users_exists:
            raise RuntimeError("Migration 016 must run before migration 017")

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS clerk_migration_grants (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                app_user_id VARCHAR(64) NOT NULL
                    REFERENCES app_users(id) ON DELETE CASCADE,
                device_hash VARCHAR(64) NOT NULL,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                redeemed_at TIMESTAMPTZ,
                CONSTRAINT uq_clerk_migration_grant_user_device
                    UNIQUE (app_user_id, device_hash)
            )
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_clerk_migration_grants_app_user_id
            ON clerk_migration_grants (app_user_id)
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_clerk_migration_grants_expires_at
            ON clerk_migration_grants (expires_at)
        """))

        grant_count = await conn.scalar(
            text("SELECT COUNT(*) FROM clerk_migration_grants")
        )
        print(f"Clerk migration grant schema ready: grants={grant_count}")


if __name__ == "__main__":
    asyncio.run(run_migration())
