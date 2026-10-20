import { expect, it } from "vitest";
import type { ActualSet, Workout } from "./models";
import { exerciseLines, exerciseRecords, friendlyDate, setLabel, weekStreak } from "./progress-insights";

const workout: Workout = { id: "w", generation: 1, revision: 1, title: "Strength", kind: "session", provenance: "user",
  blocks: [{ id: "main", label: "Main", grouping: "sequential", exercises: [
    { name: "Goblet squat", sets: 3 }, { name: "Plank", sets: 1 }, { name: "Pull-up", sets: 2 }] }] };
const set = (exercise_index: number, extra: Partial<ActualSet>): ActualSet => ({ block_id: "main", exercise_index, set_index: 1,
  round_index: 1, side: null, completed: true, ...extra });
const kg = (load: number, reps: number, unit: "kg" | "lb" = "kg") => set(0, { reps, load, load_unit: unit, load_convention: "total" });

it("writes dates the way people say them", () => {
  const now = new Date(2026, 9, 21, 12);
  expect(friendlyDate(new Date(2026, 9, 21, 7).toISOString(), now)).toBe("Today");
  expect(friendlyDate(new Date(2026, 9, 20, 22).toISOString(), now)).toBe("Yesterday");
  expect(friendlyDate(new Date(2026, 9, 14, 9).toISOString(), now)).toBe("Wed, Oct 14");
  expect(friendlyDate(new Date(2025, 11, 30, 9).toISOString(), now)).toBe("Tue, Dec 30, 2025");
  expect(friendlyDate("not a date", now)).toBe("");
});

it("counts weeks in a row without breaking on a week that has not trained yet", () => {
  const now = new Date(2026, 9, 21, 12); // Wednesday
  const at = (month: number, date: number, recorded = true) => ({ started_at: new Date(2026, month, date, 8).toISOString(), recorded });
  expect(weekStreak([], now)).toBe(0);
  expect(weekStreak([at(9, 19), at(9, 13), at(9, 6)], now)).toBe(3);
  expect(weekStreak([at(9, 13), at(9, 6)], now)).toBe(2);
  expect(weekStreak([at(9, 19), at(9, 6)], now)).toBe(1);
  expect(weekStreak([at(9, 19, false)], now)).toBe(0);
});

it("summarises each exercise on one line", () => {
  expect(exerciseLines({ actuals: [kg(16, 10), kg(16, 8), set(1, { duration_seconds: 75 }), set(2, { completed: false })] }, workout, "metric"))
    .toEqual(["Goblet squat · 10, 8 reps @ 16 kg", "Plank · 1:15"]);
});

it("finds heaviest and most reps per exercise across sessions, with a trend in the same measure", () => {
  const sessions = [
    { request: { started_at: "2026-10-01T08:00:00Z", actuals: [kg(16, 10), kg(16, 10), set(2, { reps: 5 })] }, workout },
    { request: { started_at: "2026-10-08T08:00:00Z", actuals: [kg(20, 8), kg(40, 6, "lb"), set(0, { reps: 15 })] }, workout },
    { request: { started_at: "2026-10-15T08:00:00Z", actuals: [kg(20, 9), set(2, { reps: 7 }), set(1, { duration_seconds: 60 })] }, workout },
  ];
  const records = exerciseRecords(sessions, "metric");
  expect(records.map((r) => r.name)).toEqual(["Goblet squat", "Pull-up", "Plank"]);
  expect(records[0]).toMatchObject({ best: "20 kg × 9", detail: "Most reps 15 · 3 sessions", trend: [16, 20, 20] });
  expect(records[1]).toMatchObject({ best: "7 reps", detail: "2 sessions", trend: [5, 7] });
  expect(records[2]).toMatchObject({ best: "1:00", trend: [60] });
});

it("skips assistance weight for heaviest and matches exercises by library id first", () => {
  const assisted: Workout = { ...workout, blocks: [{ id: "main", label: "Main", grouping: "sequential",
    exercises: [{ name: "Assisted pull-up", exercise_id: "ex-1", sets: 1 }] }] };
  const renamed: Workout = { ...assisted, blocks: [{ ...assisted.blocks[0], exercises: [{ name: "Pull-up (band)", exercise_id: "ex-1", sets: 1 }] }] };
  const records = exerciseRecords([
    { request: { started_at: "2026-10-01T08:00:00Z", actuals: [set(0, { reps: 6, load: 30, load_unit: "kg", load_convention: "assistance" })] }, workout: assisted },
    { request: { started_at: "2026-10-02T08:00:00Z", actuals: [set(0, { reps: 8 })] }, workout: renamed },
  ], "metric");
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ name: "Pull-up (band)", best: "8 reps", detail: "2 sessions" });
});

it("counts streak weeks in the account timezone", () => {
  // Sunday 20:00 in Los Angeles is already Monday in Guam.
  const sundayEvening = { started_at: "2026-10-19T03:00:00Z", recorded: true };
  const now = new Date("2026-10-21T02:00:00Z");
  expect(weekStreak([sundayEvening, { started_at: "2026-10-08T03:00:00Z", recorded: true }], now, "Pacific/Guam")).toBe(1);
  expect(weekStreak([sundayEvening, { started_at: "2026-10-08T03:00:00Z", recorded: true }], now, "America/Los_Angeles")).toBe(2);
});

it("labels recorded sets by their own set number, side and round", () => {
  expect(setLabel({ set_index: 1, round_index: 1, side: "right" }, false)).toBe("1R");
  expect(setLabel({ set_index: 2, round_index: 1, side: null }, false)).toBe("2");
  expect(setLabel({ set_index: 1, round_index: 3, side: null }, true)).toBe("R3 · 1");
});
