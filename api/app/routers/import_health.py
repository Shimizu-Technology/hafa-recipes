"""Bounded shared media checks. GitHub Actions owns daily scheduling."""

import asyncio
import math
import secrets
import shutil
import time
from pathlib import Path

import sentry_sdk
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.ai_governance import ai_request_context
from app.config import get_settings
from app.db import AsyncSessionLocal
from app.services.video import VIDEO_ERROR_PATTERNS, get_friendly_video_error, video_service

router = APIRouter(include_in_schema=False)
CANARIES = {
    "instagram": "https://www.instagram.com/reel/DehHrUVg7kB/",
    "tiktok": "https://www.tiktok.com/@feelgoodfoodie/video/6922938178559069446",
    "youtube": "https://www.youtube.com/watch?v=ATVUcl3Bv4U",
}
DEADLINE_SECONDS = 180
ERROR_CODES = frozenset(item["code"] for item in VIDEO_ERROR_PATTERNS.values()) | {
    "SOURCE_RESPONSE_INVALID", "SOURCE_UNAVAILABLE", "INSTAGRAM_ERROR", "TIKTOK_ERROR",
    "YOUTUBE_ERROR", "UNKNOWN_ERROR", "MEDIA_BUSY", "TIMEOUT", "SYSTEM_ERROR",
    "NO_AUDIO", "AUDIO_TOO_LARGE", "VIDEO_TOO_LONG", "NO_VIDEO_FRAMES",
    "VIDEO_FRAME_EXTRACTION_FAILED", "NO_METADATA", "CHECK_FAILED",
}


@router.post("/internal/import-health/{platform}")
async def import_health(platform: str, request: Request):
    started = time.monotonic()
    stage = "auth"
    platform = platform if platform in CANARIES else "unknown"

    def result(code=None, http_status=503):
        return JSONResponse({
            "status": "failed" if code else "ok", "platform": platform,
            "stage": stage, "error_code": code,
            "elapsed": round(time.monotonic() - started, 3),
        }, status_code=http_status if code else 200, headers={"Cache-Control": "no-store"})

    token = get_settings().import_health_token
    if token is None or not token.get_secret_value().strip():
        return result("DISABLED")
    expected = f"Bearer {token.get_secret_value()}".encode()
    if not secrets.compare_digest(request.headers.get("authorization", "").encode(), expected):
        return result("UNAUTHORIZED", 401)

    # Explicit context also protects direct calls/tests and cancellation cleanup.
    with ai_request_context(route="/internal/import-health"):
        try:
            async with asyncio.timeout(DEADLINE_SECONDS):
                stage = "input"
                if platform == "unknown" or request.query_params:
                    return result("INVALID_INPUT", 400)
                async for chunk in request.stream():
                    if chunk:
                        return result("INVALID_INPUT", 400)
                stage = "lock"
                async with AsyncSessionLocal() as db, db.begin():
                    # Cross-worker overlap exclusion only, never a once/day claim.
                    locked = await db.scalar(text("SELECT pg_try_advisory_xact_lock(:namespace, :key)"), {
                        "namespace": 0x48414641, "key": tuple(CANARIES).index(platform) + 1,
                    })
                    if not locked:
                        return result("CHECK_BUSY", 409)
                    url = CANARIES[platform]
                    stage = "metadata"
                    metadata = await video_service.get_video_metadata_ytdlp(url)
                    code = metadata.error_code
                    # Anonymous Instagram metadata omits duration, as it does for
                    # imports; the audio stage below still requires a measured one.
                    duration_optional = platform == "instagram" and not metadata.duration
                    if not code and not (
                        (metadata.title or metadata.description) and (duration_optional or (
                            metadata.duration and math.isfinite(metadata.duration)
                            and metadata.duration > 0
                        ))
                    ):
                        code = "NO_METADATA"
                    if not code and not duration_optional and metadata.duration > min(
                        get_settings().video_max_duration_seconds,
                        get_settings().video_frame_max_duration_seconds,
                    ):
                        code = "VIDEO_TOO_LONG"
                    if not code:
                        stage = "audio"
                        audio = await video_service.download_audio(url)
                        try:
                            code = audio.error_code
                            if not code and not (
                                audio.success and audio.file_path and Path(audio.file_path).is_file()
                                and 0 < Path(audio.file_path).stat().st_size <= get_settings().audio_max_bytes
                                and audio.duration and math.isfinite(audio.duration) and audio.duration > 0
                            ):
                                code = "NO_AUDIO"
                            if not code:
                                stage = "frames"
                                frames = await video_service.extract_video_frames(url)
                                code = frames.error_code
                                if code == "VIDEO_FRAME_EXTRACTION_FAILED" and frames.error:
                                    # Frame downloads currently wrap stderr in a generic
                                    # result. Classify it without emitting the raw value.
                                    code, _ = get_friendly_video_error(frames.error, platform)
                                if not code and not (frames.success and frames.frames and all(
                                    frame.image_base64 for frame in frames.frames
                                )):
                                    code = "NO_VIDEO_FRAMES"
                        finally:
                            # Successful downloads transfer their entire temp parent.
                            if audio.file_path:
                                shutil.rmtree(Path(audio.file_path).parent, ignore_errors=True)
                    if code:
                        code = code if code in ERROR_CODES else "CHECK_FAILED"
                    else:
                        stage = "complete"
        except TimeoutError:
            code = "TIMEOUT"
        except Exception:
            code = "CHECK_FAILED"
        if code:
            # One event per failed invocation; grouping is not deduplication.
            with sentry_sdk.isolation_scope() as scope:
                scope.set_tag("monitor", "import-health")
                scope.set_tag("platform", platform)
                scope.set_tag("stage", stage)
                sentry_sdk.capture_message("Shared media health check failed", level="error")
        return result(code)
