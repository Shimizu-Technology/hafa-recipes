import { expect, it } from "vitest";
import { babyAge, careGlance, glanceChild, nextFeed } from "./care-glance";
import type { BabyRecord } from "./models";

const now = new Date(2026, 9, 20, 18, 30);
const at = (date: number, hour: number) => new Date(2026, 9, date, hour).toISOString();
let id = 0;
const row = (kind: BabyRecord["kind"], occurred_at: string, data: BabyRecord["data"] = {}, child_id: string | null = "a") =>
  ({ id: `r${++id}`, kind, title: "", body: "", child_id, occurred_at, data, revision: 1, created_at: occurred_at,
    updated_at: occurred_at }) as BabyRecord;

it("describes a baby's age in the units parents use", () => {
  expect(babyAge({ birth_date: "2026-10-20" }, now)).toBe("Born today");
  expect(babyAge({ birth_date: "2026-10-19" }, now)).toBe("1 day old");
  expect(babyAge({ birth_date: "2026-10-01" }, now)).toBe("2 weeks old");
  expect(babyAge({ birth_date: "2026-06-25" }, now)).toBe("3 months old");
  expect(babyAge({ birth_date: "2023-10-20" }, now)).toBe("3 years old");
  expect(babyAge({ due_date: "2026-11-01" }, now)).toBe("Due in 12 days");
  expect(babyAge({ due_date: "2026-10-20" }, now)).toBe("Due today");
  expect(babyAge({ due_date: "2026-10-18" }, now)).toBe("2 days past due");
  expect(babyAge({ birth_date: "2026-11-01" }, now)).toBe("");
  expect(babyAge({}, now)).toBe("");
});

it("summarizes today's care for one baby only", () => {
  const rows = [
    row("feeding", at(20, 16), { method: "breast", side: "left" }),
    row("feeding", at(20, 13), { method: "breast", side: "right" }),
    row("feeding", at(20, 17), { method: "bottle" }, "b"),
    row("diaper", at(20, 15), { type: "wet" }),
    row("diaper", at(20, 9), { type: "both" }),
    row("diaper", at(19, 23), { type: "dirty" }),
    row("diaper", at(20, 10), { type: "dirty" }, null),
    row("sleep", at(20, 14), { end_at: at(20, 15) }),
    row("sleep", at(20, 17)),
  ];
  const glance = careGlance(rows, "a", now);
  expect(glance.lastFeed?.data.side).toBe("left");
  expect(glance.feeds).toBe(2);
  expect(glance.diapers).toEqual({ total: 2, wet: 2, dirty: 1 });
  expect(glance.openSleep?.occurred_at).toBe(at(20, 17));
  expect(glance.lastSleep?.data.end_at).toBe(at(20, 15));
  expect(careGlance([], "a", now)).toEqual({ diapers: { total: 0, wet: 0, dirty: 0 }, feeds: 0 });
});

it("picks the selected baby or falls back to the first profile", () => {
  const children = [{ id: "a", name: "A", revision: 1 }, { id: "b", name: "B", revision: 1 }];
  const bootstrap = { profile: { display_name: "", timezone: "", ai_consent: false }, children, generation: 1,
    ai_available: false };
  expect(glanceChild({ bootstrap, selectedChild: "b" })?.id).toBe("b");
  expect(glanceChild({ bootstrap, selectedChild: null })?.id).toBe("a");
  expect(glanceChild({ bootstrap, selectedChild: "removed" })?.id).toBe("a");
  expect(glanceChild({ bootstrap: { ...bootstrap, children: [] }, selectedChild: null })).toBeNull();
});

it("suggests the other side after a one-sided breastfeed and keeps bottle details", () => {
  expect(nextFeed({ data: { method: "breast", side: "left" } })).toEqual({ method: "breast", side: "right" });
  expect(nextFeed({ data: { method: "breast", side: "right" } })).toEqual({ method: "breast", side: "left" });
  expect(nextFeed({ data: { method: "breast", side: "both" } })).toEqual({ method: "breast", side: "both" });
  expect(nextFeed({ data: { method: "bottle", unit: "oz", amount: 4 } })).toEqual({ method: "bottle", unit: "oz" });
  expect(nextFeed()).toEqual({ method: "breast", side: "both" });
});
