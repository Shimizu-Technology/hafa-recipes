"""Typed workout execution shared by source extraction and personal planning."""

from app.domains.workouts.formats import FOR_TIME_PHRASE
from app.domains.workouts.schemas import WorkoutBlock, WorkoutContent

# Format words that make a quoted label or grouping a workout-wide instruction.
FORMAT_WORDS = (
    r"\bamrap\b|\brepeat(?:ing)?\b|\be\d*mom\b|\botm\b"
    r"|\bevery\s+(?:minute|\d+\s*(?:s|secs?|seconds?|mins?|minutes?)\b)"
    rf"|{FOR_TIME_PHRASE}|\brft\b|\bchipper\b|\btabata\b|\bdeath\s+by\b|\bladder\b"
)


def is_amrap(block: WorkoutBlock) -> bool:
    return (block.grouping == "circuit" and block.rounds is None
            and block.execution is not None and block.execution.mode == "amrap")


def is_timed(block: WorkoutBlock) -> bool:
    """A coherent typed format supplies its own repetition instead of set counts."""
    execution = block.execution
    if execution is None:
        return False
    if execution.mode == "amrap":
        return is_amrap(block)
    # Rounds belong to for-time work; interval formats count intervals instead.
    return execution.mode == "for_time" or block.rounds is None


def block_seconds(block: WorkoutBlock) -> int | None:
    """The format clock, or None when the source leaves its length open."""
    execution = block.execution
    if not is_timed(block):
        return None
    if execution.mode in {"amrap", "for_time"}:
        return execution.time_cap_seconds  # A for-time cap is an upper bound.
    if execution.intervals is None:
        return None
    if execution.mode == "emom":
        return execution.interval_seconds * execution.intervals
    return (execution.work_seconds + execution.rest_seconds) * execution.intervals


def supports_amrap(workout: WorkoutContent) -> bool:
    """The current native runner executes one time-capped circuit at a time."""
    return len(workout.blocks) == 1 and is_amrap(workout.blocks[0]) and bool(workout.blocks[0].exercises)


def supports_timed(workout: WorkoutContent) -> bool:
    """One typed timed block per workout until the player runs mixed sessions."""
    return len(workout.blocks) == 1 and is_timed(workout.blocks[0]) and bool(workout.blocks[0].exercises)


def timed_duration_minutes(workout: WorkoutContent) -> int | None:
    """An explicit format clock is usable; untimed warmup/other overhead stays unknown."""
    if not supports_timed(workout):
        return None
    seconds = block_seconds(workout.blocks[0])
    return None if seconds is None else (seconds + 59) // 60


def has_dose(block: WorkoutBlock, exercise) -> bool:
    """Reps, a rep scheme/ladder, time or distance; a work interval times each move."""
    return any(value is not None for value in (
        exercise.reps_min, exercise.reps_max, exercise.duration_seconds, exercise.distance_meters,
        exercise.rep_scheme, exercise.ladder,
    )) or (block.execution is not None and block.execution.mode == "work_rest")


def format_complete(block: WorkoutBlock) -> bool:
    """An interval format needs its count; Death by is open-ended by design."""
    execution = block.execution
    if execution is None or execution.mode in {"amrap", "for_time"}:
        return True
    if execution.intervals is not None:
        return True
    return execution.mode == "emom" and bool(block.exercises) and all(
        item.ladder is not None and item.ladder.end is None for item in block.exercises)
