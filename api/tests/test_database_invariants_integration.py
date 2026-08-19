"""PostgreSQL coverage for migration 020 and concurrent version allocation."""

import asyncio
import importlib
import os
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database_invariants import verify_database_invariants
from app.models.recipe import Recipe, RecipeVersion
from app.routers.recipes import create_recipe_version

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


SCHEMA_SQL = """
CREATE TABLE app_users (id VARCHAR(64) PRIMARY KEY);
CREATE TABLE recipes (
    id UUID PRIMARY KEY,
    source_url TEXT NOT NULL,
    source_type VARCHAR(32) NOT NULL DEFAULT 'website',
    extracted JSONB NOT NULL DEFAULT '{}'::jsonb,
    user_id VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE saved_recipes (
    id UUID PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE
);
CREATE TABLE collections (id UUID PRIMARY KEY, user_id VARCHAR(64) NOT NULL);
CREATE TABLE recipe_notes (
    id UUID PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE
);
CREATE TABLE recipe_versions (
    id UUID PRIMARY KEY,
    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    extracted JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE extraction_jobs (id UUID PRIMARY KEY, user_id VARCHAR(64));
CREATE TABLE meal_plan_entries (
    id UUID PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE
);
CREATE TABLE grocery_lists (id UUID PRIMARY KEY);
CREATE TABLE grocery_list_members (
    list_id UUID REFERENCES grocery_lists(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL,
    PRIMARY KEY (list_id, user_id)
);
CREATE TABLE grocery_items (id UUID PRIMARY KEY, user_id VARCHAR(64) NOT NULL);
CREATE TABLE grocery_list_invites (
    id UUID PRIMARY KEY,
    created_by VARCHAR(64) NOT NULL,
    accepted_by VARCHAR(64)
);
"""


@pytest.mark.asyncio
async def test_migration_is_idempotent_and_enforces_logical_records(monkeypatch):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    recipe_one = UUID("11111111-1111-4111-8111-111111111111")
    recipe_two = UUID("22222222-2222-4222-8222-222222222222")

    try:
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
            for statement in SCHEMA_SQL.split(";"):
                if statement.strip():
                    await conn.execute(text(statement))
            await conn.execute(
                text("""
                    INSERT INTO recipes (id, source_url, user_id, created_at)
                    VALUES
                      (:one, 'https://youtu.be/abcDEF_1234?si=one', 'owner', NOW() - INTERVAL '1 day'),
                      (:two, 'https://www.youtube.com/watch?v=abcDEF_1234&utm_source=two', 'owner', NOW())
                """),
                {"one": recipe_one, "two": recipe_two},
            )
            await conn.execute(text("""
                INSERT INTO saved_recipes (id, user_id, recipe_id) VALUES
                  ('31111111-1111-4111-8111-111111111111', 'saver', :recipe),
                  ('32222222-2222-4222-8222-222222222222', 'saver', :recipe)
            """).bindparams(recipe=recipe_one))
            await conn.execute(text("""
                INSERT INTO recipe_versions (
                    id, recipe_id, version_number, extracted, created_by
                ) VALUES
                  (
                    '41111111-1111-4111-8111-111111111111',
                    :recipe,
                    1,
                    '{"title":"Original"}'::jsonb,
                    'owner'
                  ),
                  (
                    '42222222-2222-4222-8222-222222222222',
                    :recipe,
                    1,
                    '{"title":"Concurrent edit"}'::jsonb,
                    'owner'
                  )
            """).bindparams(recipe=recipe_one))

        migration = importlib.import_module("migrations.020_add_database_invariants")
        monkeypatch.setattr(migration, "engine", engine)
        await migration.run_migration()
        async with engine.begin() as conn:
            await conn.execute(text("""
                INSERT INTO recipes (id, source_url, user_id)
                VALUES (
                  '23333333-3333-4333-8333-333333333333',
                  'https://example.com/new-after-rollback?utm_source=test',
                  'owner'
                )
            """))
        await migration.run_migration()
        await verify_database_invariants(async_sessionmaker(engine, expire_on_commit=False))

        async with engine.connect() as conn:
            keys = (
                await conn.execute(text("""
                    SELECT canonical_source_key FROM recipes ORDER BY id
                """))
            ).scalars().all()
            save_count = await conn.scalar(text("SELECT COUNT(*) FROM saved_recipes"))
            versions = (
                await conn.execute(text("""
                    SELECT version_number, extracted->>'title' AS title
                    FROM recipe_versions
                    ORDER BY version_number
                """))
            ).all()
            migration_count = await conn.scalar(
                text("SELECT COUNT(*) FROM schema_migrations WHERE version = 20")
            )
            validated_owner_constraints = await conn.scalar(text("""
                SELECT COUNT(*)
                FROM pg_constraint
                WHERE conname LIKE 'fk_%_app_users' AND convalidated
            """))

        assert keys.count("youtube:video:abcDEF_1234") == 1
        assert keys.count(None) == 1
        assert len([key for key in keys if key is not None]) == 2
        assert save_count == 1
        assert versions == [(1, "Original"), (2, "Concurrent edit")]
        assert migration_count == 1
        assert validated_owner_constraints == 11
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await engine.dispose()


@pytest.mark.asyncio
async def test_recipe_version_snapshots_refresh_after_waiting_for_lock():
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    recipe_id = UUID("51111111-1111-4111-8111-111111111111")

    try:
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
            await conn.execute(text("""
                CREATE TABLE recipes (
                    id UUID PRIMARY KEY,
                    source_url TEXT NOT NULL,
                    canonical_source_key VARCHAR(96),
                    source_type VARCHAR(32) NOT NULL,
                    raw_text TEXT,
                    extracted JSONB NOT NULL,
                    original_extracted JSONB,
                    thumbnail_url TEXT,
                    extraction_method VARCHAR(32),
                    extraction_quality VARCHAR(16),
                    has_audio_transcript BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    user_id VARCHAR(64),
                    extractor_display_name VARCHAR(100),
                    is_public BOOLEAN NOT NULL DEFAULT FALSE,
                    total_minutes INTEGER
                )
            """))
            await conn.execute(text("""
                CREATE TABLE recipe_versions (
                    id UUID PRIMARY KEY,
                    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
                    version_number INTEGER NOT NULL,
                    extracted JSONB NOT NULL,
                    thumbnail_url TEXT,
                    change_type VARCHAR(32) NOT NULL DEFAULT 'edit',
                    change_summary TEXT,
                    created_by VARCHAR(64),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE (recipe_id, version_number)
                )
            """))
            await conn.execute(
                text("""
                    INSERT INTO recipes (id, source_url, source_type, extracted)
                    VALUES (
                      :id,
                      'manual://test',
                      'manual',
                      '{"title":"Initial"}'::jsonb
                    )
                """),
                {"id": recipe_id},
            )

        async with sessions() as first_session, sessions() as second_session:
            first_recipe, stale_second_recipe = await asyncio.gather(
                first_session.get(Recipe, recipe_id),
                second_session.get(Recipe, recipe_id),
            )
            assert first_recipe and stale_second_recipe
            first_locked = asyncio.Event()

            async def first_edit() -> None:
                await create_recipe_version(
                    first_session,
                    first_recipe,
                    "edit",
                    "owner",
                    change_summary="First edit",
                )
                first_recipe.extracted = {"title": "First edit"}
                first_locked.set()
                await asyncio.sleep(0.1)
                await first_session.commit()

            async def second_edit() -> None:
                await first_locked.wait()
                await create_recipe_version(
                    second_session,
                    stale_second_recipe,
                    "edit",
                    "owner",
                    change_summary="Second edit",
                )
                stale_second_recipe.extracted = {"title": "Second edit"}
                await second_session.commit()

            await asyncio.gather(first_edit(), second_edit())

        async with sessions() as session:
            versions = (
                await session.execute(
                    select(RecipeVersion).order_by(RecipeVersion.version_number)
                )
            ).scalars().all()
            final_recipe = await session.get(Recipe, recipe_id)

        assert [version.version_number for version in versions] == [1, 2]
        assert [version.extracted["title"] for version in versions] == [
            "Initial",
            "First edit",
        ]
        assert final_recipe and final_recipe.extracted["title"] == "Second edit"
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
