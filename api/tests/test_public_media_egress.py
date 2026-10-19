"""Exercise the downloader's real HTTPcore/yt-dlp boundaries without networking."""

import gzip
import json
import socket
import ssl
import subprocess
import sys
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException
from httpcore._backends.mock import MockBackend, MockStream
from yt_dlp.downloader.external import FFmpegFD
from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.networking.common import Request
from yt_dlp.networking.exceptions import NoSupportingHandlers, RequestError
from yt_dlp.utils import DownloadError

import app.security as security
from app.domains.workouts.extraction import ProductionSourceAcquirer
from app.services import public_ytdlp as public
from app.services import video


class WireStream(MockStream):
    def __init__(self, buffer):
        super().__init__(buffer)
        self.writes, self.tls = [], []

    def write(self, buffer, timeout=None):
        self.writes.append(buffer)

    def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        self.tls.append((server_hostname, ssl_context.verify_mode, ssl_context.check_hostname))
        return self


class WireBackend(MockBackend):
    def __init__(self, responses):
        self.responses, self.connections, self.streams = responses, [], []

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        self.connections.append((host, port))
        stream = WireStream(self.responses.pop(0))
        self.streams.append(stream)
        return stream


def public_dns(monkeypatch, *, addresses=None):
    answers = addresses or ["93.184.216.34"]
    lookups = []

    def resolve(host, port):
        lookups.append(host)
        # Literal private targets must never reach a resolver or connection.
        assert host not in {"169.254.169.254", "127.0.0.1"}
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in answers]

    monkeypatch.setattr(security.socket, "getaddrinfo", resolve)
    return lookups


@pytest.mark.parametrize("proxy", [None, "http://user:secret@proxy.example:8000", "https://proxy.example:8000"])
def test_actual_httpcore_connect_is_pinned_and_tls_host_is_preserved(monkeypatch, proxy):
    lookups = public_dns(monkeypatch)
    prefix = [b"HTTP/1.1 200 Connection established\r\n\r\n"] if proxy else []
    wire = WireBackend([prefix + [b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"]])
    transport = security.PublicSyncHTTPTransport(proxy=proxy)
    if proxy:
        transport._transport._pool._network_backend.backend = wire
    else:
        transport._transport._pool._network_backend = wire
    with httpx.Client(transport=transport, trust_env=False) as client:
        response = client.get("https://video.example/source")
    assert response.text == "ok" and str(response.url) == "https://video.example/source"
    assert lookups == ["video.example"]
    stream = wire.streams[0]
    expected_tls = ["proxy.example", "video.example"] if proxy and proxy.startswith("https:") else ["video.example"]
    assert [entry[0] for entry in stream.tls] == expected_tls
    assert all(entry[1:] == (ssl.CERT_REQUIRED, True) for entry in stream.tls)
    requests = b"".join(stream.writes)
    assert b"Host: video.example\r\n" in requests
    if proxy:
        assert wire.connections == [("proxy.example", 8000)]
        assert b"CONNECT 93.184.216.34:443 HTTP/1.1\r\n" in requests
        assert b"CONNECT video.example" not in requests
        connect, origin = requests.split(b"\r\n\r\n", 1)
        if "user:secret" in proxy:
            assert b"Proxy-Authorization:" in connect
        assert b"Proxy-Authorization:" not in origin
    else:
        assert wire.connections == [("93.184.216.34", 443)]


def test_proxy_http_forward_target_is_pinned(monkeypatch):
    public_dns(monkeypatch)
    wire = WireBackend([[b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"]])
    transport = security.PublicSyncHTTPTransport(proxy="http://user:secret@proxy.example:8000")
    transport._transport._pool._network_backend.backend = wire
    with httpx.Client(transport=transport, trust_env=False) as client:
        assert client.get("http://video.example/source").text == "ok"
    request = b"".join(wire.streams[0].writes)
    assert request.startswith(b"GET http://93.184.216.34/source HTTP/1.1")
    assert b"Host: video.example\r\n" in request


def test_same_cdn_ip_does_not_reuse_another_hostname_tls_connection(monkeypatch):
    public_dns(monkeypatch)
    response = [b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"]
    wire = WireBackend([response[:], response[:]])
    transport = security.PublicSyncHTTPTransport()
    transport._transport._pool._network_backend = wire
    with httpx.Client(transport=transport, trust_env=False) as client:
        client.get("https://first.example/source")
        client.get("https://second.example/source")
    assert len(wire.connections) == 2
    assert [stream.tls[0][0] for stream in wire.streams] == ["first.example", "second.example"]


@pytest.mark.parametrize("address", [
    "127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1",
])
@pytest.mark.parametrize("mixed", [False, True])
def test_private_or_mixed_dns_never_opens_a_connection(monkeypatch, address, mixed):
    public_dns(monkeypatch, addresses=(["93.184.216.34", address] if mixed else [address]))
    wire = WireBackend([])
    transport = security.PublicSyncHTTPTransport()
    transport._transport._pool._network_backend = wire
    with pytest.raises(HTTPException), httpx.Client(transport=transport, trust_env=False) as client:
        client.get("https://video.example/source")
    assert wire.connections == []


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/private", "http://169.254.169.254/metadata", "http://[::1]/private",
    "https://user:secret@video.example/source", "file:///etc/passwd", "ftp://video.example/x",
])
def test_sync_transport_rejects_nonpublic_authorities_before_network(monkeypatch, url):
    lookups = public_dns(monkeypatch)
    with pytest.raises(HTTPException), httpx.Client(transport=security.PublicSyncHTTPTransport()) as client:
        client.get(url)
    assert lookups == []


@pytest.fixture
def pinned_handler(monkeypatch):
    """The actual pinning transport remains in place; replace only the socket."""
    lookups = public_dns(monkeypatch)
    seen = []
    responses = {}

    def serve(request):
        seen.append(request)
        reply = responses[request.headers["host"] + request.url.raw_path.decode()]
        return reply(request) if callable(reply) else reply

    def transport(*, proxy=None):
        result = security.PublicSyncHTTPTransport()
        result._transport.close()
        result._transport = httpx.MockTransport(serve)
        return result

    monkeypatch.setattr(public, "PublicSyncHTTPTransport", transport)
    return responses, seen, lookups


def test_sole_handler_keeps_cookies_post_body_decoding_and_redirection(pinned_handler, monkeypatch):
    responses, seen, lookups = pinned_handler
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9999")
    monkeypatch.setenv("NO_PROXY", "*")
    responses["video.example/start"] = httpx.Response(307, headers={
        "Location": "/final", "Set-Cookie": "session=synthetic; Path=/; Secure",
    })
    responses["video.example/final"] = httpx.Response(200, content=gzip.compress(b"caption"), headers={
        "Content-Encoding": "gzip",
    })
    with public.PublicYoutubeDL({"quiet": True}) as downloader:
        assert list(downloader._request_director.handlers) == ["Public"]
        result = downloader.urlopen(Request("https://video.example/start", data=b"test-body"))
        with result:
            assert result.read() == b"caption"
            assert result.url == "https://video.example/final"
            assert result.get_header("Content-Encoding") is None
        with pytest.raises(NoSupportingHandlers):
            downloader.urlopen("file:///etc/passwd")
    assert [r.content for r in seen] == [b"test-body", b"test-body"]
    assert all(r.method == "POST" and r.url.host == "93.184.216.34" for r in seen)
    assert seen[-1].headers["cookie"] == "session=synthetic"
    assert lookups == ["video.example", "video.example"]


class UnreadRedirectBody(httpx.SyncByteStream):
    """A redirect may advertise an unbounded body; only its headers are needed."""

    def __init__(self):
        self.reads, self.closed = 0, False

    def __iter__(self):
        self.reads += 1
        raise AssertionError("An intermediate redirect body must not be read")
        yield b""  # Make this a streaming iterator without allocating a body.

    def close(self):
        self.closed = True


@pytest.mark.parametrize("redirect_count", [1, 5, 6])
def test_redirect_bodies_are_closed_unread_with_the_existing_five_hop_limit(
    pinned_handler, redirect_count,
):
    responses, seen, lookups = pinned_handler
    bodies = [UnreadRedirectBody() for _ in range(redirect_count)]
    for index, body in enumerate(bodies):
        responses[f"video.example/hop{index}"] = httpx.Response(
            307, headers={"Location": f"/hop{index + 1}", "Content-Length": "999999999"},
            stream=body,
        )
    responses[f"video.example/hop{redirect_count}"] = httpx.Response(200, content=b"final media")
    with public.PublicYoutubeDL({"quiet": True}) as downloader:
        if redirect_count <= 5:
            with downloader.urlopen("https://video.example/hop0") as result:
                assert result.url == f"https://video.example/hop{redirect_count}"
                assert result.read() == b"final media"
        else:
            with pytest.raises(RequestError):
                downloader.urlopen("https://video.example/hop0")
    assert len(seen) == min(redirect_count + 1, 6)
    assert lookups == ["video.example"] * len(seen)
    assert all(body.closed and body.reads == 0 for body in bodies)


def test_redirect_to_metadata_address_never_reaches_network(pinned_handler):
    responses, seen, lookups = pinned_handler
    body = UnreadRedirectBody()
    responses["video.example/start"] = httpx.Response(302, headers={
        "Location": "http://169.254.169.254/latest/meta-data",
    }, stream=body)
    with public.PublicYoutubeDL({"quiet": True}) as downloader, pytest.raises(RequestError):
        downloader.urlopen("https://video.example/start")
    assert len(seen) == 1
    assert lookups == ["video.example"] and body.closed and body.reads == 0


def test_manual_redirect_keeps_httpx_cross_origin_auth_and_method_rules(pinned_handler):
    responses, seen, lookups = pinned_handler
    body = UnreadRedirectBody()
    responses["video.example/start"] = httpx.Response(303, headers={
        "Location": "https://alternate.example/final",
        "Set-Cookie": "origin-session=synthetic; Path=/; Secure",
    }, stream=body)
    responses["alternate.example/final"] = httpx.Response(200, content=b"public media")
    with public.PublicYoutubeDL({"quiet": True}) as downloader:
        with downloader.urlopen(Request("https://video.example/start", data=b"post-body", headers={
            "Authorization": "Bearer synthetic", "Cookie": "explicit-origin=synthetic",
        })) as result:
            assert result.read() == b"public media"
    first, redirected = seen
    assert first.method == "POST" and first.content == b"post-body"
    assert redirected.method == "GET" and redirected.content == b""
    assert "authorization" not in redirected.headers and "cookie" not in redirected.headers
    assert redirected.headers["host"] == "alternate.example"
    assert lookups == ["video.example", "alternate.example"]
    assert body.closed and body.reads == 0


def test_extractor_proxy_overrides_cannot_bypass_the_trusted_proxy(pinned_handler, monkeypatch):
    responses, _, _ = pinned_handler
    responses["video.example/source"] = httpx.Response(200, content=b"caption")
    factory, used = public.PublicSyncHTTPTransport, []

    def transport(*, proxy=None):
        used.append(proxy)
        return factory(proxy=proxy)

    monkeypatch.setattr(public, "PublicSyncHTTPTransport", transport)
    with public.PublicYoutubeDL({"quiet": True, "proxy": "http://trusted.example:8000"}) as downloader:
        with downloader.urlopen(Request("https://video.example/source", proxies={"all": "http://169.254.169.254:80", "no": "*"})) as response:
            assert response.read() == b"caption"
    assert used == ["http://trusted.example:8000"]


class PublicFixtureIE(InfoExtractor):
    _VALID_URL = r"publicfixture:(?P<id>.+)"

    def _real_extract(self, url):
        identifier = self._match_id(url)
        data = self._download_json("https://metadata.example/" + identifier, identifier)
        return {"id": identifier, "title": "Synthetic public source", "ext": "mp4", **data}


@pytest.mark.parametrize("protocol", ["https", "m3u8_native", "http_dash_segments"])
def test_real_native_downloaders_use_the_boundary_for_every_request(pinned_handler, tmp_path, protocol):
    responses, seen, _ = pinned_handler
    media = "https://cdn.example/media"
    info = {"url": media, "protocol": protocol}
    if protocol == "m3u8_native":
        responses["cdn.example/media"] = httpx.Response(200, text="#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\npart.ts\n#EXT-X-ENDLIST\n")
        responses["cdn.example/part.ts"] = httpx.Response(200, content=b"public-media")
    elif protocol == "http_dash_segments":
        info["fragments"] = [{"url": "https://cdn.example/part.ts"}]
        responses["cdn.example/part.ts"] = httpx.Response(200, content=b"public-media")
    else:
        responses["cdn.example/media"] = httpx.Response(200, content=b"public-media")
    responses["metadata.example/test"] = httpx.Response(200, json=info)
    output = tmp_path / "result.mp4"
    with public.PublicYoutubeDL({
        "quiet": True, "noprogress": True, "fixup": "never", "outtmpl": str(output),
        "external_downloader": {"default": "native"},
    }, auto_init=False) as downloader:
        downloader.add_info_extractor(PublicFixtureIE())
        assert downloader.download(["publicfixture:test"]) == 0
    assert output.read_bytes() == b"public-media"
    assert len(seen) >= 2 and all(request.url.host == "93.184.216.34" for request in seen)


@pytest.mark.parametrize("kind", ["media", "segment", "key"])
def test_native_downloads_reject_discovered_private_media_segments_and_keys(pinned_handler, tmp_path, kind):
    responses, seen, _ = pinned_handler
    private = "http://169.254.169.254/latest/meta-data"
    info = {"url": private, "protocol": "http"}
    if kind != "media":
        info = {"url": "https://cdn.example/media", "protocol": "m3u8_native"}
        key = f'#EXT-X-KEY:METHOD=AES-128,URI="{private}"\n' if kind == "key" else ""
        segment = private if kind == "segment" else "part.ts"
        responses["cdn.example/media"] = httpx.Response(200, text=f"#EXTM3U\n#EXT-X-TARGETDURATION:1\n{key}#EXTINF:1,\n{segment}\n#EXT-X-ENDLIST\n")
        responses["cdn.example/part.ts"] = httpx.Response(200, content=b"x" * 16)
    responses["metadata.example/test"] = httpx.Response(200, json=info)
    with public.PublicYoutubeDL({
        "quiet": True, "noprogress": True, "fixup": "never", "retries": 0, "fragment_retries": 0,
        "outtmpl": str(tmp_path / "result.mp4"), "external_downloader": {"default": "native"},
    }, auto_init=False) as downloader, pytest.raises((DownloadError, RequestError)):
        downloader.add_info_extractor(PublicFixtureIE())
        downloader.download(["publicfixture:test"])
    assert all(r.headers["host"] != "169.254.169.254" for r in seen)


def test_external_downloader_and_native_hls_fallback_are_rejected(monkeypatch, tmp_path):
    with public.PublicYoutubeDL({"quiet": True}) as downloader:
        with pytest.raises(DownloadError):
            downloader.dl(str(tmp_path / "x"), {"url": "rtmp://video.example/x", "protocol": "rtmp"})
    with pytest.raises(DownloadError):
        public._forbid_external_download()
    assert FFmpegFD.real_download is not public._forbid_external_download  # Installed only in isolated main.


def test_decoder_restrictions_cover_every_merge_input():
    assert public.local_media_args("ffmpeg", ["-i", "one.mp4", "-i", "two.mp4", "out.mp4"]) == [
        "-protocol_whitelist", "file,pipe", "-i", "one.mp4",
        "-protocol_whitelist", "file,pipe", "-i", "two.mp4", "out.mp4",
    ]
    assert public.local_media_args("ffprobe", ["-show_format", "one.mp4"])[0:2] == ["-protocol_whitelist", "file,pipe"]


def test_actual_decoder_wrappers_work_outside_api_and_refuse_network(tmp_path):
    public._decoder_wrappers(tmp_path)
    if not (tmp_path / "ffmpeg").exists():
        pytest.skip("FFmpeg is unavailable on this machine")
    # This exercises the executable script/module path and FFmpeg's own protocol
    # rejection; no listener or external request is used by the test.
    result = subprocess.run(
        [str(tmp_path / "ffmpeg"), "-v", "error", "-i", "http://127.0.0.1:1/forbidden", "-f", "null", "-"],
        cwd=tmp_path, capture_output=True, timeout=20,
    )
    assert result.returncode != 0
    assert b"not on whitelist" in result.stderr
    source, converted = tmp_path / "source.wav", tmp_path / "converted.mp3"
    with wave.open(str(source), "wb") as audio:
        audio.setparams((1, 2, 8000, 800, "NONE", "not compressed"))
        audio.writeframes(b"\0\0" * 800)
    result = subprocess.run(
        [str(tmp_path / "ffmpeg"), "-v", "error", "-i", str(source), "-threads", "1", str(converted)],
        cwd=tmp_path, capture_output=True, timeout=20,
    )
    assert result.returncode == 0 and converted.stat().st_size > 0
    if (tmp_path / "ffprobe").exists():
        result = subprocess.run(
            [str(tmp_path / "ffprobe"), "-v", "error", "http://127.0.0.1:1/forbidden"],
            cwd=tmp_path, capture_output=True, timeout=20,
        )
        assert result.returncode != 0 and b"not on whitelist" in result.stderr
        result = subprocess.run(
            [str(tmp_path / "ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "json", str(converted)],
            cwd=tmp_path, capture_output=True, timeout=20,
        )
        assert result.returncode == 0 and float(json.loads(result.stdout)["format"]["duration"]) > 0


def test_entrypoint_excludes_configs_plugins_external_fallback_and_remote_js(monkeypatch, tmp_path):
    recorded = {}

    class Downloader:
        def __init__(self, options):
            recorded.update(options)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def download(self, urls):
            assert urls == ["https://www.youtube.com/watch?v=abcdefghijk"]
            assert FFmpegFD.real_download is public._forbid_external_download
            directory = Path(recorded["ffmpeg_location"])
            for script in directory.iterdir():
                assert "local_media_main" in script.read_text()
            return 0

    # Deliberately conflicting local config must never enter options.
    config = tmp_path / "yt-dlp.conf"
    config.write_text("--exec unsafe-command\n--no-check-certificates\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(public, "PublicYoutubeDL", Downloader)
    monkeypatch.setattr(FFmpegFD, "real_download", FFmpegFD.real_download)
    monkeypatch.setattr(public.plugin_dirs, "value", public.plugin_dirs.value)
    monkeypatch.setattr(public.all_plugins_loaded, "value", public.all_plugins_loaded.value)
    assert public.main(["--dump-json", "--no-download", "https://www.youtube.com/watch?v=abcdefghijk"]) == 0
    assert recorded["external_downloader"] == {"default": "native"}
    assert not recorded["enable_file_urls"] and not recorded["nocheckcertificate"]
    assert not recorded["remote_components"] and recorded["js_runtimes"] == {"deno": {}}
    assert all(pp["key"] != "Exec" for pp in recorded["postprocessors"])


@pytest.mark.asyncio
async def test_acquirer_uses_injected_service_for_metadata_audio_and_frames(monkeypatch, tmp_path):
    from app.domains.workouts import extraction

    audio = tmp_path / "source.mp3"
    audio.write_bytes(b"synthetic audio")
    service = video.VideoService(public_egress=True)
    monkeypatch.setattr(extraction, "assert_public_http_url", AsyncMock())
    monkeypatch.setattr(service, "get_video_metadata_ytdlp", AsyncMock(return_value=video.VideoMetadata(
        title="Public source", description="Full caption", uploader="Creator",
        thumbnail="https://cdn.example/thumbnail.jpg", duration=30,
    )))
    monkeypatch.setattr(service, "download_audio", AsyncMock(return_value=video.AudioExtractionResult(
        success=True, file_path=str(audio), duration=30,
    )))
    monkeypatch.setattr(service, "extract_video_frames", AsyncMock(return_value=video.VideoFrameExtractionResult(
        success=False, error_code="NO_VIDEO_FRAMES",
    )))
    monkeypatch.setattr(service, "cleanup_audio_file", lambda path: None)
    provider = SimpleNamespace(transcribe=AsyncMock(return_value="Spoken source instructions"))
    result = await ProductionSourceAcquirer(video_service=service).acquire(
        "https://www.youtube.com/watch?v=abcdefghijk", provider,
    )
    assert [part.text for part in result.parts] == ["Full caption", "Spoken source instructions"]
    service.get_video_metadata_ytdlp.assert_awaited_once()
    service.download_audio.assert_awaited_once()
    service.extract_video_frames.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["metadata", "audio", "frames", "photo"])
async def test_all_social_subprocesses_use_the_locked_wrapper_and_shared_capacity(monkeypatch, tmp_path, kind):
    service = video.public_video_service
    assert service._media_slots is video.video_service._media_slots
    assert ProductionSourceAcquirer(video_service=service)._video_service() is service
    assert ProductionSourceAcquirer()._video_service() is video.video_service
    commands = []
    url = "https://www.tiktok.com/@fixture/photo/123" if kind == "photo" else "https://www.youtube.com/watch?v=abcdefghijk"

    class Process:
        returncode = 0

        async def communicate(self):
            return json.dumps({"title": "Synthetic source", "duration": 30, "images": ["https://cdn.example/one.jpg"]}).encode(), b""

    async def create(*command, **kwargs):
        commands.append(command)
        if "--output" in command:
            template = command[command.index("--output") + 1]
            Path(template.replace("%(ext)s", "mp3" if kind == "audio" else "mp4")).write_bytes(b"media")
        return Process()

    monkeypatch.setattr(video.asyncio, "create_subprocess_exec", create)
    monkeypatch.setattr(service, "_get_audio_duration", AsyncMock(return_value=30))
    monkeypatch.setattr(service, "_get_media_duration", AsyncMock(return_value=30))
    monkeypatch.setattr(service, "_scrape_tiktok_photo_images", AsyncMock(return_value=[]))
    if kind == "metadata":
        assert (await service.get_video_metadata_ytdlp(url)).title == "Synthetic source"
    elif kind == "audio":
        result = await service.download_audio(url)
        assert result.success
        service.cleanup_audio_file(result.file_path)
    elif kind == "frames":
        path, _ = await service._download_video_for_frames(url, str(tmp_path))
        assert Path(path).exists()
    else:
        await service.fetch_tiktok_photo_images(url)
    assert len(commands) == 1
    assert commands[0][:3] == (sys.executable, "-m", "app.services.public_ytdlp")
    assert commands[0][-1] == url
