"""Regression coverage for bounded normal-video visual evidence."""

import asyncio
import base64
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app.services.extractor import (
    RecipeExtractor,
    _check_extraction_confidence,
    _visual_recovery_improves,
)
from app.services.llm_client import ExtractionResult, LLMService
from app.services.prompts import get_video_frame_extraction_prompt
from app.services.video import (
    AudioExtractionResult,
    VideoFrame,
    VideoFrameExtractionResult,
    VideoMetadata,
    VideoService,
)


def _recipe(*, quantity: str | None = "2", steps: int = 2) -> dict:
    return {
        "title": "Red Rice",
        "sourceUrl": "https://example.test/video",
        "servings": None,
        "times": {"prep": None, "cook": None, "total": None},
        "components": [
            {
                "name": "Main",
                "ingredients": [
                    {
                        "quantity": quantity,
                        "unit": "cups" if quantity else None,
                        "name": "rice",
                        "notes": None,
                        "estimatedCost": 2.0,
                    }
                ],
                "steps": [f"Supported step {index}." for index in range(steps)],
                "notes": None,
            }
        ],
        "equipment": [],
        "notes": None,
        "mealTypes": ["dinner"],
        "tags": ["rice"],
        "totalEstimatedCost": 2.0,
        "costLocation": "Guam",
        "lowConfidence": quantity is None,
        "confidenceWarning": "Verify the rice amount." if quantity is None else None,
        "nutrition": {
            "perServing": {
                key: None
                for key in ("calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium")
            },
            "total": {
                key: None
                for key in ("calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium")
            },
        },
    }


def test_periodic_frames_cover_opening_closing_and_middle():
    """Deterministic sampling must cover the full video without unbounded frames."""

    timestamps = VideoService._periodic_frame_timestamps(100.0)

    assert timestamps == [0.0, 14.962, 34.912, 54.863, 74.812, 99.75]


def test_visual_recovery_requires_improvement_without_losing_coverage():
    """A visual result cannot replace a broader text draft just because it exists."""

    initial = _recipe(quantity=None, steps=2)

    assert _visual_recovery_improves(initial, _recipe(quantity="2", steps=2)) is True
    assert _visual_recovery_improves(initial, _recipe(quantity="2", steps=1)) is False
    assert _visual_recovery_improves(_recipe(quantity="2"), _recipe(quantity="2")) is False
    assert _visual_recovery_improves(
        _recipe(quantity="not stated"),
        _recipe(quantity="2"),
    ) is True


def test_confidence_uses_the_review_layers_nullish_quantity_semantics():
    """Every accuracy gate must treat serialized source sentinels as missing."""

    is_low_confidence, warning = _check_extraction_confidence(
        _recipe(quantity="unknown"),
        " ".join(["supported recipe transcript"] * 20),
        "high",
        True,
    )

    assert is_low_confidence is True
    assert warning is not None
    assert "1 ingredient amount was not stated" in warning


class _CompletedMediaProcess:
    """Minimal successful subprocess used by bounded-download tests."""

    returncode = 0

    async def communicate(self):
        return b"", b""


@pytest.mark.asyncio
async def test_frame_download_rejects_oversize_file(monkeypatch, tmp_path):
    """The post-download byte check protects against downloader bypasses."""

    (tmp_path / "source.mp4").write_bytes(b"oversize")
    monkeypatch.setattr("app.services.video.settings.video_frame_max_bytes", 4)
    monkeypatch.setattr(
        "app.services.video.asyncio.create_subprocess_exec",
        AsyncMock(return_value=_CompletedMediaProcess()),
    )

    with pytest.raises(RuntimeError, match="size limit"):
        await VideoService()._download_video_for_frames(
            "https://www.youtube.com/watch?v=bounded",
            str(tmp_path),
        )


@pytest.mark.asyncio
async def test_frame_download_rejects_overduration_file(monkeypatch, tmp_path):
    """The probed duration is enforced even when downloader metadata is wrong."""

    (tmp_path / "source.mp4").write_bytes(b"video")
    monkeypatch.setattr("app.services.video.settings.video_frame_max_bytes", 100)
    monkeypatch.setattr("app.services.video.settings.video_frame_max_duration_seconds", 5)
    monkeypatch.setattr(
        "app.services.video.asyncio.create_subprocess_exec",
        AsyncMock(return_value=_CompletedMediaProcess()),
    )
    service = VideoService()
    monkeypatch.setattr(service, "_get_media_duration", AsyncMock(return_value=6.0))

    with pytest.raises(RuntimeError, match="duration limit"):
        await service._download_video_for_frames(
            "https://www.youtube.com/watch?v=bounded",
            str(tmp_path),
        )


@pytest.mark.asyncio
async def test_candidate_frames_dedupe_scenes_and_enforce_cap(monkeypatch, tmp_path):
    """Periodic coverage wins; repeated scenes are dropped within the hard cap."""

    service = VideoService()

    async def write_periodic(_video_path, output_path, _timestamp):
        Path(output_path).write_bytes(b"0")
        return True

    duplicate_scene = tmp_path / "scene-01.jpg"
    distinct_scene = tmp_path / "scene-02.jpg"
    overflow_scene = tmp_path / "scene-03.jpg"
    duplicate_scene.write_bytes(b"0")
    distinct_scene.write_bytes(str((1 << 64) - 1).encode())
    overflow_scene.write_bytes(str((1 << 63) - 1).encode())
    monkeypatch.setattr("app.services.video.settings.video_frame_max_count", 7)
    monkeypatch.setattr(service, "_write_frame", AsyncMock(side_effect=write_periodic))
    monkeypatch.setattr(
        service,
        "_write_scene_change_frames",
        AsyncMock(
            return_value=[
                (1.0, str(duplicate_scene)),
                (2.0, str(distinct_scene)),
                (3.0, str(overflow_scene)),
            ]
        ),
    )
    monkeypatch.setattr(service, "_image_fingerprint", lambda value: int(value.decode()))

    frames = await service._extract_candidate_frames("video.mp4", str(tmp_path), 100.0)

    assert len(frames) == 7
    assert frames[-1].timestamp_seconds == 99.75
    assert base64.b64encode(distinct_scene.read_bytes()).decode("ascii") in {
        frame.image_base64 for frame in frames
    }
    assert base64.b64encode(overflow_scene.read_bytes()).decode("ascii") not in {
        frame.image_base64 for frame in frames
    }


@pytest.mark.asyncio
async def test_per_frame_timeout_is_contained(monkeypatch, tmp_path):
    """A slow seek skips one frame without discarding the remaining candidates."""

    class TimedOutProcess:
        returncode = None

        async def communicate(self):
            raise asyncio.TimeoutError

        def kill(self):
            self.returncode = -9

        async def wait(self):
            return self.returncode

    monkeypatch.setattr(
        "app.services.video.asyncio.create_subprocess_exec",
        AsyncMock(return_value=TimedOutProcess()),
    )

    written = await VideoService()._write_frame(
        "video.mp4",
        str(tmp_path / "frame.jpg"),
        1.0,
    )

    assert written is False


@pytest.mark.asyncio
async def test_scene_frames_without_parsed_timestamps_are_dropped(monkeypatch, tmp_path):
    """Owner evidence never receives a fabricated timestamp for an unmatched JPEG."""

    (tmp_path / "scene-01.jpg").write_bytes(b"one")
    (tmp_path / "scene-02.jpg").write_bytes(b"two")

    class SceneProcess(_CompletedMediaProcess):
        async def communicate(self):
            return b"", b"pts_time:4.25"

    monkeypatch.setattr(
        "app.services.video.asyncio.create_subprocess_exec",
        AsyncMock(return_value=SceneProcess()),
    )

    frames = await VideoService()._write_scene_change_frames(
        "video.mp4",
        str(tmp_path),
    )

    assert frames == [(4.25, str(tmp_path / "scene-01.jpg"))]


@pytest.mark.asyncio
async def test_scene_timeout_preserves_periodic_fallback(monkeypatch, tmp_path):
    """Optional scene analysis may time out without failing periodic coverage."""

    class TimedOutSceneProcess:
        returncode = None

        async def communicate(self):
            raise asyncio.TimeoutError

        def kill(self):
            self.returncode = -9

        async def wait(self):
            return self.returncode

    monkeypatch.setattr(
        "app.services.video.asyncio.create_subprocess_exec",
        AsyncMock(return_value=TimedOutSceneProcess()),
    )

    frames = await VideoService()._write_scene_change_frames(
        "video.mp4",
        str(tmp_path),
    )

    assert frames == []


@pytest.mark.asyncio
async def test_frame_media_is_cleaned_after_success(monkeypatch, tmp_path):
    """Downloaded videos and JPEGs must not survive a successful request."""

    owned_dir = tmp_path / "owned-frames"
    owned_dir.mkdir()
    video_path = owned_dir / "source.mp4"
    video_path.write_bytes(b"video")
    service = VideoService()
    monkeypatch.setattr("app.services.video.tempfile.mkdtemp", lambda **_: str(owned_dir))
    monkeypatch.setattr(
        service,
        "_download_video_for_frames",
        AsyncMock(return_value=(str(video_path), 5.0)),
    )
    monkeypatch.setattr(
        service,
        "_extract_candidate_frames",
        AsyncMock(return_value=[VideoFrame(1.25, "synthetic-base64")]),
    )

    result = await service.extract_video_frames("https://example.test/video")

    assert result.success is True
    assert not owned_dir.exists()


@pytest.mark.asyncio
async def test_frame_media_is_cleaned_on_failure_and_cancellation(monkeypatch, tmp_path):
    """Failure and worker cancellation must use the same cleanup boundary."""

    service = VideoService()
    failure_dir = tmp_path / "failure-frames"
    failure_dir.mkdir()
    monkeypatch.setattr("app.services.video.tempfile.mkdtemp", lambda **_: str(failure_dir))
    monkeypatch.setattr(
        service,
        "_download_video_for_frames",
        AsyncMock(side_effect=RuntimeError("download failed")),
    )

    result = await service.extract_video_frames("https://example.test/video")

    assert result.success is False
    assert result.error_code == "VIDEO_FRAME_EXTRACTION_FAILED"
    assert not failure_dir.exists()

    cancelled_dir = tmp_path / "cancelled-frames"
    cancelled_dir.mkdir()
    monkeypatch.setattr("app.services.video.tempfile.mkdtemp", lambda **_: str(cancelled_dir))
    monkeypatch.setattr(
        service,
        "_download_video_for_frames",
        AsyncMock(side_effect=asyncio.CancelledError),
    )

    with pytest.raises(asyncio.CancelledError):
        await service.extract_video_frames("https://example.test/video")
    assert not cancelled_dir.exists()


def test_video_frame_prompt_forbids_visual_quantity_guessing():
    """Frames may recover visible evidence but never imply hidden measurements."""

    prompt = get_video_frame_extraction_prompt(
        source_url="https://example.test/video",
        source_context="SPOKEN CONTENT: Add the rice.",
        initial_recipe=_recipe(quantity=None),
        frame_timestamps=[0.0, 4.5],
    )

    assert "tentative draft is a convenience, not evidence" in prompt
    assert "Never guess powders, liquids, seasonings" in prompt
    assert "Use null for every unstated quantity" in prompt
    assert "[0.0, 4.5]" in prompt


@pytest.mark.asyncio
async def test_video_frame_model_call_receives_timestamp_labels(monkeypatch):
    """Every image sent to the model must retain its source timestamp label."""

    service = LLMService()
    service.openai_api_key = "test-key"
    model_call = AsyncMock(return_value=ExtractionResult(success=True, recipe=_recipe()))
    monkeypatch.setattr(service, "_try_multi_image_extraction", model_call)

    result = await service.extract_from_video_frames(
        images_base64=["/9j/a", "/9j/b"],
        frame_timestamps=[0.0, 4.5],
        source_url="https://example.test/video",
        source_context="Add 2 cups rice.",
        initial_recipe=_recipe(quantity=None),
        use_fallback=False,
    )

    assert result.success is True
    assert model_call.await_args.kwargs["image_labels"] == [
        "VIDEO FRAME @ 0.00 SECONDS",
        "VIDEO FRAME @ 4.50 SECONDS",
    ]


@pytest.mark.asyncio
async def test_on_screen_only_recipe_can_recover_before_text_generation(monkeypatch):
    """A music-only transcript may recover when sampled frames contain the recipe."""

    monkeypatch.setattr("app.services.extractor.settings.video_frame_extraction_enabled", True)
    monkeypatch.setattr(
        "app.services.extractor.video_service.fetch_oembed",
        AsyncMock(return_value=VideoMetadata(title="Family favorite")),
    )
    monkeypatch.setattr(
        "app.services.extractor.video_service.download_audio",
        AsyncMock(return_value=AudioExtractionResult(success=False, error="no audio")),
    )
    monkeypatch.setattr(
        "app.services.extractor.video_service.get_video_metadata_ytdlp",
        AsyncMock(return_value=VideoMetadata(title="Family favorite")),
    )
    monkeypatch.setattr(
        "app.services.extractor.video_service.extract_video_frames",
        AsyncMock(
            return_value=VideoFrameExtractionResult(
                success=True,
                frames=[VideoFrame(2.5, "/9j/synthetic")],
            )
        ),
    )
    visual_call = AsyncMock(return_value=ExtractionResult(success=True, recipe=_recipe()))
    text_call = AsyncMock()
    monkeypatch.setattr(
        "app.services.extractor.llm_service.extract_from_video_frames",
        visual_call,
    )
    monkeypatch.setattr("app.services.extractor.llm_service.extract_recipe", text_call)

    result = await RecipeExtractor().extract(
        "https://www.youtube.com/watch?v=on-screen-only"
    )

    assert result.success is True
    assert result.extraction_method == "basic+video-frames"
    assert result.source_evidence == {
        "modalities": ["metadata", "video_frames"],
        "frames": [{"timestampSeconds": 2.5}],
        "sourceArtifactsRetained": False,
    }
    text_call.assert_not_awaited()


@pytest.mark.asyncio
async def test_failed_visual_recovery_preserves_existing_text_draft(monkeypatch):
    """A narrower visual candidate must not replace a useful uncertain text draft."""

    monkeypatch.setattr("app.services.extractor.settings.video_frame_extraction_enabled", True)
    monkeypatch.setattr(
        "app.services.extractor.video_service.extract_video_frames",
        AsyncMock(
            return_value=VideoFrameExtractionResult(
                success=True,
                frames=[VideoFrame(2.5, "/9j/synthetic")],
            )
        ),
    )
    monkeypatch.setattr(
        "app.services.extractor.llm_service.extract_from_video_frames",
        AsyncMock(return_value=ExtractionResult(success=True, recipe=_recipe(steps=1))),
    )

    result = await RecipeExtractor()._attempt_video_frame_recovery(
        url="https://www.youtube.com/watch?v=uncertain",
        platform="youtube",
        location="Guam",
        source_context="Add the rice and simmer it.",
        initial_recipe=_recipe(quantity=None, steps=2),
        base_method="whisper",
        thumbnail_url=None,
        has_audio_transcript=True,
        progress_callback=None,
        enabled=True,
    )

    assert result is None
