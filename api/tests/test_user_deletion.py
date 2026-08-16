import pytest

import app.routers.users as users
from app.config import Settings


def _settings() -> Settings:
    return Settings(
        database_url="postgresql://test:test@localhost/test",
        openai_api_key="test-openai-key",
        clerk_development_issuer="https://development.clerk.accounts.dev",
        clerk_development_secret_key="development-secret",
        clerk_production_issuer="https://clerk.hafa-recipes.com",
        clerk_production_secret_key="production-secret",
    )


@pytest.mark.asyncio
async def test_clerk_deletion_attempts_every_alias_after_one_fails(monkeypatch):
    attempted = []

    class DeletionClient:
        def __init__(self, environment, *, timeout):
            self.environment = environment

        async def delete_user(self, clerk_user_id):
            attempted.append((self.environment.name, clerk_user_id))
            if self.environment.is_development:
                raise RuntimeError("simulated transport failure")
            return True

    monkeypatch.setattr(users, "settings", _settings())
    monkeypatch.setattr(users, "ClerkBackendClient", DeletionClient)
    monkeypatch.setattr(users.sentry_sdk, "capture_exception", lambda _error: None)

    deleted = await users._delete_clerk_users(
        [
            ("https://development.clerk.accounts.dev", "user_development"),
            ("https://clerk.hafa-recipes.com", "user_production"),
        ]
    )

    assert deleted is False
    assert attempted == [
        ("development", "user_development"),
        ("production", "user_production"),
    ]


@pytest.mark.asyncio
async def test_clerk_deletion_succeeds_only_when_every_alias_is_deleted(monkeypatch):
    class DeletionClient:
        def __init__(self, _environment, *, timeout):
            pass

        async def delete_user(self, _clerk_user_id):
            return True

    monkeypatch.setattr(users, "settings", _settings())
    monkeypatch.setattr(users, "ClerkBackendClient", DeletionClient)

    deleted = await users._delete_clerk_users(
        [
            ("https://development.clerk.accounts.dev", "user_development"),
            ("https://clerk.hafa-recipes.com", "user_production"),
        ]
    )

    assert deleted is True
