"""Migration 031: additive household membership and durable pantry inventory."""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine

settings = get_settings()


def _require_restore_point(*, applied: bool) -> None:
    if settings.environment == "production" and not applied:
        if not (settings.migration_031_restore_point or "").strip():
            raise RuntimeError(
                "MIGRATION_031_RESTORE_POINT must name a verified production restore point"
            )


async def run_migration() -> None:
    async with engine.begin() as connection:
        prior_ready = await connection.scalar(
            text("SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 30)")
        )
        if not prior_ready:
            raise RuntimeError("Migration 030 must run before migration 031")
        applied = await connection.scalar(
            text("SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 31)")
        )
        _require_restore_point(applied=bool(applied))
        if applied:
            return

        statements = [
            "ALTER TABLE grocery_lists ADD COLUMN IF NOT EXISTS household_enabled BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE grocery_list_members ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'manager'",
            "ALTER TABLE grocery_list_invites ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ",
            """UPDATE grocery_lists AS lists SET household_enabled = TRUE
            WHERE EXISTS (
                SELECT 1 FROM grocery_list_members AS members
                WHERE members.list_id = lists.id
                GROUP BY members.list_id HAVING COUNT(*) > 1
            ) OR EXISTS (
                SELECT 1 FROM grocery_list_invites AS invites
                WHERE invites.list_id = lists.id
            )""",
            """UPDATE grocery_list_invites
            SET expires_at = created_at + INTERVAL '7 days'
            WHERE expires_at IS NULL""",
        ]
        for statement in statements:
            await connection.execute(text(statement))
        await connection.execute(
            text("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_grocery_list_member_role') THEN
                    ALTER TABLE grocery_list_members ADD CONSTRAINT ck_grocery_list_member_role
                        CHECK (role IN ('manager', 'member'));
                END IF;
            END $$;
        """)
        )
        await connection.execute(
            text("""
            CREATE TABLE IF NOT EXISTS pantry_spaces (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                kind VARCHAR(16) NOT NULL,
                owner_user_id VARCHAR(64) REFERENCES app_users(id) ON DELETE CASCADE,
                grocery_list_id UUID REFERENCES grocery_lists(id) ON DELETE CASCADE,
                revision BIGINT NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_pantry_spaces_owner UNIQUE (owner_user_id),
                CONSTRAINT uq_pantry_spaces_list UNIQUE (grocery_list_id),
                CONSTRAINT ck_pantry_space_scope CHECK (
                    (kind = 'personal' AND owner_user_id IS NOT NULL AND grocery_list_id IS NULL) OR
                    (kind = 'household' AND owner_user_id IS NULL AND grocery_list_id IS NOT NULL)
                )
            )
        """)
        )
        await connection.execute(
            text("""
            CREATE TABLE IF NOT EXISTS pantry_items (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                space_id UUID NOT NULL REFERENCES pantry_spaces(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                quantity NUMERIC(12,3),
                unit VARCHAR(50),
                location VARCHAR(50),
                date_kind VARCHAR(16),
                date_value DATE,
                notes VARCHAR(255),
                source_personal_item_id UUID,
                created_by_user_id VARCHAR(64) REFERENCES app_users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT ck_pantry_item_quantity CHECK (quantity IS NULL OR quantity >= 0),
                CONSTRAINT uq_pantry_copy_source UNIQUE (space_id, source_personal_item_id),
                CONSTRAINT ck_pantry_item_date CHECK (
                    (date_kind IS NULL AND date_value IS NULL) OR
                    (date_kind IN ('best_before', 'use_by') AND date_value IS NOT NULL)
                )
            )
        """)
        )
        await connection.execute(
            text("CREATE INDEX IF NOT EXISTS ix_pantry_items_space_id ON pantry_items(space_id)")
        )
        await connection.execute(
            text("""
            CREATE TABLE IF NOT EXISTS pantry_mutation_receipts (
                space_id UUID NOT NULL REFERENCES pantry_spaces(id) ON DELETE CASCADE,
                mutation_id UUID NOT NULL,
                actor_user_id VARCHAR(64) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
                operation VARCHAR(24) NOT NULL,
                request_hash VARCHAR(64) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT pk_pantry_mutation_receipts PRIMARY KEY (space_id, mutation_id),
                CONSTRAINT ck_pantry_mutation_operation CHECK (
                    operation IN ('add', 'update', 'delete', 'transfer', 'copy')
                )
            )
        """)
        )
        await connection.execute(
            text("""
            CREATE TABLE IF NOT EXISTS pantry_transfer_receipts (
                space_id UUID NOT NULL REFERENCES pantry_spaces(id) ON DELETE CASCADE,
                grocery_item_id UUID NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT pk_pantry_transfer_receipts PRIMARY KEY (space_id, grocery_item_id)
            )
        """)
        )
        await connection.execute(
            text("""
            CREATE TABLE IF NOT EXISTS pantry_copy_receipts (
                space_id UUID NOT NULL REFERENCES pantry_spaces(id) ON DELETE CASCADE,
                personal_item_id UUID NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT pk_pantry_copy_receipts PRIMARY KEY (space_id, personal_item_id)
            )
        """)
        )
        await connection.execute(
            text("""
            INSERT INTO schema_migrations (version, name)
            VALUES (31, 'household pantry')
            ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name
        """)
        )
    print("Household pantry schema ready")


if __name__ == "__main__":
    asyncio.run(run_migration())
