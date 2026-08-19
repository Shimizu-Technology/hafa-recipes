"""PostgreSQL coverage for the durable extraction queue migration."""

import importlib
import os
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@pytest.mark.asyncio
async def test_durable_queue_migration_upgrades_legacy_rows_idempotently(monkeypatch):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    recipe_id = UUID("11111111-1111-4111-8111-111111111111")
    completed_job_id = UUID("22222222-2222-4222-8222-222222222222")
    retry_job_id = UUID("33333333-3333-4333-8333-333333333333")
    reextract_job_id = UUID("44444444-4444-4444-8444-444444444444")
    orphan_job_id = UUID("55555555-5555-4555-8555-555555555555")

    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.execute(text("""
                CREATE TABLE recipes (
                    id UUID PRIMARY KEY,
                    user_id VARCHAR(64),
                    source_url TEXT NOT NULL,
                    is_public BOOLEAN NOT NULL DEFAULT FALSE,
                    extractor_display_name VARCHAR(100)
                )
            """))
            await connection.execute(text("""
                CREATE TABLE extraction_jobs (
                    id UUID PRIMARY KEY,
                    url TEXT NOT NULL,
                    location TEXT NOT NULL DEFAULT 'Guam',
                    notes TEXT NOT NULL DEFAULT '',
                    status VARCHAR(16) NOT NULL DEFAULT 'processing',
                    progress INTEGER NOT NULL DEFAULT 0,
                    current_step VARCHAR(32) NOT NULL DEFAULT 'initializing',
                    message TEXT NOT NULL DEFAULT 'Starting extraction...',
                    estimated_duration INTEGER NOT NULL DEFAULT 60,
                    recipe_id UUID REFERENCES recipes(id),
                    error_message TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    completed_at TIMESTAMPTZ,
                    CONSTRAINT extraction_jobs_url_unique UNIQUE (url)
                )
            """))
            await connection.execute(
                text("""
                    INSERT INTO recipes (
                        id, user_id, source_url, is_public, extractor_display_name
                    ) VALUES (
                        :id, 'stable_user', 'https://example.com/recipe', FALSE, 'Chef'
                    )
                """),
                {"id": recipe_id},
            )
            await connection.execute(
                text("""
                    INSERT INTO extraction_jobs (id, url, status, recipe_id)
                    VALUES
                        (:completed_id, 'https://example.com/completed', 'processing', :recipe_id),
                        (:retry_id, 'https://example.com/retry', 'processing', NULL),
                        (:reextract_id, :reextract_url, 'processing', NULL),
                        (:orphan_id, :orphan_url, 'processing', NULL)
                """),
                {
                    "completed_id": completed_job_id,
                    "retry_id": retry_job_id,
                    "reextract_id": reextract_job_id,
                    "orphan_id": orphan_job_id,
                    "recipe_id": recipe_id,
                    "reextract_url": f"re-extract:{recipe_id}",
                    "orphan_url": "re-extract:66666666-6666-4666-8666-666666666666",
                },
            )

        migration = importlib.import_module("migrations.018_add_durable_extraction_jobs")
        monkeypatch.setattr(migration, "engine", engine)
        await migration.run_migration()
        await migration.run_migration()

        async with engine.connect() as connection:
            rows = (
                await connection.execute(text("""
                    SELECT id, status, user_id, job_kind, error_code, target_recipe_id
                    FROM extraction_jobs
                    ORDER BY id
                """))
            ).mappings().all()
            columns = set(
                (
                    await connection.execute(text("""
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'extraction_jobs'
                    """))
                ).scalars().all()
            )
            indexes = set(
                (
                    await connection.execute(text("""
                        SELECT indexname
                        FROM pg_indexes
                        WHERE schemaname = 'public'
                          AND tablename = 'extraction_jobs'
                    """))
                ).scalars().all()
            )
            obsolete_url_constraint = await connection.scalar(text("""
                SELECT COUNT(*)
                FROM pg_constraint
                WHERE conrelid = 'extraction_jobs'::regclass
                  AND conname IN ('extraction_jobs_url_unique', 'extraction_jobs_url_key')
            """))

        by_id = {row["id"]: row for row in rows}
        assert by_id[completed_job_id]["status"] == "completed"
        assert by_id[completed_job_id]["user_id"] == "stable_user"
        assert by_id[retry_job_id]["error_code"] == "MIGRATION_RETRY_REQUIRED"
        assert by_id[reextract_job_id]["status"] == "queued"
        assert by_id[reextract_job_id]["job_kind"] == "reextract"
        assert by_id[reextract_job_id]["target_recipe_id"] == recipe_id
        assert by_id[reextract_job_id]["user_id"] == "stable_user"
        assert by_id[orphan_job_id]["error_code"] == "MIGRATION_TARGET_MISSING"
        assert {
            "user_id",
            "lease_token",
            "idempotency_key",
            "requested_is_public",
            "target_recipe_id",
        }.issubset(columns)
        assert {
            "uq_extraction_jobs_active_user_url",
            "uq_extraction_jobs_user_idempotency",
            "ix_extraction_jobs_claimable",
        }.issubset(indexes)
        assert obsolete_url_constraint == 0
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
