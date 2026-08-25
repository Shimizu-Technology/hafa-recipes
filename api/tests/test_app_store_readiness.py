"""Safe release inventory and dedicated App Review provisioning coverage."""

import os
from dataclasses import replace

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.app_store_readiness as readiness
from app.config import ClerkEnvironment
from app.models.identity import AppUser, ClerkIdentity
from app.services.clerk import ClerkProfile

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)
ISSUER = "https://clerk.hafa-recipes.com"


@pytest.fixture
async def readiness_database():
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.run_sync(AppUser.__table__.create)
        await connection.run_sync(ClerkIdentity.__table__.create)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield sessions
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()


def _environment() -> ClerkEnvironment:
    return ClerkEnvironment(
        name="production",
        issuer=ISSUER,
        secret_key="test-secret",
        jwks_url=f"{ISSUER}/.well-known/jwks.json",
        audience=None,
        authorized_parties=(),
    )


def _profile(
    subject: str,
    owner: str,
    email: str,
    *,
    password: bool = False,
    providers: tuple[str, ...] = (),
) -> ClerkProfile:
    return ClerkProfile(
        clerk_user_id=subject,
        email=email,
        email_verified=True,
        first_name="Existing",
        last_name="Owner",
        external_id=owner,
        password_enabled=password,
        verified_providers=providers,
    )


def _install_client(monkeypatch, profiles: list[ClerkProfile]):
    created: list[dict[str, object]] = []

    class FakeClient:
        def __init__(self, environment):
            assert environment.is_production

        async def list_users(self):
            return list(profiles)

        async def create_user(self, **kwargs):
            created.append(kwargs)
            profile = _profile(
                "user_app_review",
                kwargs["external_id"],
                kwargs["email"],
                password=bool(kwargs.get("password")),
            )
            profiles.append(profile)
            return profile

    monkeypatch.setattr(readiness, "ClerkBackendClient", FakeClient)
    return created


@pytest.mark.asyncio
async def test_release_inventory_is_aggregate_and_counts_private_relay_recovery(
    readiness_database, monkeypatch
):
    profiles = [
        _profile("user_apple", "owner_apple", "chef@example.com", providers=("apple",)),
        _profile("user_email", "owner_email", "cook@example.com"),
        _profile("user_relay", "owner_relay", "hidden@privaterelay.appleid.com"),
    ]
    _install_client(monkeypatch, profiles)

    async with readiness_database() as db:
        for profile in profiles:
            assert profile.external_id
            db.add(AppUser(id=profile.external_id))
        await db.flush()
        for profile in profiles:
            db.add(ClerkIdentity(
                app_user_id=profile.external_id,
                issuer=ISSUER,
                clerk_user_id=profile.clerk_user_id,
            ))
        await db.commit()
        result = await readiness.app_store_readiness_summary(db, _environment())

    assert result == readiness.AppStoreReadinessSummary(
        mapped_users=3,
        durable_sign_in_users=1,
        email_recoverable_users=2,
        private_relay_recovery_users=1,
        invalid_identity_users=0,
        reviewer_status="not_configured",
    )


@pytest.mark.asyncio
async def test_review_account_dry_run_never_creates_a_provider_or_owner(
    readiness_database, monkeypatch
):
    created = _install_client(monkeypatch, [])

    async with readiness_database() as db:
        result = await readiness.provision_app_review_account(
            db,
            _environment(),
            email="reviewer@example.com",
            password=None,
        )
        count = await db.scalar(select(func.count()).select_from(AppUser))

    assert result.status == "would_create"
    assert created == []
    assert count == 0


@pytest.mark.asyncio
async def test_review_account_is_password_enabled_isolated_and_idempotent(
    readiness_database, monkeypatch
):
    profiles: list[ClerkProfile] = []
    created = _install_client(monkeypatch, profiles)

    async with readiness_database() as db:
        first = await readiness.provision_app_review_account(
            db,
            _environment(),
            email="Reviewer@Example.com",
            password="a-safe-reviewer-password",
            apply=True,
        )
    async with readiness_database() as db:
        again = await readiness.provision_app_review_account(
            db,
            _environment(),
            email="reviewer@example.com",
            password="a-safe-reviewer-password",
            apply=True,
        )
        owner = (await db.execute(select(AppUser))).scalar_one()
        identity = (await db.execute(select(ClerkIdentity))).scalar_one()
        summary = await readiness.app_store_readiness_summary(
            db,
            _environment(),
            reviewer_email="reviewer@example.com",
        )

    assert first.status == "created"
    assert again.status == "unchanged"
    assert len(created) == 1
    assert created[0]["password"] == "a-safe-reviewer-password"
    assert readiness.PRODUCTION_APP_USER_PATTERN.fullmatch(owner.id)
    assert identity.app_user_id == owner.id
    assert summary.reviewer_status == "ready"


@pytest.mark.asyncio
async def test_review_provisioning_never_adopts_or_modifies_an_existing_customer(
    readiness_database, monkeypatch
):
    customer = _profile("user_existing", "legacy_customer", "reviewer@example.com")
    created = _install_client(monkeypatch, [customer])

    async with readiness_database() as db:
        result = await readiness.provision_app_review_account(
            db,
            _environment(),
            email="reviewer@example.com",
            password="a-safe-reviewer-password",
            apply=True,
        )
        count = await db.scalar(select(func.count()).select_from(AppUser))

    assert result.status == "conflict"
    assert created == []
    assert count == 0


@pytest.mark.asyncio
async def test_review_readiness_rejects_missing_password_or_wrong_owner(
    readiness_database, monkeypatch
):
    owner_id = f"app_{'a' * 32}"
    reviewer = _profile("user_review", owner_id, "reviewer@example.com")
    profiles = [reviewer]
    _install_client(monkeypatch, profiles)

    async with readiness_database() as db:
        db.add(AppUser(id=owner_id))
        await db.flush()
        db.add(ClerkIdentity(app_user_id=owner_id, issuer=ISSUER, clerk_user_id="user_review"))
        await db.commit()
        missing_password = await readiness.app_store_readiness_summary(
            db, _environment(), reviewer_email="reviewer@example.com"
        )
        profiles[0] = replace(reviewer, password_enabled=True, external_id="wrong_owner")
        wrong_owner = await readiness.app_store_readiness_summary(
            db, _environment(), reviewer_email="reviewer@example.com"
        )

    assert missing_password.reviewer_status == "password_missing"
    assert wrong_owner.reviewer_status == "invalid_identity"
    assert wrong_owner.invalid_identity_users == 1


@pytest.mark.asyncio
async def test_review_creation_requires_a_strong_password(readiness_database, monkeypatch):
    created = _install_client(monkeypatch, [])

    async with readiness_database() as db:
        result = await readiness.provision_app_review_account(
            db,
            _environment(),
            email="reviewer@example.com",
            password="too-short",
            apply=True,
        )

    assert result.status == "failed"
    assert created == []


@pytest.mark.asyncio
async def test_review_readiness_rejects_a_real_legacy_customer(
    readiness_database, monkeypatch
):
    reviewer = _profile(
        "user_review", "user_legacy_customer", "reviewer@example.com", password=True
    )
    _install_client(monkeypatch, [reviewer])

    async with readiness_database() as db:
        db.add(AppUser(id="user_legacy_customer"))
        await db.flush()
        db.add(ClerkIdentity(
            app_user_id="user_legacy_customer",
            issuer=ISSUER,
            clerk_user_id="user_review",
        ))
        await db.commit()
        result = await readiness.app_store_readiness_summary(
            db, _environment(), reviewer_email="reviewer@example.com"
        )

    assert result.reviewer_status == "invalid_identity"


@pytest.mark.asyncio
async def test_review_creation_resumes_after_database_commit_failure(
    readiness_database, monkeypatch
):
    profiles: list[ClerkProfile] = []
    created = _install_client(monkeypatch, profiles)

    async with readiness_database() as db:
        original_commit = db.commit

        async def reject_commit():
            from sqlalchemy.exc import IntegrityError

            raise IntegrityError("INSERT", {}, RuntimeError("interrupted database commit"))

        monkeypatch.setattr(db, "commit", reject_commit)
        interrupted = await readiness.provision_app_review_account(
            db,
            _environment(),
            email="reviewer@example.com",
            password="a-safe-reviewer-password",
            apply=True,
        )
        monkeypatch.setattr(db, "commit", original_commit)

    async with readiness_database() as db:
        recovered = await readiness.provision_app_review_account(
            db,
            _environment(),
            email="reviewer@example.com",
            password="a-safe-reviewer-password",
            apply=True,
        )
        count = await db.scalar(select(func.count()).select_from(AppUser))

    assert interrupted.status == "conflict"
    assert recovered.status == "created"
    assert len(created) == 1
    assert count == 1


def test_reviewer_inputs_reject_invalid_emails_and_environment_names(monkeypatch):
    monkeypatch.delenv("APP_REVIEW_EMAIL", raising=False)

    with pytest.raises(ValueError, match="dedicated email"):
        readiness._normalized_email("not-an-email")
    with pytest.raises(ValueError, match="uppercase identifiers"):
        readiness._environment_value("bad-name", required=False)
    with pytest.raises(ValueError, match="not configured"):
        readiness._environment_value("APP_REVIEW_EMAIL", required=True)
