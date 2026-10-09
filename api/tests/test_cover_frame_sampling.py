"""Cover sampling spans the source and always releases its bounded resources."""

import asyncio
import base64
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import video
from app.services.video import VideoFrame, VideoService


@pytest.fixture
def cover_settings(monkeypatch):
    values = video.settings.model_dump()
    values["recipe_cover_frame_max_count"] = 12
    configured = SimpleNamespace(**values)
    monkeypatch.setattr(video, "settings", configured)
    return configured


def test_cover_anchors_include_early_reveals_middle_and_late_plating():
    timestamps = VideoService._cover_frame_timestamps(100)
    assert len(timestamps) == 9
    assert timestamps[:4] == [0.5, 89.775, 4.988, 95.76]
    assert any(30 < timestamp < 60 for timestamp in timestamps)
    assert timestamps[-1] == 99.75
    # Preserve the evidence policy: no mandatory cover frame or scene changes.
    assert VideoService._periodic_frame_timestamps(100) == [
        0.0, 14.962, 34.912, 54.863, 74.812, 99.75,
    ]


@pytest.mark.parametrize("duration", [0.1, 0.25, 0.4, 0.8, 1.0])
def test_tiny_video_anchors_are_unique_and_within_source(duration):
    timestamps = VideoService._cover_frame_timestamps(duration)
    assert len(timestamps) == len(set(timestamps))
    assert all(0 <= timestamp < duration for timestamp in timestamps)


@pytest.mark.asyncio
async def test_all_cover_candidates_are_deduped_and_scene_budget_spans_source(
    monkeypatch, tmp_path, cover_settings,
):
    service = VideoService()
    writes = []

    async def write_anchor(_video, output, timestamp):
        writes.append(timestamp)
        # Opening and an early reveal repeat the same dish image. Later images
        # differ by eight or more bits, making their retention deterministic.
        index = len(writes) - 1
        fingerprint = 0 if index == 2 else ((1 << (index * 8)) - 1)
        Path(output).write_bytes(str(fingerprint).encode())
        return True

    scene_calls = []

    async def write_scene(_video, _directory, **kwargs):
        scene_calls.append(kwargs)
        paths = []
        for index in range(kwargs["frame_limit"]):
            output = tmp_path / f'{kwargs["output_prefix"]}-{index}.jpg'
            output.write_bytes(b"0")  # Duplicates must also be dropped for scenes.
            paths.append((kwargs.get("start_seconds", 0) + index + 1, str(output)))
        return paths

    monkeypatch.setattr(service, "_write_frame", AsyncMock(side_effect=write_anchor))
    monkeypatch.setattr(service, "_write_scene_change_frames", AsyncMock(side_effect=write_scene))
    monkeypatch.setattr(service, "_image_fingerprint", lambda value: int(value))

    frames = await service._extract_cover_candidate_frames("video", str(tmp_path), 100)

    assert len(writes) == 9
    assert scene_calls == [
        {"frame_limit": 1, "output_prefix": "cover-scene-opening"},
        {"start_seconds": 70, "frame_limit": 2, "output_prefix": "cover-scene-closing"},
    ]
    assert len(frames) == 8
    assert len({frame.image_base64 for frame in frames}) == 8
    assert frames[0].timestamp_seconds == 0.5
    assert frames[-1].timestamp_seconds == 99.75
    assert frames == sorted(frames, key=lambda frame: frame.timestamp_seconds)


@pytest.mark.asyncio
@pytest.mark.parametrize("cap", [1, 4, 6, 9, 12, 100])
async def test_cover_budget_caps_work_not_just_returned_frames(
    monkeypatch, tmp_path, cover_settings, cap,
):
    cover_settings.recipe_cover_frame_max_count = cap
    service = VideoService()
    write = AsyncMock(return_value=False)
    scenes = AsyncMock(return_value=[])
    monkeypatch.setattr(service, "_write_frame", write)
    monkeypatch.setattr(service, "_write_scene_change_frames", scenes)

    assert await service._extract_cover_candidate_frames("video", str(tmp_path), 100) == []

    requested = write.await_count + sum(
        call.kwargs["frame_limit"] for call in scenes.await_args_list
    )
    assert requested == min(12, cap)
    if cap >= 4:
        assert any(call.args[2] >= 89 for call in write.await_args_list)
        assert any(call.args[2] < 1 for call in write.await_args_list)


@pytest.mark.asyncio
async def test_tiny_video_avoids_scene_passes(monkeypatch, tmp_path, cover_settings):
    service = VideoService()
    monkeypatch.setattr(service, "_write_frame", AsyncMock(return_value=False))
    scenes = AsyncMock(return_value=[])
    monkeypatch.setattr(service, "_write_scene_change_frames", scenes)
    await service._extract_cover_candidate_frames("video", str(tmp_path), 0.1)
    assert service._write_frame.await_count == 1
    scenes.assert_not_awaited()


@pytest.mark.asyncio
async def test_cover_skips_corrupt_and_missing_files(monkeypatch, tmp_path, cover_settings):
    service = VideoService()

    async def write(_video, output, timestamp):
        if timestamp < 50:
            Path(output).write_bytes(b"not an image")
        return True

    monkeypatch.setattr(service, "_write_frame", AsyncMock(side_effect=write))
    monkeypatch.setattr(service, "_write_scene_change_frames", AsyncMock(return_value=[]))
    assert await service._extract_cover_candidate_frames("video", str(tmp_path), 100) == []


@pytest.mark.asyncio
async def test_late_scene_pass_reports_absolute_timestamps(monkeypatch, tmp_path):
    # The input seek resets FFmpeg's reported PTS. Add that offset to preserve
    # the source timestamp, using a distinct prefix so early JPEGs cannot leak.
    (tmp_path / "scene-01.jpg").write_bytes(b"borrowed evidence frame")
    (tmp_path / "cover-scene-closing-01.jpg").write_bytes(b"late cover")

    class Completed:
        returncode = 0

        async def communicate(self):
            return b"", b"pts_time:2.25"

    create = AsyncMock(return_value=Completed())
    monkeypatch.setattr(video.asyncio, "create_subprocess_exec", create)

    frames = await VideoService()._write_scene_change_frames(
        "video", str(tmp_path), start_seconds=70,
        frame_limit=2, output_prefix="cover-scene-closing",
    )

    assert frames == [(72.25, str(tmp_path / "cover-scene-closing-01.jpg"))]
    args = create.await_args.args
    assert args[args.index("-ss") + 1] == "70.000"
    assert args.index("-ss") < args.index("-i")
    assert args[args.index("-frames:v") + 1] == "2"


@pytest.mark.asyncio
@pytest.mark.parametrize("error,code", [
    (RuntimeError("download failed"), "COVER_FRAME_EXTRACTION_FAILED"),
    (asyncio.TimeoutError(), "TIMEOUT"),
    (FileNotFoundError("ffmpeg"), "SYSTEM_ERROR"),
])
async def test_cover_failure_releases_slot_and_temp_media(monkeypatch, tmp_path, error, code):
    owned = tmp_path / "owned"
    owned.mkdir()
    (owned / "source.part").write_bytes(b"partial download")
    monkeypatch.setattr(video.tempfile, "mkdtemp", lambda **_: str(owned))
    service = VideoService(max_concurrency=1)
    monkeypatch.setattr(service, "_download_video_for_frames", AsyncMock(side_effect=error))

    result = await service.extract_cover_frames("https://youtu.be/video")

    assert result.success is False
    assert result.error_code == code
    assert not owned.exists()
    assert service._media_slots._value == 1


@pytest.mark.asyncio
async def test_cover_success_returns_source_frames_and_cleans_media(monkeypatch, tmp_path):
    owned = tmp_path / "owned"
    owned.mkdir()
    monkeypatch.setattr(video.tempfile, "mkdtemp", lambda **_: str(owned))
    service = VideoService(max_concurrency=1)
    monkeypatch.setattr(service, "_download_video_for_frames", AsyncMock(return_value=("video", 100)))
    frames = [VideoFrame(0.5, base64.b64encode(b"frame").decode())]
    monkeypatch.setattr(service, "_extract_cover_candidate_frames", AsyncMock(return_value=frames))

    result = await service.extract_cover_frames("https://youtu.be/video")

    assert result.success is True
    assert result.frames == frames
    assert not owned.exists()
    assert service._media_slots._value == 1


@pytest.mark.asyncio
async def test_cover_cancellation_kills_process_and_cleans_owned_media(monkeypatch, tmp_path):
    owned = tmp_path / "owned"
    owned.mkdir()
    (owned / "source.mp4").write_bytes(b"video")
    monkeypatch.setattr(video.tempfile, "mkdtemp", lambda **_: str(owned))
    service = VideoService(max_concurrency=1)
    entered = asyncio.Event()

    class WaitingProcess:
        returncode = None
        killed = False

        async def communicate(self):
            entered.set()
            await asyncio.Event().wait()

        def kill(self):
            self.killed = True
            self.returncode = -9

        async def wait(self):
            return self.returncode

    process = WaitingProcess()
    monkeypatch.setattr(video.asyncio, "create_subprocess_exec", AsyncMock(return_value=process))
    monkeypatch.setattr(service, "_download_video_for_frames", AsyncMock(return_value=(str(owned / "source.mp4"), 100)))

    task = asyncio.create_task(service.extract_cover_frames("https://youtu.be/video"))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert process.killed is True
    assert not owned.exists()
    assert service._media_slots._value == 1


@pytest.mark.asyncio
async def test_cover_media_capacity_does_not_download_or_release_borrowed_slot(monkeypatch, tmp_path):
    owned = tmp_path / "owned"
    owned.mkdir()
    monkeypatch.setattr(video.tempfile, "mkdtemp", lambda **_: str(owned))
    service = VideoService(max_concurrency=1, queue_timeout_seconds=0.001)
    download = AsyncMock()
    monkeypatch.setattr(service, "_download_video_for_frames", download)
    await service._media_slots.acquire()
    try:
        result = await service.extract_cover_frames("https://youtu.be/video")
        assert result.error_code == "MEDIA_BUSY"
        assert service._media_slots._value == 0
        download.assert_not_awaited()
        assert not owned.exists()
    finally:
        service._media_slots.release()


@pytest.mark.asyncio
async def test_real_ffmpeg_late_scenes_and_cover_sampling(tmp_path, cover_settings):
    """Exercise real input seeks, scene PTS, JPEG decoding, and deduplication."""
    import io
    import shutil
    import subprocess

    from PIL import Image

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("FFmpeg is required for the media integration check")
    source = tmp_path / "source.mp4"
    command = [ffmpeg, "-loglevel", "error"]
    for color in ("red", "green", "blue"):
        command.extend(["-f", "lavfi", "-i", f"color=c={color}:d=1:s=96x96:r=8"])
    command.extend([
        "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
        "-map", "[v]", "-c:v", "mpeg4", "-y", str(source),
    ])
    subprocess.run(command, check=True, capture_output=True, timeout=20)
    service = VideoService()

    scenes = await service._write_scene_change_frames(
        str(source), str(tmp_path), start_seconds=1.5,
        frame_limit=2, output_prefix="cover-late-integration",
    )
    # The late cut is at source second 2.0, not seek-relative second 0.5.
    assert len(scenes) == 1
    assert scenes[0][0] == pytest.approx(2.0, abs=0.125)

    frames = await service._extract_cover_candidate_frames(str(source), str(tmp_path), 3)
    assert 1 <= len(frames) <= 12
    assert all(0 <= frame.timestamp_seconds < 3 for frame in frames)
    for frame in frames:
        with Image.open(io.BytesIO(base64.b64decode(frame.image_base64))) as image:
            assert image.format == "JPEG"
            assert image.size == (96, 96)
