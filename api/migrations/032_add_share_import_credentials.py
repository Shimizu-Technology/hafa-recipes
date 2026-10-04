"""Migration 032: scoped native sharing capabilities and durable captures."""

import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db.database import engine

settings = get_settings()


def _require_restore_point(*, applied: bool):
    if settings.environment == "production" and not applied:
        if not (settings.migration_032_restore_point or "").strip():
            raise RuntimeError(
                "MIGRATION_032_RESTORE_POINT must name a verified production restore point"
            )


async def run_migration():
    async with engine.begin() as conn:
        prior = await conn.scalar(
            text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 31)")
        )
        if not prior:
            raise RuntimeError("Migration 031 must run before migration 032")
        applied = await conn.scalar(
            text("SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 32)")
        )
        _require_restore_point(applied=bool(applied))
        if applied:
            return
        await conn.execute(
            text("""
            CREATE TABLE IF NOT EXISTS share_import_credentials (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                app_user_id VARCHAR(64) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
                installation_hash VARCHAR(64) NOT NULL,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                scope VARCHAR(32) NOT NULL DEFAULT 'recipe:import_link',
                location VARCHAR(100) NOT NULL DEFAULT 'Guam',
                is_public BOOLEAN NOT NULL DEFAULT FALSE,
                display_name VARCHAR(200) NOT NULL,
                issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                revoked_at TIMESTAMPTZ,
                CONSTRAINT uq_share_import_installation UNIQUE(app_user_id, installation_hash),
                CONSTRAINT ck_share_import_scope CHECK(scope = 'recipe:import_link'),
                CONSTRAINT ck_share_import_expiry CHECK(expires_at > issued_at)
            )
        """)
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_share_import_credentials_app_user_id ON share_import_credentials(app_user_id)"
            )
        )
        await conn.execute(
            text("""
            CREATE TABLE IF NOT EXISTS share_import_receipts (
                app_user_id VARCHAR(64) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
                capture_id UUID NOT NULL,
                url VARCHAR(2048) NOT NULL,
                job_id UUID,
                recipe_id UUID,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY(app_user_id, capture_id)
            )
        """)
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_share_import_receipts_created_at ON share_import_receipts(created_at)"
            )
        )
        await conn.execute(
            text(
                "INSERT INTO schema_migrations(version,name) VALUES (32,'native share import credentials') ON CONFLICT(version) DO NOTHING"
            )
        )


if __name__ == "__main__":
    asyncio.run(run_migration())
