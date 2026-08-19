"""Deterministic source URL canonicalization for duplicate detection.

Canonical keys are deliberately content-free: platform IDs stay readable for
operations, while arbitrary website URLs are represented by a SHA-256 digest.
The original/canonical URL remains on the recipe for attribution.
"""

from __future__ import annotations

import hashlib
import posixpath
import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING_QUERY_KEYS = {
    "fbclid",
    "gclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "ref",
    "ref_src",
    "si",
}


@dataclass(frozen=True)
class CanonicalSource:
    """A normalized attribution URL and its stable duplicate-detection key."""

    url: str
    key: str | None


def _is_tracking_key(key: str) -> bool:
    lowered = key.lower()
    return lowered.startswith("utm_") or lowered in TRACKING_QUERY_KEYS


def _normalized_web_url(url: str) -> str:
    parsed = urlsplit(url.strip())
    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if not scheme or not hostname:
        return url.strip()

    try:
        port = parsed.port
    except ValueError:
        return url.strip()

    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        host = f"{hostname}:{port}"
    else:
        host = hostname

    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    normalized_path = posixpath.normpath(path)
    if not normalized_path.startswith("/"):
        normalized_path = f"/{normalized_path}"
    if normalized_path != "/":
        normalized_path = normalized_path.rstrip("/")

    query = urlencode(
        sorted(
            (key, value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
            if not _is_tracking_key(key)
        ),
        doseq=True,
    )
    return urlunsplit((scheme, host, normalized_path, query, ""))


def canonicalize_source(url: str) -> CanonicalSource:
    """Return a stable URL/key pair without performing network requests.

    Manual and local photo placeholders intentionally have no key because one
    user can create many of them. Invalid/opaque values are also left unkeyed;
    provider validation remains responsible for rejecting unusable URLs.
    """

    stripped = url.strip()
    parsed = urlsplit(stripped)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    path = parsed.path or ""

    if parsed.scheme.lower() not in {"http", "https"} or not hostname:
        return CanonicalSource(url=stripped, key=None)

    if hostname in {"youtu.be", "youtube.com", "www.youtube.com", "m.youtube.com"} or hostname.endswith(".youtube.com"):
        video_id = None
        if hostname == "youtu.be":
            video_id = path.strip("/").split("/")[0]
        elif path == "/watch":
            video_id = dict(parse_qsl(parsed.query)).get("v")
        else:
            match = re.search(r"/(?:shorts|embed|live)/([A-Za-z0-9_-]{6,})", path)
            video_id = match.group(1) if match else None
        if video_id:
            return CanonicalSource(
                url=f"https://www.youtube.com/watch?v={video_id}",
                key=f"youtube:video:{video_id}",
            )

    if hostname == "tiktok.com" or hostname.endswith(".tiktok.com"):
        match = re.search(r"/(video|photo)/(\d+)", path, re.IGNORECASE)
        if match:
            kind, source_id = match.groups()
            kind = kind.lower()
            return CanonicalSource(
                url=_normalized_web_url(stripped),
                key=f"tiktok:{kind}:{source_id}",
            )

    if hostname == "instagram.com" or hostname.endswith(".instagram.com"):
        match = re.search(r"/(p|reel|tv)/([A-Za-z0-9_-]+)", path, re.IGNORECASE)
        if match:
            kind, shortcode = match.groups()
            kind = kind.lower()
            return CanonicalSource(
                url=f"https://www.instagram.com/{kind}/{shortcode}/",
                key=f"instagram:{kind}:{shortcode}",
            )

    normalized = _normalized_web_url(stripped)
    # Treat equivalent HTTP/HTTPS attribution URLs as the same logical source.
    identity = urlsplit(normalized)._replace(scheme="").geturl()
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return CanonicalSource(url=normalized, key=f"web:sha256:{digest}")
