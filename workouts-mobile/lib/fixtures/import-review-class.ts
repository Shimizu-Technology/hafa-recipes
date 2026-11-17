/** Synthetic class with the shape of Leon's import problem: an EMOM rotation with no mode and an alternating-sets part with no rounds. Test-only. */
import type { Workout } from "../models";

const base = {
  title: "Synthetic Gym · Core and conditioning",
  kind: "session",
  provenance: "source",
  capture_kind: "images",
  programming: { source_kind: "gym", app_name: "Synthetic", gym_name: "Synthetic Gym", track: "BUILD", date: "2026-11-17" },
  blocks: [
    { id: "a", label: "A. Strength", role: "main", grouping: "sequential",
      exercises: [{ name: "Back Squat", sets: 5, reps_min: 5, reps_max: 5 }] },
    { id: "b", label: "B. Every minute for 25 minutes", role: "main", grouping: "interval",
      instructions: ["Minute 1–5 rotation, five times through."],
      execution: { mode: "emom", interval_seconds: 60, intervals: 25, rotation: null },
      exercises: [
        { name: "Row", distance_meters: 250 }, { name: "Echo Bike", reps_min: 10, reps_max: 10 }, { name: "Burpee", reps_min: 8, reps_max: 8 },
        { name: "Sit-up", reps_min: 15, reps_max: 15 }, { name: "Dumbbell Thruster", reps_min: 10, reps_max: 10 } ] },
    { id: "c", label: "C. Accessories", role: "accessory", grouping: "superset",
      exercises: [{ name: "Side Plank", duration_seconds: 30 }, { name: "Cable Face Pull", reps_min: 12, reps_max: 12 }] },
  ],
};
export const importReviewClass = { id: "synthetic", revision: 1, generation: 1, ...(base as object) } as Workout;
/** The same EMOM without any "Minute n" wording: nothing says whether the moves alternate. */
export const importReviewClassNoRotationClue = {
  ...importReviewClass,
  blocks: importReviewClass.blocks.map(block => block.id === "b" ? { ...block, instructions: [] } : block),
} as Workout;
export const importReviewWarnings = [
  "Part C was read from the page layout because the import left it out; review it.",
  "B. Every minute for 25 minutes: each minute lists a different group of movements; check the minute order.",
  "Lines that read like member results or comments were left out of the coach notes.",
];
