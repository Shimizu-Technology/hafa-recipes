from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

import app.deletion_cleanup as cleanup
from app.config import Settings
from app.deletion_cleanup import (
    DurableDeletionCleanupWorker,
    apply_cleanup_claim,
    apply_cleanup_retry,
    claimable_cleanup_query,
    hash_auth_identity,
    is_allowed_cleanup_prefix,
)
from app.models.deletion import DeletionCleanupJob


def _settings() -> Settings:
    return Settings(
        database_url="postgresql://test:test@localhost/test",
        openai_api_key="test-openai-key",
        clerk_development_issuer="https://development.clerk.accounts.dev",
        clerk_development_secret_key="development-secret",
        clerk_production_issuer="https://clerk.hafa-recipes.com",
        clerk_production_secret_key="production-secret",
    )


def _job(*, attempts: int = 0, max_attempts: int = 3) -> DeletionCleanupJob:
    return DeletionCleanupJob(
        id=uuid4(),
        kind="account",
        app_user_id="stable_user",
        status="queued",
        clerk_identities=[],
        storage_prefixes=[],
        attempt_count=attempts,
        max_attempts=max_attempts,
    )


def test_deleted_auth_hash_is_normalized_and_subject_scoped():
    first = hash_auth_identity("HTTPS://CLERK.EXAMPLE/", "user_one")
    second = hash_auth_identity("https://clerk.example", "user_one")

    assert first == second
    assert first != hash_auth_identity("https://clerk.example", "user_two")
    assert first != hash_auth_identity("https://other.example", "user_one")
    assert "user_one" not in first


def test_cleanup_prefixes_are_narrowly_allowlisted():
    recipe_id = "11111111-1111-4111-8111-111111111111"
    assert is_allowed_cleanup_prefix(f"thumbnails/{recipe_id}.") is True
    assert is_allowed_cleanup_prefix(f"thumbnails/{recipe_id}/") is True
    assert is_allowed_cleanup_prefix("chat-images/user_123/") is True
    assert is_allowed_cleanup_prefix("thumbnails/") is False
    assert is_allowed_cleanup_prefix("chat-images/") is False
    assert is_allowed_cleanup_prefix("chat-images/user/child/") is False
    assert is_allowed_cleanup_prefix("../") is False


def test_cleanup_claim_uses_fenced_lease_and_increments_attempt():
    now = datetime(2026, 8, 19, tzinfo=timezone.utc)
    first = _job()
    second = _job()

    apply_cleanup_claim(first, now)
    apply_cleanup_claim(second, now)

    assert first.status == "processing"
    assert first.attempt_count == 1
    assert first.lease_token and first.lease_token != second.lease_token
    assert first.leased_until == now + timedelta(
        seconds=cleanup.settings.deletion_cleanup_lease_seconds
    )


def test_cleanup_retry_is_bounded_and_does_not_persist_error_details():
    now = datetime(2026, 8, 19, tzinfo=timezone.utc)
    job = _job(attempts=1)
    job.lease_token = "lease"
    job.leased_until = now + timedelta(minutes=1)

    apply_cleanup_retry(job, now, RuntimeError("private provider detail"))

    assert job.status == "queued"
    assert job.next_attempt_at == now + timedelta(seconds=15)
    assert job.last_error == "RuntimeError"
    assert "private" not in job.last_error
    assert job.lease_token is None

    final_job = _job(attempts=3, max_attempts=3)
    apply_cleanup_retry(final_job, now, RuntimeError("failure"))
    assert final_job.status == "failed"
    assert final_job.next_attempt_at is None
    assert final_job.completed_at == now


def test_cleanup_query_uses_postgres_skip_locked_and_stale_recovery():
    sql = str(
        claimable_cleanup_query(datetime(2026, 8, 19, tzinfo=timezone.utc)).compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )

    assert "FOR UPDATE SKIP LOCKED" in sql
    assert "deletion_cleanup_jobs.status = 'queued'" in sql
    assert "deletion_cleanup_jobs.status = 'processing'" in sql
    assert "deletion_cleanup_jobs.leased_until <" in sql


@pytest.mark.asyncio
async def test_clerk_cleanup_attempts_every_alias_idempotently(monkeypatch):
    attempted = []

    class DeletionClient:
        def __init__(self, environment, *, timeout):
            self.environment = environment

        async def delete_user(self, clerk_user_id):
            attempted.append((self.environment.name, clerk_user_id))
            return True

    monkeypatch.setattr(cleanup, "settings", _settings())
    monkeypatch.setattr(cleanup, "ClerkBackendClient", DeletionClient)

    await DurableDeletionCleanupWorker()._delete_clerk_identities(
        [
            {
                "issuer": "https://development.clerk.accounts.dev",
                "clerk_user_id": "user_development",
            },
            {
                "issuer": "https://clerk.hafa-recipes.com",
                "clerk_user_id": "user_production",
            },
        ]
    )

    assert attempted == [
        ("development", "user_development"),
        ("production", "user_production"),
    ]


@pytest.mark.asyncio
async def test_invalid_cleanup_snapshot_fails_closed():
    with pytest.raises(RuntimeError, match="Clerk account target"):
        await DurableDeletionCleanupWorker()._delete_clerk_identities(
            [{"issuer": "https://clerk.example"}]
        )


@pytest.mark.asyncio
async def test_clerk_cleanup_continues_after_one_alias_fails(monkeypatch):
    attempted = []

    class DeletionClient:
        def __init__(self, environment, *, timeout):
            self.environment = environment

        async def delete_user(self, clerk_user_id):
            attempted.append(clerk_user_id)
            if clerk_user_id == "first":
                raise RuntimeError("temporary failure")
            return True

    monkeypatch.setattr(cleanup, "settings", _settings())
    monkeypatch.setattr(cleanup, "ClerkBackendClient", DeletionClient)
    monkeypatch.setattr(cleanup.sentry_sdk, "capture_exception", lambda _error: None)

    with pytest.raises(RuntimeError, match="1 Clerk account"):
        await DurableDeletionCleanupWorker()._delete_clerk_identities(
            [
                {
                    "issuer": "https://development.clerk.accounts.dev",
                    "clerk_user_id": "first",
                },
                {
                    "issuer": "https://clerk.hafa-recipes.com",
                    "clerk_user_id": "second",
                },
            ]
        )

    assert attempted == ["first", "second"]


@pytest.mark.asyncio
async def test_nonproduction_without_storage_is_a_safe_noop(monkeypatch):
    monkeypatch.setattr(cleanup, "settings", _settings())
    monkeypatch.setattr(
        cleanup,
        "storage_service",
        SimpleNamespace(is_enabled=False),
    )

    await DurableDeletionCleanupWorker()._delete_storage_prefixes(
        ["thumbnails/11111111-1111-4111-8111-111111111111/"]
    )
