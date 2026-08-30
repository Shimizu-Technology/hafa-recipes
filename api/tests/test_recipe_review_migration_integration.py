"""Focused PostgreSQL coverage for migration 026's database contract."""

import importlib
import os
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from tests.database_safety import require_disposable_test_database

migration_026 = importlib.import_module("migrations.026_add_recipe_review_state")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@pytest.mark.asyncio
async def test_migration_026_adds_defaults_and_constraints_to_pre_026_schema(monkeypatch):
    """Replay migration 026 twice and prove its write-time invariants."""

    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    recipe_id = uuid4()
    try:
        require_disposable_test_database(TEST_DATABASE_URL)
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.execute(text("""
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL
                )
            """))
            await connection.execute(
                text("INSERT INTO schema_migrations (version, name) VALUES (25, 'prior')")
            )
            await connection.execute(text("""
                CREATE TABLE recipes (
                    id UUID PRIMARY KEY,
                    source_url TEXT NOT NULL,
                    source_type VARCHAR(32) NOT NULL,
                    extracted JSONB NOT NULL,
                    is_public BOOLEAN NOT NULL DEFAULT FALSE
                )
            """))
            await connection.execute(text("""
                CREATE TABLE recipe_versions (
                    id UUID PRIMARY KEY,
                    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
                    extracted JSONB NOT NULL
                )
            """))

        monkeypatch.setattr(migration_026, "engine", engine)
        await migration_026.run_migration()
        await migration_026.run_migration()

        async with engine.begin() as connection:
            await connection.execute(
                text("""
                    INSERT INTO recipes (id, source_url, source_type, extracted)
                    VALUES (:id, 'manual://migration-test', 'manual', '{}'::jsonb)
                """),
                {"id": recipe_id},
            )
            revision = await connection.scalar(
                text("SELECT content_revision FROM recipes WHERE id = :id"),
                {"id": recipe_id},
            )
            constraint_count = await connection.scalar(text("""
                SELECT COUNT(*) FROM pg_constraint
                WHERE conname IN (
                    'ck_recipes_review_state',
                    'ck_recipes_content_revision',
                    'ck_recipes_review_public',
                    'ck_recipe_versions_review_state',
                    'ck_recipe_versions_content_revision'
                )
            """))

            with pytest.raises(IntegrityError):
                async with connection.begin_nested():
                    await connection.execute(
                        text("UPDATE recipes SET review_state = 'invalid' WHERE id = :id"),
                        {"id": recipe_id},
                    )
            with pytest.raises(IntegrityError):
                async with connection.begin_nested():
                    await connection.execute(
                        text("""
                            UPDATE recipes
                            SET review_state = 'needs_review', is_public = TRUE
                            WHERE id = :id
                        """),
                        {"id": recipe_id},
                    )
            with pytest.raises(IntegrityError):
                async with connection.begin_nested():
                    await connection.execute(
                        text("UPDATE recipes SET content_revision = 0 WHERE id = :id"),
                        {"id": recipe_id},
                    )

        assert revision == 1
        assert constraint_count == 5
    finally:
        require_disposable_test_database(TEST_DATABASE_URL)
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
