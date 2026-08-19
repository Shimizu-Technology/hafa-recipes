"""Migration 019: durable external cleanup jobs and deleted-auth tombstones."""

import asyncio

from sqlalchemy import text

from app.db.database import engine


async def run_migration() -> None:
    """Create the idempotent account/recipe deletion cleanup schema."""
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS deletion_cleanup_jobs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                kind VARCHAR(16) NOT NULL,
                app_user_id VARCHAR(64) NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'queued',
                clerk_identities JSONB NOT NULL DEFAULT '[]'::jsonb,
                storage_prefixes JSONB NOT NULL DEFAULT '[]'::jsonb,
                clerk_target_count INTEGER NOT NULL DEFAULT 0,
                storage_prefix_count INTEGER NOT NULL DEFAULT 0,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 20,
                next_attempt_at TIMESTAMPTZ,
                lease_token VARCHAR(64),
                leased_until TIMESTAMPTZ,
                last_error TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                completed_at TIMESTAMPTZ,
                CONSTRAINT ck_deletion_cleanup_kind
                    CHECK (kind IN ('account', 'recipe')),
                CONSTRAINT ck_deletion_cleanup_status
                    CHECK (status IN ('queued', 'processing', 'completed', 'failed'))
            )
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_deletion_cleanup_jobs_app_user_id
            ON deletion_cleanup_jobs (app_user_id)
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_deletion_cleanup_jobs_claimable
            ON deletion_cleanup_jobs (status, next_attempt_at, created_at)
        """))
        await conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_deletion_cleanup_account_user
            ON deletion_cleanup_jobs (app_user_id)
            WHERE kind = 'account'
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS deleted_auth_identities (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                deletion_job_id UUID
                    REFERENCES deletion_cleanup_jobs(id) ON DELETE SET NULL,
                issuer VARCHAR(512) NOT NULL,
                clerk_user_id_hash VARCHAR(64) NOT NULL,
                deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_deleted_auth_identity_subject
                    UNIQUE (issuer, clerk_user_id_hash)
            )
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_deleted_auth_identities_job_id
            ON deleted_auth_identities (deletion_job_id)
        """))

        print("✓ Added durable deletion cleanup jobs and auth tombstones")


if __name__ == "__main__":
    asyncio.run(run_migration())
