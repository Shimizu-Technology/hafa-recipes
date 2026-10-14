"""Typed workout execution shared by source extraction and personal planning."""

from app.domains.workouts.schemas import WorkoutBlock, WorkoutContent


def is_amrap(block: WorkoutBlock) -> bool:
    return (block.grouping == "circuit" and block.rounds is None
            and block.execution is not None and block.execution.mode == "amrap")


def supports_amrap(workout: WorkoutContent) -> bool:
    """The current native runner executes one time-capped circuit at a time."""
    return len(workout.blocks) == 1 and is_amrap(workout.blocks[0]) and bool(workout.blocks[0].exercises)


def timed_duration_minutes(workout: WorkoutContent) -> int | None:
    """An explicit time cap is usable; untimed warmup/other overhead stays unknown."""
    if not supports_amrap(workout):
        return None
    seconds = workout.blocks[0].execution.time_cap_seconds
    return (seconds + 59) // 60
