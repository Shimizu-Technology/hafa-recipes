"""Frame thread scopes must retain evidence, deadlines and child settlement."""

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import video


class MediaProcess:
    def __init__(self, *, returncode=0, stderr=b""):
        self.returncode = returncode
        self.stderr = stderr
        self.killed = False
        self.waited = False

    async def communicate(self):
        return b"", self.stderr

    def kill(self):
        self.killed = True
        self.returncode = -9

    async def wait(self):
        self.waited = True
        return self.returncode


def instrument_subprocess(monkeypatch, process, *, force_timeout=False):
    """Replace only this module's subprocess seams, keeping global timers real."""
    create = AsyncMock(return_value=process)
    deadlines = []

    async def wait_for(awaitable, timeout):
        deadlines.append(timeout)
        if force_timeout and timeout in {20, 30}:
            awaitable.close()
            raise asyncio.TimeoutError
        return await asyncio.wait_for(awaitable, timeout=timeout)

    namespace = SimpleNamespace(
        create_subprocess_exec=create,
        subprocess=asyncio.subprocess,
        wait_for=wait_for,
        TimeoutError=asyncio.TimeoutError,
    )
    monkeypatch.setattr(video, "asyncio", namespace)
    return create, deadlines


def assert_thread_scopes(command):
    """Input/output codec options have separate positional scopes in FFmpeg."""
    input_index = command.index("-i")
    codec_indices = [index for index, value in enumerate(command) if value == "-threads:v"]
    assert len(codec_indices) == 2
    assert codec_indices[0] < input_index < codec_indices[1] < len(command) - 1
    assert [command[index + 1] for index in codec_indices] == ["1", "1"]
    assert command.count("-filter_threads") == 1
    assert command[command.index("-filter_threads") + 1] == "1"
    assert command.index("-filter_threads") < input_index
    # No extra seek/input/output or competing automatic-thread option.
    assert command.count("-i") == 1
    assert "-threads" not in command
    assert command[0] == "ffmpeg"


@pytest.mark.asyncio
async def test_single_frame_scopes_preserve_seek_scale_quality_and_deadline(monkeypatch, tmp_path):
    service = video.VideoService()
    output = tmp_path / "frame.jpg"
    output.write_bytes(b"synthetic frame")
    process = MediaProcess()
    create, deadlines = instrument_subprocess(monkeypatch, process)

    assert await service._write_frame("source.mp4", str(output), 12.34567) is True

    command = create.await_args.args
    assert_thread_scopes(command)
    assert command[command.index("-ss") + 1] == "12.346"
    assert command.index("-ss") < command.index("-i")
    assert command[command.index("-i") + 1] == "source.mp4"
    assert command[command.index("-frames:v") + 1] == "1"
    assert command[command.index("-vf") + 1] == "scale='min(960,iw)':-2"
    assert command[command.index("-q:v") + 1] == "3"
    assert command[-2:] == ("-y", str(output))
    assert create.await_args.kwargs == {
        "stdout": asyncio.subprocess.PIPE,
        "stderr": asyncio.subprocess.PIPE,
        "start_new_session": os.name == "posix",
    }
    assert deadlines == [20]
    assert not process.killed and not process.waited


@pytest.mark.asyncio
@pytest.mark.parametrize("start,limit,prefix", [(0.0, 4, "scene"), (17.125, 3, "late-scene")])
async def test_scene_scopes_preserve_selection_absolute_pts_and_cap(
    monkeypatch, tmp_path, start, limit, prefix
):
    service = video.VideoService()
    # Write out of order to verify deterministic filename-to-PTS mapping.
    for number in [3, 1, 2]:
        (tmp_path / f"{prefix}-{number:02d}.jpg").write_bytes(b"synthetic frame")
    (tmp_path / "foreign-01.jpg").write_bytes(b"unrelated")
    process = MediaProcess(stderr=b"pts_time:0.25\npts_time:2.5\n")
    create, deadlines = instrument_subprocess(monkeypatch, process)

    result = await service._write_scene_change_frames(
        "source.mp4", str(tmp_path), start_seconds=start, frame_limit=limit, output_prefix=prefix
    )

    assert result == [
        (start + 0.25, str(tmp_path / f"{prefix}-01.jpg")),
        (start + 2.5, str(tmp_path / f"{prefix}-02.jpg")),
    ]
    command = create.await_args.args
    assert_thread_scopes(command)
    if start:
        assert command[command.index("-ss") + 1] == "17.125"
        assert command.index("-ss") < command.index("-i")
    else:
        assert "-ss" not in command
    assert command[command.index("-vf") + 1] == (
        "select='gt(scene,0.35)',scale='min(960,iw)':-2,showinfo"
    )
    assert command[command.index("-fps_mode") + 1] == "vfr"
    assert command[command.index("-frames:v") + 1] == str(limit)
    assert command[command.index("-q:v") + 1] == "3"
    assert command[-2:] == ("-y", str(tmp_path / f"{prefix}-%02d.jpg"))
    assert create.await_args.kwargs["start_new_session"] == (os.name == "posix")
    assert deadlines == [30]


async def write(service, kind, tmp_path):
    if kind == "frame":
        return await service._write_frame("source.mp4", str(tmp_path / "frame.jpg"), 1.25)
    return await service._write_scene_change_frames("source.mp4", str(tmp_path))


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,expected,deadline", [("frame", False, 20), ("scene", [], 30)])
async def test_writer_timeout_still_kills_and_waits_for_child(
    monkeypatch, tmp_path, kind, expected, deadline
):
    service = video.VideoService()
    process = MediaProcess(returncode=None)
    create, deadlines = instrument_subprocess(monkeypatch, process, force_timeout=True)

    assert await write(service, kind, tmp_path) == expected

    assert_thread_scopes(create.await_args.args)
    assert deadlines == [deadline, 5]
    assert process.killed and process.waited


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,expected", [("frame", False), ("scene", [])])
async def test_nonzero_child_never_reports_success_even_with_output(
    monkeypatch, tmp_path, kind, expected
):
    service = video.VideoService()
    (tmp_path / "frame.jpg").write_bytes(b"partial")
    (tmp_path / "scene-01.jpg").write_bytes(b"partial")
    process = MediaProcess(returncode=1, stderr=b"pts_time:1.25")
    instrument_subprocess(monkeypatch, process)

    assert await write(service, kind, tmp_path) == expected
    assert not process.killed


@pytest.mark.asyncio
async def test_successful_child_without_frame_output_is_not_success(monkeypatch, tmp_path):
    service = video.VideoService()
    instrument_subprocess(monkeypatch, MediaProcess())
    assert await write(service, "frame", tmp_path) is False


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["frame", "scene"])
async def test_cancellation_settles_child_before_releasing_original_two_slot_pool(
    monkeypatch, tmp_path, kind
):
    service = video.VideoService(max_concurrency=2)
    started = asyncio.Event()
    wait_started = asyncio.Event()
    allow_settlement = asyncio.Event()

    class HeldProcess(MediaProcess):
        async def communicate(self):
            started.set()
            await asyncio.Event().wait()

        async def wait(self):
            wait_started.set()
            await allow_settlement.wait()
            return await super().wait()

    process = HeldProcess(returncode=None)
    instrument_subprocess(monkeypatch, process)

    async def operation():
        async with service._media_slot():
            return await write(service, kind, tmp_path)

    task = asyncio.create_task(operation())
    try:
        await asyncio.wait_for(started.wait(), timeout=2)
        assert service._media_slots._value == 1
        task.cancel()
        await asyncio.wait_for(wait_started.wait(), timeout=2)
        assert process.killed and not process.waited
        assert not task.done()
        assert service._media_slots._value == 1
        allow_settlement.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert process.waited
        assert service._media_slots._value == 2
    finally:
        allow_settlement.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
