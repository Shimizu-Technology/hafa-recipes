"""Isolated yt-dlp with one pinned public HTTP(S) boundary and local decoders.

Run through the same Python interpreter as the API. This wrapper deliberately
uses the locked SDK rather than a global executable or installed plugins. Native
HTTP/HLS/DASH requests, including manifests, segments and keys, share its sole
request handler. Unsupported transports fail safely instead of falling back.
"""

import io
import os
import shutil
import sys
from functools import partial
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urljoin, urlsplit

import httpx
import yt_dlp
from curl_cffi.requests.exceptions import RequestException as CurlRequestError
from fastapi import HTTPException
from yt_dlp.downloader import get_suitable_downloader
from yt_dlp.downloader.dash import DashSegmentsFD
from yt_dlp.downloader.external import FFmpegFD
from yt_dlp.downloader.hls import HlsFD
from yt_dlp.downloader.http import HttpFD
from yt_dlp.globals import all_plugins_loaded, plugin_dirs
from yt_dlp.networking._curlcffi import CurlCFFIResponseAdapter, CurlCFFIRH
from yt_dlp.networking.common import Response
from yt_dlp.networking.exceptions import HTTPError, RequestError, TransportError
from yt_dlp.networking.impersonate import ImpersonateRequestHandler
from yt_dlp.utils import DownloadError

from app.security import PublicCurlSession, PublicSyncHTTPTransport


class _ResponseReader(io.RawIOBase):
    def __init__(self, response, client):
        self.response, self.client = response, client
        self.chunks = response.iter_bytes(chunk_size=64 * 1024)
        self.pending = b""

    def readable(self):
        return True

    def readinto(self, buffer):
        try:
            if not self.pending:
                self.pending = next(self.chunks, b"")
            count = min(len(buffer), len(self.pending))
            buffer[:count] = self.pending[:count]
            self.pending = self.pending[count:]
            return count
        except httpx.HTTPError:
            raise TransportError("Public media response failed") from None

    def close(self):
        try:
            self.response.close()
        finally:
            self.client.close()
            super().close()


class _PublicCurlResponse(CurlCFFIResponseAdapter):
    def __init__(self, response, owner):
        super().__init__(response)
        self.owner = owner

    def read(self, amt=None):
        try:
            return super().read(amt)
        finally:
            # The SDK reader closes its raw response on a streaming error,
            # before the adapter can call close(). Release our native list too.
            if self.fp.closed:
                self.owner.close()

    def close(self):
        try:
            super().close()
        finally:
            self.owner.close()


class PublicRH(ImpersonateRequestHandler):
    _SUPPORTED_URL_SCHEMES = ("http", "https")
    # Reuse the locked SDK's installed-target catalogue, never its unpinned
    # networking implementation. TikTok explicitly requests browser TLS identity.
    _SUPPORTED_IMPERSONATE_TARGET_MAP = CurlCFFIRH._SUPPORTED_IMPERSONATE_TARGET_MAP
    # Request-specified proxy maps are ignored; only the server's trusted proxy
    # is used. Environment NO_PROXY or extractor geo proxies cannot bypass it.
    _SUPPORTED_PROXY_SCHEMES = None
    _SUPPORTED_FEATURES = None

    def __init__(self, *, trusted_proxy=None, **kwargs):
        super().__init__(**kwargs)
        self.trusted_proxy = trusted_proxy

    def _check_extensions(self, extensions):
        super()._check_extensions(extensions)
        for key in ("cookiejar", "timeout", "legacy_ssl", "keep_header_casing", "impersonate"):
            extensions.pop(key, None)

    def _send(self, request):
        if target := self._get_request_target(request):
            return self._send_impersonated(request, target)
        client = None
        try:
            client = httpx.Client(
                transport=PublicSyncHTTPTransport(proxy=self.trusted_proxy),
                cookies=self._get_cookiejar(request), trust_env=False,
                follow_redirects=True, max_redirects=5,
                timeout=min(self._calculate_timeout(request), 30),
            )
            headers = httpx.Headers(self._get_headers(request))
            # HTTPX handles decoding; never advertise unavailable brotli/zstd.
            headers["Accept-Encoding"] = "gzip, deflate"
            headers.pop("Proxy-Authorization", None)
            outgoing = client.build_request(
                request.method, request.url, headers=headers, content=request.data,
            )
            response = client.send(outgoing, stream=True)
            headers = dict(response.headers)
            headers.pop("content-encoding", None)
            # Decoded bytes may differ from Content-Length on the wire.
            if response.headers.get("content-encoding"):
                headers.pop("content-length", None)
            result = Response(
                io.BufferedReader(_ResponseReader(response, client)),
                url=str(response.url), headers=headers, status=response.status_code,
                reason=response.reason_phrase,
            )
        except (httpx.HTTPError, HTTPException, ValueError):
            if client is not None:
                client.close()
            raise RequestError("Public media destination unavailable") from None
        if response.status_code >= 400:
            raise HTTPError(result)
        return result

    def _send_impersonated(self, request, target):
        url, method, data = request.url, request.method, request.data
        headers = httpx.Headers(self._get_impersonate_headers(request))
        headers.pop("Host", None)
        headers.pop("Proxy-Authorization", None)
        for hop in range(6):
            owner = None
            try:
                owner = PublicCurlSession(
                    url, proxy=self.trusted_proxy, cookies=self._get_cookiejar(request),
                )
                response = owner.request(
                    method, headers=dict(headers), data=data,
                    timeout=min(self._calculate_timeout(request), 30),
                    impersonate=self._SUPPORTED_IMPERSONATE_TARGET_MAP[target],
                )
                if response.status_code in {301, 302, 303, 307, 308} and response.headers.get("Location"):
                    next_url = urljoin(url, response.headers["Location"])
                    if hop == 5:
                        raise RequestError("Public media redirect limit reached")
                    # Cookies are selected from the jar for the new URL. Never
                    # copy an explicit cookie/auth header across an origin hop.
                    headers.pop("Cookie", None)
                    if urlsplit(next_url).netloc != urlsplit(url).netloc or urlsplit(next_url).scheme != urlsplit(url).scheme:
                        headers.pop("Authorization", None)
                    if (response.status_code == 303 and method != "HEAD") or (response.status_code in {301, 302} and method == "POST"):
                        method, data = "GET", None
                        for key in ("Content-Length", "Content-Type", "Transfer-Encoding"):
                            headers.pop(key, None)
                    owner.close()
                    url = next_url  # the next iteration validates before any connection
                    continue
                result = _PublicCurlResponse(response, owner)
                result.extensions["impersonate"] = target
            except (CurlRequestError, HTTPException, ValueError):
                if owner is not None:
                    owner.close()
                raise RequestError("Public media destination unavailable") from None
            except BaseException:
                if owner is not None:
                    owner.close()
                raise
            if response.status_code >= 400:
                raise HTTPError(result)
            return result


class PublicYoutubeDL(yt_dlp.YoutubeDL):
    def build_request_director(self, handlers, preferences=None):
        # Never register unpinned handlers, even as a lower-priority fallback.
        return super().build_request_director([
            partial(PublicRH, trusted_proxy=self.params.get("proxy")),
        ])

    def dl(self, name, info, subtitle=False, test=False):
        downloader = get_suitable_downloader(info, self.params, to_stdout=name == "-")
        if downloader not in {HttpFD, HlsFD, DashSegmentsFD}:
            raise DownloadError("This media transport is unavailable for public imports")
        return super().dl(name, info, subtitle=subtitle, test=test)


def _forbid_external_download(*args, **kwargs):
    # Native HLS may internally delegate to FFmpeg despite --downloader native.
    raise DownloadError("This media requires an unsupported external downloader")


def local_media_args(program, args):
    """Apply the protocol restriction to every input, including FFmpeg merges."""
    if program == "ffprobe":
        return ["-protocol_whitelist", "file,pipe", *args]
    result = []
    for argument in args:
        if argument == "-i":
            result.extend(["-protocol_whitelist", "file,pipe"])
        result.append(argument)
    return result


def local_media_main(program, executable):
    os.execv(executable, [executable, *local_media_args(program, sys.argv[1:])])


def _decoder_wrappers(directory):
    for program in ("ffmpeg", "ffprobe"):
        executable = shutil.which(program)
        if not executable:
            continue
        script = Path(directory) / program
        script.write_text(
            f"#!{sys.executable}\n"
            "import sys\n"
            f"sys.path.insert(0, {str(Path(__file__).resolve().parents[2])!r})\n"
            "from app.services.public_ytdlp import local_media_main\n"
            f"local_media_main({program!r}, {executable!r})\n"
        )
        script.chmod(0o700)


def main(argv=None):
    # parse_options alone does not invoke user update/exec/plugin workflows.
    plugin_dirs.value = []
    all_plugins_loaded.value = True
    parsed = yt_dlp.parse_options([
        "--ignore-config", "--no-plugin-dirs", *(sys.argv[1:] if argv is None else argv),
    ])
    options = parsed.ydl_opts
    options.update({
        "external_downloader": {"default": "native"}, "hls_prefer_native": True,
        "enable_file_urls": False, "nocheckcertificate": False,
        "cachedir": False, "remote_components": set(), "js_runtimes": {"deno": {}},
        "geo_verification_proxy": None,
    })
    # Only the postprocessors used by the server's metadata/audio/frame commands.
    if any(pp["key"] not in {"FFmpegExtractAudio", "FFmpegConcat"}
           for pp in options["postprocessors"]):
        raise DownloadError("Unsupported public media postprocessor")
    FFmpegFD.real_download = _forbid_external_download
    with TemporaryDirectory(prefix="public-media-tools-") as directory:
        _decoder_wrappers(directory)
        options["ffmpeg_location"] = directory
        with PublicYoutubeDL(options) as downloader:
            return downloader.download(parsed.urls)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (DownloadError, RequestError, ValueError):
        # Provider errors may contain cookies, signed media URLs or proxy auth.
        print("Public media acquisition failed", file=sys.stderr)
        raise SystemExit(1) from None
