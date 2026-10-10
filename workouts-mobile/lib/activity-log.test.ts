import { it, expect } from "vitest";
import {
  weekActivity,
  activityErrors,
  activityBody,
  activityFrequency,
  operationIsCurrent,
  type ActivityDraft,
  type ActivityRecord,
  type ActivityOperation,
} from "./activity-log";
const draft: ActivityDraft = {
  owner: "A",
  generation: 2,
  target_id: null,
  kind: "run",
  date: "2026-10-10",
  name: "",
  duration: "30",
  distance: "3.1",
  distance_unit: "mi",
  notes: "",
  strenuous: null,
  confirm_completed: true,
};
it("keeps positive completed duration, date and explicit unknown demand instead of inferring facts", () => {
  expect(activityErrors(draft, "2026-10-10")).toEqual([]);
  expect(activityBody(draft, "request").strenuous).toBeNull();
  expect(activityBody(draft, "request").distance_km).toBeCloseTo(4.9889664, 8);
  expect(
    activityErrors({ ...draft, date: "2026-10-11", duration: "", confirm_completed: false }, "2026-10-10")
  ).toHaveLength(3);
  expect(activityErrors({ ...draft, date: "2026-02-30", duration: "1.5" }, "2026-10-10")).toHaveLength(2);
  expect(activityErrors({ ...draft, kind: "basketball" }, "2026-10-10")).toHaveLength(1);
});
it("captures original owner, generation and activity target for private-cache mutation fences", () => {
  const operation: ActivityOperation = {
    owner: "A",
    generation: 2,
    target_id: "entry",
    action: "save",
    body: activityBody(draft, "request"),
  };
  expect(operationIsCurrent(operation, "A", 2, "entry", true)).toBe(true);
  expect(operationIsCurrent(operation, "B", 2, "entry", true)).toBe(false);
  expect(operationIsCurrent(operation, "A", 3, "entry", true)).toBe(false);
  expect(operationIsCurrent(operation, "A", 2, "other", true)).toBe(false);
  expect(operationIsCurrent(operation, "A", 2, "entry", false)).toBe(false);
});
it("counts genuine same-day records separately while excluding unconfirmed/imported/removed observations", () => {
  const row = (id: string, patch: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id,
    generation: 2,
    revision: 1,
    status: "active",
    source: "user",
    read_only: false,
    legacy: false,
    completed_confirmed: true,
    origin_id: null,
    created_at: "2026-10-10T00:00:00Z",
    updated_at: "2026-10-10T00:00:00Z",
    content: {
      kind: "basketball",
      date: "2026-10-10",
      name: "Basketball",
      duration_minutes: 30,
      strenuous: null,
      distance_km: null,
      notes: null,
    },
    ...patch,
  });
  const result = activityFrequency(
    [
      row("one"),
      row("two"),
      row("legacy", { completed_confirmed: null, legacy: true }),
      row("health", { read_only: true, source: "external", completed_confirmed: true }),
      row("removed", { status: "removed", content: null }),
    ],
    [
      { started_at: "2026-10-09T15:00:00Z", recorded: true },
      { started_at: "2026-10-08T15:00:00Z", recorded: true },
      { started_at: "2026-10-10T00:00:00Z", recorded: false },
    ],
    "Pacific/Guam",
    "2026-10-04",
    "2026-10-10"
  );
  expect(result).toEqual({ activities: 2, sessions: 2, days: 2 });
});

it("loads all week pages and freezes calendar range while rejecting timezone changes", async () => {
  const calls: Array<{ offset: number; from?: string; to?: string }> = [];
  const result = await weekActivity(async (offset, from, to) => {
    calls.push({ offset, from, to });
    return {
      items: [],
      has_more: from != null && offset === 0,
      timezone: "Pacific/Guam",
      today: "2026-10-10",
      limit: 50,
      offset,
    };
  });
  expect(result.from).toBe("2026-10-04");
  expect(result.to).toBe("2026-10-10");
  expect(calls.map((call) => call.offset)).toEqual([0, 0, 50]);
  expect(result.complete).toBe(true);
  await expect(
    weekActivity(async (offset, from) => ({
      items: [],
      has_more: false,
      timezone: from ? "America/Los_Angeles" : "Pacific/Guam",
      today: "2026-10-10",
      limit: 50,
      offset,
    }))
  ).rejects.toThrow("timezone changed");
});
