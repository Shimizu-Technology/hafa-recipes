"""PostgreSQL coverage for migration 024's credential boundary."""

import importlib
import os

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration coverage",
)


async def _create_prerequisite_schema(engine, *, mark_023: bool) -> None:
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.execute(text("""
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                name VARCHAR(160) NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await connection.execute(text("CREATE TABLE app_users (id VARCHAR(64) PRIMARY KEY)"))
        await connection.execute(text("CREATE TABLE grocery_lists (id UUID PRIMARY KEY)"))
        if mark_023:
            await connection.execute(text("""
                INSERT INTO schema_migrations (version, name)
                VALUES (23, 'durable grocery synchronization contract')
            """))


@pytest.mark.asyncio
async def test_widget_credential_migration_requires_grocery_sync_contract(monkeypatch):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        await _create_prerequisite_schema(engine, mark_023=False)
        migration = importlib.import_module(
            "migrations.024_add_grocery_widget_credentials"
        )
        monkeypatch.setattr(migration, "engine", engine)
        with pytest.raises(RuntimeError, match="Migration 023"):
            await migration.run_migration()
        async with engine.connect() as connection:
            table = await connection.scalar(text("""
                SELECT to_regclass('public.grocery_widget_credentials')
            """))
        assert table is None
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()


@pytest.mark.asyncio
async def test_widget_credential_migration_is_idempotent_and_cascades(monkeypatch):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        await _create_prerequisite_schema(engine, mark_023=True)
        migration = importlib.import_module(
            "migrations.024_add_grocery_widget_credentials"
        )
        monkeypatch.setattr(migration, "engine", engine)
        await migration.run_migration()
        await migration.run_migration()

        async with engine.begin() as connection:
            columns = set(
                (
                    await connection.execute(text("""
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'grocery_widget_credentials'
                    """))
                ).scalars().all()
            )
            constraints = set(
                (
                    await connection.execute(text("""
                        SELECT conname
                        FROM pg_constraint
                        WHERE conrelid = 'grocery_widget_credentials'::regclass
                    """))
                ).scalars().all()
            )
            marker = await connection.scalar(
                text("SELECT COUNT(*) FROM schema_migrations WHERE version = 24")
            )
            await connection.execute(text("INSERT INTO app_users (id) VALUES ('owner')"))
            await connection.execute(text("""
                INSERT INTO grocery_lists (id)
                VALUES ('11111111-1111-4111-8111-111111111111')
            """))
            await connection.execute(text("""
                INSERT INTO grocery_widget_credentials (
                    id, app_user_id, list_id, installation_hash, token_hash,
                    issued_at, expires_at
                ) VALUES (
                    '22222222-2222-4222-8222-222222222222',
                    'owner',
                    '11111111-1111-4111-8111-111111111111',
                    :installation_hash,
                    :token_hash,
                    NOW(),
                    NOW() + INTERVAL '90 days'
                )
            """), {"installation_hash": "a" * 64, "token_hash": "b" * 64})
            await connection.execute(text("DELETE FROM app_users WHERE id = 'owner'"))
            remaining = await connection.scalar(
                text("SELECT COUNT(*) FROM grocery_widget_credentials")
            )

        assert columns == {
            "id",
            "app_user_id",
            "list_id",
            "installation_hash",
            "token_hash",
            "scope",
            "issued_at",
            "expires_at",
            "last_used_at",
            "revoked_at",
        }
        assert {
            "grocery_widget_credentials_pkey",
            "fk_grocery_widget_credentials_user",
            "fk_grocery_widget_credentials_list",
            "uq_grocery_widget_credential_user_installation",
            "grocery_widget_credentials_token_hash_key",
            "ck_grocery_widget_credentials_scope",
            "ck_grocery_widget_credentials_expiry",
        }.issubset(constraints)
        assert marker == 1
        assert remaining == 0
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
