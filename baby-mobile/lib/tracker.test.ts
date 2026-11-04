import { describe, expect, it } from "vitest";
import { addDays, dayKey, dayRange, daySummary, keyDate, recordDay, sleepMs, weekOf, zonedInstant } from "./tracker";
import { optimisticRecord, type BabyRecord } from "./models";

const guam = "Pacific/Guam";
const row = (kind: "feeding" | "diaper" | "sleep" | "journal", occurred_at: string, data: BabyRecord["data"] = {}): BabyRecord =>
  optimisticRecord({ id: `${kind}-${occurred_at}`, kind, title: "", body: "", child_id: "baby", occurred_at, data });

describe("days", () => {
  it("steps calendar days without drifting across a clock change", () => {
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayKey(keyDate("2026-11-04"))).toBe("2026-11-04");
  });
  it("gives Sunday to Saturday, for any day of that week", () => {
    expect(weekOf("2026-11-04")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(weekOf("2026-11-01")[0]).toBe("2026-11-01");
    expect(weekOf("2026-11-07")[0]).toBe("2026-11-01");
  });
});

describe("the family's clock", () => {
  it("finds midnight in Guam, half-open, whatever zone the phone is in", () => {
    expect(dayRange("2026-11-04", guam)).toEqual({ from: "2026-11-03T14:00:00.000Z", to: "2026-11-04T14:00:00.000Z" });
    expect(zonedInstant("2026-11-04", 12, 0, guam).toISOString()).toBe("2026-11-04T02:00:00.000Z");
  });
  it("files a saved time under the family's day, edges included", () => {
    expect(recordDay("2026-11-03T13:59:59.000Z", guam)).toBe("2026-11-03");
    expect(recordDay("2026-11-03T14:00:00.000Z", guam)).toBe("2026-11-04");
    expect(recordDay("2026-11-04T13:59:59.000Z", guam)).toBe("2026-11-04");
    expect(recordDay("not a time", guam)).toBe("");
  });
  it("copes with a day of 23 hours", () => {
    const { from, to } = dayRange("2026-03-08", "America/Los_Angeles");
    expect(from).toBe("2026-03-08T08:00:00.000Z");
    expect(to).toBe("2026-03-09T07:00:00.000Z");
  });
  it("falls back to the phone's date for an unknown zone rather than failing", () => {
    expect(() => dayRange("2026-11-04", "Not/AZone")).not.toThrow();
    expect(recordDay("2026-11-04T02:00:00.000Z", "Not/AZone")).toMatch(/^2026-11-0/);
    expect(recordDay("2026-11-04T02:00:00.000Z", null)).toMatch(/^2026-11-0/);
  });
});

describe("the day's summary", () => {
  const { from, to } = dayRange("2026-11-04", guam), late = new Date("2026-11-05T00:00:00Z");
  it("counts feeds, pee and poo, with Both on each, and says it in Kami's words", () => {
    const rows = [
      row("feeding", "2026-11-03T20:00:00Z", { method: "breast", side: "left" }), row("feeding", "2026-11-03T22:00:00Z", { method: "bottle" }),
      row("diaper", "2026-11-03T20:10:00Z", { type: "wet" }), row("diaper", "2026-11-03T21:00:00Z", { type: "dirty" }),
      row("diaper", "2026-11-03T23:00:00Z", { type: "both" }), row("diaper", "2026-11-04T00:00:00Z", { type: "dry" }),
      row("journal", "2026-11-04T01:00:00Z"),
      // The day before, on the family's clock.
      row("feeding", "2026-11-03T13:30:00Z", { method: "breast" }),
    ];
    expect(daySummary(rows, "2026-11-04", guam, late)).toBe("2 feeds · 2 pee · 2 poo · 0h sleep");
  });
  it("is singular for one feed", () => {
    expect(daySummary([row("feeding", "2026-11-03T20:00:00Z", { method: "breast" })], "2026-11-04", guam, late)).toBe("1 feed · 0 pee · 0 poo · 0h sleep");
  });
  it("counts a sleep over midnight on both days, and overlaps once", () => {
    const over = row("sleep", "2026-11-03T12:00:00Z", { end_at: "2026-11-03T16:00:00Z" });
    expect(sleepMs([over], from, to, late) / 3_600_000).toBe(2);
    expect(sleepMs([over], ...Object.values(dayRange("2026-11-03", guam)) as [string, string], late) / 3_600_000).toBe(2);
    const a = row("sleep", "2026-11-03T20:00:00Z", { end_at: "2026-11-03T22:00:00Z" }), b = row("sleep", "2026-11-03T21:00:00Z", { end_at: "2026-11-03T23:00:00Z" });
    expect(sleepMs([a, b], from, to, late) / 3_600_000).toBe(3);
  });
  it("counts a sleep still running up to now, and not one nobody ended", () => {
    const now = new Date("2026-11-03T21:00:00Z");
    expect(sleepMs([row("sleep", "2026-11-03T20:00:00Z")], from, to, now) / 3_600_000).toBe(1);
    expect(sleepMs([row("sleep", "2026-11-01T20:00:00Z")], from, to, now)).toBe(0);
  });
  it("says under an hour rather than rounding it away", () => {
    expect(daySummary([row("sleep", "2026-11-03T20:00:00Z", { end_at: "2026-11-03T20:20:00Z" })], "2026-11-04", guam, late)).toContain("<1h sleep");
  });
});
