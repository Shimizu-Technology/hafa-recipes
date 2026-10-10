"""Continuous-training policy operates on immutable snapshots, not elapsed weeks.

Numeric progression/recovery defaults remain original product policy pending D03.
The adapter checks individual round/set/side cells; it never calls a round a set.
"""

from copy import deepcopy
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.domains.workouts.catalog import EXERCISES, compatible
from app.domains.workouts.programming import (
    REVIEW_NOTICE,
    RULE_VERSION,
    RUNNING_STAGES,
    _questions,
    _run,
    evaluate_progression,
    evaluate_running_progression,
)
from app.domains.workouts.router import content_digest
from app.domains.workouts.schemas import CompletedExposure, RunningStageResult, WorkoutContent


def expected_cells(block, index):
    """One execution per round when grouped source has no separate set count."""
    exercise = block.exercises[index]
    grouped = block.grouping != "sequential"
    if grouped and block.rounds is None:
        return None
    if not grouped and block.rounds not in (None, 1):
        return None
    if exercise.sets is None and not grouped and exercise.duration_seconds is None:
        return None
    rounds = block.rounds or 1
    sets = exercise.sets or 1
    sides = ("left", "right") if exercise.per_side is True else ("both",)
    return {
        (round_index, set_index, side)
        for round_index in range(1, rounds + 1)
        for set_index in range(1, sets + 1)
        for side in sides
    }


def actual_cells(content, block, index):
    rows = [
        item
        for item in content.get("actuals", [])
        if item.get("block_id") == block.id and item.get("exercise_index") == index
    ]
    cells = {}
    for item in rows:
        key = (item.get("round_index", 1), item.get("set_index"), item.get("side") or "both")
        if key in cells:
            return None
        cells[key] = item
    return cells


def hold(reason, **extra):
    return {
        "action": "hold",
        "rule_version": RULE_VERSION,
        "reason": reason,
        "evidence_session_ids": [],
        "review_notice": REVIEW_NOTICE,
        **extra,
    }


def comparable_progression(workout, block_id, index, records, profile, *, as_of=None):
    block = next((item for item in workout.blocks if item.id == block_id), None)
    if not block or index >= len(block.exercises):
        raise HTTPException(404, "Exercise not found")
    prescription = block.exercises[index]
    catalog = EXERCISES.get(prescription.exercise_id)
    if (
        _questions(profile)
        or catalog is None
        or not compatible(catalog, profile.equipment or [], profile.movement_exclusions)
    ):
        return hold("Current readiness, movement and declared equipment need confirmation."), None
    if "unilateral" in catalog.tags and prescription.per_side is not True:
        return hold("Confirm separate left/right targets for this unilateral movement."), None
    keys = expected_cells(block, index)
    if (
        keys is None
        or prescription.reps_max is None
        or prescription.duration_seconds
        or prescription.distance_meters
    ):
        return hold(
            "Confirm repetition, round, set and side structure; timed/distance progression needs a separate rule."
        ), None
    recent = sorted(
        records,
        key=lambda row: (datetime.fromisoformat(row.content["started_at"]), str(row.id)),
        reverse=True,
    )[:2]
    if len(recent) < 2:
        return hold("Two separate comparable completed exposures are required."), None
    dates = [
        datetime.fromisoformat(row.content["started_at"])
        .astimezone(ZoneInfo(profile.timezone))
        .date()
        for row in recent
    ]
    if dates[0] == dates[1]:
        return hold("Same-local-day repeats do not establish two exposures."), None
    if as_of is not None and any(day > as_of or day < as_of - timedelta(days=28) for day in dates):
        return hold(
            "Confirm recent actual feedback; future dates or feedback older than the Håfa 28-day policy window do not establish a current baseline."
        ), None
    observed = []
    for row in recent:
        snapshot = WorkoutContent.model_validate(row.content.get("prescription_snapshot", {}))
        original = next((item for item in snapshot.blocks if item.id == block.id), None)
        if original is None or content_digest(original.model_dump(mode="json")) != content_digest(
            block.model_dump(mode="json")
        ):
            return hold(
                "A recent exposure used a different prescription/grouping; inspect it before progressing."
            ), None
        cells = actual_cells(row.content, block, index)
        if row.content.get("status") != "completed" or cells is None or set(cells) != keys:
            return hold(
                "All prescribed rounds, sets and sides must be recorded and completed."
            ), None
        if any(
            not item.get("completed")
            or item.get("reps") is None
            or item["reps"] < prescription.reps_max
            or item.get("difficulty") not in {"easy", "manageable"}
            or item.get("pain_reported") is not False
            or item.get("load") != prescription.load
            or item.get("load_unit") != prescription.load_unit
            or item.get("load_convention") != prescription.load_convention
            for item in cells.values()
        ):
            return hold(
                "Recent cells need comparable load, upper-range reps, comfortable completion and explicit pain-free feedback."
            ), None
        observed.append(cells)
    evidence = [str(row.id) for row in recent]
    changed = workout.model_dump(mode="json")
    changed_block = next(item for item in changed["blocks"] if item["id"] == block.id)
    target = changed_block["exercises"][index]
    if prescription.load is not None:
        # Evaluate each independently observed execution using the existing load rule.
        # This analysis cell has one observation; source sets and rounds stay untouched.
        decisions = []
        for key in sorted(keys):
            exposures = [
                CompletedExposure(
                    session_id=str(row.id),
                    date=day,
                    exercise_id=prescription.exercise_id,
                    reps=[cells[key]["reps"]],
                    load=prescription.load,
                    load_unit=prescription.load_unit,
                    load_convention=prescription.load_convention,
                    completed=True,
                    difficulty=cells[key]["difficulty"],
                    pain_reported=False,
                )
                for row, day, cells in zip(recent, dates, observed)
            ]
            decisions.append(
                evaluate_progression(
                    prescription.model_copy(update={"sets": 1}), exposures, profile
                )
            )
        if any(item.action != "increase_load" for item in decisions):
            return hold(
                decisions[0].reason if decisions else "No comparable load progression is supported."
            ), None
        suggested = decisions[0].suggested_load
        if any(item.suggested_load != suggested for item in decisions):
            return hold("Round/side suggestions conflict; review the observations."), None
        target["load"] = suggested
        decision = decisions[0].model_dump(mode="json")
        decision.update(
            reason="Each prescribed round/set/side independently meets the same conservative load rule.",
            evidence_session_ids=evidence,
        )
    else:
        if "loaded" in catalog.tags or prescription.load_unit or prescription.load_convention:
            return hold(
                "A resistance/assistance baseline is missing; no creator load or bodyweight equivalence is inferred."
            ), None
        # Original modest rep policy, not a claimed ACSM numeric requirement.
        if prescription.reps_max >= 15:
            variants = {"wall_pushup": "pushup", "sit_to_stand": "bodyweight_squat"}
            variant = EXERCISES.get(variants.get(prescription.exercise_id))
            if variant and compatible(
                variant, profile.equipment or [], profile.movement_exclusions
            ):
                return hold(
                    "Review a different movement and establish its own comfortable baseline; repetitions/loads are not equivalent.",
                    action="review_variant",
                    variant_id=variant.id,
                    variant_name=variant.name,
                    evidence_session_ids=evidence,
                ), None
            return hold(
                "The modest rep-policy cap is reached; review a new baseline or variation rather than escalating automatically."
            ), None
        target["reps_max"] = prescription.reps_max + 1
        target["reps_min"] = (
            (prescription.reps_min + 1) if prescription.reps_min is not None else None
        )
        decision = {
            "action": "increase_reps",
            "rule_version": RULE_VERSION,
            "suggested_reps_min": target["reps_min"],
            "suggested_reps_max": target["reps_max"],
            "evidence_session_ids": evidence,
            "reason": "Two complete comfortable exposures support reviewing one additional rep per prescribed execution; sets, rounds and sides stay unchanged.",
        }
    target.update(provenance="suggestion", evidence=[])
    changed["provenance"] = "suggestion"
    decision.update(review_notice=REVIEW_NOTICE, comparison_cells=len(keys))
    return decision, changed


def running_workout(profile):
    if not profile.running_baseline or not profile.running_baseline.novice_start_confirmed:
        return None
    running = profile.model_copy(update={"primary_goal": "running"})
    if _questions(running):
        return None
    workout, _ = _run(running)
    if workout is None:
        return None
    if workout.blocks[1].rounds != RUNNING_STAGES[profile.running_baseline.accepted_stage][2]:
        return None  # A shortened stage is useful training, not a full-stage result.
    return workout


def running_geometry(workout):
    return [
        {
            "id": block.id,
            "grouping": block.grouping,
            "rounds": block.rounds or 1,
            "rest_between_rounds_seconds": block.rest_between_rounds_seconds or 0,
            "exercises": [
                {
                    "exercise_id": item.exercise_id,
                    "duration_seconds": item.duration_seconds,
                    "sets": item.sets or 1,
                    "per_side": bool(item.per_side),
                    "distance_meters": item.distance_meters,
                    "load": item.load,
                    "rest_seconds": item.rest_seconds or 0,
                }
                for item in block.exercises
            ],
        }
        for block in workout.blocks
    ]


def running_progression(profile, records, *, as_of=None):
    baseline = running_workout(profile)
    if baseline is None:
        return hold(
            "Confirm a full introductory stage and a current comfortable baseline/time cap; established/event-specific progression needs separate programming."
        ), None
    stage = profile.running_baseline.accepted_stage
    results = []
    recent = sorted(
        records,
        key=lambda row: (datetime.fromisoformat(row.content["started_at"]), str(row.id)),
        reverse=True,
    )[:3]
    for row in recent:
        snapshot = WorkoutContent.model_validate(row.content.get("prescription_snapshot", {}))
        day = (
            datetime.fromisoformat(row.content["started_at"])
            .astimezone(ZoneInfo(profile.timezone))
            .date()
        )
        comparable = running_geometry(snapshot) == running_geometry(baseline)
        if as_of is not None and (day > as_of or day < as_of - timedelta(days=28)):
            comparable = False
        complete = comparable and row.content.get("status") == "completed"
        required_seconds = sum(
            exercise.duration_seconds * len(expected_cells(block, index))
            for block in baseline.blocks
            for index, exercise in enumerate(block.exercises)
        )
        finish = row.content.get("finished_at")
        complete = (
            complete
            and finish is not None
            and (
                datetime.fromisoformat(finish) - datetime.fromisoformat(row.content["started_at"])
            ).total_seconds()
            >= required_seconds
        )
        comfortable = True
        pain_free = True
        observed_seconds = 0
        for block in baseline.blocks:
            for index, exercise in enumerate(block.exercises):
                keys = expected_cells(block, index)
                cells = actual_cells(row.content, block, index)
                if cells is None or set(cells) != keys:
                    complete = comfortable = pain_free = False
                    continue
                for cell in cells.values():
                    complete = (
                        complete
                        and cell.get("completed") is True
                        and cell.get("duration_seconds") is not None
                        and cell["duration_seconds"] >= exercise.duration_seconds
                        and cell.get("load") == exercise.load
                        and cell.get("load_unit") == exercise.load_unit
                        and cell.get("load_convention") == exercise.load_convention
                    )
                    observed_seconds += cell.get("duration_seconds") or 0
                    comfortable = comfortable and cell.get("difficulty") in {"easy", "manageable"}
                    pain_free = pain_free and cell.get("pain_reported") is False
        if (
            finish is not None
            and observed_seconds
            > (
                datetime.fromisoformat(finish) - datetime.fromisoformat(row.content["started_at"])
            ).total_seconds()
        ):
            complete = False
        results.append(
            RunningStageResult(
                session_id=str(row.id),
                date=day,
                stage=stage,
                completed=complete,
                comfortable=comfortable,
                pain_reported=not pain_free,
            )
        )
    decision = evaluate_running_progression(
        stage, results, profile.model_copy(update={"primary_goal": "running"})
    ).model_dump(mode="json")
    decision["review_notice"] = REVIEW_NOTICE
    if decision["action"] != "advance_stage":
        return decision, None
    next_profile = profile.model_copy(deep=True)
    next_profile.running_baseline.accepted_stage = decision["suggested_stage"]
    next_workout = running_workout(next_profile)
    if next_workout is None:
        return hold(
            "The next full stage does not fit the confirmed baseline/time cap; review session time before advancing."
        ), None
    return decision, next_workout


def logical_sessions(content):
    active = content.get("proposal", {}).get("sessions", [])
    queued = content.get("schedule_state", {}).get("paused_sessions", [])
    return {item["id"]: item for item in active + queued}


def hard_session(item):
    exercises = [exercise for block in item["workout"]["blocks"] for exercise in block["exercises"]]
    return not exercises or any(
        exercise.get("exercise_id") != "walk" or exercise.get("load") is not None
        for exercise in exercises
    )


def validate_calendar(content, profile, changed_ids):
    sessions = content["proposal"]["sessions"]
    protected = {item.date for item in profile.other_activities if item.strenuous is not False}
    for item in sessions:
        if item["id"] not in changed_ids:
            continue
        day = date.fromisoformat(item["date"])
        if day.weekday() not in profile.available_days or day in protected:
            raise HTTPException(
                409, "Training availability or another activity conflicts with this date"
            )
        if any(
            other["id"] != item["id"]
            and (
                other["date"] == item["date"]
                or (
                    hard_session(item)
                    and hard_session(other)
                    and abs((day - date.fromisoformat(other["date"])).days) < 2
                )
            )
            for other in sessions
        ):
            raise HTTPException(409, "Keep session spacing and avoid stacking training")
        if (
            profile.primary_goal == "athletic_conditioning"
            and hard_session(item)
            and any(abs((day - game).days) <= 1 for game in protected)
        ):
            raise HTTPException(409, "Keep recovery around declared game days")


def shorter_workout(workout, minutes):
    """Reduce known timed work; never guess which strength work is optional."""
    changed = workout.model_copy(deep=True)
    exercises = [item for block in changed.blocks for item in block.exercises]
    if (
        len(changed.blocks) == 1
        and len(exercises) == 1
        and exercises[0].exercise_id == "walk"
        and exercises[0].duration_seconds
        and not exercises[0].load
        and changed.blocks[0].rounds in (None, 1)
        and exercises[0].sets in (None, 1)
    ):
        seconds = minutes * 60
        if seconds >= exercises[0].duration_seconds:
            return None, "The requested duration does not shorten this walk."
        exercises[0].duration_seconds = seconds
        exercises[0].provenance = "suggestion"
        exercises[0].evidence = []
    elif [block.id for block in changed.blocks] == ["warmup", "intervals", "cooldown"]:
        warmup, main, cooldown = changed.blocks
        if (
            len(warmup.exercises) != 1
            or len(cooldown.exercises) != 1
            or warmup.exercises[0].exercise_id != "walk"
            or cooldown.exercises[0].exercise_id != "walk"
            or warmup.exercises[0].duration_seconds != 300
            or cooldown.exercises[0].duration_seconds != 300
            or main.rest_between_rounds_seconds not in (None, 0)
        ):
            return None, "Review preparation/recovery timing before shortening this source."
        if any(
            item.duration_seconds is None
            or item.sets is not None
            or item.per_side
            or item.load is not None
            or item.rest_seconds not in (None, 0)
            for item in main.exercises
        ):
            return None, "Confirm timed interval structure before shortening."
        if (
            not main.exercises
            or main.exercises[0].exercise_id != "easy_run"
            or any(item.exercise_id != "walk" for item in main.exercises[1:])
        ):
            return None, "This interval sequence is outside the reviewed running structure."
        cycle = sum(item.duration_seconds for item in main.exercises)
        rounds = main.rounds or 1
        fitting = (minutes * 60 - 600) // cycle
        if fitting < 1:
            return (
                None,
                "The time cap cannot preserve walking preparation, one interval and cooldown.",
            )
        if fitting >= rounds:
            return None, "The requested time does not shorten these intervals."
        main.rounds = fitting
    else:
        return (
            None,
            "Choose optional blocks or a reviewed alternative; a duration estimate cannot identify safely removable strength/source work.",
        )
    changed.provenance = "suggestion"
    changed.estimated_minutes = (
        (
            sum(item.duration_seconds or 0 for block in changed.blocks for item in block.exercises)
            + 59
        )
        // 60
        if len(changed.blocks) == 1
        else (
            600
            + sum(item.duration_seconds for item in changed.blocks[1].exercises)
            * (changed.blocks[1].rounds or 1)
            + 59
        )
        // 60
    )
    changed.parent_version_id = workout.id
    changed.version += 1
    changed.id = content_digest({"parent": workout.id, "minutes": minutes})[:24]
    changed.notes += [
        "Shorter timed alternative; preparation/recovery is preserved. This shortened session does not establish full-stage running completion.",
        REVIEW_NOTICE,
    ]
    return changed, None


def future_change_guard(
    before, after, changed_ids, recorded_ids, today, *, returning=False, restoring=False
):
    originals, updated = logical_sessions(before), logical_sessions(after)
    queued = {item["id"] for item in before.get("schedule_state", {}).get("paused_sessions", [])}
    before_active = {item["id"] for item in before.get("proposal", {}).get("sessions", [])}
    after_active = {item["id"] for item in after.get("proposal", {}).get("sessions", [])}
    for identifier in set(originals) | set(updated):
        original, changed = originals.get(identifier), updated.get(identifier)
        if identifier not in changed_ids:
            if original != changed or (
                (identifier in before_active) != (identifier in after_active)
                and not (returning and identifier in recorded_ids)
            ):
                raise HTTPException(409, "A frozen or unrelated session changed")
            continue
        if identifier in recorded_ids:
            raise HTTPException(409, "Recorded sessions cannot change")
        if original is None:
            if not restoring or changed is None or date.fromisoformat(changed["date"]) <= today:
                raise HTTPException(
                    409, "Only an explicitly skipped future prescription may be restored"
                )
            continue
        if date.fromisoformat(original["date"]) <= today and not (
            returning and identifier in queued
        ):
            raise HTTPException(409, "Only future uncompleted prescriptions may change")
        if changed and date.fromisoformat(changed["date"]) <= today and not returning:
            raise HTTPException(409, "Choose future prescription dates")


def bulk_schedule(
    content, profile, recorded_ids, today, operation, *, shift_days=None, start_date=None
):
    updated = deepcopy(content)
    state = content.get("schedule_state", {})
    if operation == "return":
        if start_date is None or start_date <= today:
            raise HTTPException(422, "Choose a future return date")
        if profile.interrupted:
            raise HTTPException(
                409, "Confirm your current comfortable baseline in your profile before returning"
            )
        if _questions(profile):
            raise HTTPException(
                409,
                "Confirm current profile readiness, availability and explicit limitations before returning",
            )
        if state.get("status") == "paused":
            candidates = [
                item for item in state.get("paused_sessions", []) if item["id"] not in recorded_ids
            ]
        else:
            candidates = [
                item
                for item in content["proposal"]["sessions"]
                if date.fromisoformat(item["date"]) > today and item["id"] not in recorded_ids
            ]
    else:
        if state.get("status") == "paused":
            raise HTTPException(409, "This program is paused; prepare a return first")
        candidates = [
            item
            for item in content["proposal"]["sessions"]
            if date.fromisoformat(item["date"]) > today and item["id"] not in recorded_ids
        ]
    candidates.sort(key=lambda item: (item["date"], item["id"]))
    if not candidates:
        raise HTTPException(
            409, "No future uncompleted sessions remain; missed sessions are not stacked"
        )
    identifiers = {item["id"] for item in candidates}
    if operation == "pause":
        updated["proposal"]["sessions"] = [
            item for item in updated["proposal"]["sessions"] if item["id"] not in identifiers
        ]
        updated["schedule_state"] = {"status": "paused", "paused_sessions": deepcopy(candidates)}
        return updated, sorted(identifiers)
    if not profile.available_days:
        raise HTTPException(409, "Confirm your training availability before scheduling")
    if operation == "shift" and (shift_days is None or shift_days == 0):
        raise HTTPException(422, "Choose a nonzero future shift")
    protected = {item.date for item in profile.other_activities if item.strenuous is not False}
    frozen = [item for item in content["proposal"]["sessions"] if item["id"] not in identifiers]
    if operation == "return" and state.get("status") == "paused":
        frozen += [item for item in state["paused_sessions"] if item["id"] in recorded_ids]
    assigned = list(frozen)
    first = date.fromisoformat(candidates[0]["date"])
    previous_original = previous_new = None
    for item in candidates:
        original = date.fromisoformat(item["date"])
        candidate = (
            original + timedelta(days=shift_days)
            if operation == "shift"
            else start_date + (original - first)
        )
        if candidate <= today:
            raise HTTPException(409, "The shift would place training in the past or today")
        if previous_new is not None:
            candidate = max(
                candidate,
                previous_new + timedelta(days=max(1, (original - previous_original).days)),
            )
        for _ in range(731):
            occupied = {date.fromisoformat(other["date"]) for other in assigned}
            needs_rest = hard_session(item) and any(
                hard_session(other)
                and abs((candidate - date.fromisoformat(other["date"])).days) < 2
                for other in assigned
            )
            game_rest = (
                profile.primary_goal == "athletic_conditioning"
                and hard_session(item)
                and any(abs((candidate - game).days) <= 1 for game in protected)
            )
            if (
                candidate.weekday() in profile.available_days
                and candidate not in occupied
                and candidate not in protected
                and not needs_rest
                and not game_rest
            ):
                break
            candidate += timedelta(days=1)
        else:
            raise HTTPException(409, "Availability and recovery conflict; choose a new schedule")
        if candidate > today + timedelta(days=730):
            raise HTTPException(409, "The schedule exceeds the two-year planning bound")
        changed = deepcopy(item)
        changed["date"] = candidate.isoformat()
        assigned.append(changed)
        previous_original, previous_new = original, candidate
    updated["proposal"]["sessions"] = sorted(assigned, key=lambda item: (item["date"], item["id"]))
    updated["schedule_state"] = {"status": "active"}
    if operation == "shift" and all(
        next(other for other in assigned if other["id"] == item["id"])["date"] == item["date"]
        for item in candidates
    ):
        raise HTTPException(
            409, "Availability would leave this schedule unchanged; choose a larger shift"
        )
    return updated, sorted(identifiers)
