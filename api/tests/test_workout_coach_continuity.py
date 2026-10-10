"""Golden continuous-training cases; original numeric policies remain D03 pending."""

from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.domains.workouts.coach_continuity import (
    bulk_schedule,
    comparable_progression,
    expected_cells,
    future_change_guard,
    logical_sessions,
    running_progression,
    running_workout,
)
from app.domains.workouts.schemas import (
    ActivityContext,
    RunningBaseline,
    TrainingProfile,
    WorkoutContent,
)

TODAY = date(2026, 10, 10)


def profile(**changes):
    return TrainingProfile(
        adult_confirmed=True,
        equipment=["dumbbell", "wall", "chair"],
        available_days=[0, 2, 4],
        session_minutes=90,
        readiness="ready",
        available_loads_kg=[20, 21],
        **changes,
    )


def workout(
    *,
    grouping="sequential",
    rounds=None,
    sets=2,
    per_side=False,
    loaded=True,
    reps=12,
    exercise_id=None,
):
    identifier = exercise_id or (
        "dumbbell_row"
        if loaded and per_side
        else "goblet_squat"
        if loaded
        else "split_squat"
        if per_side
        else "bodyweight_squat"
    )
    exercise = {
        "name": identifier,
        "exercise_id": identifier,
        "sets": sets,
        "reps_min": reps - 4,
        "reps_max": reps,
        "per_side": per_side,
    }
    if loaded:
        exercise.update(load=20, load_unit="kg", load_convention="total")
    return WorkoutContent.model_validate(
        {
            "title": "Golden exercise",
            "blocks": [
                {
                    "id": "main",
                    "label": "Main",
                    "grouping": grouping,
                    "rounds": rounds,
                    "exercises": [exercise],
                }
            ],
        }
    )


def recorded(content, *, days_ago=1):
    actuals = []
    for block in content.blocks:
        for index, exercise in enumerate(block.exercises):
            for round_index, set_index, side in sorted(expected_cells(block, index)):
                actuals.append(
                    {
                        "block_id": block.id,
                        "exercise_index": index,
                        "round_index": round_index,
                        "set_index": set_index,
                        "side": side,
                        "reps": exercise.reps_max,
                        "duration_seconds": exercise.duration_seconds,
                        "load": exercise.load,
                        "load_unit": exercise.load_unit,
                        "load_convention": exercise.load_convention,
                        "completed": True,
                        "difficulty": "manageable",
                        "pain_reported": False,
                    }
                )
    started = datetime.combine(TODAY - timedelta(days=days_ago), datetime.min.time(), timezone.utc)
    seconds = sum(item["duration_seconds"] or 0 for item in actuals)
    return SimpleNamespace(
        id=uuid4(),
        content={
            "finished_at": (started + timedelta(seconds=max(seconds, 60))).isoformat(),
            "started_at": datetime.combine(
                TODAY - timedelta(days=days_ago), datetime.min.time(), timezone.utc
            ).isoformat(),
            "status": "completed",
            "prescription_snapshot": content.model_dump(mode="json"),
            "actuals": actuals,
        },
    )


@pytest.mark.parametrize("grouping,rounds", [("sequential", None), ("circuit", 3), ("superset", 2)])
@pytest.mark.parametrize("per_side", [False, True])
def test_every_round_set_side_is_compared_without_relabeling_source_sets(
    grouping, rounds, per_side
):
    content = workout(grouping=grouping, rounds=rounds, per_side=per_side)
    records = [recorded(content), recorded(content, days_ago=3)]
    before = deepcopy([row.content for row in records])
    decision, changed = comparable_progression(content, "main", 0, records, profile(), as_of=TODAY)
    assert (
        decision["action"] == "increase_load" and changed["blocks"][0]["exercises"][0]["load"] == 21
    )
    assert (
        changed["blocks"][0]["rounds"] == rounds
        and changed["blocks"][0]["exercises"][0]["sets"] == 2
    )
    assert decision["comparison_cells"] == (rounds or 1) * 2 * (2 if per_side else 1)
    assert [row.content for row in records] == before and content.blocks[0].exercises[0].load == 20


def test_round_only_circuit_has_one_execution_per_round_and_no_fabricated_set_count():
    content = workout(grouping="circuit", rounds=3, sets=None)
    decision, changed = comparable_progression(
        content,
        "main",
        0,
        [recorded(content), recorded(content, days_ago=3)],
        profile(),
        as_of=TODAY,
    )
    assert decision["action"] == "increase_load" and decision["comparison_cells"] == 3
    assert (
        changed["blocks"][0]["exercises"][0]["sets"] is None and changed["blocks"][0]["rounds"] == 3
    )


@pytest.mark.parametrize(
    "mutation",
    [
        "missing_side",
        "missing_round",
        "extra_round",
        "duplicate",
        "unknown_pain",
        "pain",
        "hard",
        "partial",
        "different_load",
        "convention",
        "different_snapshot",
    ],
)
def test_missing_conflicting_or_incomparable_cells_hold(mutation):
    content = workout(grouping="circuit", rounds=3, per_side=True)
    records = [recorded(content), recorded(content, days_ago=3)]
    newest = records[0].content
    if mutation == "missing_side":
        newest["actuals"] = [item for item in newest["actuals"] if item["side"] == "left"]
    elif mutation == "missing_round":
        newest["actuals"] = [item for item in newest["actuals"] if item["round_index"] != 3]
    elif mutation == "extra_round":
        newest["actuals"].append(dict(newest["actuals"][0], round_index=4))
    elif mutation == "duplicate":
        newest["actuals"].append(dict(newest["actuals"][0]))
    elif mutation == "partial":
        newest["status"] = "partial"
    elif mutation == "different_snapshot":
        newest["prescription_snapshot"]["blocks"][0]["rounds"] = 2
    else:
        key, value = {
            "unknown_pain": ("pain_reported", None),
            "pain": ("pain_reported", True),
            "hard": ("difficulty", "hard"),
            "different_load": ("load", 10),
            "convention": ("load_convention", "per_hand"),
        }[mutation]
        newest["actuals"][0][key] = value
    decision, changed = comparable_progression(content, "main", 0, records, profile(), as_of=TODAY)
    assert decision["action"] == "hold" and changed is None


@pytest.mark.parametrize("per_side", [False, True])
def test_bodyweight_rep_proposal_is_modest_and_never_equates_to_load(per_side):
    content = workout(grouping="circuit", rounds=2, per_side=per_side, loaded=False)
    decision, changed = comparable_progression(
        content,
        "main",
        0,
        [recorded(content), recorded(content, days_ago=3)],
        profile(),
        as_of=TODAY,
    )
    assert decision["action"] == "increase_reps" and decision["suggested_reps_max"] == 13
    target = changed["blocks"][0]["exercises"][0]
    assert target["reps_min"] == 9 and target["load"] is None and target["load_unit"] is None


def test_bodyweight_cap_offers_variant_review_without_inventing_its_baseline():
    content = workout(loaded=False, reps=15, exercise_id="wall_pushup")
    decision, changed = comparable_progression(
        content,
        "main",
        0,
        [recorded(content), recorded(content, days_ago=3)],
        profile(),
        as_of=TODAY,
    )
    assert (
        decision["action"] == "review_variant"
        and decision["variant_id"] == "pushup"
        and changed is None
    )


@pytest.mark.parametrize("days", [0, -1, 29])
def test_same_day_future_or_stale_feedback_does_not_progress(days):
    content = workout()
    records = [recorded(content, days_ago=days), recorded(content, days_ago=0 if days == 0 else 3)]
    decision, changed = comparable_progression(content, "main", 0, records, profile(), as_of=TODAY)
    assert decision["action"] == "hold" and changed is None


def test_same_local_day_even_different_utc_dates_holds():
    content = workout()
    records = [recorded(content), recorded(content, days_ago=3)]
    records[0].content["started_at"] = "2026-10-01T14:30:00+00:00"
    records[1].content["started_at"] = "2026-10-02T01:00:00+00:00"
    assert (
        comparable_progression(content, "main", 0, records, profile(), as_of=TODAY)[0]["action"]
        == "hold"
    )


@pytest.mark.parametrize("stage", range(9))
def test_running_stage_advances_only_from_three_complete_feedback_records(stage):
    user = profile(
        primary_goal="running",
        running_baseline=RunningBaseline(
            novice_start_confirmed=True, comfortable_walk_minutes=20, accepted_stage=stage
        ),
    )
    content = running_workout(user)
    records = [recorded(content, days_ago=days) for days in [1, 3, 5]]
    before = deepcopy([row.content for row in records])
    decision, next_workout = running_progression(user, records, as_of=TODAY)
    assert decision["action"] == ("advance_stage" if stage < 8 else "repeat_stage")
    assert (next_workout is not None) is (stage < 8)
    assert (
        user.running_baseline.accepted_stage == stage and [row.content for row in records] == before
    )


@pytest.mark.parametrize(
    "mutation",
    [
        "missing_duration",
        "short_duration",
        "missing_pain",
        "hard",
        "partial",
        "missing_round",
        "same_day",
        "old_feedback",
        "truncated_stage",
    ],
)
def test_running_incomplete_or_incomparable_feedback_repeats_stage(mutation):
    user = profile(
        primary_goal="running",
        running_baseline=RunningBaseline(novice_start_confirmed=True, comfortable_walk_minutes=20),
    )
    content = running_workout(user)
    records = [recorded(content, days_ago=days) for days in [1, 3, 5]]
    row = records[0].content
    if mutation == "partial":
        row["status"] = "partial"
    elif mutation == "missing_round":
        row["actuals"].pop()
    elif mutation == "same_day":
        records[1].content["started_at"] = row["started_at"]
    elif mutation == "old_feedback":
        records = [recorded(content, days_ago=days) for days in [29, 31, 33]]
    elif mutation == "truncated_stage":
        row["prescription_snapshot"]["blocks"][1]["rounds"] -= 1
    else:
        key, value = {
            "missing_duration": ("duration_seconds", None),
            "short_duration": ("duration_seconds", 1),
            "missing_pain": ("pain_reported", None),
            "hard": ("difficulty", "hard"),
        }[mutation]
        row["actuals"][0][key] = value
    decision, next_workout = running_progression(user, records, as_of=TODAY)
    assert decision["action"] != "advance_stage" and next_workout is None


def calendar():
    content = workout().model_dump(mode="json")
    return {
        "title": "Calendar",
        "proposal": {
            "sessions": [
                {"id": identifier, "date": day, "purpose": "Training", "workout": deepcopy(content)}
                for identifier, day in [
                    ("past", "2026-10-06"),
                    ("today", "2026-10-10"),
                    ("future-1", "2026-10-12"),
                    ("future-2", "2026-10-14"),
                    ("done-future", "2026-10-16"),
                ]
            ]
        },
    }


def test_bulk_shift_preserves_past_today_recorded_and_original_spacing():
    content = calendar()
    before = deepcopy(content)
    updated, ids = bulk_schedule(content, profile(), {"done-future"}, TODAY, "shift", shift_days=7)
    originals, changed = logical_sessions(content), logical_sessions(updated)
    assert ids == ["future-1", "future-2"]
    assert (
        changed["future-1"]["date"] == "2026-10-19" and changed["future-2"]["date"] == "2026-10-21"
    )
    assert all(originals[key] == changed[key] for key in ["past", "today", "done-future"])
    assert content == before
    future_change_guard(content, updated, set(ids), {"done-future"}, TODAY)


def test_pause_return_excludes_missed_and_respects_games_and_availability():
    content = calendar()
    paused, ids = bulk_schedule(content, profile(), {"done-future"}, TODAY, "pause")
    assert {item["id"] for item in paused["proposal"]["sessions"]} == {
        "past",
        "today",
        "done-future",
    }
    assert {item["id"] for item in paused["schedule_state"]["paused_sessions"]} == set(ids)
    user = profile(
        primary_goal="athletic_conditioning",
        other_activities=[
            ActivityContext(date=date(2026, 11, 5), name="Basketball", strenuous=True)
        ],
    )
    returned, ids = bulk_schedule(
        paused, user, {"done-future"}, date(2026, 10, 30), "return", start_date=date(2026, 11, 4)
    )
    changed = logical_sessions(returned)
    assert (
        changed["future-1"]["date"] == "2026-11-09" and changed["future-2"]["date"] == "2026-11-11"
    )
    assert changed["past"]["date"] == "2026-10-06" and changed["today"]["date"] == "2026-10-10"
    future_change_guard(
        paused, returned, set(ids), {"done-future"}, date(2026, 10, 30), returning=True
    )


def test_unknown_readiness_can_pause_but_not_return():
    user = profile().model_copy(update={"readiness": "unknown"})
    paused, _ = bulk_schedule(calendar(), user, set(), TODAY, "pause")
    with pytest.raises(HTTPException):
        bulk_schedule(paused, user, set(), TODAY, "return", start_date=date(2026, 10, 12))


def test_negative_shift_past_and_frozen_mutation_fail():
    content = calendar()
    with pytest.raises(HTTPException):
        bulk_schedule(content, profile(), set(), TODAY, "shift", shift_days=-7)
    modified = deepcopy(content)
    modified["proposal"]["sessions"][0]["date"] = "2026-11-01"
    with pytest.raises(HTTPException):
        future_change_guard(content, modified, {"future-1"}, set(), TODAY)
