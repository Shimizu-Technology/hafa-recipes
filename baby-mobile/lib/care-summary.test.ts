import { describe, expect, it } from "vitest";
import { dayOverlay } from "./care-summary";
import { dayTotals, summaryLine, type CareDay } from "./tracker";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type Mutation } from "./models";

const guam = "Pacific/Guam", key = "2026-11-04", now = new Date("2026-11-04T10:00:00Z");
const row = (id: string, kind: "feeding" | "diaper" | "sleep", occurred_at: string, data: BabyRecord["data"] = {}, child_id: string | null = "baby"): BabyRecord =>
  ({ ...optimisticRecord({ id, kind, title: "", body: "", child_id, occurred_at, data }), revision: 1 });
const api = (over: Partial<CareDay> = {}): CareDay => ({ date: key, feeding: { count: 2 }, diapers: { count: 1, pee: 1, poo: 0, dry: 0 }, sleep: { total_minutes: 120 }, dots: ["feeding", "diaper", "sleep"], ...over });
const state = (records: BabyRecord[], outbox: Mutation[] = []) => ({ ...emptyState(), records, outbox }) as DeviceState;
const save = (record: BabyRecord): Mutation => ({ id: `s-${record.id}`, generation: 1, type: "save", record, files: [] });

describe("the API's day with this phone's changes on top", () => {
  it("is the API's answer when nothing is queued", () => {
    const base = api();
    expect(dayOverlay(state([]), "baby", guam, now)(base, key)).toBe(base);
  });
  it("adds a queued log", () => {
    const day = dayOverlay(state([], [save(row("d", "diaper", "2026-11-04T01:00:00Z", { type: "both" }))]), "baby", guam, now)(api(), key);
    expect(day.diapers).toEqual({ count: 2, pee: 2, poo: 1, dry: 0 });
    expect(summaryLine(day)).toBe("2 feeds · 2 pee · 1 poo · 2h sleep");
  });
  it("swaps a queued change for what the API has, rather than counting it twice", () => {
    const held = row("d", "diaper", "2026-11-04T01:00:00Z", { type: "wet" });
    expect(dayOverlay(state([held], [save({ ...held, data: { type: "dirty" } })]), "baby", guam, now)(api(), key).diapers).toEqual({ count: 1, pee: 0, poo: 1, dry: 0 });
  });
  it("takes a queued delete away, and its dot with the last of its kind", () => {
    const held = row("d", "diaper", "2026-11-04T01:00:00Z", { type: "wet" }), gone: Mutation = { id: "x", generation: 1, type: "delete", record: held };
    const day = dayOverlay(state([held], [gone]), "baby", guam, now)(api(), key);
    expect(day.diapers.count).toBe(0);
    expect(day.dots).toEqual(["feeding", "sleep"]);
  });
  it("ignores another child's changes", () => {
    const base = api(), day = dayOverlay(state([], [save(row("d", "diaper", "2026-11-04T01:00:00Z", { type: "wet" }, "other"))]), "baby", guam, now)(base, key);
    expect(day.diapers.count).toBe(1);
  });
  it("gives a queued sleep still going no minutes, on any day", () => {
    const day = dayOverlay(state([], [save(row("s", "sleep", "2026-11-04T01:00:00Z"))]), "baby", guam, now)(api({ sleep: { total_minutes: 0 }, dots: [] }), key);
    expect(day.sleep.total_minutes).toBe(0);
    expect(day.dots).toContain("sleep");
  });
  it("sums again for a queued finished sleep, with its overlap counted once, and over midnight on both days", () => {
    const held = row("a", "sleep", "2026-11-03T20:00:00Z", { end_at: "2026-11-03T22:00:00Z" }),
      over = row("b", "sleep", "2026-11-03T21:00:00Z", { end_at: "2026-11-03T23:00:00Z" }),
      midnight = row("c", "sleep", "2026-11-04T12:00:00Z", { end_at: "2026-11-04T16:00:00Z" }), late = new Date("2026-11-05T00:00:00Z");
    const overlay = dayOverlay(state([held], [save(over), save(midnight)]), "baby", guam, late);
    expect(overlay(api(), key).sleep.total_minutes).toBe(180 + 120);
    expect(overlay(api({ date: "2026-11-05", sleep: { total_minutes: 0 }, dots: [] }), "2026-11-05").dots).toContain("sleep");
    expect(overlay(api({ date: "2026-11-05", sleep: { total_minutes: 0 }, dots: [] }), "2026-11-05").sleep.total_minutes).toBe(120);
  });
  it("leaves the API's sleep alone when no sleep is queued, including its minutes this phone can't see", () => {
    expect(dayOverlay(state([], [save(row("d", "diaper", "2026-11-04T01:00:00Z", { type: "wet" }))]), "baby", guam, now)(api(), key).sleep.total_minutes).toBe(120);
  });
  it("falls back to the rows on this phone by the same rules when the API hasn't answered", () => {
    const rows = [row("f", "feeding", "2026-11-04T01:00:00Z", { method: "breast" }), row("s", "sleep", "2026-11-04T01:00:00Z")];
    expect(dayOverlay(state(rows), "baby", guam, now)(undefined, key)).toEqual(dayTotals(rows, key, guam, now));
  });
});
