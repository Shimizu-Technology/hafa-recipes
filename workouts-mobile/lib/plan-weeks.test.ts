import { expect, it } from "vitest";
import { groupPlanWeeks, weekRange } from "./plan-weeks";

const now = new Date("2026-10-21T12:00:00Z");

it("formats week ranges within and across months, adding the year only when needed", () => {
  expect(weekRange("2026-10-19", now, "en-US")).toBe("Oct 19 – 25");
  expect(weekRange("2026-10-26", now, "en-US")).toBe("Oct 26 – Nov 1");
  expect(weekRange("2027-03-01", now, "en-US")).toBe("Mar 1 – Mar 7, 2027");
  expect(weekRange("not-a-date", now, "en-US")).toBe("not-a-date");
});

it("groups a long plan into numbered Monday weeks with this week called out", () => {
  const sessions = ["2026-10-30", "2026-10-13", "2026-10-15", "2026-10-21", "2026-11-03", "2026-10-31"].map((date) => ({ date }));
  const weeks = groupPlanWeeks(sessions, "2026-10-21", now, "en-US");
  expect(weeks.map((w) => w.label)).toEqual([
    "Week 1 · Oct 12 – 18",
    "This week · Oct 19 – 25",
    "Week 3 · Oct 26 – Nov 1",
    "Week 4 · Nov 2 – 8",
  ]);
  expect(weeks.map((w) => [w.past, w.current])).toEqual([[true, false], [false, true], [false, false], [false, false]]);
  expect(weeks[0].items.map((s) => s.date)).toEqual(["2026-10-13", "2026-10-15"]);
  expect(weeks[2].items.map((s) => s.date)).toEqual(["2026-10-30", "2026-10-31"]);
});

it("keeps unreadable dates visible in their own group", () => {
  const weeks = groupPlanWeeks([{ date: "2026-02-30" }, { date: "2026-10-21" }, { date: "2026-03-02" }], "2026-10-21", now, "en-US");
  expect(weeks.at(-1)?.key).toBe("other");
  expect(weeks.find((w) => w.key === "other")?.items).toEqual([{ date: "2026-02-30" }]);
  expect(weeks.find((w) => w.current)?.label).toBe("This week · Oct 19 – 25");
});
