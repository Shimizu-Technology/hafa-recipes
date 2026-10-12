import { it, expect } from "vitest";
import { contextErrors, optionalNumber, canonicalDistance, displayedDistance, scheduleDate } from "./profile-context";
import { initialProfile } from "./models";
it("preserves unspecified numeric context and rejects partial or nondecimal facts", () => {
  expect(optionalNumber("")).toBeNull();
  expect(optionalNumber("  ")).toBeNull();
  expect(optionalNumber("0")).toBe(0);
  expect(optionalNumber("1.5")).toBe(1.5);
  expect(optionalNumber(".")).toBeNaN();
  expect(optionalNumber("0x20")).toBeNaN();
  expect(optionalNumber("1e2")).toBeNaN();
});
it("converts event miles without changing source units or other profile fields", () => {
  expect(canonicalDistance(3.1, true)).toBeCloseTo(4.9889664, 8);
  expect(displayedDistance(4.9889664, true)).toBeCloseTo(3.1, 8);
  expect(canonicalDistance(5, false)).toBe(5);
});
it("validates optional baseline boundaries without inventing recent history", () => {
  const profile = { ...initialProfile(), adult_confirmed: true };
  expect(contextErrors(profile)).toEqual([]);
  expect(
    contextErrors({
      ...profile,
      running_baseline: {
        novice_start_confirmed: false,
        accepted_stage: 0,
        recent_runs_per_week: NaN,
        recent_weekly_minutes: 1.5,
        event_distance_km: 0,
        event_date: "2026-02-30",
      },
    })
  ).toHaveLength(4);
  expect(
    contextErrors({
      ...profile,
      running_baseline: {
        novice_start_confirmed: false,
        accepted_stage: 0,
        recent_runs_per_week: 0,
        recent_weekly_minutes: 0,
        event_date: null,
      },
    })
  ).toEqual([]);
});
it("validates schedule context independently of completed sessions and derives profile-zone dates", () => {
  const profile = initialProfile();
  expect(
    contextErrors({
      ...profile,
      other_activities: [{ date: "2026-10-10", name: "Basketball", strenuous: null, duration_minutes: null }],
    })
  ).toEqual([]);
  expect(
    contextErrors({
      ...profile,
      other_activities: [{ date: "2026-02-30", name: " ", strenuous: true, duration_minutes: -1 }],
    })
  ).toHaveLength(3);
  expect(scheduleDate("Pacific/Guam", new Date("2026-10-09T15:00:00Z"))).toBe("2026-10-10");
  expect(scheduleDate("America/Los_Angeles", new Date("2026-10-09T15:00:00Z"))).toBe("2026-10-09");
});
it("prevents repeated or primary goals from being listed as secondary priorities", () => {
  const p = initialProfile();
  expect(contextErrors({ ...p, secondary_goals: ["running", "strength"] })).toEqual([]);
  expect(contextErrors({ ...p, secondary_goals: ["general_fitness", "running", "running"] })).toHaveLength(1);
});
