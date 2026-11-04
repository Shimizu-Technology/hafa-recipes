import { afterEach, describe, expect, it, vi } from "vitest";
import type { BabyRecord } from "./models";
import { addVisitToCalendar, recordedShots, staysWithBaby, visitDay, visitEvent, visitsFrom, visitsVisible, wellVisits } from "./well-visits";

afterEach(() => vi.unstubAllGlobals());
const shot = (id: string, at: string, over: Partial<BabyRecord> = {}): BabyRecord =>
  ({ id, kind: "custom", title: "A shot", body: "", child_id: "kid", occurred_at: at, data: { label: "Shot" }, revision: 1, created_at: at, updated_at: at, ...over });

describe("the schedule as bundled", () => {
  it("has AAP's ages from the plan, in order", () => {
    expect(wellVisits.visits.map((visit) => visit.age)).toEqual(["3 to 5 days", "1 month", "2 months", "4 months", "6 months", "9 months", "12 months", "15 months", "18 months", "2 years", "2½ years", "3 years", "4 years", "5 years"]);
  });
  it("holds no vaccine schedule of its own, only links to both", () => {
    expect(wellVisits.vaccine_links.aap.url).toMatch(/^https:\/\/www\.healthychildren\.org\//);
    expect(wellVisits.vaccine_links.cdc.url).toMatch(/^https:\/\/www\.cdc\.gov\//);
    expect(JSON.stringify(wellVisits.visits)).not.toMatch(/vaccin|shot|hepatitis|mmr|dtap/i);
  });
  it("ships unapproved, and a release build shows no visits even when asked", () => {
    expect(wellVisits.approved).toBe(false);
    expect(visitsVisible()).toBe(false);
    vi.stubGlobal("__DEV__", false);
    expect(visitsVisible(true)).toBe(false);
    vi.stubGlobal("__DEV__", true);
    expect(visitsVisible()).toBe(false);
    expect(visitsVisible(true)).toBe(true);
    expect(visitsVisible(false, { approved: true })).toBe(true);
  });
});

describe("suggested days", () => {
  const visit = (id: string) => wellVisits.visits.find((one) => one.id === id)!;
  it("counts the first visit in days, and the rest in months, keeping the day of the month", () => {
    expect(visitDay("2026-12-10", visit("3-5-days"))).toBe("2026-12-13");
    expect(visitDay("2026-12-30", visit("3-5-days"))).toBe("2027-01-02");
    expect(visitDay("2026-12-10", visit("2-months"))).toBe("2027-02-10");
    expect(visitDay("2026-12-10", visit("5-years"))).toBe("2031-12-10");
  });
  it("lands on a shorter month's last day", () => {
    expect(visitDay("2026-12-31", visit("2-months"))).toBe("2027-02-28");
    expect(visitDay("2026-10-31", visit("4-months"))).toBe("2027-02-28");
  });
  it("splits past from upcoming, with today upcoming", () => {
    const { upcoming, past } = visitsFrom("2026-12-10", "2027-02-10");
    expect(past.map((one) => one.visit.id)).toEqual(["3-5-days", "1-month"]);
    expect(upcoming[0].visit.id).toBe("2-months");
  });
  it("becomes an all-day appointment for this child", () => {
    expect(visitEvent(visit("2-months"), "kid", "2027-02-10", "Pacific/Guam")).toEqual({ title: "2-month well visit", child_id: "kid", day: "2027-02-10", data: { all_day: true, timezone: "Pacific/Guam", category: "appointment" } });
  });
  it("has no calendar path until C2 merges, which is the hook this screen waits on", () => {
    expect(addVisitToCalendar).toBeNull();
  });
});

it("finds this child's shots, newest first, and nothing else custom", () => {
  const rows = [shot("old", "2027-01-01T02:00:00Z"), shot("new", "2027-02-01T02:00:00Z"), shot("sib", "2027-03-01T02:00:00Z", { child_id: "other" }), shot("else", "2027-03-01T02:00:00Z", { data: { label: "Other" } })];
  expect(recordedShots(rows, "kid").map((row) => row.id)).toEqual(["new", "old"]);
});

it("keeps a milestone and a shot with their baby, and leaves other custom entries free to move", () => {
  expect(staysWithBaby({ kind: "milestone", data: {} })).toBe(true);
  expect(staysWithBaby({ kind: "custom", data: { label: "Shot" } })).toBe(true);
  expect(staysWithBaby({ kind: "custom", data: { label: "Bath" } })).toBe(false);
  expect(staysWithBaby({ kind: "journal", data: {} })).toBe(false);
});
