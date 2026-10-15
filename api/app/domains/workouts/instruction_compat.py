"""Preserve omitted public instructions without promoting legacy private notes."""

from collections import Counter

from fastapi import HTTPException


def preserve_instructions(workout, original):
    updates = {}
    if "instructions" not in workout.model_fields_set and "instructions" in original:
        updates["instructions"] = original["instructions"]
    old_blocks = {block["id"]: block for block in original.get("blocks", [])}
    blocks = []
    for block in workout.blocks:
        old_exercises = old_blocks.get(block.id, {}).get("exercises", [])
        # Block IDs plus an unambiguous movement identity survive reordering.
        # An array index cannot distinguish reordered or replaced movements.
        def identity(exercise):
            return exercise.get("exercise_id"), exercise["name"].strip().casefold()

        counts = Counter(identity(ex.model_dump()) for ex in block.exercises)
        name_counts = Counter(ex.name.strip().casefold() for ex in block.exercises)
        exercises = []
        for exercise in block.exercises:
            if "instructions" not in exercise.model_fields_set:
                key = identity(exercise.model_dump())
                matches = [old for old in old_exercises if identity(old)[1] == key[1]
                           and (key[0] is None or identity(old)[0] == key[0])]
                if any(old.get("instructions") for old in matches):
                    count = name_counts[key[1]] if key[0] is None else counts[key]
                    if len(matches) != 1 or count != 1:
                        raise HTTPException(409, "Refresh before editing repeated exercises with saved instructions")
                    exercise = exercise.model_copy(update={"instructions": matches[0]["instructions"]})
            exercises.append(exercise)
        blocks.append(block.model_copy(update={"exercises": exercises}))
    return workout.model_copy(update={**updates, "blocks": blocks})
