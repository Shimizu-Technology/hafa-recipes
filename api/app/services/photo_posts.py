"""Ephemeral, ordered photo acquisition shared by all three products."""

import asyncio
import base64
import re
from contextlib import asynccontextmanager
from urllib.parse import urljoin

import httpx

from app.http_limits import MAX_REMOTE_IMAGES_TOTAL_BYTES, get_limited
from app.image_validation import ImagePixelLimitError, normalize_model_image
from app.security import PublicHTTPTransport, assert_public_http_url

# At most 35 slides, subject to 40MiB downloaded, 12MiB normalized and the
# deadline. Larger/heavier posts may be partial; every omission is disclosed.
MAX_REMOTE_IMAGE_PIXELS = 8_500_000
MAX_PHOTO_IMAGES = 35
MAX_PHOTO_PAYLOAD_BYTES = 12 * 1024 * 1024
PHOTO_ERROR_CODES = frozenset({
    "SOURCE_RESPONSE_INVALID", "SOURCE_UNAVAILABLE", "TIMEOUT", "MEDIA_BUSY", "RATE_LIMITED",
    "INSTAGRAM_AUTH_REQUIRED", "VIDEO_PRIVATE", "VIDEO_REMOVED", "NOT_FOUND", "ACCESS_DENIED",
    "BOT_DETECTION", "AGE_RESTRICTED", "ACCOUNT_NOT_FOUND",
})


class PhotoSourceError(ValueError):
    """Content-free acquisition code across the guarded subprocess boundary."""

    def __init__(self, code, *, stage="metadata", exception_type="PhotoSourceError"):
        self.code = code if code in PHOTO_ERROR_CODES else "SOURCE_UNAVAILABLE"
        self.stage = stage if stage in {"metadata", "page_read", "page_shape", "page_status", "page_maintenance"} else "metadata"
        self.exception_type = exception_type if isinstance(exception_type, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,79}", exception_type) else "PhotoSourceError"
        super().__init__(self.code)


@asynccontextmanager
async def photo_media_slot(service):
    from app.services.video import MediaCapacityExceeded
    try:
        async with service._media_slot():
            yield
    except MediaCapacityExceeded:
        raise PhotoSourceError("MEDIA_BUSY", exception_type="MediaCapacityExceeded") from None


def parse_tiktok_photo(item, identifier):
    """Validate the locked SDK's itemStruct contract without retaining raw data."""
    if not isinstance(item, dict) or str(item.get("id")) != identifier:
        raise ValueError("Photo response identity changed")
    post = item.get("imagePost")
    if not isinstance(post, dict) or not isinstance(post.get("images"), list) or not post["images"]:
        raise ValueError("Photo response shape changed")
    slides = []
    for slide in post["images"]:
        image_url = slide.get("imageURL") if isinstance(slide, dict) else None
        urls = image_url.get("urlList") if isinstance(image_url, dict) else None
        # Keep holes in their original positions: one malformed slide must not
        # discard the caption and every other readable slide.
        urls = [u for u in urls if isinstance(u, str)] if isinstance(urls, list) else []
        slides.append(list(dict.fromkeys(urls))[:3])
    if not any(slides):
        raise ValueError("Photo image shape changed")
    author = item.get("author") if isinstance(item.get("author"), dict) else {}
    return {
        "title": str(post.get("title") or item.get("desc") or "TikTok photo post")[:240],
        "description": str(item.get("desc") or "")[:12000],
        "uploader": str(author.get("uniqueId") or author.get("nickname") or "")[:240],
        "slides": slides,
    }


async def download_photo_images(slides, *, deadline=None, referer="https://www.tiktok.com/"):
    """Return (original index, normalized base64) and honest coverage notes.

    Each mirror/hop is public-IP validated by transport. No credentials, cookies,
    media persistence or all-or-nothing batch: one failed slide keeps the rest.
    """
    deadline = deadline or asyncio.get_running_loop().time() + 70
    images, notes, completed = [], [], {}
    download_budget = MAX_REMOTE_IMAGES_TOTAL_BYTES
    normalized_bytes = 0
    normalized_limited = False
    pixel_limited = set()
    parallel = asyncio.Semaphore(2)
    from app.services.video import public_video_service

    try:
        async with asyncio.timeout(max(0, deadline - asyncio.get_running_loop().time())):
            async with photo_media_slot(public_video_service), httpx.AsyncClient(
                timeout=25, follow_redirects=False, max_redirects=5, trust_env=False,
                transport=PublicHTTPTransport(), headers={"Referer": referer},
            ) as client:
                async def read_slide(index, mirrors):
                    nonlocal download_budget, normalized_bytes, normalized_limited
                    async with parallel:
                        for url in mirrors[:3]:
                            remaining = deadline - asyncio.get_running_loop().time()
                            if remaining <= 0 or download_budget <= 0:
                                break
                            # Reserve before yielding: concurrent requests cannot each
                            # spend the same bytes. Failed requests consume their cap.
                            cap = min(4 * 1024 * 1024, download_budget)
                            download_budget -= cap
                            try:
                                async with asyncio.timeout(min(remaining, 26)):
                                    await assert_public_http_url(url)
                                    for hop in range(6):
                                        client.cookies.clear()
                                        response = await get_limited(client, url, max_redirects=0, max_bytes=cap)
                                        if not response.is_redirect:
                                            break
                                        if hop == 5 or not response.headers.get("location"):
                                            raise ValueError("Photo redirect limit")
                                        url = urljoin(url, response.headers["location"])
                                        await assert_public_http_url(url)
                                    download_budget += cap - len(response.content)
                                    response.raise_for_status()
                                    image = await normalize_model_image(
                                        response.content, max_bytes=4 * 1024 * 1024,
                                        declared_content_type=response.headers.get("content-type"),
                                        max_pixels=MAX_REMOTE_IMAGE_PIXELS,
                                    )
                                    if normalized_bytes + len(image.data) > MAX_PHOTO_PAYLOAD_BYTES:
                                        normalized_limited = True
                                        break
                                    normalized_bytes += len(image.data)
                                    completed[index] = base64.b64encode(image.data).decode("ascii")
                                    return index, completed[index]
                            except ImagePixelLimitError:
                                pixel_limited.add(index)
                            except Exception:
                                # Provider text and signed URLs never enter logs/notes.
                                continue
                        return None

                # gather returns in post order even when downloads finish out of order.
                await asyncio.gather(*(read_slide(i, mirrors)
                                               for i, mirrors in enumerate(slides[:MAX_PHOTO_IMAGES])))
    except TimeoutError:
        pass
    for index in range(min(len(slides), MAX_PHOTO_IMAGES)):
        if index not in completed and index in pixel_limited:
            notes.append(f"Slide {index + 1} exceeds the {MAX_REMOTE_IMAGE_PIXELS / 1_000_000:g} MP image limit; its details may be missing.")
        elif index not in completed:
            notes.append(f"Slide {index + 1} could not be read; its details may be missing.")
        else:
            images.append((index, completed[index]))
    if len(images) < len(slides):
        notes.insert(0, f"Read {len(images)} of {len(slides)} slides; {len(slides) - len(images)} slides were left out.")
    if len(slides) > MAX_PHOTO_IMAGES:
        notes.insert(0, f"Only the first {MAX_PHOTO_IMAGES} of {len(slides)} slides were read; remaining slides were left out.")
    if download_budget <= 0 and len(images) < min(len(slides), MAX_PHOTO_IMAGES):
        notes.append("Image downloads reached the 40 MiB limit; some slides may be missing.")
    if normalized_limited:
        notes.append("Normalized images reached the 12 MiB limit; some slides may be missing.")
    return images, notes


async def probe_photo_post(service, url, *, on_stage=None):
    """No AI or persistence. A vanished canary fails rather than choosing a new post."""
    async with asyncio.timeout(90):
        if on_stage:
            on_stage("metadata")
        post = await service.fetch_photo_post(url)
        if on_stage:
            on_stage("images")
        images, notes = await download_photo_images(post["slides"])
        return {
            "status": "ok" if len(images) == len(post["slides"]) and images and post["description"].strip() and not notes else "failed",
            "slides": len(post["slides"]), "images_read": len(images),
            "caption_chars": len(post["description"]), "coverage_notes": len(notes),
        }


async def diagnose_photo_post(service, url):
    """Read-only operator report: counts, fixed stages and exception types only."""
    stage = "metadata"
    def record_stage(value):
        nonlocal stage
        stage = value
    try:
        result = await probe_photo_post(service, url, on_stage=record_stage)
        return {**result, "stage": "complete" if result["status"] == "ok" else stage,
                "exception_type": None if result["status"] == "ok" else "IncompleteCoverage"}
    except Exception as exc:
        safe = PhotoSourceError("SOURCE_UNAVAILABLE", stage=getattr(exc, "stage", "metadata"),
                                exception_type=getattr(exc, "exception_type", type(exc).__name__))
        return {"status": "failed", "stage": safe.stage if isinstance(exc, PhotoSourceError) else stage,
                "exception_type": safe.exception_type,
                "slides": 0, "images_read": 0, "caption_chars": 0, "coverage_notes": 0}


def parse_instagram_photo(info):
    """Raw SDK results retain stills before its 'no video formats' rejection."""
    entries = info.get("entries") or [info]
    slides = []
    for entry in entries:
        if entry.get("formats") or entry.get("url"):
            raise ValueError("Video or mixed post uses the video path")
        thumbnails = sorted(entry.get("thumbnails") or [],
                            key=lambda t: (t.get("width") or 0) * (t.get("height") or 0), reverse=True)
        urls = [t["url"] for t in thumbnails if isinstance(t.get("url"), str)]
        if not urls and entry.get("thumbnail"):
            urls = [entry["thumbnail"]]
        if not urls:
            raise ValueError("Photo response shape changed")
        slides.append(urls[:3])
    return {"title": info.get("title") or "Instagram photo post",
            "description": info.get("description") or "",
            "uploader": info.get("channel") or info.get("uploader") or "", "slides": slides}
