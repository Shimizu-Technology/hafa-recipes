"""Independent, visibly synthetic source facts; never workout recommendations."""

TEXT_FACTS = {
    "name": "Squat",
    "sets": 3,
    "reps_min": 8,
    "reps_max": 12,
    "rest_seconds": 90,
    "per_side": None,
    "text": "Squat: 3 sets of 8-12 reps. Rest 90 seconds.",
    "quotes": {
        "name": "Squat",
        "sets": "3 sets",
        "reps_min": "8-12 reps",
        "reps_max": "8-12 reps",
        "rest_seconds": "90 seconds",
    },
}
IMAGE_FACTS = {
    "name": "Push-up",
    "sets": 4,
    "reps_min": 6,
    "reps_max": 10,
    "rest_seconds": 75,
    "per_side": None,
    "text": "Push-up: 4 sets of 6-10 reps. Rest 75 seconds. No equipment required.",
    "quotes": {
        "name": "Push-up",
        "sets": "4 sets",
        "reps_min": "6-10 reps",
        "reps_max": "6-10 reps",
        "rest_seconds": "75 seconds",
    },
}
PDF_FACTS = {
    "name": "Reverse lunge",
    "sets": 2,
    "reps_min": 10,
    "reps_max": 10,
    "rest_seconds": 60,
    "per_side": True,
    "text": "Reverse lunge: 2 sets of 10 reps per side. Rest 60 seconds. No equipment required.",
    "quotes": {
        "name": "Reverse lunge",
        "sets": "2 sets",
        "reps_min": "10 reps",
        "reps_max": "10 reps",
        "rest_seconds": "60 seconds",
        "per_side": "10 reps per side",
    },
}


def prescription(location="provided_text", facts=TEXT_FACTS):
    return {
        "title": "Synthetic " + facts["name"],
        "kind": "session",
        "estimated_minutes": None,
        "equipment_required": [],
        "blocks": [
            {
                "id": "main",
                "label": "Synthetic prescription",
                "grouping": "sequential",
                "exercises": [
                    {
                        **{
                            field: facts[field]
                            for field in (
                                "name",
                                "sets",
                                "reps_min",
                                "reps_max",
                                "rest_seconds",
                                "per_side",
                            )
                        },
                        "evidence": [
                            {"field": field, "wording": quote, "location": location}
                            for field, quote in facts["quotes"].items()
                        ],
                    }
                ],
            }
        ],
    }


def source_response(content):
    """Read actual request labels, not an assumed image ordinal or schema text."""
    import json
    import re

    image_locations = [
        match.group(1)
        for part in content
        if part.get("type") == "text"
        if (match := re.fullmatch(r"Source location (image:\d+)", part.get("text", "")))
    ]
    if any(part.get("type") == "image_url" for part in content):
        if len(image_locations) != 1:
            raise RuntimeError(
                "One explicitly located synthetic workout image required"
            )
        return prescription(image_locations[0], IMAGE_FACTS)
    for part in content:
        text = part.get("text", "")
        marker = "Untrusted source JSON:\n"
        if marker not in text:
            continue
        data = json.loads(text.split(marker, 1)[1])
        for source in data.get("parts", []):
            for facts in (TEXT_FACTS, PDF_FACTS):
                if facts["text"] in source.get("text", ""):
                    return prescription(source["location"], facts)
    raise RuntimeError("Known, explicitly located synthetic workout source required")
