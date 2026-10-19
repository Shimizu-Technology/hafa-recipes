import type { Workout } from "./models";

type Origin = Pick<Workout, "provenance" | "source_url" | "source_creator" | "capture_kind" | "revision" | "blocks">;

export function hasWorkoutSource(workout: Origin) {
  return workout.provenance === "source" || !!workout.source_url || !!workout.source_creator || !!workout.capture_kind;
}

export function workoutOriginLabel(workout: Origin) {
  if (workout.provenance === "suggestion") return "Suggested workout";
  return hasWorkoutSource(workout) ? "Saved from a source" : "Your workout";
}

export function workoutOriginDescription(workout: Origin) {
  if (workout.provenance === "suggestion") return "Suggested workout. Review it before training.";
  if (!hasWorkoutSource(workout)) return "Your manually entered workout.";
  if (workout.provenance !== "source") return "Saved source workout. Your edits stay in this copy.";
  return workout.revision > 1 || workout.blocks.some(block => block.exercises.some(exercise => exercise.provenance === "user"))
    ? "Saved source workout with your corrections."
    : "Original source workout. Missing details stay missing.";
}
