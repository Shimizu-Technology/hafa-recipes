"""Explicit test-only wrapper: never import from app/main.py or Render."""

import asyncio
import os
import shutil
from pathlib import Path

from capacity.safety import OWNERS, ensure
from capacity.transport import TEXT, FixtureBudget, install_provider_transport

ensure()  # Before importing application settings or any external SDK.
transport = install_provider_transport(
    float(os.environ.get("CAPACITY_PROVIDER_DELAY", "0.25"))
)

from app.auth import ClerkUser, get_current_user
from app.config import get_settings
from app.domains.workouts import coach, imports
from app.domains.workouts.extraction import (
    ProductionExtractionProvider,
    WorkoutExtractor,
)
from app.image_validation import validate_image_bytes
from app.main import app
from app.services.storage import StorageService, storage_service
from app.services.video import (
    AudioExtractionResult,
    VideoMetadata,
    video_service,
)
from fastapi import HTTPException, Request

FIXTURES = Path("/fixtures")


async def identity(request: Request):
    owner = request.headers.get("X-Capacity-User")
    if owner not in OWNERS:
        raise HTTPException(401, "Synthetic capacity identity required")
    return ClerkUser(
        id=owner,
        clerk_user_id=owner,
        clerk_issuer="https://capacity.invalid",
        clerk_environment="test",
    )


app.dependency_overrides[get_current_user] = identity


class ExtractionProvider(ProductionExtractionProvider):
    @property
    def enabled(self):
        configured = get_settings()
        return configured.workouts_api_enabled and configured.workouts_ai_enabled


class CoachProvider(coach.ProductionCoachProvider):
    @property
    def enabled(self):
        configured = get_settings()
        return configured.workouts_api_enabled and configured.workouts_ai_enabled


imports.workout_import_worker.extractor = WorkoutExtractor(
    ExtractionProvider(budget_guard=FixtureBudget())
)
coach.workout_coach.provider = CoachProvider(budget_guard=FixtureBudget())


class FixtureS3:
    def put_object(self, **request):
        # Real prepared bytes are retained through the fake storage boundary.
        if not isinstance(request.get("Body"), bytes):
            raise TypeError("Unexpected fixture storage body")
        return {"ETag": "capacity"}

    def delete_object(self, **_):
        return {}


StorageService.is_enabled = property(lambda _: True)
storage_service._client = FixtureS3()


async def fetch_source(*_, **__):
    return validate_image_bytes(
        (FIXTURES / "cover.jpg").read_bytes(), max_bytes=5 * 1024 * 1024
    )


storage_service.fetch_thumbnail_source = fetch_source


async def metadata(*_, **__):
    return VideoMetadata(
        title="Capacity source",
        description=TEXT * 20,
        uploader="Synthetic fixture",
        thumbnail="https://capacity.invalid/cover.jpg",
        duration=12,
    )


async def download_frames(url, temp_dir):
    if not url.startswith("https://www.youtube.com/watch?v=capacity"):
        raise RuntimeError("Only synthetic media is permitted")
    await asyncio.sleep(0.05)
    target = Path(temp_dir) / "source.mp4"
    await asyncio.to_thread(shutil.copyfile, FIXTURES / "source.mp4", target)
    # Actual ffprobe/ffmpeg/frame helpers and media semaphore remain in use.
    duration = await video_service._get_media_duration(str(target))
    if duration is None:
        raise RuntimeError("Fixture ffprobe failed")
    return str(target), duration


async def download_audio(url):
    if not url.startswith("https://www.youtube.com/watch?v=capacity"):
        raise RuntimeError("Only synthetic audio is permitted")
    import tempfile

    folder = Path(tempfile.mkdtemp(prefix="capacity-audio-"))
    target = folder / "source.wav"
    await asyncio.to_thread(shutil.copyfile, FIXTURES / "source.wav", target)
    duration = await video_service._get_audio_duration(str(target))
    return AudioExtractionResult(
        success=bool(duration), file_path=str(target), duration=duration
    )


video_service._download_audio = download_audio
video_service.fetch_oembed = metadata
video_service.get_video_metadata_ytdlp = metadata
video_service._download_video_for_frames = download_frames


@app.get("/capacity/status")
async def capacity_status():
    return {
        "synthetic": True,
        "provider_attempts": transport.calls,
        "financial_guard": "synthetic throughput only",
        "auth": "fixture whitelist",
        "workouts_enabled": get_settings().workouts_api_enabled,
    }
