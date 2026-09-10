"""Production guard and PostgreSQL contract for advisory publication."""

import importlib
import os
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from tests.database_safety import require_disposable_test_database

migration = importlib.import_module("migrations.029_allow_advisory_recipe_publishing")
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


def test_first_production_migration_requires_verified_restore_point(monkeypatch):
    monkeypatch.setattr(migration, "settings", SimpleNamespace(
        environment="production", migration_029_restore_point=None,
    ))
    with pytest.raises(RuntimeError, match="MIGRATION_029_RESTORE_POINT"):
        migration._require_production_restore_point(migration_already_applied=False)
    migration._require_production_restore_point(migration_already_applied=True)
    migration.settings.migration_029_restore_point = "verified-neon-restore-point"
    migration._require_production_restore_point(migration_already_applied=False)


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL required")
@pytest.mark.asyncio
async def test_migration_preserves_visibility_and_only_relaxes_advisory_constraint(monkeypatch):
    assert TEST_DATABASE_URL
    require_disposable_test_database(TEST_DATABASE_URL)
    engine = create_async_engine(TEST_DATABASE_URL)
    recipe_id = uuid4()
    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.execute(text("""
                CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)
            """))
            await connection.execute(text("""
                INSERT INTO schema_migrations VALUES (28, 'prior')
            """))
            await connection.execute(text("""
                CREATE TABLE recipes (
                    id UUID PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    is_public BOOLEAN NOT NULL DEFAULT FALSE,
                    review_state TEXT,
                    CONSTRAINT ck_recipes_review_public CHECK (
                        review_state IS NULL OR review_state = 'ready' OR is_public = FALSE
                    )
                )
            """))
            await connection.execute(text("""
                INSERT INTO recipes VALUES (:id, 'stable-owner', FALSE, 'needs_review')
            """), {"id": recipe_id})
        monkeypatch.setattr(migration, "engine", engine)
        await migration.run_migration()
        await migration.run_migration()
        async with engine.begin() as connection:
            saved = (await connection.execute(text("""
                SELECT user_id, is_public, review_state FROM recipes WHERE id = :id
            """), {"id": recipe_id})).one()
            assert tuple(saved) == ("stable-owner", False, "needs_review")
            await connection.execute(text("""
                UPDATE recipes SET is_public = TRUE WHERE id = :id
            """), {"id": recipe_id})
            with pytest.raises(IntegrityError):
                async with connection.begin_nested():
                    await connection.execute(text("""
                        UPDATE recipes SET review_state = 'source_incomplete' WHERE id = :id
                    """), {"id": recipe_id})
    finally:
        require_disposable_test_database(TEST_DATABASE_URL)
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
