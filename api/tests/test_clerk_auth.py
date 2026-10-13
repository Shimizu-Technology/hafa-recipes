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


class _CountingJWKClient(auth.ThrottledPyJWKClient):
    """Throttled client whose JWKS fetches are counted instead of performed."""

    def __init__(self, clock):
        super().__init__(
            "https://clerk.example.test/.well-known/jwks.json",
            min_refresh_interval=60,
            clock=clock,
            cache_keys=True,
        )
        self.fetches: list[bool] = []
        self.keys = [SimpleNamespace(key_id="known", key="known-key")]
        self.cached: list | None = None

    def get_signing_keys(self, refresh: bool = False):
        self.fetches.append(refresh)
        if refresh or self.cached is None:
            self.cached = list(self.keys)
        return self.cached


def test_unknown_kid_refreshes_jwks_at_most_once_per_interval():
    now = [100.0]
    client = _CountingJWKClient(lambda: now[0])

    assert client.get_signing_key("known").key == "known-key"
    for _ in range(5):
        with pytest.raises(auth.PyJWKClientError):
            client.get_signing_key("forged")

    assert client.fetches.count(True) == 1

    # A rotated key published later is picked up after the interval passes.
    now[0] += 61
    client.keys.append(SimpleNamespace(key_id="rotated", key="rotated-key"))
    assert client.get_signing_key("rotated").key == "rotated-key"
    assert client.fetches.count(True) == 2


def test_jwks_clients_are_throttled_with_a_short_fetch_timeout(monkeypatch):
    monkeypatch.setattr(auth, "_jwks_clients", {})
    environment = _settings().clerk_environment_for_issuer("https://clerk.hafa-recipes.com")

    client = auth._get_jwks_client(environment)

    assert isinstance(client, auth.ThrottledPyJWKClient)
    assert client.timeout == auth.JWKS_FETCH_TIMEOUT_SECONDS
    assert auth._get_jwks_client(environment) is client


@pytest.mark.asyncio
async def test_current_user_verifies_tokens_off_the_event_loop(monkeypatch):
    import threading

    loop_thread = threading.get_ident()
    verified_on: list[int] = []
    token = auth.VerifiedClerkToken(
        subject="user_1",
        environment_name="development",
        issuer="https://dev.example.clerk.accounts.dev",
        claims={"first_name": "Ada"},
    )

    def verify(_raw):
        verified_on.append(threading.get_ident())
        return token

    async def resolve(_db, _token):
        return SimpleNamespace(app_user_id="app_user_1"), None

    monkeypatch.setattr(auth, "verify_clerk_token", verify)
    monkeypatch.setattr(auth, "_resolve_identity", resolve)

    user = await auth.get_current_user(
        credentials=SimpleNamespace(credentials="raw-token"), db=object()
    )

    assert user.id == "app_user_1"
    assert verified_on and verified_on[0] != loop_thread


@pytest.mark.parametrize(
    ("deployment", "clerk_environment", "admin_environments", "expected"),
    [
        ("production", "production", "production", True),
        ("production", "development", "production", False),
        ("production", "legacy", "production", False),
        ("production", "development", "production,development", True),
        ("development", "development", "production", True),
        ("test", "development", "production", True),
    ],
)
def test_admin_role_counts_only_from_allowed_clerk_environments(
    monkeypatch, deployment, clerk_environment, admin_environments, expected
):
    monkeypatch.setattr(
        auth,
        "settings",
        _settings(
            environment=deployment,
            clerk_admin_environments=admin_environments,
            database_url="postgresql://user:pass@localhost:5432/db",
        ),
    )
    user = auth.ClerkUser(
        id="app_user",
        clerk_user_id="user_1",
        clerk_issuer="https://issuer.example.test",
        clerk_environment=clerk_environment,
        role="admin",
    )

    assert user.is_admin is expected
