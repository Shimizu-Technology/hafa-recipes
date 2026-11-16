"""Screenshots of a class: note headings are not movements, and misreads get flagged.

The class rows are synthetic.
"""

import pytest

from app.domains.workouts.extraction import (
    SourceBundle,
    SourceImage,
    SourceMetadata,
    ground_workout,
)


def ev(field, wording):
    return {"field": field, "wording": wording, "location": "image:0"}


def row(distance, quote):
    return {"name": "Row", "distance_meters": distance, "evidence": [ev("name", quote), ev("distance_meters", quote)]}


def ground(raw):
    source = SourceBundle(SourceMetadata(), [], [SourceImage("image:0", "data:image/png;base64,AAAA")], class_parts=True)
    return ground_workout(raw, source, class_parts=True)


@pytest.mark.parametrize("first,flagged", [(750, False), (75, True)])
def test_a_distance_note_is_a_range_and_a_disagreeing_distance_is_flagged(first, flagged):
    raw = {"title": "Class", "kind": "session", "instructions": ["Hold one pace for every part"], "blocks": [{
        "id": "a", "label": "A", "grouping": "circuit", "evidence": [],
        "instructions": ["Keep the swings unbroken"],
        "exercises": [
            row(first, f"Row {first} meters"),
            {"name": "Box Jumps", "reps_min": 15, "reps_max": 15,
             "evidence": [ev("name", "15 Box Jumps"), ev("reps_min", "15 Box Jumps"), ev("reps_max", "15 Box Jumps")]},
            {"name": "Row Distance", "distance_meters_min": 600, "distance_meters": 750,
             "evidence": [ev("name", "ROW DISTANCE"), ev("distance_meters_min", "600-750m"),
                          ev("distance_meters", "600-750m")]}]}]}
    workout, warnings = ground(raw)[:2]
    names = [item.name for item in workout.blocks[0].exercises]
    assert names == ["Row", "Box Jumps"]
    first_row = workout.blocks[0].exercises[0]
    if flagged:
        assert (first_row.distance_meters_min, first_row.distance_meters) == (None, 75)
        assert any("Row reads 75 m but A lists 600-750 m" in warning for warning in warnings)
    else:
        assert (first_row.distance_meters_min, first_row.distance_meters) == (600, 750)
    # Notes read from screenshots stay, under their own review warning.
    assert workout.instructions == ["Hold one pace for every part"]
    assert workout.blocks[0].instructions == ["Keep the swings unbroken"]
    assert "Coach notes were read from screenshots; check them against the class." in warnings


def test_member_results_and_comments_never_become_screenshot_notes():
    raw = {"title": "Class", "kind": "session",
           "instructions": ["Hold one pace for every part", "Jane Doe 12:43 Rx", "Mike R: great one today"],
           "blocks": [{"id": "a", "label": "A", "evidence": [], "instructions": ["Bob Lee 5+2", "Men: 12-16kg"],
                       "exercises": [{"name": "Box Jumps", "evidence": [ev("name", "15 Box Jumps")]}]}]}
    workout, warnings = ground(raw)[:2]
    assert workout.instructions == ["Hold one pace for every part"]
    assert workout.blocks[0].instructions == ["Men: 12-16kg"]
    assert "Lines that read like member results or comments were left out of the coach notes." in warnings
