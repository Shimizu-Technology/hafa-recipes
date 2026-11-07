"""Ordered public photo evidence: synthetic bytes only, never real post content."""

import io
from unittest.mock import AsyncMock

import httpx
import pytest
from PIL import Image

from app.services import photo_posts as photos
from app.services import public_ytdlp


def item():
    return {"id": "123", "desc": "Hospital bag", "author": {"uniqueId": "creator"},
            "imagePost": {"title": "Packing", "images": [
                {"imageURL": {"urlList": ["https://cdn.example/a", "https://cdn.example/b"]}},
                {"imageURL": {"urlList": ["https://cdn.example/c"]}},
            ]}}


def test_locked_sdk_photo_shape_and_order():
    parsed = photos.parse_tiktok_photo(item(), "123")
    assert parsed["description"] == "Hospital bag" and parsed["uploader"] == "creator"
    assert parsed["slides"] == [["https://cdn.example/a", "https://cdn.example/b"], ["https://cdn.example/c"]]
    for invalid in ({}, {**item(), "id": "456"}, {**item(), "imagePost": {}},
                    {**item(), "imagePost": {"images": [{"url": "wrong shape"}]}}):
        with pytest.raises(ValueError):
            photos.parse_tiktok_photo(invalid, "123")


async def test_mirror_partial_order_downscale_and_cookie_free_redirect(monkeypatch):
    output = io.BytesIO()
    Image.new("RGB", (2160, 2880), "white").save(output, format="PNG")
    requests = []

    def handler(request):
        requests.append(request)
        assert not request.headers.get("cookie")
        if request.url.path == "/a":
            return httpx.Response(302, headers={"location": "/missing", "set-cookie": "session=secret"})
        if request.url.path in {"/missing", "/c"}:
            return httpx.Response(404)
        return httpx.Response(200, content=output.getvalue(), headers={"content-type": "image/png"})

    monkeypatch.setattr(photos, "PublicHTTPTransport", lambda: httpx.MockTransport(handler))
    monkeypatch.setattr(photos, "assert_public_http_url", AsyncMock())
    parsed = photos.parse_tiktok_photo(item(), "123")
    images, notes = await photos.download_photo_images(parsed["slides"] + [["https://cdn.example/d"]])
    assert [index for index, _ in images] == [0, 2]
    import base64
    with Image.open(io.BytesIO(base64.b64decode(images[0][1]))) as image:
        assert image.size == (1200, 1600)
    assert notes == ["Read 2 of 3 slides; 1 slides were left out.", "Slide 2 could not be read; its details may be missing."]
    guarded = [call.args[0] for call in photos.assert_public_http_url.await_args_list]
    assert all(str(request.url) in guarded for request in requests)
    assert "https://cdn.example/missing" in guarded
    assert all(r.headers["referer"] == "https://www.tiktok.com/" for r in requests)


async def test_slide_cap_and_deadline_are_disclosed(monkeypatch):
    import asyncio
    monkeypatch.setattr(photos, "PublicHTTPTransport", lambda: httpx.MockTransport(lambda r: pytest.fail("expired deadline")))
    images, notes = await photos.download_photo_images([["https://cdn.example/a"]] * 36,
                                                       deadline=asyncio.get_running_loop().time() - 1)
    assert images == [] and len(notes) == 37
    assert "35 of 36" in notes[0]


@pytest.mark.parametrize("host", ["www.tiktok.com", "m.tiktok.com"])
def test_photo_adapter_uses_locked_private_method_and_rewritten_url(monkeypatch, host):
    from yt_dlp.extractor.tiktok import TikTokIE
    calls = []
    def read(self, url, identifier):
        calls.append((url, identifier))
        assert self._downloader.params["public_photo_no_cookies"] is False
        assert self._downloader.params["public_photo_page_origin"] == "https://www.tiktok.com"
        return item(), 0
    monkeypatch.setattr(TikTokIE, "_extract_web_data_and_status", read)
    assert public_ytdlp.photo_json(f"https://{host}/@creator/photo/123")["slides"]
    assert calls == [("https://www.tiktok.com/@creator/video/123", "123")]


def test_instagram_single_and_carousel_stills_before_no_formats_rejection():
    def still(name):
        return {"formats": [], "thumbnails": [{"url": f"https://cdn.example/{name}", "width": 100, "height": 100}]}
    assert photos.parse_instagram_photo(still("one"))["slides"] == [["https://cdn.example/one"]]
    carousel = {"description": "Creator caption", "entries": [still("one"), still("two")]}
    assert photos.parse_instagram_photo(carousel)["slides"] == [["https://cdn.example/one"], ["https://cdn.example/two"]]
    with pytest.raises(ValueError, match="Video or mixed"):
        photos.parse_instagram_photo({"formats": [{"url": "https://cdn.example/video"}]})


async def test_photo_metadata_bypasses_audio_and_keeps_caption(monkeypatch):
    from types import SimpleNamespace

    from app.domains.workouts.extraction import ProductionSourceAcquirer
    from app.services.video import VideoMetadata
    service = SimpleNamespace(
        detect_platform=lambda _: "tiktok", normalize_url=AsyncMock(return_value="https://www.tiktok.com/@creator/photo/123"),
        get_video_metadata_ytdlp=AsyncMock(return_value=VideoMetadata(
            title="Packing", description="Caption", uploader="Creator", thumbnail="https://cdn.example/a",
            photo_slides=[["https://cdn.example/a"]])),
        fetch_oembed=AsyncMock(), is_tiktok_photo_post=lambda _: True,
        download_audio=AsyncMock(side_effect=AssertionError("Photo music must never be transcribed")),
    )
    monkeypatch.setattr("app.domains.workouts.extraction.assert_public_http_url", AsyncMock())
    monkeypatch.setattr(photos, "download_photo_images", AsyncMock(return_value=([(0,"synthetic")], ["Slide 2 could not be read."])))
    source = await ProductionSourceAcquirer(video_service=service).acquire("https://www.tiktok.com/@creator/photo/123", None)
    assert source.parts[0].text == "Caption" and source.metadata.creator == "Creator"
    assert source.metadata.url == "https://www.tiktok.com/@creator/photo/123"
    assert source.metadata.canonical_key == "tiktok:photo:123"
    assert source.images[0].location == "image:0" and source.metadata.coverage_notes
    service.download_audio.assert_not_awaited()


@pytest.mark.parametrize("image_url", [None, "unexpected", {}])
def test_one_malformed_slide_keeps_caption_and_other_slides_in_place(image_url):
    source = item()
    source["imagePost"]["images"][0] = {"imageURL": image_url}
    parsed = photos.parse_tiktok_photo(source, "123")
    assert parsed["description"] == "Hospital bag"
    assert parsed["slides"] == [[], ["https://cdn.example/c"]]


def test_instagram_adapter_keeps_single_image_after_expected_no_video(monkeypatch):
    from yt_dlp.extractor.instagram import InstagramIE
    monkeypatch.setattr(InstagramIE, "_real_initialize", lambda self: None)
    def raw(self, url):
        assert self._downloader.params["public_photo_no_cookies"] is True
        assert not self._downloader.params.get("public_photo_page_origin")
        self.raise_no_formats("There is no video in this post", expected=True)
        return {"id":"Synthetic", "description":"Caption", "thumbnails":[{"url":"https://cdn.example/one", "width":100, "height":100}]}
    monkeypatch.setattr(InstagramIE, "_real_extract", raw)
    assert public_ytdlp.photo_json("https://www.instagram.com/p/Synthetic/")["slides"] == [["https://cdn.example/one"]]


def test_instagram_video_metadata_is_not_fetched_twice(monkeypatch):
    from yt_dlp.extractor.instagram import InstagramIE
    monkeypatch.setattr(InstagramIE, "_real_initialize", lambda self: None)
    monkeypatch.setattr(InstagramIE, "_real_extract", lambda self, url: {
        "id":"Synthetic", "title":"Video", "description":"Thin caption", "duration":20,
        "formats":[{"url":"https://cdn.example/video"}]})
    post = public_ytdlp.photo_json("https://www.instagram.com/p/Synthetic/")
    assert post["slides"] is None and post["duration"] == 20 and post["description"] == "Thin caption"


@pytest.mark.parametrize("missing", [0, 11])
async def test_successful_slide_cap_refunds_empty_errors_and_follows_redirect(monkeypatch, missing):
    output = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(output, format="PNG")
    visited = []
    def handler(request):
        name = request.url.path.strip("/")
        visited.append(name)
        if name == "0":
            return httpx.Response(302, headers={"location":"/redirected"})
        index = 0 if name == "redirected" else int(name)
        if index < missing:
            return httpx.Response(404, content=b"")
        return httpx.Response(200, content=output.getvalue(), headers={"content-type":"image/png"})
    monkeypatch.setattr(photos, "PublicHTTPTransport", lambda: httpx.MockTransport(handler))
    monkeypatch.setattr(photos, "assert_public_http_url", AsyncMock())
    images, notes = await photos.download_photo_images([[f"https://cdn.example/{i}"] for i in range(36)])
    assert [i for i, _ in images] == list(range(missing, 35))
    assert "35" not in visited and "redirected" in visited and "35 of 36" in notes[0]


async def test_pool_wait_honors_deadline_without_losing_completed_slides(monkeypatch):
    import asyncio
    from contextlib import asynccontextmanager

    from app.services.video import public_video_service
    @asynccontextmanager
    async def busy():
        await asyncio.Event().wait()
        yield
    monkeypatch.setattr(public_video_service, "_media_slot", busy)
    images, notes = await photos.download_photo_images([["https://cdn.example/0"]],
        deadline=asyncio.get_running_loop().time() + .01)
    assert images == [] and "Read 0 of 1" in notes[0]


@pytest.mark.parametrize("caption,images,status", [("", [(0,"data")], "failed"), ("Caption", [], "failed"), ("Caption", [(0,"data")], "ok")])
async def test_real_probe_checks_caption_images_and_stage(monkeypatch, caption, images, status):
    from types import SimpleNamespace
    service = SimpleNamespace(fetch_photo_post=AsyncMock(return_value={"description":caption,"slides":[["https://cdn.example/0"]]}))
    monkeypatch.setattr(photos, "download_photo_images", AsyncMock(return_value=(images, [])))
    stages = []
    result = await photos.probe_photo_post(service, "https://www.tiktok.com/@creator/photo/123", on_stage=stages.append)
    assert result["status"] == status and stages == ["metadata", "images"]


async def test_completed_slide_survives_batch_deadline(monkeypatch):
    import asyncio
    output = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(output, format="PNG")
    async def handler(request):
        if request.url.path == "/slow":
            await asyncio.sleep(1)
        return httpx.Response(200, content=output.getvalue(), headers={"content-type":"image/png"})
    monkeypatch.setattr(photos, "PublicHTTPTransport", lambda: httpx.MockTransport(handler))
    monkeypatch.setattr(photos, "assert_public_http_url", AsyncMock())
    images, notes = await photos.download_photo_images([["https://cdn.example/fast"], ["https://cdn.example/slow"]],
        deadline=asyncio.get_running_loop().time() + .05)
    assert [i for i, _ in images] == [0] and "Read 1 of 2" in notes[0]


def test_photo_cli_shape_failure_prints_only_safe_code(monkeypatch, capsys):
    def invalid(_):
        raise ValueError("private source text and token")
    monkeypatch.setattr(public_ytdlp, "photo_json", invalid)
    assert public_ytdlp.main(["--public-photo-json", "https://www.tiktok.com/@creator/photo/123"]) == 1
    assert __import__("json").loads(capsys.readouterr().out) == {"error_code": "SOURCE_RESPONSE_INVALID", "stage": "metadata", "exception_type": "ValueError"}


async def test_photo_subprocess_rate_limit_reaches_metadata_without_raw_errors(monkeypatch):
    from app.services.video import VideoService
    class Process:
        returncode = 1
        async def communicate(self):
            return b'{"error_code":"RATE_LIMITED"}', b'private source text and cookie'
    monkeypatch.setattr("app.services.video.asyncio.create_subprocess_exec", AsyncMock(return_value=Process()))
    service = VideoService()
    metadata = await service.get_video_metadata_ytdlp("https://www.tiktok.com/@creator/photo/123")
    assert metadata.error_code == "RATE_LIMITED"


@pytest.mark.parametrize("recover", [False, True])
def test_maintenance_retries_once_with_same_ephemeral_jar_and_safe_stage(monkeypatch, recover):
    from yt_dlp.extractor.tiktok import TikTokIE
    calls = []
    def read(self, url, identifier):
        calls.append(self._downloader.cookiejar)
        if recover and len(calls) == 2:
            return item(), 0
        self._downloader._check_page_payload(b"<html>Site Maintenance</html>")
    monkeypatch.setattr(TikTokIE, "_extract_web_data_and_status", read)
    if recover:
        assert public_ytdlp.photo_json("https://www.tiktok.com/@creator/photo/123")["slides"]
    else:
        with pytest.raises(public_ytdlp.TikTokPhotoReadError) as raised:
            public_ytdlp.photo_json("https://www.tiktok.com/@creator/photo/123")
        assert (raised.value.stage, raised.value.exception_type) == ("page_maintenance", "SiteMaintenance")
    assert len(calls) == 2 and calls[0] is calls[1] and not list(calls[0])


def test_retry_shape_drift_fails_loudly_without_source_text(monkeypatch, capsys):
    from yt_dlp.extractor.tiktok import TikTokIE
    calls = []
    def read(self, *args):
        calls.append(1)
        return {"desc": "private source text"}, 0
    monkeypatch.setattr(TikTokIE, "_extract_web_data_and_status", read)
    assert public_ytdlp.main(["--public-photo-json", "https://www.tiktok.com/@creator/photo/123"]) == 1
    output = capsys.readouterr().out
    assert len(calls) == 2 and "private source text" not in output
    assert '"stage": "page_shape"' in output and '"exception_type": "ValueError"' in output


@pytest.mark.parametrize("failure,stage,exception_type", [
    (photos.PhotoSourceError("SOURCE_RESPONSE_INVALID", stage="page_maintenance", exception_type="SiteMaintenance"), "page_maintenance", "SiteMaintenance"),
    (RuntimeError("private text, session=secret"), "metadata", "RuntimeError"),
])
async def test_probe_failure_reports_only_stage_type_and_counts(failure, stage, exception_type):
    from types import SimpleNamespace
    service = SimpleNamespace(fetch_photo_post=AsyncMock(side_effect=failure))
    report = await photos.diagnose_photo_post(service, "https://www.tiktok.com/@creator/photo/123")
    assert report == {"status": "failed", "stage": stage, "exception_type": exception_type,
                      "slides": 0, "images_read": 0, "caption_chars": 0, "coverage_notes": 0}
    assert "private" not in str(report) and "secret" not in str(report)


async def test_probe_partial_coverage_retains_counts_and_failure_stage(monkeypatch):
    from types import SimpleNamespace
    service = SimpleNamespace(fetch_photo_post=AsyncMock(return_value={"description":"Caption", "slides":[[], []]}))
    monkeypatch.setattr(photos, "download_photo_images", AsyncMock(return_value=([(0, "data")], ["Slide 2 failed"])))
    report = await photos.diagnose_photo_post(service, "https://www.tiktok.com/@creator/photo/123")
    assert report == {"status":"failed", "stage":"images", "exception_type":"IncompleteCoverage",
                      "slides":2, "images_read":1, "caption_chars":7, "coverage_notes":1}


async def test_page_cookie_cannot_reach_same_host_image_or_cdn_redirect(monkeypatch):
    from curl_cffi.requests import Cookies
    output = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(output, format="PNG")
    visited = []
    def handler(request):
        visited.append(request.url.host)
        assert "cookie" not in request.headers and "authorization" not in request.headers
        if request.url.host == "www.tiktok.com":
            return httpx.Response(302, headers={"location":"https://cdn.example/slide", "set-cookie":"cdn=secret; Path=/"})
        return httpx.Response(200, content=output.getvalue(), headers={"content-type":"image/png"})
    monkeypatch.setattr(photos, "PublicHTTPTransport", lambda: httpx.MockTransport(handler))
    monkeypatch.setattr(photos, "assert_public_http_url", AsyncMock())
    with public_ytdlp.TikTokPhotoYoutubeDL({"quiet":True}) as dl:
        Cookies(dl.cookiejar).set("page", "synthetic-secret", domain=".tiktok.com", secure=True)
        assert list(dl.cookiejar)
        images, notes = await photos.download_photo_images([["https://www.tiktok.com/slide"]])
        assert images and not notes
    assert not list(dl.cookiejar) and visited == ["www.tiktok.com", "cdn.example"]

@pytest.mark.parametrize("status,code", [(10216,"VIDEO_PRIVATE"),(10222,"VIDEO_PRIVATE"),(10204,"ACCESS_DENIED"),(99999,"SOURCE_UNAVAILABLE")])
def test_tiktok_status_is_not_treated_as_success_or_shape_drift(monkeypatch, capsys, status, code):
    import json

    from yt_dlp.extractor.tiktok import TikTokIE
    monkeypatch.setattr(TikTokIE,"_extract_web_data_and_status",lambda *a,**k:(item(),status))
    assert public_ytdlp.main(["--public-photo-json","https://www.tiktok.com/@creator/photo/123"])==1
    result=json.loads(capsys.readouterr().out)
    assert result["error_code"]==code and result["stage"]=="page_status" and "slides" not in result


def test_explicit_deleted_status_and_http_rate_limit_keep_typed_cause(monkeypatch, capsys):
    import json

    from yt_dlp.extractor.tiktok import TikTokIE
    from yt_dlp.utils import ExtractorError
    monkeypatch.setattr(TikTokIE,"_get_universal_data",lambda *a:{"webapp.video-detail":{"statusMsg":"status_deleted"}})
    def deleted(self,*args):
        self._get_universal_data("fixture","123")
        return None,10204
    monkeypatch.setattr(TikTokIE,"_extract_web_data_and_status",deleted)
    assert public_ytdlp.main(["--public-photo-json","https://www.tiktok.com/@creator/photo/123"])==1
    assert json.loads(capsys.readouterr().out)["error_code"]=="VIDEO_REMOVED"
    def limited(*args): raise ExtractorError("HTTP Error 429: private fixture text")
    monkeypatch.setattr(TikTokIE,"_extract_web_data_and_status",limited)
    assert public_ytdlp.main(["--public-photo-json","https://www.tiktok.com/@creator/photo/123"])==1
    output=capsys.readouterr().out
    assert json.loads(output)["error_code"]=="RATE_LIMITED" and "private fixture" not in output


def test_maintenance_with_challenge_markers_is_left_for_sdk_solver():
    with public_ytdlp.TikTokPhotoYoutubeDL({"quiet":True}) as dl:
        dl._check_page_payload(b'<html><title>Site Maintenance</title><div id="cs" class="challenge"></div><div id="wci"></div></html>')
        with pytest.raises(public_ytdlp.TikTokPhotoReadError):
            dl._check_page_payload(b'<html><title>Site Maintenance</title></html>')


async def test_busy_metadata_slot_is_retryable_without_starting_child(monkeypatch):
    import asyncio

    from app.services.video import VideoService
    service=VideoService(media_slots=asyncio.Semaphore(0),queue_timeout_seconds=.01)
    child=AsyncMock(side_effect=AssertionError("Busy slot must not start a downloader"))
    monkeypatch.setattr("app.services.video.asyncio.create_subprocess_exec",child)
    with pytest.raises(photos.PhotoSourceError) as raised:
        await service.fetch_photo_post("https://www.tiktok.com/@creator/photo/123")
    assert raised.value.code=="MEDIA_BUSY"
    child.assert_not_awaited()


async def test_malformed_cover_keeps_photo_metadata_caption_and_remaining_slides(monkeypatch):
    from app.services.video import VideoService
    service=VideoService()
    monkeypatch.setattr(service,"fetch_photo_post",AsyncMock(return_value={"title":"Checklist","description":"Caption","uploader":"Creator",
        "slides":[[],["https://cdn.example/second"]]}))
    result=await service.get_video_metadata_ytdlp("https://www.tiktok.com/@creator/photo/123")
    assert result.description=="Caption" and result.thumbnail=="https://cdn.example/second"
    assert result.photo_slides==[[],["https://cdn.example/second"]]


async def test_instagram_video_uses_existing_metadata_path_before_anonymous_photo_read(monkeypatch):
    from app.services.video import VideoMetadata, VideoService
    service=VideoService()
    legacy=AsyncMock(return_value=VideoMetadata(title="Video",description="Caption",duration=12))
    photo=AsyncMock(side_effect=AssertionError("Do not try anonymous photo first"))
    monkeypatch.setattr(service,"_get_video_metadata_ytdlp",legacy)
    monkeypatch.setattr(service,"fetch_photo_post",photo)
    result=await service.get_video_metadata_ytdlp("https://www.instagram.com/p/Synthetic/")
    assert result.duration==12 and legacy.await_count==1
    photo.assert_not_awaited()


async def test_vt_short_link_is_resolved_before_photo_detection(monkeypatch):
    from app.services.extractor import RecipeExtractor
    from app.services.video import VideoService
    canonical="https://www.tiktok.com/@creator/photo/123"
    def handler(request):
        return httpx.Response(302,headers={"location":canonical}) if request.url.host=="vt.tiktok.com" else httpx.Response(200)
    monkeypatch.setattr("app.services.video.PublicHTTPTransport",lambda:httpx.MockTransport(handler))
    assert await VideoService.normalize_url("https://vt.tiktok.com/Synthetic/")==canonical
    reader=AsyncMock(return_value="photo result")
    monkeypatch.setattr(RecipeExtractor,"_extract_from_tiktok_photo",reader)
    assert await RecipeExtractor().extract("https://vt.tiktok.com/Synthetic/")=="photo result"
    assert reader.await_args.kwargs["url"]==canonical

async def test_audio_keeps_its_deadline_and_photo_cap_does_not_widen_uploads(monkeypatch):
    import asyncio
    from types import SimpleNamespace

    from pydantic import ValidationError

    from app.domains.workouts.extraction import (
        MAX_IMAGES,
        MAX_PHOTO_IMAGES,
        SYSTEM_PROMPT,
        ExtractionRequest,
        ProductionSourceAcquirer,
        SourceBundle,
        SourceMetadata,
        provider_messages,
    )
    assert (MAX_IMAGES,MAX_PHOTO_IMAGES)==(8,35)
    images=[{"base64_data":"fixture","mime_type":"image/png"}]*8
    assert len(ExtractionRequest(kind="images",images=images,ai_consent=True).images)==8
    with pytest.raises(ValidationError):
        ExtractionRequest(kind="images",images=images+[images[0]],ai_consent=True)
    source=SourceBundle(SourceMetadata(platform="tiktok",url="https://www.tiktok.com/@creator/video/123"))
    assert provider_messages(source)[0]["content"]==SYSTEM_PROMPT
    source.photo_slides=[["https://cdn.example/one"]]
    assert "every supplied photo" in provider_messages(source)[0]["content"]
    source.photo_slides=None
    service=SimpleNamespace(is_tiktok_photo_post=lambda _:False,
        extract_video_frames=AsyncMock(return_value=SimpleNamespace(success=False,frames=[],error_code="NO_VIDEO_FRAMES")))
    acquirer=ProductionSourceAcquirer(video_service=service)
    audio=AsyncMock()
    monkeypatch.setattr(acquirer,"_audio",audio)
    deadline=asyncio.get_running_loop().time()+90
    await acquirer.acquire_media(source,None,deadline=deadline)
    assert audio.await_args.args[-1]==deadline

async def test_photo_media_retry_retains_newly_read_caption_and_photo_identity(monkeypatch):
    from types import SimpleNamespace

    from app.domains.workouts.extraction import (
        ProductionSourceAcquirer,
        SourceBundle,
        SourceMetadata,
    )
    service=SimpleNamespace(is_tiktok_photo_post=lambda _:True,
        fetch_photo_post=AsyncMock(return_value={"title":"Checklist","description":"Newly available caption","uploader":"Creator","slides":[["https://cdn.example/one"]]}))
    monkeypatch.setattr(photos,"download_photo_images",AsyncMock(return_value=([(0,"fixture")],[])))
    source=SourceBundle(SourceMetadata(url="https://www.tiktok.com/@creator/photo/123",platform="tiktok"))
    await ProductionSourceAcquirer(video_service=service).acquire_media(source,None)
    assert source.photo_slides==[["https://cdn.example/one"]]
    assert source.parts[0].text=="Newly available caption" and source.metadata.title=="Checklist"
    assert source.images[0].normalized

async def test_instagram_anonymous_video_retains_session_error_and_caption(monkeypatch):
    from app.services.video import VideoMetadata, VideoService
    service=VideoService()
    monkeypatch.setattr(service,"_get_video_metadata_ytdlp",AsyncMock(return_value=VideoMetadata(error_code="RATE_LIMITED")))
    monkeypatch.setattr(service,"fetch_photo_post",AsyncMock(return_value={"title":"Video","description":"Available caption",
        "uploader":"Creator","slides":None,"duration":12}))
    result=await service.get_video_metadata_ytdlp("https://www.instagram.com/p/Synthetic/")
    assert result.error_code=="RATE_LIMITED" and result.description=="Available caption" and result.photo_slides is None

async def test_workout_busy_photo_without_caption_is_retryable(monkeypatch):
    from types import SimpleNamespace

    from app.domains.workouts.extraction import (
        ExtractionRequest,
        ProductionSourceAcquirer,
        SourceBundle,
        SourceMetadata,
        WorkoutExtractor,
    )
    from app.domains.workouts.imports import RETRYABLE
    source=SourceBundle(SourceMetadata(url="https://www.tiktok.com/@synthetic/photo/123",platform="tiktok"))
    source.photo_slides=[["https://cdn.example/one"]]
    monkeypatch.setattr(photos,"download_photo_images",AsyncMock(side_effect=photos.PhotoSourceError("MEDIA_BUSY")))
    await ProductionSourceAcquirer(video_service=SimpleNamespace()).acquire_media(source,None)
    assert source.acquisition_failures[0].code=="MEDIA_BUSY"
    provider=SimpleNamespace(enabled=True,extract=AsyncMock())
    result=await WorkoutExtractor(provider=provider,acquirer=SimpleNamespace(acquire=AsyncMock(return_value=source))).extract(
        ExtractionRequest(kind="url",source_url=source.metadata.url,ai_consent=True))
    assert result.error_code=="source_or_provider_unavailable" and result.error_code in RETRYABLE
    provider.extract.assert_not_awaited()

@pytest.mark.parametrize("extra",[0,1])
async def test_workout_payload_bounds_exclude_data_url_prefix_and_padding(extra):
    import base64
    from types import SimpleNamespace

    from app.domains.workouts.extraction import (
        MAX_TOTAL_IMAGE_BYTES,
        ExtractionFailure,
        ExtractionRequest,
        SourceBundle,
        SourceImage,
        SourceMetadata,
        SourcePart,
        WorkoutExtractor,
    )
    size=MAX_TOTAL_IMAGE_BYTES+extra
    source=SourceBundle(SourceMetadata(url="https://www.tiktok.com/@synthetic/photo/123",platform="tiktok"),
        parts=[SourcePart("caption","Synthetic caption")],
        images=[SourceImage("image:0","data:image/webp;base64,"+base64.b64encode(bytes(size)).decode(),normalized=True)])
    source.photo_slides=[[]]
    assert source.images[0].payload_bytes==size
    provider=SimpleNamespace(enabled=True,extract=AsyncMock(side_effect=ExtractionFailure("provider_test_reached")))
    result=await WorkoutExtractor(provider=provider,acquirer=SimpleNamespace(acquire=AsyncMock(return_value=source))).extract(
        ExtractionRequest(kind="url",source_url=source.metadata.url,ai_consent=True))
    assert result.error_code==("source_image_limit" if extra else "provider_test_reached")
    assert provider.extract.await_count==(0 if extra else 1)


async def test_remote_pixel_limit_admits_six_mp_and_discloses_sixteen_mp_gap(monkeypatch):
    raw = {}
    for path, size in (("/ordinary", (2160, 2880)), ("/too-large", (4001, 4000))):
        data = io.BytesIO()
        Image.new("RGB", size, "white").save(data, "PNG")
        raw[path] = data.getvalue()
    monkeypatch.setattr(photos, "PublicHTTPTransport", lambda: httpx.MockTransport(
        lambda request: httpx.Response(200, content=raw[request.url.path], headers={"content-type":"image/png"})))
    monkeypatch.setattr(photos, "assert_public_http_url", AsyncMock())
    images, notes = await photos.download_photo_images([["https://cdn.example/ordinary"], ["https://cdn.example/too-large"]])
    assert [index for index, _ in images] == [0]
    assert any("Slide 2 exceeds the 16 MP image limit" in note for note in notes)
    assert photos.MAX_REMOTE_IMAGE_PIXELS == 16_000_000


def test_normalization_has_one_shared_slot():
    import runpy

    from app import image_validation as validation

    fresh = runpy.run_path(validation.__file__)
    assert fresh["MODEL_IMAGE_CONCURRENCY"] == 1
    assert fresh["_MODEL_IMAGE_SLOTS"]._value == 1


@pytest.mark.parametrize("limit", ["download", "normalized"])
async def test_concurrent_photo_byte_budgets_are_enforced_and_disclosed(monkeypatch, limit):
    import asyncio
    from types import SimpleNamespace
    assert photos.MAX_REMOTE_IMAGES_TOTAL_BYTES == 40 * 1024 * 1024
    assert photos.MAX_PHOTO_PAYLOAD_BYTES == 12 * 1024 * 1024
    caps = []
    async def read(client, url, *, max_bytes, **kwargs):
        caps.append(max_bytes)
        await asyncio.sleep(0)
        return httpx.Response(200, content=bytes(max_bytes) if limit == "download" else b"small",
                              request=httpx.Request("GET", url))
    monkeypatch.setattr(photos, "get_limited", read)
    monkeypatch.setattr(photos, "assert_public_http_url", AsyncMock())
    monkeypatch.setattr(photos, "normalize_model_image", AsyncMock(return_value=SimpleNamespace(
        data=b"image" if limit == "download" else bytes(1024 * 1024))))
    images, notes = await photos.download_photo_images([[f"https://cdn.example/{i}"] for i in range(35)])
    if limit == "download":
        assert len(images) == 10 and sum(caps) == 40 * 1024 * 1024
        assert any("40 MiB limit" in note for note in notes)
    else:
        assert len(images) == 12
        assert any("12 MiB limit" in note for note in notes)


def test_anonymous_instagram_uses_configured_proxy_without_account_cookies(monkeypatch):
    from types import SimpleNamespace

    from yt_dlp.extractor.instagram import InstagramIE
    monkeypatch.setattr("app.config.get_settings", lambda: SimpleNamespace(youtube_proxy="http://proxy.example:8000"))
    monkeypatch.setattr(InstagramIE, "_real_initialize", lambda self: None)
    def read(self, url):
        assert self._downloader.params["proxy"] == "http://proxy.example:8000"
        assert not self._downloader.params.get("cookiefile")
        return {"id":"Synthetic", "thumbnails":[{"url":"https://cdn.example/one"}]}
    monkeypatch.setattr(InstagramIE, "_real_extract", read)
    assert public_ytdlp.photo_json("https://www.instagram.com/p/Synthetic/")["slides"]


@pytest.mark.parametrize("staged", [False, True])
async def test_workouts_nine_photo_slides_pass_both_extraction_limits(staged):
    from types import SimpleNamespace

    from app.domains.workouts.extraction import (
        ExtractionFailure,
        ExtractionRequest,
        SourceBundle,
        SourceImage,
        SourceMetadata,
        SourcePart,
        WorkoutExtractor,
    )
    source = SourceBundle(SourceMetadata(url="https://www.tiktok.com/@synthetic/photo/123", platform="tiktok"),
                          parts=[SourcePart("caption", "Creator caption")])
    source.photo_slides = [[]] * 9
    images = [SourceImage(f"image:{i}", "data:image/webp;base64,aW1hZ2U=", normalized=True) for i in range(9)]
    async def media(*args): source.images = images
    if not staged:
        source.images = images
    # Staged metadata explicitly requests a media retry through acquire_media.
    source.metadata.channels = ["caption"]
    if staged:
        source.parts = []
    provider = SimpleNamespace(enabled=True, extract=AsyncMock(side_effect=ExtractionFailure("provider_test_reached")))
    acquirer = SimpleNamespace(acquire=AsyncMock(return_value=source), acquire_media=media, **({"acquire_text":AsyncMock(return_value=source)} if staged else {}))
    result = await WorkoutExtractor(provider=provider, acquirer=acquirer).extract(
        ExtractionRequest(kind="url", source_url=source.metadata.url, ai_consent=True))
    assert result.error_code == "provider_test_reached"
    assert provider.extract.await_count >= 1
