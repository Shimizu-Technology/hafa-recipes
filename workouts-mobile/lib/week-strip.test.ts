import { expect, it } from "vitest";
import { weekDays, weekSummary } from "./week-strip";

it("builds Monday–Sunday around today with done, planned and today states", () => {
  const days = weekDays("2026-10-14", new Set(["2026-10-12"]), new Set(["2026-10-14", "2026-10-16"]), "en-US");
  expect(days.map((d) => d.date)).toEqual([
    "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18",
  ]);
  expect(days.map((d) => d.state)).toEqual(["done", "rest", "today", "rest", "planned", "rest", "rest"]);
  expect(days.map((d) => d.label).join("")).toBe("MTWTFSS");
  expect(days[2].accessibilityLabel).toBe("Wednesday, today, session planned");
});

it("treats Sunday as the end of the week and recorded training wins over today", () => {
  const days = weekDays("2026-10-18", new Set(["2026-10-18"]), new Set(), "en-US");
  expect(days[0].date).toBe("2026-10-12");
  expect(days[6]).toMatchObject({ date: "2026-10-18", state: "done" });
});

it("weekly numbers count recorded work in the profile timezone and keep active minutes", () => {
  const session = (started_at: string, active_seconds: number, completed = true) => ({ started_at, finished_at: started_at, active_seconds, actuals: [{ completed }] });
  const summary = weekSummary("2026-10-14", [session("2026-10-11T23:30:00Z", 600), session("2026-10-13T01:00:00Z", 1200), session("2026-10-14T01:00:00Z", 300, false)], "Pacific/Guam");
  expect(summary).toEqual({ sessions: 2, minutes: 30, streak: 2 });
  expect(weekSummary("2026-10-16", [], "UTC")).toEqual({ sessions: 0, minutes: 0, streak: 0 });
});
