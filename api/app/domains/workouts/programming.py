"""Deterministic, source-informed general-fitness proposals, never medical clearance.

Numeric starter templates and progression caps are Håfa product policies pending
qualified programming review. Plans repeat the baseline until actual results
support a separately accepted progression; calendar passage is not performance.
"""

import hashlib
import json
import math
from datetime import date, timedelta

from app.domains.workouts.catalog import EXERCISES, compatible, find_alternative
from app.domains.workouts.schemas import (
    AdaptationProposal,
    CompletedExposure,
    ExercisePrescription,
    ProgramProposal,
    ProgressionProposal,
    RunningStageResult,
    ScheduledPrescription,
    TrainingProfile,
    WorkoutBlock,
    WorkoutContent,
)

RULE_VERSION = "hafa-general-2026-10-10.1"
SOURCES = {
    "cdc-adults": "https://www.cdc.gov/physical-activity-basics/guidelines/adults.html",
    "hhs-gradual": "https://www.niddk.nih.gov/-/media/Files/Diet-Nutrition/Physical_Activity_Guidelines_2nd_edition.pdf",
    "cdc-effort": "https://www.cdc.gov/physical-activity-basics/measuring/index.html",
    "acsm-2026": "https://acsm.org/resistance-training-guidelines-update-2026/",
    "nhs-strength": "https://www.nhs.uk/live-well/exercise/how-to-improve-strength-flexibility/",
    "nsca-frequency": "https://www.nsca.com/education/articles/kinetic-select/determination-of-resistance-training-frequency/",
    "nhs-running": "https://www.nhs.uk/better-health/get-active/get-running-with-couch-to-5k/couch-to-5k-running-plan/",
    "cdc-weight": "https://www.cdc.gov/healthy-weight-growth/physical-activity/",
    "cdc-older": "https://www.cdc.gov/physical-activity-basics/guidelines/older-adults.html",
    "nsca-athletic": "https://dxpprod.nsca.com/education/articles/kinetic-select/application-of-program-design-to-training-seasons/",
}
REVIEW_NOTICE = "Original Håfa starter policies; qualified programming review is pending (D03). No medical clearance or rehabilitation is provided."
PROGRESSION_POLICY = "Repeat the current baseline; propose future progression only from comparable completed results and readiness. Never automatically stack missed sessions or rewrite actuals."
# Original Håfa stages, not a reproduction of NHS's nine-week program.
# run seconds, walk seconds, repetitions; each session also has 5-min walking ends.
RUNNING_STAGES = (
    (30, 90, 6),
    (45, 90, 6),
    (60, 90, 6),
    (90, 90, 6),
    (120, 120, 5),
    (180, 120, 4),
    (300, 120, 3),
    (600, 120, 2),
    (1200, 0, 1),
)


def _id(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, default=str, ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()[:24]


def _questions(profile: TrainingProfile) -> list[str]:
    questions = []
    if not profile.adult_confirmed:
        questions.append("Confirm you are an adult before creating a personal training program.")
    if profile.equipment is None:
        questions.append(
            "Which equipment and stable supports are available? Choose none if applicable."
        )
    if not profile.available_days:
        questions.append("Which days can you train?")
    if profile.session_minutes is None:
        questions.append("How many minutes are available for each session?")
    if profile.readiness != "ready":
        questions.append("Confirm your current readiness and any movements you need to avoid.")
    if profile.limitations:
        questions.append(
            "Clarify the declared limitations as explicit movement exclusions; this app cannot interpret medical restrictions."
        )
    known_exclusions = set(EXERCISES) | set().union(*(item.tags for item in EXERCISES.values()))
    if any(item.strip().lower() not in known_exclusions for item in profile.movement_exclusions):
        questions.append(
            "Select recognized movement exclusions; unrecognized text cannot be safely interpreted."
        )
    if profile.interrupted:
        questions.append(
            "After the interruption, confirm a current comfortable baseline before resuming progression."
        )
    if profile.primary_goal == "body_composition" and profile.body_composition_priority is None:
        questions.append("Is your body-composition priority maintaining, fat loss, or muscle gain?")
    if profile.primary_goal == "running":
        baseline = profile.running_baseline
        if baseline is None:
            questions.append(
                "Share recent running frequency/duration, or choose an introductory run/walk start."
            )
        elif baseline.novice_start_confirmed:
            if baseline.comfortable_walk_minutes is None or baseline.comfortable_walk_minutes < 10:
                questions.append(
                    "Confirm a comfortable walking baseline for the introductory run/walk session."
                )
        elif (
            baseline.comfortable_run_minutes is None
            or baseline.comfortable_run_minutes < 1
            or baseline.recent_weekly_minutes is None
            or baseline.recent_weekly_minutes < 1
            or baseline.recent_runs_per_week is None
            or baseline.recent_runs_per_week < 1
        ):
            questions.append(
                "Provide comfortable continuous running time, recent weekly minutes and runs per week, or choose novice start."
            )
    return questions


def _strength(
    profile: TrainingProfile, athletic: bool = False
) -> tuple[WorkoutContent | None, list[str]]:
    equipment = profile.equipment or []
    exclusions = profile.movement_exclusions
    warnings = []
    groups = [
        (
            "squat",
            ["split_squat", "goblet_squat", "sit_to_stand", "bodyweight_squat"]
            if athletic and profile.experience == "regular"
            else ["goblet_squat", "sit_to_stand", "bodyweight_squat"],
        ),
        (
            "hip_extension",
            ["dumbbell_rdl", "glute_bridge"]
            if profile.experience == "regular"
            else ["glute_bridge"],
        ),
        ("push", ["wall_pushup", "pushup"]),
        ("pull", ["band_row", "dumbbell_row"]),
        ("trunk", ["dead_bug"]),
    ]
    if profile.age_years is not None and profile.age_years >= 65:
        groups.append(("balance", ["supported_balance"]))
    chosen = []
    seconds = 300  # Original product timing estimate: introductory preparation.
    sets = 1 if profile.experience != "regular" else 2
    for purpose, candidates in groups:
        exercise = next(
            (
                EXERCISES[key]
                for key in candidates
                if compatible(EXERCISES[key], equipment, exclusions)
            ),
            None,
        )
        if exercise is None:
            warnings.append(
                f"No catalog movement covers {purpose} with the declared equipment/exclusions."
            )
            continue
        balance = purpose == "balance"
        prescription = ExercisePrescription(
            exercise_id=exercise.id,
            name=exercise.name,
            provenance="suggestion",
            sets=1 if balance else sets,
            reps_min=None if balance else 8,
            reps_max=None if balance else 12,
            duration_seconds=30 if balance else None,
            per_side=True if "unilateral" in exercise.tags else None,
            rest_seconds=90,
            notes=exercise.instruction,
            effort="Controlled, manageable repetitions; stop before form breaks down. Load is not inferred.",
        )
        side_multiplier = 2 if prescription.per_side else 1
        work_seconds = 30 if balance else 12 * 4 * side_multiplier * sets + 90 * (sets - 1)
        if seconds + work_seconds + 30 > (profile.session_minutes or 0) * 60:
            warnings.append(
                f"The time cap omits {purpose}; this shorter session has reduced coverage."
            )
            continue
        chosen.append(prescription)
        seconds += work_seconds + 30
    if not chosen:
        return None, warnings + [
            "No reviewed-catalog strength work fits the time/equipment/exclusion constraints."
        ]
    workout = WorkoutContent(
        title="General athletic strength" if athletic else "Full-body strength foundation",
        provenance="suggestion",
        blocks=[WorkoutBlock(id="strength", label="Controlled strength work", exercises=chosen)],
        equipment_required=sorted(
            set().union(*(EXERCISES[item.exercise_id].equipment for item in chosen))
        ),
        estimated_minutes=(seconds + 59) // 60,
        notes=[
            "Time is an estimate including 5 minutes of preparation and transitions.",
            "One introductory set is a Håfa starter policy; regular trainees start with two. Load selection remains personal.",
        ],
    )
    return workout, warnings


def _walk(profile: TrainingProfile) -> WorkoutContent | None:
    if not compatible(EXERCISES["walk"], profile.equipment or [], profile.movement_exclusions):
        return None
    minutes = min(profile.session_minutes or 10, 10 if profile.experience != "regular" else 20)
    return WorkoutContent(
        title="Comfortable aerobic walk",
        provenance="suggestion",
        estimated_minutes=minutes,
        blocks=[
            WorkoutBlock(
                id="aerobic",
                label="Comfortable walking",
                exercises=[
                    ExercisePrescription(
                        exercise_id="walk",
                        name="Comfortable walk",
                        duration_seconds=minutes * 60,
                        provenance="suggestion",
                        effort="Start at an effort comfortable for you; pace is not inferred.",
                    )
                ],
            )
        ],
    )


def _run(profile: TrainingProfile) -> tuple[WorkoutContent | None, list[str]]:
    warnings = []
    if not compatible(EXERCISES["easy_run"], profile.equipment or [], profile.movement_exclusions):
        return None, ["Running conflicts with a declared movement exclusion."]
    baseline = profile.running_baseline
    if baseline is None:
        return None, ["Running baseline is missing."]
    if baseline.novice_start_confirmed:
        if not compatible(EXERCISES["walk"], profile.equipment or [], profile.movement_exclusions):
            return None, ["Run/walk recovery conflicts with a declared movement exclusion."]
        stage = baseline.accepted_stage
        run, walk, rounds = RUNNING_STAGES[stage]
        rounds = min(rounds, ((profile.session_minutes or 0) * 60 - 600) // (run + walk))
        if rounds < 1:
            needed = math.ceil((600 + run + walk) / 60)
            return None, [f"At least {needed} minutes are needed for this run/walk stage structure."]
        if rounds < RUNNING_STAGES[stage][2]:
            warnings.append(
                "Fewer intervals fit the time cap; no warmup or recovery was compressed."
            )
        return WorkoutContent(
            title=f"Introductory run/walk — stage {stage + 1}",
            provenance="suggestion",
            estimated_minutes=(600 + rounds * (run + walk) + 59) // 60,
            blocks=[
                WorkoutBlock(
                    id="warmup",
                    label="Walking warmup",
                    exercises=[
                        ExercisePrescription(
                            exercise_id="walk",
                            name="Comfortable walk",
                            duration_seconds=300,
                            provenance="suggestion",
                        )
                    ],
                ),
                WorkoutBlock(
                    id="intervals",
                    label="Easy run and recovery walk",
                    grouping="interval",
                    rounds=rounds,
                    exercises=[
                        ExercisePrescription(
                            exercise_id="easy_run",
                            name="Easy run",
                            duration_seconds=run,
                            provenance="suggestion",
                            effort="Comfortable, controlled running; no target pace.",
                        ),
                        ExercisePrescription(
                            exercise_id="walk",
                            name="Recovery walk",
                            duration_seconds=walk,
                            provenance="suggestion",
                        ),
                    ],
                ),
                WorkoutBlock(
                    id="cooldown",
                    label="Walking cooldown",
                    exercises=[
                        ExercisePrescription(
                            exercise_id="walk",
                            name="Comfortable walk",
                            duration_seconds=300,
                            provenance="suggestion",
                        )
                    ],
                ),
            ],
            notes=[
                "Original Håfa stage; repeat until actual completion and readiness support a reviewed progression."
            ],
        ), warnings
    target = min(
        baseline.comfortable_run_minutes or 0,
        (baseline.recent_weekly_minutes or 0) // max(baseline.recent_runs_per_week or 1, 1),
        max((profile.session_minutes or 0) - 10, 0),
    )
    if target < 1:
        return None, ["The time cap cannot fit established running plus preparation and cooldown."]
    return WorkoutContent(
        title="Established easy running",
        provenance="suggestion",
        estimated_minutes=target + 10,
        blocks=[
            WorkoutBlock(
                id="warmup",
                label="Preparation",
                exercises=[
                    ExercisePrescription(
                        name="Usual comfortable preparation",
                        duration_seconds=300,
                        provenance="suggestion",
                    )
                ],
            ),
            WorkoutBlock(
                id="run",
                label="Easy running",
                exercises=[
                    ExercisePrescription(
                        exercise_id="easy_run",
                        name="Easy run",
                        duration_seconds=target * 60,
                        provenance="suggestion",
                        effort="Use your established comfortable effort; no pace is inferred.",
                    )
                ],
            ),
            WorkoutBlock(
                id="cooldown",
                label="Cooldown",
                exercises=[
                    ExercisePrescription(
                        name="Usual comfortable cooldown",
                        duration_seconds=300,
                        provenance="suggestion",
                    )
                ],
            ),
        ],
        notes=[
            "An easy maintenance proposal based on declared recent training, not an event-specific plan."
        ],
    ), warnings


def build_program(profile: TrainingProfile, start_date: date, weeks: int = 4) -> ProgramProposal:
    """Dates are local calendar dates supplied by the caller, never wall-clock derived."""
    if weeks < 1 or weeks > 12:
        raise ValueError("weeks must be between 1 and 12")
    questions = _questions(profile)
    base = dict(
        rule_version=RULE_VERSION,
        source_ids=["cdc-adults", "hhs-gradual", "acsm-2026", "nsca-frequency"],
        progression_policy=PROGRESSION_POLICY,
        warnings=[REVIEW_NOTICE],
    )
    if questions:
        return ProgramProposal(status="needs_information", questions=questions, **base)
    if profile.primary_goal == "running":
        workout, warnings = _run(profile)
        base["source_ids"] += ["nhs-running", "cdc-effort"]
        templates = [("Build comfortable running consistency", workout)] if workout else []
    else:
        workout, warnings = _strength(profile, profile.primary_goal == "athletic_conditioning")
        templates = (
            [("Develop whole-body strength with declared equipment", workout)] if workout else []
        )
        if profile.primary_goal != "strength":
            walk = _walk(profile)
            if walk:
                templates.append(("Develop comfortable aerobic activity", walk))
            else:
                warnings.append("Walking conflicts with a declared movement exclusion.")
        if profile.primary_goal == "body_composition":
            base["source_ids"].append("cdc-weight")
            warnings.append(
                "Activity supports body-composition goals; no calorie deficit or weight-change outcome is inferred."
            )
        if profile.primary_goal == "athletic_conditioning":
            base["source_ids"].append("nsca-athletic")
            warnings.append(
                "General conditioning supports the named activity; this is not technical sport coaching or a power/agility program."
            )
    if profile.age_years is not None and profile.age_years >= 65:
        base["source_ids"].append("cdc-older")
    base["warnings"].extend(warnings)
    if not templates:
        return ProgramProposal(status="conflicts", **base)
    dates = [
        start_date + timedelta(days=offset)
        for offset in range(weeks * 7)
        if (start_date + timedelta(days=offset)).weekday() in profile.available_days
    ]
    protected = {
        activity.date for activity in profile.other_activities if activity.strenuous is not False
    }
    if protected:
        base["warnings"].append(
            "Other games/activities reserve their dates; unknown intensity is not treated as rest."
        )
    sessions = []
    last_strength = last_run = None
    per_week: dict[tuple[int, str], int] = {}
    for day in dates:
        if day in protected:
            continue
        week = (day - start_date).days // 7
        if profile.primary_goal == "running":
            novice = bool(
                profile.running_baseline and profile.running_baseline.novice_start_confirmed
            )
            frequency = 3 if novice else min(profile.running_baseline.recent_runs_per_week or 1, 7)
            if per_week.get((week, "run"), 0) >= frequency or (
                novice and last_run is not None and (day - last_run).days < 2
            ):
                continue
            purpose, template = templates[0]
            last_run = day
            per_week[(week, "run")] = per_week.get((week, "run"), 0) + 1
        else:
            strength = next(
                (item for item in templates if item[1] and item[1].blocks[0].id == "strength"), None
            )
            can_strength = (
                strength
                and per_week.get((week, "strength"), 0) < 2
                and (last_strength is None or (day - last_strength).days >= 2)
            )
            # Protect adjacent game days from additional lower-body work as a disclosed policy.
            if profile.primary_goal == "athletic_conditioning" and any(
                abs((day - game).days) <= 1 for game in protected
            ):
                can_strength = False
            if can_strength:
                purpose, template = strength
                last_strength = day
                per_week[(week, "strength")] = per_week.get((week, "strength"), 0) + 1
            else:
                aerobic = next(
                    (item for item in templates if item[1] and item[1].blocks[0].id == "aerobic"),
                    None,
                )
                if not aerobic or per_week.get((week, "aerobic"), 0) >= 3:
                    continue
                purpose, template = aerobic
                per_week[(week, "aerobic")] = per_week.get((week, "aerobic"), 0) + 1
        content = template.model_copy(deep=True)
        content.id = _id(
            {"rule": RULE_VERSION, "date": day, "content": content.model_dump(mode="json")}
        )
        sessions.append(
            ScheduledPrescription(
                id=_id({"date": day, "workout": content.id}),
                date=day,
                purpose=purpose,
                workout=content,
            )
        )
    if not sessions:
        return ProgramProposal(status="conflicts", **base)
    base["assumptions"] = [
        "Dates are local to the declared timezone; the caller supplies the start date.",
        "Baseline weeks repeat without assuming progress from elapsed calendar time.",
    ]
    status = "ready"
    if profile.primary_goal == "running" and profile.running_baseline.event_distance_km is not None:
        status = "unsupported"
        base["warnings"].append(
            "An event-specific plan is not in the reviewed catalog; the returned sessions are an introductory/maintenance alternative."
        )
    if profile.secondary_goals:
        base["warnings"].append(
            "This proposal prioritizes the primary goal; simultaneous maximal progress across goals is not promised."
        )
    if profile.primary_goal == "strength" and any(
        per_week.get((week, "strength"), 0) < 2 for week in range(weeks)
    ):
        status = "conflicts"
        base["warnings"].append(
            "Availability/recovery constraints permit fewer than two strength sessions in a week; partial alternatives are shown."
        )
    if profile.primary_goal != "running":
        base["warnings"].append(
            "The starter activity schedule does not claim to meet the adult 150-minute aerobic reference immediately."
        )
    return ProgramProposal(status=status, sessions=sessions, **base)


def adapt_workout(
    content: WorkoutContent, profile: TrainingProfile, minutes: int | None = None
) -> AdaptationProposal:
    """Creates a separate suggestion version; never mutates source or recorded actuals."""
    questions = []
    if not profile.adult_confirmed or profile.readiness != "ready" or profile.limitations:
        questions.append(
            "Confirm adult eligibility/readiness and resolve any free-text restrictions before personal adaptation."
        )
    known_exclusions = set(EXERCISES) | set().union(*(item.tags for item in EXERCISES.values()))
    if any(item.strip().lower() not in known_exclusions for item in profile.movement_exclusions):
        questions.append("Select recognized movement exclusions before adapting this workout.")
    if profile.equipment is None:
        questions.append("Confirm available equipment, including any stable supports or anchors.")
    cap = minutes if minutes is not None else profile.session_minutes
    if cap is not None and (cap < 5 or cap > 180):
        raise ValueError("minutes must be between 5 and 180")
    if questions:
        return AdaptationProposal(
            status="needs_information", rule_version=RULE_VERSION, questions=questions
        )
    adapted = content.model_copy(deep=True)
    adapted.parent_version_id = content.id or _id(content.model_dump(mode="json"))
    adapted.id = None
    adapted.version += 1
    adapted.provenance = "suggestion"
    changes, warnings = [], []
    for block in adapted.blocks:
        for item in block.exercises:
            exercise = EXERCISES.get(item.exercise_id)
            if exercise is None:
                questions.append(
                    f"Confirm the movement/equipment for {item.name}; there is no reviewed catalog match."
                )
                continue
            if not compatible(exercise, profile.equipment or [], profile.movement_exclusions):
                alternative = find_alternative(
                    exercise, profile.equipment or [], profile.movement_exclusions
                )
                if alternative is None:
                    warnings.append(f"No compatible reviewed alternative for {item.name}.")
                    continue
                changes.append(
                    f"Replace {item.name} with {alternative.name} for the same general movement purpose; stimulus is not claimed identical."
                )
                item.exercise_id, item.name = alternative.id, alternative.name
                item.notes = alternative.instruction
                item.per_side = True if "unilateral" in alternative.tags else None
                item.evidence = []  # Original evidence remains on the parent, never attached to a new movement.
            item.provenance = "suggestion"
            if item.load is not None:
                changes.append(
                    f"Personal load for {item.name} requires a baseline; the source load remains in the original."
                )
                item.load = item.load_unit = item.load_convention = None
                item.evidence = [
                    evidence for evidence in item.evidence if not evidence.field.startswith("load")
                ]
            if item.sets is None and block.rounds is None:
                questions.append(
                    f"How many sets/rounds should {item.name} use? The source did not supply them."
                )
            if (
                item.reps_min is None
                and item.reps_max is None
                and item.duration_seconds is None
                and item.distance_meters is None
            ):
                questions.append(
                    f"What repetition, time or distance target should {item.name} use? It is missing from the prescription."
                )
    if questions or warnings:
        return AdaptationProposal(
            status="needs_information" if questions else "conflicts",
            rule_version=RULE_VERSION,
            questions=questions,
            warnings=warnings,
            changes=changes,
        )
    if cap is not None and (content.estimated_minutes is None or content.estimated_minutes > cap):
        return AdaptationProposal(
            status="needs_information",
            rule_version=RULE_VERSION,
            questions=[
                "Review block durations and optional work before shortening this workout; an estimate alone cannot preserve its purpose."
            ],
            changes=changes,
        )
    adapted.equipment_required = sorted(
        set().union(
            *(
                EXERCISES[item.exercise_id].equipment
                for block in adapted.blocks
                for item in block.exercises
            )
        )
    )
    adapted.id = _id(
        {"parent": adapted.parent_version_id, "content": adapted.model_dump(mode="json")}
    )
    return AdaptationProposal(
        status="ready",
        rule_version=RULE_VERSION,
        workout=adapted,
        changes=changes,
        warnings=[REVIEW_NOTICE],
    )


def evaluate_progression(
    prescription: ExercisePrescription, completed: list[CompletedExposure], profile: TrainingProfile
) -> ProgressionProposal:
    """Pure, conservative product policy; a proposal does not modify a future plan."""

    def result(action: str, reason: str, **kwargs) -> ProgressionProposal:
        return ProgressionProposal(
            action=action, rule_version=RULE_VERSION, reason=reason, **kwargs
        )

    if _questions(profile):
        return result(
            "needs_information", "Profile readiness/baseline information needs confirmation."
        )
    exercise = EXERCISES.get(prescription.exercise_id)
    if exercise is None or not compatible(
        exercise, profile.equipment or [], profile.movement_exclusions
    ):
        return result(
            "hold", "The movement is unknown or conflicts with declared equipment/exclusions."
        )
    if prescription.load_convention == "assistance":
        return result(
            "hold",
            "Assistance progression requires a separately reviewed rule; increasing assistance is not increased resistance.",
        )
    if (
        prescription.load is None
        or prescription.load <= 0
        or prescription.reps_max is None
        or prescription.sets is None
    ):
        return result(
            "hold",
            "Comparable loaded sets and a rep target are needed; no load or bodyweight equivalence is inferred.",
        )
    unique = {}
    for item in completed:
        if item.exercise_id != prescription.exercise_id:
            continue
        if item.session_id in unique and unique[item.session_id] != item:
            return result(
                "hold",
                "Conflicting observations of one exposure need reconciliation before progression.",
            )
        unique[item.session_id] = item
    recent = sorted(unique.values(), key=lambda item: (item.date, item.session_id))[-2:]
    if len(recent) < 2 or recent[0].date == recent[1].date:
        return result(
            "hold", "Two separate comparable completed exposures are required by Håfa policy."
        )
    if any(
        not item.completed
        or item.pain_reported is not False
        or item.difficulty not in ("easy", "manageable")
        or item.load != prescription.load
        or item.load_unit != prescription.load_unit
        or item.load_convention != prescription.load_convention
        or len(item.reps) != prescription.sets
        or any(rep < prescription.reps_max for rep in item.reps)
        for item in recent
    ):
        return result(
            "hold",
            "Recent exposures do not both meet comparable completion, difficulty and pain-free feedback requirements.",
        )
    load_kg = (
        prescription.load if prescription.load_unit == "kg" else prescription.load * 0.45359237
    )
    candidates = sorted({load for load in profile.available_loads_kg if load > load_kg + 1e-8})
    if not candidates or candidates[0] > load_kg * 1.05 + 1e-8:
        return result(
            "hold",
            "No available increment fits the Håfa 5% policy cap; keep the load and review other progression options.",
        )
    suggested = candidates[0] if prescription.load_unit == "kg" else candidates[0] / 0.45359237
    return result(
        "increase_load",
        "Two comparable exposures meet the Håfa progression policy; review before applying the smallest available increment.",
        suggested_load=round(suggested, 6),
        load_unit=prescription.load_unit,
        evidence_session_ids=[item.session_id for item in recent],
    )


def evaluate_running_progression(
    stage: int, completed: list[RunningStageResult], profile: TrainingProfile
) -> ProgressionProposal:
    if stage < 0 or stage >= len(RUNNING_STAGES):
        raise ValueError("stage is outside the original Håfa stage catalog")
    unique = {}
    conflict = False
    for item in completed:
        if item.stage != stage:
            continue
        if item.session_id in unique and unique[item.session_id] != item:
            conflict = True
        unique[item.session_id] = item
    results = sorted(unique.values(), key=lambda item: (item.date, item.session_id))
    can_advance = (
        not conflict
        and not _questions(profile)
        and profile.running_baseline is not None
        and profile.running_baseline.novice_start_confirmed
        and profile.running_baseline.accepted_stage == stage
        and compatible(EXERCISES["easy_run"], profile.equipment or [], profile.movement_exclusions)
        and len(results) >= 3
        and len({item.date for item in results[-3:]}) == 3
        and all(
            item.completed and item.comfortable is True and item.pain_reported is False
            for item in results[-3:]
        )
    )
    action = "advance_stage" if can_advance and stage < len(RUNNING_STAGES) - 1 else "repeat_stage"
    return ProgressionProposal(
        action=action,
        rule_version=RULE_VERSION,
        suggested_stage=stage + 1 if action == "advance_stage" else stage,
        reason="Review the next original Håfa stage after three comfortable completed sessions."
        if action == "advance_stage"
        else "Repeat or review the current stage; elapsed weeks alone do not establish readiness.",
        evidence_session_ids=[item.session_id for item in results[-3:]],
    )


def moderate_equivalent_minutes(moderate: float, vigorous: float) -> float:
    """Public-health summary only; unknown intensity and resistance time excluded."""
    if not math.isfinite(moderate) or not math.isfinite(vigorous) or moderate < 0 or vigorous < 0:
        raise ValueError("activity minutes cannot be negative")
    return moderate + 2 * vigorous
