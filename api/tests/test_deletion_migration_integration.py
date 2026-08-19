"""PostgreSQL coverage for durable deletion cleanup migration 019."""

import importlib
import os

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@pytest.mark.asyncio
async def test_deletion_cleanup_migration_is_idempotent_and_constrained(monkeypatch):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))

        migration = importlib.import_module(
            "migrations.019_add_durable_deletion_cleanup"
        )
        monkeypatch.setattr(migration, "engine", engine)
        await migration.run_migration()
        await migration.run_migration()

        async with engine.connect() as connection:
            tables = set(
                (
                    await connection.execute(text("""
                        SELECT table_name
                        FROM information_schema.tables
                        WHERE table_schema = 'public'
                    """))
                ).scalars().all()
            )
            indexes = set(
                (
                    await connection.execute(text("""
                        SELECT indexname
                        FROM pg_indexes
                        WHERE schemaname = 'public'
                          AND tablename = 'deletion_cleanup_jobs'
                    """))
                ).scalars().all()
            )
            await connection.execute(text("""
                INSERT INTO deletion_cleanup_jobs (kind, app_user_id)
                VALUES ('account', 'stable_user')
            """))
            await connection.commit()

        assert {
            "deletion_cleanup_jobs",
            "deleted_auth_identities",
        }.issubset(tables)
        assert {
            "ix_deletion_cleanup_jobs_claimable",
            "uq_deletion_cleanup_account_user",
        }.issubset(indexes)

        async with engine.begin() as connection:
            with pytest.raises(IntegrityError):
                await connection.execute(text("""
                    INSERT INTO deletion_cleanup_jobs (kind, app_user_id)
                    VALUES ('account', 'stable_user')
                """))
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
