"""Byte caps on responses from untrusted remote hosts."""

import gzip
import json

import httpx
import pytest

from app.http_limits import ResponseTooLarge, get_limited
from app.services import video as video_module
from app.services.video import VideoService
from app.services.website import WebsiteService


@pytest.mark.asyncio
async def test_shared_instagram_public_metadata_has_a_byte_cap(monkeypatch):
    import app.services.source_acquisition as module

    monkeypatch.setattr(module, "PublicHTTPTransport", lambda: httpx.MockTransport(
        lambda request: httpx.Response(200, headers={"content-type": "text/html", "content-length": "99999999"})
    ))
    with pytest.raises(ResponseTooLarge):
        await module.public_instagram_metadata("https://www.instagram.com/reel/Example/")


@pytest.mark.asyncio
async def test_shared_instagram_rejects_login_redirect_metadata(monkeypatch):
    import app.services.source_acquisition as module

    def handler(request):
        if request.url.path.startswith("/reel/"):
            return httpx.Response(302, headers={"location": "/accounts/login/"})
        return httpx.Response(200, headers={"content-type": "text/html"}, text='<meta property="og:description" content="Login page, not evidence">')

    monkeypatch.setattr(module, "PublicHTTPTransport", lambda: httpx.MockTransport(handler))
    result = await module.public_instagram_metadata("https://www.instagram.com/reel/Example/")
    assert result.error_code == "INSTAGRAM_AUTH_REQUIRED" and not result.description


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_get_limited_buffers_small_bodies_like_a_normal_response():
    body = gzip.compress(json.dumps({"title": "Kelaguen"}).encode())

    def handler(request):
        return httpx.Response(
            200,
            headers={"content-encoding": "gzip", "content-type": "application/json"},
            content=body,
        )

    async with _client(handler) as client:
        response = await get_limited(client, "https://example.com/a", max_bytes=1024)

    assert response.json() == {"title": "Kelaguen"}
    response.raise_for_status()


@pytest.mark.asyncio
async def test_get_limited_stops_streaming_once_the_cap_is_crossed():
    sent = []

    async def chunks():
        for _ in range(100):
            sent.append(1)
            yield b"x" * 1024

    def handler(request):
        return httpx.Response(200, content=chunks())

    async with _client(handler) as client:
        with pytest.raises(ResponseTooLarge):
            await get_limited(client, "https://example.com/big", max_bytes=4096)

    assert len(sent) < 10


@pytest.mark.asyncio
async def test_get_limited_rejects_a_declared_oversize_body_before_reading():
    def handler(request):
        return httpx.Response(200, headers={"content-length": "999999"}, content=b"")

    async with _client(handler) as client:
        with pytest.raises(ResponseTooLarge):
            await get_limited(client, "https://example.com/big", max_bytes=10)


@pytest.mark.asyncio
async def test_website_fetch_reports_oversized_pages(monkeypatch):
    monkeypatch.setattr("app.services.website.MAX_HTML_BYTES", 16)
    monkeypatch.setattr(
        "app.services.website.PublicHTTPTransport",
        lambda: httpx.MockTransport(lambda request: httpx.Response(200, text="<html>" * 10)),
    )

    html, error = await WebsiteService._fetch_html_with_error("https://example.com/r")

    assert html is None
    assert error == "fetch_too_large"


@pytest.mark.asyncio
async def test_website_fetch_still_follows_redirects_within_the_cap(monkeypatch):
    def handler(request):
        if request.url.path == "/old":
            return httpx.Response(301, headers={"location": "/new"})
        return httpx.Response(200, text="<html>recipe</html>")

    monkeypatch.setattr(
        "app.services.website.PublicHTTPTransport", lambda: httpx.MockTransport(handler)
    )

    html, error = await WebsiteService._fetch_html_with_error("https://example.com/old")

    assert error is None
    assert html == "<html>recipe</html>"


@pytest.mark.asyncio
async def test_slideshow_downloads_skip_oversize_images_and_respect_the_total(monkeypatch):
    sizes = {"/a": 10, "/huge": 100, "/b": 10, "/c": 10}

    def handler(request):
        return httpx.Response(200, content=b"i" * sizes[request.url.path])

    monkeypatch.setattr(video_module, "MAX_REMOTE_IMAGE_BYTES", 50)
    monkeypatch.setattr(video_module, "MAX_REMOTE_IMAGES_TOTAL_BYTES", 25)
    monkeypatch.setattr(
        video_module, "PublicHTTPTransport", lambda: httpx.MockTransport(handler)
    )

    images = await VideoService().download_images_as_base64(
        [f"https://cdn.example.com{path}" for path in ("/a", "/huge", "/b", "/c")]
    )

    # /a and /b fit; /huge is skipped; /c would exceed the 25-byte total.
    assert len(images) == 2


@pytest.mark.asyncio
async def test_oembed_requests_encode_the_user_url(monkeypatch):
    seen = []

    def handler(request):
        seen.append(request.url)
        return httpx.Response(200, json={"title": "Pancit", "author_name": "Auntie"})

    real_client = httpx.AsyncClient

    def mock_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(video_module.httpx, "AsyncClient", mock_client)
    user_url = "https://www.youtube.com/watch?v=abc&list=x&format=xml"

    metadata = await VideoService().fetch_oembed(user_url, "youtube")

    assert metadata.title == "Pancit"
    assert seen[0].params["url"] == user_url
    assert seen[0].params["format"] == "json"
    assert seen[0].params.get_list("format") == ["json"]


@pytest.mark.asyncio
async def test_get_limited_follows_redirects_without_reading_redirect_bodies_whole():
    def handler(request):
        if request.url.path == "/hop":
            # A redirect with an oversized declared body must not be buffered.
            return httpx.Response(
                302, headers={"location": "/final", "content-length": "999999"}
            )
        if request.url.path == "/loop":
            return httpx.Response(302, headers={"location": "/loop"})
        return httpx.Response(200, text="done")

    async with _client(handler) as client:
        response = await get_limited(client, "https://example.com/hop", max_bytes=64)
        with pytest.raises(httpx.TooManyRedirects):
            await get_limited(client, "https://example.com/loop", max_bytes=64)
        manual = await get_limited(
            client, "https://example.com/hop", max_bytes=64, max_redirects=0
        )

    assert response.text == "done"
    assert [hop.status_code for hop in response.history] == [302]
    assert manual.status_code == 302
    assert manual.headers["location"] == "/final"
