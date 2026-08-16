"""PostgreSQL coverage for the constraints used by concurrent authentication."""

import asyncio
import importlib
import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.auth as auth
import app.clerk_transition as transition
from app.auth import VerifiedClerkToken, _attach_identity, _resolve_identity
from app.clerk_transition import provision_production
from app.config import ClerkEnvironment, Settings
from app.models.identity import AppUser, ClerkIdentity
from app.services.clerk import ClerkProfile

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@pytest.fixture
async def identity_database():
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.run_sync(ClerkIdentity.__table__.drop, checkfirst=True)
        await connection.run_sync(AppUser.__table__.drop, checkfirst=True)
        await connection.run_sync(AppUser.__table__.create)
        await connection.run_sync(ClerkIdentity.__table__.create)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield sessions
    finally:
        async with engine.begin() as connection:
            await connection.run_sync(ClerkIdentity.__table__.drop, checkfirst=True)
            await connection.run_sync(AppUser.__table__.drop, checkfirst=True)
        await engine.dispose()


@pytest.mark.asyncio
async def test_two_issuers_resolve_to_one_stable_owner_without_rewriting(
    identity_database,
):
    async with identity_database() as db:
        development = await _attach_identity(
            db,
            app_user_id="user_development",
            issuer="https://development.clerk.accounts.dev",
            clerk_user_id="user_development",
            allow_create_user=True,
        )
        production = await _attach_identity(
            db,
            app_user_id="user_development",
            issuer="https://clerk.hafa-recipes.com",
            clerk_user_id="user_production",
            allow_create_user=False,
        )

        assert development is not None
        assert production is not None
        assert development.app_user_id == production.app_user_id == "user_development"


@pytest.mark.asyncio
async def test_concurrent_identity_attachment_is_idempotent(identity_database):
    async with identity_database() as setup:
        setup.add(AppUser(id="stable_user"))
        await setup.commit()

    async def attach():
        async with identity_database() as db:
            identity = await _attach_identity(
                db,
                app_user_id="stable_user",
                issuer="https://clerk.hafa-recipes.com",
                clerk_user_id="user_production",
                allow_create_user=False,
            )
            return identity is not None

    assert await asyncio.gather(attach(), attach()) == [True, True]
    async with identity_database() as db:
        count = await db.scalar(select(func.count()).select_from(ClerkIdentity))
        assert count == 1


@pytest.mark.asyncio
async def test_subject_cannot_attach_to_two_stable_users(identity_database):
    async with identity_database() as db:
        db.add_all([AppUser(id="stable_one"), AppUser(id="stable_two")])
        await db.commit()
        first = await _attach_identity(
            db,
            app_user_id="stable_one",
            issuer="https://clerk.hafa-recipes.com",
            clerk_user_id="user_production",
            allow_create_user=False,
        )
        second = await _attach_identity(
            db,
            app_user_id="stable_two",
            issuer="https://clerk.hafa-recipes.com",
            clerk_user_id="user_production",
            allow_create_user=False,
        )

        assert first is not None
        assert second is None


def _production_settings() -> Settings:
    return Settings(
        database_url="postgresql://test:test@localhost/test",
        openai_api_key="test-openai-key",
        clerk_production_issuer="https://clerk.hafa-recipes.com",
        clerk_production_secret_key="sk_live_test",
    )


@pytest.mark.asyncio
async def test_unknown_production_subject_requires_and_uses_stable_external_id(
    identity_database,
    monkeypatch,
):
    profile = ClerkProfile(
        clerk_user_id="user_production",
        email="chef@example.com",
        email_verified=True,
        first_name="Test",
        last_name="Chef",
        external_id="stable_user",
    )

    class ProfileClient:
        def __init__(self, _environment):
            pass

        async def get_user(self, _clerk_user_id):
            return profile

    monkeypatch.setattr(auth, "settings", _production_settings())
    monkeypatch.setattr(auth, "ClerkBackendClient", ProfileClient)
    token = VerifiedClerkToken(
        subject="user_production",
        issuer="https://clerk.hafa-recipes.com",
        environment_name="production",
        claims={},
    )
    async with identity_database() as db:
        db.add(AppUser(id="stable_user"))
        await db.commit()

        identity, resolved_profile = await _resolve_identity(db, token)

        assert identity.app_user_id == "stable_user"
        assert resolved_profile == profile


@pytest.mark.asyncio
async def test_unknown_production_subject_without_external_id_is_forbidden(
    identity_database,
    monkeypatch,
):
    profile = ClerkProfile(
        clerk_user_id="user_production",
        email="chef@example.com",
        email_verified=True,
        first_name=None,
        last_name=None,
        external_id=None,
    )

    class ProfileClient:
        def __init__(self, _environment):
            pass

        async def get_user(self, _clerk_user_id):
            return profile

    monkeypatch.setattr(auth, "settings", _production_settings())
    monkeypatch.setattr(auth, "ClerkBackendClient", ProfileClient)
    token = VerifiedClerkToken(
        subject="user_production",
        issuer="https://clerk.hafa-recipes.com",
        environment_name="production",
        claims={},
    )
    async with identity_database() as db:
        db.add(AppUser(id="stable_user"))
        await db.commit()

        with pytest.raises(HTTPException) as error:
            await _resolve_identity(db, token)

        assert error.value.status_code == 403


def _clerk_environment(name: str) -> ClerkEnvironment:
    issuer = (
        "https://development.clerk.accounts.dev"
        if name == "development"
        else "https://clerk.hafa-recipes.com"
    )
    return ClerkEnvironment(
        name=name,
        issuer=issuer,
        secret_key=f"secret-{name}",
        jwks_url=f"{issuer}/.well-known/jwks.json",
        audience=None,
        authorized_parties=(),
    )


@pytest.mark.asyncio
async def test_provisioner_requires_a_valid_development_alias(
    identity_database,
    monkeypatch,
):
    development = _clerk_environment("development")
    production = _clerk_environment("production")
    development_profile = ClerkProfile(
        clerk_user_id="stable_user",
        email="chef@example.com",
        email_verified=True,
        first_name=None,
        last_name=None,
        external_id=None,
    )

    class InventoryClient:
        def __init__(self, environment):
            self.environment = environment

        async def list_users(self):
            return [development_profile] if self.environment.is_development else []

    monkeypatch.setattr(transition, "ClerkBackendClient", InventoryClient)
    async with identity_database() as db:
        db.add(AppUser(id="stable_user"))
        await db.commit()

        results = await provision_production(
            db,
            development,
            production,
            apply=False,
        )

        assert [(result.status, result.detail) for result in results] == [
            ("missing", "development identity alias is missing")
        ]


@pytest.mark.asyncio
async def test_provisioner_attaches_existing_production_user_idempotently(
    identity_database,
    monkeypatch,
):
    development = _clerk_environment("development")
    production = _clerk_environment("production")
    development_profile = ClerkProfile(
        clerk_user_id="stable_user",
        email="chef@example.com",
        email_verified=True,
        first_name="Test",
        last_name="Chef",
        external_id=None,
    )
    production_profile = ClerkProfile(
        clerk_user_id="production_user",
        email="chef@example.com",
        email_verified=True,
        first_name="Test",
        last_name="Chef",
        external_id="stable_user",
    )

    class InventoryClient:
        def __init__(self, environment):
            self.environment = environment

        async def list_users(self):
            return (
                [development_profile]
                if self.environment.is_development
                else [production_profile]
            )

    monkeypatch.setattr(transition, "ClerkBackendClient", InventoryClient)
    async with identity_database() as db:
        db.add(AppUser(id="stable_user"))
        db.add(
            ClerkIdentity(
                app_user_id="stable_user",
                issuer=development.issuer,
                clerk_user_id="stable_user",
            )
        )
        await db.commit()

        first = await provision_production(
            db,
            development,
            production,
            apply=True,
        )
        second = await provision_production(
            db,
            development,
            production,
            apply=True,
        )

        assert [result.status for result in first] == ["attached"]
        assert [result.status for result in second] == ["unchanged"]


@pytest.mark.asyncio
async def test_migration_backfills_all_owners_without_rewriting_them(monkeypatch):
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    source_columns = {
        "recipes": "user_id",
        "saved_recipes": "user_id",
        "collections": "user_id",
        "recipe_notes": "user_id",
        "recipe_versions": "created_by",
        "extraction_jobs": "user_id",
        "meal_plan_entries": "user_id",
        "grocery_list_members": "user_id",
        "grocery_items": "user_id",
        "grocery_list_invites": "created_by VARCHAR(64), accepted_by",
    }
    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
            for table_name, column_definition in source_columns.items():
                await connection.execute(
                    text(
                        f"CREATE TABLE {table_name} "
                        f"({column_definition} VARCHAR(64))"
                    )
                )
            await connection.execute(
                text("INSERT INTO recipes (user_id) VALUES ('user_one'), (NULL)")
            )
            await connection.execute(
                text("INSERT INTO saved_recipes (user_id) VALUES ('user_one')")
            )
            await connection.execute(
                text(
                    "INSERT INTO grocery_list_invites (created_by, accepted_by) "
                    "VALUES ('user_two', 'user_one')"
                )
            )

        migration = importlib.import_module(
            "migrations.016_add_stable_clerk_identities"
        )
        environment = SimpleNamespace(
            is_development=True,
            issuer="https://development.clerk.accounts.dev",
        )
        monkeypatch.setattr(migration, "engine", engine)
        monkeypatch.setattr(
            migration,
            "get_settings",
            lambda: SimpleNamespace(clerk_environments=(environment,)),
        )

        await migration.run_migration()
        await migration.run_migration()

        grant_migration = importlib.import_module(
            "migrations.017_add_clerk_migration_grants"
        )
        monkeypatch.setattr(grant_migration, "engine", engine)
        await grant_migration.run_migration()
        await grant_migration.run_migration()

        async with engine.connect() as connection:
            users = (
                await connection.execute(text("SELECT id FROM app_users ORDER BY id"))
            ).scalars().all()
            identities = (
                await connection.execute(
                    text(
                        "SELECT app_user_id, clerk_user_id FROM clerk_identities "
                        "ORDER BY app_user_id"
                    )
                )
            ).all()
            recipe_owners = (
                await connection.execute(
                    text("SELECT user_id FROM recipes ORDER BY user_id NULLS LAST")
                )
            ).scalars().all()
            grants_table_exists = await connection.scalar(
                text(
                    "SELECT to_regclass('public.clerk_migration_grants') "
                    "IS NOT NULL"
                )
            )

        assert users == ["user_one", "user_two"]
        assert identities == [
            ("user_one", "user_one"),
            ("user_two", "user_two"),
        ]
        assert recipe_owners == ["user_one", None]
        assert grants_table_exists is True
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()
