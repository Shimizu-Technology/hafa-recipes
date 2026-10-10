"""Independent behavioral cases for the proposed general-fitness domain engine."""

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app.domains.workouts.catalog import EXERCISES, compatible, find_alternative
from app.domains.workouts.programming import (
    RUNNING_STAGES,
    adapt_workout,
    build_program,
    evaluate_progression,
    evaluate_running_progression,
    moderate_equivalent_minutes,
)
from app.domains.workouts.schemas import (
    ActivityContext,
    CompletedExposure,
    Evidence,
    ExercisePrescription,
    RunningBaseline,
    RunningStageResult,
    TrainingProfile,
    WorkoutBlock,
    WorkoutContent,
)

START = date(2026, 10, 12)  # Monday, supplied explicitly; never dependent on today.


def profile(**changes):
    values = dict(
        adult_confirmed=True,
        equipment=[],
        available_days=[0, 2, 4],
        session_minutes=30,
        readiness="ready",
    )
    values.update(changes)
    return TrainingProfile(**values)


def items(proposal):
    return [
        item
        for session in proposal.sessions
        for block in session.workout.blocks
        for item in block.exercises
    ]


def prescription():
    return ExercisePrescription(
        exercise_id="goblet_squat",
        name="Goblet squat",
        sets=2,
        reps_min=8,
        reps_max=12,
        load=20,
        load_unit="kg",
        load_convention="total",
    )


def exposure(day=0, **changes):
    values = dict(
        session_id=f"session-{day}",
        date=START + timedelta(days=day),
        exercise_id="goblet_squat",
        reps=[12, 12],
        load=20,
        load_unit="kg",
        load_convention="total",
        completed=True,
        difficulty="manageable",
        pain_reported=False,
    )
    values.update(changes)
    return CompletedExposure(**values)


def source_workout():
    return WorkoutContent(
        id="source-1",
        title="Creator circuit",
        provenance="source",
        estimated_minutes=20,
        blocks=[
            WorkoutBlock(
                id="circuit",
                label="Three rounds",
                grouping="circuit",
                rounds=3,
                exercises=[
                    ExercisePrescription(
                        exercise_id="goblet_squat",
                        name="Goblet squat",
                        provenance="source",
                        reps_min=8,
                        reps_max=12,
                        load=40,
                        load_unit="kg",
                        load_convention="total",
                        evidence=[
                            Evidence(field="load", wording="40 kg"),
                            Evidence(field="reps_min", wording="8–12 reps"),
                        ],
                    )
                ],
            )
        ],
    )


def test_g01_adult_confirmation_required():
    result = build_program(profile(adult_confirmed=False), START)
    assert result.status == "needs_information" and not result.sessions


def test_g02_optional_measurements_not_required():
    result = build_program(profile(), START)
    assert result.status == "ready" and result.sessions
    assert len(result.sessions) == 12
    assert any("150-minute" in warning for warning in result.warnings)


def test_g03_unknown_equipment_is_not_none_equipment():
    assert build_program(profile(equipment=None), START).status == "needs_information"
    assert build_program(profile(equipment=[]), START).status == "ready"


def test_g04_home_equipment_and_honest_coverage():
    result = build_program(profile(primary_goal="strength"), START)
    assert all(
        item.exercise_id not in ("goblet_squat", "dumbbell_row", "band_row")
        for item in items(result)
    )
    assert any("pull" in warning for warning in result.warnings)


def test_g05_adjacent_days_cannot_silently_satisfy_two_strength_days():
    result = build_program(profile(primary_goal="strength", available_days=[0, 1]), START, 1)
    assert result.status == "conflicts"
    assert [session.date for session in result.sessions] == [START]


def test_g06_nonadjacent_strength_and_deterministic_ids():
    p = profile(primary_goal="strength", available_days=[0, 3])
    first, second = build_program(p, START, 2), build_program(p, START, 2)
    assert first == second and len(first.sessions) == 4
    assert len({session.id for session in first.sessions}) == 4


def test_g07_missing_running_baseline():
    assert build_program(profile(primary_goal="running"), START).status == "needs_information"


def test_g08_novice_run_recovery_and_exact_duration():
    result = build_program(
        profile(
            primary_goal="running",
            running_baseline=RunningBaseline(
                novice_start_confirmed=True, comfortable_walk_minutes=20
            ),
        ),
        START,
        1,
    )
    assert result.status == "ready" and len(result.sessions) == 3
    first = result.sessions[0].workout
    assert first.estimated_minutes == 22
    assert first.blocks[1].rounds == 6
    assert [item.duration_seconds for item in first.blocks[1].exercises] == [30, 90]
    assert all((b.date - a.date).days >= 2 for a, b in zip(result.sessions, result.sessions[1:]))


def test_g09_adjacent_running_availability_reduces_frequency():
    result = build_program(
        profile(
            primary_goal="running",
            available_days=[0, 1, 2],
            running_baseline=RunningBaseline(
                novice_start_confirmed=True, comfortable_walk_minutes=20
            ),
        ),
        START,
        1,
    )
    assert [session.date for session in result.sessions] == [START, START + timedelta(days=2)]


def test_g10_running_time_cap_preserves_recovery():
    result = build_program(
        profile(
            primary_goal="running",
            session_minutes=15,
            running_baseline=RunningBaseline(
                novice_start_confirmed=True, comfortable_walk_minutes=20
            ),
        ),
        START,
        1,
    )
    workout = result.sessions[0].workout
    assert workout.estimated_minutes == 14
    assert workout.blocks[1].rounds == 2
    assert workout.blocks[0].exercises[0].duration_seconds == 300
    assert workout.blocks[-1].exercises[0].duration_seconds == 300


def test_g11_established_running_does_not_fabricate_a_pace():
    result = build_program(
        profile(
            primary_goal="running",
            running_baseline=RunningBaseline(
                comfortable_run_minutes=20, recent_weekly_minutes=60, recent_runs_per_week=3
            ),
        ),
        START,
        1,
    )
    assert all(
        session.workout.blocks[1].exercises[0].duration_seconds == 1200
        for session in result.sessions
    )
    assert all(
        "pace" in session.workout.blocks[1].exercises[0].effort for session in result.sessions
    )


def test_g12_start_dates_no_missed_session_stacking():
    result = build_program(profile(primary_goal="strength"), START + timedelta(days=2), 2)
    assert all(session.date >= START + timedelta(days=2) for session in result.sessions)
    assert len({session.date for session in result.sessions}) == len(result.sessions)


def test_g13_other_activity_blocks_extra_work_and_adjacent_athletic_strength():
    game = START + timedelta(days=2)
    result = build_program(
        profile(
            primary_goal="athletic_conditioning",
            available_days=list(range(7)),
            other_activities=[ActivityContext(date=game, name="Basketball", strenuous=True)],
        ),
        START,
        1,
    )
    assert all(session.date != game for session in result.sessions)
    assert all(
        abs((session.date - game).days) > 1
        for session in result.sessions
        if session.workout.blocks[0].id == "strength"
    )


def test_g14_explicit_exclusions_honored():
    result = build_program(profile(movement_exclusions=["knee_flexion"]), START, 1)
    assert all("knee_flexion" not in EXERCISES[item.exercise_id].tags for item in items(result))


def test_g15_medical_text_not_reinterpreted_as_clearance():
    result = build_program(profile(limitations=["Doctor said be careful with my knee"]), START)
    assert result.status == "needs_information" and not result.sessions


def test_g16_one_exposure_does_not_progress():
    assert (
        evaluate_progression(
            prescription(),
            [exposure()],
            profile(equipment=["dumbbell"], available_loads_kg=[20, 20.5]),
        ).action
        == "hold"
    )


def test_g17_smallest_available_load_proposed_with_no_mutation():
    original = prescription()
    actuals = [exposure(), exposure(3)]
    snapshot = [item.model_dump() for item in actuals]
    result = evaluate_progression(
        original, actuals, profile(equipment=["dumbbell"], available_loads_kg=[20, 20.5, 21])
    )
    assert result.action == "increase_load" and result.suggested_load == 20.5
    assert original.load == 20 and snapshot == [item.model_dump() for item in actuals]


def test_g18_large_available_jump_held():
    assert (
        evaluate_progression(
            prescription(),
            [exposure(), exposure(3)],
            profile(equipment=["dumbbell"], available_loads_kg=[20, 25]),
        ).action
        == "hold"
    )


@pytest.mark.parametrize(
    "change",
    [
        {"completed": False},
        {"difficulty": None},
        {"pain_reported": None},
        {"pain_reported": True},
        {"reps": [12]},
        {"reps": [12, 11]},
        {"load_convention": "per_hand"},
    ],
)
def test_g19_partial_missing_or_incomparable_feedback_holds(change):
    assert (
        evaluate_progression(
            prescription(),
            [exposure(), exposure(3, **change)],
            profile(equipment=["dumbbell"], available_loads_kg=[20, 20.5]),
        ).action
        == "hold"
    )


def test_g20_body_composition_does_not_infer_weight_outcome():
    result = build_program(
        profile(
            primary_goal="body_composition", body_composition_priority="fat_loss", weight_kg=90
        ),
        START,
        1,
    )
    assert result.status == "ready" and "cdc-weight" in result.source_ids
    assert any("no calorie deficit" in warning for warning in result.warnings)


def test_g21_older_adult_balance_coverage():
    result = build_program(profile(age_years=70, equipment=["stable_support"]), START, 1)
    assert "supported_balance" in [item.exercise_id for item in items(result)]
    assert "cdc-older" in result.source_ids
    missing = build_program(profile(age_years=70), START, 1)
    assert any("balance" in warning for warning in missing.warnings)


def test_g22_rounds_do_not_become_sets():
    original = source_workout()
    result = adapt_workout(original, profile(equipment=["dumbbell"]))
    assert result.status == "ready"
    assert result.workout.blocks[0].rounds == 3
    assert result.workout.blocks[0].exercises[0].sets is None


def test_g23_source_load_not_personal_load():
    original = source_workout()
    snapshot = original.model_dump()
    result = adapt_workout(original, profile(equipment=["dumbbell"]))
    assert result.workout.blocks[0].exercises[0].load is None
    assert original.blocks[0].exercises[0].load == 40
    assert original.model_dump() == snapshot
    assert all(
        evidence.field != "load" for evidence in result.workout.blocks[0].exercises[0].evidence
    )


def test_g24_adapted_version_does_not_mutate_source():
    original = source_workout()
    result = adapt_workout(original, profile())
    assert result.status == "ready"
    assert result.workout.parent_version_id == original.id
    assert result.workout.id != original.id and result.workout.version == 2
    assert result.workout.blocks[0].exercises[0].exercise_id == "bodyweight_squat"
    assert original.blocks[0].exercises[0].exercise_id == "goblet_squat"


def test_g25_duplicate_exposures_not_counted_twice():
    p = profile(equipment=["dumbbell"], available_loads_kg=[20, 20.5])
    assert evaluate_progression(prescription(), [exposure(), exposure()], p).action == "hold"
    assert (
        evaluate_progression(
            prescription(), [exposure(), exposure(3), exposure(3, reps=[8, 8])], p
        ).action
        == "hold"
    )


def test_g26_rehabilitation_request_cannot_be_cleared():
    assert (
        build_program(
            profile(limitations=["Create a rehabilitation plan after surgery"]), START
        ).status
        == "needs_information"
    )


def test_g27_event_specific_plan_not_claimed():
    result = build_program(
        profile(
            primary_goal="running",
            running_baseline=RunningBaseline(
                novice_start_confirmed=True, comfortable_walk_minutes=20, event_distance_km=42.195
            ),
        ),
        START,
        1,
    )
    assert result.status == "unsupported" and result.sessions
    assert any("event-specific" in warning for warning in result.warnings)


def test_g28_moderate_equivalent_not_a_training_load_score():
    assert moderate_equivalent_minutes(60, 30) == 120
    with pytest.raises(ValueError):
        moderate_equivalent_minutes(-1, 0)
    with pytest.raises(ValueError):
        moderate_equivalent_minutes(float("nan"), 0)


@pytest.mark.parametrize(
    "goal,extra",
    [
        ("general_fitness", {}),
        ("strength", {}),
        ("body_composition", {"body_composition_priority": "maintain"}),
        (
            "running",
            {
                "running_baseline": RunningBaseline(
                    novice_start_confirmed=True, comfortable_walk_minutes=20
                )
            },
        ),
        ("athletic_conditioning", {"activity_focus": "Basketball"}),
    ],
)
def test_all_five_families_roundtrip_and_use_declared_time(goal, extra):
    p = profile(primary_goal=goal, **extra)
    snapshot = p.model_dump()
    result = build_program(p, START)
    assert result.status == "ready" and result.sessions
    assert type(result).model_validate_json(result.model_dump_json()) == result
    assert p.model_dump() == snapshot
    assert all(
        session.workout.estimated_minutes <= p.session_minutes for session in result.sessions
    )


def test_no_wall_clock_advance_running_stages():
    result = build_program(
        profile(
            primary_goal="running",
            running_baseline=RunningBaseline(
                novice_start_confirmed=True, comfortable_walk_minutes=20
            ),
        ),
        START,
        4,
    )
    assert all(
        session.workout.blocks[1].exercises[0].duration_seconds == 30 for session in result.sessions
    )


def test_running_progression_requires_three_distinct_comfortable_exposures():
    p = profile(
        primary_goal="running",
        running_baseline=RunningBaseline(novice_start_confirmed=True, comfortable_walk_minutes=20),
    )
    results = [
        RunningStageResult(
            session_id=str(day),
            date=START + timedelta(days=day),
            stage=0,
            completed=True,
            comfortable=True,
            pain_reported=False,
        )
        for day in (0, 2, 4)
    ]
    assert evaluate_running_progression(0, results[:2], p).action == "repeat_stage"
    assert evaluate_running_progression(0, results, p).suggested_stage == 1
    next_p = p.model_copy(
        update={"running_baseline": p.running_baseline.model_copy(update={"accepted_stage": 1})}
    )
    assert (
        build_program(next_p, START, 1).sessions[0].workout.blocks[1].exercises[0].duration_seconds
        == RUNNING_STAGES[1][0]
    )
    same_day = [item.model_copy(update={"date": START}) for item in results]
    assert evaluate_running_progression(0, same_day, p).action == "repeat_stage"
    assert evaluate_running_progression(0, results, profile()).action == "repeat_stage"
    excluded = p.model_copy(update={"movement_exclusions": ["impact"]})
    assert evaluate_running_progression(0, results, excluded).action == "repeat_stage"


def test_unknown_movement_and_missing_sets_remain_reviewable():
    content = WorkoutContent(
        title="Incomplete",
        provenance="source",
        blocks=[
            WorkoutBlock(
                id="1", label="Source", exercises=[ExercisePrescription(name="Mystery movement")]
            )
        ],
    )
    assert adapt_workout(content, profile()).status == "needs_information"
    content.blocks[0].exercises[0] = ExercisePrescription(
        exercise_id="bodyweight_squat", name="Squat", reps_min=8
    )
    assert adapt_workout(content, profile()).status == "needs_information"


def test_shortening_does_not_infer_reps_from_minutes():
    original = source_workout()
    result = adapt_workout(original, profile(equipment=["dumbbell"]), 10)
    assert result.status == "needs_information" and result.workout is None


def test_substitutions_need_actual_supports_and_same_purpose():
    assert find_alternative(EXERCISES["dumbbell_row"], ["band"], []) is None
    assert compatible(EXERCISES["band_row"], ["band", "secure_anchor"], [])
    assert find_alternative(EXERCISES["goblet_squat"], [], ["knee_flexion"]) is None


@pytest.mark.parametrize(
    "changes",
    [
        {"available_days": [7]},
        {"available_days": [0, 0]},
        {"timezone": "Not/AZone"},
        {"weight_kg": 0},
        {"age_years": 17},
        {"available_loads_kg": [-1]},
    ],
)
def test_invalid_profile_rejected(changes):
    with pytest.raises(ValidationError):
        profile(**changes)


def test_assisted_weight_not_increased_as_resistance():
    item = prescription().model_copy(update={"load_convention": "assistance"})
    assert (
        evaluate_progression(
            item,
            [exposure(), exposure(3)],
            profile(equipment=["dumbbell"], available_loads_kg=[20, 20.5]),
        ).action
        == "hold"
    )


def test_exclusion_can_prevent_whole_run_without_other_mutation():
    p = profile(
        primary_goal="running",
        movement_exclusions=["impact"],
        running_baseline=RunningBaseline(novice_start_confirmed=True, comfortable_walk_minutes=20),
    )
    result = build_program(p, START)
    assert result.status == "conflicts" and not result.sessions


def test_unrecognized_exclusions_not_silently_ignored():
    p = profile(movement_exclusions=["doctor said no squats"])
    assert build_program(p, START).status == "needs_information"
    assert adapt_workout(source_workout(), p).status == "needs_information"


def test_missing_dose_requires_question_without_invention():
    content = WorkoutContent(
        title="Incomplete squat",
        blocks=[
            WorkoutBlock(
                id="main",
                label="Main",
                exercises=[
                    ExercisePrescription(exercise_id="bodyweight_squat", name="Squat", sets=2)
                ],
            )
        ],
    )
    assert adapt_workout(content, profile()).status == "needs_information"


@pytest.mark.parametrize("timezone", ["America", "a" * 300, ""])
def test_directory_and_oversized_timezone_are_validation_errors(timezone):
    with pytest.raises(ValidationError):
        profile(timezone=timezone)


@pytest.mark.parametrize("stage,minutes", [(0, 12), (5, 15), (7, 22), (8, 30)])
def test_running_conflict_reports_current_stage_minimum(stage, minutes):
    result = build_program(
        profile(
            primary_goal="running",
            session_minutes=minutes - 1,
            running_baseline=RunningBaseline(
                novice_start_confirmed=True, comfortable_walk_minutes=20, accepted_stage=stage
            ),
        ),
        START,
        1,
    )
    assert result.status == "conflicts"
    assert any(f"At least {minutes} minutes" in warning for warning in result.warnings)


@pytest.mark.parametrize("stage", range(9))
def test_all_accepted_running_stages_build_valid_positive_prescriptions(stage):
    result = build_program(
        profile(
            primary_goal="running",
            session_minutes=60,
            running_baseline=RunningBaseline(
                novice_start_confirmed=True, comfortable_walk_minutes=20, accepted_stage=stage
            ),
        ),
        START,
        1,
    )
    assert result.status == "ready"
    runs = [
        session
        for session in result.sessions
        if session.workout.kind == "session"
        and any(block.id == "intervals" for block in session.workout.blocks)
    ]
    assert runs
    for session in runs:
        assert all(
            ex.duration_seconds is None or ex.duration_seconds > 0
            for block in session.workout.blocks
            for ex in block.exercises
        )
        if stage == 8:
            block = next(block for block in session.workout.blocks if block.id == "intervals")
            assert len(block.exercises) == 1
            assert block.exercises[0].duration_seconds == 1200
            assert block.grouping == "sequential"
