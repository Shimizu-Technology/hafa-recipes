"""Capture evidence and media adapter acceptance with local fixtures, no paid AI."""

import asyncio
from types import SimpleNamespace

import pytest

from app.domains.baby import attachments, processing
from app.domains.baby.provider import ExtractionOutput
from app.domains.workouts.extraction import SourceBundle, SourceImage, SourceMetadata, SourcePart


async def test_import_keeps_text_and_only_accepts_actual_visual_locations(monkeypatch):
    source = SourceBundle(
        SourceMetadata(title="Original video", platform="tiktok"),
        parts=[SourcePart("caption", "Original creator claim")],
        images=[SourceImage("image:0", "data:image/png;base64,fixture")],
    )

    class Acquirer:
        def __init__(self, *, video_service):
            assert video_service is processing.public_video_service

        async def acquire(self, *args, **kwargs):
            return source

    class Provider:
        enabled = True

        async def extract(self, source):
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
