"""Discover card format projection needs no database or per-card queries."""

from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.domains.workouts.discover import DiscoverCard, card


def row(execution=None, **exercise):
    return SimpleNamespace(
        id=uuid4(), app_user_id="owner", source_platform=None,
        published_at=datetime.now(timezone.utc), publisher_display_name="Member",
        content={
            "title": "Workout", "kind": "session", "estimated_minutes": 35,
            "notes": ["private workout note"],
            "blocks": [{
                "id": "main", "label": "Main", "execution": execution,
                "exercises": [{"name": "Squat", "reps_min": 10,
                               "notes": "private exercise note", **exercise}],
            }],
        },
    )


@pytest.mark.parametrize("execution", [
    {"mode": "emom", "interval_seconds": 60, "intervals": 20},
    {"mode": "emom", "interval_seconds": 120, "intervals": 10},
    {"mode": "amrap", "time_cap_seconds": 1200},
    {"mode": "for_time", "time_cap_seconds": 900},
    {"mode": "for_time"},
    {"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": 8},
    {"mode": "work_rest", "work_seconds": 30, "rest_seconds": 30},
])
@pytest.mark.parametrize("detail", [False, True])
def test_card_projects_typed_execution_without_changing_minutes(execution, detail):
    result = card(row(execution), "viewer", {}, detail=detail).model_dump(mode="json")
    assert result["format"]["execution"].items() >= execution.items()
    assert result["format"]["rounds"] is None
    assert result["format"]["exercises"] == [{"rep_scheme": None, "ladder": None}]
    assert result["estimated_minutes"] == 35
    assert "private" not in str(result)


def test_card_projects_rep_scheme_rounds_and_death_by_ladder():
    source = row({"mode": "for_time", "time_cap_seconds": 900}, rep_scheme=[21, 15, 9])
    source.content["blocks"][0]["rounds"] = 3
    result = card(source, "viewer", {}).format
    assert result.rounds == 3 and result.exercises[0].rep_scheme == [21, 15, 9]
    source = row({"mode": "emom"}, ladder={"start": 1, "step": 1})
    result = card(source, "viewer", {}).format
    assert result.execution.interval_seconds == 60
    assert result.exercises[0].ladder.model_dump() == {"start": 1, "step": 1, "end": None}


@pytest.mark.parametrize("kind, count, execution", [
    ("session", 1, None),
    ("program", 1, {"mode": "amrap", "time_cap_seconds": 1200}),
    ("session", 2, {"mode": "emom", "intervals": 20}),
])
def test_untimed_program_and_multi_block_cards_keep_duration(kind, count, execution):
    source = row(execution)
    source.content["kind"] = kind
    source.content["blocks"] *= count
    result = card(source, "viewer", {})
    assert result.format is None and result.estimated_minutes == 35
    legacy = result.model_dump(exclude={"format"})
    assert DiscoverCard.model_validate(legacy).format is None


@pytest.mark.parametrize("broken", [
    {"execution": {"mode": "amrap", "time_cap_seconds": "private invalid cap"}},
    {"execution": {"mode": "private unknown mode"}},
    {"missing_exercises": True},
    *({"rep_scheme": [21, value, 9]} for value in ["private invalid reps", "15", 1.5, True]),
], ids=["invalid-execution", "unknown-mode", "missing-exercises",
        "invalid-reps", "string-reps", "fractional-reps", "boolean-reps"])
@pytest.mark.parametrize("detail", [False, True])
def test_invalid_format_keeps_card_and_logs_no_content(broken, detail, caplog):
    source = row({"mode": "for_time", "time_cap_seconds": 900})
    block = source.content["blocks"][0]
    if "execution" in broken:
        block["execution"] = broken["execution"]
    elif broken.get("missing_exercises"):
        del block["exercises"]
    else:
        block["exercises"][0]["rep_scheme"] = broken["rep_scheme"]
    original = deepcopy(source.content)
    result = card(source, "viewer", {}, detail=detail)
    assert result.id == source.id and result.title == "Workout"
    assert result.format is None and result.estimated_minutes == 35
    assert result.exercise_count == (0 if broken.get("missing_exercises") else 1)
    assert source.content == original
    assert caplog.messages == ["Ignoring invalid Discover card format"]
    assert "private" not in caplog.text
    assert all(record.exc_info is None for record in caplog.records)
