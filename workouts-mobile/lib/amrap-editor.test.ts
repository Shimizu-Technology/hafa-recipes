import { expect, it } from "vitest";
import { amrapCap, blockSummary, changeExecution, changeGrouping, changeTimeCap, executionError, parseCap } from "./amrap-editor";
import type { AuthoredWorkout, Workout } from "./models";
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

type Block = Workout["blocks"][number];
const block = (over: Partial<Block>): Block => ({ id: "b", label: "Main", grouping: "sequential", exercises: [], ...over }) as Block;
it("summarises grouping in words, never the raw value", () => {
  expect(blockSummary(block({ grouping: "superset", rounds: 4 }))).toBe("Superset · 4 rounds");
  expect(blockSummary(block({ grouping: "interval" }))).toBe("Intervals");
  expect(blockSummary(block({ grouping: "sequential", rounds: 1 }))).toBe("Straight sets · 1 round");
});
it("leaves out a grouping word the block label already says", () => {
  expect(blockSummary(block({ grouping: "superset", rounds: 4 }), "Superset A")).toBe("4 rounds");
  expect(blockSummary(block({ grouping: "circuit" }), "Finisher circuit")).toBe("");
});
it("keeps the AMRAP time-cap summary", () => {
  expect(blockSummary(workout.blocks[0] as Block)).toMatch(/^AMRAP · /);
});

it("round-trips typed formats without dropping their values or rep patterns", async () => {
  const { changeFormat, changeFormatFields, formatChoice, parseRepScheme } = await import("./amrap-editor");
  const base = { title: "T", kind: "session" as const, provenance: "source" as const, estimated_minutes: 20,
    blocks: [{ id: "b", label: "EMOM", grouping: "interval" as const, rounds: null,
      execution: { mode: "emom" as const, interval_seconds: 60, intervals: 20, rotation: null },
      exercises: [{ name: "Burpees", ladder: { start: 1, step: 1, end: null } }] }] };
  expect(formatChoice(base.blocks[0])).toBe("emom");
  expect(changeFormat(base, 0, "emom")).toBe(base);
  // A length the person set themselves isn't overwritten.
  expect(changeFormatFields({ ...base, estimated_minutes: 30 }, 0, { intervals: 10 }).estimated_minutes).toBe(30);
  expect(changeFormatFields(base, 0, { interval_seconds: 120, intervals: 6 })).toMatchObject({ estimated_minutes: 12,
    blocks: [{ execution: { mode: "emom", interval_seconds: 120, intervals: 6, rotation: null }, exercises: [{ ladder: { start: 1, step: 1, end: null } }] }] });
  expect(changeFormat(base, 0, "amrap").blocks[0]).toMatchObject({ grouping: "circuit", rounds: null, execution: { mode: "amrap" } });
  expect(parseRepScheme("21-15-9")).toEqual([21, 15, 9]);
  expect(parseRepScheme("10, 8, 6, 4")).toEqual([10, 8, 6, 4]);
  expect(parseRepScheme("")).toBeNull();
  expect(parseRepScheme("21")).toBeUndefined();
});

it("switches timers without assuming a rotation, keeps the length without a new clock, and clears a newer server's timer", async () => {
  const { changeFormat, changeRepScheme, executionError, repSchemeEntry } = await import("./amrap-editor");
  const two = { title: "T", kind: "session" as const, provenance: "source" as const, estimated_minutes: 20,
    blocks: [{ id: "b", label: "Main", grouping: "interval" as const, rounds: null,
      execution: { mode: "emom" as const, interval_seconds: 60, intervals: 20, rotation: "alternating" as const },
      exercises: [{ name: "Burpees", reps_min: 10 }, { name: "Squats", reps_min: 15 }] }] };
  const none = changeFormat(two, 0, "none");
  // The 20 minutes may be the person's own estimate, and no timer gives nothing to replace it with.
  expect(none.estimated_minutes).toBe(20);
  const emom = changeFormat(none, 0, "emom");
  expect(emom.blocks[0].execution).toEqual({ mode: "emom", interval_seconds: 60, intervals: null, rotation: null });
  expect(executionError(emom.blocks[0])).toMatch(/Choose whether to alternate/);
  expect(executionError({ ...emom.blocks[0], exercises: [emom.blocks[0].exercises[0]] })).toBeNull();
  // A new clock still replaces a length that came from the old one.
  expect(changeFormat(two, 0, "work_rest").estimated_minutes).toBe(4);
  const future = { ...two, blocks: [{ ...two.blocks[0], execution: { mode: "chipper_v2", minutes: 9 } as never }] };
  expect(executionError(future.blocks[0])).toBeNull();
  expect(changeFormat(future, 0, "none").blocks[0].execution).toBeUndefined();
  // For time: blank rounds come from the scheme; set rounds stay.
  const forTime = changeFormat({ ...two, blocks: [{ ...two.blocks[0], execution: undefined }] }, 0, "for_time");
  const schemed = changeRepScheme(forTime, 0, 0, [21, 15, 9]).blocks[0];
  expect(schemed.rounds).toBe(3);
  expect(schemed.exercises[0]).toMatchObject({ rep_scheme: [21, 15, 9], reps_min: null });
  expect(changeRepScheme({ ...forTime, blocks: [{ ...forTime.blocks[0], rounds: 5 }] }, 0, 0, [21, 15, 9]).blocks[0].rounds).toBe(5);
  expect(executionError(changeRepScheme({ ...forTime, blocks: [{ ...forTime.blocks[0], rounds: 5 }] }, 0, 0, [21, 15, 9]).blocks[0]))
    .toBe("Reps per round list 3 rounds, but the block has 5 rounds. Make them match.");
  expect(repSchemeEntry("21-15-x")).toEqual([21, 15, NaN]);
  expect(repSchemeEntry(" ")).toBeNull();
  expect(repSchemeEntry("21, 15, 9")).toEqual([21, 15, 9]);
});
