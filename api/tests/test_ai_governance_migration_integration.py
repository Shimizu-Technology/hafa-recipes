"""PostgreSQL coverage for migration 021 and provenance lifecycle."""

import importlib
import os

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.ai_governance import verify_ai_governance_schema

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration coverage",
)


@pytest.mark.asyncio
@pytest.mark.parametrize("precreate_partial_table", [False, True])
async def test_ai_provenance_migration_is_idempotent_repairs_and_cascades_user_data(
    monkeypatch,
    precreate_partial_table,
):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
            await conn.execute(
                text("""
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name VARCHAR(160) NOT NULL,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            )
            await conn.execute(text("CREATE TABLE app_users (id VARCHAR(64) PRIMARY KEY)"))
            await conn.execute(
                text("""
                CREATE TABLE extraction_jobs (
                    id UUID PRIMARY KEY,
                    user_id VARCHAR(64) REFERENCES app_users(id) ON DELETE CASCADE
                )
            """)
            )
            await conn.execute(text("INSERT INTO app_users (id) VALUES ('owner')"))
            await conn.execute(
                text("""
                INSERT INTO extraction_jobs (id, user_id)
                VALUES ('11111111-1111-4111-8111-111111111111', 'owner')
            """)
            )
            if precreate_partial_table:
                await conn.execute(
                    text("""
                    CREATE TABLE ai_invocations (
                        id UUID PRIMARY KEY,
                        request_id VARCHAR(64),
                        user_id VARCHAR(64),
                        job_id UUID,
                        CONSTRAINT legacy_ai_user_fk
                            FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
                        CONSTRAINT legacy_ai_job_fk
                            FOREIGN KEY (job_id) REFERENCES extraction_jobs(id) ON DELETE SET NULL
                    )
                """)
                )

        migration = importlib.import_module("migrations.021_add_ai_invocation_provenance")
        monkeypatch.setattr(migration, "engine", engine)
        await migration.run_migration()
        await migration.run_migration()
        await verify_ai_governance_schema(async_sessionmaker(engine, expire_on_commit=False))

        async with engine.begin() as conn:
            await conn.execute(
                text("""
                INSERT INTO ai_invocations (
                    id, request_id, user_id, job_id, capability, provider,
                    model, prompt_version, schema_version, rollout_variant,
                    status, latency_ms
                ) VALUES (
                    '21111111-1111-4111-8111-111111111111', 'request', 'owner',
                    '11111111-1111-4111-8111-111111111111', 'ocr', 'openai',
                    'model', 'prompt-v1', 'schema-v1', 'primary', 'success', 50
                )
            """)
            )
            migration_count = await conn.scalar(
                text("SELECT COUNT(*) FROM schema_migrations WHERE version = 21")
            )
            column_count = await conn.scalar(
                text("""
                    SELECT COUNT(*)
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'ai_invocations'
                """)
            )
            await conn.execute(text("DELETE FROM app_users WHERE id = 'owner'"))
            remaining = await conn.scalar(text("SELECT COUNT(*) FROM ai_invocations"))

        assert migration_count == 1
        assert column_count == 21
        assert remaining == 0
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
