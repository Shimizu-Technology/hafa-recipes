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


def requires_recovery(workout):
    """Only catalog walking is treated as easy activity; unknown work needs rest."""
    exercises = [exercise for block in workout.blocks for exercise in block.exercises]
    return not exercises or any(
        exercise.exercise_id != "walk" or exercise.load is not None for exercise in exercises
    )


def recovery_conflict(profile, session, previous_training):
    if not requires_recovery(session.workout):
        return False
    return (previous_training is not None and (session.date - previous_training).days < 2) or any(
        activity.strenuous is not False and abs((activity.date - session.date).days) < 2
        for activity in profile.other_activities
    )


def calendar_questions(profile, sessions):
    """Check actual prescriptions after composition, copying or day assignment."""
    questions = []
    previous_training = None
    dates = set()
    for session in sorted(sessions, key=lambda item: item.date):
        if session.date.weekday() not in profile.available_days:
            questions.append(
                f"{session.date}: choose an available training day or update your availability."
            )
        if session.date in dates:
            questions.append(
                f"{session.date}: combine these blocks or choose separate training dates."
            )
        dates.add(session.date)
        if recovery_conflict(profile, session, previous_training):
            questions.append(
                f"{session.date}: leave a recovery day between demanding sessions and strenuous or unknown other activities."
            )
        if requires_recovery(session.workout):
            previous_training = session.date
    return list(dict.fromkeys(questions))


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
            if (
                exercise.sets is None
                and block.rounds is None
                and exercise.duration_seconds is None
                and exercise.distance_meters is None
            ):
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
    previous_training = None
    for position, session in enumerate(baseline.sessions):
        use_source = mode == "selected" or position % 2 == 0
        if use_source:
            source = candidates[index % len(candidates)].model_copy(deep=True)
            index += 1
            chosen = session.model_copy(
                update={
                    "workout": source,
                    "purpose": "Practice your reviewed library routine within the existing schedule",
                }
            )
        else:
            chosen = session
        # Replacing a walking slot changes its recovery needs. The baseline's
        # dates alone are never proof that the resulting source mix is ready.
        if recovery_conflict(profile, chosen, previous_training):
            if mode == "mixed" and not recovery_conflict(profile, session, previous_training):
                chosen = session
            else:
                warnings.append(
                    f"{chosen.date}: left a recovery day for the actual source mix and other activities."
                )
                continue
        sessions.append(chosen)
        if requires_recovery(chosen.workout):
            previous_training = chosen.date
    warnings.append(
        "Source targets are preserved unless an explicitly accepted adaptation changes them. This is not an event-specific or medically individualized program."
    )
    questions = calendar_questions(profile, sessions)
    return baseline.model_copy(
        update={
            "status": "needs_information" if questions else "ready" if sessions else "conflicts",
            "sessions": sessions,
            "questions": questions,
            "warnings": list(dict.fromkeys(warnings)),
        }
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
    questions.extend(calendar_questions(profile, sessions))
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


def review_copied_program(
    profile, original, *, reviewed_custom=False, declared_minutes=None, declared_dates=None
):
    """Review a recipient's own copy; original dates and snapshots stay versioned."""
    if not original.sessions:
        return original.model_copy(
            update={
                "status": "needs_information",
                "questions": ["Add the intended training sessions first."],
            }
        )
    baseline = build_program(profile, min(item.date for item in original.sessions), 1)
    questions = list(baseline.questions)
    if baseline.status != "ready" and not questions:
        questions.append(
            "Resolve your current profile and schedule conflicts before adopting this copy."
        )
    warnings = list(original.warnings) + [REVIEW_NOTICE]
    sessions = []
    for session in original.sessions:
        content, needs, notes = inspect_personal_source(
            session.workout,
            profile,
            reviewed_custom=reviewed_custom,
            declared_minutes=(declared_minutes or {}).get(session.id),
        )
        questions.extend(needs)
        warnings.extend(notes)
        sessions.append(
            session.model_copy(
                update={
                    "workout": content,
                    "date": (declared_dates or {}).get(session.id, session.date),
                }
            )
        )
    questions.extend(calendar_questions(profile, sessions))
    return original.model_copy(
        update={
            "status": "needs_information" if questions else "ready",
            "rule_version": RULE_VERSION,
            "sessions": sessions,
            "questions": list(dict.fromkeys(questions)),
            "warnings": list(dict.fromkeys(warnings)),
            "assumptions": [
                "You reviewed this copy against your current profile; copying alone did not personalize it."
            ],
            "progression_policy": PROGRESSION_POLICY,
        }
    )


async def compose_coach_sources(profile, start_date, weeks, sources):
    from uuid import UUID

    from app.domains.workouts.schemas import WorkoutContent

    return compose_library_program(
        profile,
        start_date,
        weeks,
        [(UUID(row["id"]), WorkoutContent.model_validate(row["content"])) for row in sources],
    )
