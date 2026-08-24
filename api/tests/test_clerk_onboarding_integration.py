"""PostgreSQL coverage for explicit, fail-closed production account onboarding."""

import asyncio
import os
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.clerk_transition as transition
import app.routers.clerk_transition as handoff
from app.auth import VerifiedClerkToken
from app.config import Settings
from app.db.database import Base
from app.deletion_cleanup import hash_auth_identity
from app.models.deletion import DeletedAuthIdentity, DeletionCleanupJob
from app.models.identity import AppUser, ClerkIdentity, ClerkMigrationGrant
from app.models.moderation import AdminAuditEvent
from app.models.recipe import Recipe
from app.services.clerk import ClerkProfile

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)
PRODUCTION_ISSUER = "https://clerk.hafa-recipes.com"
INSTALLATION_ID = f"cmi_{'a' * 64}"


@pytest.fixture
async def onboarding_database():
    assert TEST_DATABASE_URL
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield sessions
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()


def _settings() -> Settings:
    return Settings(
        database_url="postgresql://test:test@localhost/test",
        openai_api_key="test-openai-key",
        clerk_development_issuer="https://development.clerk.accounts.dev",
        clerk_development_secret_key="development-secret",
        clerk_production_issuer=PRODUCTION_ISSUER,
        clerk_production_secret_key="production-secret",
    )


def _token(subject: str = "user_new") -> VerifiedClerkToken:
    return VerifiedClerkToken(
        subject=subject,
        issuer=PRODUCTION_ISSUER,
        environment_name="production",
        claims={},
    )


def _profile(
    subject: str = "user_new",
    *,
    verified: bool = True,
    external_id: str | None = None,
) -> ClerkProfile:
    return ClerkProfile(
        clerk_user_id=subject,
        email="new@example.com",
        email_verified=verified,
        first_name="New",
        last_name="Chef",
        external_id=external_id,
    )


def _request() -> handoff.ProductionOnboardingRequest:
    return handoff.ProductionOnboardingRequest(
        installation_id=INSTALLATION_ID,
        intent="create_account",
    )


def _credentials() -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials="verified-production-token")


def _install_client(monkeypatch, initial: ClerkProfile | None):
    state = {"profile": initial, "updates": []}

    class FakeClient:
        def __init__(self, environment):
            assert environment.is_production

        async def get_user(self, subject):
            profile = state["profile"]
            return profile if profile and profile.clerk_user_id == subject else None

        async def set_external_id(self, subject, external_id):
            assert state["profile"] is not None
            state["updates"].append((subject, external_id))
            state["profile"] = replace(state["profile"], external_id=external_id)
            return state["profile"]

    monkeypatch.setattr(handoff, "settings", _settings())
    monkeypatch.setattr(handoff, "verify_clerk_token", lambda _raw: _token())
    monkeypatch.setattr(handoff, "ClerkBackendClient", FakeClient)
    return state


@pytest.mark.asyncio
async def test_explicit_onboarding_creates_one_independent_stable_owner(
    onboarding_database, monkeypatch
):
    state = _install_client(monkeypatch, _profile())

    async with onboarding_database() as db:
        created = await handoff.onboard_production_user(_request(), _credentials(), db)
    async with onboarding_database() as db:
        repeated = await handoff.onboard_production_user(_request(), _credentials(), db)
        owners = (await db.execute(select(AppUser))).scalars().all()
        identity = (await db.execute(select(ClerkIdentity))).scalar_one()

    assert created.status == "created"
    assert handoff.PRODUCTION_APP_USER_PATTERN.fullmatch(created.app_user_id)
    assert created.app_user_id != "user_new"
    assert repeated.status == "existing"
    assert repeated.app_user_id == created.app_user_id
    assert [owner.id for owner in owners] == [created.app_user_id]
    assert identity.app_user_id == created.app_user_id
    assert identity.issuer == PRODUCTION_ISSUER
    assert state["updates"] == [("user_new", created.app_user_id)]


@pytest.mark.asyncio
async def test_concurrent_onboarding_provisions_exactly_one_stable_owner(
    onboarding_database, monkeypatch
):
    state = _install_client(monkeypatch, _profile())

    async def onboard():
        async with onboarding_database() as db:
            return await handoff.onboard_production_user(_request(), _credentials(), db)

    first, second = await asyncio.gather(onboard(), onboard())

    assert first.app_user_id == second.app_user_id
    assert sorted((first.status, second.status)) == ["created", "existing"]
    assert len(state["updates"]) == 1
    async with onboarding_database() as db:
        assert await db.scalar(select(func.count()).select_from(AppUser)) == 1
        assert await db.scalar(select(func.count()).select_from(ClerkIdentity)) == 1


@pytest.mark.asyncio
async def test_onboarding_resumes_a_provider_update_after_database_failure(
    onboarding_database, monkeypatch
):
    state = _install_client(monkeypatch, _profile())

    async with onboarding_database() as db:
        original_commit = db.commit

        async def reject_commit():
            raise IntegrityError("INSERT", {}, RuntimeError("interrupted database commit"))

        monkeypatch.setattr(db, "commit", reject_commit)
        with pytest.raises(HTTPException) as interrupted:
            await handoff.onboard_production_user(_request(), _credentials(), db)
        assert interrupted.value.status_code == 409
        monkeypatch.setattr(db, "commit", original_commit)

    updated_profile = state["profile"]
    assert updated_profile is not None
    assert handoff.PRODUCTION_APP_USER_PATTERN.fullmatch(updated_profile.external_id or "")

    async with onboarding_database() as db:
        resumed = await handoff.onboard_production_user(_request(), _credentials(), db)

    assert resumed.status == "created"
    assert resumed.app_user_id == updated_profile.external_id
    assert len(state["updates"]) == 1


@pytest.mark.asyncio
async def test_onboarding_requires_a_production_bearer_token(onboarding_database, monkeypatch):
    _install_client(monkeypatch, _profile())

    async with onboarding_database() as db:
        with pytest.raises(HTTPException) as missing:
            await handoff.onboard_production_user(_request(), None, db)
    assert missing.value.status_code == 401

    monkeypatch.setattr(
        handoff,
        "verify_clerk_token",
        lambda _raw: VerifiedClerkToken(
            subject="user_development",
            issuer="https://development.clerk.accounts.dev",
            environment_name="development",
            claims={},
        ),
    )
    async with onboarding_database() as db:
        with pytest.raises(HTTPException) as development:
            await handoff.onboard_production_user(_request(), _credentials(), db)
    assert development.value.status_code == 403


@pytest.mark.asyncio
async def test_onboarding_rejects_unverified_email_and_unknown_provider(
    onboarding_database, monkeypatch
):
    _install_client(monkeypatch, _profile(verified=False))
    async with onboarding_database() as db:
        with pytest.raises(HTTPException) as unverified:
            await handoff.onboard_production_user(_request(), _credentials(), db)
    assert unverified.value.status_code == 403

    _install_client(monkeypatch, None)
    async with onboarding_database() as db:
        with pytest.raises(HTTPException) as unavailable:
            await handoff.onboard_production_user(_request(), _credentials(), db)
    assert unavailable.value.status_code == 503


@pytest.mark.asyncio
async def test_onboarding_rejects_provider_transport_failure(onboarding_database, monkeypatch):
    _install_client(monkeypatch, _profile())

    class OfflineClient:
        def __init__(self, _environment):
            pass

        async def get_user(self, _subject):
            raise httpx.ConnectError("provider unavailable")

    monkeypatch.setattr(handoff, "ClerkBackendClient", OfflineClient)
    async with onboarding_database() as db:
        with pytest.raises(HTTPException) as unavailable:
            await handoff.onboard_production_user(_request(), _credentials(), db)
    assert unavailable.value.status_code == 503


@pytest.mark.asyncio
async def test_onboarding_never_recreates_a_deleted_production_identity(
    onboarding_database, monkeypatch
):
    _install_client(monkeypatch, _profile())
    async with onboarding_database() as db:
        job = DeletionCleanupJob(
            kind="account",
            app_user_id="deleted_owner",
            clerk_identities=[],
            storage_prefixes=[],
        )
        db.add(job)
        await db.flush()
        db.add(
            DeletedAuthIdentity(
                deletion_job_id=job.id,
                issuer=PRODUCTION_ISSUER,
                clerk_user_id_hash=hash_auth_identity(PRODUCTION_ISSUER, "user_new"),
            )
        )
        await db.commit()

    async with onboarding_database() as db:
        with pytest.raises(HTTPException) as deleted:
            await handoff.onboard_production_user(_request(), _credentials(), db)
    assert deleted.value.status_code == 401


@pytest.mark.asyncio
async def test_onboarding_refuses_to_replace_a_migrated_owner_on_the_same_device(
    onboarding_database, monkeypatch
):
    state = _install_client(monkeypatch, _profile())
    async with onboarding_database() as db:
        db.add(AppUser(id="user_existing_owner"))
        await db.flush()
        db.add(
            ClerkMigrationGrant(
                app_user_id="user_existing_owner",
                device_hash=handoff._hash_grant(INSTALLATION_ID),
                token_hash="b" * 64,
                expires_at=datetime.now(timezone.utc) + timedelta(days=30),
                redeemed_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()

    async with onboarding_database() as db:
        with pytest.raises(HTTPException) as recovery:
            await handoff.onboard_production_user(_request(), _credentials(), db)
    assert recovery.value.status_code == 409
    assert recovery.value.detail == "Account recovery required"
    assert state["updates"] == []


@pytest.mark.asyncio
async def test_onboarding_refuses_untrusted_or_already_claimed_external_id(
    onboarding_database, monkeypatch
):
    _install_client(monkeypatch, _profile(external_id="user_unknown_legacy"))
    async with onboarding_database() as db:
        with pytest.raises(HTTPException) as untrusted:
            await handoff.onboard_production_user(_request(), _credentials(), db)
    assert untrusted.value.status_code == 409

    _install_client(monkeypatch, _profile(external_id="user_existing_owner"))
    async with onboarding_database() as db:
        db.add(AppUser(id="user_existing_owner"))
        await db.flush()
        db.add(
            ClerkIdentity(
                app_user_id="user_existing_owner",
                issuer=PRODUCTION_ISSUER,
                clerk_user_id="user_someone_else",
            )
        )
        await db.commit()
    async with onboarding_database() as db:
        with pytest.raises(HTTPException) as claimed:
            await handoff.onboard_production_user(_request(), _credentials(), db)
    assert claimed.value.status_code == 409


def _recovery_profiles():
    return {
        "user_old_shell": ClerkProfile(
            clerk_user_id="user_old_shell",
            email="old@privaterelay.appleid.com",
            email_verified=True,
            first_name="Owner",
            last_name="Chef",
            external_id="user_original_owner",
        ),
        "user_new_apple": ClerkProfile(
            clerk_user_id="user_new_apple",
            email="new@privaterelay.appleid.com",
            email_verified=True,
            first_name="Owner",
            last_name="Chef",
            external_id=None,
            verified_providers=("apple",),
        ),
    }


def _install_recovery_client(monkeypatch):
    state = {
        "profiles": _recovery_profiles(),
        "updates": [],
        "fail_replacement": False,
        "lost_responses": {},
        "pause_subject": None,
        "pause_entered": None,
        "pause_release": None,
    }

    class RecoveryClient:
        def __init__(self, environment):
            assert environment.is_production

        async def get_user(self, subject):
            return state["profiles"].get(subject)

        async def set_external_id(self, subject, external_id):
            if state["pause_subject"] == subject:
                state["pause_subject"] = None
                state["pause_entered"].set()
                await state["pause_release"].wait()
            state["updates"].append((subject, external_id))
            if (
                state["fail_replacement"]
                and subject == "user_new_apple"
                and external_id == "user_original_owner"
            ):
                return None
            for other_subject, profile in state["profiles"].items():
                if other_subject != subject and profile.external_id == external_id:
                    return None
            state["profiles"][subject] = replace(
                state["profiles"][subject], external_id=external_id
            )
            lost_response = state["lost_responses"].pop(subject, None)
            if lost_response == "none":
                return None
            if lost_response == "exception":
                raise httpx.ReadTimeout("provider response lost after applying update")
            return state["profiles"][subject]

    monkeypatch.setattr(transition, "ClerkBackendClient", RecoveryClient)
    return state


async def _seed_recovery_owner(sessions):
    async with sessions() as db:
        db.add(AppUser(id="user_original_owner"))
        await db.flush()
        db.add_all(
            (
                ClerkIdentity(
                    app_user_id="user_original_owner",
                    issuer="https://development.clerk.accounts.dev",
                    clerk_user_id="user_original_owner",
                ),
                ClerkIdentity(
                    app_user_id="user_original_owner",
                    issuer=PRODUCTION_ISSUER,
                    clerk_user_id="user_old_shell",
                ),
                Recipe(
                    source_url="manual://recovery-test",
                    source_type="manual",
                    extracted={"title": "Original recipe"},
                    user_id="user_original_owner",
                ),
            )
        )
        await db.commit()


async def _recover(db, *, apply=False):
    production = next(item for item in _settings().clerk_environments if item.is_production)
    return await transition.rebind_production_identity(
        db,
        production,
        app_user_id="user_original_owner",
        from_clerk_user_id="user_old_shell",
        to_clerk_user_id="user_new_apple",
        actor_user_id="user_original_owner",
        reason="Owner confirmed the Apple relay migration",
        apply=apply,
    )


@pytest.mark.asyncio
async def test_recovery_is_dry_run_first_audited_idempotent_and_preserves_recipes(
    onboarding_database, monkeypatch
):
    state = _install_recovery_client(monkeypatch)
    await _seed_recovery_owner(onboarding_database)

    async with onboarding_database() as db:
        dry_run = await _recover(db)
        assert dry_run.status == "would_rebind"
    assert state["updates"] == []

    async with onboarding_database() as db:
        applied = await _recover(db, apply=True)
    assert applied.status == "rebound"

    async with onboarding_database() as db:
        repeated = await _recover(db, apply=True)
        identities = (await db.execute(select(ClerkIdentity))).scalars().all()
        recipe = (await db.execute(select(Recipe))).scalar_one()
        audit = (await db.execute(select(AdminAuditEvent))).scalar_one()

    assert repeated.status == "unchanged"
    assert {(item.issuer, item.clerk_user_id) for item in identities} == {
        ("https://development.clerk.accounts.dev", "user_original_owner"),
        (PRODUCTION_ISSUER, "user_new_apple"),
    }
    assert recipe.user_id == "user_original_owner"
    assert state["profiles"]["user_new_apple"].external_id == "user_original_owner"
    assert state["profiles"]["user_old_shell"].external_id.startswith("retired_")
    assert audit.action == "identity.rebound"
    assert audit.target_id == "user_original_owner"
    assert audit.before_summary == {
        "issuer": PRODUCTION_ISSUER,
        "clerk_user_id": "user_old_shell",
    }
    assert audit.after_summary["clerk_user_id"] == "user_new_apple"
    assert "email" not in audit.before_summary
    assert "email" not in audit.after_summary


@pytest.mark.asyncio
async def test_recovery_refuses_unverified_apple_or_existing_sign_in_method(
    onboarding_database, monkeypatch
):
    state = _install_recovery_client(monkeypatch)
    await _seed_recovery_owner(onboarding_database)
    state["profiles"]["user_new_apple"] = replace(
        state["profiles"]["user_new_apple"], verified_providers=()
    )

    async with onboarding_database() as db:
        no_apple = await _recover(db, apply=True)
    assert no_apple.status == "conflict"
    assert state["updates"] == []

    state["profiles"] = _recovery_profiles()
    state["profiles"]["user_old_shell"] = replace(
        state["profiles"]["user_old_shell"], password_enabled=True
    )
    async with onboarding_database() as db:
        active_account = await _recover(db, apply=True)
    assert active_account.status == "conflict"
    assert state["updates"] == []


@pytest.mark.asyncio
async def test_recovery_restores_original_identity_after_provider_failure(
    onboarding_database, monkeypatch
):
    state = _install_recovery_client(monkeypatch)
    state["fail_replacement"] = True
    await _seed_recovery_owner(onboarding_database)

    async with onboarding_database() as db:
        result = await _recover(db, apply=True)
    assert result.status == "failed"
    assert state["profiles"]["user_old_shell"].external_id == "user_original_owner"
    assert state["profiles"]["user_new_apple"].external_id is None
    async with onboarding_database() as db:
        identity = await db.scalar(
            select(ClerkIdentity).where(ClerkIdentity.issuer == PRODUCTION_ISSUER)
        )
        assert identity.clerk_user_id == "user_old_shell"
        assert await db.scalar(select(func.count()).select_from(AdminAuditEvent)) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("subject", "lost_response"),
    (
        ("user_old_shell", "none"),
        ("user_old_shell", "exception"),
        ("user_new_apple", "none"),
        ("user_new_apple", "exception"),
    ),
)
async def test_recovery_confirms_provider_updates_when_success_responses_are_lost(
    onboarding_database,
    monkeypatch,
    subject,
    lost_response,
):
    state = _install_recovery_client(monkeypatch)
    state["lost_responses"][subject] = lost_response
    await _seed_recovery_owner(onboarding_database)

    async with onboarding_database() as db:
        result = await _recover(db, apply=True)

    assert result.status == "rebound"
    assert state["profiles"]["user_old_shell"].external_id.startswith("retired_")
    assert state["profiles"]["user_new_apple"].external_id == "user_original_owner"


@pytest.mark.asyncio
async def test_recovery_compensates_both_provider_changes_after_database_failure(
    onboarding_database, monkeypatch
):
    state = _install_recovery_client(monkeypatch)
    await _seed_recovery_owner(onboarding_database)

    async with onboarding_database() as db:

        async def reject_commit():
            raise IntegrityError("UPDATE", {}, RuntimeError("interrupted database commit"))

        monkeypatch.setattr(db, "commit", reject_commit)
        result = await _recover(db, apply=True)

    assert result.status == "failed"
    assert state["profiles"]["user_old_shell"].external_id == "user_original_owner"
    assert state["profiles"]["user_new_apple"].external_id.startswith("orphan_")
    async with onboarding_database() as db:
        identity = await db.scalar(
            select(ClerkIdentity).where(ClerkIdentity.issuer == PRODUCTION_ISSUER)
        )
        assert identity.clerk_user_id == "user_old_shell"
        assert await db.scalar(select(func.count()).select_from(AdminAuditEvent)) == 0


@pytest.mark.asyncio
async def test_recovery_confirms_lost_response_while_restoring_original_owner(
    onboarding_database,
    monkeypatch,
):
    state = _install_recovery_client(monkeypatch)
    await _seed_recovery_owner(onboarding_database)

    async with onboarding_database() as db:

        async def reject_commit():
            state["lost_responses"]["user_old_shell"] = "exception"
            raise IntegrityError("UPDATE", {}, RuntimeError("interrupted database commit"))

        monkeypatch.setattr(db, "commit", reject_commit)
        result = await _recover(db, apply=True)

    assert result.status == "failed"
    assert state["profiles"]["user_old_shell"].external_id == "user_original_owner"
    assert state["profiles"]["user_new_apple"].external_id.startswith("orphan_")


@pytest.mark.asyncio
async def test_recovery_and_onboarding_share_the_replacement_subject_lock(
    onboarding_database,
    monkeypatch,
):
    state = _install_recovery_client(monkeypatch)
    state["pause_subject"] = "user_old_shell"
    state["pause_entered"] = asyncio.Event()
    state["pause_release"] = asyncio.Event()
    monkeypatch.setattr(handoff, "settings", _settings())
    monkeypatch.setattr(handoff, "verify_clerk_token", lambda _raw: _token("user_new_apple"))
    monkeypatch.setattr(handoff, "ClerkBackendClient", transition.ClerkBackendClient)
    await _seed_recovery_owner(onboarding_database)

    async def recover():
        async with onboarding_database() as db:
            return await _recover(db, apply=True)

    async def onboard():
        async with onboarding_database() as db:
            return await handoff.onboard_production_user(_request(), _credentials(), db)

    recovery_task = asyncio.create_task(recover())
    await state["pause_entered"].wait()
    onboarding_task = asyncio.create_task(onboard())
    try:
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(onboarding_task), timeout=0.05)
    finally:
        state["pause_release"].set()

    recovered, onboarded = await asyncio.gather(recovery_task, onboarding_task)

    assert recovered.status == "rebound"
    assert onboarded.status == "existing"
    assert onboarded.app_user_id == "user_original_owner"
    assert state["profiles"]["user_new_apple"].external_id == "user_original_owner"
    async with onboarding_database() as db:
        assert await db.scalar(select(func.count()).select_from(AppUser)) == 1


@pytest.mark.asyncio
async def test_provisioner_trusts_established_identity_over_obsolete_apple_relay(
    onboarding_database, monkeypatch
):
    development, production = _settings().clerk_environments
    development_profile = ClerkProfile(
        clerk_user_id="user_original_owner",
        email="old@privaterelay.appleid.com",
        email_verified=True,
        first_name=None,
        last_name=None,
        external_id=None,
    )
    retired_profile = replace(
        _recovery_profiles()["user_old_shell"], external_id=f"retired_{'a' * 32}"
    )
    recovered_profile = replace(
        _recovery_profiles()["user_new_apple"], external_id="user_original_owner"
    )

    class InventoryClient:
        def __init__(self, environment):
            self.environment = environment

        async def list_users(self):
            if self.environment.is_development:
                return [development_profile]
            return [retired_profile, recovered_profile]

    monkeypatch.setattr(transition, "ClerkBackendClient", InventoryClient)
    async with onboarding_database() as db:
        db.add(AppUser(id="user_original_owner"))
        await db.flush()
        db.add_all(
            (
                ClerkIdentity(
                    app_user_id="user_original_owner",
                    issuer=development.issuer,
                    clerk_user_id="user_original_owner",
                ),
                ClerkIdentity(
                    app_user_id="user_original_owner",
                    issuer=production.issuer,
                    clerk_user_id="user_new_apple",
                ),
            )
        )
        await db.commit()

        results = await transition.provision_production(db, development, production)

    assert [(item.status, item.clerk_user_id) for item in results] == [
        ("unchanged", "user_new_apple")
    ]


@pytest.mark.asyncio
async def test_production_only_owners_are_healthy_in_both_transition_audits(
    onboarding_database, monkeypatch
):
    development, production = _settings().clerk_environments
    app_user_id = f"app_{'a' * 32}"
    production_profile = _profile(external_id=app_user_id)

    class InventoryClient:
        def __init__(self, environment):
            self.environment = environment

        async def list_users(self):
            return [] if self.environment.is_development else [production_profile]

    monkeypatch.setattr(transition, "get_settings", _settings)
    monkeypatch.setattr(transition, "ClerkBackendClient", InventoryClient)
    async with onboarding_database() as db:
        db.add(AppUser(id=app_user_id))
        await db.flush()
        db.add(
            ClerkIdentity(
                app_user_id=app_user_id,
                issuer=production.issuer,
                clerk_user_id="user_new",
            )
        )
        await db.commit()

        provisioned = await transition.provision_production(db, development, production)
        audited = await transition.audit_development(db, development)

    assert [(item.status, item.clerk_user_id) for item in provisioned] == [
        ("production_only", "user_new")
    ]
    assert [(item.status, item.clerk_user_id) for item in audited] == [
        ("production_only", "user_new")
    ]


@pytest.mark.asyncio
async def test_production_only_audit_rejects_mismatched_provider_external_id(
    onboarding_database, monkeypatch
):
    development, production = _settings().clerk_environments
    app_user_id = f"app_{'a' * 32}"

    class InventoryClient:
        def __init__(self, environment):
            self.environment = environment

        async def list_users(self):
            return [] if self.environment.is_development else [_profile(external_id="other")]

    monkeypatch.setattr(transition, "ClerkBackendClient", InventoryClient)
    async with onboarding_database() as db:
        db.add(AppUser(id=app_user_id))
        await db.flush()
        db.add(
            ClerkIdentity(
                app_user_id=app_user_id,
                issuer=production.issuer,
                clerk_user_id="user_new",
            )
        )
        await db.commit()

        results = await transition.provision_production(db, development, production)

    assert [item.status for item in results] == ["conflict"]
