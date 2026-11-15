import { describe, expect, it } from "vitest";
import { nov17Class as w } from "./fixtures/nov17-class";
import {
  adjustRest, buyInDone, classIntervals, endPart, endRest, formatPartScore, partCapMs, partElapsedMs, partKind, partScore,
  partSegments, partStatus, pausePart, planClass, resolve, resumePart, setRun, skipLeadIn, skipPart, startPart, tapRound, undoTap,
  type ClassRun,
} from "./class-session";
import { timedCircuit } from "./timed-circuit";
import { timedFormat } from "./timed-execution";
import type { Workout } from "./models";

const [A, B, C, D] = w.blocks;
const min = 60_000;
const T0 = Date.parse("2026-11-17T17:30:00Z");
const at = (ms: number) => T0 + ms;
const part = (run: ClassRun, i: number) => run.parts[i];
const status = (run: ClassRun, i: number, now: number) => partStatus(run.parts[i], w.blocks[i], now);
/** A started with a 3 s lead-in at T0; its clock starts at T0 + 3 s. */
const started = (lead = 3000) => startPart(planClass(w, lead), w, at(0));

describe("part kinds and the legacy single-part path", () => {
  it("reads each part's kind and clock", () => {
    expect(w.blocks.map(partKind)).toEqual(["amrap", "amrap", "sets", "sets"]);
    expect(partCapMs(A)).toBe(15 * min);
    expect(partCapMs(C)).toBeNull();
    const emom: Workout["blocks"][number] = { id: "e", label: "E", grouping: "interval", execution: { mode: "emom", interval_seconds: 60, intervals: 10, rotation: null }, exercises: [{ name: "Burpee", reps_min: 10 }] };
    expect(partKind(emom)).toBe("emom");
    expect(partCapMs(emom)).toBe(10 * min);
  });
  it("keeps the single-part wrappers unchanged: a multi-part class still has no single-part clock", () => {
    expect(timedCircuit(w)).toBeNull();
    expect(timedFormat(w)).toBeNull();
    expect(timedCircuit({ ...w, blocks: [A] })?.time_cap_seconds).toBe(900);
  });
});

describe("clock", () => {
  it("excludes the lead-in, and Start now skips it", () => {
    let run = started();
    expect(part(run, 0).started_at).toBe(at(3000));
    expect(status(run, 0, at(1000))).toBe("lead_in");
    expect(partElapsedMs(part(run, 0), A, at(2000))).toBe(0);
    expect(partElapsedMs(part(run, 0), A, at(63_000))).toBe(min);
    run = skipLeadIn(started(10_000), w, at(1000));
    expect(part(run, 0).started_at).toBe(at(1000));
  });
  it("runs across lock and relaunch: nothing but timestamps", () => {
    const run = started();
    // No event at all between start and 9:42 in.
    expect(partElapsedMs(part(run, 0), A, at(3000 + 9 * min + 42_000))).toBe(9 * min + 42_000);
  });
  it("pauses only on an explicit pause, and moves the cap end by the pause", () => {
    let run = pausePart(started(), w, at(3000 + 5 * min));
    expect(status(run, 0, at(3000 + 7 * min))).toBe("paused");
    run = resumePart(run, w, at(3000 + 7 * min));
    expect(partElapsedMs(part(run, 0), A, at(3000 + 8 * min))).toBe(6 * min);
    expect(status(run, 0, at(3000 + 16 * min))).toBe("running");
    expect(status(run, 0, at(3000 + 17 * min))).toBe("resting_after");
  });
  it("pausing during the lead-in cancels it, and Resume starts at once", () => {
    let run = pausePart(started(), w, at(1000));
    expect(status(run, 0, at(1000))).toBe("pending");
    run = resumePart(run, w, at(20_000));
    expect(part(run, 0).started_at).toBe(at(20_000));
  });
  it("a paused part never caps", () => {
    const run = pausePart(started(), w, at(3000 + 14 * min));
    expect(status(run, 0, at(3000 + 60 * min))).toBe("paused");
    expect(partElapsedMs(part(run, 0), A, at(3000 + 60 * min))).toBe(14 * min);
  });
});

describe("parts in order (Nov 17)", () => {
  it("A caps at 15:00, rests 3:00, then B starts after its lead-in, all while locked", () => {
    const run = started();
    const capEnd = at(3000 + 15 * min);
    expect(status(run, 0, capEnd - 1)).toBe("running");
    expect(status(run, 0, capEnd)).toBe("resting_after");
    const later = resolve(run, w, capEnd + 3 * min + 5000);
    expect(later.cursor).toBe(1);
    expect(part(later, 1).started_at).toBe(capEnd + 3 * min + 3000);
    expect(partElapsedMs(part(later, 1), B, capEnd + 3 * min + 5000)).toBe(2000);
  });
  it("+15 s, −15 s and Start now change the rest", () => {
    const capEnd = at(3000 + 15 * min);
    let run = adjustRest(started(), w, 15_000, capEnd + 1000);
    run = adjustRest(run, w, -30_000, capEnd + 2000);
    expect(resolve(run, w, capEnd + 2 * min + 46_000).cursor).toBe(1);
    run = endRest(started(), w, capEnd + 10_000);
    expect(part(resolve(run, w, capEnd + 10_000), 1).started_at).toBe(capEnd + 13_000);
  });
  it("after B, the set-by-set cool-down starts straight away, and D after it", () => {
    let run = resolve(started(), w, at(3000 + 18 * min + 3000));
    const bEnd = part(run, 1).started_at! + 15 * min;
    run = resolve(run, w, bEnd);
    expect(run.cursor).toBe(2);
    expect(part(run, 2).started_at).toBe(bEnd);
    run = endPart(run, w, bEnd + 10 * min);
    expect(run.cursor).toBe(3);
    expect(status(run, 3, bEnd + 10 * min)).toBe("running");
  });
  it("ending A early starts its rest from then; skipping a part moves on with no rest", () => {
    let run = endPart(started(), w, at(3000 + 12 * min));
    expect(status(run, 0, at(3000 + 13 * min))).toBe("resting_after");
    expect(resolve(run, w, at(3000 + 15 * min + 1)).cursor).toBe(1);
    run = skipPart(planClass(w, 0), w, at(0));
    expect(run.cursor).toBe(1);
    expect(status(run, 1, at(0))).toBe("pending"); // A timed part with no rest before it waits for Start.
  });
  it("active time is the parts' running spans, not the rests or pauses", () => {
    let run = pausePart(started(), w, at(3000 + 5 * min));
    run = resumePart(run, w, at(3000 + 6 * min));
    const spans = classIntervals(resolve(run, w, at(3000 + 30 * min)), w, at(3000 + 30 * min));
    expect(spans.map((s) => s.ended_at - s.started_at)).toEqual([5 * min, 10 * min, at(3000 + 30 * min) - part(resolve(run, w, at(3000 + 30 * min)), 1).started_at!]);
  });
});

describe("AMRAP buy-in and rounds", () => {
  const running = at(3000);
  it("counts rounds only after the buy-in, and undo steps back through both", () => {
    let run = tapRound(started(), w, running + 1000);
    expect(part(run, 0).round_taps).toEqual([]);
    run = buyInDone(run, w, running + 6 * min);
    run = tapRound(run, w, running + 9 * min);
    run = tapRound(run, w, running + 12 * min);
    expect(part(run, 0).round_taps).toHaveLength(2);
    run = undoTap(undoTap(run, w, running + 12 * min + 1), w, running + 12 * min + 2);
    expect(part(run, 0)).toMatchObject({ round_taps: [], buy_in_done_at: running + 6 * min });
    run = undoTap(run, w, running + 12 * min + 3);
    expect(part(run, 0).buy_in_done_at).toBeUndefined();
  });
  it("scores rounds + reps after the buy-in", () => {
    let run = buyInDone(started(), w, running + 6 * min + 10_000);
    for (const m of [8, 10, 12]) run = tapRound(run, w, running + m * min);
    const score = partScore(A, part(run, 0), running + 15 * min, { reps: 12 })!;
    expect(score).toMatchObject({ kind: "rounds_reps", rounds: 3, reps: 12, buy_in_done: true, buy_in_seconds: 370, origin: "timer",
      started_at: new Date(running).toISOString(), ended_at: new Date(running + 15 * min).toISOString() });
    expect(formatPartScore(score)).toBe("3 + 12");
  });
  it("a cap during the buy-in scores the distance covered", () => {
    const score = partScore(A, part(started(), 0), running + 15 * min, { buy_in_meters: 900 })!;
    expect(score).toEqual(expect.objectContaining({ kind: "rounds_reps", buy_in_done: false, distance_meters: 900 }));
    expect(score.rounds).toBeUndefined();
    expect(formatPartScore(score)).toBe("Buy-in · 900 m");
  });
  it("unscored parts have no score", () => {
    expect(partScore(C, { block_id: "c", kind: "sets", pauses: [], round_taps: [], started_at: running }, running)).toBeNull();
  });
  it("buy-in time excludes a pause", () => {
    let run = pausePart(started(), w, running + min);
    run = resumePart(run, w, running + 2 * min);
    run = buyInDone(run, w, running + 7 * min);
    expect(partScore(A, part(run, 0), running + 15 * min)!.buy_in_seconds).toBe(360);
  });
});

describe("other part scores", () => {
  const forTime: Workout["blocks"][number] = { id: "f", label: "F", grouping: "circuit", rounds: 3, execution: { mode: "for_time", time_cap_seconds: 600 },
    exercises: [{ name: "Row", distance_meters: 500 }] };
  const fw: Workout = { ...w, blocks: [forTime] };
  it("for time: the finish time, or capped with rounds + reps", () => {
    let run = startPart(planClass(fw, 0), fw, at(0));
    run = endPart(run, fw, at(8 * min + 42_000));
    expect(formatPartScore(partScore(forTime, part(run, 0), at(9 * min))!)).toBe("8:42");
    let capped = startPart(planClass(fw, 0), fw, at(0));
    capped = tapRound(tapRound(capped, fw, at(3 * min)), fw, at(6 * min));
    const score = partScore(forTime, part(capped, 0), at(11 * min), { reps: 14 })!;
    expect(score).toMatchObject({ kind: "time", capped: true, rounds: 2, reps: 14 });
    expect(score.time_seconds).toBeUndefined();
    expect(formatPartScore(score)).toBe("Capped · 2 + 14");
  });
  it("strength: the heaviest completed set across units; otherwise completed", () => {
    const strength = { ...D, score_kind: undefined };
    const p = { block_id: "d", kind: "sets" as const, pauses: [], round_taps: [], started_at: at(0) };
    const actuals = [
      { block_id: "d", exercise_index: 0, set_index: 1, round_index: 1, completed: true, load: 100, load_unit: "lb" as const },
      { block_id: "d", exercise_index: 0, set_index: 2, round_index: 1, completed: true, load: 50, load_unit: "kg" as const },
      { block_id: "d", exercise_index: 0, set_index: 3, round_index: 1, completed: false, load: 200, load_unit: "kg" as const },
    ];
    expect(partScore(strength, p, at(1), {}, actuals)).toMatchObject({ kind: "load", load: 50, load_unit: "kg" });
    expect(partScore(strength, p, at(1))).toMatchObject({ kind: "completed" });
  });
});

describe("runs: Outdoor or Treadmill", () => {
  it("treadmill buy-in records the prescribed distance and its split; an edit is marked edited", () => {
    let run = setRun(started(), w, 0, "treadmill", undefined, at(3000));
    run = buyInDone(run, w, at(3000 + 6 * min));
    run = setRun(run, w, 3, "treadmill", 350, at(3000 + 6 * min));
    run = tapRound(run, w, at(3000 + 9 * min));
    const segments = partSegments(A, part(run, 0));
    expect(segments[0]).toEqual({ block_id: "a", kind: "buy_in", index: 1, label: "Run", started_at: new Date(at(3000)).toISOString(),
      ended_at: new Date(at(3000 + 6 * min)).toISOString(), run_environment: "treadmill", distance_meters: 1000, distance_source: "prescribed" });
    expect(segments[1]).toMatchObject({ kind: "round", index: 1, run_environment: "treadmill", distance_meters: 350, distance_source: "edited" });
  });
  it("outdoor records only the choice; the distance comes from GPS later", () => {
    let run = setRun(started(), w, 0, "outdoor", undefined, at(3000));
    run = buyInDone(run, w, at(3000 + 6 * min));
    const [buyIn] = partSegments(A, part(run, 0));
    expect(buyIn.run_environment).toBe("outdoor");
    expect(buyIn.distance_meters).toBeUndefined();
    expect(buyIn.distance_source).toBeUndefined();
  });
  it("no choice made means no environment on the split", () => {
    const run = buyInDone(started(), w, at(3000 + 6 * min));
    expect(partSegments(A, part(run, 0))[0].run_environment).toBeUndefined();
    expect(partSegments(C, { block_id: "c", kind: "sets", pauses: [], round_taps: [], started_at: at(0) })).toEqual([]);
  });
});
