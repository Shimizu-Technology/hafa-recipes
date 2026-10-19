import type { ActualSet, ExercisePrescription, SessionRequest, Workout } from "./models";
import { actualIdentity, type TrainingStep, type UnitSystem } from "./training";

/** Presentation helpers for the training screen. Pure, so the screen stays thin and testable. */

const groupingNames: Record<string, string> = { superset: "Superset", circuit: "Circuit", interval: "Intervals" };

/** Short human label for a block. Never exposes the raw grouping value. Null when it adds nothing. */
export function blockLabel(label: string, grouping: string, blockCount: number) {
  const name = label.trim();
  const kind = groupingNames[grouping];
  if (!kind) return blockCount > 1 && name ? name : null;
  if (!name || name.toLowerCase().includes(kind.toLowerCase().replace(/s$/, ""))) return name || kind;
  return `${name} · ${kind}`;
}

const sameExercise = (a: TrainingStep, b: TrainingStep) =>
  a.block_id === b.block_id && a.exercise_index === b.exercise_index && a.round_index === b.round_index;

/** "Set 2 of 4 · Round 1 of 3 · Left side", computed from the session's steps (including added sets). */
export function setPosition(steps: TrainingStep[], cursor: number, timed: boolean) {
  const step = steps[cursor];
  if (!step) return null;
  const side = step.side ? `${step.side === "left" ? "Left" : "Right"} side` : null;
  if (timed) {
    const exercises = new Set(steps.filter((s) => s.block_id === step.block_id).map((s) => s.exercise_index)).size;
    return [`Exercise ${step.exercise_index + 1} of ${exercises}`, side].filter(Boolean).join(" · ");
  }
  const sets = Math.max(...steps.filter((s) => sameExercise(s, step)).map((s) => s.set_index));
  const rounds = Math.max(...steps.filter((s) => s.block_id === step.block_id).map((s) => s.round_index));
  return [`Set ${step.set_index} of ${sets}`, rounds > 1 ? `Round ${step.round_index} of ${rounds}` : null, side]
    .filter(Boolean).join(" · ");
}

export type SetMark = { key: string; label: string; state: "done" | "skipped" | "current" | "upcoming" };
/** This exercise's sets in the current round: done, skipped, current and upcoming. */
export function exerciseSets(steps: TrainingStep[], cursor: number, actuals: ActualSet[]): SetMark[] {
  const step = steps[cursor];
  if (!step) return [];
  const recorded = new Map(actuals.map((a) => [actualIdentity(a), a]));
  return steps.flatMap((s, index) => {
    if (!sameExercise(s, step)) return [];
    const actual = recorded.get(s.key);
    const state = actual ? (actual.completed ? "done" : "skipped") : index === cursor ? "current" : "upcoming";
    return [{ key: s.key, label: `${s.set_index}${s.side ? (s.side === "left" ? "L" : "R") : ""}`, state }];
  });
}

/** The most recent completed set of this exercise and side in the current session. */
export function sessionPrevious(actuals: ActualSet[], step: TrainingStep | undefined) {
  if (!step) return null;
  for (let i = actuals.length - 1; i >= 0; i--) {
    const a = actuals[i];
    if (a.completed && a.block_id === step.block_id && a.exercise_index === step.exercise_index && (a.side ?? null) === step.side)
      return a;
  }
  return null;
}

const decimal = (value: number, places = 2) => String(Number(value.toFixed(places)));

/** Starting values for a set: the prescription first, then the previous logged set. Strings match the input record. */
export function prefillFor(exercise: ExercisePrescription, previous: ActualSet | null, units: UnitSystem) {
  const prefill: Record<string, string> = {};
  // The bottom of a range: a one-tap log must never claim top-of-range reps the user did not confirm.
  const reps = exercise.reps_min ?? exercise.reps_max ?? previous?.reps;
  if (reps != null) prefill.reps = String(reps);
  const seconds = exercise.duration_seconds ?? previous?.duration_seconds;
  if (seconds != null) prefill.seconds = String(seconds);
  const meters = exercise.distance_meters ?? previous?.distance_meters;
  if (meters != null) prefill.distance = units === "imperial" ? decimal(meters / 1609.344) : decimal(meters, 0);
  // A load is only valid with its unit and convention, so prefill all three from one source or none.
  const load = previous?.load != null && previous.load_unit && previous.load_convention ? previous
    : exercise.load != null && exercise.load_unit && exercise.load_convention ? exercise : null;
  if (load) Object.assign(prefill, { load: decimal(load.load!), load_unit: load.load_unit!, convention: load.load_convention! });
  return prefill;
}

export type Metric = "reps" | "time" | "distance";
const metricKeys: Record<Metric, string> = { reps: "reps", time: "seconds", distance: "distance" };
/**
 * What a set will save: explicit input wins (an empty string means the user cleared it), otherwise the prefill.
 * Prefill only applies to the metric on screen and load, so nothing hidden is saved.
 */
export function entryValues(prefill: Record<string, string>, input: Record<string, string>, metric: Metric) {
  const shown = new Set([metricKeys[metric], "load", "load_unit", "convention"]);
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(prefill)) if (shown.has(key)) values[key] = value;
  return { ...values, ...input };
}

/** Steps a typed number. Blank starts from zero; never goes below zero. */
export function stepValue(value: string, delta: number) {
  const current = Number(value.trim() || 0);
  return decimal(Math.max(0, (Number.isFinite(current) ? current : 0) + delta));
}

/** Rest is "done" for a short moment after it reaches zero, then the screen returns to logging. */
export function restPhase(until: number | null, now: number, doneMs = 3000): "idle" | "resting" | "done" {
  if (until == null) return "idle";
  if (now < until) return "resting";
  return now - until < doneMs ? "done" : "idle";
}

export const activityTypes = [
  { value: "strength_training", label: "Strength training" },
  { value: "general_fitness", label: "General fitness" },
  { value: "running", label: "Running" },
  { value: "walking", label: "Walking" },
  { value: "basketball", label: "Basketball" },
] as const;

const running = /\b(run(s|ning)?|jog(s|ging)?|sprints?)\b/i;
// "Walk", "walks", "walking", but not "walkout" or "walk-out".
const walking = /\bwalk(s|ing)?\b(?![-\s]?outs?\b)/i;
/**
 * Strength by default. Sessions made only of timed or distance work are running or walking when named so
 * (or measured by distance), otherwise general fitness.
 */
export function inferActivityType(workout: Workout) {
  const exercises = workout.blocks.flatMap((b) => b.exercises);
  const cardio = exercises.length > 0 && exercises.every((e) =>
    (e.distance_meters != null || e.duration_seconds != null) && e.reps_min == null && e.reps_max == null && e.load == null);
  if (!cardio) return "strength_training";
  const names = exercises.map((e) => e.name).join(" ");
  if (walking.test(names) && !running.test(names)) return "walking";
  return running.test(names) || exercises.some((e) => e.distance_meters != null) ? "running" : "general_fitness";
}

/** Totals for the post-session summary. */
export function sessionSummary(request: Pick<SessionRequest, "actuals" | "active_seconds">) {
  const done = request.actuals.filter((a) => a.completed);
  const minutes = Math.round((request.active_seconds ?? 0) / 60);
  return {
    sets: done.length,
    exercises: new Set(done.map((a) => `${a.block_id}:${a.exercise_index}`)).size,
    active: minutes >= 1 ? { value: minutes, unit: "min" } : { value: request.active_seconds ?? 0, unit: "sec" },
  };
}
