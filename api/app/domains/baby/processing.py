"""Bounded source acquisition, local documents/media, and optional grounded AI."""

import asyncio
import base64
import re
import unicodedata
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


def folded(text):
    # Emoji variation selectors and joiners are presentation, not part of a name.
    return re.sub("[\ufe00-\ufe0f\u200d]", "", unicodedata.normalize("NFKC", str(text)).casefold())


def words(text):
    """Letters and numbers in any script, width- and case-folded, as a word list."""
    return "".join(
        char if unicodedata.category(char)[0] in "LMN" else " " for char in folded(text)
    ).split()


def comparable(text):
    """A name's comparison key. Names made only of symbols (emoji) keep their symbols."""
    return " ".join(words(text)) or " ".join(folded(text).split())


def whole_number(value, high):
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return value if type(value) is int and 0 <= value <= high else None


NUMBER_WORDS = {
    word: value
    for value, word in enumerate(
        "zero one two three four five six seven eight nine ten eleven twelve thirteen "
        "fourteen fifteen sixteen seventeen eighteen nineteen".split()
    )
}
TENS = {"twenty": 20, "thirty": 30, "forty": 40}
TRIMESTERS = {
    "first": (1, 13), "1st": (1, 13),
    "second": (14, 27), "2nd": (14, 27),
    "third": (28, 40), "3rd": (28, 40),
}


def wordlike(char):
    # Digits and cased letters (Latin, Greek, Cyrillic) are written between spaces.
    return char.isdigit() or char.lower() != char.upper()


def contains_phrase(text, phrase):
    """Whole words in order; scripts written without spaces (CJK, Thai) match inside a run."""
    start = text.find(phrase)
    while start != -1:
        end = start + len(phrase)
        if not (start and wordlike(text[start - 1]) and wordlike(phrase[0])) and not (
            end < len(text) and wordlike(text[end]) and wordlike(phrase[-1])
        ):
            return True
        start = text.find(phrase, start + 1)
    return False


def stated_numbers(quote):
    """Numbers a quote says, as digits ("37", "#37weeks") or English words ("thirty-seven")."""
    found = set()
    for index, word in enumerate(quote):
        found.update(int(digits) for digits in re.findall(r"\d+", word))
        if word in NUMBER_WORDS:
            found.add(NUMBER_WORDS[word])
        if word in TENS:
            found.add(TENS[word])
            following = NUMBER_WORDS.get(quote[index + 1] if index + 1 < len(quote) else "")
            if following and following < 10:
                found.add(TENS[word] + following)
    return found


def states_bounds(quote, weeks, ages, unit):
    """Each bound is a number in the quote; a trimester range needs the word trimester.

    A lower bound of 0 is the same as no start, so it needs no stated number.
    """
    said = stated_numbers(quote)
    week_bounds, age_bounds = set(said), set(said)
    if {"trimester", "trimesters"} & set(quote):
        for word in quote:
            week_bounds.update(TRIMESTERS.get(word, ()))
        if {"fourth", "4th"} & set(quote):
            age_bounds.update({0, 3 if unit == "months" else 13})
    return all(
        low in {None, 0, *allowed} and high in {None, *allowed}
        for (low, high), allowed in ((weeks, week_bounds), (ages, age_bounds))
    )


def stated_relevance(raw, readable):
    """Keep timing only when its quote is in what was read and states every bound.

    The quote must match whole words in order ("7 weeks" is not inside "37 weeks"),
    so a short or partial phrase cannot ground timing on its own.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("quote"), str):
        return None
    quote = words(raw["quote"])
    phrase = " ".join(quote)
    if len(phrase.replace(" ", "")) < 4 or not contains_phrase(
        " ".join(words(" ".join(readable))), phrase
    ):
        return None
    unit = raw.get("baby_age_unit") if raw.get("baby_age_unit") in {"weeks", "months"} else None
    weeks = [whole_number(raw.get(key), 45) for key in ("pregnancy_week_min", "pregnancy_week_max")]
    ages = [  # in the unit the source used
        whole_number(raw.get(key), 120 if unit == "months" else 520) if unit else None
        for key in ("baby_age_min", "baby_age_max")
    ]
    if not states_bounds(quote, weeks, ages, unit):
        return None
    scale = 52 / 12 if unit == "months" else 1
    ages = [None if value is None else round(value * scale) for value in ages]
    values = {
        "stage": raw.get("stage") if raw.get("stage") in {"pregnancy", "postpartum", "baby"} else None,
        "pregnancy_week_min": weeks[0],
        "pregnancy_week_max": weeks[1],
        "baby_age_min_weeks": ages[0],
        "baby_age_max_weeks": ages[1],
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
    key = comparable(name)
    match = next(
        (item for item in categories if key and comparable(item["title"]) == key), None
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
            # Grounding includes visual_text: on-screen captions are often where a
            # creator states timing. It is literal frame text, kept only for real
            # image locations, and stored as evidence the parent can see beside
            # the quote. Timing only sorts tips; it never schedules anything.
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
