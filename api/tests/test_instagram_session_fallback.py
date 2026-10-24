"""A rejected Instagram session must not block anonymous proxy access."""

import json
from unittest.mock import AsyncMock

import pytest

from app.services import video

URL = "https://www.instagram.com/reel/DexEVyhvU_w/"
PROXY = "http://synthetic-proxy.invalid:8080"
REJECTED = b'ERROR: [Instagram] DexEVyhvU_w: Failed to parse JSON (caused by JSONDecodeError("Expecting value"))'


class DownloadProcess:
    def __init__(self, *, returncode, stderr=b""):
        self.returncode = returncode
        self.stderr = stderr

    async def communicate(self):
        stdout = json.dumps({"title": "Hot cocoa", "description": "2 ingredients"}).encode()
        return (stdout if self.returncode == 0 else b""), self.stderr

    def kill(self):
        self.returncode = -9

    async def wait(self):
        return self.returncode


@pytest.fixture
def instagram(monkeypatch, tmp_path):
    """Run each media path with a configured session and a scripted downloader."""
    monkeypatch.setattr(video.settings, "instagram_cookies", "# Netscape HTTP Cookie File\nsynthetic")
    monkeypatch.setattr(video.settings, "youtube_proxy", PROXY)
    monkeypatch.setattr(video, "_instagram_session_bypass_until", 0.0)
    monkeypatch.setattr(video.sentry_sdk, "capture_message", lambda *_args, **_kwargs: None)
    commands = []
    credential_paths = []
    state = {"session_error": REJECTED, "anonymous_error": None}

    async def create(*command, **_kwargs):
        commands.append(command)
        if "--cookies" in command:
            credential_paths.append(command[command.index("--cookies") + 1])
            error = state["session_error"]
        else:
            error = state["anonymous_error"]
        if error:
            return DownloadProcess(returncode=1, stderr=error)
        if "--output" in command:
            output = command[command.index("--output") + 1]
            extension = "mp3" if "--extract-audio" in command else "mp4"
            video.Path(output.replace("%(ext)s", extension)).write_bytes(b"media")
        return DownloadProcess(returncode=0)

    service = video.VideoService()
    monkeypatch.setattr(video.asyncio, "create_subprocess_exec", create)
    monkeypatch.setattr(service, "_get_audio_duration", AsyncMock(return_value=30))
    monkeypatch.setattr(service, "_get_media_duration", AsyncMock(return_value=30))

    async def run(kind):
        if kind == "metadata":
            result = await service.get_video_metadata_ytdlp(URL)
            return result.error_code is None, result.error_code
        if kind == "audio":
            result = await service.download_audio(URL)
            if result.success:
                service.cleanup_audio_file(result.file_path)
            return result.success, result.error_code
        work = tmp_path / f"frames-{len(commands)}"
        work.mkdir()
        try:
            await service._download_video_for_frames(URL, str(work))
            return True, None
        except video.DownloaderFailed as error:
            return False, video.get_friendly_video_error(str(error), "instagram")[0]

    return run, commands, credential_paths, state


KINDS = ["metadata", "audio", "frames"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", KINDS)
async def test_rejected_session_retries_anonymously_through_the_proxy(instagram, kind):
    run, commands, credential_paths, _ = instagram

    assert await run(kind) == (True, None)

    assert len(commands) == 2
    session, anonymous = commands
    assert "--cookies" in session and "--cookies" not in anonymous
    assert anonymous[anonymous.index("--proxy") + 1] == PROXY and anonymous[-1] == URL
    if kind != "metadata":
        # Anonymous responses omit duration; a strict filter skips the download.
        assert anonymous[anonymous.index("--match-filter") + 1].startswith("duration <=? ")
    assert credential_paths and not any(video.os.path.exists(path) for path in credential_paths)
    assert video._instagram_session_bypassed()

    # The confirmed rejection skips the session instead of failing first again.
    assert await run(kind) == (True, None)
    assert len(commands) == 3 and "--cookies" not in commands[2]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", KINDS)
async def test_definitive_source_errors_do_not_retry(instagram, kind):
    run, commands, _, state = instagram
    state["session_error"] = b"ERROR: [Instagram] DexEVyhvU_w: HTTP Error 404: Not Found"

    succeeded, code = await run(kind)

    assert not succeeded and code == "NOT_FOUND"
    assert len(commands) == 1 and not video._instagram_session_bypassed()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", KINDS)
async def test_failed_anonymous_retry_keeps_the_session_and_original_error(instagram, kind):
    run, commands, _, state = instagram
    state["anonymous_error"] = b"ERROR: [Instagram] DexEVyhvU_w: login required"

    succeeded, code = await run(kind)

    assert not succeeded
    assert len(commands) == 2 and not video._instagram_session_bypassed()
    if kind != "frames":
        assert code == "SOURCE_RESPONSE_INVALID"


@pytest.mark.asyncio
async def test_unconfigured_session_runs_once(instagram, monkeypatch):
    run, commands, _, state = instagram
    monkeypatch.setattr(video.settings, "instagram_cookies", None)
    state["anonymous_error"] = REJECTED

    assert await run("audio") == (False, "SOURCE_RESPONSE_INVALID")
    assert len(commands) == 1
