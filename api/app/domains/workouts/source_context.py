"""Owner-only acquired text; independent of model-authored prescriptions."""

import json
import re

from fastapi import HTTPException

from app.domains.workouts.schemas import SourceContext, SourceTextPart

LOCATIONS = re.compile(r"^(caption|transcript|page_text|provided_text|document_text|document_page:[1-9][0-9]?)$")


def without_source_context(value):
    """Project derived/provider data without copying private acquisition text."""
    if isinstance(value, dict):
        return {key: without_source_context(item) for key, item in value.items()
                if key != "source_context"}
    if isinstance(value, list):
        return [without_source_context(item) for item in value]
    return value


def retain_source_context(workout, source):
    # Leave room for server IDs and warning projection without raising the existing
    # 240KB saved-record limit. Never retain image data URLs or metadata as text.
    parts, remaining, truncated = [], 30_000, False
    for part in source.parts:
        if not LOCATIONS.fullmatch(part.location) or not part.text:
            continue
        text = part.text[:remaining]
        truncated |= len(text) < len(part.text)
        remaining -= len(text)
        parts.extend(SourceTextPart(location=part.location, text=text[i:i + 4000])
                     for i in range(0, len(text), 4000))
    if not parts:
        workout.source_context = None
        return workout
    if len(parts) > 64:
        parts, truncated = parts[:64], True
    context = SourceContext(source_url=source.metadata.url, parts=parts, truncated=truncated)
    workout.source_context = context
    def size():
        return len(json.dumps(workout.model_dump(mode="json"), ensure_ascii=False).encode())
    while context.parts and size() > 238 * 1024:
        last = context.parts.pop()
        context.truncated = True
        # Find the largest prefix that fits; this also handles non-ASCII text.
        low, high = 0, len(last.text)
        while low < high:
            mid = (low + high + 1) // 2
            context.parts.append(last.model_copy(update={"text": last.text[:mid]}))
            fits = size() <= 238 * 1024
            context.parts.pop()
            if fits:
                low = mid
            else:
                high = mid - 1
        if low:
            context.parts.append(last.model_copy(update={"text": last.text[:low]}))
            break
    if not context.parts and size() > 240 * 1024:
        workout.source_context = None
    return workout


def preserve_source_context(workout, original):
    """Old clients preserve acquired text; owners may clear it, never forge it."""
    saved = original.get("source_context")
    saved = SourceContext.model_validate(saved) if saved else None
    if "source_context" not in workout.model_fields_set:
        return workout.model_copy(update={
            "source_context": saved,
        })
    if workout.source_context is not None and workout.source_context != saved:
        raise HTTPException(422, "Saved source text is assigned by extraction; it can only be cleared")
    return workout
