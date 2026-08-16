import socket

import httpx
import pytest
from fastapi import HTTPException

import app.security as security
from app.security import (
    PublicHTTPTransport,
    assert_public_http_url,
    is_public_http_url,
    resolve_public_http_url,
)


def test_is_public_http_url_rejects_private_and_non_http_urls():
    assert is_public_http_url("https://example.com/recipes") is True
    assert is_public_http_url("http://localhost:8000/internal") is False
    assert is_public_http_url("http://127.0.0.1:8000/internal") is False
    assert is_public_http_url("file:///etc/passwd") is False


@pytest.mark.asyncio
async def test_assert_public_http_url_rejects_localhost_before_dns_lookup():
    with pytest.raises(HTTPException) as exc_info:
        await assert_public_http_url("http://localhost:8000/internal")

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_assert_public_http_url_rejects_non_http_schemes():
    with pytest.raises(HTTPException) as exc_info:
        await assert_public_http_url("ftp://example.com/recipe")

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_resolve_public_http_url_rejects_private_dns_results(monkeypatch):
    def fake_getaddrinfo(hostname, port):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", port))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

    with pytest.raises(HTTPException) as exc_info:
        await resolve_public_http_url("https://example.com/recipe")

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_resolve_public_http_url_returns_validated_public_ip(monkeypatch):
    def fake_getaddrinfo(hostname, port):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

    assert await resolve_public_http_url("https://example.com/recipe") == (
        "example.com",
        443,
        "93.184.216.34",
    )


@pytest.mark.asyncio
async def test_public_transport_revalidates_redirect_destinations(monkeypatch):
    requested_hosts = []

    async def fake_resolve(url):
        host = httpx.URL(url).host
        if host == "public.example":
            return host, 443, "93.184.216.34"
        raise HTTPException(status_code=400, detail="This URL is not supported")

    def public_server(request):
        requested_hosts.append(request.url.host)
        return httpx.Response(
            302,
            headers={"Location": "http://169.254.169.254/latest/meta-data"},
        )

    monkeypatch.setattr(security, "resolve_public_http_url", fake_resolve)

    transport = PublicHTTPTransport()
    transport._transport = httpx.MockTransport(public_server)

    with pytest.raises(HTTPException) as exc_info:
        async with httpx.AsyncClient(
            transport=transport,
            follow_redirects=True,
        ) as client:
            await client.get("https://public.example/short-link")

    assert exc_info.value.status_code == 400
    assert requested_hosts == ["93.184.216.34"]
