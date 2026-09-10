"""Capture receipt migration preserves legacy rows and enforces owner scoping."""

import importlib
import os
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

migration = importlib.import_module("migrations.030_add_capture_save_idempotency")
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


def test_first_production_capture_migration_requires_restore_point(monkeypatch):
    monkeypatch.setattr(migration, "settings", SimpleNamespace(
        environment="production", migration_030_restore_point=None,
    ))
    with pytest.raises(RuntimeError, match="MIGRATION_030_RESTORE_POINT"):
        migration._require_production_restore_point(migration_already_applied=False)
    migration._require_production_restore_point(migration_already_applied=True)
    migration.settings.migration_030_restore_point = "verified-pre-rollout-snapshot"
    migration._require_production_restore_point(migration_already_applied=False)


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL required")
@pytest.mark.asyncio
async def test_capture_migration_preserves_rows_and_enforces_retry_constraints(monkeypatch):
    assert TEST_DATABASE_URL
    schema = f"capture_migration_{uuid4().hex}"
    admin = create_async_engine(TEST_DATABASE_URL)
    engine = create_async_engine(
        TEST_DATABASE_URL, connect_args={"server_settings": {"search_path": schema}}
    )
    old_id, capture_id = uuid4(), uuid4()
    async with admin.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        async with engine.begin() as connection:
            await connection.execute(text("""
                CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)
            """))
            await connection.execute(text("INSERT INTO schema_migrations VALUES (29, 'prior')"))
            await connection.execute(text("""
                CREATE TABLE recipes (
                    id UUID PRIMARY KEY, user_id TEXT, is_public BOOLEAN NOT NULL,
                    extracted JSONB NOT NULL
                )
            """))
            await connection.execute(text("""
                INSERT INTO recipes VALUES (:id, 'old_owner', FALSE, '{"title":"Old recipe"}')
            """), {"id": old_id})
        monkeypatch.setattr(migration, "engine", engine)
        monkeypatch.setattr(migration, "settings", SimpleNamespace(
            environment="production", migration_030_restore_point=None,
        ))
        with pytest.raises(RuntimeError, match="MIGRATION_030_RESTORE_POINT"):
            await migration.run_migration()
        async with engine.connect() as connection:
            assert await connection.scalar(text("""
                SELECT COUNT(*) FROM information_schema.columns
                WHERE table_schema = :schema AND table_name = 'recipes' AND column_name = 'capture_id'
            """), {"schema": schema}) == 0
        migration.settings.migration_030_restore_point = "verified-test-restore-point"
        await migration.run_migration()
        # Subsequent startups need neither another schema change nor another guard.
        migration.settings.migration_030_restore_point = None
        await migration.run_migration()
        async with engine.begin() as connection:
            old = (await connection.execute(text("""
                SELECT user_id, is_public, extracted, capture_id, capture_request_hash
                FROM recipes WHERE id = :id
            """), {"id": old_id})).one()
            assert tuple(old) == ("old_owner", False, {"title": "Old recipe"}, None, None)
            insert = text("""
                INSERT INTO recipes (id, user_id, is_public, extracted, capture_id, capture_request_hash)
                VALUES (:id, :owner, FALSE, '{}', :capture, :hash)
            """)
            for owner in ("owner_one", "owner_two"):
                await connection.execute(insert, {
                    "id": uuid4(), "owner": owner, "capture": capture_id, "hash": "a" * 64,
                })
            for owner, key, fingerprint in [
                ("owner_one", capture_id, "a" * 64),
                (None, uuid4(), "a" * 64),
                ("owner_three", uuid4(), None),
                ("owner_three", None, "a" * 64),
                ("owner_three", uuid4(), "short"),
            ]:
                with pytest.raises(IntegrityError):
                    async with connection.begin_nested():
                        await connection.execute(insert, {
                            "id": uuid4(), "owner": owner, "capture": key, "hash": fingerprint,
                        })
            assert await connection.scalar(text("""
                SELECT COUNT(*) FROM schema_migrations WHERE version = 30
            """)) == 1
    finally:
        await engine.dispose()
        async with admin.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()
