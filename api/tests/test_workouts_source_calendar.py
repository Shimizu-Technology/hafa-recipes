"""Final prescriptions, not template slots, determine recovery and availability."""

from datetime import date, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.domains.workouts.execution import timed_duration_minutes
from app.domains.workouts.programming import PROGRESSION_POLICY, RULE_VERSION, adapt_workout
from app.domains.workouts.router import (
    ProgramRequest,
    content_digest,
    program_content,
    validated_workout,
)
from app.domains.workouts.schemas import (
    Evidence,
    ProgramProposal,
    ScheduledPrescription,
    TrainingProfile,
    WorkoutContent,
    WorkoutExecution,
)
from app.domains.workouts.sharing_service import project_program, project_workout
from app.domains.workouts.source_planning import (
    compose_library_program,
    convert_program_source,
    review_copied_program,
)

START = date(2026, 10, 12)


def profile(**changes):
    return TrainingProfile(
        adult_confirmed=True,
        equipment=[],
        available_days=list(range(7)),
        session_minutes=30,
        readiness="ready",
        **changes,
    )


def squat():
    return WorkoutContent.model_validate(
        {
            "title": "Reviewed squat",
            "estimated_minutes": 20,
            "blocks": [
                {
                    "id": "a",
                    "label": "Squat",
                    "exercises": [
                        {
                            "exercise_id": "bodyweight_squat",
                            "name": "Squat",
                            "sets": 2,
                            "reps_min": 8,
                        }
                    ],
                }
            ],
        }
    )


def test_source_replacement_of_easy_slots_preserves_recovery():
    result = compose_library_program(profile(), START, 1, [(uuid4(), squat())], mode="selected")
    assert result.status == "ready" and result.sessions
    assert all((b.date - a.date).days >= 2 for a, b in zip(result.sessions, result.sessions[1:]))
    assert len(result.sessions) <= 4


@pytest.mark.parametrize("required,available", [
    (["Kettlebell"], ["kettlebell"]),
    (["  Kettlebell  "], ["\tKETTLEBELL\n"]),
    (["Kettlebell", "CHAIR"], ["chair", "kettlebell"]),
    (["one kettlebell"], ["kettlebell"]),
    (["1 kettlebell"], ["kettlebell"]),
    (["a kettlebell"], ["kettlebell"]),
    (["an adjustable kettlebell"], ["adjustable kettlebell"]),
    (["  ONE\tKETTLEBELL "], ["kettlebell"]),
    (["kettlebell"], ["one kettlebell"]),
])
def test_source_planning_matches_declared_equipment_case_and_outer_spaces_without_rewriting(required, available):
    source = squat()
    source.equipment_required = required
    current = profile().model_copy(update={"equipment": available})
    result = compose_library_program(current, START, 1, [(uuid4(), source)], mode="selected")
    assert result.status == "ready" and result.sessions, result.questions
    assert all(session.workout.equipment_required == required for session in result.sessions)
    assert source.equipment_required == required and current.equipment == available


@pytest.mark.parametrize("required,available", [
    (["Kettlebell"], ["dumbbell"]),
    (["Kettlebell", "secure_anchor"], ["kettlebell"]),
    (["Special custom sled"], ["kettlebell"]),
    (["Kettlebells"], ["kettlebell"]),
    (["two kettlebells"], ["kettlebell"]),
    (["a pair of kettlebells"], ["kettlebell"]),
    (["one 16kg kettlebell"], ["kettlebell"]),
    (["one adjustable kettlebell"], ["kettlebell"]),
    (["Kettlebell"], []),
    (["  "], []),
])
def test_source_planning_keeps_unavailable_or_unknown_equipment_blocked(required, available):
    source = squat()
    source.equipment_required = required
    current = profile().model_copy(update={"equipment": available})
    result = compose_library_program(current, START, 1, [(uuid4(), source)], mode="selected", reviewed_custom=True)
    assert result.status == "needs_information"
    assert any("required equipment is unavailable" in question for question in result.questions)
    assert source.equipment_required == required


def test_source_planning_uses_only_the_selected_equipment_location():
    source = squat()
    source.equipment_required = ["Kettlebell"]
    current = TrainingProfile.model_validate({**profile().model_dump(), "equipment_locations": [
        {"id": "home", "name": "Home", "equipment": ["dumbbell"]},
        {"id": "gym", "name": "Gym", "equipment": ["kettlebell"]},
    ], "active_equipment_location_id": "home"})
    blocked = compose_library_program(current, START, 1, [(uuid4(), source)], mode="selected")
    assert blocked.status == "needs_information"
    assert any("required equipment is unavailable" in question for question in blocked.questions)
    selected = TrainingProfile.model_validate({**current.model_dump(), "active_equipment_location_id": "gym"})
    accepted = compose_library_program(selected, START, 1, [(uuid4(), source)], mode="selected")
    assert accepted.status == "ready" and accepted.sessions, accepted.questions


def test_explicit_source_day_must_fit_availability_and_other_activity():
    current = profile(other_activities=[{"date": START, "name": "Basketball", "strenuous": True}])
    current = current.model_copy(update={"available_days": [1, 3]})
    result = convert_program_source(
        current,
        START,
        squat().model_copy(update={"kind": "program"}),
        [SimpleNamespace(block_ids=["a"], label="Monday", duration_minutes=20, day_offset=0)],
    )
    assert result.status == "needs_information"
    assert any("available training day" in question for question in result.questions)
    assert any("recovery day" in question for question in result.questions)


def test_copy_review_requires_recovery_and_explicit_date_changes_preserve_original():
    sessions = [
        ScheduledPrescription(
            id=str(i), date=START + timedelta(days=i), purpose="Copy", workout=squat()
        )
        for i in range(5)
    ]
    original = ProgramProposal(
        status="needs_information",
        rule_version=RULE_VERSION,
        progression_policy=PROGRESSION_POLICY,
        sessions=sessions,
    )
    result = review_copied_program(profile(), original)
    assert result.status == "needs_information"
    corrected = review_copied_program(
        profile(),
        original,
        declared_dates={str(i): START + timedelta(days=i * 2) for i in range(5)},
    )
    assert corrected.status == "ready", corrected.questions
    assert original.sessions[1].date == START + timedelta(days=1)
    assert corrected.sessions[1].date == START + timedelta(days=2)


def test_paused_program_cannot_publish_a_partial_schedule():
    with pytest.raises(HTTPException) as failure:
        project_program({"schedule_state": {"status": "paused"}})
    assert failure.value.status_code == 409


@pytest.mark.parametrize("provenance", ["source", "user"])
def test_time_capped_source_circuit_cannot_become_one_pass_via_plan_composer(provenance):
    source = squat()
    source.provenance = provenance
    source.blocks[0].grouping = "circuit"
    source.blocks[0].exercises[0].sets = None
    source.blocks[0].exercises[0].reps_min = None
    source.blocks[0].exercises[0].duration_seconds = 120
    result = compose_library_program(profile(), START, 1, [(uuid4(), source)], mode="selected")
    assert result.status == "needs_information"
    assert any("sets or rounds" in question for question in result.questions)


def test_declared_circuit_time_still_requires_fixed_tracking_counts():
    source = squat()
    source.estimated_minutes = None
    source.provenance = "user"
    source.blocks[0].grouping = "circuit"
    source.blocks[0].exercises[0].sets = None
    source.blocks[0].exercises[0].reps_min = None
    source.blocks[0].exercises[0].duration_seconds = 120
    source_id = uuid4()
    result = compose_library_program(profile(), START, 1, [(source_id, source)], mode="selected",
                                     declared_minutes={str(source_id): 20})
    assert result.status == "needs_information"
    assert any("sets or rounds" in question for question in result.questions)


def amrap_source():
    source = squat()
    source.provenance = "source"
    source.source_url = "https://example.com/workout"
    source.estimated_minutes = None
    source.blocks[0].grouping = "circuit"
    source.blocks[0].execution = WorkoutExecution(mode="amrap", time_cap_seconds=1200)
    source.blocks[0].exercises[0].sets = None
    source.blocks[0].exercises[0].provenance = "source"
    return source


def test_typed_amrap_plans_without_invented_rounds_or_second_duration_field():
    source = amrap_source()
    result = compose_library_program(profile(), START, 1, [(uuid4(), source)], mode="selected")
    assert result.status == "ready" and result.sessions
    for session in result.sessions:
        block = session.workout.blocks[0]
        assert block.execution.time_cap_seconds == 1200 and block.rounds is None
        assert block.exercises[0].sets is None and session.workout.estimated_minutes == 20
    assert source.estimated_minutes is None and source.blocks[0].rounds is None


def test_typed_amrap_adaptation_keeps_source_and_execution_without_fixed_counts():
    source = amrap_source()
    result = adapt_workout(source, profile())
    assert result.status == "ready", result.questions
    assert result.workout.blocks[0].execution.time_cap_seconds == 1200
    assert result.workout.blocks[0].rounds is None and result.workout.blocks[0].exercises[0].sets is None
    assert source.provenance == "source" and source.version == 1


def test_typed_amrap_still_checks_available_time_and_unsupported_multiple_blocks():
    source = amrap_source()
    source.blocks[0].execution.time_cap_seconds = 2400
    result = compose_library_program(profile(), START, 1, [(uuid4(), source)], mode="selected")
    assert result.status == "needs_information" and any("available time" in question for question in result.questions)
    identifier = uuid4()
    result = compose_library_program(profile(), START, 1, [(identifier, source)], mode="selected",
                                     declared_minutes={str(identifier): 20})
    assert result.status == "needs_information" and any("available time" in question for question in result.questions)
    source.estimated_minutes = 20
    assert adapt_workout(source, profile()).status == "needs_information"
    other = source.blocks[0].model_copy(deep=True, update={"id": "other"})
    source.blocks.append(other)
    result = compose_library_program(profile(), START, 1, [(uuid4(), source)], mode="selected")
    assert result.status == "needs_information" and any("single-circuit" in question for question in result.questions)
    assert len(source.blocks) == 2 and all(block.execution.time_cap_seconds == 2400 for block in source.blocks)


def test_shared_amrap_preserves_only_typed_execution_without_private_evidence():
    source = amrap_source()
    source.notes = ["Private coaching context"]
    source.blocks[0].label = "Private routine label"
    source.blocks[0].evidence = [Evidence(field="execution.mode", wording="Private caption", location="caption")]
    projected, incomplete = project_workout(source.model_dump(mode="json"))
    assert not incomplete
    assert projected["blocks"][0]["execution"] == {"mode": "amrap", "time_cap_seconds": 1200}
    assert projected["blocks"][0]["rounds"] is None
    assert "Private" not in str(projected) and projected["blocks"][0]["evidence"] == []
    assert "execution" not in project_workout(squat().model_dump(mode="json"))[0]["blocks"][0]


@pytest.mark.parametrize("seconds,minutes", [(1, 1), (90, 2), (125, 3), (86400, 1440)])
def test_source_planning_uses_ceil_cap_minutes_and_never_a_shorter_declared_estimate(seconds, minutes):
    source = amrap_source()
    source.blocks[0].execution.time_cap_seconds = seconds
    assert WorkoutContent.model_validate(source.model_dump(mode="json")).blocks[0].execution.time_cap_seconds == seconds
    assert timed_duration_minutes(source) == minutes
    identifier = uuid4()
    result = compose_library_program(profile(), START, 1, [(identifier, source)], mode="selected",
                                     declared_minutes={str(identifier): 1})
    if minutes > 30:
        assert result.status == "needs_information"
        assert any("available time" in question for question in result.questions)
    else:
        assert result.status == "ready", result.questions
        assert all(session.workout.estimated_minutes == minutes for session in result.sessions)
        assert all(session.workout.blocks[0].execution.time_cap_seconds == seconds for session in result.sessions)


def test_legacy_fixed_api_dto_and_creation_hash_stay_identical():
    fixed = squat()
    content = validated_workout(fixed)
    assert "execution" not in content["blocks"][0]
    # Independently verified against 7198219's schema/normalization for this fixture.
    assert content_digest(content) == "ed8182432959448811725f8e3eb9fce88d8ea2bb7ca79f38dfe3d801a32e5d5b"
    nullable = fixed.model_dump(mode="json", exclude={"id", "version", "parent_version_id"})
    nullable["blocks"][0]["execution"] = None
    assert validated_workout(WorkoutContent.model_validate(nullable)) == content


@pytest.mark.parametrize("include_url", [False, True])
def test_raw_source_text_never_enters_public_projection_or_repeated_plan_sessions(include_url):
    source = squat().model_copy(update={"source_context": None})
    source = WorkoutContent.model_validate({**source.model_dump(mode="json"), "source_context": {
        "parts": [{"location": "caption", "text": "PRIVATE CAPTION"}], "truncated": False},
        "instructions": ["Repeat in order"], "notes": ["PRIVATE OWNER NOTE"],
        "blocks": [{**block.model_dump(mode="json"), "exercises": [
            {**exercise.model_dump(mode="json"), "instructions": "Keep heels down"}
            for exercise in block.exercises]} for block in source.blocks]})
    public, _ = project_workout(source.model_dump(mode="json"), include_source_url=include_url)
    assert "source_context" not in public and "PRIVATE" not in str(public)
    assert public["instructions"] == ["Repeat in order"]
    assert public["blocks"][0]["exercises"][0]["instructions"] == "Keep heels down"
    result = compose_library_program(profile(), START, 1, [(uuid4(), source)], mode="selected")
    assert result.sessions
    assert all(session.workout.source_context is None for session in result.sessions)
    assert all(session.workout.instructions == ["Repeat in order"] for session in result.sessions)
    assert source.source_context.parts[0].text == "PRIVATE CAPTION"
    adapted = adapt_workout(source, profile())
    assert adapted.workout is not None and adapted.workout.source_context is None
    assert adapted.workout.instructions == ["Repeat in order"]
    result.sessions[0].workout.source_context = source.source_context
    saved = program_content(ProgramRequest(title="My plan", proposal=result))
    assert "source_context" not in saved["proposal"]["sessions"][0]["workout"]
    assert result.sessions[0].workout.source_context is not None
