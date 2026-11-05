import { expect, it } from "vitest";
import { nextSide, babyAge, sleepGlanceDetail, careGlance, glanceChild, nextFeed } from "./care-glance";
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

it("counts today on the family's clock, half-open, and breaks a next-side tie by record id", () => {
  const moment = new Date("2026-11-04T03:00:00.000Z"), day = (at: string) => row("diaper", at, { type: "wet" });
  // Today in Tokyo runs from 15:00Z on the 3rd until 15:00Z on the 4th, whatever zone the phone is in.
  const rows = [day("2026-11-03T14:59:59.000Z"), day("2026-11-03T15:00:00.000Z"), day("2026-11-04T02:00:00.000Z"), day("2026-11-04T15:00:00.000Z")];
  expect(careGlance(rows, "a", moment, "Asia/Tokyo").diapers.total).toBe(2);
  expect(careGlance(rows, "a", moment, "America/Los_Angeles").diapers.total).toBe(3);
  const breast = (id: string, side: "left" | "right", at: string) => ({ ...row("feeding", at, { method: "breast", side }), id });
  expect(nextSide([breast("b", "left", "2026-11-04T22:00:00+10:00"), breast("a", "right", "2026-11-04T12:00:00.000Z")], "a")).toBe("right");
  expect(nextSide([breast("a", "right", "2026-11-04T12:00:00.000Z"), breast("b", "left", "2026-11-04T22:00:00+10:00")], "a")).toBe("right");
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
  expect(careGlance([], "a", now)).toEqual({ diapers: { total: 0, wet: 0, dirty: 0 }, feeds: 0, openSleeps: [] });
  // A forgotten open sleep from days ago is not "now".
  expect(careGlance([row("sleep", at(18, 20))], "a", now).openSleep).toBeUndefined();
  // One today still is, even behind a newer finished sleep: it would otherwise be stranded with no way to end it.
  const stranded = row("sleep", at(20, 9));
  expect(careGlance([stranded, row("sleep", at(20, 12), { end_at: at(20, 13) })], "a", now).openSleep).toBe(stranded);
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
  expect(nextFeed({ data: { method: "bottle", unit: "oz", amount: 4 } })).toEqual({ method: "bottle", side: undefined, unit: "oz" });
  expect(nextFeed()).toEqual({ method: "breast", side: "both" });
});

it("omits missing or invalid awake facts without dangling separators", () => {
  expect(sleepGlanceDetail({ lastSleep: row("sleep", at(20, 13), { end_at: "invalid" }) }, now)).toBe("Sleep recorded");
  expect(sleepGlanceDetail({ lastSleep: row("sleep", "invalid", { end_at: at(20, 15) }) }, now)).toBe("Woke 3 h 30 min ago");
  expect(sleepGlanceDetail({ lastSleep: row("sleep", at(20, 13)) }, now)).toBe("Sleep recorded");
  expect(sleepGlanceDetail({ lastSleep: row("sleep", at(20, 13), { end_at: at(20, 15) }) }, now)).toBe("Woke 3 h 30 min ago · Last sleep 2 h");
  expect(sleepGlanceDetail({ openSleep: row("sleep", at(20, 17)) }, now)).toBe("1 h 30 min");
  expect(sleepGlanceDetail({}, now)).toBe("Log sleep or review your care history.");
});

const breastfeed = (id: string, occurred_at: string, data: BabyRecord["data"], child_id = "baby") =>
  ({ id, kind: "feeding", child_id, occurred_at, data, title: "", body: "", revision: 1, created_at: occurred_at, updated_at: occurred_at }) as BabyRecord;
it("takes the next side as the opposite of the newest one-sided breastfeed, past bottles, Both and other babies", () => {
  expect(nextSide([
    breastfeed("bottle", "2026-11-04T05:00:00Z", { method: "bottle", amount: 3, unit: "oz" }),
    breastfeed("both", "2026-11-04T04:00:00Z", { method: "breast", side: "both" }),
    breastfeed("other", "2026-11-04T03:30:00Z", { method: "breast", side: "right" }, "sibling"),
    breastfeed("left", "2026-11-04T03:00:00Z", { method: "breast", side: "left" }),
    breastfeed("right", "2026-11-04T01:00:00Z", { method: "breast", side: "right" }),
  ], "baby")).toBe("right");
});
it("suggests no next side when there is no one-sided feed to go on", () => {
  expect(nextSide([], "baby")).toBeUndefined();
  expect(nextSide([breastfeed("both", "2026-11-04T04:00:00Z", { method: "breast", side: "both" })], "baby")).toBeUndefined();
});

it("knows about every sleep still open for this baby, newest first", () => {
  const older = row("sleep", at(20, 9)), newer = row("sleep", at(20, 12)), done = row("sleep", at(20, 10), { end_at: at(20, 11) }), forgotten = row("sleep", at(18, 20));
  const glance = careGlance([older, done, newer, forgotten, { ...row("sleep", at(20, 8)), child_id: "other" }], "a", now);
  expect(glance.openSleeps).toEqual([newer, older]);
  expect(glance.openSleep).toBe(newer);
});
