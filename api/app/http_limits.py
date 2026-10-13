"""Byte caps for responses from untrusted remote hosts.

``response.text`` and ``response.content`` buffer whatever the remote sends.
A recipe page, scraped TikTok page, or CDN image can therefore exhaust API
memory. These helpers stream the body and stop as soon as a cap is crossed.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

MAX_HTML_BYTES = 5 * 1024 * 1024
MAX_OEMBED_BYTES = 256 * 1024
MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024
MAX_REMOTE_IMAGES_TOTAL_BYTES = 40 * 1024 * 1024

# Headers that describe the wire encoding of the original body. The buffered
# copy is already decoded, so carrying them over would decode it twice.
_WIRE_HEADERS = {"content-encoding", "content-length", "transfer-encoding"}


class ResponseTooLarge(Exception):
    """A remote body exceeded its byte cap."""

    def __init__(self, max_bytes: int):
        self.max_bytes = max_bytes
        super().__init__(f"Remote response exceeded {max_bytes} bytes")


def _declared_length(response: httpx.Response) -> int | None:
    try:
        return int(response.headers["content-length"])
    except (KeyError, ValueError):
        return None


async def read_limited(response: httpx.Response, max_bytes: int) -> bytes:
    """Read a streamed response body, raising once it exceeds ``max_bytes``."""
    declared = _declared_length(response)
    if declared is not None and declared > max_bytes:
        raise ResponseTooLarge(max_bytes)
    payload = bytearray()
    async for chunk in response.aiter_bytes():
        payload.extend(chunk)
        if len(payload) > max_bytes:
            raise ResponseTooLarge(max_bytes)
    return bytes(payload)


async def send_limited(
    client: httpx.AsyncClient,
    request: httpx.Request,
    *,
    max_bytes: int,
    follow_redirects: bool | None = None,
) -> httpx.Response:
    """Send ``request`` and return a fully buffered response capped at ``max_bytes``.

    The returned response supports ``.text``, ``.json()`` and
    ``raise_for_status()`` exactly like a normal buffered response.
    """
    kwargs: dict[str, Any] = {"stream": True}
    if follow_redirects is not None:
        kwargs["follow_redirects"] = follow_redirects
    response = await client.send(request, **kwargs)
    try:
        if response.is_redirect:
            # Redirect bodies are never used; callers only need the headers.
            return _buffered_copy(response, b"")
        body = await read_limited(response, max_bytes)
    finally:
        await response.aclose()
    return _buffered_copy(response, body)


async def get_limited(
    client: httpx.AsyncClient,
    url: str,
    *,
    max_bytes: int,
    headers: Mapping[str, str] | None = None,
    params: Mapping[str, str] | None = None,
    follow_redirects: bool | None = None,
) -> httpx.Response:
    """GET ``url`` with a capped, fully buffered body."""
    request = client.build_request("GET", url, headers=headers, params=params)
    return await send_limited(
        client, request, max_bytes=max_bytes, follow_redirects=follow_redirects
    )


def _buffered_copy(response: httpx.Response, body: bytes) -> httpx.Response:
    headers = [
        (name, value)
        for name, value in response.headers.multi_items()
        if name.lower() not in _WIRE_HEADERS
    ]
    buffered = httpx.Response(
        status_code=response.status_code,
        headers=headers,
        content=body,
        request=response.request,
        extensions=response.extensions,
    )
    buffered.history = list(response.history)
    return buffered
