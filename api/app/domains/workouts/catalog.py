"""Original, versioned general-fitness reference; no rehosted third-party media."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Exercise:
    id: str
    name: str
    equipment: frozenset[str]
    tags: frozenset[str]
    purpose: str
    instruction: str
    alternatives: tuple[str, ...] = ()


CATALOG_VERSION = "hafa-general-2026-10-10"
EXERCISES = {
    exercise.id: exercise
    for exercise in (
        Exercise(
            "sit_to_stand",
            "Sit to stand",
            frozenset({"chair"}),
            frozenset({"squat", "knee_flexion", "legs"}),
            "squat",
            "Use a stable chair. Stand and sit with control within a comfortable range.",
            ("bodyweight_squat",),
        ),
        Exercise(
            "bodyweight_squat",
            "Bodyweight squat",
            frozenset(),
            frozenset({"squat", "knee_flexion", "legs"}),
            "squat",
            "Stand comfortably, lower with control, and return upright. Use a range you can control.",
            ("sit_to_stand", "goblet_squat"),
        ),
        Exercise(
            "goblet_squat",
            "Goblet squat",
            frozenset({"dumbbell"}),
            frozenset({"squat", "knee_flexion", "legs", "loaded"}),
            "squat",
            "Hold one dumbbell close to your chest and perform a controlled squat.",
            ("bodyweight_squat", "sit_to_stand"),
        ),
        Exercise(
            "glute_bridge",
            "Glute bridge",
            frozenset(),
            frozenset({"hip_extension", "floor", "hips"}),
            "hip_extension",
            "Lie on your back with feet supported on the floor. Raise and lower your hips with control.",
            ("dumbbell_rdl",),
        ),
        Exercise(
            "dumbbell_rdl",
            "Dumbbell Romanian deadlift",
            frozenset({"dumbbell"}),
            frozenset({"hinge", "hip_extension", "hips", "loaded"}),
            "hip_extension",
            "Hold the weights near your legs. Move your hips back with control, then stand tall.",
            ("glute_bridge",),
        ),
        Exercise(
            "wall_pushup",
            "Wall push-up",
            frozenset({"wall"}),
            frozenset({"push", "upper_body", "wrist_loading"}),
            "push",
            "Place hands on a stable wall and bend and straighten your arms while keeping your body controlled.",
            ("pushup",),
        ),
        Exercise(
            "pushup",
            "Push-up",
            frozenset(),
            frozenset({"push", "upper_body", "floor", "wrist_loading"}),
            "push",
            "Lower and raise your body with control. Choose a variation you can repeat without losing form.",
            ("wall_pushup",),
        ),
        Exercise(
            "band_row",
            "Resistance-band row",
            frozenset({"band", "secure_anchor"}),
            frozenset({"pull", "upper_body"}),
            "pull",
            "Use an appropriate secure anchor. Pull toward your torso and return with control.",
            ("dumbbell_row",),
        ),
        Exercise(
            "dumbbell_row",
            "Dumbbell row",
            frozenset({"dumbbell"}),
            frozenset({"pull", "upper_body", "loaded"}),
            "pull",
            "Use a stable stance. Pull the weight toward your torso and lower with control.",
            ("band_row",),
        ),
        Exercise(
            "dead_bug",
            "Dead bug",
            frozenset(),
            frozenset({"trunk", "floor"}),
            "trunk",
            "Lie on your back and slowly move opposite arm and leg while keeping the trunk controlled.",
        ),
        Exercise(
            "split_squat",
            "Split squat",
            frozenset(),
            frozenset({"squat", "knee_flexion", "legs", "unilateral"}),
            "squat",
            "Use a stable split stance. Lower and rise with control, then switch sides.",
            ("bodyweight_squat",),
        ),
        Exercise(
            "supported_balance",
            "Supported balance practice",
            frozenset({"stable_support"}),
            frozenset({"balance"}),
            "balance",
            "Stay near stable support and practice a comfortable standing balance position.",
        ),
        Exercise(
            "walk",
            "Comfortable walk",
            frozenset(),
            frozenset({"aerobic", "walking"}),
            "aerobic",
            "Walk at a comfortable pace. Adjust the pace to your current ability.",
        ),
        Exercise(
            "easy_run",
            "Easy run",
            frozenset(),
            frozenset({"aerobic", "running", "impact"}),
            "running",
            "Run at a comfortable, controlled effort; the target is time rather than speed.",
        ),
    )
}


def compatible(exercise: Exercise, equipment: list[str], exclusions: list[str]) -> bool:
    """Exact declared equipment/tags; never diagnose from free-text limitations."""
    available = {item.strip().lower() for item in equipment}
    excluded = {item.strip().lower() for item in exclusions}
    return exercise.equipment <= available and not (
        exercise.tags & excluded or exercise.id in excluded
    )


def find_alternative(
    exercise: Exercise, equipment: list[str], exclusions: list[str]
) -> Exercise | None:
    for candidate_id in exercise.alternatives:
        candidate = EXERCISES[candidate_id]
        if candidate.purpose == exercise.purpose and compatible(candidate, equipment, exclusions):
            return candidate
    return None
