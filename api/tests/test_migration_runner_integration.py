"""PostgreSQL replay coverage for the complete active migration chain."""

import importlib
import os
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.database import Base
from app.models import ai, deletion, grocery, identity, meal_plan, moderation, recipe  # noqa: F401
from migrations import run as migration_runner

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@pytest.mark.asyncio
async def test_active_chain_replays_on_current_base_schema(monkeypatch):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            await connection.run_sync(Base.metadata.create_all)
            await connection.execute(
                text("INSERT INTO app_users (id) VALUES ('migration_runner_user')")
            )

        development = SimpleNamespace(
            is_development=True,
            issuer="https://development.clerk.example.test",
        )
        for module_name in migration_runner.ACTIVE_MIGRATIONS:
            migration = importlib.import_module(module_name)
            monkeypatch.setattr(migration, "engine", engine)
            if module_name.endswith("016_add_stable_clerk_identities"):
                monkeypatch.setattr(
                    migration,
                    "get_settings",
                    lambda: SimpleNamespace(clerk_environments=(development,)),
                )

        await migration_runner.run_migrations()
        await migration_runner.run_migrations()

        async with engine.connect() as connection:
            marker = await connection.scalar(
                text("""
                    SELECT COUNT(*) FROM schema_migrations
                    WHERE version = :latest_version
                """),
                {"latest_version": migration_runner.LATEST_MIGRATION},
            )
            identity = await connection.scalar(text("""
                SELECT COUNT(*) FROM clerk_identities
                WHERE app_user_id = 'migration_runner_user'
            """))

        assert marker == 1
        assert identity == 1
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
