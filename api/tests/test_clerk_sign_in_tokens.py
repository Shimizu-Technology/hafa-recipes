"""Clerk Backend API sign-in ticket contract tests."""

import json

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


@pytest.mark.asyncio
async def test_create_password_enabled_user_does_not_skip_clerk_password_requirements(monkeypatch):
    request: dict[str, object] = {}

    async def handler(incoming: httpx.Request) -> httpx.Response:
        body = json.loads(incoming.content)
        request.update(body)
        return httpx.Response(201, json={
            "id": "user_review",
            "primary_email_address_id": "email_review",
            "email_addresses": [{
                "id": "email_review",
                "email_address": "reviewer@example.com",
                "verification": {"status": "verified"},
            }],
            "external_id": "app_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "password_enabled": True,
        })

    transport = httpx.MockTransport(handler)
    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *_args, **kwargs: original_client(
            transport=transport,
            timeout=kwargs.get("timeout"),
        ),
    )

    profile = await ClerkBackendClient(_environment()).create_user(
        email="reviewer@example.com",
        external_id="app_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        first_name="App",
        last_name="Reviewer",
        password="a-safe-reviewer-password",
    )

    assert profile is not None
    assert profile.password_enabled is True
    assert request["password"] == "a-safe-reviewer-password"
    assert "skip_password_requirement" not in request


@pytest.mark.asyncio
async def test_list_redirect_urls_parses_the_bounded_clerk_inventory(monkeypatch):
    async def handler(incoming: httpx.Request) -> httpx.Response:
        assert incoming.url.path == "/v1/redirect_urls"
        assert incoming.url.params["limit"] == "100"
        assert incoming.url.params["offset"] == "0"
        return httpx.Response(200, json={
            "data": [
                {"id": "redirect_1", "url": "hafarecipes://oauth-callback"},
                {"id": "redirect_2", "url": "com.example://callback"},
                {"id": "malformed"},
            ],
            "total_count": 3,
        })

    transport = httpx.MockTransport(handler)
    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *_args, **kwargs: original_client(
            transport=transport,
            timeout=kwargs.get("timeout"),
        ),
    )

    result = await ClerkBackendClient(_environment()).list_redirect_urls()

    assert result == ("com.example://callback", "hafarecipes://oauth-callback")


@pytest.mark.asyncio
async def test_list_redirect_urls_reads_every_clerk_inventory_page(monkeypatch):
    requested_offsets: list[int] = []
    first_page = [
        {"id": f"redirect_{index}", "url": f"example{index}://callback"}
        for index in range(100)
    ]

    async def handler(incoming: httpx.Request) -> httpx.Response:
        offset = int(incoming.url.params["offset"])
        requested_offsets.append(offset)
        if offset == 0:
            return httpx.Response(200, json={
                "data": first_page,
                "total_count": 101,
            })
        assert offset == 100
        return httpx.Response(200, json={
            "data": [{
                "id": "redirect_native",
                "url": "hafarecipes://oauth-callback",
            }],
            "total_count": 101,
        })

    transport = httpx.MockTransport(handler)
    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *_args, **kwargs: original_client(
            transport=transport,
            timeout=kwargs.get("timeout"),
        ),
    )

    result = await ClerkBackendClient(_environment()).list_redirect_urls()

    assert requested_offsets == [0, 100]
    assert len(result) == 101
    assert "example0://callback" in result
    assert "hafarecipes://oauth-callback" in result


@pytest.mark.asyncio
async def test_list_redirect_urls_fails_closed_on_an_unexpected_response(monkeypatch):
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(200, json={"data": "not-a-list"})
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

    with pytest.raises(RuntimeError, match="redirect allowlist"):
        await ClerkBackendClient(_environment()).list_redirect_urls()
