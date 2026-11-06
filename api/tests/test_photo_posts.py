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
    Image.new("RGB", (1800, 1800), "white").save(output, format="PNG")
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
        assert image.size == (1600, 1600)
    assert notes == ["Read 2 of 3 slides; 1 slides were left out.", "Slide 2 could not be read; its details may be missing."]
    assert all(r.headers["referer"] == "https://www.tiktok.com/" for r in requests)


async def test_slide_cap_and_deadline_are_disclosed(monkeypatch):
    import asyncio
    monkeypatch.setattr(photos, "PublicHTTPTransport", lambda: httpx.MockTransport(lambda r: pytest.fail("expired deadline")))
    images, notes = await photos.download_photo_images([["https://cdn.example/a"]] * 36,
                                                       deadline=asyncio.get_running_loop().time() - 1)
    assert images == [] and len(notes) == 37
    assert "35 of 36" in notes[0]


def test_photo_adapter_uses_locked_private_method_and_rewritten_url(monkeypatch):
    from yt_dlp.extractor.tiktok import TikTokIE
    calls = []
    def read(self, url, identifier):
        calls.append((url, identifier))
        assert self._downloader.params["public_photo_no_cookies"] is True
        return item(), 0
    monkeypatch.setattr(TikTokIE, "_extract_web_data_and_status", read)
    assert public_ytdlp.photo_json("https://www.tiktok.com/@creator/photo/123")["slides"]
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
    assert source.images[0].location == "image:0" and source.metadata.coverage_notes
    service.download_audio.assert_not_awaited()


def test_one_malformed_slide_keeps_caption_and_other_slides_in_place():
    source = item()
    source["imagePost"]["images"][0] = {"unrecognized": "shape"}
    parsed = photos.parse_tiktok_photo(source, "123")
    assert parsed["description"] == "Hospital bag"
    assert parsed["slides"] == [[], ["https://cdn.example/c"]]


def test_instagram_adapter_keeps_single_image_after_expected_no_video(monkeypatch):
    from yt_dlp.extractor.instagram import InstagramIE
    monkeypatch.setattr(InstagramIE, "_real_initialize", lambda self: None)
    def raw(self, url):
        self.raise_no_formats("There is no video in this post", expected=True)
        return {"description":"Caption", "thumbnails":[{"url":"https://cdn.example/one", "width":100, "height":100}]}
    monkeypatch.setattr(InstagramIE, "_real_extract", raw)
    assert public_ytdlp.photo_json("https://www.instagram.com/p/Synthetic/")["slides"] == [["https://cdn.example/one"]]


def test_instagram_video_metadata_is_not_fetched_twice(monkeypatch):
    from yt_dlp.extractor.instagram import InstagramIE
    monkeypatch.setattr(InstagramIE, "_real_initialize", lambda self: None)
    monkeypatch.setattr(InstagramIE, "_real_extract", lambda self, url: {
        "title":"Video", "description":"Thin caption", "duration":20,
        "formats":[{"url":"https://cdn.example/video"}]})
    post = public_ytdlp.photo_json("https://www.instagram.com/p/Synthetic/")
    assert post["slides"] is None and post["duration"] == 20 and post["description"] == "Thin caption"
