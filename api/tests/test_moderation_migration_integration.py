"""PostgreSQL coverage for migration 022's moderation invariants."""

import importlib
import os

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.moderation import verify_moderation_schema

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@pytest.mark.asyncio
async def test_moderation_preflight_reports_missing_schema_cleanly():
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.execute(text("""
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name VARCHAR(128) NOT NULL
                )
            """))
            await connection.execute(text("""
                INSERT INTO schema_migrations (version, name)
                VALUES (22, 'incomplete_admin_moderation')
            """))

        with pytest.raises(RuntimeError, match="missing or incomplete"):
            await verify_moderation_schema(
                async_sessionmaker(engine, expire_on_commit=False)
            )
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()


@pytest.mark.asyncio
async def test_moderation_migration_is_idempotent_and_enforces_safety(monkeypatch):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.execute(text("""
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name VARCHAR(128) NOT NULL
                )
            """))
            await connection.execute(text("""
                CREATE TABLE app_users (id VARCHAR(64) PRIMARY KEY)
            """))
            await connection.execute(text("""
                CREATE TABLE recipes (id UUID PRIMARY KEY)
            """))

        migration = importlib.import_module("migrations.022_add_admin_moderation")
        monkeypatch.setattr(migration, "engine", engine)
        await migration.run_migration()
        await migration.run_migration()
        await verify_moderation_schema(async_sessionmaker(engine, expire_on_commit=False))

        async with engine.begin() as connection:
            await connection.execute(text("""
                INSERT INTO app_users (id) VALUES ('reporter'), ('contributor')
            """))
            await connection.execute(text("""
                INSERT INTO recipes (id, is_featured, featured_order)
                VALUES ('11111111-1111-4111-8111-111111111111', TRUE, 1)
            """))
            await connection.execute(text("""
                INSERT INTO content_reports (
                    id, reporter_user_id, target_type, recipe_id, category
                ) VALUES (
                    '21111111-1111-4111-8111-111111111111',
                    'reporter',
                    'recipe',
                    '11111111-1111-4111-8111-111111111111',
                    'spam'
                )
            """))
            await connection.execute(text("""
                INSERT INTO admin_audit_events (
                    id, actor_user_id, action, target_type, target_id, reason
                ) VALUES (
                    '31111111-1111-4111-8111-111111111111',
                    'admin',
                    'recipe_moderation_updated',
                    'recipe',
                    '11111111-1111-4111-8111-111111111111',
                    'Confirmed policy violation'
                )
            """))

        async with engine.connect() as connection:
            transaction = await connection.begin()
            with pytest.raises(IntegrityError):
                await connection.execute(text("""
                    INSERT INTO recipes (id, is_featured, featured_order)
                    VALUES ('12111111-1111-4111-8111-111111111111', TRUE, 1)
                """))
            await transaction.rollback()

        async with engine.begin() as connection:
            await connection.execute(text("""
                DELETE FROM recipes
                WHERE id = '11111111-1111-4111-8111-111111111111'
            """))
            retained_target = await connection.scalar(text("""
                SELECT recipe_id FROM content_reports
                WHERE id = '21111111-1111-4111-8111-111111111111'
            """))
            assert retained_target is None

        async with engine.connect() as connection:
            transaction = await connection.begin()
            with pytest.raises(IntegrityError):
                await connection.execute(text("""
                    INSERT INTO user_blocks (id, blocker_user_id, blocked_user_id)
                    VALUES (
                        '41111111-1111-4111-8111-111111111111',
                        'reporter',
                        'reporter'
                    )
                """))
            await transaction.rollback()

        async with engine.connect() as connection:
            transaction = await connection.begin()
            with pytest.raises(DBAPIError, match="append-only"):
                await connection.execute(text("""
                    UPDATE admin_audit_events SET reason = 'Changed reason'
                    WHERE id = '31111111-1111-4111-8111-111111111111'
                """))
            await transaction.rollback()

        async with engine.connect() as connection:
            marker = await connection.scalar(text("""
                SELECT COUNT(*) FROM schema_migrations WHERE version = 22
            """))
            trigger = await connection.scalar(text("""
                SELECT COUNT(*) FROM pg_trigger
                WHERE tgname = 'admin_audit_events_append_only' AND NOT tgisinternal
            """))
            assert marker == 1
            assert trigger == 1
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
