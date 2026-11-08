import { describe, expect, it } from "vitest";
import { contractionDetail, contractionLimit, doctorNote, hourLine, lastHour, ownContractions, runningContractions, secondsWords, withGaps } from "./contractions";
import { contractionGuidance } from "./medical-wording";
import { optimisticRecord, type BabyRecord } from "./models";

const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 10, 5, 2, minute, second)).toISOString();
const row = (id: string, start: string, end?: string, child: string | null = "baby"): BabyRecord =>
  optimisticRecord({ id, kind: "contraction", title: "Contraction", body: "", child_id: child, occurred_at: start, data: end ? { end_at: end } : {} });

describe("timing", () => {
  it("is running only while the newest has no end, and not forever", () => {
    expect(runningContractions([row("a", at(0))], "baby", new Date(at(1))).map((r) => r.id)).toEqual(["a"]);
    expect(runningContractions([row("a", at(0), at(1))], "baby", new Date(at(2)))).toEqual([]);
    expect(runningContractions([row("a", at(0))], "baby", new Date(new Date(at(0)).getTime() + contractionLimit))).toEqual([]);
    expect(runningContractions([row("a", at(0), undefined, "other")], "baby", new Date(at(1)))).toEqual([]);
    // Two phones can each start one. Both stay in reach, newest first, whatever else has ended since.
    expect(runningContractions([row("a", at(0)), row("b", at(1)), row("c", at(2), at(3))], "baby", new Date(at(4))).map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("measures how long each lasted, and the gap from the start of the one before", () => {
    const list = ownContractions([row("old", at(0), at(1)), row("new", at(5, 30), at(6, 15))], "baby");
    expect(withGaps(list)).toMatchObject([{ record: { id: "new" }, seconds: 45, apart: 330 }, { record: { id: "old" }, seconds: 60 }]);
    expect(withGaps(list)[1].apart).toBeUndefined();
    expect(contractionDetail(row("x", at(0)), new Date(at(1)))).toBe("Timing now");
    expect(contractionDetail(row("x", at(0)), new Date(at(40)))).toBe("No end time");
    expect(contractionDetail(row("x", at(0), at(0, 45)))).toBe("45 sec");
  });
  it("says durations plainly", () => {
    expect(secondsWords(45)).toBe("45 sec");
    expect(secondsWords(60)).toBe("1 min");
    expect(secondsWords(310)).toBe("5 min 10 sec");
    expect(secondsWords(3840)).toBe("1 h 4 min");
    expect(secondsWords(-5)).toBe("0 sec");
  });
});

describe("the last hour", () => {
  const now = new Date(at(59));
  it("counts and averages only what's in the hour, and reports without judging", () => {
    const rows = ownContractions([row("old", "2026-11-05T01:00:00.000Z", "2026-11-05T01:01:00.000Z"), row("a", at(10), at(11)), row("b", at(20), at(20, 30)), row("c", at(30))], "baby");
    const summary = lastHour(rows, now);
    expect(summary).toEqual({ count: 3, averageSeconds: 45, averageApart: 600 });
    expect(hourLine(summary)).toBe("3 in the last hour · about 45 sec long · about 10 min apart");
  });
  it("has nothing to average with one or none", () => {
    expect(hourLine(lastHour([], now))).toBe("None in the last hour");
    expect(hourLine(lastHour([row("a", at(10), at(11))], now))).toBe("1 in the last hour · about 1 min long");
  });
  it("never contains a rule or an instruction, at any pace", () => {
    const rows = ownContractions(Array.from({ length: 12 }, (_, i) => row(`r${i}`, at(i * 5), at(i * 5, 59))), "baby");
    expect(hourLine(lastHour(rows, now))).not.toMatch(/call|hospital|go in|labor|labour|normal|should/i);
  });
});

it("gives immediate preterm routing below 37 weeks and when the week is unknown", () => {
  for (const week of [undefined, 30, 36]) expect(contractionGuidance(week)).toContain("right away");
  for (const week of [37, 41]) expect(contractionGuidance(week)).toContain("Go to the hospital");
  for (const week of [undefined, 36, 37]) expect(contractionGuidance(week)).not.toMatch(/5-1-1|okay|normal|wait an hour/);
});

it("finds her note by its label, the newest copy, and nothing else", () => {
  const note = (id: string, when: string, provenance: "clinician_instruction" | "caregiver_observation" = "clinician_instruction", title = "What my doctor told me") =>
    optimisticRecord({ id, kind: "journal", title, body: id, child_id: null, occurred_at: when, data: { provenance } });
  expect(doctorNote([note("old", at(0)), note("new", at(5))], null)?.id).toBe("new");
  expect(doctorNote([note("mine", at(0), "caregiver_observation"), note("other", at(0), "clinician_instruction", "From my midwife")], null)).toBeUndefined();
  // Never another baby's.
  const sibling = { ...note("sister", at(9)), child_id: "sister" };
  expect(doctorNote([sibling], "baby")).toBeUndefined();
  expect(doctorNote([sibling, { ...note("mine", at(0)), child_id: "baby" }], "baby")?.id).toBe("mine");
});
