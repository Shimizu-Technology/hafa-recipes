"""Workout-format acronyms (EMOM, for time, Tabata, 21-15-9...) read from quoted source."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.domains.workouts.coach import source_flow_context
from app.domains.workouts.execution import block_seconds, timed_duration_minutes
from app.domains.workouts.extraction import (
    ExtractionRequest,
    SourceBundle,
    SourceMetadata,
    SourcePart,
    WorkoutExtractor,
    _numeric_supported,
    _overall_minutes_supported,
    ground_workout,
    workout_response_format,
)
from app.domains.workouts.formats import rep_schemes
from app.domains.workouts.router import content_digest
from app.domains.workouts.schemas import WorkoutContent
from app.domains.workouts.sharing_service import project_workout
from app.domains.workouts.source_planning import compose_library_program, inspect_personal_source
from tests.test_workout_extraction import FakeProvider, complete_workout, timed_workout
from tests.test_workouts_source_calendar import START, profile


def ev(field, quote):
    return {"field": field, "wording": quote, "location": "caption"}


def pasted(data):
    """Pasted text is the provided_text source part."""
    for block in data["blocks"]:
        for unit in [block, *block["exercises"]]:
            unit["evidence"] = [entry | {"location": "provided_text"} for entry in unit["evidence"]]
    return data


def move(name, quote, **dose):
    return {"name": name, **dose, "evidence": [ev("name", quote), *(ev(key, quote) for key in dose)]}


def raw(execution, exercises, quote, *, grouping="circuit", minutes=None, **block):
    evidence = [ev("execution.mode", quote)] + ([ev("estimated_minutes", quote)] if minutes else [])
    return {"title": "Format", "kind": "session", "estimated_minutes": minutes,
            "blocks": [{"id": "main", "label": "Main", "grouping": grouping, "execution": execution,
                        "evidence": evidence, "exercises": exercises, **block}]}


def ground(text, data, typed=True):
    return ground_workout(data, SourceBundle(SourceMetadata(), [SourcePart("caption", text)]),
                          typed_formats=typed)


def execution(workout):
    block = workout.blocks[0]
    return None if block.execution is None else block.execution.model_dump(exclude_none=True)


@pytest.mark.parametrize("quote", ["EMOM 20", "20 min EMOM", "20-minute EMOM", "EMOM for 20 minutes",
                                   "Every minute on the minute for 20 minutes", "OTM 20", "EMOM 20:00",
                                   "EMOM 20'"])
def test_emom_count_is_minutes_and_the_clock_is_the_workout_total(quote):
    text = f"{quote}: 10 Burpees"
    workout, warnings, _ = ground(text, raw({"mode": "emom", "interval_seconds": 60, "intervals": 20},
                                            [move("Burpees", text, reps_min=10, reps_max=10)], text, minutes=20))
    assert warnings == [] and workout.estimated_minutes == 20
    assert execution(workout) == {"mode": "emom", "interval_seconds": 60, "intervals": 20}
    assert workout.blocks[0].grouping == "interval" and workout.blocks[0].rounds is None
    assert _overall_minutes_supported(20, quote)


@pytest.mark.asyncio
async def test_emom_clock_never_becomes_an_exercise_duration():
    text = "20 min EMOM: 10 Burpees"
    data = raw({"mode": "emom", "interval_seconds": 60, "intervals": 20},
               [move("Burpees", text, reps_min=10, reps_max=10, duration_seconds=1200)], text, minutes=20)
    result = await WorkoutExtractor(FakeProvider(pasted(data))).extract(
        ExtractionRequest(kind="text", text=text, ai_consent=True, typed_formats=True))
    burpees = result.workout.blocks[0].exercises[0]
    assert burpees.duration_seconds is None and burpees.reps_min == 10
    assert result.workout.estimated_minutes == 20
    assert not _numeric_supported("duration_seconds", 1200, text)
    assert not _numeric_supported("rest_seconds", 60, "EMOM 1 minute")


@pytest.mark.parametrize("quote,interval,count,seconds", [
    ("E2MOM x 6", 120, 6, 720), ("E3MOM for 15 minutes", 180, 5, 900),
    ("Every 90s x 10", 90, 10, 900), ("Every 2 minutes for 5 rounds", 120, 5, 600),
])
def test_longer_intervals_and_counts(quote, interval, count, seconds):
    text = f"{quote}: 5 Power Cleans"
    data = raw({"mode": "emom", "interval_seconds": interval, "intervals": count},
               [move("Power Cleans", text, reps_min=5, reps_max=5, rest_seconds=interval, sets=count)], text)
    workout, _, _ = ground(text, data)
    item = workout.blocks[0].exercises[0]
    assert execution(workout) == {"mode": "emom", "interval_seconds": interval, "intervals": count}
    assert item.rest_seconds is None and item.sets is None  # The interval is not rest or sets.
    assert block_seconds(workout.blocks[0]) == seconds
    assert timed_duration_minutes(workout) == seconds // 60
    assert not _numeric_supported("reps_min", count, quote)


@pytest.mark.parametrize("minutes,moves,uneven", [(12, 2, False), (12, 3, False), (10, 3, True)])
def test_alternating_emom_counts_total_minutes_and_warns_when_uneven(minutes, moves, uneven):
    names = ["Burpees", "Squats", "Sit Ups"][:moves]
    lines = [f"Min {index + 1}: 10 {name}" for index, name in enumerate(names)]
    text = f"EMOM {minutes} alternating\n" + "\n".join(lines)
    data = raw({"mode": "emom", "interval_seconds": 60, "intervals": minutes, "rotation": "alternating"},
               [move(name, line, reps_min=10, reps_max=10) for name, line in zip(names, lines)],
               f"EMOM {minutes} alternating", rounds=minutes // moves)
    workout, warnings, _ = ground(text, data)
    assert execution(workout) == {"mode": "emom", "interval_seconds": 60, "intervals": minutes,
                                  "rotation": "alternating"}
    assert workout.blocks[0].rounds is None
    assert any("do not divide evenly" in warning for warning in warnings) is uneven


def test_min_one_min_two_alone_establishes_alternating_rotation():
    text = "EMOM 20\nMin 1: 10 Burpees\nMin 2: 15 Air Squats"
    data = raw({"mode": "emom", "interval_seconds": 60, "intervals": 20, "rotation": None},
               [move("Burpees", "Min 1: 10 Burpees", reps_min=10, reps_max=10),
                move("Air Squats", "Min 2: 15 Air Squats", reps_min=15, reps_max=15)],
               "EMOM 20", rounds=10)
    workout, warnings, _ = ground(text, data)
    assert workout.blocks[0].execution.rotation == "alternating" and workout.blocks[0].rounds is None
    assert "Unsupported rounds removed from Main." not in warnings


@pytest.mark.parametrize("quote,work,rest,count", [
    ("Tabata Squats 8x20/10", 20, 10, 8), ("Tabata Squats", 20, 10, 8), ("Tabata 40/20 Squats", 40, 20, 8),
    ("Tabata Squats 4 minutes", 20, 10, 8), ("Squats 30 on / 30 off x 10", 30, 30, 10),
    ("Squats 40s work, 20s rest for 6 rounds", 40, 20, 6),
])
def test_work_rest_never_becomes_sets_or_reps(quote, work, rest, count):
    data = raw({"mode": "work_rest", "work_seconds": work, "rest_seconds": rest, "intervals": count},
               [move("Squats", quote, sets=8, reps_min=20, reps_max=20)], quote)
    workout, _, _ = ground(quote, data)
    item = workout.blocks[0].exercises[0]
    assert execution(workout) == {"mode": "work_rest", "work_seconds": work, "rest_seconds": rest,
                                  "intervals": count}
    assert item.sets is None and item.reps_min is None and item.reps_max is None
    assert block_seconds(workout.blocks[0]) == (work + rest) * count
    assert not _numeric_supported("sets", 8, "8x20/10") and not _numeric_supported("reps_min", 20, "8x20/10")


@pytest.mark.asyncio
async def test_21_15_9_for_time_is_a_rep_scheme_with_three_rounds():
    text = "21-15-9 for time\nThrusters\nPull-ups"
    data = raw({"mode": "for_time", "time_cap_seconds": None},
               [move("Thrusters", "Thrusters", rep_scheme=[21, 15, 9]),
                move("Pull-ups", "Pull-ups", rep_scheme=[21, 15, 9])], "21-15-9 for time")
    result = await WorkoutExtractor(FakeProvider(pasted(data))).extract(
        ExtractionRequest(kind="text", text=text, ai_consent=True, typed_formats=True))
    block = result.workout.blocks[0]
    assert result.status == "ready", result.warnings
    assert execution(result.workout) == {"mode": "for_time"} and block.rounds == 3
    assert all(item.rep_scheme == [21, 15, 9] and item.reps_min is None for item in block.exercises)
    assert not _numeric_supported("reps_min", 21, "21-15-9 Thrusters")


@pytest.mark.parametrize("quote,cap", [("For time (cap 20)", 1200), ("For time, TC 20", 1200),
                                       ("For time, time cap 20 minutes", 1200), ("For time\nCap: 20", 1200),
                                       ("FT", None), ("Chipper for time", None)])
def test_for_time_caps_use_bare_minutes(quote, cap):
    text = f"{quote}\n100 Burpees"
    data = raw({"mode": "for_time", "time_cap_seconds": cap},
               [move("Burpees", "100 Burpees", reps_min=100, reps_max=100)], quote)
    data["blocks"][0]["evidence"].extend(ev("execution.time_cap_seconds", line) for line in quote.splitlines())
    workout, warnings, _ = ground(text, data)
    assert warnings == []
    assert execution(workout) == {"mode": "for_time", **({"time_cap_seconds": cap} if cap else {})}
    assert workout.blocks[0].rounds is None  # One pass.
    assert timed_duration_minutes(workout) == (cap // 60 if cap else None)


def test_rounds_for_time_count_only_under_for_time():
    text = "5 RFT: 10 Burpees, 20 Air Squats"
    exercises = [move("Burpees", text, reps_min=10, reps_max=10), move("Air Squats", text, reps_min=20, reps_max=20)]
    workout, _, _ = ground(text, raw({"mode": "for_time", "time_cap_seconds": None}, exercises, text, rounds=5))
    assert execution(workout) == {"mode": "for_time"} and workout.blocks[0].rounds == 5
    untyped, _, _ = ground(text, raw(None, exercises, text, rounds=5))
    assert untyped.blocks[0].rounds is None and not _numeric_supported("rounds", 5, text)


@pytest.mark.parametrize("quote", ["AMRAP 15", "15:00 AMRAP", "AMRAP 15'", "AMRAP 15 minutes"])
def test_amrap_cap_accepts_bare_and_clock_minutes(quote):
    text = f"{quote}: 10 Burpees"
    data = raw({"mode": "amrap", "time_cap_seconds": 900},
               [move("Burpees", text, reps_min=10, reps_max=10)], text)
    data["blocks"][0]["evidence"].append(ev("execution.time_cap_seconds", text))
    workout, warnings, _ = ground(text, data)
    assert warnings == [] and execution(workout) == {"mode": "amrap", "time_cap_seconds": 900}


def test_death_by_is_an_open_emom_ladder():
    text = "Death by Burpees"
    data = raw({"mode": "emom", "interval_seconds": 60, "intervals": None},
               [move("Burpees", text, reps_min=1, reps_max=1, ladder={"start": 1, "step": 1, "end": None})], text)
    workout, warnings, _ = ground(text, data)
    item = workout.blocks[0].exercises[0]
    assert warnings == [] and execution(workout) == {"mode": "emom", "interval_seconds": 60}
    assert item.ladder.model_dump() == {"start": 1, "step": 1, "end": None} and item.reps_min is None
    assert timed_duration_minutes(workout) is None  # Until failure.


@pytest.mark.parametrize("quote,ladder,rounds", [("Ladder 1-10 Push-ups", (1, 1, 10), 10),
                                                 ("10-1 ladder Push-ups", (10, -1, 1), 10),
                                                 ("Ladder 2-10 by 2 Push-ups", (2, 2, 10), 5)])
def test_closed_ladder_sets_rounds_not_a_rep_range(quote, ladder, rounds):
    start, step, end = ladder
    data = raw(None, [move("Push-ups", quote, ladder={"start": start, "step": step, "end": end},
                           reps_min=min(start, end), reps_max=max(start, end))], quote, grouping="sequential")
    workout, _, _ = ground(quote, data)
    item = workout.blocks[0].exercises[0]
    assert item.ladder.model_dump() == {"start": start, "step": step, "end": end}
    assert item.reps_min is None and workout.blocks[0].rounds == rounds
    assert not _numeric_supported("reps_max", max(start, end), quote)


def test_rounds_times_reps_still_reads_reps():
    assert _numeric_supported("reps_min", 10, "3 rounds x 10 reps")
    assert not _numeric_supported("reps_min", 6, "E2MOM x 6")


def test_superset_rest_after_the_pair_is_block_rest():
    text = "A1 Bench Press 3x10\nA2 Bent Over Row 3x10\nRest 90s after A2"
    data = raw(None, [move("Bench Press", "A1 Bench Press 3x10", sets=3, reps_min=10, reps_max=10),
                      move("Bent Over Row", "A2 Bent Over Row 3x10", sets=3, reps_min=10, reps_max=10)],
               "Rest 90s after A2", grouping="superset", rest_between_rounds_seconds=90)
    data["blocks"][0]["evidence"].append(ev("rest_between_rounds_seconds", "Rest 90s after A2"))
    workout, warnings, _ = ground(text, data)
    block = workout.blocks[0]
    assert warnings == [] and block.grouping == "superset" and block.rest_between_rounds_seconds == 90
    assert [item.sets for item in block.exercises] == [3, 3]


@pytest.mark.parametrize("quote,mode", [("This is not an EMOM", "emom"), ("No Tabata today", "work_rest"),
                                        ("Not for time", "for_time"), ("3 rounds", "emom")])
def test_negated_or_absent_format_token_is_no_format(quote, mode):
    values = {"emom": {"interval_seconds": 60, "intervals": 3},
              "work_rest": {"work_seconds": 20, "rest_seconds": 10, "intervals": 8},
              "for_time": {"time_cap_seconds": None}}[mode]
    text = f"{quote}: 10 Burpees"
    workout, warnings, _ = ground(text, raw({"mode": mode, **values},
                                            [move("Burpees", text, reps_min=10, reps_max=10)], text))
    assert workout.blocks[0].execution is None
    assert "The timed execution for Main needs source review." in warnings


@pytest.mark.asyncio
async def test_emom_without_a_count_keeps_the_interval_and_stays_incomplete():
    text = "EMOM: 10 Burpees"
    data = raw({"mode": "emom", "interval_seconds": 60, "intervals": 15},
               [move("Burpees", text, reps_min=10, reps_max=10)], text)
    result = await WorkoutExtractor(FakeProvider(pasted(data))).extract(
        ExtractionRequest(kind="text", text=text, ai_consent=True, typed_formats=True))
    assert execution(result.workout) == {"mode": "emom", "interval_seconds": 60}
    assert result.status == "incomplete"
    assert "The timed execution for Main needs source review." in result.warnings


def test_model_values_that_disagree_with_the_source_are_corrected_for_review():
    text = "EMOM 20: 10 Burpees"
    data = raw({"mode": "emom", "interval_seconds": 60, "intervals": 30},
               [move("Burpees", text, reps_min=10, reps_max=10, rep_scheme=[10, 8, 6])], text)
    workout, warnings, _ = ground(text, data)
    assert workout.blocks[0].execution.intervals == 20
    assert workout.blocks[0].exercises[0].rep_scheme is None
    assert "The timed execution for Main needs source review." in warnings
    assert "Unsupported rep_scheme removed from Burpees." in warnings


@pytest.mark.parametrize("wording", ["Tempo 3-1-1", "Squat 3 x 8 @ RPE 8", "Rest 2-3 minutes", "10-12 reps"])
def test_tempo_and_ranges_are_not_rep_schemes(wording):
    assert rep_schemes(wording) == []


@pytest.mark.asyncio
async def test_builds_without_typed_formats_keep_the_legacy_shape_and_creator_wording():
    text = "EMOM 20: 10 Burpees"
    data = raw({"mode": "emom", "interval_seconds": 60, "intervals": 20},
               [move("Burpees", text, reps_min=10, reps_max=10, duration_seconds=1200)], text, minutes=20)
    request = ExtractionRequest(kind="text", text=text, ai_consent=True)
    assert "typed_formats" not in request.model_dump(mode="json")  # Import digests stay stable.
    result = await WorkoutExtractor(FakeProvider(pasted(data))).extract(request)
    workout = result.workout
    assert workout.blocks[0].execution is None and workout.estimated_minutes == 20
    assert workout.blocks[0].exercises[0].duration_seconds is None
    assert text in workout.instructions
    amrap = timed_workout()
    legacy = await WorkoutExtractor(FakeProvider(amrap)).extract(ExtractionRequest(
        kind="text", text="Squat: 3 sets of 8–12 reps. Rest 90 seconds.\n"
        "Repeat as many rounds as possible for 20 minutes (AMRAP).", ai_consent=True))
    assert legacy.status == "ready" and legacy.workout.blocks[0].execution.mode == "amrap"


def test_old_snapshots_round_trip_with_the_same_digest():
    for old in (complete_workout(), timed_workout()):
        stored = WorkoutContent.model_validate(old).model_dump(mode="json")
        again = WorkoutContent.model_validate(stored).model_dump(mode="json")
        assert again == stored and content_digest(again) == content_digest(stored)
        assert all("rep_scheme" not in item and "ladder" not in item
                   for block in stored["blocks"] for item in block["exercises"])


@pytest.mark.parametrize("value", [
    {"mode": "emom", "interval_seconds": 60, "intervals": 20, "rotation": "alternating"},
    {"mode": "for_time", "time_cap_seconds": 1200}, {"mode": "for_time", "time_cap_seconds": None},
    {"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": 8},
])
def test_new_shapes_round_trip_and_unknown_modes_fail(value):
    data = timed_workout()
    data["blocks"][0]["execution"] = value
    data["blocks"][0]["exercises"][0]["rep_scheme"] = [21, 15, 9]
    stored = WorkoutContent.model_validate(data).model_dump(mode="json")
    assert WorkoutContent.model_validate(stored).model_dump(mode="json") == stored
    for invalid in ({"mode": "tabata"}, {"mode": "emom", "time_cap_seconds": 60},
                    {"mode": "work_rest", "work_seconds": 20}):
        data["blocks"][0]["execution"] = invalid
        with pytest.raises(ValidationError):
            WorkoutContent.model_validate(data)


def test_strict_provider_schema_has_no_discriminated_one_of():
    schema = workout_response_format()["json_schema"]["schema"]
    assert "oneOf" not in str(schema) and "discriminator" not in str(schema)
    refs = [branch.get("$ref") for branch in schema["$defs"]["WorkoutBlock"]["properties"]["execution"]["anyOf"][0]["anyOf"]]
    assert refs == [f"#/$defs/{name}" for name in ("AmrapExecution", "EmomExecution", "ForTimeExecution",
                                                   "WorkRestExecution")]
    assert set(schema["$defs"]["EmomExecution"]["required"]) == {"mode", "interval_seconds", "intervals", "rotation"}


def typed_source(value, **exercise):
    workout = WorkoutContent.model_validate(timed_workout())
    workout.provenance = "source"
    block = workout.blocks[0]
    block.execution = WorkoutContent.model_validate(
        {"title": "x", "blocks": [{"id": "a", "label": "a", "execution": value}]}).blocks[0].execution
    block.grouping = "interval" if value["mode"] in {"emom", "work_rest"} else "circuit"
    block.exercises[0].exercise_id = "bodyweight_squat"
    for key, item in exercise.items():
        setattr(block.exercises[0], key, item)
    return workout


def test_sharing_projection_keeps_typed_execution_and_rep_patterns():
    source = typed_source({"mode": "emom", "interval_seconds": 120, "intervals": 6, "rotation": "together"},
                          rep_scheme=[21, 15, 9])
    projected, incomplete = project_workout(source.model_dump(mode="json"))
    assert projected["blocks"][0]["execution"] == {"mode": "emom", "interval_seconds": 120, "intervals": 6,
                                                   "rotation": "together"}
    assert projected["blocks"][0]["exercises"][0]["rep_scheme"] == [21, 15, 9] and not incomplete
    tabata = typed_source({"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": 8},
                          reps_min=None, reps_max=None)
    assert not project_workout(tabata.model_dump(mode="json"))[1]


@pytest.mark.parametrize("value,minutes", [
    ({"mode": "emom", "interval_seconds": 60, "intervals": 20}, 20),
    ({"mode": "emom", "interval_seconds": 120, "intervals": 6}, 12),
    ({"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": 8}, 4),
    ({"mode": "for_time", "time_cap_seconds": 1200}, 20),
])
def test_planning_uses_the_format_clock_without_asking_for_sets(value, minutes):
    source = typed_source(value)
    source.estimated_minutes = None
    result, questions, _ = inspect_personal_source(source, profile(), reviewed_custom=True)
    assert result.estimated_minutes == minutes
    assert not any("sets or rounds" in question or "session length" in question for question in questions)
    program = compose_library_program(profile(), START, 1, [(uuid4(), source)], mode="selected")
    assert program.status == "ready", program.questions


def test_planning_asks_for_length_when_the_format_leaves_it_open():
    source = typed_source({"mode": "for_time", "time_cap_seconds": None})
    source.estimated_minutes = None
    _, questions, _ = inspect_personal_source(source, profile(), reviewed_custom=True)
    assert any("session length" in question for question in questions)
    assert not any("sets or rounds" in question for question in questions)


def test_coach_context_keeps_retained_format_quotes():
    workout = {"provenance": "source", "instructions": ["EMOM 20: 10 Burpees"],
               "blocks": [{"evidence": [ev("execution.mode", "EMOM 20: 10 Burpees")]}]}
    assert source_flow_context(workout) == ["EMOM 20: 10 Burpees"]


def test_import_entry_points_carry_the_client_capability():
    from app.domains.workouts.automation_router import ImportRequest
    from app.domains.workouts.share_router import CaptureRequest

    body = ImportRequest.model_validate({"request_id": str(uuid4()), "source": {
        "kind": "text", "text": "EMOM 20", "ai_consent": True, "typed_formats": True}})
    assert body.source.typed_formats and body.source.model_dump(mode="json")["typed_formats"] is True
    stored = ExtractionRequest.model_validate(body.source.model_dump(mode="json"))
    assert stored.typed_formats  # The queued payload restores it for the worker.
    assert CaptureRequest(capture_id=uuid4(), url="https://example.com/workout", typed_formats=True).typed_formats
    assert not CaptureRequest(capture_id=uuid4(), url="https://example.com/workout").typed_formats
