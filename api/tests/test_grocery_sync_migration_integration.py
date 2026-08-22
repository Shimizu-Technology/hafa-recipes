"""PostgreSQL coverage for migration 023's conflict-stopping behavior."""

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


async def _create_legacy_grocery_schema(engine) -> None:
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.execute(text("CREATE TABLE app_users (id VARCHAR(64) PRIMARY KEY)"))
        await connection.execute(text("CREATE TABLE grocery_lists (id UUID PRIMARY KEY)"))
        await connection.execute(text("""
            CREATE TABLE grocery_list_members (
                list_id UUID NOT NULL REFERENCES grocery_lists(id),
                user_id VARCHAR(64) NOT NULL REFERENCES app_users(id),
                PRIMARY KEY (list_id, user_id)
            )
        """))


@pytest.mark.asyncio
async def test_migration_stops_without_rewriting_duplicate_memberships(monkeypatch):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        await _create_legacy_grocery_schema(engine)
        async with engine.begin() as connection:
            await connection.execute(text("INSERT INTO app_users (id) VALUES ('duplicate')"))
            await connection.execute(text("""
                INSERT INTO grocery_lists (id) VALUES
                    ('11111111-1111-4111-8111-111111111111'),
                    ('22222222-2222-4222-8222-222222222222')
            """))
            await connection.execute(text("""
                INSERT INTO grocery_list_members (list_id, user_id) VALUES
                    ('11111111-1111-4111-8111-111111111111', 'duplicate'),
                    ('22222222-2222-4222-8222-222222222222', 'duplicate')
            """))

        migration = importlib.import_module("migrations.023_add_grocery_sync_contract")
        monkeypatch.setattr(migration, "engine", engine)
        with pytest.raises(RuntimeError, match="belong to multiple lists"):
            await migration.run_migration()

        async with engine.connect() as connection:
            memberships = await connection.scalar(
                text("SELECT COUNT(*) FROM grocery_list_members")
            )
            revision_exists = await connection.scalar(text("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'grocery_lists' AND column_name = 'revision'
                )
            """))
        assert memberships == 2
        assert revision_exists is False
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()


@pytest.mark.asyncio
async def test_migration_upgrades_legacy_schema_idempotently_and_cascades_receipts(
    monkeypatch,
):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        await _create_legacy_grocery_schema(engine)
        migration = importlib.import_module("migrations.023_add_grocery_sync_contract")
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
                          AND table_name = 'grocery_mutation_receipts'
                    """))
                ).scalars().all()
            )
            constraints = set(
                (
                    await connection.execute(text("""
                        SELECT conname
                        FROM pg_constraint
                        WHERE conrelid = 'grocery_mutation_receipts'::regclass
                    """))
                ).scalars().all()
            )
            membership_index = await connection.scalar(text("""
                SELECT COUNT(*)
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname = 'uq_grocery_list_members_user_id'
                  AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
            """))
            marker = await connection.scalar(
                text("SELECT COUNT(*) FROM schema_migrations WHERE version = 23")
            )
            await connection.execute(text("INSERT INTO app_users (id) VALUES ('owner')"))
            await connection.execute(text("""
                INSERT INTO grocery_lists (id, revision)
                VALUES ('11111111-1111-4111-8111-111111111111', 0)
            """))
            await connection.execute(text("""
                INSERT INTO grocery_mutation_receipts (
                    list_id, mutation_id, actor_user_id, operation, request_hash
                ) VALUES (
                    '11111111-1111-4111-8111-111111111111',
                    '22222222-2222-4222-8222-222222222222',
                    'owner', 'add', :request_hash
                )
            """), {"request_hash": "a" * 64})
            await connection.execute(text("""
                DELETE FROM grocery_lists
                WHERE id = '11111111-1111-4111-8111-111111111111'
            """))
            remaining_receipts = await connection.scalar(
                text("SELECT COUNT(*) FROM grocery_mutation_receipts")
            )

        assert columns == {
            "list_id",
            "mutation_id",
            "actor_user_id",
            "operation",
            "request_hash",
            "created_at",
        }
        assert {
            "pk_grocery_mutation_receipts",
            "fk_grocery_mutation_receipts_list",
            "fk_grocery_mutation_receipts_actor",
            "ck_grocery_mutation_receipts_operation",
        }.issubset(constraints)
        assert membership_index == 1
        assert marker == 1
        assert remaining_receipts == 0
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
