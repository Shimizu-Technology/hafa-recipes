import { describe, expect, it } from "vitest";
import { nov17Class as w } from "./fixtures/nov17-class";
import { planClass, startPart, tapRound, buyInDone } from "./class-session";
import { buyInMove, partClock, partTitle, restLine, roundMoves, visibleRuns } from "./class-view";
import type { Workout } from "./models";

const [A, B, C, D] = w.blocks;
describe("class runner text", () => {
  it("names each part and the rest between parts", () => {
    expect([A, B, C, D].map(partTitle)).toEqual(["A · AMRAP 15", "B · AMRAP 15", "C · Cool-down", "D · Accessory"]);
    expect(restLine(B)).toBe("then B · AMRAP 15");
    expect(restLine(undefined)).toBe("then you’re done");
    expect(buyInMove(A)).toBe("1000 m Run");
    expect(roundMoves(B)).toBe("30 Wall Ball · 20 Burpee · 400 m Run");
  });
  it("counts an AMRAP down, and offers the buy-in run, then the round's run", () => {
    let run = startPart(planClass(w), w, 0);
    expect(partClock(run.parts[0], A, 60_000)).toMatchObject({ seconds: 14 * 60, direction: "left" });
    expect(visibleRuns(run.parts[0], A)).toEqual([0]);
    run = tapRound(buyInDone(run, w, 1000), w, 2000);
    expect(visibleRuns(run.parts[0], A)).toEqual([3]);
  });
  it("shows an EMOM's minute and time left in it", () => {
    const emom: Workout["blocks"][number] = { id: "e", label: "E", grouping: "interval",
      execution: { mode: "emom", interval_seconds: 60, intervals: 10, rotation: null }, exercises: [{ name: "Burpee", reps_min: 10 }] };
    const workout = { ...w, blocks: [emom, C] };
    const run = startPart(planClass(workout), workout, 0);
    expect(partTitle(emom)).toBe("E · EMOM 10");
    expect(partClock(run.parts[0], emom, 125_000)).toMatchObject({ seconds: 55, interval: { index: 3, label: "Minute 3 of 10", phase: "work" } });
  });
});
