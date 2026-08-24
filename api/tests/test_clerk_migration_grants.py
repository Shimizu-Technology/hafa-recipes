"""PostgreSQL coverage for the one-use mobile Clerk migration handoff."""

import asyncio
import os
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.clerk_transition as transition
import app.routers.clerk_transition as handoff
from app.auth import ClerkUser
from app.config import Settings
from app.models.identity import AppUser, ClerkIdentity, ClerkMigrationGrant

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@pytest.fixture
async def handoff_database():
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.run_sync(ClerkMigrationGrant.__table__.drop, checkfirst=True)
        await connection.run_sync(ClerkIdentity.__table__.drop, checkfirst=True)
        await connection.run_sync(AppUser.__table__.drop, checkfirst=True)
        await connection.run_sync(AppUser.__table__.create)
        await connection.run_sync(ClerkIdentity.__table__.create)
        await connection.run_sync(ClerkMigrationGrant.__table__.create)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield sessions
    finally:
        async with engine.begin() as connection:
            await connection.run_sync(ClerkMigrationGrant.__table__.drop, checkfirst=True)
            await connection.run_sync(ClerkIdentity.__table__.drop, checkfirst=True)
            await connection.run_sync(AppUser.__table__.drop, checkfirst=True)
        await engine.dispose()


def _settings() -> Settings:
    return Settings(
        database_url="postgresql://test:test@localhost/test",
        openai_api_key="test-openai-key",
        clerk_development_issuer="https://development.clerk.accounts.dev",
        clerk_development_secret_key="development-secret",
        clerk_production_issuer="https://clerk.hafa-recipes.com",
        clerk_production_secret_key="production-secret",
    )


def _user(environment: str = "development") -> ClerkUser:
    return ClerkUser(
        id="stable_user",
        clerk_user_id="development_user" if environment == "development" else "production_user",
        clerk_issuer=(
            "https://development.clerk.accounts.dev"
            if environment == "development"
            else "https://clerk.hafa-recipes.com"
        ),
        clerk_environment=environment,
    )


def _create_payload() -> handoff.CreateMigrationGrantRequest:
    return handoff.CreateMigrationGrantRequest(
        installation_id="cmi_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN",
    )


def _credentials(grant: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=grant)


async def _seed_aliases(sessions) -> None:
    async with sessions() as db:
        db.add(AppUser(id="stable_user"))
        db.add_all(
            [
                ClerkIdentity(
                    app_user_id="stable_user",
                    issuer="https://development.clerk.accounts.dev",
                    clerk_user_id="development_user",
                ),
                ClerkIdentity(
                    app_user_id="stable_user",
                    issuer="https://clerk.hafa-recipes.com",
                    clerk_user_id="production_user",
                ),
            ]
        )
        await db.commit()


@pytest.mark.asyncio
async def test_bridge_adoption_report_returns_only_aggregate_coverage(
    handoff_database,
):
    now = datetime.now(timezone.utc)
    await _seed_aliases(handoff_database)

    async with handoff_database() as db:
        covered_identity = await db.scalar(
            select(ClerkIdentity).where(
                ClerkIdentity.app_user_id == "stable_user",
                ClerkIdentity.issuer == "https://development.clerk.accounts.dev",
            )
        )
        assert covered_identity is not None
        covered_identity.last_authenticated_at = now
        db.add(AppUser(id="uncovered_user"))
        db.add(
            ClerkIdentity(
                app_user_id="uncovered_user",
                issuer="https://development.clerk.accounts.dev",
                clerk_user_id="uncovered_development_user",
                last_authenticated_at=now,
            )
        )
        db.add(
            ClerkMigrationGrant(
                app_user_id="stable_user",
                device_hash="a" * 64,
                token_hash="b" * 64,
                created_at=now,
                expires_at=now + timedelta(days=30),
            )
        )
        await db.commit()

        summary = await transition.bridge_adoption_summary(
            db,
            development_issuer="https://development.clerk.accounts.dev",
            since=now - timedelta(days=1),
        )

    assert summary.active_users == 2
    assert summary.covered_users == 1
    assert summary.coverage_percent == 50.0


@pytest.mark.asyncio
async def test_development_session_creates_hash_at_rest_grant(
    handoff_database,
    monkeypatch,
):
    monkeypatch.setattr(handoff, "settings", _settings())
    await _seed_aliases(handoff_database)

    async with handoff_database() as db:
        response = await handoff.create_migration_grant(
            payload=_create_payload(),
            db=db,
            user=_user(),
        )
        stored = (await db.execute(select(ClerkMigrationGrant))).scalar_one()

    assert response.grant.startswith("cmg_")
    assert len(response.grant) >= 40
    assert stored.token_hash == handoff._hash_grant(response.grant)
    assert stored.device_hash == handoff._hash_grant(_create_payload().installation_id)
    assert response.grant not in stored.token_hash
    assert stored.redeemed_at is None
    assert response.expires_at > datetime.now(timezone.utc) + timedelta(days=89)


@pytest.mark.asyncio
async def test_same_installation_rotates_one_grant_row(
    handoff_database,
    monkeypatch,
):
    monkeypatch.setattr(handoff, "settings", _settings())
    await _seed_aliases(handoff_database)

    async with handoff_database() as db:
        first = await handoff.create_migration_grant(
            payload=_create_payload(),
            db=db,
            user=_user(),
        )
        second = await handoff.create_migration_grant(
            payload=_create_payload(),
            db=db,
            user=_user(),
        )
        rows = (await db.execute(select(ClerkMigrationGrant))).scalars().all()

    assert first.grant != second.grant
    assert len(rows) == 1
    assert rows[0].token_hash == handoff._hash_grant(second.grant)
    assert rows[0].token_hash != handoff._hash_grant(first.grant)


@pytest.mark.asyncio
async def test_concurrent_new_installations_cannot_bypass_per_user_cap(
    handoff_database,
    monkeypatch,
):
    monkeypatch.setattr(handoff, "settings", _settings())
    await _seed_aliases(handoff_database)
    now = datetime.now(timezone.utc)
    async with handoff_database() as db:
        for index in range(handoff.MAX_ACTIVE_GRANTS_PER_USER - 1):
            db.add(
                ClerkMigrationGrant(
                    app_user_id="stable_user",
                    device_hash=handoff._hash_grant(f"existing-device-{index}"),
                    token_hash=handoff._hash_grant(f"existing-grant-{index}"),
                    expires_at=now + timedelta(days=30),
                )
            )
        await db.commit()

    async def issue(suffix: str) -> int:
        async with handoff_database() as db:
            try:
                await handoff.create_migration_grant(
                    payload=handoff.CreateMigrationGrantRequest(
                        installation_id=f"cmi_{suffix * 44}",
                    ),
                    db=db,
                    user=_user(),
                )
                return 200
            except HTTPException as error:
                return error.status_code

    assert sorted(await asyncio.gather(issue("a"), issue("b"))) == [200, 429]
    async with handoff_database() as db:
        count = await db.scalar(select(func.count()).select_from(ClerkMigrationGrant))
    assert count == handoff.MAX_ACTIVE_GRANTS_PER_USER


@pytest.mark.asyncio
async def test_production_session_cannot_create_migration_grant(
    handoff_database,
    monkeypatch,
):
    monkeypatch.setattr(handoff, "settings", _settings())
    await _seed_aliases(handoff_database)

    async with handoff_database() as db:
        with pytest.raises(HTTPException) as error:
            await handoff.create_migration_grant(
                payload=_create_payload(),
                db=db,
                user=_user("production"),
            )

    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_grant_redeems_once_for_a_sixty_second_production_ticket(
    handoff_database,
    monkeypatch,
):
    monkeypatch.setattr(handoff, "settings", _settings())
    await _seed_aliases(handoff_database)
    issued: list[tuple[str, int]] = []

    class TicketClient:
        def __init__(self, environment):
            assert environment.is_production

        async def create_sign_in_token(self, clerk_user_id, *, expires_in_seconds):
            issued.append((clerk_user_id, expires_in_seconds))
            return "short-lived-production-ticket"

    monkeypatch.setattr(handoff, "ClerkBackendClient", TicketClient)
    async with handoff_database() as db:
        created = await handoff.create_migration_grant(
            payload=_create_payload(),
            db=db,
            user=_user(),
        )

    async with handoff_database() as db:
        redeemed = await handoff.redeem_migration_grant(
            credentials=_credentials(created.grant),
            db=db,
        )
        stored = (await db.execute(select(ClerkMigrationGrant))).scalar_one()

    assert redeemed.ticket == "short-lived-production-ticket"
    assert issued == [("production_user", 60)]
    assert stored.redeemed_at is not None

    async with handoff_database() as db:
        with pytest.raises(HTTPException) as replay:
            await handoff.redeem_migration_grant(
                credentials=_credentials(created.grant),
                db=db,
            )
    assert replay.value.status_code == 410
    assert replay.value.detail == handoff.GENERIC_INVALID_GRANT
    assert issued == [("production_user", 60)]


@pytest.mark.asyncio
async def test_concurrent_redemption_issues_exactly_one_ticket(
    handoff_database,
    monkeypatch,
):
    monkeypatch.setattr(handoff, "settings", _settings())
    await _seed_aliases(handoff_database)
    issue_count = 0

    class TicketClient:
        def __init__(self, _environment):
            pass

        async def create_sign_in_token(self, _clerk_user_id, *, expires_in_seconds):
            nonlocal issue_count
            assert expires_in_seconds == 60
            issue_count += 1
            await asyncio.sleep(0.05)
            return "single-ticket"

    monkeypatch.setattr(handoff, "ClerkBackendClient", TicketClient)
    async with handoff_database() as db:
        created = await handoff.create_migration_grant(
            payload=_create_payload(),
            db=db,
            user=_user(),
        )

    async def redeem() -> int:
        async with handoff_database() as db:
            try:
                await handoff.redeem_migration_grant(
                    credentials=_credentials(created.grant),
                    db=db,
                )
                return 200
            except HTTPException as error:
                return error.status_code

    assert sorted(await asyncio.gather(redeem(), redeem())) == [200, 410]
    assert issue_count == 1


@pytest.mark.asyncio
async def test_transient_clerk_failure_does_not_consume_grant(
    handoff_database,
    monkeypatch,
):
    monkeypatch.setattr(handoff, "settings", _settings())
    await _seed_aliases(handoff_database)

    class FailingClient:
        def __init__(self, _environment):
            pass

        async def create_sign_in_token(self, _clerk_user_id, *, expires_in_seconds):
            assert expires_in_seconds == 60
            raise httpx.ConnectError("simulated outage")

    monkeypatch.setattr(handoff, "ClerkBackendClient", FailingClient)
    async with handoff_database() as db:
        created = await handoff.create_migration_grant(
            payload=_create_payload(),
            db=db,
            user=_user(),
        )

    async with handoff_database() as db:
        with pytest.raises(HTTPException) as error:
            await handoff.redeem_migration_grant(
                credentials=_credentials(created.grant),
                db=db,
            )
    assert error.value.status_code == 502

    async with handoff_database() as db:
        stored = (await db.execute(select(ClerkMigrationGrant))).scalar_one()
        assert stored.redeemed_at is None


@pytest.mark.asyncio
async def test_expired_grant_is_terminal_without_contacting_clerk(
    handoff_database,
    monkeypatch,
):
    monkeypatch.setattr(handoff, "settings", _settings())
    await _seed_aliases(handoff_database)
    raw_grant = "cmg_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN"
    async with handoff_database() as db:
        db.add(
            ClerkMigrationGrant(
                app_user_id="stable_user",
                device_hash=handoff._hash_grant(_create_payload().installation_id),
                token_hash=handoff._hash_grant(raw_grant),
                expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
            )
        )
        await db.commit()

    class UnexpectedClient:
        def __init__(self, _environment):
            raise AssertionError("Clerk must not be contacted")

    monkeypatch.setattr(handoff, "ClerkBackendClient", UnexpectedClient)
    async with handoff_database() as db:
        with pytest.raises(HTTPException) as error:
            await handoff.redeem_migration_grant(
                credentials=_credentials(raw_grant),
                db=db,
            )

    assert error.value.status_code == 410
    assert error.value.detail == handoff.GENERIC_INVALID_GRANT
