"""Security helpers for validating and fetching outbound URLs.

The API fetches user-provided recipe pages and external thumbnails. These helpers
keep those fetches limited to public HTTP(S) destinations so the server cannot be
used to reach localhost, cloud metadata, or private network hosts.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from contextvars import ContextVar
from urllib.parse import urlparse

import httpcore
import httpx
from fastapi import HTTPException, status

_ALLOWED_SCHEMES = {"http", "https"}
_BLOCKED_HOSTS = {"localhost", "localhost.localdomain"}
_BLOCKED_SUFFIXES = (".local", ".internal", ".localhost")
_DEFAULT_PORTS = {"http": 80, "https": 443}


def _hostname_is_blocked(hostname: str) -> bool:
    host = hostname.strip().lower().rstrip(".")

    if not host or host in _BLOCKED_HOSTS or host.endswith(_BLOCKED_SUFFIXES):
        return True

    try:
        ip = ipaddress.ip_address(host)
        return _ip_is_blocked(ip)
    except ValueError:
        return False


def _ip_is_blocked(ip: ipaddress._BaseAddress) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        # ::ffff:127.0.0.1 reaches the IPv4 host, so judge the IPv4 address.
        return _ip_is_blocked(ip.ipv4_mapped)
    return any(
        [
            # Anything outside globally routable space: private, CGNAT
            # (100.64.0.0/10), benchmarking, documentation, and similar ranges.
            not ip.is_global,
            ip.is_private,
            ip.is_loopback,
            ip.is_link_local,
            ip.is_multicast,
            ip.is_reserved,
            ip.is_unspecified,
        ]
    )


def _parse_public_url(url: str):
    if not url or not isinstance(url, str):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL is required")

    parsed = urlparse(url.strip())
    if parsed.scheme.lower() not in _ALLOWED_SCHEMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only HTTP and HTTPS URLs are supported",
        )

    hostname = parsed.hostname
    if (
        not hostname or _hostname_is_blocked(hostname) or "%" in hostname
        or parsed.username is not None or parsed.password is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This URL is not supported",
        )

    return parsed


def resolve_public_http_url_sync(url: str) -> tuple[str, int, str]:
    """Validate a URL and return a public IP pinned for the outbound request."""
    parsed = _parse_public_url(url)
    hostname = parsed.hostname or ""
    try:
        port = parsed.port or _DEFAULT_PORTS[parsed.scheme.lower()]
    except ValueError:
        raise HTTPException(status_code=400, detail="This URL is not supported") from None

    try:
        addr_info = socket.getaddrinfo(hostname, port)
    except socket.gaierror:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve this URL",
        )

    public_ips: list[str] = []
    for item in addr_info:
        ip_text = item[4][0]
        try:
            ip = ipaddress.ip_address(ip_text)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This URL is not supported",
            )

        if _ip_is_blocked(ip):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This URL is not supported",
            )
        public_ips.append(ip_text)

    if not public_ips:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve this URL",
        )

    # Render's outbound network is IPv4-only in production. Prefer a validated
    # IPv4 address when a CDN publishes both families, while retaining IPv6 as
    # the fallback for IPv6-only environments.
    public_ips.sort(key=lambda value: ipaddress.ip_address(value).version)
    return hostname, port, public_ips[0]


async def resolve_public_http_url(url: str) -> tuple[str, int, str]:
    return await asyncio.to_thread(resolve_public_http_url_sync, url)


async def assert_public_http_url(url: str) -> None:
    """Raise HTTPException if a URL does not point to a public HTTP(S) host."""
    await resolve_public_http_url(url)


def _host_header(hostname: str, port: int, scheme: str) -> str:
    default_port = _DEFAULT_PORTS[scheme]
    host = f"[{hostname}]" if ":" in hostname else hostname
    return host if port == default_port else f"{host}:{port}"


_proxy_tls_target: ContextVar[tuple[str, str] | None] = ContextVar("public_proxy_tls_target", default=None)


class _PublicProxyStream(httpcore.NetworkStream):
    """HTTPcore CONNECT uses its IP origin for TLS; restore the original name.

    HTTPcore 1.0.9 ignores the sni_hostname extension in proxy tunnels. Keep its
    CONNECT authority pinned, while retaining certificate verification and SNI.
    The proxy's own HTTPS handshake, when present, must retain its own hostname.
    """

    def __init__(self, stream, target, *, proxy_hostname=None):
        self.stream, self.target = stream, target
        self.proxy_hostname = proxy_hostname

    def read(self, max_bytes, timeout=None):
        return self.stream.read(max_bytes, timeout)

    def write(self, buffer, timeout=None):
        return self.stream.write(buffer, timeout)

    def close(self):
        self.stream.close()

    def get_extra_info(self, info):
        return self.stream.get_extra_info(info)

    def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        if self.proxy_hostname is not None:
            # HTTPcore forwards the target's sni_hostname extension to the
            # proxy connection too; the first handshake belongs to the proxy.
            server_hostname, self.proxy_hostname = self.proxy_hostname, None
        else:
            hostname, pinned_ip = self.target
            if server_hostname != pinned_ip:
                raise httpcore.ConnectError("Unexpected public proxy TLS destination")
            server_hostname = hostname
        self.stream = self.stream.start_tls(ssl_context, server_hostname, timeout)
        return self


class _PublicProxyBackend(httpcore.NetworkBackend):
    def __init__(self, *, proxy_hostname=None, backend=None):
        self.backend = backend or httpcore.SyncBackend()
        self.proxy_hostname = proxy_hostname

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        target = _proxy_tls_target.get()
        if target is None:
            raise httpcore.ConnectError("Missing public proxy destination")
        stream = self.backend.connect_tcp(host, port, timeout, local_address, socket_options)
        return _PublicProxyStream(stream, target, proxy_hostname=self.proxy_hostname)


class PublicSyncHTTPTransport(httpx.BaseTransport):
    """Pinned HTTP(S) for the isolated downloader, optionally via a trusted proxy.

    An HTTP(S) proxy receives a literal-IP CONNECT target. No target-side DNS is
    delegated to it. Disable connection reuse: two domains may share a CDN IP,
    but their TLS/cookie identities must never share an IP-keyed connection.
    """

    def __init__(self, *, proxy=None):
        if proxy and httpx.URL(proxy).scheme not in {"http", "https"}:
            raise ValueError("Public media requires an HTTP(S) proxy")
        self._transport = httpx.HTTPTransport(
            proxy=proxy, trust_env=False,
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=0),
        )
        if proxy:
            # Pinned httpx/httpcore adapter, covered by real HTTPcore wire tests.
            self._transport._pool._network_backend = _PublicProxyBackend(
                proxy_hostname=httpx.URL(proxy).host if httpx.URL(proxy).scheme == "https" else None
            )

    def handle_request(self, request):
        original = request.url
        hostname, port, ip_text = resolve_public_http_url_sync(str(original))
        headers = request.headers.copy()
        headers["Host"] = _host_header(hostname, port, original.scheme)
        extensions = dict(request.extensions)
        if original.scheme == "https":
            extensions["sni_hostname"] = hostname
        pinned = httpx.Request(
            request.method, original.copy_with(host=ip_text), headers=headers,
            stream=request.stream, extensions=extensions,
        )
        token = _proxy_tls_target.set((hostname, ip_text))
        try:
            return self._transport.handle_request(pinned)
        finally:
            _proxy_tls_target.reset(token)

    def close(self):
        self._transport.close()


class PublicHTTPTransport(httpx.AsyncBaseTransport):
    """HTTPX transport that pins requests to a validated public IP address.

    URL validation alone leaves a DNS-rebinding gap because the HTTP client may
    resolve the hostname again when it opens the socket. This transport resolves
    and validates the target itself, rewrites the socket destination to the
    validated IP, and preserves the original Host header and HTTPS SNI hostname.
    """

    def __init__(self, **kwargs):
        self._transport = httpx.AsyncHTTPTransport(trust_env=False, **kwargs)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        original_url = request.url
        scheme = original_url.scheme.lower()
        hostname, port, ip_text = await resolve_public_http_url(str(original_url))

        headers = request.headers.copy()
        headers["Host"] = _host_header(hostname, port, scheme)
        extensions = dict(request.extensions)
        if scheme == "https":
            extensions["sni_hostname"] = hostname

        # Never mutate the client-visible request. HTTPX uses its URL when it
        # records response.url and resolves redirects. Leaking the pinned IP
        # there turns a safe socket detail into the canonical application URL
        # and also breaks TLS on follow-up requests because certificates are
        # issued for the original hostname, not the CDN IP.
        network_request = httpx.Request(
            method=request.method,
            url=original_url.copy_with(host=ip_text),
            headers=headers,
            stream=request.stream,
            extensions=extensions,
        )

        return await self._transport.handle_async_request(network_request)

    async def aclose(self) -> None:
        await self._transport.aclose()


def is_public_http_url(url: str) -> bool:
    """Synchronous lightweight URL validation for non-FastAPI callers."""
    try:
        parsed = _parse_public_url(url)
        return parsed.scheme.lower() in _ALLOWED_SCHEMES
    except Exception:
        return False
