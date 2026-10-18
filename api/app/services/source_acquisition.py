"""Product-independent, bounded source metadata acquisition.

Adapters return evidence or a typed failure. Product extractors decide whether
that evidence is sufficient, and retain their own consent and payment budgets.
"""

import asyncio
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx
from bs4 import BeautifulSoup

from app.http_limits import ResponseTooLarge, get_limited
from app.security import PublicHTTPTransport
from app.source_urls import canonicalize_source

TRANSIENT_SOURCE_ERRORS = frozenset({
    "TIMEOUT", "RATE_LIMITED", "MEDIA_BUSY", "SOURCE_UNAVAILABLE", "SOURCE_RESPONSE_INVALID",
})


@dataclass(frozen=True)
class AcquisitionFailure:
    stage: str
    code: str


@dataclass
class MetadataAcquisition:
    metadata: object
    failures: list[AcquisitionFailure] = field(default_factory=list)


def source_failure_code(failures, default="NO_CONTENT"):
    """A failed recovery channel may be transient; do not invent a login error."""
    codes = [failure.code for failure in failures if failure.code]
    for code in codes:
        if code in TRANSIENT_SOURCE_ERRORS:
            return code
    for code in codes:
        if code in {"INSTAGRAM_AUTH_REQUIRED", "VIDEO_PRIVATE", "VIDEO_REMOVED", "NOT_FOUND", "ACCOUNT_NOT_FOUND"}:
            return code
    return next((code for code in codes if code != "NO_CONTENT"), default)


async def public_instagram_metadata(url, *, page_loader=None):
    """Read only bounded public metadata for the exact original source."""
    from app.services.video import VideoMetadata

    if page_loader is not None:
        current, soup = await page_loader(url)
    else:
        from app.services.website import WebsiteService

        async with httpx.AsyncClient(timeout=20, transport=PublicHTTPTransport()) as client:
            response = await get_limited(
                client, url, headers=WebsiteService.HEADERS, max_bytes=2 * 1024 * 1024,
            )
            response.raise_for_status()
            if "text/html" not in response.headers.get("content-type", ""):
                return VideoMetadata(error_code="SOURCE_RESPONSE_INVALID")
            current = str(response.url)
            soup = BeautifulSoup(response.text, "lxml")
    original_key = canonicalize_source(url).key
    if not original_key or canonicalize_source(current).key != original_key:
        code = "INSTAGRAM_AUTH_REQUIRED" if urlsplit(current).path.startswith(("/accounts/login", "/challenge/")) else "SOURCE_REDIRECT_MISMATCH"
        return VideoMetadata(error_code=code)

    def meta(*names):
        for name in names:
            tag = soup.find("meta", attrs={"property": name}) or soup.find(
                "meta", attrs={"name": name}
            )
            if tag and isinstance(tag.get("content"), str) and tag["content"].strip():
                return tag["content"].strip()
        return ""

    title = meta("og:title", "twitter:title")
    creator = meta("author", "article:author")
    if not creator and " on Instagram:" in title:
        creator = title.split(" on Instagram:", 1)[0]
    return VideoMetadata(
        title=title, description=meta("og:description", "description", "twitter:description"),
        uploader=creator, thumbnail=meta("og:image", "twitter:image") or None,
    )


async def acquire_video_metadata(service, url, platform, *, public_reader=None, deadline=None):
    """Merge available fields without replacing a caption already acquired.

    Instagram oEmbed is deliberately excluded: Meta limits it to embedding,
    rather than extracting or retaining content for domain processing.
    """
    from app.services.video import VideoMetadata

    result = MetadataAcquisition(VideoMetadata())
    adapters = [("downloader_metadata", lambda: service.get_video_metadata_ytdlp(url))]
    if platform == "instagram":
        adapters.append(("public_metadata", lambda: (public_reader or public_instagram_metadata)(url)))
    else:
        adapters.append(("oembed", lambda: service.fetch_oembed(url, platform)))
    for stage, read in adapters:
        if all(getattr(result.metadata, key, None) for key in ("title", "description", "uploader", "thumbnail")):
            break
        try:
            if deadline is None:
                candidate = await read()
            else:
                remaining = max(0, deadline - asyncio.get_running_loop().time())
                candidate = await asyncio.wait_for(read(), timeout=remaining)
            code = getattr(candidate, "error_code", None)
            if code:
                result.failures.append(AcquisitionFailure(stage, code))
            for key in ("title", "description", "uploader", "thumbnail", "duration"):
                if not getattr(result.metadata, key, None) and getattr(candidate, key, None):
                    setattr(result.metadata, key, getattr(candidate, key))
        except (asyncio.TimeoutError, httpx.TimeoutException):
            result.failures.append(AcquisitionFailure(stage, "TIMEOUT"))
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            code = {401: "INSTAGRAM_AUTH_REQUIRED", 403: "ACCESS_DENIED", 404: "NOT_FOUND", 429: "RATE_LIMITED"}.get(status, "SOURCE_UNAVAILABLE")
            result.failures.append(AcquisitionFailure(stage, code))
        except ResponseTooLarge:
            result.failures.append(AcquisitionFailure(stage, "SOURCE_TOO_LARGE"))
        except Exception as exc:
            # Adapter-specific deterministic limits must not schedule retries.
            # Allowlist codes without coupling this shared layer to a domain.
            code = {
                "website_size_limit": "SOURCE_TOO_LARGE",
                "website_content_unsupported": "SOURCE_CONTENT_UNSUPPORTED",
                "website_redirect_limit": "SOURCE_REDIRECT_LIMIT",
                "website_redirect_invalid": "SOURCE_REDIRECT_MISMATCH",
                "invalid_source_url": "SOURCE_INVALID",
            }.get(getattr(exc, "code", None), "SOURCE_UNAVAILABLE")
            # Neither raw provider responses nor private URLs belong in logs.
            result.failures.append(AcquisitionFailure(stage, code))
    return result
