"""Bounded source acquisition, local documents/media, and optional grounded AI."""

import asyncio
import base64
import re
from pathlib import Path
from tempfile import TemporaryDirectory

from app.domains.baby.attachments import read_bytes
from app.domains.baby.provider import budget_failure_message
from app.domains.baby.schemas import CategorySuggestion, SourceData, SourceRelevance
from app.domains.workouts.budget import BudgetError
from app.domains.workouts.extraction import (
    ProductionSourceAcquirer,
    SourceBundle,
    SourceImage,
    SourceMetadata,
    SourcePart,
    _pdf_parts,
)
from app.services.video import public_video_service


def sampling_disclosure(note):
    # Only recognized successful sampling disclosures are informational. Unknown
    # notes, truncation and missing audio/frames must still mark coverage incomplete.
    return note in {
        "Video frames are samples.",
        "Video frames are samples; details between samples may be missing.",
    } or re.fullmatch(
        r"image:\d+ sampled at [0-9.e+-]+s; samples do not cover every frame\.", note
    ) is not None


def safe_metadata(metadata):
    thumbnail = metadata.thumbnail_url
    try:
        if thumbnail is not None:
            thumbnail = SourceData(thumbnail_url=thumbnail).thumbnail_url
    except ValueError:
        thumbnail = None
    return {
        "creator": metadata.creator.strip()[:240] or None if metadata.creator else None,
        "platform": metadata.platform.strip()[:80] or None if metadata.platform else None,
        "thumbnail_url": thumbnail,
    }


def comparable(text):
    return " ".join(re.sub(r"[^0-9a-z]+", " ", str(text).casefold()).split())


def whole_number(value, high):
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return value if type(value) is int and 0 <= value <= high else None


def stated_relevance(raw, readable):
    """Keep timing only when its quoted words appear in what was actually read."""
    if not isinstance(raw, dict) or not isinstance(raw.get("quote"), str):
        return None
    quote = comparable(raw["quote"])
    if not quote or quote not in comparable(" ".join(readable)):
        return None
    unit = raw.get("baby_age_unit") if raw.get("baby_age_unit") in {"weeks", "months"} else None

    def age(value):
        number = whole_number(value, 120 if unit == "months" else 520)
        if number is None or unit is None:
            return None
        return round(number * 52 / 12) if unit == "months" else number

    values = {
        "stage": raw.get("stage") if raw.get("stage") in {"pregnancy", "postpartum", "baby"} else None,
        "pregnancy_week_min": whole_number(raw.get("pregnancy_week_min"), 45),
        "pregnancy_week_max": whole_number(raw.get("pregnancy_week_max"), 45),
        "baby_age_min_weeks": age(raw.get("baby_age_min")),
        "baby_age_max_weeks": age(raw.get("baby_age_max")),
    }
    for low, high in (
        ("pregnancy_week_min", "pregnancy_week_max"),
        ("baby_age_min_weeks", "baby_age_max_weeks"),
    ):
        if values[low] is not None and values[high] is not None and values[low] > values[high]:
            values[low] = values[high] = None
    if values["pregnancy_week_min"] is not None and (
        values["pregnancy_week_min"] == values["pregnancy_week_max"]
    ):
        # One stated week ("at 37 weeks", "#37weekspregnant") applies from then on.
        values["pregnancy_week_max"] = None
    has_age = values["baby_age_min_weeks"] is not None or values["baby_age_max_weeks"] is not None
    relevance = SourceRelevance(
        **values, baby_age_unit=unit if has_age else None, quote=raw["quote"].strip()[:300]
    )
    return None if relevance.empty else relevance


def category_suggestion(raw, categories):
    """Map a proposed name onto the owner's category; filing waits for the user."""
    if not isinstance(raw, dict) or not isinstance(raw.get("name"), str):
        return None
    name, confidence = " ".join(raw["name"].split())[:80], raw.get("confidence")
    if not name or type(confidence) not in {int, float} or not 0 <= confidence <= 1:
        return None
    match = next(
        (item for item in categories if comparable(item["title"]) == comparable(name)), None
    )
    return CategorySuggestion(
        name=match["title"].strip()[:80] if match else name,
        collection_id=match["id"] if match else None,
        confidence=round(float(confidence), 2),
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
            except BudgetError as failure:
                source.metadata.coverage_notes.append(budget_failure_message(failure))
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
            if len(source.images) < 4:
                source.metadata.coverage_notes.append(
                    "Some visual frames could not be read; visual-only details may be missing."
                )
            source.metadata.coverage_notes.append(
                "Video frames are samples; details between samples may be missing."
            )
    return source


async def process_capture(request, attachments, provider, *, may_use_ai, gate):
    source = SourceBundle(
        SourceMetadata(
            url=request.get("url"),
            platform="upload" if attachments and not request.get("url") else "text",
        )
    )
    failures = []
    budget_failure = None
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
            if acquired.acquisition_failures:
                failures.append(
                    "Some linked source content could not be read. Your original link remains saved."
                )
        except asyncio.CancelledError:
            raise
        except BudgetError as failure:
            budget_failure = failure
            failures.append(budget_failure_message(failure))
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
        except BudgetError as failure:
            budget_failure = failure
            failures.append(budget_failure_message(failure))
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
    key_points, steps = [], []
    relevance = suggestion = None
    if may_use_ai and provider.enabled and (source.parts or source.images):
        await gate()
        try:
            categories = request.get("categories", [])
            result = await provider.extract(source, categories=[item["title"] for item in categories])
            title, summary = result.title, result.summary
            key_points, steps = result.key_points, result.steps
            topics = list(dict.fromkeys([*topics, *result.topics]))[:30]
            image_locations = {image.location for image in source.images}
            for entry in result.visual_text:
                if entry.location in image_locations:
                    source.parts.append(SourcePart(entry.location, entry.text))
            relevance = stated_relevance(
                result.relevance, [source.metadata.title or "", *(part.text for part in source.parts)]
            )
            suggestion = category_suggestion(result.suggested_category, categories)
        except asyncio.CancelledError:
            raise
        except BudgetError as failure:
            budget_failure = failure
            failures.append(budget_failure_message(failure))
        except Exception:
            failures.append(
                "AI could not organize this source. Available source text is still searchable."
            )
    elif source.images:
        failures.append("Enable AI processing to read text in images and sampled video frames.")
    budget_failure = budget_failure or getattr(provider, "budget_error", None)
    if budget_failure is not None:
        failures.append(budget_failure_message(budget_failure))
    if not source.parts:
        failures.append("No readable source text was available; details may be missing.")
    evidence = [
        {"location": part.location, "text": part.text[:12000]}
        for part in source.parts
        if part.text.strip()
    ][:100]
    text = "\n\n".join(part.text for part in source.parts)[:100000]
    notes = list(dict.fromkeys([*source.metadata.coverage_notes, *failures]))[:30]
    incomplete = failures or not text or any(
        not sampling_disclosure(note) for note in source.metadata.coverage_notes
    )
    status = "incomplete" if incomplete else "ready"
    data = SourceData(
        url=request.get("url"),
        topics=topics,
        source_text=text or request.get("text"),
        summary=summary,
        key_points=key_points,
        steps=steps,
        **safe_metadata(source.metadata),
        evidence=evidence,
        status=status,
        attachment_ids=request.get("attachment_ids", []),
        coverage_notes=notes,
        relevance=relevance,
        suggested_category=suggestion,
    ).model_dump(mode="json")
    return {
        "title": title,
        "data": data,
        "status": status,
        "error": budget_failure_message(budget_failure)
        if budget_failure
        else ("Some source details need review. Your original is saved." if failures else None),
    }
