"""Deterministic, source-informed general-fitness proposals, never medical clearance.

Numeric starter templates and progression caps are Håfa product policies pending
qualified programming review. Plans repeat the baseline until actual results
support a separately accepted progression; calendar passage is not performance.
"""

import hashlib
import json
import math
from datetime import date, timedelta

from app.domains.workouts.catalog import EXERCISES, compatible, find_alternative, match_exercise
from app.domains.workouts.execution import is_amrap, supports_amrap, timed_duration_minutes
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

RULE_VERSION = "hafa-general-2026-10-25.2"
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
REVIEW_NOTICE = "General fitness guidance, not medical advice, clearance or rehabilitation. Choose a weight you can control, and stop if you feel pain."
PROGRESSION_POLICY = "Repeat these sessions until your results and how you feel support a change. Missed sessions stay separate, and your recorded results stay saved."
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
        questions.append("Are you 18 or older? Confirm this before creating a personal plan.")
    if profile.equipment is None:
        questions.append(
            "What equipment do you have, including a stable chair, wall or support? Choose none if needed."
        )
    if not profile.available_days:
        questions.append("Which days can you train?")
    if profile.session_minutes is None:
        questions.append("How much time do you have for each session?")
    if profile.readiness != "ready":
        questions.append("How ready do you feel to train, and are there movements you need to avoid?")
    if profile.limitations:
        questions.append(
            "Which movements do you need to avoid? Ask a qualified professional if you're unsure about medical restrictions."
        )
    known_exclusions = set(EXERCISES) | set().union(*(item.tags for item in EXERCISES.values()))
    if any(item.strip().lower() not in known_exclusions for item in profile.movement_exclusions):
        questions.append(
            "Choose the movements to avoid from the profile options so I can check them safely."
        )
    if profile.interrupted:
        questions.append(
            "After your break, what amount of training feels comfortable now?"
        )
    if profile.primary_goal == "body_composition" and profile.body_composition_priority is None:
        questions.append("Would you like to maintain your weight, lose fat or build muscle?")
    if profile.primary_goal == "running":
        baseline = profile.running_baseline
        if baseline is None:
            questions.append(
                "How often and how long have you run recently? You can also choose a beginner run/walk start."
            )
        elif baseline.novice_start_confirmed:
            if baseline.comfortable_walk_minutes is None or baseline.comfortable_walk_minutes < 10:
                questions.append(
                    "Can you comfortably walk for at least 10 minutes before starting run/walk sessions?"
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
                "How long can you comfortably run, how many minutes do you run per week, and how often? Or choose a beginner run/walk start."
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
        purpose_label = {"hip_extension": "hip", "trunk": "core"}.get(purpose, purpose)
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
                f"I couldn't find a {purpose_label} exercise that fits your equipment and movements to avoid."
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
            instructions=exercise.instruction,
            effort="Move with control and stop before your form slips. Choose a weight you can manage; stop if you feel pain.",
        )
        side_multiplier = 2 if prescription.per_side else 1
        work_seconds = 30 if balance else 12 * 4 * side_multiplier * sets + 90 * (sets - 1)
        if seconds + work_seconds + 30 > (profile.session_minutes or 0) * 60:
            warnings.append(
                f"There isn't enough time for {purpose_label} work in this session."
            )
            continue
        chosen.append(prescription)
        seconds += work_seconds + 30
    if not chosen:
        return None, warnings + [
            "I couldn't find strength exercises that fit your time, equipment and movements to avoid."
        ]
    workout = WorkoutContent(
        title="General athletic strength" if athletic else "Full-body strength foundation",
        provenance="suggestion",
        blocks=[WorkoutBlock(id="strength", label="Controlled strength work", exercises=chosen)],
        equipment_required=sorted(
            set().union(*(EXERCISES[item.exercise_id].equipment for item in chosen))
        ),
        estimated_minutes=(seconds + 59) // 60,
        instructions=[
            "Allow about 5 minutes to warm up and move between exercises; the total time is an estimate.",
            "Start with one set if you are new or returning, or two if you train regularly. Choose a weight you can control.",
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
                        effort="Walk at a pace that feels comfortable for you.",
                    )
                ],
            )
        ],
    )


def _run(profile: TrainingProfile) -> tuple[WorkoutContent | None, list[str]]:
    warnings = []
    if not compatible(EXERCISES["easy_run"], profile.equipment or [], profile.movement_exclusions):
        return None, ["Running doesn't fit the movements you've chosen to avoid."]
    baseline = profile.running_baseline
    if baseline is None:
        return None, ["Tell me about your recent running before starting a running plan."]
    if baseline.novice_start_confirmed:
        if not compatible(EXERCISES["walk"], profile.equipment or [], profile.movement_exclusions):
            return None, ["The recovery walk doesn't fit the movements you've chosen to avoid."]
        stage = baseline.accepted_stage
        run, walk, rounds = RUNNING_STAGES[stage]
        rounds = min(rounds, ((profile.session_minutes or 0) * 60 - 600) // (run + walk))
        if rounds < 1:
            needed = math.ceil((600 + run + walk) / 60)
            return None, [
                f"At least {needed} minutes are needed for this run/walk session."
            ]
        if rounds < RUNNING_STAGES[stage][2]:
            warnings.append(
                "This session has fewer intervals to fit your time, with the full warmup and recovery."
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
                    label="Easy run and recovery walk" if walk else "Continuous easy run",
                    grouping="interval" if walk else "sequential",
                    rounds=rounds,
                    exercises=[
                        ExercisePrescription(
                            exercise_id="easy_run",
                            name="Easy run",
                            duration_seconds=run,
                            provenance="suggestion",
                            effort="Comfortable, controlled running; no target pace.",
                        ),
                    ]
                    + (
                        [
                            ExercisePrescription(
                                exercise_id="walk",
                                name="Recovery walk",
                                duration_seconds=walk,
                                provenance="suggestion",
                            )
                        ]
                        if walk
                        else []
                    ),
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
            instructions=[
                "Repeat this stage until you can finish it comfortably and feel ready to try the next one."
            ],
        ), warnings
    target = min(
        baseline.comfortable_run_minutes or 0,
        (baseline.recent_weekly_minutes or 0) // max(baseline.recent_runs_per_week or 1, 1),
        max((profile.session_minutes or 0) - 10, 0),
    )
    if target < 1:
        return None, ["There isn't enough time for your usual easy run, warmup and cooldown."]
    return WorkoutContent(
        title="Your usual easy run",
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
                        effort="Use your usual comfortable effort, at your own pace.",
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
        instructions=[
            "An easy session based on your recent running. Training for an event needs a separate plan."
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
            [("Build whole-body strength with your equipment", workout)] if workout else []
        )
        if profile.primary_goal != "strength":
            walk = _walk(profile)
            if walk:
                templates.append(("Develop comfortable aerobic activity", walk))
            else:
                warnings.append("Walking doesn't fit the movements you've chosen to avoid.")
        if profile.primary_goal == "body_composition":
            base["source_ids"].append("cdc-weight")
            warnings.append(
                "Activity can support your goals, but this plan does not set a calorie target or promise weight changes."
            )
        if profile.primary_goal == "athletic_conditioning":
            base["source_ids"].append("nsca-athletic")
            warnings.append(
                "These sessions build general fitness for your activity. Sport skills, power and agility need separate coaching."
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
            "I've left your other activity days free. If their effort isn't known, I haven't counted them as rest."
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
        "Your sessions use the timezone in your profile.",
        "The weeks repeat so you can build consistency before increasing the work.",
    ]
    status = "ready"
    if profile.primary_goal == "running" and profile.running_baseline.event_distance_km is not None:
        status = "unsupported"
        base["warnings"].append(
            "I can't create an event-specific plan yet. These sessions offer a beginner or easy-running alternative."
        )
    if profile.secondary_goals:
        base["warnings"].append(
            "This plan focuses on your main goal. Your other goals may need extra time or a different plan."
        )
    if profile.primary_goal == "strength" and any(
        per_week.get((week, "strength"), 0) < 2 for week in range(weeks)
    ):
        status = "conflicts"
        base["warnings"].append(
            "Your available days and recovery needs leave room for fewer than two strength sessions in a week. Here's what fits."
        )
    if profile.primary_goal != "running":
        base["warnings"].append(
            "This is a starting plan; it may provide less than the adult guideline of 150 minutes of moderate activity a week."
        )
    return ProgramProposal(status=status, sessions=sessions, **base)


def _direction_entries(heading: str, text: str) -> list[str]:
    # Every saved text field is capped at 4000 characters. Repeat the heading
    # on continuations so old prescriptions never look like active Coach cues.
    size = 4000 - len(heading)
    return [heading + text[index:index + size] for index in range(0, len(text), size)]


def _shortened_directions(
    workout: WorkoutContent, block: WorkoutBlock, original_block: WorkoutBlock, changes: list[str]
) -> None:
    # Blocks have no instructions field. Imports store their original directions
    # in block evidence and project them into workout.instructions.
    original = list(dict.fromkeys([
        *workout.instructions,
        *(entry.wording for entry in original_block.evidence
          if entry.field in {"workout_instructions", "workout_notes"}),
    ]))
    original.append(f"Original block: {original_block.label}")
    # Exercise cues can also prescribe the old sets, rounds or time cap. Keep
    # their exact text with the full-workout directions, not as an active cue.
    for item in original_block.exercises:
        if item.instructions:
            original.append(f"Original exercise directions for {item.name}:\n{item.instructions}")
    for item in block.exercises:
        if item.instructions:
            item.instructions = (
                "Shortened by Coach: Follow the sets, reps, time and rest listed for this exercise. "
                "The creator's original exercise directions are in the full-workout directions."
            )
            item.evidence = [entry for entry in item.evidence if entry.field != "instructions"]
    workout.instructions = _direction_entries("Shortened by Coach: ", " ".join(changes)) + _direction_entries(
        "The creator's original directions below describe the full workout.\n\n", "\n\n".join(original)
    )
    block.label = "Shortened by Coach"
    # Retained instruction quotes support only the original section above.
    # No source evidence is created for Coach's new directions or estimate.
    block.evidence = [entry for entry in block.evidence
                      if entry.field not in {"label", "estimated_minutes"}]


def _shorten(workout: WorkoutContent, minutes: int, source_minutes: int) -> list[str]:
    """Reduce explicit volume in one block; never infer reps or remove recovery blocks."""
    if len(workout.blocks) != 1 or not workout.blocks[0].exercises:
        return []
    block = workout.blocks[0]
    # Capture every source cue before reducing sets, evidence or the exercise list.
    original_block = block.model_copy(deep=True)
    ratio = minutes / source_minutes
    if is_amrap(block):
        if minutes * 60 >= block.execution.time_cap_seconds:
            return []
        block.execution.time_cap_seconds = minutes * 60
        block.evidence = [e for e in block.evidence if not e.field.startswith("execution")]
        workout.estimated_minutes = minutes
        changes = [f"Reduce the circuit time limit to {minutes} minutes; keep the same exercises."]
        _shortened_directions(workout, block, original_block, changes)
        return changes
    rounds = block.rounds or 1
    if rounds > 1:
        fitting = math.floor(rounds * ratio)
        if fitting < 1:
            return []
        block.rounds = fitting
        block.evidence = [e for e in block.evidence if e.field != "rounds"]
        fraction = fitting / rounds
        unit = "round" if fitting == 1 else "rounds"
        changes = [f"Do {fitting} {unit} instead of {rounds}; keep the same exercises and rest."]
    elif all(item.sets is not None and item.sets > 1 for item in block.exercises):
        counts = [math.floor(item.sets * ratio) for item in block.exercises]
        if min(counts) < 1:
            return []
        fraction = max(count / item.sets for item, count in zip(block.exercises, counts))
        changes = []
        for item, count in zip(block.exercises, counts):
            unit = "set" if count == 1 else "sets"
            changes.append(f"Do {count} {unit} of {item.name} instead of {item.sets}; keep the same reps and rest.")
            item.sets = count
            item.evidence = [e for e in item.evidence if e.field != "sets"]
    elif block.grouping == "circuit" and all(
        item.duration_seconds is not None and item.sets in (None, 1)
        for item in block.exercises
    ):
        weights = [item.duration_seconds * (2 if item.per_side else 1) + (item.rest_seconds or 0)
                   for item in block.exercises]
        kept = len(weights)
        while kept and sum(weights[:kept]) / sum(weights) > ratio:
            kept -= 1
        if kept == 0:
            return []
        fraction = sum(weights[:kept]) / sum(weights)
        removed = [item.name for item in block.exercises[kept:]]
        block.exercises = block.exercises[:kept]
        changes = [f"Leave out the final {len(removed)} exercises: {', '.join(removed)}. Keep the remaining moves and rest."]
    else:
        return []
    workout.estimated_minutes = math.ceil(source_minutes * fraction)
    changes.append("The shorter time is an estimate based on less work; take the rest you need.")
    _shortened_directions(workout, block, original_block, changes)
    return changes


def adapt_workout(
    content: WorkoutContent, profile: TrainingProfile, minutes: int | None = None
) -> AdaptationProposal:
    """Creates a separate suggestion version; never mutates source or recorded actuals."""
    questions = []
    if not profile.adult_confirmed or profile.readiness != "ready" or profile.limitations:
        questions.append(
            "Confirm you're 18 or older and ready to train, and clarify any movements you need to avoid."
        )
    known_exclusions = set(EXERCISES) | set().union(*(item.tags for item in EXERCISES.values()))
    if any(item.strip().lower() not in known_exclusions for item in profile.movement_exclusions):
        questions.append("Choose movements to avoid from your profile options before changing this workout.")
    if profile.equipment is None:
        questions.append("What equipment do you have, including any stable supports or anchors?")
    cap = minutes if minutes is not None else profile.session_minutes
    if cap is not None and (cap < 5 or cap > 180):
        raise ValueError("minutes must be between 5 and 180")
    if questions:
        return AdaptationProposal(
            status="needs_information", rule_version=RULE_VERSION, questions=questions
        )
    adapted = content.model_copy(deep=True, update={"source_context": None})
    adapted.parent_version_id = content.id or _id(content.model_dump(mode="json"))
    adapted.id = None
    adapted.version += 1
    adapted.provenance = "suggestion"
    changes, warnings = [], []
    source_minutes = content.estimated_minutes or timed_duration_minutes(content)
    timed_minutes = timed_duration_minutes(content)
    if timed_minutes is not None:
        source_minutes = max(source_minutes or 0, timed_minutes)
    shortening = minutes is not None and source_minutes is not None and minutes < source_minutes
    unmatched = []
    if any(block.execution for block in content.blocks) and not supports_amrap(content):
        questions.append("Split these timed blocks into separate single-circuit workouts before changing them.")
    for block in adapted.blocks:
        for item in block.exercises:
            exercise = EXERCISES.get(item.exercise_id) or match_exercise(item.name)
            if exercise is None:
                unmatched.append(item.name)
            else:
                item.exercise_id = exercise.id
            if exercise and not compatible(exercise, profile.equipment or [], profile.movement_exclusions):
                if shortening:
                    warnings.append(f"{item.name} doesn't fit your equipment or movements to avoid. Choose a different move before shortening.")
                    continue
                alternative = find_alternative(
                    exercise, profile.equipment or [], profile.movement_exclusions
                )
                if alternative is None:
                    warnings.append(f"I couldn't find a replacement for {item.name} that fits your equipment and movements to avoid.")
                    continue
                changes.append(
                    f"Try {alternative.name} instead of {item.name}. It works a similar movement, but may feel different."
                )
                item.exercise_id, item.name = alternative.id, alternative.name
                item.instructions = alternative.instruction
                item.per_side = True if "unilateral" in alternative.tags else None
                item.evidence = []  # Original evidence remains on the parent, never attached to a new movement.
            item.provenance = "suggestion"
            if item.load is not None:
                changes.append(
                    f"Choose a weight you can control for {item.name}. The original weight stays in the source workout."
                )
                item.load = item.load_unit = item.load_convention = None
                item.evidence = [
                    evidence for evidence in item.evidence if not evidence.field.startswith("load")
                ]
            if item.sets is None and block.rounds is None and not is_amrap(block):
                questions.append(
                    f"How many sets or rounds of {item.name} would you like? The source does not say."
                )
            if (
                item.reps_min is None
                and item.reps_max is None
                and item.duration_seconds is None
                and item.distance_meters is None
            ):
                questions.append(
                    f"How many reps, how much time or what distance should {item.name} use? The source does not say."
                )
    if unmatched and (not shortening or profile.movement_exclusions):
        questions.append(
            "To swap or simplify moves, or check movements you need to avoid, which exercises are these: "
            + ", ".join(dict.fromkeys(unmatched)) + "?"
        )
    if unmatched:
        available = {item.strip().casefold() for item in profile.equipment or []}
        if any(item.strip().casefold() not in available for item in content.equipment_required):
            questions.append("Can you use the equipment listed for this workout? Confirm it before keeping these moves.")
    if questions or warnings:
        return AdaptationProposal(
            status="needs_information" if questions else "conflicts",
            rule_version=RULE_VERSION,
            questions=questions,
            warnings=warnings,
            changes=changes,
        )
    if shortening:
        reductions = _shorten(adapted, minutes, source_minutes)
        if reductions:
            changes.extend(reductions)
        else:
            questions.append("Which parts can you leave out? I need that before fitting this workout into less time.")
    elif cap is not None and (source_minutes is None or source_minutes > cap):
        questions.append("How long is this workout, and which parts can you leave out to fit your available time?")
    if questions:
        return AdaptationProposal(status="needs_information", rule_version=RULE_VERSION,
                                  questions=questions, changes=changes)
    adapted.equipment_required = sorted(
        set().union(
            *(
                EXERCISES[item.exercise_id].equipment
                for block in adapted.blocks
                for item in block.exercises if item.exercise_id in EXERCISES
            )
        )
    )
    if unmatched:
        adapted.equipment_required = sorted(set(adapted.equipment_required) | set(content.equipment_required))
    adapted.id = _id(
        {"parent": adapted.parent_version_id, "content": adapted.model_dump(mode="json")}
    )
    if shortening:
        from fastapi import HTTPException

        from app.domains.workouts.router import validated_workout

        try:
            # Assignment/model_copy skip schema validation. Use the acceptance
            # validator, including list and UTF-8 record limits, with the UUID
            # identities and first revision store_workout will actually save.
            saved = adapted.model_dump(mode="json") | {
                "id": "00000000-0000-0000-0000-000000000000",
                "version": 1,
                "parent_version_id": "00000000-0000-0000-0000-000000000000",
            }
            validated_workout(WorkoutContent.model_validate(saved), authored=False)
        except (ValueError, HTTPException):
            return AdaptationProposal(
                status="needs_information", rule_version=RULE_VERSION,
                questions=["The shortened copy cannot keep all original directions within the saved workout limits. Split this workout into smaller workouts before shortening it."],
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
            "needs_information", "Check your profile and how ready you feel to train before increasing the work."
        )
    exercise = EXERCISES.get(prescription.exercise_id)
    if exercise is None or not compatible(
        exercise, profile.equipment or [], profile.movement_exclusions
    ):
        return result(
            "hold", "I need to confirm this exercise or find one that fits your equipment and movements to avoid."
        )
    if prescription.load_convention == "assistance":
        return result(
            "hold",
            "Keep the same assistance for now. More assistance makes a move easier, so I can't use weight-increase rules here.",
        )
    if (
        prescription.load is None
        or prescription.load <= 0
        or prescription.reps_max is None
        or prescription.sets is None
    ):
        return result(
            "hold",
            "Record your sets, weight and rep target before considering a weight increase. Bodyweight and added weight are different.",
        )
    unique = {}
    for item in completed:
        if item.exercise_id != prescription.exercise_id:
            continue
        if item.session_id in unique and unique[item.session_id] != item:
            return result(
                "hold",
                "The records for one session disagree. Check them before increasing the weight.",
            )
        unique[item.session_id] = item
    recent = sorted(unique.values(), key=lambda item: (item.date, item.session_id))[-2:]
    if len(recent) < 2 or recent[0].date == recent[1].date:
        return result(
            "hold", "Complete this exercise at the same weight in two sessions on different days before considering an increase."
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
            "Keep the same weight until two recent sessions have all the target reps and feel manageable, with no pain reported.",
        )
    load_kg = (
        prescription.load if prescription.load_unit == "kg" else prescription.load * 0.45359237
    )
    candidates = sorted({load for load in profile.available_loads_kg if load > load_kg + 1e-8})
    if not candidates or candidates[0] > load_kg * 1.05 + 1e-8:
        return result(
            "hold",
            "Keep the same weight for now. The next available weight would be more than a 5% increase.",
        )
    suggested = candidates[0] if prescription.load_unit == "kg" else candidates[0] / 0.45359237
    return result(
        "increase_load",
        "Your last two matching sessions support trying the smallest available weight increase. Review it before changing.",
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
        reason="You completed three sessions comfortably. Review the next stage when you feel ready."
        if action == "advance_stage"
        else "Repeat this stage or review how it feels. Move on when you are ready, rather than after a set number of weeks.",
        evidence_session_ids=[item.session_id for item in results[-3:]],
    )


def moderate_equivalent_minutes(moderate: float, vigorous: float) -> float:
    """Public-health summary only; unknown intensity and resistance time excluded."""
    if not math.isfinite(moderate) or not math.isfinite(vigorous) or moderate < 0 or vigorous < 0:
        raise ValueError("activity minutes cannot be negative")
    return moderate + 2 * vigorous
