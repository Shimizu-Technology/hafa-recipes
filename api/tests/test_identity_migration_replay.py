"""The historical identity backfill must stay safe after production onboarding."""

import importlib
import os
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.database import Base
from app.models import ai, deletion, grocery, identity, meal_plan, moderation, recipe  # noqa: F401
from app.models.identity import AppUser, ClerkIdentity
from app.models.recipe import Recipe

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)
migration = importlib.import_module("migrations.016_add_stable_clerk_identities")
DEVELOPMENT_ISSUER = "https://development.clerk.example.test"
PRODUCTION_ISSUER = "https://production.clerk.example.test"


@pytest.fixture
async def identity_replay_database(monkeypatch):
    assert TEST_DATABASE_URL
    schema = f"identity_replay_{uuid4().hex}"
    admin = create_async_engine(TEST_DATABASE_URL)
    engine = create_async_engine(
        TEST_DATABASE_URL, connect_args={"server_settings": {"search_path": schema}}
    )
    async with admin.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        monkeypatch.setattr(migration, "engine", engine)
        monkeypatch.setattr(migration, "get_settings", lambda: SimpleNamespace(
            clerk_environments=(SimpleNamespace(
                is_development=True, issuer=DEVELOPMENT_ISSUER,
            ),),
        ))
        yield engine
    finally:
        await engine.dispose()
        async with admin.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("has_existing_development_alias", [False, True])
async def test_rerun_preserves_production_only_and_existing_mapped_owners(
    identity_replay_database, has_existing_development_alias,
):
    engine = identity_replay_database
    # Initially only legacy development owners exist when migration016 runs.
    async with engine.begin() as connection:
        await connection.execute(AppUser.__table__.insert(), [{"id": "legacy_owner"}])
    await migration.run_migration()

    production_owner = f"app_{uuid4().hex}"
    existing_mapped_owner = f"app_{uuid4().hex}"
    unlinked_production_owner = f"app_{uuid4().hex}"
    legacy_near_match = f"legacy_app_{uuid4().hex}_suffix"
    production_alias_id, mapped_alias_id = uuid4(), uuid4()
    recipe_id = uuid4()
    async with engine.begin() as connection:
        await connection.execute(AppUser.__table__.insert(), [
            {"id": production_owner}, {"id": existing_mapped_owner},
            {"id": unlinked_production_owner}, {"id": "new_legacy_owner"},
            {"id": legacy_near_match},
        ])
        aliases = [
            {"id": production_alias_id, "app_user_id": production_owner,
             "issuer": PRODUCTION_ISSUER, "clerk_user_id": "user_production_reviewer"},
        ]
        if has_existing_development_alias:
            aliases.append({
                "id": mapped_alias_id, "app_user_id": existing_mapped_owner,
                "issuer": DEVELOPMENT_ISSUER, "clerk_user_id": "user_existing_real_subject",
            })
        await connection.execute(ClerkIdentity.__table__.insert(), aliases)
        await connection.execute(Recipe.__table__.insert(), [{
            "id": recipe_id, "user_id": production_owner, "is_public": False,
            "source_type": "manual", "source_url": "manual://replay-test",
            "extracted": {"title": "Preserve my recipe"},
        }])
        before_aliases = (await connection.execute(select(
            ClerkIdentity.id, ClerkIdentity.app_user_id, ClerkIdentity.issuer,
            ClerkIdentity.clerk_user_id,
        ))).all()

    # Every later deployment reruns the whole migration chain.
    await migration.run_migration()
    await migration.run_migration()

    async with engine.connect() as connection:
        after_aliases = (await connection.execute(select(
            ClerkIdentity.id, ClerkIdentity.app_user_id, ClerkIdentity.issuer,
            ClerkIdentity.clerk_user_id,
        ))).all()
        assert set(before_aliases).issubset(set(after_aliases))
        assert len(after_aliases) == len(before_aliases) + 2
        expected_development = {
            ("legacy_owner", "legacy_owner"), ("new_legacy_owner", "new_legacy_owner"),
            (legacy_near_match, legacy_near_match),
        }
        if has_existing_development_alias:
            expected_development.add((existing_mapped_owner, "user_existing_real_subject"))
        assert {(row.app_user_id, row.clerk_user_id) for row in after_aliases
                if row.issuer == DEVELOPMENT_ISSUER} == expected_development
        assert (await connection.execute(select(
            Recipe.user_id, Recipe.is_public, Recipe.extracted,
        ).where(Recipe.id == recipe_id))).one() == (
            production_owner, False, {"title": "Preserve my recipe"},
        )
        assert set((await connection.execute(select(AppUser.id))).scalars()) == {
            "legacy_owner", "new_legacy_owner", production_owner,
            existing_mapped_owner, unlinked_production_owner,
            legacy_near_match,
        }
