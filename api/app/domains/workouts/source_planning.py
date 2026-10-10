"""Compose reviewed library sessions without claiming source loads are personal."""

from copy import deepcopy
from datetime import timedelta

from app.domains.workouts.catalog import EXERCISES, compatible
from app.domains.workouts.programming import (
    PROGRESSION_POLICY,
    REVIEW_NOTICE,
    RULE_VERSION,
    build_program,
)
from app.domains.workouts.schemas import ProgramProposal, ScheduledPrescription


def inspect_personal_source(workout, profile, *, reviewed_custom=False, declared_minutes=None):
    result = workout.model_copy(deep=True)
    questions = []
    warnings = []
    if workout.kind != "session":
        questions.append(
            f"{workout.title}: review this {workout.kind} as part of a session or a program first."
        )
    if not workout.blocks or not any(block.exercises for block in workout.blocks):
        questions.append(f"{workout.title}: complete the exercise list first.")
    duration = declared_minutes or workout.estimated_minutes
    if duration is None:
        questions.append(f"{workout.title}: enter a reviewed approximate session length.")
    elif duration > (profile.session_minutes or 0):
        questions.append(
            f"{workout.title}: it exceeds your available time; adapt it before scheduling."
        )
    known = set(profile.equipment or [])
    if not set(workout.equipment_required) <= known:
        questions.append(
            f"{workout.title}: required equipment is unavailable at your selected location."
        )
    for block in result.blocks:
        for exercise in block.exercises:
            catalog = EXERCISES.get(exercise.exercise_id)
            if catalog and not compatible(
                catalog, profile.equipment or [], profile.movement_exclusions
            ):
                questions.append(f"{exercise.name}: equipment or movement constraints conflict.")
            if catalog is None and not reviewed_custom:
                questions.append(
                    f"{exercise.name}: match a variation or explicitly review this custom routine."
                )
            if exercise.sets is None and block.rounds is None:
                questions.append(f"{exercise.name}: enter the intended sets or rounds.")
            if all(
                value is None
                for value in (
                    exercise.reps_min,
                    exercise.reps_max,
                    exercise.duration_seconds,
                    exercise.distance_meters,
                )
            ):
                questions.append(f"{exercise.name}: complete the rep, duration or distance target.")
            if exercise.provenance == "source" and exercise.load is not None:
                exercise.load = exercise.load_unit = exercise.load_convention = None
                exercise.provenance = "suggestion"
                warnings.append(
                    f"{exercise.name}: creator load is retained in the original, not assigned to you."
                )
    result.estimated_minutes = duration
    if reviewed_custom:
        warnings.append(
            "Custom routines were reviewed by you; movement balance and progression are not automatically verified."
        )
    return result, questions, warnings


def compose_library_program(
    profile,
    start_date,
    weeks,
    workouts,
    *,
    mode="mixed",
    reviewed_custom=False,
    declared_minutes=None,
):
    baseline = build_program(profile, start_date, weeks)
    if baseline.status != "ready":
        return baseline
    if not workouts:
        return baseline
    candidates = []
    questions = []
    warnings = list(baseline.warnings)
    for identifier, content in workouts:
        candidate, needs, notes = inspect_personal_source(
            content,
            profile,
            reviewed_custom=reviewed_custom,
            declared_minutes=(declared_minutes or {}).get(str(identifier)),
        )
        questions.extend(needs)
        warnings.extend(notes)
        candidates.append(candidate)
    if questions:
        return ProgramProposal(
            status="needs_information",
            rule_version=RULE_VERSION,
            source_ids=baseline.source_ids,
            questions=list(dict.fromkeys(questions)),
            warnings=warnings,
            progression_policy=PROGRESSION_POLICY,
        )
    sessions = []
    index = 0
    for position, session in enumerate(baseline.sessions):
        use_source = mode == "selected" or position % 2 == 0
        if use_source:
            source = candidates[index % len(candidates)].model_copy(deep=True)
            index += 1
            sessions.append(
                session.model_copy(
                    update={
                        "workout": source,
                        "purpose": "Practice your reviewed library routine within the existing schedule",
                    }
                )
            )
        else:
            sessions.append(session)
    warnings.append(
        "Source targets are preserved unless an explicitly accepted adaptation changes them. This is not an event-specific or medically individualized program."
    )
    return baseline.model_copy(
        update={"sessions": sessions, "warnings": list(dict.fromkeys(warnings))}
    )


def convert_program_source(profile, start_date, source, days, *, reviewed_custom=False):
    """The user assigns source blocks to days; labels alone never establish dates."""
    baseline = build_program(profile, start_date, 1)
    if baseline.status != "ready":
        return baseline
    blocks = {block.id: block for block in source.blocks}
    sessions = []
    questions = []
    warnings = [REVIEW_NOTICE]
    for index, day in enumerate(days):
        chosen = []
        for block_id in day.block_ids:
            if block_id not in blocks:
                questions.append("A selected source block no longer exists.")
            else:
                chosen.append(deepcopy(blocks[block_id]))
        candidate = source.model_copy(
            update={
                "kind": "session",
                "title": day.label,
                "blocks": chosen,
                "estimated_minutes": day.duration_minutes,
            }
        )
        candidate, needs, notes = inspect_personal_source(
            candidate, profile, reviewed_custom=reviewed_custom
        )
        questions.extend(needs)
        warnings.extend(notes)
        sessions.append(
            ScheduledPrescription(
                id=f"source-day-{index}",
                date=start_date + timedelta(days=day.day_offset),
                purpose="User-reviewed imported program day",
                workout=candidate,
            )
        )
    if len({session.date for session in sessions}) != len(sessions):
        questions.append(
            "Choose one source training session per calendar day, or combine the intended blocks."
        )
    ordered = sorted(session.date for session in sessions)
    if any((right - left).days < 2 for left, right in zip(ordered, ordered[1:])):
        questions.append(
            "Leave a recovery day between these source training sessions; combine or reschedule deliberately."
        )
    return ProgramProposal(
        status="needs_information" if questions else "ready",
        rule_version=RULE_VERSION,
        source_ids=[],
        sessions=sessions,
        questions=list(dict.fromkeys(questions)),
        warnings=list(dict.fromkeys(warnings)),
        assumptions=[
            "Day assignments and duration estimates were explicitly reviewed by the user."
        ],
        progression_policy=PROGRESSION_POLICY,
    )
