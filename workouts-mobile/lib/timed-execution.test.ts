import { describe, expect, it } from "vitest";
import type { Workout } from "./models";
import { formatLabel, formatScore, ladderReps, movesFor, repsFor, timedFormat, timedFormatProblem } from "./timed-execution";
import { blockSummary, executionError } from "./amrap-editor";

type Block = Workout["blocks"][number];
const block = (execution: Block["execution"], extra: Partial<Block> = {}): Block =>
  ({ id: "main", label: "Main", grouping: "interval", execution, exercises: [{ name: "Burpees", reps_min: 10 }], ...extra });

describe("format labels", () => {
  it("names each format the way people write it", () => {
    expect(formatLabel(block({ mode: "emom", interval_seconds: 60, intervals: 20, rotation: null }))).toBe("EMOM 20");
    expect(formatLabel(block({ mode: "emom", interval_seconds: 120, intervals: 6, rotation: null }))).toBe("E2MOM × 6");
    expect(formatLabel(block({ mode: "emom", interval_seconds: 90, intervals: 10, rotation: null }))).toBe("Every 1m 30s × 10");
    expect(formatLabel(block({ mode: "emom", interval_seconds: 60, intervals: null, rotation: null },
      { exercises: [{ name: "Burpees", ladder: { start: 1, step: 1, end: null } }] }))).toBe("Death by");
    expect(formatLabel(block({ mode: "for_time", time_cap_seconds: 720 }, { grouping: "circuit", rounds: 3,
      exercises: [{ name: "Thrusters", rep_scheme: [21, 15, 9] }, { name: "Pull-ups", rep_scheme: [21, 15, 9] }] }))).toBe("21-15-9 for time · cap 12");
    expect(formatLabel(block({ mode: "for_time", time_cap_seconds: null }, { rounds: 5 }))).toBe("5 rounds for time");
    expect(formatLabel(block({ mode: "for_time", time_cap_seconds: 1200 }))).toBe("For time · cap 20");
    expect(formatLabel(block({ mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 }))).toBe("Tabata 4 min");
    expect(formatLabel(block({ mode: "work_rest", work_seconds: 40, rest_seconds: 20, intervals: 8 }))).toBe("40s on / 20s off × 8");
    expect(formatLabel(block({ mode: "amrap", time_cap_seconds: 900 }, { grouping: "circuit" }))).toBe("AMRAP 15");
    expect(formatLabel(block(undefined))).toBeNull();
  });
  it("summarises blocks without blocking a mode from a newer server", () => {
    expect(blockSummary(block({ mode: "emom", interval_seconds: 60, intervals: 12, rotation: "alternating" },
      { exercises: [{ name: "Burpees" }, { name: "Squats" }] }))).toBe("EMOM 12 · alternating moves");
    expect(blockSummary(block({ mode: "emom", interval_seconds: 60, intervals: 20, rotation: null }), "EMOM 20")).toBe("");
    expect(blockSummary(block({ mode: "for_time", time_cap_seconds: 720 }, { rounds: 3,
      exercises: [{ name: "Thrusters", rep_scheme: [21, 15, 9] }] }), "21-15-9 for time")).toBe("cap 12");
    const future = block({ mode: "ladder_race" } as never, { grouping: "circuit" });
    expect(executionError(future)).toBeNull();
    expect(blockSummary(future)).toBe("Circuit · ladder race");
  });
});

describe("validation", () => {
  it("accepts every typed mode outside a circuit and keeps AMRAP's own rules", () => {
    expect(executionError(block({ mode: "emom", interval_seconds: 60, intervals: 20, rotation: null }))).toBeNull();
    expect(executionError(block({ mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 }))).toBeNull();
    expect(executionError(block({ mode: "for_time", time_cap_seconds: null }, { grouping: "sequential", rounds: 5 }))).toBeNull();
    expect(executionError(block({ mode: "emom", interval_seconds: 60, intervals: 20, rotation: null }, { rounds: 10 }))).toMatch(/not rounds/);
    expect(executionError(block({ mode: "work_rest", work_seconds: 0, rest_seconds: 10, intervals: 8 }))).toMatch(/Work must/);
    expect(executionError(block({ mode: "amrap", time_cap_seconds: 600 }))).toBe("AMRAP execution requires a circuit block.");
  });
  it("explains why a timed part can't run instead of naming an internal limit", () => {
    const warmup: Block = { id: "warm", label: "Warm-up", grouping: "sequential", exercises: [{ name: "Jog", duration_seconds: 300 }] };
    const w = { kind: "session" as const, blocks: [warmup, block({ mode: "emom", interval_seconds: 60, intervals: 20, rotation: null })] };
    expect(timedFormat(w)).toBeNull();
    expect(timedFormatProblem(w)).toMatch(/2 parts, and the timer runs one timed part per session/);
    const unset = block({ mode: "emom", interval_seconds: 60, intervals: 20, rotation: null }, { exercises: [{ name: "Burpees", reps_min: 12 }, { name: "Squats", reps_min: 15 }] });
    expect(timedFormat({ kind: "session", blocks: [unset] })).toBeNull();
    expect(timedFormatProblem({ kind: "session", blocks: [unset] })).toMatch(/one move per interval or every move/);
    expect(timedFormat({ kind: "session", blocks: [{ ...unset, execution: { mode: "emom", interval_seconds: 60, intervals: 20, rotation: "alternating" } }] })).not.toBeNull();
    expect(timedFormatProblem({ kind: "session", blocks: [block({ mode: "emom", interval_seconds: 60, intervals: 200, rotation: null })] }))
      .toMatch(/up to 100 intervals/);
  });
});

describe("reps per round", () => {
  it("reads rep schemes and ladders, and never invents a number", () => {
    const scheme = { name: "Thrusters", rep_scheme: [21, 15, 9] };
    expect([1, 2, 3, 4].map((i) => repsFor(scheme, i))).toEqual([21, 15, 9, null]);
    expect([1, 2, 10, 11].map((i) => ladderReps({ start: 1, step: 1, end: 10 }, i))).toEqual([1, 2, 10, null]);
    expect([1, 10, 11].map((i) => ladderReps({ start: 10, step: -1, end: 1 }, i))).toEqual([10, 1, null]);
    expect(ladderReps({ start: 1, step: 1, end: null }, 30)).toBe(30);
    expect(repsFor({ name: "Burpees" }, 1)).toBeNull();
  });
  it("rotates alternating moves and runs every move together otherwise", () => {
    const two = { exercises: [{ name: "A" }, { name: "B" }] };
    expect([1, 2, 3].map((i) => movesFor({ mode: "emom", interval_seconds: 60, intervals: 12, rotation: "alternating" }, two, i))).toEqual([[0], [1], [0]]);
    expect(movesFor({ mode: "emom", interval_seconds: 60, intervals: 12, rotation: "together" }, two, 2)).toEqual([0, 1]);
  });
  it("scores a for-time session stopped early without a cap", () => {
    const w = { kind: "session" as const, blocks: [block({ mode: "for_time", time_cap_seconds: null }, { rounds: 3 })] };
    expect(formatScore(w, { status: "partial", active_seconds: 300, actuals: [{ round_index: 1, completed: true, reps: 10 }, { round_index: 2, completed: false, reps: 4 }] }))
      .toBe("Stopped at 5:00 · 1 round + 4 reps");
  });
});
