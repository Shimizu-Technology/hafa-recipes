"""Ephemeral, ordered photo acquisition shared by all three products."""

import asyncio
import base64
from urllib.parse import urljoin

import httpx

from app.http_limits import MAX_REMOTE_IMAGES_TOTAL_BYTES, get_limited
from app.image_validation import normalize_thumbnail_image, validate_image_bytes
from app.security import PublicHTTPTransport, assert_public_http_url

# 35 slides at 1600px is well below the model's image/context limits. Keep the
# normalized payload below 12MiB (16MiB base64); downloaded bytes below 40MiB.
MAX_PHOTO_IMAGES = 35
MAX_PHOTO_PAYLOAD_BYTES = 12 * 1024 * 1024


def parse_tiktok_photo(item, identifier):
    """Validate the locked SDK's itemStruct contract without retaining raw data."""
    if not isinstance(item, dict) or str(item.get("id")) != identifier:
        raise ValueError("Photo response identity changed")
    post = item.get("imagePost")
    if not isinstance(post, dict) or not isinstance(post.get("images"), list) or not post["images"]:
        raise ValueError("Photo response shape changed")
    slides = []
    for slide in post["images"]:
        urls = slide.get("imageURL", {}).get("urlList") if isinstance(slide, dict) else None
        # Keep holes in their original positions: one malformed slide must not
        # discard the caption and every other readable slide.
        urls = [u for u in urls if isinstance(u, str)] if isinstance(urls, list) else []
        slides.append(list(dict.fromkeys(urls))[:3])
    if not any(slides):
        raise ValueError("Photo image shape changed")
    author = item.get("author") or {}
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
    images, notes = [], []
    download_budget = MAX_REMOTE_IMAGES_TOTAL_BYTES
    normalized_bytes = 0
    parallel = asyncio.Semaphore(2)
    from app.services.video import public_video_service

    async with public_video_service._media_slot(), httpx.AsyncClient(
        timeout=25, follow_redirects=False, max_redirects=5, trust_env=False,
        transport=PublicHTTPTransport(), headers={"Referer": referer},
    ) as client:
        async def read_slide(index, mirrors):
            nonlocal download_budget, normalized_bytes
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
                            response.raise_for_status()
                            download_budget += cap - len(response.content)
                            valid = validate_image_bytes(
                                response.content, max_bytes=4 * 1024 * 1024,
                                declared_content_type=response.headers.get("content-type"),
                            )
                            # The central 40MP/12000px limit applies before
                            # decoding. Model images fit below the 4MP limit.
                            image = normalize_thumbnail_image(valid, max_dimension=1600)
                            if normalized_bytes + len(image.data) > MAX_PHOTO_PAYLOAD_BYTES:
                                break
                            normalized_bytes += len(image.data)
                            return index, base64.b64encode(image.data).decode("ascii")
                    except Exception:
                        # Provider text and signed URLs never enter logs/notes.
                        continue
                return None

        # gather returns in post order even when downloads finish out of order.
        results = await asyncio.gather(*(read_slide(i, mirrors)
                                       for i, mirrors in enumerate(slides[:MAX_PHOTO_IMAGES])))
        for index, result in enumerate(results):
            if result is None:
                notes.append(f"Slide {index + 1} could not be read; its details may be missing.")
            else:
                images.append(result)
        if len(images) < len(slides):
            notes.insert(0, f"Read {len(images)} of {len(slides)} slides; {len(slides) - len(images)} slides were left out.")
        if len(slides) > MAX_PHOTO_IMAGES:
            notes.insert(0, f"Only the first {MAX_PHOTO_IMAGES} of {len(slides)} slides were read; remaining slides were left out.")
    return images, notes


async def probe_photo_post(service, url):
    """No AI or persistence. A vanished canary fails rather than choosing a new post."""
    async with asyncio.timeout(90):
        post = await service.fetch_photo_post(url)
        images, notes = await download_photo_images(post["slides"])
        return {
            "status": "ok" if images and post["description"].strip() and not notes else "failed",
            "slides": len(post["slides"]), "images_read": len(images),
            "caption_chars": len(post["description"]), "coverage_notes": len(notes),
        }


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
