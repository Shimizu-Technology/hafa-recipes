import type { ActualSet, Workout } from "./models";
import type { TrainingStep, UnitSystem } from "./training";

/** Plain-language helpers for the focused set-logging layout. Pure, so they stay testable. */

export const loadConventions = [
  { value: "total", label: "Total weight" },
  { value: "per_hand", label: "Per hand" },
  { value: "added", label: "Added to bodyweight" },
  { value: "assistance", label: "Assistance" },
] as const;
export type LoadConvention = (typeof loadConventions)[number]["value"];
/** Weight is "total" unless the person picks otherwise, so a typed weight is always valid to save. */
export const defaultConvention: LoadConvention = "total";
export function conventionLabel(value: string | undefined | null) {
  return loadConventions.find((c) => c.value === value)?.label ?? loadConventions[0].label;
}

/**
 * Every completed set of this exercise and side from the most recent session that did it.
 * Matches the same way as `previousActual` (lib/training.ts): a shared exercise id, or the same
 * workout, position, name and per-side setting. History is newest first.
 */
export function previousSessionSets(
  workout: Workout,
  step: TrainingStep,
  history: Array<{ workout: Workout; actuals: ActualSet[] }>
): ActualSet[] {
  for (const session of history) {
    const matching = session.actuals.filter((actual) => {
      if (!actual.completed || (actual.side ?? null) !== step.side) return false;
      const prior = session.workout.blocks.find((b) => b.id === actual.block_id)?.exercises[actual.exercise_index];
      if (!prior) return false;
      if (step.exercise.exercise_id && prior.exercise_id) return step.exercise.exercise_id === prior.exercise_id;
      return (
        workout.id === session.workout.id &&
        actual.block_id === step.block_id &&
        actual.exercise_index === step.exercise_index &&
        prior.name === step.exercise.name &&
        prior.per_side === step.exercise.per_side
      );
    });
    if (matching.length) return matching;
  }
  return [];
}

const trim = (value: number, places = 2) => String(Number(value.toFixed(places)));
function distance(meters: number, units: UnitSystem) {
  if (units === "imperial") return `${trim(meters / 1609.344)} mi`;
  return meters >= 1000 ? `${trim(meters / 1000)} km` : `${trim(meters, 0)} m`;
}
function duration(seconds: number) {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : `${seconds}s`;
}
function amount(set: ActualSet, units: UnitSystem) {
  if (set.reps != null) return String(set.reps);
  if (set.duration_seconds != null) return duration(set.duration_seconds);
  if (set.distance_meters != null) return distance(set.distance_meters, units);
  return "";
}
function weight(set: ActualSet) {
  if (set.load == null) return "";
  const each = set.load_convention === "per_hand" ? " each" : set.load_convention === "added" ? " added" : "";
  return ` @ ${trim(set.load)} ${set.load_unit ?? ""}`.trimEnd() + each;
}

/** "3 × 10 @ 16 kg", "10, 10, 8 @ 16 kg" or "10 @ 16 kg, 8 @ 14 kg". Empty when nothing was recorded. */
export function setsLine(sets: ActualSet[], units: UnitSystem) {
  const parts = sets.map((s) => ({ amount: amount(s, units), weight: weight(s) })).filter((p) => p.amount || p.weight);
  if (!parts.length) return "";
  const sameWeight = parts.every((p) => p.weight === parts[0].weight);
  if (sameWeight && parts.every((p) => p.amount === parts[0].amount))
    return `${parts.length > 1 ? `${parts.length} × ` : ""}${parts[0].amount}${parts[0].weight}`.trim();
  if (sameWeight) return `${parts.map((p) => p.amount).join(", ")}${parts[0].weight}`;
  return parts.map((p) => `${p.amount}${p.weight}`.trim()).join(", ");
}

/** One-line summary of the optional "Notes & feel" answers, or null when none are set. */
export function feelSummary(input: Record<string, string>) {
  const parts = [
    input.effort?.trim() ? `Effort ${input.effort.trim()}/10` : null,
    input.difficulty ? input.difficulty.charAt(0).toUpperCase() + input.difficulty.slice(1) : null,
    input.pain === "yes" ? "Pain" : input.pain === "no" ? "No pain" : null,
    input.notes?.trim() ? "Note added" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
