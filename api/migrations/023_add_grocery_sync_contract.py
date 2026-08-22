"""Migration 023: durable, replay-safe grocery synchronization contract."""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.database import engine


async def run_migration() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name VARCHAR(160) NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))

        duplicate_memberships = await conn.scalar(text("""
            SELECT COUNT(*)
            FROM (
                SELECT user_id
                FROM grocery_list_members
                GROUP BY user_id
                HAVING COUNT(*) > 1
            ) AS duplicate_users
        """))
        if duplicate_memberships:
            raise RuntimeError(
                "Migration 023 stopped: grocery users belong to multiple lists; "
                "resolve the invariant conflict before retrying"
            )

        await conn.execute(text("""
            ALTER TABLE grocery_lists
            ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0
        """))
        await conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_grocery_list_members_user_id
            ON grocery_list_members (user_id)
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS grocery_mutation_receipts (
                list_id UUID NOT NULL,
                mutation_id UUID NOT NULL,
                actor_user_id VARCHAR(64) NOT NULL,
                operation VARCHAR(24) NOT NULL,
                request_hash VARCHAR(64) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT pk_grocery_mutation_receipts
                    PRIMARY KEY (list_id, mutation_id),
                CONSTRAINT fk_grocery_mutation_receipts_list
                    FOREIGN KEY (list_id) REFERENCES grocery_lists(id) ON DELETE CASCADE,
                CONSTRAINT fk_grocery_mutation_receipts_actor
                    FOREIGN KEY (actor_user_id) REFERENCES app_users(id) ON DELETE CASCADE,
                CONSTRAINT ck_grocery_mutation_receipts_operation
                    CHECK (operation IN ('add', 'update', 'set_checked', 'delete'))
            )
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_grocery_mutation_receipts_actor_user_id
            ON grocery_mutation_receipts (actor_user_id)
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_grocery_mutation_receipts_created_at
            ON grocery_mutation_receipts (created_at)
        """))
        await conn.execute(text("""
            INSERT INTO schema_migrations (version, name)
            VALUES (23, 'durable grocery synchronization contract')
            ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name
        """))

    print("Durable grocery synchronization schema ready")


if __name__ == "__main__":
    asyncio.run(run_migration())
