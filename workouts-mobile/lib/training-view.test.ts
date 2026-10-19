import { describe, expect, it } from "vitest";
import { stepsFor } from "./training";
import type { ActualSet, Workout } from "./models";
import {
  blockLabel, entryValues, exerciseSets, inferActivityType, prefillFor, restPhase, sessionPrevious, sessionSummary, setPosition, stepValue,
} from "./training-view";

const workout = (blocks: Workout["blocks"]): Workout =>
  ({ id: "w", revision: 1, generation: 1, title: "W", kind: "session", provenance: "user", blocks });
const done = (step: { block_id: string; exercise_index: number; round_index: number; set_index: number; side: "left" | "right" | null },
  extra: Partial<ActualSet> = {}): ActualSet => ({ ...step, completed: true, reps: 8, ...extra });

describe("blockLabel", () => {
  it("maps grouping to human words and never shows the raw value", () => {
    expect(blockLabel("Main", "superset", 1)).toBe("Main · Superset");
    expect(blockLabel("Finisher", "interval", 2)).toBe("Finisher · Intervals");
    expect(blockLabel("Circuit A", "circuit", 1)).toBe("Circuit A");
    expect(blockLabel("", "circuit", 1)).toBe("Circuit");
    expect(blockLabel("Interval block", "interval", 1)).toBe("Interval block");
  });
  it("hides a lone sequential block and keeps named blocks when there are several", () => {
    expect(blockLabel("Main", "sequential", 1)).toBeNull();
    expect(blockLabel("Warm-up", "sequential", 3)).toBe("Warm-up");
    expect(blockLabel("Warm-up", "anything_else", 3)).toBe("Warm-up");
  });
});

describe("setPosition", () => {
  it("counts sets and rounds from the plan, including sides", () => {
    const steps = stepsFor(workout([{ id: "a", label: "A", grouping: "superset", rounds: 3,
      exercises: [{ name: "Row", sets: 2, reps_min: 8 }, { name: "Lunge", sets: 2, reps_min: 8, per_side: true }] }]));
    expect(setPosition(steps, 0, false)).toBe("Set 1 of 2 · Round 1 of 3");
    const lunge = steps.findIndex((s) => s.exercise_index === 1 && s.side === "right" && s.set_index === 2 && s.round_index === 2);
    expect(setPosition(steps, lunge, false)).toBe("Set 2 of 2 · Round 2 of 3 · Right side");
    expect(setPosition(steps, steps.length, false)).toBeNull();
  });
  it("omits a single round and names timed exercises by position", () => {
    const steps = stepsFor(workout([{ id: "a", label: "A", grouping: "sequential", exercises: [{ name: "Squat", sets: 4, reps_min: 5 }] }]));
    expect(setPosition(steps, 1, false)).toBe("Set 2 of 4");
    const circuit = stepsFor(workout([{ id: "c", label: "C", grouping: "circuit",
      exercises: [{ name: "A", reps_min: 5 }, { name: "B", reps_min: 5 }, { name: "C", reps_min: 5 }] }]));
    expect(setPosition(circuit, 1, true)).toBe("Exercise 2 of 3");
  });
});

describe("exerciseSets", () => {
  it("marks done, skipped, current and upcoming sets of the current exercise only", () => {
    const steps = stepsFor(workout([{ id: "a", label: "A", grouping: "sequential",
      exercises: [{ name: "Squat", sets: 4, reps_min: 5 }, { name: "Press", sets: 2, reps_min: 5 }] }]));
    const actuals = [done(steps[0]), { ...done(steps[1]), completed: false, reps: null }];
    expect(exerciseSets(steps, 2, actuals).map((s) => [s.label, s.state]))
      .toEqual([["1", "done"], ["2", "skipped"], ["3", "current"], ["4", "upcoming"]]);
    expect(exerciseSets(steps, 4, actuals)).toHaveLength(2);
    expect(exerciseSets(steps, 6, actuals)).toEqual([]);
  });
});

describe("prefill", () => {
  const steps = stepsFor(workout([{ id: "a", label: "A", grouping: "sequential", exercises: [{ name: "Squat", sets: 3, reps_min: 8 }] }]));
  it("uses the bottom of the prescribed range, else the previous set", () => {
    expect(prefillFor({ name: "Squat", reps_min: 8, reps_max: 12 }, null, "metric")).toEqual({ reps: "8" });
    expect(prefillFor({ name: "Squat", reps_max: 12 }, null, "metric")).toEqual({ reps: "12" });
    expect(prefillFor({ name: "Squat", reps_min: 8 }, done(steps[0], { reps: 6 }), "metric")).toEqual({ reps: "8" });
    expect(prefillFor({ name: "Squat" }, done(steps[0], { reps: 6 }), "metric")).toEqual({ reps: "6" });
    expect(prefillFor({ name: "Plank", duration_seconds: 45 }, null, "metric")).toEqual({ seconds: "45" });
    expect(prefillFor({ name: "Run", distance_meters: 1609.344 }, null, "imperial")).toEqual({ distance: "1" });
    expect(prefillFor({ name: "Run", distance_meters: 400 }, null, "metric")).toEqual({ distance: "400" });
  });
  it("prefills load only with its unit and convention, preferring the previous set", () => {
    const previous = done(steps[0], { load: 62.5, load_unit: "kg", load_convention: "total" });
    expect(prefillFor({ name: "Squat", reps_min: 5, load: 60, load_unit: "kg", load_convention: "total" }, previous, "imperial"))
      .toMatchObject({ load: "62.5", load_unit: "kg", convention: "total" });
    expect(prefillFor({ name: "Squat", reps_min: 5, load: 60, load_unit: "kg", load_convention: "total" }, null, "metric"))
      .toMatchObject({ load: "60", load_unit: "kg", convention: "total" });
    expect(prefillFor({ name: "Squat", reps_min: 5, load: 60, load_unit: "kg" }, null, "metric")).toEqual({ reps: "5" });
  });
  it("finds the latest completed set of the same exercise and side in this session", () => {
    const lunges = stepsFor(workout([{ id: "a", label: "A", grouping: "sequential", exercises: [{ name: "Lunge", sets: 2, per_side: true, reps_min: 8 }] }]));
    const actuals = [done(lunges[0], { reps: 7 }), done(lunges[1], { reps: 9 })];
    expect(sessionPrevious(actuals, lunges[2])?.reps).toBe(7);
    expect(sessionPrevious(actuals, lunges[3])?.reps).toBe(9);
    expect(sessionPrevious([], lunges[0])).toBeNull();
  });
  it("lets typed and cleared input win and never saves a hidden metric", () => {
    const prefill = { reps: "10", seconds: "30", load: "20", load_unit: "kg", convention: "total" };
    expect(entryValues(prefill, {}, "reps")).toEqual({ reps: "10", load: "20", load_unit: "kg", convention: "total" });
    expect(entryValues(prefill, { reps: "" }, "reps").reps).toBe("");
    expect(entryValues(prefill, { reps: "7" }, "time")).toMatchObject({ reps: "7", seconds: "30" });
  });
});

it("steps values without going negative", () => {
  expect(stepValue("10", 1)).toBe("11");
  expect(stepValue("", 1)).toBe("1");
  expect(stepValue("0", -1)).toBe("0");
  expect(stepValue("1.2", 0.1)).toBe("1.3");
  expect(stepValue("57.5", 2.5)).toBe("60");
  expect(stepValue("abc", 5)).toBe("5");
});

it("shows rest done briefly after the timer reaches zero", () => {
  expect(restPhase(null, 1000)).toBe("idle");
  expect(restPhase(5000, 4000)).toBe("resting");
  expect(restPhase(5000, 5000)).toBe("done");
  expect(restPhase(5000, 7999)).toBe("done");
  expect(restPhase(5000, 8000)).toBe("idle");
});

describe("inferActivityType", () => {
  const timed = (name: string) => workout([{ id: "a", label: "A", grouping: "sequential", exercises: [{ name, duration_seconds: 60 }] }]);
  it("defaults to strength and recognises distance or time cardio", () => {
    expect(inferActivityType(workout([{ id: "a", label: "A", grouping: "sequential", exercises: [{ name: "Squat", reps_min: 5 }] }])))
      .toBe("strength_training");
    expect(inferActivityType(timed("Plank"))).toBe("general_fitness");
    expect(inferActivityType(timed("Plank walkout"))).toBe("general_fitness");
    expect(inferActivityType(timed("Walk-out to push-up"))).toBe("general_fitness");
    expect(inferActivityType(timed("Walk outs"))).toBe("general_fitness");
    expect(inferActivityType(timed("Walking lunge hold"))).toBe("walking");
    expect(inferActivityType(timed("Runway shuffle"))).toBe("general_fitness");
    expect(inferActivityType(timed("Running intervals"))).toBe("running");
    expect(inferActivityType(workout([{ id: "a", label: "A", grouping: "interval", exercises: [{ name: "Easy jog", duration_seconds: 600 }] }])))
      .toBe("running");
    expect(inferActivityType(workout([{ id: "a", label: "A", grouping: "sequential", exercises: [{ name: "Repeats", distance_meters: 400 }] }])))
      .toBe("running");
    expect(inferActivityType(workout([{ id: "a", label: "A", grouping: "sequential", exercises: [{ name: "Brisk walk", duration_seconds: 1800 }] }])))
      .toBe("walking");
    expect(inferActivityType(workout([{ id: "a", label: "A", grouping: "sequential",
      exercises: [{ name: "Run", distance_meters: 1000 }, { name: "Push-up", reps_min: 10 }] }]))).toBe("strength_training");
    expect(inferActivityType(workout([]))).toBe("strength_training");
  });
});

it("summarises completed sets, distinct exercises and active time", () => {
  const steps = stepsFor(workout([{ id: "a", label: "A", grouping: "sequential",
    exercises: [{ name: "Squat", sets: 2, reps_min: 5 }, { name: "Press", sets: 1, reps_min: 5 }] }]));
  const actuals = [done(steps[0]), done(steps[1]), { ...done(steps[2]), completed: false, reps: null }];
  expect(sessionSummary({ actuals, active_seconds: 1830 })).toEqual({ sets: 2, exercises: 1, active: { value: 31, unit: "min" } });
  expect(sessionSummary({ actuals: [], active_seconds: 25 })).toEqual({ sets: 0, exercises: 0, active: { value: 25, unit: "sec" } });
});
