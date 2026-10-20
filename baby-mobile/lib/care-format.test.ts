import { expect, it } from "vitest";
import { careSummary, defaultChild, duration, friendlyDate, friendlyTime, timeAgo } from "./care-format";

const now = new Date(2026, 9, 20, 18, 30);
const at = (day: number, hour: number, min = 0) => new Date(2026, 9, day, hour, min).toISOString();

it("summarizes feeds with method, side, amount and duration and never shows empty values", () => {
  expect(careSummary("feeding", { method: "breast", side: "left", duration_minutes: 15 }, at(20, 18))).toBe(
    "Breastfeeding · Left side · 15 min"
  );
  expect(careSummary("feeding", { method: "bottle", amount: 4, unit: "oz", side: "left" }, at(20, 18))).toBe(
    "Bottle · 4 oz"
  );
  expect(careSummary("feeding", { method: "other", amount: null, duration_minutes: null }, at(20, 18))).toBe("Feeding");
  expect(careSummary("feeding", { method: "bottle", amount: 90 }, at(20, 18))).toBe("Bottle · 90 mL");
});

it("shows open sleep as happening now and finished sleep as a duration", () => {
  expect(careSummary("sleep", {}, at(20, 17, 48), now)).toBe("Sleeping now · 42 min");
  expect(careSummary("sleep", { end_at: at(20, 15, 20) }, at(20, 14), now)).toBe("Slept 1 h 20 min");
  expect(careSummary("sleep", {}, at(18, 9), now)).toMatch(/^Sleep not ended · started /);
  expect(careSummary("sleep", {}, "not a date", now)).toBe("Sleep in progress");
  expect(careSummary("sleep", { end_at: "bad" }, at(20, 14), now)).toBe("Sleep recorded");
  expect(duration(Number.NaN)).toBe("");
  expect(careSummary("diaper", { type: "both" }, at(20, 18))).toBe("Wet and dirty diaper");
  expect(careSummary("diaper", {}, at(20, 18))).toBe("Recorded diaper");
});

it("formats durations, relative and calendar times for quick scanning", () => {
  expect(duration(-3)).toBe("0 min");
  expect(duration(60)).toBe("1 h");
  expect(duration(0.4)).toBe("under 1 min");
  expect(timeAgo(at(20, 16, 20), now)).toBe("2 h 10 min ago");
  expect(timeAgo(at(20, 18, 30), now)).toBe("just now");
  // Compare against the host locale's own formatting so the tests pass in any locale.
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  expect(friendlyTime(at(20, 6), now)).toBe(time(at(20, 6)));
  expect(friendlyTime(at(19, 23, 40), now)).toBe(`Yesterday ${time(at(19, 23, 40))}`);
  const day = new Date(at(18, 9, 15)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  expect(friendlyTime(at(18, 9, 15), now)).toBe(`${day}, ${time(at(18, 9, 15))}`);
  expect(friendlyTime("2025-01-02T10:00:00.000Z", now)).toContain("2025");
  expect(friendlyDate("2026-10-20")).toBe(
    new Date(2026, 9, 20).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
  );
});

it("files care under a baby by default while general notes stay general", () => {
  const kids = [{ id: "a" }, { id: "b" }];
  expect(defaultChild("feeding", null, [{ id: "a" }])).toBe("a");
  expect(defaultChild("sleep", "removed", [{ id: "a" }])).toBe("a");
  expect(defaultChild("diaper", "b", kids)).toBe("b");
  // With several babies and none selected, the parent chooses.
  expect(defaultChild("feeding", null, kids)).toBeNull();
  expect(defaultChild("journal", null, kids)).toBeNull();
  expect(defaultChild("journal", "b", kids)).toBe("b");
  expect(defaultChild("sleep", null, [])).toBeNull();
});
