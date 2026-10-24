import asyncio
import json
import subprocess
import textwrap
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI
from pydantic import SecretStr

from app.media_lifecycle import recipe_media_lock_key
from app.routers import import_health as health
from app.services.video import (
    AudioExtractionResult,
    VideoFrame,
    VideoFrameExtractionResult,
    VideoMetadata,
)


def test_recipe_media_lock_key_is_stable_signed_bigint():
    recipe_id = UUID("11111111-1111-4111-8111-111111111111")

    first = recipe_media_lock_key(recipe_id)
    second = recipe_media_lock_key(str(recipe_id))

    assert first == second
    assert -(2**63) <= first < 2**63
    assert first != recipe_media_lock_key(
        UUID("22222222-2222-4222-8222-222222222222")
    )


@pytest.fixture
async def monitor(monkeypatch, tmp_path):
    settings = SimpleNamespace(import_health_token=SecretStr("monitor-only"),
                               video_max_duration_seconds=3600,
                               video_frame_max_duration_seconds=600, audio_max_bytes=1024)
    monkeypatch.setattr(health, "get_settings", lambda: settings)
    locks, statements = set(), []

    class Transaction:
        def begin(self):
            return self

        async def __aenter__(self):
            self.key = None
            return self

        async def __aexit__(self, *args):
            if self.key:
                locks.remove(self.key)

        async def scalar(self, sql, params):
            statements.append((str(sql), params))
            key = params["key"]
            if key in locks:
                return False
            locks.add(key)
            self.key = key
            return True

    @asynccontextmanager
    async def database():
        yield Transaction()

    monkeypatch.setattr(health, "AsyncSessionLocal", database)
    parent = tmp_path / "recipe-audio-test"
    parent.mkdir()
    path = parent / "audio.mp3"
    path.write_bytes(b"test audio; decoder is stubbed")
    (parent / "leftover.part").write_bytes(b"partial")
    service = SimpleNamespace(
        get_video_metadata_ytdlp=AsyncMock(return_value=VideoMetadata(title="Canary", duration=13)),
        download_audio=AsyncMock(return_value=AudioExtractionResult(True, str(path), 13)),
        extract_video_frames=AsyncMock(return_value=VideoFrameExtractionResult(
            True, [VideoFrame(1, "test-decoded-frame")],
        )),
    )
    monkeypatch.setattr(health, "video_service", service)
    capture = Mock()
    monkeypatch.setattr(health.sentry_sdk, "capture_message", capture)
    app = FastAPI()
    app.include_router(health.router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="https://test",
                                headers={"Authorization": "Bearer monitor-only"}) as client:
        yield SimpleNamespace(client=client, settings=settings, service=service, locks=locks,
                              statements=statements, parent=parent, capture=capture)


@pytest.mark.parametrize("token,header,code,status", [
    (None, "Bearer monitor-only", "DISABLED", 503),
    (SecretStr(""), "Bearer monitor-only", "DISABLED", 503),
    (SecretStr("monitor-only"), "", "UNAUTHORIZED", 401),
    (SecretStr("monitor-only"), "Bearer wrong", "UNAUTHORIZED", 401),
    (SecretStr("monitor-only"), "Basic monitor-only", "UNAUTHORIZED", 401),
])
async def test_monitor_auth_precedes_database_and_media(monitor, token, header, code, status):
    monitor.settings.import_health_token = token
    response = await monitor.client.post("/internal/import-health/instagram", headers={"Authorization": header})
    assert response.status_code == status and response.json()["error_code"] == code
    assert not monitor.statements and not monitor.service.get_video_metadata_ytdlp.called
    assert not monitor.capture.called


@pytest.mark.parametrize("platform,params,body", [
    ("custom", None, None), ("instagram", {"url": "https://evil.test"}, None),
    ("instagram", {"token": "monitor-only"}, None),
    ("instagram", None, b'{"url":"https://evil.test"}'),
])
async def test_monitor_rejects_arbitrary_input(monitor, platform, params, body):
    response = await monitor.client.post(f"/internal/import-health/{platform}", params=params, content=body)
    assert response.status_code == 400 and response.json()["error_code"] == "INVALID_INPUT"
    assert "evil" not in response.text and "monitor-only" not in response.text
    assert not monitor.statements and not monitor.service.get_video_metadata_ytdlp.called


@pytest.mark.parametrize("platform", ["instagram", "tiktok", "youtube"])
async def test_monitor_uses_only_fixed_downloader_audio_and_frame_evidence(monitor, platform, monkeypatch):
    from openai.resources.audio.transcriptions import AsyncTranscriptions
    from openai.resources.chat.completions import AsyncCompletions
    from openai.resources.responses import AsyncResponses

    from app.services import source_acquisition

    no_ai = AsyncMock(side_effect=AssertionError("Monitor must never call paid AI"))
    monkeypatch.setattr(AsyncCompletions, "create", no_ai)
    monkeypatch.setattr(AsyncTranscriptions, "create", no_ai)
    monkeypatch.setattr(AsyncResponses, "create", no_ai)
    no_public_fallback = AsyncMock(side_effect=AssertionError("Public caption is not downloader health"))
    monkeypatch.setattr(source_acquisition, "public_instagram_metadata", no_public_fallback)
    response = await monitor.client.post(f"/internal/import-health/{platform}")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "platform": platform, "stage": "complete",
                               "error_code": None, "elapsed": response.json()["elapsed"]}
    for method in vars(monitor.service).values():
        method.assert_awaited_once_with(health.CANARIES[platform])
    assert not monitor.parent.exists() and not monitor.locks and not no_ai.called
    assert not no_public_fallback.called
    assert "pg_try_advisory_xact_lock" in monitor.statements[0][0]
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("stage,code", [
    ("metadata", "INSTAGRAM_AUTH_REQUIRED"), ("metadata", "VIDEO_PRIVATE"),
    ("metadata", "VIDEO_REMOVED"), ("metadata", "RATE_LIMITED"),
    ("audio", "ACCESS_DENIED"), ("frames", "VIDEO_FRAME_EXTRACTION_FAILED"),
    ("frames", "raw provider URL secret"),
])
async def test_monitor_preserves_only_allowlisted_typed_failures(monitor, stage, code):
    method = {"metadata": "get_video_metadata_ytdlp", "audio": "download_audio",
              "frames": "extract_video_frames"}[stage]
    getattr(monitor.service, method).return_value.error_code = code
    response = await monitor.client.post("/internal/import-health/instagram")
    assert response.status_code == 503 and response.json()["stage"] == stage
    assert response.json()["error_code"] == (code if code in health.ERROR_CODES else "CHECK_FAILED")
    assert "secret" not in response.text and not monitor.locks
    monitor.capture.assert_called_once_with("Shared media health check failed", level="error")
    if stage != "metadata":
        assert not monitor.parent.exists()
    if stage == "metadata":
        assert not monitor.service.download_audio.called
    if stage in {"metadata", "audio"}:
        assert not monitor.service.extract_video_frames.called


@pytest.mark.parametrize("error,code", [
    ("HTTP Error 401: Unauthorized secret provider path", "INSTAGRAM_AUTH_REQUIRED"),
    ("HTTP Error 429: Too Many Requests secret", "RATE_LIMITED"),
    ("Video is private: secret", "VIDEO_PRIVATE"),
    ("This video has been removed: secret", "VIDEO_REMOVED"),
])
async def test_monitor_classifies_generic_frame_downloader_failures_safely(monitor, error, code):
    frames = monitor.service.extract_video_frames.return_value
    frames.success, frames.error, frames.error_code = False, error, "VIDEO_FRAME_EXTRACTION_FAILED"
    response = await monitor.client.post("/internal/import-health/instagram")
    assert response.json()["error_code"] == code and "secret" not in response.text
    assert not monitor.parent.exists()


@pytest.mark.parametrize("stage,field,value,code", [
    ("metadata", "duration", 0, "NO_METADATA"),
    ("metadata", "duration", float("nan"), "NO_METADATA"),
    ("metadata", "duration", 601, "VIDEO_TOO_LONG"),
    ("audio", "file_path", None, "NO_AUDIO"),
    ("audio", "duration", None, "NO_AUDIO"),
    ("audio", "success", False, "NO_AUDIO"),
    ("frames", "frames", [], "NO_VIDEO_FRAMES"),
    ("frames", "success", False, "NO_VIDEO_FRAMES"),
    ("frames", "frames", [VideoFrame(1, "")], "NO_VIDEO_FRAMES"),
])
async def test_monitor_requires_evidence_not_just_no_provider_error(monitor, stage, field, value, code):
    method = {"metadata": "get_video_metadata_ytdlp", "audio": "download_audio",
              "frames": "extract_video_frames"}[stage]
    setattr(getattr(monitor.service, method).return_value, field, value)
    # Instagram may omit metadata duration; the other canaries must report one.
    platform = "youtube" if (stage, field, value) == ("metadata", "duration", 0) else "instagram"
    response = await monitor.client.post(f"/internal/import-health/{platform}")
    assert response.status_code == 503 and response.json()["error_code"] == code


@pytest.mark.parametrize("duration", [0, None])
async def test_monitor_accepts_instagram_metadata_without_duration(monitor, duration):
    """Anonymous Instagram metadata has no duration; audio must still measure one."""
    monitor.service.get_video_metadata_ytdlp.return_value.duration = duration
    response = await monitor.client.post("/internal/import-health/instagram")
    assert response.status_code == 200 and response.json()["stage"] == "complete"

    monitor.service.download_audio.return_value.duration = None
    response = await monitor.client.post("/internal/import-health/instagram")
    assert response.status_code == 503 and response.json()["error_code"] == "NO_AUDIO"


@pytest.mark.parametrize("cancel", [False, True])
async def test_monitor_deadline_and_cancellation_clean_audio_and_release_lock(monitor, monkeypatch, cancel):
    entered = asyncio.Event()

    async def frames(url):
        entered.set()
        await asyncio.Event().wait()

    monitor.service.extract_video_frames.side_effect = frames
    monkeypatch.setattr(health, "DEADLINE_SECONDS", 2 if cancel else 0.02)
    task = asyncio.create_task(monitor.client.post("/internal/import-health/instagram"))
    await asyncio.wait_for(entered.wait(), 1)
    if cancel:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not monitor.capture.called
    else:
        response = await asyncio.wait_for(task, 1)
        assert response.status_code == 503 and response.json()["error_code"] == "TIMEOUT"
        assert response.json()["stage"] == "frames" and monitor.capture.call_count == 1
    assert not monitor.parent.exists() and not monitor.locks


async def test_monitor_lock_rejects_overlapping_same_platform_without_daily_claim(monitor):
    entered, release = asyncio.Event(), asyncio.Event()

    async def metadata(url):
        entered.set()
        await release.wait()
        return VideoMetadata(error_code="RATE_LIMITED")

    monitor.service.get_video_metadata_ytdlp.side_effect = metadata
    task = asyncio.create_task(monitor.client.post("/internal/import-health/instagram"))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        busy = await monitor.client.post("/internal/import-health/instagram")
        assert busy.status_code == 409 and busy.json()["error_code"] == "CHECK_BUSY"
        assert monitor.service.get_video_metadata_ytdlp.await_count == 1
    finally:
        release.set()
        await task
    later = await monitor.client.post("/internal/import-health/instagram")
    assert later.status_code == 503 and later.json()["error_code"] == "RATE_LIMITED"
    assert not monitor.locks


async def test_monitor_unexpected_failure_does_not_expose_exception(monitor):
    monitor.service.get_video_metadata_ytdlp.side_effect = RuntimeError("https://secret provider cookie /tmp/private")
    response = await monitor.client.post("/internal/import-health/instagram")
    assert response.json()["error_code"] == "CHECK_FAILED"
    assert set(json.loads(response.text)) == {"status", "platform", "stage", "error_code", "elapsed"}
    assert "secret" not in response.text and not monitor.locks


@pytest.mark.parametrize("failure", [None, "missing_token", "service", "malformed", "timeout", "curl"])
def test_scheduled_monitor_is_sequential_bounded_and_only_prints_allowlisted_results(
    monkeypatch, tmp_path, capsys, failure,
):
    workflow = (Path(__file__).parents[2] / ".github/workflows/import-health.yml").read_text()
    script = textwrap.dedent(workflow.split("python3 - <<'PY'\n")[1].rsplit("          PY", 1)[0])
    assert "schedule:" in workflow and "workflow_dispatch:" in workflow
    assert "pull_request:" not in workflow and "cancel-in-progress: false" in workflow
    assert "contents: read" in workflow and "timeout-minutes: 12" in workflow
    summary = tmp_path / "summary"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    monkeypatch.setenv("IMPORT_HEALTH_TOKEN", "" if failure == "missing_token" else "synthetic-secret")
    calls = []

    def curl(argv, **kwargs):
        platform = argv[-1].rsplit("/", 1)[1]
        calls.append(platform)
        assert argv[-1] == f"https://recipe-api-x5na.onrender.com/internal/import-health/{platform}"
        assert "synthetic-secret" not in " ".join(argv)
        assert '--retry' not in argv and '--location' not in argv
        assert argv[argv.index("--max-time") + 1] == "210"
        assert kwargs["timeout"] == 220 and 'Bearer synthetic-secret' in kwargs["input"]
        response = {"platform": platform, "status": "ok", "stage": "complete",
                    "error_code": None, "elapsed": 12.0}
        if platform == "instagram":
            if failure == "timeout":
                raise subprocess.TimeoutExpired("curl", 220)
            if failure == "service":
                response.update(status="failed", stage="metadata", error_code="RATE_LIMITED")
            if failure == "malformed":
                response.update(stage="private provider caption", error_code="cookie secret")
        Path(argv[argv.index("--output") + 1]).write_text(json.dumps(response))
        return SimpleNamespace(returncode=28 if failure == "curl" else 0,
                               stdout="503" if failure == "service" and platform == "instagram" else "200")

    monkeypatch.setattr(subprocess, "run", curl)
    with pytest.raises(SystemExit) as stopped:
        exec(compile(script, "import-health.yml", "exec"), {})
    assert bool(stopped.value.code) == bool(failure)
    if failure == "missing_token":
        assert not calls
    else:
        assert calls == ["instagram", "tiktok", "youtube"]
        output = summary.read_text() + capsys.readouterr().out
        assert "synthetic-secret" not in output and "cookie secret" not in output
        assert "private provider caption" not in output
        assert output.count("| instagram |") == 1
