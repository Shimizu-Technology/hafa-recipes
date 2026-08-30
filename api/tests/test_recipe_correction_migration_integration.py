"""Focused PostgreSQL coverage for migration 027's privacy-safe event table."""

import importlib
import os
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from tests.database_safety import require_disposable_test_database

migration_027 = importlib.import_module("migrations.027_add_recipe_correction_events")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@pytest.mark.asyncio
async def test_migration_027_is_idempotent_and_enforces_aggregate_contract(monkeypatch):
    """Replay 027 and reject content-shaped or invalid aggregate records."""

    assert TEST_DATABASE_URL
    require_disposable_test_database(TEST_DATABASE_URL)
    engine = create_async_engine(TEST_DATABASE_URL)
    recipe_id = uuid4()
    event_id = uuid4()
    try:
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
                text("INSERT INTO schema_migrations (version, name) VALUES (26, 'prior')")
            )
            await connection.execute(text("""
                CREATE TABLE app_users (id VARCHAR(64) PRIMARY KEY)
            """))
            await connection.execute(text("""
                CREATE TABLE recipes (id UUID PRIMARY KEY)
            """))
            await connection.execute(
                text("INSERT INTO app_users (id) VALUES ('stable_user')")
            )
            await connection.execute(
                text("INSERT INTO recipes (id) VALUES (:recipe_id)"),
                {"recipe_id": recipe_id},
            )

        monkeypatch.setattr(migration_027, "engine", engine)
        await migration_027.run_migration()
        await migration_027.run_migration()

        valid_values = {
            "id": event_id,
            "recipe_id": recipe_id,
            "user_id": "stable_user",
            "event_kind": "review_correction",
            "source_type": "youtube",
            "from_review_state": "needs_review",
            "to_review_state": "ready",
            "content_revision": 2,
            "changed_field_count": 1,
            "ingredient_name_change_count": 0,
            "quantity_change_count": 1,
            "unit_change_count": 0,
            "ingredient_note_change_count": 0,
            "step_change_count": 0,
            "time_change_count": 0,
            "title_changed": False,
            "servings_changed": False,
            "other_change_count": 0,
            "resolved_missing_quantity_count": 1,
        }
        insert_sql = text("""
            INSERT INTO recipe_correction_events (
                id, recipe_id, user_id, event_kind, source_type,
                from_review_state, to_review_state, content_revision,
                changed_field_count, ingredient_name_change_count,
                quantity_change_count, unit_change_count,
                ingredient_note_change_count, step_change_count,
                time_change_count, title_changed, servings_changed,
                other_change_count, resolved_missing_quantity_count
            ) VALUES (
                :id, :recipe_id, :user_id, :event_kind, :source_type,
                :from_review_state, :to_review_state, :content_revision,
                :changed_field_count, :ingredient_name_change_count,
                :quantity_change_count, :unit_change_count,
                :ingredient_note_change_count, :step_change_count,
                :time_change_count, :title_changed, :servings_changed,
                :other_change_count, :resolved_missing_quantity_count
            )
        """)
        async with engine.begin() as connection:
            await connection.execute(insert_sql, valid_values)
            columns = (
                await connection.execute(text("""
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'recipe_correction_events'
                """))
            ).scalars().all()
            marker = await connection.scalar(text("""
                SELECT COUNT(*) FROM schema_migrations WHERE version = 27
            """))

            with pytest.raises(IntegrityError):
                async with connection.begin_nested():
                    await connection.execute(
                        insert_sql,
                        {**valid_values, "id": uuid4(), "changed_field_count": -1},
                    )
            with pytest.raises(IntegrityError):
                async with connection.begin_nested():
                    await connection.execute(
                        insert_sql,
                        {**valid_values, "id": uuid4(), "event_kind": "raw_diff"},
                    )

            await connection.execute(
                text("DELETE FROM recipes WHERE id = :recipe_id"),
                {"recipe_id": recipe_id},
            )
            remaining = await connection.scalar(
                text("SELECT COUNT(*) FROM recipe_correction_events")
            )

        assert marker == 1
        assert remaining == 0
        assert {
            "extracted",
            "raw_text",
            "before_value",
            "after_value",
            "field_path",
        }.isdisjoint(columns)
    finally:
        require_disposable_test_database(TEST_DATABASE_URL)
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
