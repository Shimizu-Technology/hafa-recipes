"""Final prescriptions, not template slots, determine recovery and availability."""

from datetime import date, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.domains.workouts.programming import PROGRESSION_POLICY, RULE_VERSION
from app.domains.workouts.schemas import (
    ProgramProposal,
    ScheduledPrescription,
    TrainingProfile,
    WorkoutContent,
)
from app.domains.workouts.sharing_service import project_program
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
