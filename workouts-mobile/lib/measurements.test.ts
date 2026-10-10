import { describe, it, expect, vi } from "vitest";
import { parseRecordedTime, measurementErrors, profileMeasurementErrors } from "./measurements";
import { initialProfile } from "./models";
import { createWorkoutsApi } from "./api";
describe("explicit measurement history", () => {
  it("preserves aware timestamps and refuses partial or nonexistent calendar values", () => {
    expect(parseRecordedTime("2026-10-10T09:30:00+10:00")).toBe("2026-10-09T23:30:00.000Z");
    expect(parseRecordedTime("2026-02-31T09:30:00Z")).toBeNull();
    expect(parseRecordedTime("2")).toBeNull();
    expect(parseRecordedTime("2026-10-10T25:30:00Z")).toBeNull();
  });
  it("validates original units against canonical bounds without inferred health metrics", () => {
    expect(measurementErrors("weight", "180", "lb", "2026-10-01T00:00:00Z")).toEqual([]);
    expect(measurementErrors("height", "68", "in", "2026-10-01T00:00:00Z")).toEqual([]);
    expect(measurementErrors("weight", "100", "cm", "2026-10-01T00:00:00Z")).not.toEqual([]);
    expect(measurementErrors("height", "400", "cm", null)).toHaveLength(2);
  });
  it("keeps original generation/profile/measurement revisions and stable operation IDs in correction retries", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(Error("lost response"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            measurement: { id: "owned" },
            profile_revision: 9,
            current_applied: false,
            context_reset: true,
            profile: null,
          })
        )
      );
    const api = createWorkoutsApi("https://example.test", async () => "token", transport);
    const body = {
      request_id: "request",
      expected_revision: 3,
      value: 180,
      unit: "lb" as const,
      recorded_at: "2026-10-01T00:00:00Z",
      source: "user" as const,
      update_current: false,
    };
    await expect(api.saveMeasurement("owned", body, 7, 2)).rejects.toThrow();
    await api.saveMeasurement("owned", body, 7, 2);
    expect(transport.mock.calls[0][1].headers["If-Match"]).toBe('"7"');
    expect(transport.mock.calls[1][1].headers["X-Workouts-Generation"]).toBe("2");
    expect(transport.mock.calls[0][1].body).toBe(transport.mock.calls[1][1].body);
    expect(api.profileRevision()).toBe(9);
  });
  it("requires an explicit revision-bearing profile snapshot before editing measurements", async () => {
    const api = createWorkoutsApi(
      "https://example.test",
      async () => "token",
      vi.fn().mockResolvedValue(new Response("null"))
    );
    await expect(api.profileSnapshot()).rejects.toMatchObject({ status: 428 });
  });
});

it("requires a paired timestamp for changed values while preserving legacy unknown time on ordinary profile saves", () => {
  const legacy = { ...initialProfile(), weight_kg: 80, weight_recorded_at: null };
  expect(profileMeasurementErrors({ ...legacy, session_minutes: 30 }, legacy)).toEqual([]);
  expect(profileMeasurementErrors({ ...legacy, weight_kg: 81 }, legacy)).toHaveLength(1);
  expect(
    profileMeasurementErrors({ ...legacy, weight_kg: 81, weight_recorded_at: "2026-10-01T12:00:00+10:00" }, legacy)
  ).toEqual([]);
  expect(profileMeasurementErrors({ ...legacy, weight_kg: null }, legacy)).toEqual([]);
});

it("accepts API microseconds while retaining strict dates and future-time checks", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T18:30:00Z"));
  try {
    expect(parseRecordedTime("2026-10-10T18:22:55.903127+00:00")).toBe("2026-10-10T18:22:55.903Z");
    expect(parseRecordedTime("2026-10-11T04:22:55.903127+10:00")).toBe("2026-10-10T18:22:55.903Z");
    expect(measurementErrors("weight", "178.8", "lb", "2026-10-10T18:22:55.903127+00:00")).toEqual([]);
    expect(profileMeasurementErrors({ ...initialProfile(), weight_kg: 80, weight_recorded_at: "2026-10-10T18:22:55.903127Z" })).toEqual([]);
    expect(measurementErrors("weight", "178.8", "lb", "2026-10-10T19:22:55.903127Z")).toHaveLength(1);
    expect(parseRecordedTime("2026-02-31T18:22:55.903127Z")).toBeNull();
    expect(parseRecordedTime("2026-10-10T18:22:55.9031277Z")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
