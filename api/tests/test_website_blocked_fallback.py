"""Bot-walled recipe sites and the job errors a failed website import reports."""

import time

import httpx
import pytest
from curl_cffi.requests.exceptions import Timeout as CurlTimeout
from fastapi import HTTPException

from app.http_limits import ResponseTooLarge
from app.job_worker import should_retry_extraction_error
from app.services import website as website_module
from app.services.website import ERROR_MESSAGES, WebsiteExtractionResult, WebsiteService


def far_future():
    return time.monotonic() + 60


def blocked(request):
    return httpx.Response(403, text="Attention Required")


@pytest.fixture
def httpx_blocked(monkeypatch):
    monkeypatch.setattr(
        "app.services.website.PublicHTTPTransport", lambda: httpx.MockTransport(blocked)
    )


def test_failed_website_results_carry_the_fields_the_job_worker_reads():
    # The extraction worker reads friendly_error/error_code on every failed
    # result; their absence crashed every failed website import.
    result = WebsiteExtractionResult(
        success=False, error=ERROR_MESSAGES["fetch_403"], error_type="fetch_403"
    )

    assert result.friendly_error == ERROR_MESSAGES["fetch_403"]
    assert result.error_code == "WEBSITE_BLOCKED"
    assert not should_retry_extraction_error(result.error_code)
    assert "Paste text" in result.friendly_error


@pytest.mark.parametrize(
    ("error_type", "code", "retry"),
    [
        ("fetch_timeout", "TIMEOUT", True),
        ("fetch_404", "WEBSITE_NOT_FOUND", False),
        ("no_content", "NO_RECIPE_FOUND", False),
        ("fetch_failed", "WEBSITE_UNAVAILABLE", False),
        ("something_new", "EXTRACTION_FAILED", False),
    ],
)
def test_website_error_codes(error_type, code, retry):
    result = WebsiteExtractionResult(success=False, error="x", error_type=error_type)

    assert result.error_code == code
    assert should_retry_extraction_error(result.error_code) is retry


def test_successful_results_have_no_error_code():
    assert WebsiteExtractionResult(success=True).error_code is None


@pytest.mark.asyncio
async def test_blocked_page_is_retried_with_a_browser_fingerprint(monkeypatch, httpx_blocked):
    calls = []

    def fake_get(url, impersonate, deadline):
        calls.append(impersonate)
        if impersonate == "safari":
            return 403, "challenge"
        return 200, "<html>recipe</html>"

    monkeypatch.setattr(website_module, "_impersonated_get", fake_get)

    html, error = await WebsiteService._fetch_html_with_error("https://example.com/r")

    assert (html, error) == ("<html>recipe</html>", None)
    assert calls == ["safari", "safari_ios"]


@pytest.mark.asyncio
async def test_still_blocked_after_every_fingerprint(monkeypatch, httpx_blocked):
    monkeypatch.setattr(website_module, "_impersonated_get", lambda url, imp, deadline: (403, "no"))

    assert await WebsiteService._fetch_html_with_error("https://example.com/r") == (
        None,
        "fetch_403",
    )


@pytest.mark.asyncio
async def test_a_site_that_stays_unavailable_is_not_reported_as_blocking(monkeypatch):
    monkeypatch.setattr(
        "app.services.website.PublicHTTPTransport",
        lambda: httpx.MockTransport(lambda request: httpx.Response(503)),
    )
    monkeypatch.setattr(website_module, "_impersonated_get", lambda url, imp, deadline: (503, "down"))

    assert await WebsiteService._fetch_html_with_error("https://example.com/r") == (
        None,
        "fetch_failed",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("raised", "error"),
    [
        (HTTPException(status_code=400, detail="This URL is not supported"), "invalid_url"),
        (ResponseTooLarge(16), "fetch_too_large"),
    ],
)
async def test_fingerprint_fetch_keeps_url_and_size_guards(monkeypatch, httpx_blocked, raised, error):
    def fake_get(url, impersonate, deadline):
        raise raised

    monkeypatch.setattr(website_module, "_impersonated_get", fake_get)

    assert await WebsiteService._fetch_html_with_error("https://example.com/r") == (None, error)


class FakeResponse:
    def __init__(self, status, headers=None, chunks=(), charset=None):
        self.status_code = status
        self.headers = headers or {}
        self._chunks = chunks
        self.charset_encoding = charset

    def iter_content(self):
        yield from self._chunks


class FakeSession:
    responses: list = []
    opened: list = []
    sessions: list = []
    private: set = set()

    @classmethod
    def reset(cls, responses):
        cls.responses, cls.opened, cls.sessions, cls.private = responses, [], [], set()

    def __init__(self, url, total_timeout=None):
        if url in FakeSession.private:
            raise HTTPException(status_code=400, detail="This URL is not supported")
        FakeSession.opened.append(url)
        FakeSession.sessions.append(self)
        self.total_timeout = total_timeout
        self.closed = False

    def request(self, method, *, headers, data, timeout, impersonate):
        return FakeSession.responses.pop(0)

    def close(self):
        self.closed = True


def test_impersonated_get_validates_each_redirect_hop(monkeypatch):
    # Each hop opens a new pinned session, so a redirect to a private address
    # is validated (and refused) by PublicCurlSession before connecting.
    FakeSession.reset([
        FakeResponse(301, {"Location": "/recipe"}),
        FakeResponse(200, chunks=[b"<html>", "café".encode("latin-1")], charset="latin-1"),
    ])
    monkeypatch.setattr(website_module, "PublicCurlSession", FakeSession)

    status, text = website_module._impersonated_get("https://example.com/old", "safari", far_future())

    assert status == 200
    assert text == "<html>café"
    assert FakeSession.opened == ["https://example.com/old", "https://example.com/recipe"]


def test_impersonated_get_caps_the_body(monkeypatch):
    FakeSession.reset([FakeResponse(200, chunks=[b"x" * 10, b"y" * 10])])
    monkeypatch.setattr(website_module, "PublicCurlSession", FakeSession)
    monkeypatch.setattr(website_module, "MAX_HTML_BYTES", 16)

    with pytest.raises(ResponseTooLarge):
        website_module._impersonated_get("https://example.com/r", "safari", far_future())


def test_impersonated_get_refuses_a_redirect_to_a_private_address(monkeypatch):
    FakeSession.reset([FakeResponse(302, {"Location": "http://169.254.169.254/latest"})])
    FakeSession.private = {"http://169.254.169.254/latest"}
    monkeypatch.setattr(website_module, "PublicCurlSession", FakeSession)

    with pytest.raises(HTTPException):
        website_module._impersonated_get("https://example.com/r", "safari", far_future())
    assert FakeSession.sessions[0].closed


def test_error_pages_are_not_downloaded(monkeypatch):
    # A huge 403 body must not turn "blocked" into "too large".
    FakeSession.reset([FakeResponse(403, chunks=[b"x" * 100])])
    monkeypatch.setattr(website_module, "PublicCurlSession", FakeSession)
    monkeypatch.setattr(website_module, "MAX_HTML_BYTES", 16)

    assert website_module._impersonated_get("https://example.com/r", "safari", far_future()) == (403, "")


def test_each_hop_gets_the_remaining_budget_and_an_expired_one_stops(monkeypatch):
    FakeSession.reset([FakeResponse(200, chunks=[b"<html>"])])
    monkeypatch.setattr(website_module, "PublicCurlSession", FakeSession)

    website_module._impersonated_get("https://example.com/r", "safari", time.monotonic() + 20)
    assert 0 < FakeSession.sessions[0].total_timeout <= 20
    with pytest.raises(website_module.FetchDeadlineExceeded):
        website_module._impersonated_get("https://example.com/r", "safari", time.monotonic() - 1)


@pytest.mark.asyncio
async def test_browser_timeouts_stay_retryable(monkeypatch):
    monkeypatch.setattr(
        "app.services.website.PublicHTTPTransport",
        lambda: httpx.MockTransport(lambda request: httpx.Response(429)),
    )

    def fake_get(url, impersonate, deadline):
        raise CurlTimeout("timed out")

    monkeypatch.setattr(website_module, "_impersonated_get", fake_get)

    assert await WebsiteService._fetch_html_with_error("https://example.com/r") == (None, "fetch_timeout")


@pytest.mark.asyncio
@pytest.mark.parametrize("answered_status,expected", [
    (None, "fetch_timeout"), (403, "fetch_403"),
    (429, "fetch_failed"), (503, "fetch_failed"),
])
async def test_streamed_timeouts_preserve_answered_status_precedence(
    monkeypatch, httpx_blocked, answered_status, expected,
):
    answered = False

    def fake_get(url, impersonate, deadline):
        nonlocal answered
        if answered_status is not None and not answered:
            answered = True
            return answered_status, ""
        raise website_module.CurlRequestError(
            "stream operation timed out", code=website_module.CurlECode.OPERATION_TIMEDOUT,
        )

    monkeypatch.setattr(website_module, "_impersonated_get", fake_get)
    assert await WebsiteService._fetch_html_with_error("https://example.com/r") == (None, expected)


@pytest.mark.asyncio
async def test_unexpected_fallback_errors_report_unavailable(monkeypatch, httpx_blocked):
    def fake_get(url, impersonate, deadline):
        raise MemoryError("connect policy")

    monkeypatch.setattr(website_module, "_impersonated_get", fake_get)

    assert await WebsiteService._fetch_html_with_error("https://example.com/r") == (None, "fetch_failed")
