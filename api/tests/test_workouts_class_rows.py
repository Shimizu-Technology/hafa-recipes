"""Each class movement's printed row supplies its listed sets and per-athlete values.

Rows are synthetic (invented movements and numbers) in a WodUp class layout.
"""

import json

import pytest
from pydantic import ValidationError

from app.domains.workouts.class_extraction import legacy_shape
from app.domains.workouts.extraction import (
    ExtractionRequest,
    SourceBundle,
    SourceMetadata,
    SourcePart,
    ground_workout,
    workout_response_format,
)
from app.domains.workouts.schemas import ExercisePrescription, LoadOption, RelativeLoad
from tests.test_workouts_class_layout import PAGE, ev, model_output, move


def ground(page=PAGE, raw=None, rows=True):
    source = SourceBundle(SourceMetadata(), [SourcePart("provided_text", page)], class_parts=True, class_rows=rows)
    return ground_workout(raw or model_output(), source, class_parts=True)


def one_part(page, *exercises, rows=True, **block):
    return ground(page, {"title": "Class", "kind": "session", "blocks": [
        {"id": "x", "label": page.split("\n")[0][:20], "evidence": [], "exercises": list(exercises), **block}]}, rows)


def test_listed_sets_become_one_exercise_with_reps_and_1rm_percents_per_set():
    workout, warnings, _ = ground()
    a = workout.blocks[0]
    assert a.time_window_seconds == 600 and len(a.exercises) == 1
    squat = a.exercises[0]
    assert squat.sets == 3 and squat.tempo == "30X1"
    assert [(s.reps_min, s.reps_max, s.max_reps) for s in squat.set_prescriptions] == [(5, 5, None), (3, 3, None), (None, None, True)]
    assert [(s.relative_load.percent, s.relative_load.percent_max) for s in squat.set_prescriptions] == [
        (60, 65), (75, None), (85, None)]
    assert not any("reps_min removed from Front Squat" in warning for warning in warnings)


def test_without_the_opt_in_the_older_fields_carry_every_listed_fact():
    workout, _, _ = ground(rows=False)
    a, b, _ = workout.blocks
    squat, bike = a.exercises[0], b.exercises[1]
    assert squat.set_prescriptions is None and a.time_window_seconds is None
    assert a.instructions[0] == "Within 10 minutes"
    assert (squat.sets, squat.reps_min, squat.reps_max) == (3, 3, 5)
    assert squat.effort.endswith("Sets: 5, 3, max reps; ~60-65%, 75%, 85% 1RM")
    assert bike.value_options is None
    assert (bike.duration_seconds, bike.duration_seconds_max) == (8, 10) and "8 s (Men) / 10 s (Women)" in bike.effort


def test_with_the_opt_in_the_older_fields_are_still_filled():
    workout, _, _ = ground(rows=True)
    squat, bike = workout.blocks[0].exercises[0], workout.blocks[1].exercises[1]
    assert (squat.reps_min, squat.reps_max) == (3, 5) and squat.set_prescriptions
    assert (bike.duration_seconds, bike.duration_seconds_max) == (8, 10) and bike.value_options


def test_class_rows_requires_class_parts():
    with pytest.raises(ValidationError):
        ExtractionRequest(kind="text", text="A. 10 Squats", ai_consent=True, class_rows=True)
    assert "class_rows" not in ExtractionRequest(kind="text", text="A", ai_consent=True, class_parts=True).model_dump()


def test_listed_set_ranges_keep_both_ends():
    page = "B. Ring Row (2011 tempo)\nWithin 6 minutes:\nSet 1 – 6-8 reps\nSet 2 – 4-6 reps\nRest 75 seconds between sets"
    workout, _, _ = one_part(page, move("Ring Row", "Ring Row"))
    item = workout.blocks[0].exercises[0]
    assert [(s.reps_min, s.reps_max) for s in item.set_prescriptions] == [(6, 8), (4, 6)]
    assert (item.sets, item.rest_seconds, workout.blocks[0].time_window_seconds) == (2, 75, 360)


def test_per_athlete_seconds_come_from_the_row_and_their_labels_from_the_notes():
    workout, _, _ = ground()
    bike = workout.blocks[1].exercises[1]
    assert [(o.quantity, o.value, o.unit, o.label) for o in bike.value_options] == [
        ("duration_seconds", 8, "s", "Men"), ("duration_seconds", 10, "s", "Women")]
    assert (workout.blocks[1].exercises[0].reps_min, workout.blocks[1].exercises[0].reps_max) == (8, 12)


@pytest.mark.parametrize("row,name,expected", [
    ("12-16 Step-Ups 20/16 inches", "Step-Ups", {"reps": (12, 16), "height": [20, 16]}),
    ("Max Slam Ball Jump Overs 36/30 inches", "Slam Ball Jump Overs", {"effort": "Max", "height": [36, 30]}),
    ("Echo Bike 8-12 calories", "Echo Bike", {"calories": (8, 12), "reps": (None, None)}),
    ("SkiErg Max calories", "SkiErg", {"effort": "Max calories"}),
    ("Sled Push Max Distance", "Sled Push", {"effort": "Max distance"}),
    ("8-10 Band Face Pulls (2011 tempo)", "Band Face Pulls", {"reps": (8, 10), "tempo": "2011"}),
    ("12 Kettlebell Swings @ 24/16 kg", "Kettlebell Swings", {"reps": (12, 12), "loads": [(24, "kg"), (16, "kg")]}),
    ("8-10 45 Degree Dumbbell Rows", "45 Degree Dumbbell Rows", {"reps": (8, 10)}),
    ("15 Degree Incline Bench Press", "15 Degree Incline Bench Press", {"reps": (None, None)}),
])
def test_a_movement_row_supplies_its_own_dose(row, name, expected):
    item = move(name, row)
    if name == "Sled Push":
        item.update(effort="Max", evidence=[ev("name", name), ev("effort", "Max")])
    if name == "Kettlebell Swings":
        item.update(reps_min=12, evidence=[ev("name", name), ev("reps_min", row)])
    if name == "Echo Bike":
        item.update(reps_min=8, reps_max=12, evidence=[ev("name", name), ev("reps_min", row), ev("reps_max", row)])
    workout, _, _ = one_part(f"A. Every minute for 8 minutes:\n{row}", item)
    got = workout.blocks[0].exercises[0]
    if "reps" in expected:
        assert (got.reps_min, got.reps_max) == expected["reps"]
    if "height" in expected:
        assert [(o.quantity, o.value, o.unit) for o in got.value_options] == [("height", v, "in") for v in expected["height"]]
    if "calories" in expected:
        assert (got.calories_min, got.calories) == expected["calories"]
    if "effort" in expected:
        assert got.effort.split(";")[0] == expected["effort"]
    if "tempo" in expected:
        assert got.tempo == expected["tempo"]
    if "loads" in expected:
        assert [(o.load, o.load_unit) for o in got.load_options] == expected["loads"]


def test_a_box_height_never_wipes_a_real_load_on_the_same_row():
    row = "10 Dumbbell Box Step-Overs @ 50/35 lb 20/16 inches"
    item = move("Dumbbell Box Step-Overs", row)
    item["load_options"] = [{"load": 50, "load_unit": "lb"}, {"load": 35, "load_unit": "lb"}]
    item["evidence"].append(ev("load_options", "@ 50/35 lb"))
    workout, warnings, _ = one_part(f"A. For Time:\n{row}", item)
    got = workout.blocks[0].exercises[0]
    assert [o.load for o in got.load_options] == [50, 35] and [o.value for o in got.value_options] == [20, 16]
    misread = move("Step-Ups", "16 Step-Ups 24/20 inches")
    misread["load_options"] = [{"load": 24, "load_unit": "lb"}, {"load": 20, "load_unit": "lb"}]
    misread["evidence"].append(ev("load_options", "24/20"))
    workout, warnings, _ = one_part("A. For Time:\n16 Step-Ups 24/20 inches", misread)
    assert workout.blocks[0].exercises[0].load_options is None
    assert any("Step-Ups" in warning and "load" in warning for warning in warnings)


def test_rep_ranges_and_run_distance_notes():
    page = ("A. As Many Rounds and Reps as possible in 11 minutes, with Buy In:\nBuy In:\nRow 750 meters\nThen AMRAP:\n"
            "4 Wall Climbs\nRow 250 meters\n- REP RANGES\n2-4 wall climbs\n- ROW DISTANCE\n600-750m\n200-250m")
    workout, _, _ = one_part(page, move("Row", "Row 750 meters"), move("Wall Climbs", "4 Wall Climbs", reps_min=2),
                             move("Row", "Row 250 meters"))
    first, climbs, last = workout.blocks[0].exercises
    assert [(item.distance_meters_min, item.distance_meters) for item in (first, last)] == [(600, 750), (200, 250)]
    assert (climbs.reps_min, climbs.reps_max) == (2, 4)


def test_load_recommendations_go_to_the_loaded_movement_and_leave_other_loads():
    page = ("C. Every minute for 8 minutes:\n8 Dual Kettlebell Cleans\nMax Ring Dips\n15 Wall Balls @ 20/14 lb\n"
            "- Keep the kettlebell cleans crisp\n- Load recommendations:\nMen: 12-16kg\nWomen: 8-12kg")
    dips = move("Ring Dips", "Max Ring Dips")
    dips["load_options"] = [{"load": 12, "load_unit": "kg"}, {"load": 8, "load_unit": "kg"}]
    balls = move("Wall Balls", "15 Wall Balls @ 20/14 lb", reps_min=15, reps_max=15)
    balls["load_options"] = [{"load": 20, "load_unit": "lb"}, {"load": 14, "load_unit": "lb"}]
    balls["evidence"].append(ev("load_options", "@ 20/14 lb"))
    workout, warnings, _ = one_part(page, move("Dual Kettlebell Cleans", "8 Dual Kettlebell Cleans"), dips, balls)
    cleans, ring_dips, wall_balls = workout.blocks[0].exercises
    assert [(o.load, o.load_max, o.load_unit, o.label) for o in cleans.load_options] == [
        (12, 16, "kg", "Men"), (8, 12, "kg", "Women")]
    assert ring_dips.load_options is None and ring_dips.effort.startswith("Max")
    assert [o.load for o in wall_balls.load_options] == [20, 14]
    assert any("Ring Dips" in warning and "load" in warning.lower() for warning in warnings)
    plain, _, _ = one_part(page, move("Dual Kettlebell Cleans", "8 Dual Kettlebell Cleans"), rows=False)
    assert plain.blocks[0].exercises[0].load_options is None
    assert "Men 12-16 kg / Women 8-12 kg" in plain.blocks[0].exercises[0].effort


def test_a_rest_then_the_next_part_is_a_rest_between_parts():
    page = "A. Split Squat\n4 sets of 8 reps\nRest 3 minutes, then go to B\nB. 20 Sit-Ups"
    raw = {"title": "Class", "kind": "session", "blocks": [
        {"id": "a", "label": "A", "evidence": [], "exercises": [move("Split Squat", "Split Squat")]},
        {"id": "b", "label": "B", "evidence": [], "exercises": [move("Sit-Ups", "20 Sit-Ups")]}]}
    workout, _, _ = ground(page, raw)
    a = workout.blocks[0]
    assert a.exercises[0].rest_seconds is None and a.rest_after_seconds == 180


def test_new_class_values_validate_and_stay_out_of_the_model_and_older_clients():
    with pytest.raises(ValidationError):
        LoadOption(load=20, load_max=15, load_unit="kg")
    with pytest.raises(ValidationError):
        RelativeLoad(basis="one_rep_max", percent=70, percent_max=60)
    with pytest.raises(ValidationError):
        ExercisePrescription(name="Bike", calories=10, calories_min=16)
    schema = json.dumps(workout_response_format())
    assert not any(key in schema for key in ("set_prescriptions", "value_options", "calories_min", "time_window_seconds",
                                             "load_max", "percent_max"))
    workout, _, _ = ground()
    legacy = legacy_shape(workout.model_dump(mode="json"))
    assert not any(key in json.dumps(legacy) for key in ("set_prescriptions", "value_options", "time_window_seconds"))
    plain = ExercisePrescription(name="Squat").model_dump(mode="json")
    assert not any(key in plain for key in ("set_prescriptions", "value_options", "calories", "calories_min"))


def test_the_page_marks_the_buy_in_and_a_borrowed_distance_is_removed():
    page = ("A. As Many Rounds and Reps as possible in 11 minutes, with Buy In:\nBuy In:\nRow 750 meters\nThen AMRAP:\n"
            "12 Kettlebell Swings @ 24/16 kg\nRow 250 meters")
    swings = move("Kettlebell Swings", "12 Kettlebell Swings @ 24/16 kg")
    swings.update(distance_meters=250, evidence=swings["evidence"] + [ev("distance_meters", "Row 250 meters")])
    workout, warnings, _ = one_part(
        page, move("Row", "Row 750 meters"), swings, move("Row", "Row 250 meters"),
        execution={"mode": "amrap", "time_cap_seconds": 660},
        evidence=[ev("execution.mode", "As Many Rounds and Reps as possible in 11 minutes"),
                  ev("execution.time_cap_seconds", "As Many Rounds and Reps as possible in 11 minutes")])
    first, kettlebell, last = workout.blocks[0].exercises
    assert (first.segment, kettlebell.segment, last.segment) == ("buy_in", None, None)
    assert kettlebell.distance_meters is None and "A distance from another row was removed from Kettlebell Swings." in warnings


@pytest.mark.parametrize("row", ["15 Deadlifts @ 75%", "15 Deadlifts @ 75% 1RM",
                                  "15 Deadlifts @ 0% BW", "15 Deadlifts @ 301% bodyweight"])
def test_bodyweight_recovery_requires_an_explicit_valid_basis_and_percent(row):
    workout, _, _ = one_part(f"A. For Time:\n{row}", move("Deadlifts", row))
    assert workout.blocks[0].exercises[0].relative_load is None


@pytest.mark.parametrize("load", ["@ 75% BW", "75% bodyweight"])
def test_bodyweight_load_is_also_restored_when_the_provider_omits_the_entire_part(load):
    workout, _, _ = ground(f"A. For Time:\n15 Deadlifts {load}",
                           {"title": "Class", "kind": "session", "blocks": []})
    item = workout.blocks[0].exercises[0]
    assert item.name == "Deadlifts"
    assert item.relative_load == RelativeLoad(basis="bodyweight", percent=75)


def test_bodyweight_recovery_keeps_an_already_grounded_relative_load():
    row = "15 Deadlifts @ 75% bodyweight"
    workout, _, _ = one_part(f"A. For Time:\n{row}", move(
        "Deadlifts", row, relative_load={"basis": "bodyweight", "percent": 75}))
    assert workout.blocks[0].exercises[0].relative_load == RelativeLoad(basis="bodyweight", percent=75)
