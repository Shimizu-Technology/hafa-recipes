"""Clerk Backend API sign-in ticket contract tests."""

import httpx
import pytest

from app.config import ClerkEnvironment
from app.services.clerk import ClerkBackendClient


def _environment() -> ClerkEnvironment:
    return ClerkEnvironment(
        name="production",
        issuer="https://clerk.hafa-recipes.com",
        secret_key="production-secret",
        jwks_url="https://clerk.hafa-recipes.com/.well-known/jwks.json",
        audience=None,
        authorized_parties=(),
    )


@pytest.mark.asyncio
async def test_create_sign_in_token_uses_bounded_expiration(monkeypatch):
    request: dict[str, object] = {}

    async def handler(incoming: httpx.Request) -> httpx.Response:
        request["authorization"] = incoming.headers.get("Authorization")
        request["body"] = incoming.content.decode()
        return httpx.Response(200, json={"token": "one-use-ticket"})

    transport = httpx.MockTransport(handler)
    original_client = httpx.AsyncClient

    def client_factory(*_args, **kwargs):
        return original_client(transport=transport, timeout=kwargs.get("timeout"))

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    ticket = await ClerkBackendClient(_environment()).create_sign_in_token(
        "user_production",
        expires_in_seconds=60,
    )

    assert ticket == "one-use-ticket"
    assert request["authorization"] == "Bearer production-secret"
    assert request["body"] == (
        '{"user_id":"user_production","expires_in_seconds":60}'
    )


@pytest.mark.asyncio
async def test_create_sign_in_token_rejects_invalid_requests_before_network(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("network must not be called")
        ),
    )
    client = ClerkBackendClient(_environment())

    with pytest.raises(ValueError):
        await client.create_sign_in_token("../user", expires_in_seconds=60)
    with pytest.raises(ValueError):
        await client.create_sign_in_token("user_production", expires_in_seconds=301)


@pytest.mark.asyncio
async def test_create_sign_in_token_rejects_malformed_success(monkeypatch):
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(200, json={"url": "https://example.com"})
    )
    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *_args, **kwargs: original_client(
            transport=transport,
            timeout=kwargs.get("timeout"),
        ),
    )

    with pytest.raises(RuntimeError):
        await ClerkBackendClient(_environment()).create_sign_in_token(
            "user_production",
            expires_in_seconds=60,
        )
