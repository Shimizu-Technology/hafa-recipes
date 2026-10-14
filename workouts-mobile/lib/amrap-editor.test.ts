import { expect, it } from "vitest";
import { amrapCap, changeExecution, changeGrouping, changeTimeCap, executionError, parseCap } from "./amrap-editor";
import type { AuthoredWorkout } from "./models";
const workout: AuthoredWorkout = { title: "Flow", kind: "session", provenance: "source", estimated_minutes: 20,
  notes: ["Repeat for 20 minutes"], blocks: [{ id: "flow", label: "Flow", grouping: "circuit",
    execution: { mode: "amrap", time_cap_seconds: 1200 }, exercises: [{ name: "Row", sets: 2, reps_min: 10 }] }] };
it("updates only a single circuit's unset or inherited estimate when its cap changes", () => {
  expect(changeTimeCap(workout, 0, 900).estimated_minutes).toBe(15);
  expect(changeTimeCap({ ...workout, estimated_minutes: null }, 0, 900).estimated_minutes).toBe(15);
  expect(changeTimeCap({ ...workout, estimated_minutes: 25 }, 0, 900).estimated_minutes).toBe(25);
  expect(changeTimeCap({ ...workout, blocks: [...workout.blocks, workout.blocks[0]] }, 0, 900).estimated_minutes).toBe(20);
  expect(changeTimeCap(workout, 0, 90).estimated_minutes).toBeNull();
  expect(changeTimeCap(workout, 0, 900).notes).toEqual(workout.notes);
});
it("does not invent fixed rounds or alter exercise sets/reps when changing execution", () => {
  const fixed = { ...workout, blocks: [{ ...workout.blocks[0], execution: undefined, rounds: 4 }] };
  expect(changeExecution(fixed, 0, false)).toEqual(fixed);
  const timed = changeExecution(fixed, 0, true);
  expect(timed.blocks[0]).toMatchObject({ rounds: null, execution: { mode: "amrap", time_cap_seconds: 0 }, exercises: fixed.blocks[0].exercises });
  expect(executionError(timed.blocks[0])).toContain("time cap");
  expect(changeExecution(workout, 0, false).blocks[0].rounds).toBeUndefined();
  expect(changeGrouping(workout, 0, "interval").blocks[0].execution).toBeUndefined();
});
it.each([0, -1, 86401, 0.5, NaN, Infinity, null])("rejects invalid cap %s", seconds => {
  expect(executionError({ ...workout.blocks[0], execution: { mode: "amrap", time_cap_seconds: seconds as number } })).toContain("time cap");
});
it("supports exact source seconds, decimal minutes and API cap boundaries", () => {
  expect(parseCap("1.5", "minutes")).toBe(90);
  expect(parseCap("125", "seconds")).toBe(125);
  expect(amrapCap(changeTimeCap(workout, 0, 125).blocks[0])).toBe(125);
  expect(executionError(changeTimeCap(workout, 0, 1).blocks[0])).toBeNull();
  expect(executionError(changeTimeCap(workout, 0, 86400).blocks[0])).toBeNull();
  expect(executionError({ ...workout.blocks[0], rounds: 3 })).toContain("not both");
  expect(executionError({ ...workout.blocks[0], grouping: "interval" })).toContain("requires a circuit");
});
