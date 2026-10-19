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
