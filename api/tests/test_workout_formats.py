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
    _complete,
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
    for timed in ("Tabata 8x20/10", "8x20s/10s", "8x:20/:10", "8 x 20 on/10 off", "8x20/10 on/off"):
        assert not _numeric_supported("sets", 8, timed) and not _numeric_supported("reps_min", 20, timed)


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
    branches = schema["$defs"]["WorkoutBlock"]["properties"]["execution"]["anyOf"]
    assert branches == [{"$ref": f"#/$defs/{name}"} for name in (
        "AmrapExecution", "EmomExecution", "ForTimeExecution", "WorkRestExecution")] + [{"type": "null"}]

    def nested(node):
        if isinstance(node, dict):
            return any(isinstance(branch, dict) and ("anyOf" in branch or "oneOf" in branch)
                       for branch in node.get("anyOf", [])) or any(map(nested, node.values()))
        return isinstance(node, list) and any(map(nested, node))

    assert not nested(schema)  # One flat anyOf per union, as strict structured output expects.
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


# --- Review fixes: ordinary prescriptions keep main's grounding --------------------------------


def legacy_and_typed(text, data):
    from copy import deepcopy
    return [ground(text, deepcopy(data), typed) for typed in (False, True)]


@pytest.mark.parametrize("quote,field,value", [
    ("Rest 90 seconds every round", "rest_seconds", 90), ("Rest 60s every set", "rest_seconds", 60),
    ("Rest 2 minutes every 3 rounds", "rest_seconds", 120), ("Plank 30 seconds every round", "duration_seconds", 30),
    ("hold 30 seconds every set", "duration_seconds", 30), ("hold 30 seconds every side", "duration_seconds", 30),
])
def test_rest_or_hold_every_round_is_still_a_rest_or_duration(quote, field, value):
    text = f"Squat 3 sets of 10 reps. {quote}"
    dose = {"sets": 3, field: value, **({"reps_min": 10, "reps_max": 10} if field == "rest_seconds" else {})}
    for workout, warnings, _ in legacy_and_typed(text, raw(None, [move("Squat", text, **dose)], text,
                                                         grouping="sequential")):
        assert warnings == [] and getattr(workout.blocks[0].exercises[0], field) == value
    assert _numeric_supported(field, value, quote)


@pytest.mark.parametrize("quote,field,value", [
    ("Every 90 seconds", "rest_seconds", 90), ("Every 2 minutes x 5", "rest_seconds", 120),
    ("10 Burpees every minute for 20 minutes", "rest_seconds", 60), ("Hold 30 seconds every minute", "rest_seconds", 30),
    ("AMRAP 20", "duration_seconds", 1200), ("For time, cap 20", "duration_seconds", 1200),
])
def test_a_format_clock_is_still_never_a_rest_or_duration(quote, field, value):
    assert not _numeric_supported(field, value, quote)


@pytest.mark.parametrize("quote,sets,reps", [("Lunges 4x8/8", 4, 8), ("Squat 3 x 12/10/8", 3, 12),
                                             ("Bench 5x5/3", 5, 5), ("Lunges 4 x 8/8 per side", 4, 8)])
def test_sets_by_split_reps_stay_sets_and_reps(quote, sets, reps):
    name = quote.split()[0]
    data = raw(None, [move(name, quote, sets=sets, reps_min=reps, reps_max=reps)], quote, grouping="sequential")
    for workout, warnings, _ in legacy_and_typed(quote, data):
        item = workout.blocks[0].exercises[0]
        assert warnings == [] and (item.sets, item.reps_min, item.reps_max) == (sets, reps, reps)


def test_a_grounded_work_rest_block_reads_its_bare_ratio_as_intervals():
    text = "Tabata finisher\nSquats 8x20/10"
    data = raw({"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": 8},
               [move("Squats", "Squats 8x20/10", sets=8, reps_min=20, reps_max=20)], "Tabata finisher",
               grouping="interval")
    workout, warnings, _ = ground(text, data)
    item = workout.blocks[0].exercises[0]
    assert execution(workout) == {"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": 8}
    assert (item.sets, item.reps_min, item.reps_max) == (None, None, None) and warnings == []


@pytest.mark.asyncio
@pytest.mark.parametrize("quote,work,rest,count", [("Squats 40s work, 20s rest for 6 rounds", 40, 20, 6),
                                                   ("Tabata Squats 8x20/10", 20, 10, 8)])
async def test_legacy_builds_get_work_rest_as_circuit_rounds_with_work_and_rest(quote, work, rest, count):
    data = raw({"mode": "work_rest", "work_seconds": work, "rest_seconds": rest, "intervals": count},
               [move("Squats", quote)], quote, grouping="interval")
    result = await WorkoutExtractor(FakeProvider(pasted(data))).extract(
        ExtractionRequest(kind="text", text=quote, ai_consent=True))
    block, item = result.workout.blocks[0], result.workout.blocks[0].exercises[0]
    assert result.status == "ready" and result.warnings == []
    assert (block.grouping, block.rounds, block.execution) == ("circuit", count, None)
    assert (item.duration_seconds, item.rest_seconds) == (work, rest)
    assert {entry.field for entry in item.evidence} >= {"duration_seconds", "rest_seconds"}


@pytest.mark.parametrize("text,value", [
    ("EMOM 10 alternating\nMin 1: 10 Burpees\nMin 2: 10 Squats\nMin 3: 10 Sit Ups",
     {"mode": "emom", "interval_seconds": 60, "intervals": 10, "rotation": "alternating"}),
    ("This is not an EMOM: 10 Burpees", {"mode": "emom", "interval_seconds": 60, "intervals": 3}),
    ("5 RFT: 21-15-9 Burpees", {"mode": "for_time", "time_cap_seconds": None}),
])
def test_legacy_builds_get_no_warnings_about_formats_they_never_receive(text, value):
    dose = {"rep_scheme": [21, 15, 9]} if "RFT" in text else {"reps_min": 10, "reps_max": 10}
    data = raw(value, [move("Burpees", text, **dose)], text)
    workout, warnings, _ = ground(text, data, typed=False)
    assert workout.blocks[0].execution is None and warnings == []


@pytest.mark.parametrize("model,rotation,review", [("together", "together", False), (None, None, False),
                                                   ("alternating", None, True)])
def test_a_movement_named_alternating_never_rotates_the_emom(model, rotation, review):
    text = "EMOM 12: 10 alternating lunges, 5 burpees"
    data = raw({"mode": "emom", "interval_seconds": 60, "intervals": 12, "rotation": model},
               [move("alternating lunges", "10 alternating lunges", reps_min=10, reps_max=10),
                move("burpees", "5 burpees", reps_min=5, reps_max=5)], "EMOM 12", grouping="interval")
    workout, warnings, _ = ground(text, data)
    assert workout.blocks[0].execution.rotation == rotation
    assert ("The timed execution for Main needs source review." in warnings) is review


@pytest.mark.parametrize("text", ["EMOM 12 alternating: 10 lunges, 5 burpees", "Alternating EMOM 12: 10 lunges, 5 burpees",
                                  "EMOM 12, odd minutes 10 lunges, even minutes 5 burpees"])
def test_a_format_level_rotation_wins_but_flags_a_disagreeing_model(text):
    data = raw({"mode": "emom", "interval_seconds": 60, "intervals": 12, "rotation": "together"},
               [move("lunges", "10 lunges", reps_min=10, reps_max=10),
                move("burpees", "5 burpees", reps_min=5, reps_max=5)], text, grouping="interval")
    workout, warnings, _ = ground(text, data)
    assert workout.blocks[0].execution.rotation == "alternating"
    assert "The timed execution for Main needs source review." in warnings


@pytest.mark.parametrize("text,format", [("Burpees 50 reps, record your time for time trial", False),
                                         ("Use the time for time trials later", False),
                                         ("100 Burpees for time", True), ("For time: 100 Burpees", True),
                                         ("100 Burpees for time and post your score", True)])
def test_for_time_must_be_a_format_phrase(text, format):
    data = raw({"mode": "for_time", "time_cap_seconds": None}, [move("Burpees", text, reps_min=50, reps_max=50)], text)
    workout, _, _ = ground(text, data)
    assert (workout.blocks[0].execution is not None) is format


def test_rounds_for_time_that_disagree_with_the_rep_scheme_need_review():
    text = "5 RFT: 21-15-9 Thrusters"
    data = raw({"mode": "for_time", "time_cap_seconds": None},
               [move("Thrusters", text, rep_scheme=[21, 15, 9])], text)
    workout, warnings, _ = ground(text, data)
    assert "The timed execution for Main needs source review." in warnings
    agreed = "3 RFT: 21-15-9 Thrusters"
    _, warnings, _ = ground(agreed, raw({"mode": "for_time", "time_cap_seconds": None},
                                        [move("Thrusters", agreed, rep_scheme=[21, 15, 9])], agreed))
    assert warnings == []


@pytest.mark.parametrize("value,ladder,incomplete", [
    ({"mode": "emom", "interval_seconds": 60, "intervals": None}, None, True),
    ({"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": None}, None, True),
    ({"mode": "emom", "interval_seconds": 60, "intervals": None}, {"start": 1, "step": 1, "end": None}, False),
])
def test_sharing_marks_an_emom_without_a_count_incomplete(value, ladder, incomplete):
    source = typed_source(value, ladder=None if ladder is None else
                          WorkoutContent.model_validate({"title": "x", "blocks": [{"id": "a", "label": "a", "exercises": [
                              {"name": "x", "ladder": ladder}]}]}).blocks[0].exercises[0].ladder)
    assert project_workout(source.model_dump(mode="json"))[1] is incomplete


@pytest.mark.parametrize("text,quote,rows,rotation", [
    # A movement quote often leaves out its "Min 1:" row prefix.
    ("20 min EMOM\nMin 1: 12 Kettlebell Swings\nMin 2: 10 Push-ups", "20 min EMOM",
     ("12 Kettlebell Swings", "10 Push-ups"), "alternating"),
    ("20 min EMOM\n12 Kettlebell Swings\n10 Push-ups\nAlternate for 20 minutes.", "Alternate for 20 minutes",
     ("12 Kettlebell Swings", "10 Push-ups"), "alternating"),
    ("20 min EMOM\n12 Kettlebell Swings\n10 Push-ups alternating each leg", "20 min EMOM",
     ("12 Kettlebell Swings", "10 Push-ups"), None),
])
def test_rotation_reads_row_prefixes_and_alternate_instructions(text, quote, rows, rotation):
    data = raw({"mode": "emom", "interval_seconds": 60, "intervals": 20, "rotation": None},
               [move(row.split(" ", 1)[1], row, reps_min=int(row.split()[0]), reps_max=int(row.split()[0]))
                for row in rows], "20 min EMOM", grouping="interval")
    data["blocks"][0]["evidence"].append(ev("execution.rotation", quote))
    workout, warnings, _ = ground(text, data)
    assert workout.blocks[0].execution.rotation == rotation and warnings == []


def test_a_separate_rest_after_a_split_rep_count_is_not_a_work_rest_label():
    assert _numeric_supported("sets", 4, "Bench 4x8/8 rest 90s")
    assert _numeric_supported("reps_min", 8, "Bench 4x8/8 rest 90s")
    assert not _numeric_supported("sets", 8, "Squats 8 x 20 on / 10 off")


@pytest.mark.parametrize("wording,found", [("21-15-9 for time\nThrusters", True), ("For time (cap 12)", True),
                                           ("record your time for time trial", False),
                                           ("21-15-9 reps for time of:", True), ("21-15-9 for time of\nThrusters", True),
                                           ("train for time of day", False)])
def test_for_time_format_words_read_multiline_quotes(wording, found):
    import re

    from app.domains.workouts.execution import FORMAT_WORDS
    assert bool(re.search(FORMAT_WORDS, wording, re.I)) is found


# Real pages imported on 2026-11-01 (dev, typed_formats); excerpts are verbatim page text.
BUILT_FOR_ATHLETES_EMOM = (
    "EMOM 20\nJuly 1, 2026\nRead time: 1 min\n20 Minutes. One Goal.\n"
    "This week's Workout of the Week uses a simple EMOM format -\nEvery Minute On the Minute\n.\n"
    "At the start of each minute, complete the prescribed reps. Once finished, use the remaining time to "
    "recover before starting the next exercise.\nThe faster and more efficiently you work, the more recovery "
    "you'll earn.\nMinute 1:\n12 Burpees\nMinute 2:\n15 Goblet Squats\nMinute 3:\n12 Push-Ups\nMinute 4:\n"
    "15 Sit-Ups\nMinute 5:\n12 Dumbbell Thrusters\nRepeat for\n4 rounds\n.\nThe challenge:\nFinish the "
    "prescribed reps before the minute is up. Any time remaining is your recovery before the next minute "
    "begins.\n20 minutes. 5 movements. No designated rest.")
CROSSFIT_FRAN = (
    "The Fran Workout\nRx’d\n21-15-9 reps for time of:\nThrusters\nPull-ups\n♀ 65 lb\n♂ 95 lb\n"
    "The score is determined by the time it takes to complete the workout.\nIntermediate\nFor time:\n"
    "21-15-9 thrusters\n12-9-6\npull-ups\n♀\n55\nlb\n♂\n75\nlb\nBeginner\n21-15-9 reps for time of:\n"
    "Thrusters\nRing rows\n♀\n35\nlb\n♂\n45\nlb\nWhat Is the Fran Workout?\n"
    "Intermediate Variation\nFor time:\n21-15-9 thrusters\n12-9-6 pull-ups\n♀ 55 lb\n♂ 75 lb\n"
    "Beginner Variation\n21-15-9 reps for time of:\nThrusters\nRing rows\n♀ 35 lb\n♂ 45 lb")
TWO_MOVE_TABATA = (
    "Two-Move Tabata\nTimer\nTwo complete Tabatas, back to back: eight rounds of air squats, a one-minute "
    "reset, then eight rounds of push-ups. Each block runs the classic 20-seconds-on, 10-seconds-off protocol, "
    "and the timer adds a one-minute warmup before the first block and a one-minute cooldown after the last — "
    "10:40 all in.\n20/10 Tabata\nThe original protocol — 8 rounds of 20 seconds on, 10 seconds off. Four "
    "minutes.\n1 INTERVAL\n0:20 WORK\n0:10 REST\n8 ROUNDS\nTotal\n3:50")


def on_page(text, data, typed=True):
    for block in data["blocks"]:
        for unit in [block, *block["exercises"]]:
            unit["evidence"] = [entry | {"location": "page_text"} for entry in unit["evidence"]]
    return ground_workout(data, SourceBundle(SourceMetadata(), [SourcePart("page_text", text)]), typed_formats=typed)


def quoted(name, *pairs, **values):
    """An exercise whose model output quotes only the fields given in pairs."""
    return {"name": name, **values, "evidence": [ev("name", name), *(ev(field, quote) for field, quote in pairs)]}


@pytest.mark.parametrize("model", [None, "alternating"])
def test_minute_header_lines_rotate_a_real_emom_page(model):
    # The model quoted "12 Burpees" for reps_min only and the "Minute 1:" header sits on its own line.
    rows = [("Burpees", 12), ("Goblet Squats", 15), ("Push-Ups", 12), ("Sit-Ups", 15), ("Dumbbell Thrusters", 12)]
    data = {"title": "EMOM 20", "kind": "session", "estimated_minutes": 20, "blocks": [{
        "id": "emom-20", "label": "EMOM 20", "grouping": "interval",
        "execution": {"mode": "emom", "interval_seconds": 60, "intervals": 20, "rotation": model},
        "evidence": [ev("execution.mode", "EMOM 20"), ev("execution.intervals", "20 Minutes"),
                     ev("workout_instructions", "20 minutes. 5 movements. No designated rest.")],
        "exercises": [quoted(name, ("reps_min", f"{reps} {name}"), reps_min=reps, reps_max=reps)
                      for name, reps in rows]}]}
    workout, warnings, _ = on_page(BUILT_FOR_ATHLETES_EMOM, data)
    assert warnings == [] and workout.estimated_minutes == 20
    assert execution(workout) == {"mode": "emom", "interval_seconds": 60, "intervals": 20, "rotation": "alternating"}
    assert [(item.reps_min, item.reps_max) for item in workout.blocks[0].exercises] == [(r, r) for _, r in rows]


@pytest.mark.parametrize("statement,rotation", [
    ("Start the next exercise each minute.", "alternating"),
    ("Move to the next exercise every minute.", "alternating"),
    ("One movement per minute.", "alternating"),
    ("Use the remaining time to recover before starting the next exercise.", "alternating"),
    ("Use the remainder of the minute to rest before the next movement.", "alternating"),
    # "Rotate through" can mean every movement each minute; it states no rotation.
    ("Rotate through the movements.", None),
    ("Rotate through the movements every minute.", None),
    ("Don't rotate through the movements.", None),
    ("One movement per minute? No, do them all.", None),
    ("One movement per minute? Not today.", None),
    ("One movement per minute - no, do them all.", None),
    ("Start the next exercise each minute. No rest.", "alternating"),
    ("Do the remaining reps before the next exercise.", None),
    ("Move to the next exercise when you finish.", None),
    ("Rest before the next movement.", None),
])
def test_one_move_per_minute_wording_rotates_an_emom(statement, rotation):
    text = f"EMOM 12\n10 Burpees\n15 Air Squats\n{statement}"
    data = raw({"mode": "emom", "interval_seconds": 60, "intervals": 12, "rotation": None},
               [move("Burpees", "10 Burpees", reps_min=10, reps_max=10),
                move("Air Squats", "15 Air Squats", reps_min=15, reps_max=15)], "EMOM 12", grouping="interval")
    data["blocks"][0]["evidence"].append(ev("workout_instructions", statement))
    workout, warnings, _ = ground(text, data)
    assert workout.blocks[0].execution.rotation == rotation and warnings == []


@pytest.mark.parametrize("statement", ["Rotate through the movements every minute.",
                                       "One movement per minute? No, do them all."])
def test_a_model_rotation_without_a_rotation_statement_needs_review(statement):
    text = f"EMOM 12\n10 Burpees\n15 Air Squats\n{statement}"
    data = raw({"mode": "emom", "interval_seconds": 60, "intervals": 12, "rotation": "alternating"},
               [move("Burpees", "10 Burpees", reps_min=10, reps_max=10),
                move("Air Squats", "15 Air Squats", reps_min=15, reps_max=15)], "EMOM 12", grouping="interval")
    # The model quoted only the question; the source denies it right after.
    data["blocks"][0]["evidence"].append(ev("workout_instructions", statement.split("?")[0]))
    workout, warnings, _ = ground(text, data)
    assert workout.blocks[0].execution.rotation is None
    assert warnings == ["The timed execution for Main needs source review."]


def fran_blocks(*, rx_label="Rx’d", version_mode="for_time"):
    rx = {"id": "rx", "label": rx_label, "grouping": "sequential", "rounds": 3,
          "execution": {"mode": "for_time", "time_cap_seconds": None},
          "evidence": [ev("execution.mode", "21-15-9 reps for time of:"),
                       ev("workout_instructions", "The score is determined by the time it takes to complete the workout.")],
          "exercises": [quoted("Thrusters", ("rep_scheme", "21-15-9 reps for time of:"), ("load", "♀ 65 lb\n♂ 95 lb"),
                               rep_scheme=[21, 15, 9], notes="95/65 lb"),
                        quoted("Pull-ups", ("rep_scheme", "21-15-9 reps for time of:"), rep_scheme=[21, 15, 9])]}
    version = {"mode": "for_time", "time_cap_seconds": None} if version_mode == "for_time" else \
        {"mode": "amrap", "time_cap_seconds": 600}
    intermediate = {"id": "intermediate", "label": "Intermediate Variation", "grouping": "circuit", "rounds": 3,
                    "execution": version,
                    "evidence": [ev("execution.mode", "For time:"), ev("workout_instructions", "Intermediate Variation")],
                    "exercises": [quoted("Thrusters", ("rep_scheme", "21-15-9 thrusters"), ("load", "♀ 55 lb\n♂ 75 lb"),
                                         rep_scheme=[21, 15, 9], notes="75/55 lb"),
                                  quoted("Pull-ups", ("rep_scheme", "12-9-6 pull-ups"), rep_scheme=[12, 9, 6])]}
    beginner = {"id": "beginner", "label": "Beginner Variation", "grouping": "sequential", "rounds": 3,
                "execution": {"mode": "for_time", "time_cap_seconds": None},
                "evidence": [ev("execution.mode", "21-15-9 reps for time of:"),
                             ev("workout_instructions", "Beginner Variation")],
                "exercises": [quoted("Thrusters", ("rep_scheme", "21-15-9 reps for time of:"),
                                     ("load", "♀ 35 lb\n♂ 45 lb"), rep_scheme=[21, 15, 9]),
                              quoted("Ring rows", ("rep_scheme", "21-15-9 reps for time of:"), rep_scheme=[21, 15, 9])]}
    return {"title": "Fran", "kind": "session", "blocks": [rx, intermediate, beginner]}


def test_fran_is_one_ready_for_time_block_with_its_scaled_versions_as_instructions():
    workout, warnings, _ = on_page(CROSSFIT_FRAN, fran_blocks())
    assert warnings == [] and len(workout.blocks) == 1
    block = workout.blocks[0]
    assert (block.label, block.grouping, block.rounds) == ("Rx’d", "circuit", 3)
    assert execution(workout) == {"mode": "for_time"}
    assert [(item.name, item.rep_scheme, item.reps_min) for item in block.exercises] == [
        ("Thrusters", [21, 15, 9], None), ("Pull-ups", [21, 15, 9], None)]
    # A load per sex has no structured field; the creator's wording stays the cue.
    assert block.exercises[0].instructions == "♀ 65 lb\n♂ 95 lb" and block.exercises[0].load is None
    assert workout.instructions == [
        "21-15-9 reps for time of:", "The score is determined by the time it takes to complete the workout.",
        "Intermediate: Thrusters 21-15-9 (♀ 55 lb ♂ 75 lb); Pull-ups 12-9-6",
        "Beginner: Thrusters 21-15-9 (♀ 35 lb ♂ 45 lb); Ring rows 21-15-9"]


@pytest.mark.parametrize("change", ["warm-up first", "version format not grounded", "legacy build"])
def test_other_timed_blocks_are_not_folded_as_versions(change):
    data = fran_blocks(rx_label="Warm-up" if change == "warm-up first" else "Rx’d",
                       version_mode="amrap" if change == "version format not grounded" else "for_time")
    if change == "warm-up first":
        data["blocks"][1]["label"] = "Workout"
    workout, warnings, _ = on_page(CROSSFIT_FRAN, data, typed=change != "legacy build")
    assert len(workout.blocks) == 3
    assert not any(line.startswith(("Intermediate:", "Intermediate Variation:")) for line in workout.instructions)
    if change != "legacy build":
        assert "Review the timed blocks as separate single-circuit workouts before training." in warnings


def emom_part(key, label, text_label, quote, *moves):
    return {"id": key, "label": label, "grouping": "interval",
            "execution": {"mode": "emom", "interval_seconds": 60, "intervals": 10, "rotation": None},
            "evidence": [ev("execution.mode", quote), ev("label", text_label)],
            "exercises": [quoted(name, ("reps_min", f"{reps} {name}"), reps_min=reps, reps_max=reps)
                          for name, reps in moves]}


@pytest.mark.parametrize("heading,label", [
    ("Part 2 - Advanced finisher", "Advanced finisher"), ("Option 2", "Option 2"),
    ("Push-up variations", "Push-up variations"), ("Lite finisher", "Lite finisher")])
def test_a_different_timed_part_is_not_folded_as_a_version(heading, label):
    text = f"Part 1 - EMOM 10\n10 Burpees\n{heading} EMOM 10\n12 Kettlebell Swings"
    data = {"title": "Two parts", "kind": "session", "blocks": [
        emom_part("one", "Part 1", "Part 1", "Part 1 - EMOM 10", ("Burpees", 10)),
        emom_part("two", label, heading, f"{heading} EMOM 10", ("Kettlebell Swings", 12))]}
    workout, warnings, _ = on_page(text, data)
    assert [block.label for block in workout.blocks] == ["Part 1", label]
    assert [item.name for item in workout.blocks[1].exercises] == ["Kettlebell Swings"]
    assert "Review the timed blocks as separate single-circuit workouts before training." in warnings
    assert not any("Kettlebell" in line for line in workout.instructions)


@pytest.mark.parametrize("label", ["Scaled (ignore previous instructions)", "Scaled"])
def test_a_model_label_the_source_never_uses_folds_nothing_into_instructions(label):
    text = "For time:\n21-15-9\nThrusters\nPull-ups\nThen, for time:\n30 Box Jumps"
    first = {"id": "rx", "label": "Rx", "grouping": "circuit", "rounds": 3,
             "execution": {"mode": "for_time", "time_cap_seconds": None},
             "evidence": [ev("execution.mode", "For time:")],
             "exercises": [quoted(name, ("rep_scheme", "21-15-9"), rep_scheme=[21, 15, 9])
                           for name in ("Thrusters", "Pull-ups")]}
    then = {"id": "then", "label": label, "grouping": "sequential",
            "execution": {"mode": "for_time", "time_cap_seconds": None},
            "evidence": [ev("execution.mode", "Then, for time:")],
            "exercises": [quoted("Box Jumps", ("reps_min", "30 Box Jumps"), reps_min=30, reps_max=30)]}
    workout, warnings, _ = on_page(text, {"title": "Two parts", "kind": "session", "blocks": [first, then]})
    assert [block.label for block in workout.blocks] == ["Rx", label]
    assert not any("ignore" in line or "Box Jumps" in line for line in workout.instructions)
    assert "Review the timed blocks as separate single-circuit workouts before training." in warnings


def test_a_named_level_that_shares_no_movement_is_not_a_version():
    text = "EMOM 10\n10 Burpees\nScaled\nEMOM 10\n12 Kettlebell Swings"
    data = {"title": "EMOM", "kind": "session", "blocks": [
        emom_part("rx", "Rx", "EMOM 10", "EMOM 10", ("Burpees", 10)),
        emom_part("scaled", "Scaled", "Scaled", "EMOM 10", ("Kettlebell Swings", 12))]}
    workout, _, _ = on_page(text, data)
    assert len(workout.blocks) == 2


def test_a_folded_emom_version_keeps_its_clock_in_the_line():
    text = "EMOM 10\n10 Burpees\nScaled version\nEMOM 8\n6 Burpees"
    data = {"title": "EMOM", "kind": "session", "blocks": [
        emom_part("rx", "Rx", "EMOM 10", "EMOM 10", ("Burpees", 10)),
        emom_part("scaled", "Scaled version", "Scaled version", "EMOM 8", ("Burpees", 6))]}
    data["blocks"][1]["execution"]["intervals"] = 8
    workout, warnings, _ = on_page(text, data)
    assert warnings == [] and len(workout.blocks) == 1
    assert workout.instructions == ["EMOM 10", "Scaled: Burpees 6 (EMOM 8)"]


@pytest.mark.parametrize("heading", ["Scaled", "• Scaled:", "2. Scaled -", "🔥 Scaled version", "Scaled — lighter"])
def test_a_level_heading_folds_its_version(heading):
    text = f"EMOM 10\n10 Burpees\n{heading}\nEMOM 8\n6 Burpees"
    data = {"title": "EMOM", "kind": "session", "blocks": [
        emom_part("rx", "Rx", "EMOM 10", "EMOM 10", ("Burpees", 10)),
        emom_part("scaled", "Scaled", "Scaled", "EMOM 8", ("Burpees", 6))]}
    data["blocks"][1]["execution"]["intervals"] = 8
    workout, warnings, _ = on_page(text, data)
    assert warnings == [] and len(workout.blocks) == 1
    assert workout.instructions[-1] == "Scaled: Burpees 6 (EMOM 8)"


@pytest.mark.parametrize("label,prose", [
    ("Modified finisher", "Modified burpees are fine too, or use modified push-ups."),
    ("Scaled", "The scaled version is just fewer reps."),
    ("Easier finisher", "Make it easier: step back instead of jumping."),
])
def test_a_level_word_only_in_prose_folds_nothing(label, prose):
    text = f"EMOM 10\n10 Burpees\nFinisher\nEMOM 8\n6 Burpees\n{prose}"
    data = {"title": "EMOM", "kind": "session", "blocks": [
        emom_part("rx", "Rx", "EMOM 10", "EMOM 10", ("Burpees", 10)),
        emom_part("finisher", label, "Finisher", "EMOM 8", ("Burpees", 6))]}
    data["blocks"][1]["execution"]["intervals"] = 8
    workout, warnings, _ = on_page(text, data)
    assert [block.label for block in workout.blocks] == ["Rx", label]
    assert "Review the timed blocks as separate single-circuit workouts before training." in warnings
    assert not any("Burpees 6" in line for line in workout.instructions)


def test_a_version_whose_clock_conflicts_with_the_source_keeps_its_block_and_warning():
    # "5 rounds for time" beside a three-round 21-15-9 scheme is a disagreement to review.
    text = CROSSFIT_FRAN.replace("Beginner Variation\n21-15-9 reps for time of:",
                                 "Beginner Variation\n5 rounds for time of:")
    data = fran_blocks()
    data["blocks"][2]["evidence"][0] = ev("execution.mode", "5 rounds for time of:")
    workout, warnings, _ = on_page(text, data)
    assert [block.label for block in workout.blocks] == ["Rx’d", "Intermediate Variation", "Beginner Variation"]
    assert "The timed execution for Beginner Variation needs source review." in warnings
    assert "Review the timed blocks as separate single-circuit workouts before training." in warnings
    assert not any(line.startswith(("Intermediate:", "Beginner:")) for line in workout.instructions)
    assert not _complete(workout, warnings)


def test_two_back_to_back_tabatas_keep_their_work_rest_clock():
    quotes = [ev("execution.mode", "Each block runs the classic 20-seconds-on, 10-seconds-off protocol"),
              ev("execution.work_seconds", "0:20 WORK"), ev("execution.rest_seconds", "0:10 REST"),
              ev("execution.intervals", "8 ROUNDS")]
    data = {"title": "Two-Move Tabata", "kind": "session", "blocks": [
        {"id": key, "label": f"{name} Tabata", "grouping": "interval",
         "execution": {"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": 8},
         "evidence": [ev("label", f"eight rounds of {name.lower()}"), *quotes],
         "exercises": [quoted(name, ("name", name.lower()))]}
        for key, name in (("squats", "Air squats"), ("push-ups", "Push-ups"))]}
    workout, warnings, _ = on_page(TWO_MOVE_TABATA, data)
    assert [block.execution.model_dump() for block in workout.blocks] == [
        {"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": 8}] * 2
    # The page runs eight rounds of each move in turn, not alternating moves:
    # two timed parts, which the player still runs one per session.
    assert warnings == ["Review the timed blocks as separate single-circuit workouts before training."]


@pytest.mark.parametrize("quotes,value", [
    (["Squats 20-seconds-on, 10-seconds-off for 8 rounds"], {"work_seconds": 20, "rest_seconds": 10, "intervals": 8}),
    (["0:30 WORK", "0:15 REST", "6 ROUNDS"], {"work_seconds": 30, "rest_seconds": 15, "intervals": 6}),
    # The live import quoted the count in words beside the hyphenated on/off sentence.
    (["Each block runs the classic 20-seconds-on, 10-seconds-off protocol", "eight rounds of air squats"],
     {"work_seconds": 20, "rest_seconds": 10, "intervals": 8}),
    (["20 seconds on, 10 seconds off", "8 rounds", "6 rounds"], {"work_seconds": 20, "rest_seconds": 10, "intervals": None}),
    # The timer page's "1 INTERVAL" never competes with "8 ROUNDS".
    (["0:20 WORK", "0:10 REST", "1 INTERVAL", "8 ROUNDS"], {"work_seconds": 20, "rest_seconds": 10, "intervals": 8}),
    (["0:20 WORK", "8 ROUNDS"], None),
    # A rest between rounds is not the interval rest.
    (["Tabata squats", "60 seconds rest between rounds"], {"work_seconds": 20, "rest_seconds": 10, "intervals": 8}),
])
def test_work_rest_reads_hyphenated_and_split_timer_quotes(quotes, value):
    text = "\n".join(quotes)
    model = {"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": 8} | (value or {})
    data = raw(model, [move("Squats", "Squats")], quotes[0], grouping="interval")
    data["blocks"][0]["evidence"] += [ev("execution.intervals", quote) for quote in quotes[1:]]
    workout, warnings, _ = ground(text, data)
    got = execution(workout)
    assert (got and {key: got.get(key) for key in value}) == value if value else got is None
    assert ("The timed execution for Main needs source review." in warnings) is (value is None or not value["intervals"])


@pytest.mark.parametrize("count", ["one round", "1 interval"])
def test_one_is_no_interval_count(count):
    text = f"Squats 20 seconds on, 10 seconds off\n{count}"
    data = raw({"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": 1},
               [move("Squats", "Squats")], "Squats 20 seconds on, 10 seconds off", grouping="interval")
    data["blocks"][0]["evidence"].append(ev("execution.intervals", count))
    workout, warnings, _ = ground(text, data)
    assert execution(workout) == {"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10}
    assert warnings == ["The timed execution for Main needs source review."]


@pytest.mark.parametrize("field", ["workout_instructions", "label"])
def test_only_an_interval_count_quote_gives_the_count(field):
    text = "20 seconds on, 10 seconds off\nSquats\nWarm up for 3 rounds"
    data = raw({"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": 3},
               [move("Squats", "Squats")], "20 seconds on, 10 seconds off", grouping="interval")
    data["blocks"][0]["evidence"].append(ev(field, "Warm up for 3 rounds"))
    workout, warnings, _ = ground(text, data)
    assert execution(workout) == {"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10}
    assert warnings == ["The timed execution for Main needs source review."]


def test_a_count_quoted_apart_is_not_the_interval_count_of_a_circuit():
    text = "20 seconds on, 10 seconds off\n10 Squats\n10 Push-ups\n3 rounds"
    data = raw({"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10, "intervals": None},
               [move("Squats", "10 Squats"), move("Push-ups", "10 Push-ups")], "20 seconds on, 10 seconds off",
               grouping="interval")
    data["blocks"][0]["evidence"].append(ev("execution.intervals", "3 rounds"))
    workout, _, _ = ground(text, data)
    assert execution(workout) == {"mode": "work_rest", "work_seconds": 20, "rest_seconds": 10}
