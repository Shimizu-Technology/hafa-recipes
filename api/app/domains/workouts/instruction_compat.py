"""Preserve omitted public instructions without promoting legacy private notes."""

from collections import Counter

from fastapi import HTTPException


def preserve_instructions(workout, original):
    updates = {}
    if "instructions" not in workout.model_fields_set:
        updates["instructions"] = original.get("instructions", [])
    old_blocks = {block["id"]: block for block in original.get("blocks", [])}
    blocks = []
    for block in workout.blocks:
        old_exercises = old_blocks.get(block.id, {}).get("exercises", [])
        # Block IDs plus an unambiguous movement identity survive reordering.
        # An array index cannot distinguish reordered or replaced movements.
        def identity(exercise):
            return exercise.get("exercise_id"), exercise["name"].strip().casefold()

        counts = Counter(identity(ex.model_dump()) for ex in block.exercises)
        exercises = []
        for exercise in block.exercises:
            if "instructions" not in exercise.model_fields_set:
                key = identity(exercise.model_dump())
                matches = [old for old in old_exercises if identity(old) == key]
                if any(old.get("instructions") for old in matches):
                    if len(matches) != 1 or counts[key] != 1:
                        raise HTTPException(409, "Refresh before editing repeated exercises with saved instructions")
                    exercise = exercise.model_copy(update={"instructions": matches[0]["instructions"]})
            exercises.append(exercise)
        blocks.append(block.model_copy(update={"exercises": exercises}))
    return workout.model_copy(update={**updates, "blocks": blocks})
