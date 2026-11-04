import { describe, expect, it } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type Mutation } from "./models";
import { basedOn, customProblem, overlayStats } from "./care-stats";
import { answer, day } from "./care-stats-fixtures";

const guam = "Pacific/Guam", now = new Date("2026-11-04T10:00:00Z"); // 8 PM on Nov 4 in Guam.
const row = (id: string, kind: BabyRecord["kind"], occurred_at: string, data: BabyRecord["data"] = {}) => optimisticRecord({ id, kind, title: "", body: "", child_id: "baby", occurred_at, data });
const save = (record: BabyRecord): Mutation => ({ id: `m${record.id}`, generation: 1, type: "save", files: [], record });
const state = (outbox: Mutation[], records: BabyRecord[] = []): DeviceState => ({ ...emptyState(), outbox, records });

describe("what the app says about dates and days", () => {
  it("counts logged days out of finished ones, in her words", () => {
    expect(basedOn(6, 7)).toBe("based on 6 logged days of 7");
    expect(basedOn(1, 7)).toBe("based on 1 logged day of 7");
  });
  it("stops dates the API would refuse, in the API's own words", () => {
    expect(customProblem("2026-11-02", "2026-11-01", "2026-11-04")).toBe("Choose a start before the end");
    expect(customProblem("2026-11-05", "2026-11-06", "2026-11-04")).toBe("Choose dates that have already started");
    expect(customProblem("2026-01-01", "2026-11-01", "2026-11-04")).toBe("Choose 92 days or fewer");
    expect(customProblem("2026-08-04", "2026-11-03", "2026-11-04")).toBeNull();
    expect(customProblem("2026-08-03", "2026-11-03", "2026-11-04")).toBe("Choose 92 days or fewer");
  });
});

describe("laying queued changes over the API's numbers", () => {
  it("hands back the API's numbers untouched when nothing is queued", () => {
    const base = answer([day("2026-11-04", true)]), shown = overlayStats(base, state([]), "baby", guam, now);
    expect(shown.stats).toBe(base);
    expect(shown.pending).toBe(false);
  });
  it("adds a queued feed to its day and the total, and leaves the averages to the API", () => {
    const base = answer([day("2026-11-03", false, { feeding: { ...day("x").feeding, count: 4 } })]);
    const shown = overlayStats(base, state([save(row("f", "feeding", "2026-11-03T02:00:00Z"))]), "baby", guam, now);
    expect(shown.pending).toBe(true);
    expect(shown.stats.days[0].feeding.count).toBe(5);
    expect(shown.stats.feeding.count).toBe(5);
    expect(shown.stats.feeding.average_per_day).toBe(4.5);
  });
  it("swaps a queued diaper change rather than counting it twice", () => {
    const held = { ...row("d", "diaper", "2026-11-03T02:00:00Z", { type: "wet" }), revision: 1 };
    const base = answer([day("2026-11-03", false, { diapers: { count: 1, pee: 1, poo: 0, dry: 0 } })]);
    const shown = overlayStats(base, state([save({ ...held, data: { type: "dirty" } })], [held]), "baby", guam, now);
    expect(shown.stats.diapers).toMatchObject({ count: 1, pee: 0, poo: 1, dry: 0 });
  });
  it("counts a queued kick session and its movements, and another baby's change not at all", () => {
    const base = answer([day("2026-11-03")]);
    const other = { ...row("o", "feeding", "2026-11-03T02:00:00Z"), child_id: "sister" };
    const shown = overlayStats(base, state([save(row("k", "kick_session", "2026-11-03T02:00:00Z", { count: 7 })), save(row("c", "contraction", "2026-11-03T03:00:00Z")), save(other)]), "baby", guam, now);
    expect(shown.stats.kicks).toEqual({ sessions: 1, movements: 7 });
    expect(shown.stats.contractions.count).toBe(1);
    expect(shown.stats.feeding.count).toBe(0);
  });
  it("a rolling range ignores a queued change from before its window, on a day it only partly covers", () => {
    const base = answer([day("2026-11-03", true), day("2026-11-04", true)], "24h");
    // 8 AM on Nov 3 in Guam: the same day as the window's start, but twelve hours before it.
    const early = overlayStats(base, state([save(row("f", "feeding", "2026-11-02T22:00:00Z"))]), "baby", guam, now);
    expect(early.pending).toBe(false);
    const late = overlayStats(base, state([save(row("g", "feeding", "2026-11-03T12:00:00Z"))]), "baby", guam, now);
    expect(late.stats.days.map((one) => one.feeding.count)).toEqual([1, 0]);
  });
  it("re-sums a queued sleep with the API's spans, and only inside a rolling window", () => {
    const base = answer([day("2026-11-03", true, { sleep: { total_minutes: 0, longest_minutes: 0, spans: [] } })], "24h");
    // 7 PM to 9 PM on Nov 3: one hour inside the window.
    const shown = overlayStats(base, state([save(row("s", "sleep", "2026-11-03T09:00:00Z", { end_at: "2026-11-03T11:00:00Z" }))]), "baby", guam, now);
    expect(shown.stats.days[0].sleep.total_minutes).toBe(60);
  });
});
