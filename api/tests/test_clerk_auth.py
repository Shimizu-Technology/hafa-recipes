from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.auth as auth
from app.config import Settings


def _settings(**overrides) -> Settings:
    values = {
        "database_url": "postgresql://user:pass@example.com/db",
        "openai_api_key": "test-openai-key",
        "clerk_frontend_api": "dev.example.clerk.accounts.dev",
        "clerk_secret_key": "sk_test_dev",
        "clerk_development_issuer": "https://dev.example.clerk.accounts.dev",
        "clerk_development_secret_key": "sk_test_dev",
        "clerk_production_issuer": "https://clerk.hafa-recipes.com",
        "clerk_production_secret_key": "sk_live_prod",
        "clerk_production_authorized_parties": "https://hafa-recipes.com",
    }
    values.update(overrides)
    return Settings(**values)


class _SigningKeyClient:
    def get_signing_key_from_jwt(self, _token):
        return SimpleNamespace(key="public-key")


def test_verify_clerk_token_uses_exact_issuer_and_environment_policy(monkeypatch):
    monkeypatch.setattr(auth, "settings", _settings())
    monkeypatch.setattr(auth, "_get_jwks_client", lambda _environment: _SigningKeyClient())
    calls = []

    def fake_decode(_token, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return {"iss": "https://clerk.hafa-recipes.com"}
        return {
            "iss": "https://clerk.hafa-recipes.com",
            "sub": "user_prod",
            "exp": 9999999999,
            "azp": "https://hafa-recipes.com",
        }

    monkeypatch.setattr(auth.jwt, "decode", fake_decode)

    verified = auth.verify_clerk_token("header.payload.signature")

    assert verified.subject == "user_prod"
    assert verified.environment_name == "production"
    assert calls[1]["issuer"] == "https://clerk.hafa-recipes.com"
    assert calls[1]["algorithms"] == ["RS256"]


def test_verify_clerk_token_rejects_unrecognized_issuer_before_jwks(monkeypatch):
    monkeypatch.setattr(auth, "settings", _settings())
    monkeypatch.setattr(
        auth.jwt,
        "decode",
        lambda _token, **_kwargs: {"iss": "https://attacker.example"},
    )

    with pytest.raises(HTTPException) as error:
        auth.verify_clerk_token("header.payload.signature")

    assert error.value.status_code == 401


def test_verify_clerk_token_rejects_wrong_authorized_party(monkeypatch):
    monkeypatch.setattr(auth, "settings", _settings())
    monkeypatch.setattr(auth, "_get_jwks_client", lambda _environment: _SigningKeyClient())
    calls = 0

    def fake_decode(_token, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"iss": "https://clerk.hafa-recipes.com"}
        return {
            "iss": "https://clerk.hafa-recipes.com",
            "sub": "user_prod",
            "exp": 9999999999,
            "azp": "https://evil.example",
        }

    monkeypatch.setattr(auth.jwt, "decode", fake_decode)

    with pytest.raises(HTTPException) as error:
        auth.verify_clerk_token("header.payload.signature")

    assert error.value.status_code == 401


def test_verify_clerk_token_can_require_authorized_party_claim(monkeypatch):
    monkeypatch.setattr(
        auth,
        "settings",
        _settings(clerk_production_require_authorized_party=True),
    )
    monkeypatch.setattr(auth, "_get_jwks_client", lambda _environment: _SigningKeyClient())
    calls = 0

    def fake_decode(_token, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"iss": "https://clerk.hafa-recipes.com"}
        return {
            "iss": "https://clerk.hafa-recipes.com",
            "sub": "user_prod",
            "exp": 9999999999,
        }

    monkeypatch.setattr(auth.jwt, "decode", fake_decode)

    with pytest.raises(HTTPException) as error:
        auth.verify_clerk_token("header.payload.signature")

    assert error.value.status_code == 401


def test_verify_clerk_token_allows_missing_party_for_native_tokens_by_default(
    monkeypatch,
):
    monkeypatch.setattr(auth, "settings", _settings())
    monkeypatch.setattr(auth, "_get_jwks_client", lambda _environment: _SigningKeyClient())
    calls = 0

    def fake_decode(_token, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"iss": "https://clerk.hafa-recipes.com"}
        return {
            "iss": "https://clerk.hafa-recipes.com",
            "sub": "user_prod",
            "exp": 9999999999,
        }

    monkeypatch.setattr(auth.jwt, "decode", fake_decode)

    verified = auth.verify_clerk_token("header.payload.signature")

    assert verified.subject == "user_prod"


@pytest.mark.asyncio
async def test_optional_user_allows_requests_without_credentials():
    assert await auth.get_optional_user(credentials=None, db=SimpleNamespace()) is None


@pytest.mark.asyncio
async def test_optional_user_preserves_invalid_credential_error(monkeypatch):
    async def reject_credentials(**_kwargs):
        raise HTTPException(status_code=401, detail="Invalid session")

    monkeypatch.setattr(auth, "get_current_user", reject_credentials)

    with pytest.raises(HTTPException) as error:
        await auth.get_optional_user(
            credentials=SimpleNamespace(credentials="expired-token"),
            db=SimpleNamespace(),
        )

    assert error.value.status_code == 401
