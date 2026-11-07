"""Isolated yt-dlp with one pinned public HTTP(S) boundary and local decoders.

Run through the same Python interpreter as the API. This wrapper deliberately
uses the locked SDK rather than a global executable or installed plugins. Native
HTTP/HLS/DASH requests, including manifests, segments and keys, share its sole
request handler. Unsupported transports fail safely instead of falling back.
"""

import io
import json
import os
import re
import shutil
import sys
from functools import cached_property, partial
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
import yt_dlp
from curl_cffi.requests.exceptions import RequestException as CurlRequestError
from fastapi import HTTPException
from yt_dlp.cookies import YoutubeDLCookieJar
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

    def __init__(self, *, trusted_proxy=None, no_cookies=False, page_origin=None, **kwargs):
        super().__init__(**kwargs)
        self.trusted_proxy = trusted_proxy
        self.no_cookies = no_cookies
        self.page_origin = page_origin

    def _check_page_origin(self, url):
        if self.page_origin and urlsplit(url)[:2] != urlsplit(self.page_origin)[:2]:
            raise RequestError("Photo page origin changed")

    def _get_cookiejar(self, request):
        # A page-scoped session cannot borrow an extractor-supplied jar.
        return self.cookiejar if self.page_origin else super()._get_cookiejar(request)

    def _check_extensions(self, extensions):
        super()._check_extensions(extensions)
        for key in ("cookiejar", "timeout", "legacy_ssl", "keep_header_casing", "impersonate"):
            extensions.pop(key, None)

    def _send(self, request):
        self._check_page_origin(request.url)
        if target := self._get_request_target(request):
            return self._send_impersonated(request, target)
        client = None
        try:
            client = httpx.Client(
                transport=PublicSyncHTTPTransport(proxy=self.trusted_proxy),
                cookies=None if self.no_cookies else self._get_cookiejar(request), trust_env=False,
                follow_redirects=False, max_redirects=5,
                timeout=min(self._calculate_timeout(request), 30),
            )
            headers = httpx.Headers(self._get_headers(request))
            # HTTPX handles decoding; never advertise unavailable brotli/zstd.
            headers["Accept-Encoding"] = "gzip, deflate"
            headers.pop("Proxy-Authorization", None)
            if self.no_cookies or self.page_origin:
                headers.pop("Cookie", None)
                headers.pop("Authorization", None)
            outgoing = client.build_request(
                request.method, request.url, headers=headers, content=request.data,
            )
            # HTTPX eagerly reads intermediate bodies when following redirects.
            # Keep its cookie/method/auth redirect rules, but discard each body
            # before the next send revalidates its destination through transport.
            for _ in range(6):  # Initial request plus at most five redirect hops.
                response = client.send(outgoing, stream=True, follow_redirects=False)
                if response.next_request is None:
                    break
                outgoing = response.next_request
                if self.page_origin:
                    try:
                        self._check_page_origin(str(outgoing.url))
                    except RequestError:
                        response.close()
                        client.close()
                        raise
                if self.no_cookies:
                    outgoing.headers.pop("Cookie", None)
                    outgoing.headers.pop("Authorization", None)
                response.close()
            else:
                raise httpx.TooManyRedirects(
                    "Public media redirect limit reached", request=outgoing,
                )
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
        self._check_page_origin(url)
        headers = httpx.Headers(self._get_impersonate_headers(request))
        headers.pop("Host", None)
        headers.pop("Proxy-Authorization", None)
        if self.no_cookies or self.page_origin:
            headers.pop("Cookie", None)
            headers.pop("Authorization", None)
        for hop in range(6):
            owner = None
            try:
                owner = PublicCurlSession(
                    url, proxy=self.trusted_proxy,
                    cookies=None if self.no_cookies else self._get_cookiejar(request),
                )
                response = owner.request(
                    method, headers=dict(headers), data=data,
                    timeout=min(self._calculate_timeout(request), 30),
                    impersonate=self._SUPPORTED_IMPERSONATE_TARGET_MAP[target],
                )
                if response.status_code in {301, 302, 303, 307, 308} and response.headers.get("Location"):
                    next_url = urljoin(url, response.headers["Location"])
                    self._check_page_origin(next_url)
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
            partial(PublicRH, trusted_proxy=self.params.get("proxy"),
                    no_cookies=self.params.get("public_photo_no_cookies", False),
                    page_origin=self.params.get("public_photo_page_origin")),
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


class PhotoYoutubeDL(PublicYoutubeDL):
    def _check_page_payload(self, payload):
        pass

    def urlopen(self, request):
        response = super().urlopen(request)
        try:
            payload = response.read(5 * 1024 * 1024 + 1)
            if len(payload) > 5 * 1024 * 1024:
                raise ValueError("Photo page limit")
            self._check_page_payload(payload)
            return Response(io.BytesIO(payload), url=response.url, headers=dict(response.headers),
                            status=response.status, reason=response.reason,
                            extensions=response.extensions)
        finally:
            response.close()


class TikTokPhotoYoutubeDL(PhotoYoutubeDL):
    """A fresh TikTok-only session; never load or save an account's cookies."""

    def __init__(self, params):
        params = {**params, "cookiefile": None, "cookiesfrombrowser": None,
                  "http_headers": {}, "public_photo_no_cookies": False,
                  "public_photo_page_origin": "https://www.tiktok.com"}
        super().__init__(params)

    @cached_property
    def cookiejar(self):
        return YoutubeDLCookieJar()

    def save_cookies(self):
        pass  # Never persist this page session, even if SDK options change.

    def _check_page_payload(self, payload):
        challenge = re.search(rb'<[^>]+\bid=[\"\x27](?:cs|wci)[\"\x27]', payload, re.I)
        if not challenge and b"site maintenance" in payload.lower() and b"__UNIVERSAL_DATA_FOR_REHYDRATION__" not in payload:
            raise TikTokPhotoReadError("page_maintenance", "SiteMaintenance")

    def close(self):
        try:
            super().close()
        finally:
            self.cookiejar.clear()


class TikTokPhotoReadError(ValueError):
    """Content-free final stage, after one retry within the import deadline."""

    def __init__(self, stage, exception_type, code="SOURCE_RESPONSE_INVALID"):
        self.stage, self.exception_type = stage, exception_type
        self.code = code
        super().__init__(code)


def _read_tiktok_photo(downloader, url, identifier):
    from yt_dlp.extractor.tiktok import TikTokIE

    from app.services.photo_posts import parse_tiktok_photo
    from app.services.video import get_friendly_video_error

    class PhotoTikTokIE(TikTokIE):
        status_message = ""
        def _get_universal_data(self, webpage, display_id):
            data = super()._get_universal_data(webpage, display_id)
            detail = data.get("webapp.video-detail") or {}
            self.status_message = detail.get("statusMsg") or detail.get("statusMessage") or ""
            return data

    # Keep TikTok's newly issued session cookies for the retry, but never beyond
    # this downloader. The parent subprocess deadline bounds both attempts.
    for attempt in range(2):
        stage = "page_read"
        try:
            extractor = PhotoTikTokIE(downloader)
            item, status = extractor._extract_web_data_and_status(url, identifier)
            stage = "page_shape"
            if status != 0:
                code = {10216: "VIDEO_PRIVATE", 10222: "VIDEO_PRIVATE", 10204: "ACCESS_DENIED"}.get(status, "SOURCE_UNAVAILABLE")
                # 10204 is ambiguous (IP denial OR removed content). Only an
                # explicit source status message justifies saying it was removed.
                message = str(extractor.status_message).lower()
                if status == 10204 and message in {"status_deleted", "item doesn't exist", "video doesn't exist"}:
                    code = "VIDEO_REMOVED"
                raise TikTokPhotoReadError("page_status", "TikTokStatus", code)
            return parse_tiktok_photo(item, identifier)
        except Exception as exc:
            if attempt or getattr(exc, "code", None) in {"VIDEO_PRIVATE", "VIDEO_REMOVED", "ACCESS_DENIED"}:
                code = getattr(exc, "code", None)
                if not code:
                    code = "SOURCE_RESPONSE_INVALID" if stage == "page_shape" else get_friendly_video_error(str(exc), "tiktok")[0]
                raise TikTokPhotoReadError(
                    getattr(exc, "stage", stage), getattr(exc, "exception_type", type(exc).__name__),
                    code,
                ) from None


def photo_json(url):
    """One deliberately narrow adapter to the locked yt-dlp private TikTok API.

    Keep the private call here, in the killed-on-timeout guarded subprocess.
    Shape drift is an error, never a successful empty/thumbnail-only carousel.
    """
    from app.services.photo_posts import parse_instagram_photo

    parsed_url = urlsplit(url)
    if parsed_url.hostname in {"m.tiktok.com", "tiktok.com"} and not parsed_url.username and not parsed_url.port:
        url = urlunsplit((parsed_url.scheme, "www.tiktok.com", parsed_url.path, parsed_url.query, ""))
    match = re.fullmatch(r"https://www\.tiktok\.com/(@[^/]+)/photo/(\d+)", url)
    instagram = re.fullmatch(r"https://www\.instagram\.com/p/[A-Za-z0-9_-]+/?", url)
    if not match and not instagram:
        raise ValueError("Invalid photo URL")
    from app.config import get_settings

    downloader_class = TikTokPhotoYoutubeDL if match else PhotoYoutubeDL
    with downloader_class({
        "quiet": True, "no_warnings": True, "cachedir": False,
        "proxy": get_settings().youtube_proxy if instagram else None,
        "socket_timeout": 10 if match else 15, "retries": 0, "extractor_retries": 0,
        "public_photo_no_cookies": True, "ignore_no_formats_error": True,
        "remote_components": set(), "js_runtimes": {},
        "enable_file_urls": False, "nocheckcertificate": False,
    }) as downloader:
        if instagram:
            from yt_dlp.extractor.instagram import InstagramIE

            info = InstagramIE(downloader).extract(url)
            if info.get("id") != urlsplit(url).path.strip("/").split("/")[-1]:
                raise ValueError("Photo response identity changed")
            entries = info.get("entries") or [info]
            if any(entry.get("formats") or entry.get("url") for entry in entries):
                # Keep public /p/ videos on their existing audio/frame path,
                # without fetching the same metadata a second time.
                return {"title": info.get("title") or "", "description": info.get("description") or "",
                        "uploader": info.get("channel") or info.get("uploader") or "",
                        "duration": info.get("duration") or 0, "slides": None,
                        "thumbnail": (entries[0].get("thumbnails") or [{}])[-1].get("url")}
            return parse_instagram_photo(info)
        return _read_tiktok_photo(downloader, url.replace("/photo/", "/video/"), match[2])


def main(argv=None):
    plugin_dirs.value = []
    all_plugins_loaded.value = True
    arguments = sys.argv[1:] if argv is None else argv
    if arguments[:1] == ["--public-photo-json"]:
        if len(arguments) != 2:
            raise ValueError("One photo URL required")
        try:
            print(json.dumps(photo_json(arguments[1])))
            return 0
        except Exception as exc:
            from app.services.photo_posts import PhotoSourceError
            from app.services.video import get_friendly_video_error

            code = getattr(exc, "code", None) or ("SOURCE_RESPONSE_INVALID" if isinstance(exc, ValueError) else get_friendly_video_error(str(exc), "tiktok")[0])
            error = PhotoSourceError(code, stage=getattr(exc, "stage", "metadata"),
                                     exception_type=getattr(exc, "exception_type", type(exc).__name__))
            print(json.dumps({"error_code": error.code, "stage": error.stage,
                              "exception_type": error.exception_type}))
            return 1
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
