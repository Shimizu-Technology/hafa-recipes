import { expect, it } from "vitest";
import type { ActualSet, Workout } from "./models";
import type { TrainingStep } from "./training";
import { feelSummary, previousSessionSets, setsLine } from "./set-logging";

const set = (reps: number | null, load?: number, extra: Partial<ActualSet> = {}): ActualSet => ({
  block_id: "main", exercise_index: 0, set_index: 1, round_index: 1, side: null, completed: true, reps,
  ...(load != null ? { load, load_unit: "kg", load_convention: "total" } : {}), ...extra });

it("summarises last time compactly", () => {
  expect(setsLine([set(10, 16), set(10, 16), set(10, 16)], "metric")).toBe("3 × 10 @ 16 kg");
  expect(setsLine([set(10, 16), set(10, 16), set(8, 16)], "metric")).toBe("10, 10, 8 @ 16 kg");
  expect(setsLine([set(10, 16), set(8, 14)], "metric")).toBe("10 @ 16 kg, 8 @ 14 kg");
  expect(setsLine([set(12)], "metric")).toBe("12");
  expect(setsLine([set(8, 12, { load_convention: "per_hand" })], "metric")).toBe("8 @ 12 kg each");
  expect(setsLine([set(null, undefined, { duration_seconds: 45 }), set(null, undefined, { duration_seconds: 90 })], "metric")).toBe("45s, 1:30");
  expect(setsLine([set(null, undefined, { distance_meters: 1609.344 })], "imperial")).toBe("1 mi");
  expect(setsLine([set(null, undefined, { distance_meters: 400 })], "metric")).toBe("400 m");
  expect(setsLine([], "metric")).toBe("");
});

it("finds every completed set of the same exercise and side from the latest matching session", () => {
  const workout: Workout = { id: "w", generation: 1, revision: 1, title: "W", kind: "session", provenance: "user",
    blocks: [{ id: "main", label: "Main", grouping: "sequential", exercises: [{ name: "Row", sets: 3 }] }] };
  const step: TrainingStep = { key: "k", block_id: "main", block_label: "Main", grouping: "sequential", exercise_index: 0,
    round_index: 1, set_index: 1, target_set: 1, side: null, exercise: workout.blocks[0].exercises[0] };
  const newest = [set(9), set(null, undefined, { completed: false }), set(7)];
  expect(previousSessionSets(workout, step, [{ workout, actuals: [] }, { workout, actuals: newest }, { workout, actuals: [set(5)] }])
    .map((s) => s.reps)).toEqual([9, 7]);
  expect(previousSessionSets(workout, { ...step, side: "left" }, [{ workout, actuals: newest }])).toEqual([]);
  expect(previousSessionSets(workout, step, [{ workout: { ...workout, id: "other" }, actuals: newest }])).toEqual([]);
});

it("summarises Notes & feel answers in plain words", () => {
  expect(feelSummary({})).toBeNull();
  expect(feelSummary({ effort: "7", difficulty: "manageable", pain: "no", notes: "Grip slipped" }))
    .toBe("Effort 7/10 · Manageable · No pain · Note added");
});
