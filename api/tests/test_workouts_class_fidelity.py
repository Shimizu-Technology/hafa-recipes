"""Synthetic language/vision regressions; no gym programming or paid AI calls."""
from copy import deepcopy

import pytest

from app.domains.workouts import extraction
from app.domains.workouts.class_extraction import CLASS_PROMPT, load_pairs, normalize_class
from app.domains.workouts.extraction import ExtractionRequest, SourcePart, WorkoutExtractor
from tests.test_workout_extraction import FakeProvider, evidence, image_data, text_pdf

TEXT = """A. AMRAP 5 min
Run or row buy-in 500 to 700 m
Squat 8 to 10 reps
Press 20 or 14 lb
Hold 30 to 40 seconds
B. AMRAP 5 min
Run buy-in 200 to 350 m
Squat 8 to 10 reps"""


def response(location, reversed_ranges=True, collapsed_load=False):
    def exercise(name, quote, **fields):
        return {"name": name, **fields, "evidence": [evidence(key, quote, location) for key in ("name", *fields)]}
    blocks = []
    for label, low, high in [("A", 500, 700), ("B", 200, 350)]:
        heading = f"{label}. AMRAP 5 min"
        name = "Run or row" if label == "A" else "Run"
        entries = [exercise("Run", f"{name} buy-in {low} to {high} m", segment="buy_in",
                            distance_meters_min=high if reversed_ranges else low,
                            distance_meters=low if reversed_ranges else high),
                   exercise("Squat", "Squat 8 to 10 reps", reps_min=8, reps_max=8)]
        if label == "A":
            load = {"load": 20, "load_unit": "lb", "load_convention": None} if collapsed_load else {
                "load_options": [{"load": 20, "load_unit": "lb"}, {"load": 14, "load_unit": "lb"}]}
            entries += [exercise("Press", "Press 20 or 14 lb", **load),
                        exercise("Hold", "Hold 30 to 40 seconds", duration_seconds=40, duration_seconds_max=30)]
        blocks.append({"id": label, "label": label, "grouping": "circuit", "execution": {"mode": "amrap", "time_cap_seconds": 300},
                       "exercises": entries, "evidence": [evidence("execution.mode", heading, location), evidence("execution.time_cap_seconds", heading, location)]})
    return {"title": "Synthetic language class", "kind": "session", "provenance": "source", "blocks": blocks}


@pytest.mark.parametrize("kind", ["text", "images", "document"])
@pytest.mark.parametrize("collapsed_load", [False, True])
async def test_english_alternatives_ranges_and_reversed_vision_bounds(kind, collapsed_load, monkeypatch):
    location = "image:0" if kind == "images" else "document_page:1" if kind == "document" else "provided_text"
    raw = response(location, collapsed_load=collapsed_load)
    if kind == "images":
        for entry in raw["blocks"][1]["evidence"] + [e for item in raw["blocks"][1]["exercises"] for e in item["evidence"]]:
            entry["location"] = "image:1"
    async def pdf(_):
        return [SourcePart(location, TEXT)]
    monkeypatch.setattr(extraction, "_pdf_parts", pdf)
    payload = {"text": TEXT} if kind == "text" else {"document_base64": text_pdf(TEXT), "document_mime": "application/pdf"} if kind == "document" else {
        "images": [{"base64_data": image_data(), "mime_type": "image/png"}] * 2}
    provider = FakeProvider(raw)
    result = await WorkoutExtractor(provider).extract(ExtractionRequest(kind=kind, class_parts=True, ai_consent=True, **payload))
    assert result.workout is not None, result
    a, b = result.workout.blocks
    assert a.exercises[0].name == "Run or row"
    assert [(x.exercises[0].distance_meters_min, x.exercises[0].distance_meters) for x in (a, b)] == [(500, 700), (200, 350)]
    assert all(x.exercises[0].segment == "buy_in" for x in (a, b))
    assert all((x.exercises[1].reps_min, x.exercises[1].reps_max) == (8, 10) for x in (a, b))
    assert [(o.load, o.load_unit) for o in a.exercises[2].load_options] == [(20, "lb"), (14, "lb")]
    assert a.exercises[2].load is None
    assert (a.exercises[3].duration_seconds, a.exercises[3].duration_seconds_max) == (30, 40)
    assert all(w.startswith("Visual extraction is model-observed evidence;") for w in result.warnings), result.warnings


def test_normalization_is_non_mutating_and_valid_before_provider_grounding():
    raw = response("provided_text", collapsed_load=True)
    prior = deepcopy(raw)
    normalized = normalize_class(raw)
    assert raw == prior
    assert extraction._validate_provider_workout(normalized) == []
    assert normalize_class(normalized) == normalized
    assert "20 or 14 lb" in CLASS_PROMPT and "8 to 10 reps" in CLASS_PROMPT


def test_english_load_choices_do_not_treat_rep_ranges_as_loads():
    assert load_pairs("20 or 14 lb") == {(20, "lb"), (14, "lb")}
    assert load_pairs("20/14 lb") == load_pairs("20 or 14 lb")
    assert load_pairs("4 kg or 6 lb") == {(4, "kg"), (6, "lb")}
    assert not load_pairs("8 to 10 reps, run or row")


def test_unsupported_or_ambiguous_range_keeps_review_warning():
    raw = response("provided_text")
    raw["blocks"][0]["exercises"][0]["distance_meters_min"] = 900
    source = extraction.SourceBundle(extraction.SourceMetadata(), [SourcePart("provided_text", TEXT)])
    workout, warnings, _ = extraction.ground_workout(raw, source, class_parts=True)
    assert workout.blocks[0].exercises[0].distance_meters_min is None
    assert any("distance_meters_min" in warning for warning in warnings)

def test_fabricated_alternative_quotes_cannot_create_prescriptions():
    raw = response("provided_text", collapsed_load=True)
    text = TEXT.replace("Press 20 or 14 lb", "Press 20 lb").replace("Run or row", "Run")
    source = extraction.SourceBundle(extraction.SourceMetadata(), [SourcePart("provided_text", text)])
    workout, warnings, _ = extraction.ground_workout(raw, source, class_parts=True)
    assert workout.blocks[0].exercises[2].load_options is None
    assert workout.blocks[0].exercises[0].name == "Run"
    assert warnings


def test_conflicting_rep_range_quotes_remain_a_review_case():
    raw = response("provided_text")
    raw["blocks"][0]["exercises"][1]["evidence"].append(evidence("reps_max", "Squat 12 to 15 reps"))
    source = extraction.SourceBundle(extraction.SourceMetadata(), [SourcePart("provided_text", TEXT + "\nSquat 12 to 15 reps")])
    workout, warnings, _ = extraction.ground_workout(raw, source, class_parts=True)
    assert workout.blocks[0].exercises[1].reps_max is None
    assert any("rep" in warning.lower() for warning in warnings)

@pytest.mark.parametrize("raw", [None, [], {"blocks": None}, {"blocks": [None]}, {"blocks": [{"exercises": None}]}])
def test_normalizer_leaves_malformed_provider_shapes_for_schema_validation(raw):
    assert normalize_class(raw) == raw
