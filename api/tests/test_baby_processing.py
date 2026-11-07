"""Capture evidence and media adapter acceptance with local fixtures, no paid AI."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.domains.baby import attachments, processing
from app.domains.baby.provider import ExtractionOutput
from app.domains.workouts.extraction import SourceBundle, SourceImage, SourceMetadata, SourcePart


async def test_import_keeps_text_and_only_accepts_actual_visual_locations(monkeypatch):
    source = SourceBundle(
        SourceMetadata(title="Original video", platform="tiktok"),
        parts=[SourcePart("caption", "Original creator claim")],
        images=[SourceImage("image:0", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP8//8/AwMDEwMYAAAkBgMBXaJOiAAAAABJRU5ErkJggg==")],
    )

    class Acquirer:
        def __init__(self, *, video_service):
            assert video_service is processing.public_video_service

        async def acquire(self, *args, **kwargs):
            return source

    class Provider:
        enabled = True

        async def extract(self, source, categories=None):
            return ExtractionOutput(
                title="Labor notes",
                summary="The creator says something",
                topics=["Labor"],
                visual_text=[
                    {"location": "image:0", "text": "Visible hospital checklist"},
                    {"location": "fabricated", "text": "Invented claim"},
                ],
            )

    monkeypatch.setattr(processing, "ProductionSourceAcquirer", Acquirer)

    async def gate():
        pass

    result = await processing.process_capture(
        {"url": "https://example.com/video", "text": "My pasted note"},
        [],
        Provider(),
        may_use_ai=True,
        gate=gate,
    )
    assert "Original creator claim" in result["data"]["source_text"]
    assert "Visible hospital checklist" in result["data"]["source_text"]
    assert "Invented claim" not in result["data"]["source_text"]
    assert result["data"]["url"] == "https://example.com/video"
    assert result["title"] == "Labor notes"


async def test_acquisition_failure_preserves_original_and_does_not_invent_content(monkeypatch):
    class Acquirer:
        def __init__(self, *, video_service):
            assert video_service is processing.public_video_service

        async def acquire(self, *args, **kwargs):
            raise ValueError("No public source available")

    monkeypatch.setattr(processing, "ProductionSourceAcquirer", Acquirer)

    async def gate():
        pass

    result = await processing.process_capture(
        {"url": "https://example.com/video", "text": "User annotation"},
        [],
        SimpleNamespace(enabled=False),
        may_use_ai=False,
        gate=gate,
    )
    assert result["status"] == "incomplete"
    assert result["data"]["source_text"] == "User annotation"
    assert result["data"]["url"] == "https://example.com/video"
    assert result["error"]


async def test_uploaded_audio_keeps_supported_extension_without_paid_call(monkeypatch):
    from app.domains.baby import media

    paths = []

    async def probe(path, **kwargs):
        return 3.0

    monkeypatch.setattr(media, "probe", probe)

    class Provider:
        async def transcribe(self, path):
            paths.append(path)
            return "Uploaded speech"

    async def gate():
        pass

    source = await processing.local_media(
        b"fixture", "audio/mpeg", Provider(), may_use_ai=True, gate=gate
    )
    assert paths[0].endswith(".mp3")
    assert source.parts[0].text == "Uploaded speech"


async def test_repeated_cancellation_holds_write_until_sdk_thread_settles(monkeypatch):
    started, finish = asyncio.Event(), asyncio.Event()

    async def fake_to_thread(*args, **kwargs):
        started.set()
        await finish.wait()

    monkeypatch.setattr(attachments.asyncio, "to_thread", fake_to_thread)
    write = asyncio.create_task(
        attachments._shielded_write(Key="fixture", Body=b"", ContentType="image/png")
    )
    await started.wait()
    write.cancel()
    await asyncio.sleep(0)
    write.cancel()
    await asyncio.sleep(0)
    assert not write.done()
    finish.set()
    with pytest.raises(asyncio.CancelledError):
        await write


async def test_cleanup_fails_closed_if_production_object_storage_disappears(monkeypatch):
    from types import SimpleNamespace
    from uuid import uuid4

    from app.domains.baby import storage
    from app.services.storage import StorageCleanupError

    monkeypatch.setattr(storage, "get_settings", lambda: SimpleNamespace(environment="production", baby_local_storage_dir=None))
    monkeypatch.setattr(storage, "storage_service", SimpleNamespace(is_enabled=False))
    with pytest.raises(StorageCleanupError):
        await storage.delete_private_prefix(attachments.attachment_prefix(uuid4(), "owner", 1))


async def test_attachment_read_failure_preserves_text_and_other_attachments(monkeypatch):
    async def read(attachment):
        if attachment.id == "unavailable":
            raise OSError("storage unavailable")
        return b"pdf fixture"

    async def pdf_parts(payload):
        return [SourcePart("page:1", "Readable document")]

    async def gate():
        pass

    monkeypatch.setattr(processing, "read_bytes", read)
    monkeypatch.setattr(processing, "_pdf_parts", pdf_parts)
    result = await processing.process_capture(
        {"text": "Pasted annotation", "attachment_ids": []},
        [SimpleNamespace(id=identifier, mime_type="application/pdf")
         for identifier in ["readable-before", "unavailable", "readable-after"]],
        SimpleNamespace(enabled=False), may_use_ai=False, gate=gate,
    )
    assert result["status"] == "incomplete"
    assert "Pasted annotation" in result["data"]["source_text"]
    assert result["data"]["source_text"].count("Readable document") == 2
    assert any("An attachment could not be read" in note for note in result["data"]["coverage_notes"])


@pytest.mark.parametrize("acquisition_failed", [True, False])
async def test_partial_acquisition_is_retryable_but_sampling_notes_are_not_errors(monkeypatch, acquisition_failed):
    from app.services.source_acquisition import AcquisitionFailure

    source = SourceBundle(
        SourceMetadata(platform="tiktok", coverage_notes=["Video frames are samples."]),
        parts=[SourcePart("caption", "Creator caption")],
        acquisition_failures=[AcquisitionFailure("audio", "TIMEOUT")] if acquisition_failed else [],
    )

    class Acquirer:
        def __init__(self, **kwargs):
            pass

        async def acquire(self, *args, **kwargs):
            return source

    monkeypatch.setattr(processing, "ProductionSourceAcquirer", Acquirer)

    async def gate():
        pass

    result = await processing.process_capture(
        {"url": "https://example.com/video", "text": "User annotation"},
        [], SimpleNamespace(enabled=False), may_use_ai=False, gate=gate,
    )
    assert result["status"] == ("incomplete" if acquisition_failed else "ready")
    assert result["data"]["source_text"] == "User annotation\n\nCreator caption"
    assert bool(result["error"]) is acquisition_failed
    assert "TIMEOUT" not in str(result)


@pytest.mark.parametrize("notes,expected", [
    (["image:0 sampled at 1.5s; samples do not cover every frame."], "ready"),
    (["Audio unavailable; available captions/frames remain usable."], "incomplete"),
    (["Visual frames unavailable; visual-only instructions may be missing."], "incomplete"),
    (["Video frames are samples.", "Audio could not be read; speech may be missing."], "incomplete"),
    (["Caption text was truncated to the extraction limit."], "incomplete"),
])
async def test_coverage_disclosures_do_not_hide_missing_channels(monkeypatch, notes, expected):
    from unittest.mock import AsyncMock

    bundle = SourceBundle(
        SourceMetadata(
            creator="Creator", platform="instagram", thumbnail_url="https://cdn.example.com/a.jpg",
            coverage_notes=notes,
        ), parts=[SourcePart("caption", "The creator's original words")],
    )
    monkeypatch.setattr(processing.ProductionSourceAcquirer, "acquire", AsyncMock(return_value=bundle))
    provider = SimpleNamespace(enabled=True, extract=AsyncMock(return_value=ExtractionOutput(
        title="Packing", summary="The creator recommends preparing a bag.",
        key_points=["The creator suggests keeping the bag by the door."],
        steps=["Put the bag by the door."],
    )))
    result = await processing.process_capture(
        {"url": "https://example.com/post"}, [], provider, may_use_ai=True, gate=AsyncMock(),
    )
    assert result["status"] == expected
    assert result["data"]["coverage_notes"] == notes
    assert result["data"]["creator"] == "Creator"
    assert result["data"]["platform"] == "instagram"
    assert result["data"]["thumbnail_url"] == "https://cdn.example.com/a.jpg"
    assert result["data"]["key_points"] == ["The creator suggests keeping the bag by the door."]
    assert result["data"]["steps"] == ["Put the bag by the door."]
    assert result["data"]["evidence"] == [{"location": "caption", "text": "The creator's original words"}]


@pytest.mark.parametrize("thumbnail", [
    "file:///tmp/frame.jpg", "localfile://private/image.jpg", "data:image/png;base64,private",
    "https://localhost/frame", "http://127.0.0.1/frame", "http://192.168.1.1/frame",
    "http://[::1]/frame", "https://host.local/frame", "https://user:secret@example.com/frame",
])
def test_private_thumbnail_metadata_is_omitted(thumbnail):
    assert processing.safe_metadata(SourceMetadata(thumbnail_url=thumbnail))["thumbnail_url"] is None


async def test_extraction_prompt_requires_explicit_source_steps(monkeypatch):
    from unittest.mock import AsyncMock

    from app.domains.baby.provider import BabyProvider

    call = AsyncMock(return_value=ExtractionOutput(title="Promotion"))
    monkeypatch.setattr(BabyProvider, "json_call", call)
    result = await BabyProvider().extract(SourceBundle(SourceMetadata()))
    assert result.key_points == result.steps == []
    prompt = call.call_args.kwargs["instructions"]
    assert "ONLY when explicitly given in the source" in prompt
    assert "Never invent medical or care instructions" in prompt
    assert "attributed to the source/creator" in prompt


@pytest.mark.parametrize("frame_failure", [True, False])
async def test_uploaded_video_sampling_retains_missing_frame_warning(monkeypatch, frame_failure):
    from io import BytesIO
    from unittest.mock import AsyncMock

    from PIL import Image

    from app.domains.baby import media

    image = BytesIO()
    Image.new("RGB", (8, 8), "white").save(image, format="JPEG")

    async def frame(path, output, timestamp):
        if frame_failure and timestamp > 0:
            raise ValueError("frame unavailable")
        output.write_bytes(image.getvalue())

    monkeypatch.setattr(media, "probe", AsyncMock(return_value=4.0))
    monkeypatch.setattr(media, "audio_track", AsyncMock())
    monkeypatch.setattr(media, "frame", frame)
    monkeypatch.setattr(processing, "read_bytes", AsyncMock(return_value=b"video fixture"))
    provider = SimpleNamespace(enabled=True, transcribe=AsyncMock(return_value="Creator's spoken words"),
                               extract=AsyncMock(return_value=ExtractionOutput(title="Video")))
    result = await processing.process_capture(
        {}, [SimpleNamespace(mime_type="video/mp4")], provider, may_use_ai=True, gate=AsyncMock(),
    )
    assert result["status"] == ("incomplete" if frame_failure else "ready")
    notes = result["data"]["coverage_notes"]
    assert any("Video frames are samples" in note for note in notes)
    assert any("Some visual frames could not be read" in note for note in notes) is frame_failure
    assert result["data"]["platform"] == "upload"
    assert result["data"]["evidence"][0]["text"] == "Creator's spoken words"


async def test_extraction_contract_requires_and_returns_a_source_title(monkeypatch):
    from pydantic import ValidationError

    from app.domains.baby.provider import BabyProvider

    provider = BabyProvider()

    async def json_call(**kwargs):
        assert kwargs["output_model"] is ExtractionOutput
        assert "{title,summary" in kwargs["instructions"]
        assert "never a generic placeholder" in kwargs["instructions"]
        with pytest.raises(ValidationError):
            kwargs["output_model"].model_validate({"summary": "Title was omitted"})
        return kwargs["output_model"].model_validate({"title": "Recognizing feeding cues"})

    monkeypatch.setattr(provider, "json_call", json_call)
    result = await provider.extract(SourceBundle(SourceMetadata(), parts=[SourcePart("text", "Feeding cues")]))
    assert result.title == "Recognizing feeding cues"


async def test_labelled_slide_lists_survive_source_schema_and_image_cap(monkeypatch):
    from unittest.mock import AsyncMock

    from app.domains.baby.provider import BabyProvider

    image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP8//8/AwMDEwMYAAAkBgMBXaJOiAAAAABJRU5ErkJggg=="
    source = SourceBundle(SourceMetadata(), images=[SourceImage(f"image:{i}", image) for i in range(36)])
    class Acquirer:
        def __init__(self, **kwargs): pass
        async def acquire(self, *args, **kwargs): return source
    result = ExtractionOutput(title="Hospital bag", summary="The creator lists packing items.",
        key_points=["For labor: heating pad; excited to try a comb. (slide 2)"],
        visual_text=[{"location":"image:34", "text":"for postpartum"}, {"location":"image:35", "text":"omitted image"}],
        relevance={"stage":"postpartum", "quote":"for postpartum"},
        suggested_category={"name":"Hospital Bag", "confidence":.9})
    calls = AsyncMock(return_value=result)
    monkeypatch.setattr(BabyProvider, "json_call", calls)
    # Inspect the real provider's image list and prompt without spending.
    await BabyProvider().extract(source)
    assert calls.await_count == 8
    assert sum(sum(c.get("type")=="image_url" for c in call.kwargs["content"]) for call in calls.await_args_list if isinstance(call.kwargs["content"], list)) == 35
    assert all(sum(c.get("type")=="image_url" for c in call.kwargs["content"]) <= 5 for call in calls.await_args_list if isinstance(call.kwargs["content"], list))
    assert calls.await_args_list[0].kwargs["max_tokens"] == 6000
    assert calls.call_args.kwargs["max_tokens"] == 800
    monkeypatch.setattr(processing, "ProductionSourceAcquirer", Acquirer)
    provider = SimpleNamespace(enabled=True, extract=AsyncMock(return_value=result))
    saved = await processing.process_capture({"url":"https://example.com/post"}, [], provider, may_use_ai=True, gate=AsyncMock())
    assert saved["data"]["key_points"] == result.key_points
    assert saved["data"]["suggested_category"]["name"] == "Hospital Bag"
    assert saved["data"]["relevance"]["stage"] == "postpartum"
    assert "omitted image" not in saved["data"]["source_text"]
    assert saved["status"] == "incomplete" and any("35 of 36" in n for n in saved["data"]["coverage_notes"])


@pytest.mark.parametrize("hashtag", ["#thirdtrimester", "#37weekspregnant"])
def test_trimester_hashtag_alone_does_not_file_timing(hashtag):
    relevance = processing.stated_relevance(
        {"stage":"pregnancy", "pregnancy_week_min":28, "quote":hashtag},
        ["Hospital bag " + hashtag],
    )
    assert relevance is None
    stated = processing.stated_relevance(
        {"stage":"pregnancy", "pregnancy_week_min":28, "quote":"For the third trimester"},
        ["For the third trimester, the creator packed these items. #thirdtrimester"],
    )
    assert stated and stated.pregnancy_week_min == 28


def test_legacy_full_context_reservation_retains_output_headroom():
    from app.domains.baby.budget import upper_bound
    assert upper_bound("baby_extraction", "gpt-5.6-luna", images=True, max_output_tokens=6000) == 535800


def test_many_literal_labels_are_kept_in_slide_groups_before_schema_limit():
    entries = [{"location": f"image:{i // 10}", "text": f"Literal label {i}"} for i in range(100)]
    result = ExtractionOutput(title="Packing lists", visual_text=entries)
    assert len(result.visual_text) == 10
    for i, entry in enumerate(result.visual_text):
        assert entry.location == f"image:{i}"
        assert entry.text.splitlines() == [f"Literal label {n}" for n in range(i * 10, (i + 1) * 10)]

async def test_remote_normalized_pixels_are_not_encoded_again(monkeypatch):
    from unittest.mock import AsyncMock

    from app import image_validation
    image = SourceImage("image:0", "data:image/webp;base64,c3ludGhldGlj", normalized=True)
    source = SourceBundle(SourceMetadata(), images=[image])
    class Acquirer:
        def __init__(self, **kwargs): pass
        async def acquire(self, *args, **kwargs): return source
    monkeypatch.setattr(processing, "ProductionSourceAcquirer", Acquirer)
    normalize = AsyncMock(side_effect=AssertionError("Do not re-encode normalized remote text"))
    monkeypatch.setattr(image_validation, "normalize_model_image", normalize)
    class Provider:
        enabled = True
        async def extract(self, read, categories=None):
            assert read.images[0].data_url == image.data_url and read.images[0] is image
            return ExtractionOutput(title="Synthetic", visual_text=[{"location":"image:0", "text":"Literal label"}])
    result = await processing.process_capture({"url":"https://example.com/photo"}, [], Provider(), may_use_ai=True, gate=AsyncMock())
    normalize.assert_not_awaited()
    assert "Literal label" in result["data"]["source_text"]
    assert "attachment_ids" not in result["data"]


@pytest.mark.parametrize("upload_kind", ["large_png", "heic"])
async def test_large_upload_is_normalized_at_attachment_limit(monkeypatch, upload_kind):
    import base64
    import io
    from unittest.mock import AsyncMock

    from PIL import Image
    # A valid >4 MiB PNG, without a committed binary fixture.
    output = io.BytesIO()
    if upload_kind == "large_png":
        Image.effect_noise((2400, 2400), 100).convert("RGB").save(output, format="PNG")
    else:
        from pillow_heif import from_pillow
        from_pillow(Image.new("RGB", (2400, 2400), "white")).save(output)
    raw = output.getvalue()
    assert len(raw) < attachments.MAX_BYTES
    if upload_kind == "large_png":
        assert len(raw) > 4 * 1024 * 1024
    monkeypatch.setattr(processing, "read_bytes", AsyncMock(return_value=raw))
    attachment = SimpleNamespace(mime_type="image/heic" if upload_kind == "heic" else "image/png")
    class Provider:
        enabled = True
        async def extract(self, source, categories=None):
            assert len(source.images) == 1
            with Image.open(io.BytesIO(base64.b64decode(source.images[0].data_url.split(",",1)[1]))) as image:
                assert max(image.size) == 1600
            return ExtractionOutput(title="Large screenshot", visual_text=[{"location":"attachment:0", "text":"Literal uploaded label"}])
    result = await processing.process_capture({}, [attachment], Provider(), may_use_ai=True, gate=AsyncMock())
    assert "Literal uploaded label" in result["data"]["source_text"]

async def test_35_slide_provider_batches_fit_output_and_preserve_every_slide(monkeypatch):
    from app.domains.baby.provider import IMAGE_READING_DISCLOSURE, BabyProvider, ExtractionSummary
    from app.domains.baby.schemas import SourceData
    source = SourceBundle(SourceMetadata(platform="tiktok",url="https://www.tiktok.com/@synthetic/photo/123"),
                         images=[SourceImage(f"image:{i}","data:image/webp;base64,fixture",normalized=True) for i in range(35)])
    seen=[]
    async def call(self, **kwargs):
        if kwargs["output_model"] is ExtractionSummary:
            assert kwargs["max_tokens"] == 800
            return ExtractionSummary(title="Garden labels", summary="The creator lists garden supplies.")
        locations=[entry["text"].split("Source location: ")[1].split(" ")[0] for entry in kwargs["content"]
                   if entry.get("type")=="text" and entry.get("text","").startswith("Source location:")]
        assert 1<=len(locations)<=5 and kwargs["max_tokens"]==6000
        assert "'(slide N)'" in kwargs["instructions"]
        seen.extend(locations)
        return ExtractionOutput(title="Garden labels",summary="The creator lists garden supplies.",
            key_points=[f"Label on {location}" for location in locations],
            visual_text=[{"location":location,"text":f"Literal list {location}"} for location in locations])
    monkeypatch.setattr(BabyProvider,"json_call",call)
    result=await BabyProvider().extract(source)
    assert seen==[f"image:{i}" for i in range(35)]
    saved=SourceData(key_points=result.key_points,evidence=[e.model_dump() for e in result.visual_text])
    assert len(saved.key_points)==35 and len(saved.evidence)==35
    assert saved.evidence[-1].text=="Literal list image:34"
    assert source.metadata.coverage_notes == [IMAGE_READING_DISCLOSURE]


async def test_missing_batch_and_model_trimming_are_disclosed(monkeypatch):
    from app.domains.baby.provider import BabyProvider, ProviderUnavailable
    source=SourceBundle(SourceMetadata(),images=[SourceImage(f"image:{i}","data:image/webp;base64,fixture",normalized=True) for i in range(15)])
    calls=0
    async def call(self, **kwargs):
        nonlocal calls
        calls+=1
        assert "'(slide N)'" not in kwargs["instructions"]
        if calls==2:
            raise ProviderUnavailable("Synthetic provider failure")
        return ExtractionOutput(title="Source",key_points=[f"Batch {calls}"],omitted_details=True)
    monkeypatch.setattr(BabyProvider,"json_call",call)
    result=await BabyProvider().extract(source)
    assert result.key_points==["Batch 1","Batch 3"]
    assert any("batch 2 could not be organized" in note for note in source.metadata.coverage_notes)
    assert sum("AI condensed" in note for note in source.metadata.coverage_notes)==2

@pytest.mark.parametrize("code,phrase",[("VIDEO_PRIVATE","private or needs permission"),("VIDEO_REMOVED","no longer available"),("ACCESS_DENIED","site blocked"),("RATE_LIMITED","limiting requests"),("MEDIA_BUSY","reading is busy")])
async def test_partial_read_explains_safe_cause_without_losing_caption(monkeypatch,code,phrase):
    from unittest.mock import AsyncMock

    from app.services.source_acquisition import AcquisitionFailure
    class Acquirer:
        def __init__(self, **kwargs): pass
        async def acquire(self, *args, **kwargs):
            return SourceBundle(SourceMetadata(),parts=[SourcePart("caption","Readable creator caption")],
                                acquisition_failures=[AcquisitionFailure("metadata",code)])
    monkeypatch.setattr(processing,"ProductionSourceAcquirer",Acquirer)
    result=await processing.process_capture({"url":"https://example.com/post"},[],SimpleNamespace(enabled=False),may_use_ai=False,gate=AsyncMock())
    assert result["status"]=="incomplete" and phrase in result["error"]
    assert result["data"]["source_text"]=="Readable creator caption" and result["data"]["url"]=="https://example.com/post"

@pytest.mark.parametrize("quote",["#thirdtrimester","Hospital bag #thirdtrimester","#37weekspregnant"])
async def test_hashtag_cannot_supply_even_a_stage_without_a_statement(quote):
    assert processing.stated_relevance({"stage":"pregnancy","quote":quote},[quote]) is None

@pytest.mark.parametrize("entries",[
    [{"location":"image:0","text":"a"*7000},{"location":"image:0","text":"b"*7000}],
    [{"location":"image:0","text":"a"*14000}],
])
async def test_long_grouped_image_text_is_bounded_and_disclosed(monkeypatch,entries):
    from app.domains.baby.provider import BabyProvider
    result=ExtractionOutput(title="Labels",key_points=["Retained tip"],visual_text=[*entries,{"location":"image:1","text":"Other slide label"}])
    assert len(result.visual_text[0].text)==12000 and result.omitted_details
    assert result.visual_text[1].text=="Other slide label" and result.key_points==["Retained tip"]
    source=SourceBundle(SourceMetadata(platform="tiktok",url="https://www.tiktok.com/@synthetic/photo/123"),
        images=[SourceImage(f"image:{i}","data:image/webp;base64,fixture",normalized=True) for i in range(2)])
    monkeypatch.setattr(BabyProvider,"json_call",AsyncMock(return_value=result))
    await BabyProvider().extract(source)
    assert any("condensed" in note for note in source.metadata.coverage_notes)

@pytest.mark.parametrize("invalid",[{"stage":"pregnancy","quote":"#thirdtrimester"},{"malformed":True},"malformed"])
async def test_later_batch_timing_survives_an_earlier_invalid_candidate(monkeypatch,invalid):
    from app.domains.baby.provider import BabyProvider, ExtractionSummary
    source=SourceBundle(SourceMetadata(platform="tiktok",url="https://www.tiktok.com/@synthetic/photo/123"),
        images=[SourceImage(f"image:{i}","data:image/webp;base64,fixture",normalized=True) for i in range(6)])
    monkeypatch.setattr(BabyProvider,"json_call",AsyncMock(side_effect=[
        ExtractionOutput(title="First",relevance=invalid,visual_text=[{"location":"image:0","text":"#thirdtrimester"}]),
        ExtractionOutput(title="Later",relevance={"stage":"pregnancy","pregnancy_week_min":37,"quote":"At 37 weeks"},
            visual_text=[{"location":"image:5","text":"At 37 weeks the creator packed this."}]),
        ExtractionSummary(title="Combined",summary="Creator lists")]))
    result=await BabyProvider().extract(source)
    assert result.relevance["pregnancy_week_min"]==37

async def test_remote_frame_producer_marks_webp_so_baby_does_not_encode_it_twice(monkeypatch):
    import base64
    from io import BytesIO

    from PIL import Image

    from app.domains.workouts.extraction import ProductionSourceAcquirer
    image=BytesIO()
    Image.new("RGB",(24,24),"white").save(image,"PNG")
    service=SimpleNamespace(is_tiktok_photo_post=lambda _:False,
        extract_video_frames=AsyncMock(return_value=SimpleNamespace(success=True,frames=[
            SimpleNamespace(image_base64=base64.b64encode(image.getvalue()).decode(),timestamp_seconds=0)])))
    source=SourceBundle(SourceMetadata(platform="tiktok",url="https://www.tiktok.com/@synthetic/video/123"))
    acquirer=ProductionSourceAcquirer(video_service=service)
    monkeypatch.setattr(acquirer,"_audio",AsyncMock())
    await acquirer.acquire_media(source,None)
    assert source.images[0].normalized
    class Acquirer:
        def __init__(self,**kwargs): pass
        async def acquire(self,*args,**kwargs): return source
    monkeypatch.setattr(processing,"ProductionSourceAcquirer",Acquirer)
    normalizer=AsyncMock(side_effect=AssertionError("Already normalized"))
    monkeypatch.setattr("app.image_validation.normalize_model_image",normalizer)
    result=await processing.process_capture({"url":source.metadata.url},[],
        SimpleNamespace(enabled=True,extract=AsyncMock(return_value=ExtractionOutput(title="Frame",visual_text=[
            {"location":"image:0","text":"Literal frame label"}]))),may_use_ai=True,gate=AsyncMock())
    normalizer.assert_not_awaited()
    assert "Literal frame label" in result["data"]["source_text"]

@pytest.mark.parametrize("field",["baby_age_unit","stage"])
@pytest.mark.parametrize("malformed",[[],{}])
async def test_malformed_timing_type_does_not_discard_later_batches(monkeypatch,field,malformed):
    from app.domains.baby.provider import BabyProvider, ExtractionSummary
    source=SourceBundle(SourceMetadata(platform="tiktok",url="https://www.tiktok.com/@synthetic/photo/123"),
        images=[SourceImage(f"image:{i}","data:image/webp;base64,fixture",normalized=True) for i in range(6)])
    bad={"stage":"baby","baby_age_unit":"months","baby_age_min":3,"quote":"At 3 months",field:malformed}
    monkeypatch.setattr(BabyProvider,"json_call",AsyncMock(side_effect=[
        ExtractionOutput(title="First",key_points=["First tip"],relevance=bad,visual_text=[{"location":"image:0","text":"At 3 months"}]),
        ExtractionOutput(title="Later",key_points=["Later tip"],relevance={"stage":"pregnancy","pregnancy_week_min":37,"quote":"At 37 weeks"},
            visual_text=[{"location":"image:5","text":"At 37 weeks the creator packed this."}]),
        ExtractionSummary(title="Combined",summary="Creator lists")]))
    result=await BabyProvider().extract(source)
    assert result.relevance["pregnancy_week_min"]==37 and result.key_points==["First tip","Later tip"]

@pytest.mark.parametrize("ordered_reader",[False,True])
@pytest.mark.parametrize("short",[False,True])
async def test_intermediate_legacy_reader_never_silently_claims_all_slides(monkeypatch,ordered_reader,short):
    service=SimpleNamespace(is_tiktok_photo_post=lambda url:"/photo/" in url)
    if ordered_reader:
        service.fetch_photo_post=AsyncMock()
    monkeypatch.setattr(processing,"public_video_service",service)
    source=SourceBundle(SourceMetadata(platform="tiktok",url="https://www.tiktok.com/@synthetic/photo/123"),parts=[SourcePart("caption","Creator list")])
    class Acquirer:
        def __init__(self,**kwargs): pass
        async def acquire(self,*args,**kwargs): return source
    monkeypatch.setattr(processing,"ProductionSourceAcquirer",Acquirer)
    url="https://www.tiktok.com/t/synthetic/" if short else source.metadata.url
    result=await processing.process_capture({"url":url},[],
        SimpleNamespace(enabled=False),may_use_ai=False,gate=AsyncMock())
    assert any("at most eight slides" in note for note in result["data"]["coverage_notes"]) is not ordered_reader


@pytest.mark.parametrize("unreadable", [False, True])
async def test_condensed_and_textless_slides_are_ready_unless_reading_has_gaps(monkeypatch, unreadable):
    from app.domains.baby import processing
    from app.domains.baby.provider import BabyProvider
    source = SourceBundle(SourceMetadata(platform="tiktok", url="https://www.tiktok.com/@synthetic/photo/123"),
        parts=[SourcePart("caption", "Creator caption")],
        images=[SourceImage("image:0", "data:image/webp;base64,aW1hZ2U=", normalized=True),
                SourceImage("image:1", "data:image/webp;base64,aW1hZ2U=", normalized=True)])
    monkeypatch.setattr(processing, "ProductionSourceAcquirer", lambda **kwargs: type("Acquirer", (), {"acquire": AsyncMock(return_value=source)})())
    async def call(self, **kwargs):
        return ExtractionOutput.model_validate({"title":"Labels", "summary":"Creator's list.", "omitted_details":True,
            "unreadable_details": unreadable, "visual_text":[{"location":"image:0", "text":"Literal label"}, {"location":"image:1", "text":""}]})
    monkeypatch.setattr(BabyProvider, "json_call", call)
    monkeypatch.setattr(BabyProvider, "enabled", property(lambda self: True))
    monkeypatch.setattr(processing.public_video_service, "fetch_photo_post", AsyncMock(), raising=False)
    result = await processing.process_capture({"url":source.metadata.url}, [], BabyProvider(), may_use_ai=True, gate=AsyncMock())
    assert result["status"] == ("incomplete" if unreadable else "ready")
    assert "Literal label" in result["data"]["source_text"]
    assert any("condensed" in note for note in result["data"]["coverage_notes"])


async def test_batch_cannot_claim_another_batch_image_location(monkeypatch):
    from app.domains.baby.provider import BabyProvider, ExtractionSummary
    source = SourceBundle(SourceMetadata(), images=[SourceImage(f"image:{i}","data:image/webp;base64,fixture",normalized=True) for i in range(6)])
    async def call(self, **kwargs):
        if kwargs["output_model"] is ExtractionSummary:
            return ExtractionSummary(title="Labels", summary="Summary")
        locations = [part["text"].split("Source location: ")[1].split(" ")[0] for part in kwargs["content"] if part.get("text", "").startswith("Source location:")]
        foreign = "image:5" if "image:0" in locations else "image:0"
        return ExtractionOutput(title="Labels", visual_text=[{"location":locations[0],"text":"Local label"}, {"location":foreign,"text":"Foreign invented label"}])
    monkeypatch.setattr(BabyProvider, "json_call", call)
    result = await BabyProvider().extract(source)
    assert all(entry.text != "Foreign invented label" for entry in result.visual_text)
    assert any("outside the supplied image locations" in note for note in source.metadata.coverage_notes)


def test_normalization_is_limited_to_one_slot_on_shared_web_service():
    import runpy

    from app import image_validation as validation

    fresh = runpy.run_path(validation.__file__)
    assert fresh["MODEL_IMAGE_CONCURRENCY"] == 1
    assert fresh["_MODEL_IMAGE_SLOTS"]._value == 1


def test_blank_visual_entries_are_skipped_without_losing_other_labels():
    result = ExtractionOutput(title="Labels", visual_text=[
        {"location":"image:0", "text":"Literal label"}, {"location":"image:1", "text":""}, {"location":"image:2", "text":"  "}])
    assert [entry.text for entry in result.visual_text] == ["Literal label"]
