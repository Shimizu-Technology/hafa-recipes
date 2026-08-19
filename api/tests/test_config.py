import pytest
from pydantic import ValidationError

from app.config import Settings


def _settings(database_url: str) -> Settings:
    return Settings(
        database_url=database_url,
        openai_api_key="test-openai-key",
    )


def test_async_database_url_removes_sslmode_and_preserves_other_query_params():
    settings = _settings(
        "postgresql://user:pass@example.com/db?sslmode=require&application_name=hafa"
    )

    assert (
        settings.async_database_url
        == "postgresql+asyncpg://user:pass@example.com/db?application_name=hafa"
    )


def test_async_database_url_removes_sslmode_when_it_is_not_first_param():
    settings = _settings(
        "postgresql://user:pass@example.com/db?application_name=hafa&sslmode=require"
    )

    assert (
        settings.async_database_url
        == "postgresql+asyncpg://user:pass@example.com/db?application_name=hafa"
    )


def test_async_database_url_removes_channel_binding_for_asyncpg():
    settings = _settings(
        "postgresql://user:pass@example.com/db?sslmode=require&channel_binding=require"
    )

    assert settings.async_database_url == "postgresql+asyncpg://user:pass@example.com/db"


def test_async_database_url_removes_channel_binding_and_preserves_supported_params():
    settings = _settings(
        "postgresql://user:pass@example.com/db?channel_binding=require&application_name=hafa"
    )

    assert (
        settings.async_database_url
        == "postgresql+asyncpg://user:pass@example.com/db?application_name=hafa"
    )


def test_clerk_environments_are_issuer_scoped_and_deduplicate_legacy_settings():
    settings = Settings(
        database_url="postgresql://user:pass@example.com/db",
        openai_api_key="test-openai-key",
        clerk_frontend_api="dev.example.clerk.accounts.dev",
        clerk_secret_key="legacy-secret",
        clerk_development_issuer="https://dev.example.clerk.accounts.dev/",
        clerk_development_secret_key="development-secret",
        clerk_production_issuer="https://clerk.hafa-recipes.com",
        clerk_production_secret_key="production-secret",
        clerk_production_audience="mobile,web",
        clerk_production_authorized_parties="https://hafa-recipes.com, hafa://callback",
        clerk_production_require_authorized_party=True,
        clerk_primary_environment="production",
    )

    assert [item.name for item in settings.clerk_environments] == [
        "development",
        "production",
    ]
    production = settings.clerk_environment_for_issuer(
        "https://clerk.hafa-recipes.com/"
    )
    assert production is not None
    assert production.audience == ["mobile", "web"]
    assert production.authorized_parties == (
        "https://hafa-recipes.com",
        "hafa://callback",
    )
    assert production.require_authorized_party is True
    assert settings.primary_clerk_environment == production


def test_unconfigured_legacy_clerk_settings_do_not_create_placeholder_issuer():
    settings = _settings("postgresql://user:pass@example.com/db")

    assert settings.clerk_issuer == ""
    assert settings.clerk_environments == ()


def test_local_database_can_disable_ssl_but_production_cannot():
    local = Settings(
        database_url="postgresql://localhost/hafa_test",
        database_use_ssl=False,
        openai_api_key="test-openai-key",
        environment="development",
    )
    assert local.database_use_ssl is False

    with pytest.raises(ValidationError, match="DATABASE_USE_SSL"):
        Settings(
            database_url="postgresql://production.example/hafa",
            database_use_ssl=False,
            openai_api_key="test-openai-key",
            environment="production",
        )
