"""Imported names stay honest; reducing volume does not require guessing movements."""

from dataclasses import replace

import pytest

from app.domains.workouts.catalog import EXERCISES, match_exercise
from app.domains.workouts.programming import RULE_VERSION, adapt_workout, build_program
from app.domains.workouts.schemas import Evidence, WorkoutBlock, WorkoutContent, WorkoutExecution
from tests.test_workout_programming import START, profile

NAMES = ["Good Morning + Shoulder Press", "Bodyweight Squat", "Push Ups", "Glute Bridge",
         "Dead Bug", "Bicycle Crunch", "2-Pulse Squat + 2 Jabs"]


def imported(**block_changes):
    return WorkoutContent.model_validate({
        "id": "imported-1", "title": "Imported circuit", "provenance": "source",
        "estimated_minutes": 21, "instructions": ["Follow the original order"],
        "notes": ["My private reminder"],
        "blocks": [{"id": "circuit", "label": "Circuit", "grouping": "circuit", "rounds": 3,
                    "exercises": [{"name": name, "provenance": "source", "duration_seconds": 40,
                                   "rest_seconds": 20, "instructions": "Source cue"} for name in NAMES],
                    **block_changes}],
    })


@pytest.mark.parametrize("name,identifier", [
    ("Bodyweight Squat", "bodyweight_squat"), ("  BODYWEIGHT   SQUATS ", "bodyweight_squat"),
    ("Push Ups", "pushup"), ("Push‑up", "pushup"), ("pushups", "pushup"),
    ("Glute Bridge", "glute_bridge"), ("Dead Bug", "dead_bug"),
    ("Good Morning + Shoulder Press", None), ("Bicycle Crunch", None),
    ("2-Pulse Squat + 2 Jabs", None), ("Bodyweight squat + press", None),
    ("Weighted Push Ups", None), ("Wall Push Ups", None), ("", None),
])
def test_only_unambiguous_whole_names_and_known_aliases_match(name, identifier):
    result = match_exercise(name)
    assert (result.id if result else None) == identifier


def test_ambiguous_alias_is_not_matched(monkeypatch):
    monkeypatch.setitem(EXERCISES, "wall_pushup", replace(EXERCISES["wall_pushup"], aliases=("Push Ups",)))
    assert match_exercise("Push Ups") is None


def test_shortening_unknown_import_reduces_rounds_preserves_content_and_parent():
    source = imported()
    source.blocks[0].evidence = [Evidence(field="rounds", wording="3 rounds")]
    item = source.blocks[0].exercises[0]
    item.load, item.load_unit, item.load_convention = 10, "kg", "total"
    item.evidence = [Evidence(field="load", wording="10 kg"), Evidence(field="duration_seconds", wording="40 seconds")]
    before = source.model_dump(mode="json")
    result = adapt_workout(source, profile(), 10)
    assert result.status == "ready", result.questions
    suggestion = result.workout
    assert suggestion.parent_version_id == source.id and suggestion.version == source.version + 1
    assert suggestion.provenance == "suggestion" and result.rule_version == RULE_VERSION
    assert suggestion.id == adapt_workout(source, profile(), 10).workout.id
    assert suggestion.blocks[0].rounds == 1 and suggestion.blocks[0].evidence == []
    assert [item.name for item in suggestion.blocks[0].exercises] == NAMES
    assert [item.exercise_id for item in suggestion.blocks[0].exercises] == [
        None, "bodyweight_squat", "pushup", "glute_bridge", "dead_bug", None, None]
    assert all(item.duration_seconds == 40 and item.rest_seconds == 20 and item.sets is None
               and item.reps_min is None and item.instructions == "Source cue"
               and item.provenance == "suggestion" for item in suggestion.blocks[0].exercises)
    assert suggestion.blocks[0].exercises[0].load is None
    assert [e.field for e in suggestion.blocks[0].exercises[0].evidence] == ["duration_seconds"]
    assert suggestion.instructions == source.instructions and suggestion.notes == source.notes
    assert suggestion.estimated_minutes <= 10 and any("estimate" in c for c in result.changes)
    assert source.model_dump(mode="json") == before


def test_shortening_sets_keeps_reps_rest_and_cues():
    source = imported(rounds=None)
    for item in source.blocks[0].exercises:
        item.sets, item.duration_seconds, item.reps_min = 4, None, 8
        item.evidence = [Evidence(field="sets", wording="4 sets")]
    result = adapt_workout(source, profile(), 12)
    assert result.status == "ready", result.questions
    assert all(item.sets == 2 and item.reps_min == 8 and item.rest_seconds == 20
               and item.duration_seconds is None and not item.evidence
               for item in result.workout.blocks[0].exercises)


def test_timed_single_round_drops_trailing_exercises_only():
    source = imported(rounds=1)
    source.estimated_minutes = 7
    result = adapt_workout(source, profile(), 5)
    assert result.status == "ready", result.questions
    assert [item.name for item in result.workout.blocks[0].exercises] == NAMES[:5]
    assert all(item.duration_seconds == 40 and item.rest_seconds == 20
               for item in result.workout.blocks[0].exercises)
    assert any("Bicycle Crunch" in change and "2-Pulse Squat + 2 Jabs" in change for change in result.changes)


def test_shorter_amrap_keeps_unknown_moves_and_repetition_targets():
    source = imported(rounds=None, execution=WorkoutExecution(mode="amrap", time_cap_seconds=1200))
    result = adapt_workout(source, profile(), 10)
    assert result.status == "ready", result.questions
    assert result.workout.blocks[0].execution.time_cap_seconds == 600
    assert result.workout.blocks[0].rounds is None
    assert [item.name for item in result.workout.blocks[0].exercises] == NAMES
    assert source.blocks[0].execution.time_cap_seconds == 1200


@pytest.mark.parametrize("minutes,changes", [(None, {}), (10, {"movement_exclusions": ["impact"]})])
def test_unknown_moves_need_one_plain_question_when_movement_knowledge_is_required(minutes, changes):
    result = adapt_workout(imported(), profile(**changes), minutes)
    assert result.status == "needs_information" and result.workout is None
    assert len(result.questions) == 1
    assert all(name in result.questions[0] for name in (NAMES[0], NAMES[5], NAMES[6]))
    assert "catalog" not in result.questions[0] and "reviewed" not in result.questions[0]


@pytest.mark.parametrize("changes", [{"adult_confirmed": False}, {"readiness": "unknown"},
                                     {"limitations": ["Ask my doctor"]}, {"equipment": None}])
def test_shortening_keeps_adult_readiness_and_equipment_gates(changes):
    assert adapt_workout(imported(), profile(**changes), 10).status == "needs_information"


def test_unknown_equipment_requirements_are_preserved_and_checked():
    source = imported()
    source.equipment_required = ["kettlebell"]
    assert adapt_workout(source, profile(), 10).status == "needs_information"
    result = adapt_workout(source, profile(equipment=["kettlebell"]), 10)
    assert result.status == "ready" and "kettlebell" in result.workout.equipment_required


def test_whole_name_matching_allows_safe_existing_substitution():
    source = imported(exercises=[{"name": "Push Ups", "sets": 2, "reps_min": 8}])
    result = adapt_workout(source, profile(equipment=["wall"], movement_exclusions=["floor"]))
    assert result.status == "ready"
    exercise = result.workout.blocks[0].exercises[0]
    assert exercise.exercise_id == "wall_pushup" and exercise.instructions
    assert exercise.notes is None and source.blocks[0].exercises[0].exercise_id is None
    assert adapt_workout(source, profile(equipment=["wall"], movement_exclusions=["floor"]), 10).status == "conflicts"


def test_shortening_never_invents_missing_dose_or_removes_separate_recovery_blocks():
    source = imported(rounds=None)
    assert adapt_workout(source, profile(), 10).status == "needs_information"
    source = imported()
    source.blocks.append(WorkoutBlock(id="cooldown", label="Cooldown", rounds=1,
                                     exercises=[source.blocks[0].exercises[-1]]))
    assert adapt_workout(source, profile(), 10).status == "needs_information"
    assert len(source.blocks) == 2
    assert adapt_workout(imported(), profile(), 5).status == "needs_information"


def test_generated_guidance_uses_instructions_and_beginner_copy():
    proposal = build_program(profile(), START, 1)
    for session in proposal.sessions:
        assert session.workout.instructions or session.workout.blocks[0].id == "aerobic"
        assert session.workout.notes == []
        assert all(item.notes is None for block in session.workout.blocks for item in block.exercises)
    text = proposal.model_dump_json()
    assert all(term not in text for term in ("D03", "catalog", "caller", "inferred", "starter policy"))
    assert "not medical advice" in text and "stop if you feel pain" in text and "weight you can control" in text
