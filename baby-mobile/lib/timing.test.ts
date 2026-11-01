import { describe, expect, it } from "vitest";
import { optimisticRecord, type BabyRecord, type Relevance } from "./models";
import {
  babyAgeWeeks, byStart, dueLine, matchesTiming, pregnancyProgress, relevanceFromForm, timingContext, timingForm, timingLabel, tipTopic, todayStage,
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
  it("labels a tip with her category first, then a pending suggestion, then an extracted topic", () => {
    const row = tip("bag", null, { topics: ["Packing"], suggested_category: { name: "Hospital bag", status: "pending" } });
    const folder = { ...tip("folder"), kind: "collection" as const, title: "Labor prep", data: { record_ids: ["bag"] } };
    expect(tipTopic(row, [folder])).toBe("Labor prep");
    expect(tipTopic(row, [])).toBe("Hospital bag");
    expect(tipTopic({ ...row, data: { ...row.data, suggested_category: { name: "Hospital bag", status: "dismissed" } } }, [])).toBe("Packing");
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
