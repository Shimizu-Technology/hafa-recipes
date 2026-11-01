import { describe, expect, it } from "vitest";
import { optimisticRecord, type BabyRecord, type Child, type Relevance } from "./models";
import {
  babyAgeWeeks, byStart, dueLine, matchesTiming, pregnancyProgress, profileToday, relevanceFromForm, timingChild, timingContext, timingForm,
  timingLabel, tipTopic, todayStage,
} from "./timing";

const today = new Date(2026, 10, 1, 9, 30);
const tip = (id: string, relevance?: Relevance | null, extra = {}): BabyRecord => optimisticRecord({
  id, kind: "source", title: id, body: "", child_id: null, occurred_at: "2026-10-20T00:00:00Z", data: { relevance, ...extra },
});

describe("pregnancy progress", () => {
  it("counts Kami's week and days to go the way the API does", () => {
    expect(pregnancyProgress("2026-12-10", today)).toEqual({ week: 34, day: 3, daysLeft: 39 });
    expect(dueLine("2026-12-10", today)).toBe("Due Dec 10 · 39 days to go");
    expect(dueLine("2026-11-02", today)).toBe("Due Nov 2 · 1 day to go");
    expect(dueLine("2026-11-01", today)).toBe("Due today · Nov 1");
    expect(dueLine("2026-10-30", today)).toBe("Due Oct 30 · 2 days past due");
    expect(pregnancyProgress("2027-08-30", today)).toMatchObject({ week: 0, day: 0 });
    expect(pregnancyProgress("not a date", today)).toBeNull();
  });
  it("is pregnant until a birth date on or before today", () => {
    expect(todayStage({ due_date: "2026-12-10" }, today)).toBe("pregnancy");
    expect(todayStage({ due_date: "2026-12-10", birth_date: "2026-11-02" }, today)).toBe("pregnancy");
    expect(todayStage({ due_date: "2026-12-10", birth_date: "2026-11-01" }, today)).toBe("baby");
    expect(todayStage({}, today)).toBe("none");
    expect(todayStage(null, today)).toBe("none");
    expect(timingContext({ due_date: "2026-12-10" }, today)).toEqual({ stage: "pregnancy", value: 34 });
    expect(timingContext({ birth_date: "2026-09-01" }, today)).toEqual({ stage: "baby", value: 8 });
    expect(babyAgeWeeks("2026-10-31", today)).toBe(0);
  });
});

describe("a stale due date, several children and the profile's day", () => {
  it("asks for the birth date past 44 weeks 6 days instead of showing a late week forever", () => {
    // Due 2026-09-21 → 280 + 41 = 321 days on 2026-11-01; 2026-09-28 → 314 days (44w6d), the last pregnant day.
    expect(todayStage({ due_date: "2026-09-28" }, today)).toBe("pregnancy");
    expect(pregnancyProgress("2026-09-28", today)).toMatchObject({ week: 44, day: 6 });
    expect(todayStage({ due_date: "2026-09-27" }, today)).toBe("needs_birth");
    expect(pregnancyProgress("2026-09-21", today)).toMatchObject({ week: 44, day: 6, daysLeft: -41 });
    expect(timingContext({ due_date: "2026-09-21" }, today)).toBeNull();
    expect(todayStage({ due_date: "2026-09-21", birth_date: "2026-09-20" }, today)).toBe("baby");
  });
  it("prefers the one ongoing pregnancy over older siblings, like the API, unless a child is selected", () => {
    const older: Child = { id: "ana", name: "Ana", birth_date: "2024-05-01", revision: 1 },
      isla: Child = { id: "isla", name: "Isla", due_date: "2026-12-10", revision: 1 },
      stale: Child = { id: "old", name: "Old", due_date: "2026-01-01", revision: 1 },
      state = (children: Child[], selectedChild: string | null = null) => ({ selectedChild,
        bootstrap: { generation: 1, ai_available: false, children, profile: { display_name: "", timezone: "Pacific/Guam", ai_consent: false } } });
    expect(timingChild(state([older, isla]), today)?.id).toBe("isla");
    expect(timingChild(state([older, isla], "ana"), today)?.id).toBe("ana");
    expect(timingChild(state([older, stale]), today)?.id).toBe("ana"); // ambiguous for the API: keep Today's child
    expect(timingChild(state([stale, { id: "none", name: "A", revision: 1 }]), today)?.id).toBe("old");
    expect(timingChild(state([]), today)).toBeNull();
  });
  it("counts today in the profile's time zone, not the phone's", () => {
    // 2026-10-31 15:30 UTC is already Nov 1 in Guam (UTC+10) but still Oct 31 in Honolulu.
    const instant = new Date("2026-10-31T15:30:00Z");
    expect(profileToday(instant, "Pacific/Guam")).toEqual(new Date(2026, 10, 1));
    expect(profileToday(instant, "Pacific/Honolulu")).toEqual(new Date(2026, 9, 31));
    expect(pregnancyProgress("2026-12-10", profileToday(instant, "Pacific/Guam"))).toMatchObject({ week: 34, day: 3 });
    expect(profileToday(today, "Not/AZone")).toEqual(new Date(2026, 10, 1));
  });
});

describe("stated timing", () => {
  it("describes only what was stated, in the unit the source used", () => {
    expect(timingLabel({ stage: "pregnancy", pregnancy_week_min: 37, pregnancy_week_max: null })).toBe("From 37 weeks");
    expect(timingLabel({ pregnancy_week_min: 36, pregnancy_week_max: 38 })).toBe("36–38 weeks");
    expect(timingLabel({ pregnancy_week_min: 20, pregnancy_week_max: 20 })).toBe("Week 20");
    expect(timingLabel({ pregnancy_week_max: 13 })).toBe("Up to 13 weeks");
    expect(timingLabel({ stage: "postpartum", baby_age_min_weeks: 0, baby_age_max_weeks: 13, baby_age_unit: "months" })).toBe("0–3 months");
    expect(timingLabel({ stage: "baby", baby_age_min_weeks: 26, baby_age_unit: "months" })).toBe("From 6 months");
    expect(timingLabel({ stage: "baby", baby_age_min_weeks: 0, baby_age_max_weeks: 6, baby_age_unit: "weeks" })).toBe("0–6 weeks");
    expect(timingLabel({ stage: "pregnancy" })).toBe("During pregnancy");
    expect(timingLabel(null)).toBe("");
  });
  it("matches now and coming up with open bounds, and never mixes pregnancy and baby tips", () => {
    const now = { stage: "pregnancy" as const, value: 34 };
    const tips = [tip("tea", { pregnancy_week_min: 37 }), tip("bag", { pregnancy_week_min: 32, pregnancy_week_max: 36 }),
      tip("any", { stage: "pregnancy" }), tip("late", { pregnancy_week_min: 35 }), tip("newborn", { stage: "baby", baby_age_max_weeks: 13 }), tip("none")];
    expect(tips.filter((row) => matchesTiming(row, "now", now)).map((row) => row.id)).toEqual(["bag", "any"]);
    expect(tips.filter((row) => matchesTiming(row, "upcoming", now)).sort(byStart("pregnancy")).map((row) => row.id)).toEqual(["late", "tea"]);
    expect(tips.filter((row) => matchesTiming(row, "now", { stage: "baby", value: 2 })).map((row) => row.id)).toEqual(["newborn"]);
    expect(matchesTiming({ ...tips[1], kind: "journal" }, "now", now)).toBe(false);
  });
  it("labels a tip with her category first, then an extracted topic, never a pending AI suggestion", () => {
    const row = tip("bag", null, { topics: ["Packing"], suggested_category: { name: "Hospital bag", status: "pending" } });
    const folder = { ...tip("folder"), kind: "collection" as const, title: "Labor prep", data: { record_ids: ["bag"] } };
    expect(tipTopic(row, [folder])).toBe("Labor prep");
    expect(tipTopic(row, [])).toBe("Packing");
    expect(tipTopic({ ...row, data: { suggested_category: { name: "Hospital bag", status: "pending" } } }, [])).toBe("");
  });
});

describe("timing editor", () => {
  it("round-trips a stated range and keeps the source quote when nothing changed", () => {
    const stated: Relevance = { stage: "pregnancy", pregnancy_week_min: 37, pregnancy_week_max: null, quote: "When you get to 37 weeks", origin: "source" };
    expect(timingForm(stated)).toEqual({ stage: "pregnancy", from: "37", to: "", unit: "weeks" });
    expect(relevanceFromForm(timingForm(stated), stated)).toEqual({ relevance: expect.objectContaining({ pregnancy_week_min: 37, quote: "When you get to 37 weeks" }) });
    expect(relevanceFromForm({ ...timingForm(stated), from: "36" }, stated)).toEqual({ relevance: {
      stage: "pregnancy", pregnancy_week_min: 36, pregnancy_week_max: null, baby_age_min_weeks: null, baby_age_max_weeks: null, baby_age_unit: null, quote: null } });
  });
  it("stores baby months as weeks, keeps postpartum, clears with Any time, and explains bad input", () => {
    const months = relevanceFromForm({ stage: "baby", from: "0", to: "3", unit: "months" }, { stage: "postpartum" });
    expect(months).toEqual({ relevance: expect.objectContaining({ stage: "postpartum", baby_age_min_weeks: 0, baby_age_max_weeks: 13, baby_age_unit: "months" }) });
    expect(timingForm({ stage: "baby", baby_age_min_weeks: 0, baby_age_max_weeks: 13, baby_age_unit: "months" })).toEqual({ stage: "baby", from: "0", to: "3", unit: "months" });
    expect(relevanceFromForm({ stage: "pregnancy", from: "", to: "", unit: "weeks" })).toEqual({ relevance: expect.objectContaining({ stage: "pregnancy", pregnancy_week_min: null }) });
    expect(relevanceFromForm({ stage: "none", from: "", to: "", unit: "weeks" })).toEqual({ relevance: null });
    expect(relevanceFromForm({ stage: "pregnancy", from: "50", to: "", unit: "weeks" })).toEqual({ error: "Enter a week from 0 to 45." });
    expect(relevanceFromForm({ stage: "pregnancy", from: "3.5", to: "", unit: "weeks" })).toEqual({ error: "Enter a week from 0 to 45." });
    expect(relevanceFromForm({ stage: "baby", from: "6", to: "3", unit: "months" })).toEqual({ error: "The start needs to come before the end." });
    expect(timingForm(undefined)).toEqual({ stage: "none", from: "", to: "", unit: "months" });
  });
});
