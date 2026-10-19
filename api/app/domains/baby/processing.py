"""Bounded source acquisition, local documents/media, and optional grounded AI."""

import asyncio
import base64
from pathlib import Path
from tempfile import TemporaryDirectory

from app.domains.baby.attachments import read_bytes
from app.domains.baby.schemas import SourceData
from app.services.video import public_video_service
from app.domains.workouts.extraction import (
    ProductionSourceAcquirer,
    SourceBundle,
    SourceImage,
    SourceMetadata,
    SourcePart,
    _pdf_parts,
)


async def local_media(payload, mime, provider, *, may_use_ai, gate):
    from app.domains.baby.media import EXTENSIONS, audio_track, frame, probe
    from app.image_validation import normalize_thumbnail_image, validate_image_bytes

    source = SourceBundle(SourceMetadata(platform="upload"))
    with TemporaryDirectory(prefix="baby-import-") as directory:
        path = Path(directory) / ("source" + EXTENSIONS[mime])
        path.write_bytes(payload)
        await gate()
        duration = await probe(path, mime=mime)
        if type(duration) not in {float, int} or not 0 < duration <= 1800:
            raise ValueError("Media duration unavailable")
        if may_use_ai:
            try:
                # Transcribe the submitted file directly. OpenAI supports MP4,
                # M4A, WAV, MP3, OGG and WebM; unsupported codecs fail safely.
                transcription_path = path
                if mime.startswith("video/"):
                    transcription_path = Path(directory) / "audio.mp3"
                    await audio_track(path, transcription_path)
                transcript = await provider.transcribe(str(transcription_path))
                source.parts.append(SourcePart("uploaded_transcript", transcript))
            except asyncio.CancelledError:
                raise
            except Exception:
                source.metadata.coverage_notes.append(
                    "Audio could not be read; speech may be missing."
                )
        else:
            source.metadata.coverage_notes.append("Enable AI processing to transcribe this media.")
        if mime.startswith("video/"):
            for index, timestamp in enumerate(
                [0.0, duration * 0.25, duration * 0.5, duration * 0.75]
            ):
                await gate()
                output = Path(directory) / f"frame-{index}.jpg"
                try:
                    await frame(path, output, timestamp)
                except Exception:
                    continue
                if output.exists():
                    valid = validate_image_bytes(output.read_bytes(), max_bytes=4 * 1024 * 1024)
                    image = normalize_thumbnail_image(valid, max_dimension=1600)
                    source.images.append(
                        SourceImage(
                            f"uploaded_frame:{timestamp:.1f}s",
                            "data:image/webp;base64," + base64.b64encode(image.data).decode(),
                        )
                    )
            source.metadata.coverage_notes.append(
                "Video frames are samples; details between samples may be missing."
            )
    return source


async def process_capture(request, attachments, provider, *, may_use_ai, gate):
    source = SourceBundle(SourceMetadata(url=request.get("url"), platform="text"))
    failures = []
    if request.get("text"):
        source.parts.append(SourcePart("pasted_text", request["text"]))
    if request.get("url"):
        await gate()
        try:
            acquired = await ProductionSourceAcquirer(video_service=public_video_service).acquire(
                request["url"], provider, include_media=may_use_ai
            )
            source.metadata = acquired.metadata
            source.parts.extend(acquired.parts)
            source.images.extend(acquired.images)
            source.metadata.coverage_notes.extend(acquired.warnings)
        except asyncio.CancelledError:
            raise
        except Exception:
            failures.append("The linked source could not be read. The original link remains saved.")
    for index, attachment in enumerate(attachments):
        await gate()
        try:
            payload = await read_bytes(attachment)
            if attachment.mime_type.startswith("image/"):
                source.images.append(
                    SourceImage(
                        f"attachment:{index}",
                        f"data:{attachment.mime_type};base64," + base64.b64encode(payload).decode(),
                    )
                )
            elif attachment.mime_type == "application/pdf":
                for part in await _pdf_parts(payload):
                    source.parts.append(
                        SourcePart(f"attachment:{index}:{part.location}", part.text)
                    )
            else:
                local = await local_media(
                    payload, attachment.mime_type, provider, may_use_ai=may_use_ai, gate=gate
                )
                source.parts.extend(
                    SourcePart(f"attachment:{index}:{part.location}", part.text)
                    for part in local.parts
                )
                source.images.extend(
                    SourceImage(f"attachment:{index}:{image.location}", image.data_url)
                    for image in local.images
                )
                source.metadata.coverage_notes.extend(local.metadata.coverage_notes)
        except asyncio.CancelledError:
            raise
        except Exception:
            failures.append(
                "An attachment could not be read. The original attachment remains saved."
            )
    # Admission and context bounds apply across every attachment, not per file.
    remaining = 75000
    retained = []
    for part in source.parts:
        if remaining <= 0:
            source.metadata.coverage_notes.append(
                "Text exceeds the processing limit; the original is retained."
            )
            break
        retained.append(SourcePart(part.location, part.text[:remaining]))
        remaining -= len(part.text)
    source.parts, source.images = retained, source.images[:8]
    title = source.metadata.title
    summary, topics = None, request.get("topics", [])
    if may_use_ai and provider.enabled and (source.parts or source.images):
        await gate()
        try:
            result = await provider.extract(source)
            title, summary = result.title, result.summary
            topics = list(dict.fromkeys([*topics, *result.topics]))[:30]
            image_locations = {image.location for image in source.images}
            for entry in result.visual_text:
                if entry.location in image_locations:
                    source.parts.append(SourcePart(entry.location, entry.text))
        except asyncio.CancelledError:
            raise
        except Exception:
            failures.append(
                "AI could not organize this source. Available source text is still searchable."
            )
    elif source.images:
        failures.append("Enable AI processing to read text in images and sampled video frames.")
    if not source.parts:
        failures.append("No readable source text was available; details may be missing.")
    evidence = [
        {"location": part.location, "text": part.text[:12000]}
        for part in source.parts
        if part.text.strip()
    ][:100]
    text = "\n\n".join(part.text for part in source.parts)[:100000]
    notes = list(dict.fromkeys([*source.metadata.coverage_notes, *failures]))[:30]
    status = "incomplete" if notes or not text else "ready"
    data = SourceData(
        url=request.get("url"),
        topics=topics,
        source_text=text or request.get("text"),
        summary=summary,
        evidence=evidence,
        status=status,
        attachment_ids=request.get("attachment_ids", []),
        coverage_notes=notes,
    ).model_dump(mode="json")
    return {
        "title": title,
        "data": data,
        "status": status,
        "error": "Some source details need review. Your original is saved." if failures else None,
    }
