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
    const overlay = dayOverlay(state([held], [save(over), save(midnight)]), "baby", guam, late),
      span = (record_id: string, from: string, to: string) => ({ record_id, from, to }),
      withSpans = api({ sleep: { total_minutes: 120, spans: [span("a", "2026-11-03T20:00:00Z", "2026-11-03T22:00:00Z")] } });
    expect(overlay(withSpans, key).sleep.total_minutes).toBe(180 + 120);
    const next = api({ date: "2026-11-05", sleep: { total_minutes: 0, spans: [] }, dots: [] });
    expect(overlay(next, "2026-11-05").dots).toContain("sleep");
    expect(overlay(next, "2026-11-05").sleep.total_minutes).toBe(120);
  });
  it("keeps the API's total when a queued sleep arrives, for sleeps this phone doesn't hold", () => {
    const queued = row("s", "sleep", "2026-11-04T03:00:00Z");
    // Reproduced on 32fce648: a queued open sleep made a five-hour day read zero.
    const open = dayOverlay(state([], [save(queued)]), "baby", guam, now);
    const span = { record_id: "remote", from: "2026-11-04T00:00:00Z", to: "2026-11-04T05:00:00Z" };
    expect(open(api({ sleep: { total_minutes: 300, spans: [span] } }), key).sleep.total_minutes).toBe(300);
    // With no spans at all it doesn't guess: the API's total stands.
    expect(open(api({ sleep: { total_minutes: 300 } }), key).sleep.total_minutes).toBe(300);
    // A finished one is added, with its overlap counted once.
    const finished = dayOverlay(state([], [save({ ...queued, data: { end_at: "2026-11-04T06:00:00Z" } })]), "baby", guam, now);
    expect(finished(api({ sleep: { total_minutes: 300, spans: [span] } }), key).sleep.total_minutes).toBe(360);
    expect(finished(api({ sleep: { total_minutes: 300 } }), key).sleep.total_minutes).toBe(300);
  });
  it("swaps only the sleep it has a change for, and takes back a queued delete's minutes", () => {
    const held = row("mine", "sleep", "2026-11-04T00:00:00Z", { end_at: "2026-11-04T01:00:00Z" }),
      spans = [{ record_id: "mine", from: "2026-11-04T00:00:00Z", to: "2026-11-04T01:00:00Z" }, { record_id: "theirs", from: "2026-11-04T02:00:00Z", to: "2026-11-04T04:00:00Z" }],
      base = api({ sleep: { total_minutes: 180, spans } });
    const longer = save({ ...held, data: { end_at: "2026-11-04T01:30:00Z" } });
    expect(dayOverlay(state([held], [longer]), "baby", guam, now)(base, key).sleep.total_minutes).toBe(210);
    const gone: Mutation = { id: "x", generation: 1, type: "delete", record: held };
    expect(dayOverlay(state([held], [gone]), "baby", guam, now)(base, key).sleep.total_minutes).toBe(120);
    const only = api({ sleep: { total_minutes: 60, spans: spans.slice(0, 1) } });
    expect(dayOverlay(state([held], [gone]), "baby", guam, now)(only, key).dots).not.toContain("sleep");
  });
  it("keeps the API's dot for a sleep still going, unless that's the one queued", () => {
    const open = row("open", "sleep", "2026-11-04T03:00:00Z"), other = row("d", "sleep", "2026-11-04T05:00:00Z", { end_at: "2026-11-04T05:30:00Z" }),
      base = api({ sleep: { total_minutes: 0, spans: [] }, dots: ["sleep"] });
    expect(dayOverlay(state([], [save(other)]), "baby", guam, now)(base, key).dots).toContain("sleep");
    const gone: Mutation = { id: "x", generation: 1, type: "delete", record: open };
    expect(dayOverlay(state([open], [gone]), "baby", guam, now)(base, key).dots).not.toContain("sleep");
  });
  it("leaves the API's sleep alone when no sleep is queued, including its minutes this phone can't see", () => {
    expect(dayOverlay(state([], [save(row("d", "diaper", "2026-11-04T01:00:00Z", { type: "wet" }))]), "baby", guam, now)(api(), key).sleep.total_minutes).toBe(120);
  });
  it("falls back to the rows on this phone by the same rules when the API hasn't answered", () => {
    const rows = [row("f", "feeding", "2026-11-04T01:00:00Z", { method: "breast" }), row("s", "sleep", "2026-11-04T01:00:00Z")];
    expect(dayOverlay(state(rows), "baby", guam, now)(undefined, key)).toEqual(dayTotals(rows, key, guam, now));
  });
});

it("counts what she just logged, though the screen's clock only ticks once a minute, and still not a feed dated ahead", () => {
  const feed = (at: string) => ({ ...optimisticRecord({ id: at, kind: "feeding", title: "Feeding", body: "", child_id: "baby", occurred_at: at, data: {} }), revision: 1 });
  const clock = new Date("2026-11-05T03:46:00.000Z"), day = "2026-11-05";
  expect(dayTotals([feed("2026-11-05T03:46:40.000Z")], day, "UTC", clock).feeding.count).toBe(1);
  expect(dayTotals([feed("2026-11-05T09:00:00.000Z")], day, "UTC", clock).feeding.count).toBe(0);
});
