"""Migration 024: scoped, revocable grocery-widget credentials."""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.database import engine


async def run_migration() -> None:
    async with engine.begin() as conn:
        migration_023_ready = await conn.scalar(text("""
            SELECT EXISTS (
                SELECT 1 FROM schema_migrations WHERE version = 23
            )
        """))
        if not migration_023_ready:
            raise RuntimeError("Migration 023 must run before migration 024")

        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS grocery_widget_credentials (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                app_user_id VARCHAR(64) NOT NULL,
                list_id UUID NOT NULL,
                installation_hash VARCHAR(64) NOT NULL,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                scope VARCHAR(64) NOT NULL
                    DEFAULT 'grocery:read grocery:set_checked',
                issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                last_used_at TIMESTAMPTZ,
                revoked_at TIMESTAMPTZ,
                CONSTRAINT fk_grocery_widget_credentials_user
                    FOREIGN KEY (app_user_id)
                    REFERENCES app_users(id) ON DELETE CASCADE,
                CONSTRAINT fk_grocery_widget_credentials_list
                    FOREIGN KEY (list_id)
                    REFERENCES grocery_lists(id) ON DELETE CASCADE,
                CONSTRAINT uq_grocery_widget_credential_user_installation
                    UNIQUE (app_user_id, installation_hash),
                CONSTRAINT ck_grocery_widget_credentials_scope
                    CHECK (scope = 'grocery:read grocery:set_checked'),
                CONSTRAINT ck_grocery_widget_credentials_expiry
                    CHECK (expires_at > issued_at)
            )
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_grocery_widget_credentials_app_user_id
            ON grocery_widget_credentials (app_user_id)
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_grocery_widget_credentials_list_id
            ON grocery_widget_credentials (list_id)
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_grocery_widget_credentials_expires_at
            ON grocery_widget_credentials (expires_at)
        """))
        await conn.execute(text("""
            INSERT INTO schema_migrations (version, name)
            VALUES (24, 'scoped grocery widget credentials')
            ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name
        """))

    print("Grocery widget credential schema ready")


if __name__ == "__main__":
    asyncio.run(run_migration())
