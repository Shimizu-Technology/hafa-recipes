import { describe, expect, it, vi } from "vitest";
import { createHealthKitProvider, type HealthKitBridge } from "./provider.ios";
import { createHealthConnectProvider, type HealthConnectBridge } from "./provider.android";
import { createNativeHealthProvider } from "./provider";
import { createHealthSync, type HealthGrant, type HealthSyncState } from "./sync";
import { eligibility, reconcileObservations, validateActual, validateWindow, pausedIntervals } from "./shared";
import {
  SYNC_PREFIX,
  WORKOUTS_APP_ID,
  type ActualWorkout,
  type HealthObservation,
  type HealthPage,
  type HealthProvider,
} from "./types";

const START = "2026-10-01T00:00:00.000Z",
  END = "2026-10-01T00:10:00.000Z";
const WINDOW = { start: "2026-09-20T00:00:00.000Z", end: "2026-10-10T00:00:00.000Z" };
const ACTUAL: ActualWorkout = {
  canonical_session_id: "session_1",
  revision: 1,
  status: "completed",
  started_at: START,
  ended_at: END,
  active_seconds: 600,
  activity: "running",
};
const GRANT: HealthGrant = {
  owner_scope: "owner-a",
  generation: 1,
  connected: true,
  read_on_device: true,
  upload_to_server: true,
  use_for_ai: false,
  write_actuals: false,
};
const OBSERVATION: HealthObservation = {
  source_id: "apple_health:external-1",
  provider: "apple_health",
  origin_id: "com.example.watch",
  started_at: START,
  ended_at: END,
  duration_seconds: 600,
  duration_basis: "provider_reported",
  activity_type: "running",
  ai_eligibility: "unknown",
};
const PAGE: HealthPage = {
  observations: [OBSERVATION],
  deleted_source_ids: [],
  next_cursor: {
    provider: "apple_health",
    window_start: WINDOW.start,
    window_end: WINDOW.end,
    phase: "changes",
    anchor: "anchor-1",
  },
  has_more: false,
  reset_required: false,
  coverage_notes: [],
};

function hkSample(id = "one", origin = "com.example.watch", metadata: Record<string, unknown> = {}) {
  const raw = {
    uuid: id,
    sourceRevision: { source: { bundleIdentifier: origin, name: origin } },
    startDate: new Date(START),
    endDate: new Date(END),
    duration: { quantity: 600, unit: "s" },
    workoutActivityType: 37,
    metadata,
  };
  return { ...raw, toJSON: () => raw };
}
function hkBridge() {
  const fake = {
    isHealthDataAvailableAsync: vi.fn(async () => true),
    requestAuthorization: vi.fn(async () => true),
    authorizationStatusFor: vi.fn(() => 2),
    queryWorkoutSamplesWithAnchor: vi.fn(async () => ({ workouts: [], deletedSamples: [], newAnchor: "anchor" })),
    queryWorkoutSamples: vi.fn(async () => []),
    saveWorkoutSample: vi.fn(async () => hkSample("saved", WORKOUTS_APP_ID)),
    deleteObjects: vi.fn(async () => 1),
  };
  return { fake, bridge: fake as unknown as HealthKitBridge };
}
function hcRecord(id = "one", origin = "com.example.watch", clientRecordId?: string) {
  return {
    recordType: "ExerciseSession" as const,
    startTime: START,
    endTime: END,
    exerciseType: 56,
    metadata: { id, dataOrigin: origin, ...(clientRecordId ? { clientRecordId } : {}) },
  };
}
function hcBridge() {
  const fake = {
    getSdkStatus: vi.fn(async () => 3),
    initialize: vi.fn(async () => true),
    requestPermission: vi.fn(async () => []),
    getGrantedPermissions: vi.fn(async () => [
      { accessType: "read", recordType: "ExerciseSession" },
      { accessType: "write", recordType: "ExerciseSession" },
    ]),
    readRecords: vi.fn(async () => ({ records: [hcRecord()] })),
    getChanges: vi.fn(async () => ({
      upsertionChanges: [],
      deletionChanges: [],
      nextChangesToken: "changes-1",
      changesTokenExpired: false,
      hasMore: false,
    })),
    insertRecords: vi.fn(async () => ["saved"]),
    deleteRecordsByUuids: vi.fn(async () => {}),
    openHealthConnectSettings: vi.fn(),
  };
  return { fake, bridge: fake as unknown as HealthConnectBridge };
}
function syncFixture(provider?: HealthProvider) {
  let grant = { ...GRANT };
  let state: HealthSyncState | null = null;
  const readPage = vi.fn(async () => PAGE);
  const fake =
    provider ??
    ({
      platform: "apple_health",
      readPage,
      exportActual: vi.fn(async () => ({ status: "written", canonical_session_id: "session_1", revision: 1 })),
    } as unknown as HealthProvider);
  const deps = {
    currentGrant: vi.fn(async () => grant),
    isForeground: vi.fn(() => true),
    loadState: vi.fn(async () => state),
    saveState: vi.fn(async (value: HealthSyncState) => {
      state = value;
    }),
    upload: vi.fn(async () => {}),
    revoke: vi.fn(async () => {}),
  };
  return {
    sync: createHealthSync(fake, deps),
    deps,
    readPage,
    setGrant: (value: HealthGrant) => {
      grant = value;
    },
    setState: (value: HealthSyncState) => {
      state = value;
    },
  };
}

describe("minimal Apple Health adapter", () => {
  it("never interprets authorization success or empty records as read grant/denial", async () => {
    const { fake, bridge } = hkBridge();
    fake.authorizationStatusFor.mockReturnValue(0);
    const provider = createHealthKitProvider(bridge, async () => {});
    const access = await provider.requestAccess({ read: true, write: false });
    expect(access.read).toBe("unknown");
    expect(access.write).toBe("not_requested");
    expect(fake.requestAuthorization).toHaveBeenCalledWith({ toRead: ["HKWorkoutTypeIdentifier"], toShare: [] });
    const page = await provider.readPage(null, WINDOW);
    expect(page.observations).toEqual([]);
    expect(page.coverage_notes[0]).toContain("read denial is not observable");
  });
  it("reports existing native write authorization after recreation without enabling app write consent", async () => {
    const { bridge } = hkBridge();
    expect((await createHealthKitProvider(bridge, async () => {}).access()).write).toBe("granted");
  });
  it("anchors include deletions and preserve UTC timestamps, exclude own echoes", async () => {
    const { fake, bridge } = hkBridge();
    fake.queryWorkoutSamplesWithAnchor.mockResolvedValueOnce({
      workouts: [
        hkSample(),
        hkSample("own", WORKOUTS_APP_ID),
        hkSample("echo", "external", { HKSyncIdentifier: `${SYNC_PREFIX}session_1` }),
        hkSample("strava", "com.strava.app"),
      ],
      deletedSamples: [{ uuid: "deleted" }],
      newAnchor: "new",
    } as never);
    const page = await createHealthKitProvider(bridge, async () => {}).readPage(null, WINDOW);
    expect(page.observations.map((value) => value.source_id)).toEqual(["apple_health:one", "apple_health:strava"]);
    expect(page.observations[1].ai_eligibility).toBe("restricted");
    expect(page.observations[0].started_at).toBe(START);
    expect(page.deleted_source_ids).toEqual(["apple_health:deleted"]);
    expect(page.next_cursor.anchor).toBe("new");
    expect(fake.queryWorkoutSamplesWithAnchor.mock.calls[0]).toEqual([
      { limit: 100, filter: { date: { startDate: new Date(WINDOW.start), strictStartDate: true } } },
    ]);
  });
  it("writes actuals with native sync metadata and checks an already-written revision", async () => {
    const { fake, bridge } = hkBridge();
    const provider = createHealthKitProvider(bridge, async () => {});
    expect((await provider.exportActual(ACTUAL)).status).toBe("written");
    expect(fake.saveWorkoutSample.mock.calls[0]).toEqual([
      37,
      [],
      new Date(START),
      new Date(END),
      undefined,
      { HKSyncIdentifier: `${SYNC_PREFIX}session_1`, HKSyncVersion: 1, "hafa.partial": false },
    ]);
    fake.queryWorkoutSamples.mockResolvedValueOnce([
      hkSample("saved", WORKOUTS_APP_ID, { HKSyncIdentifier: `${SYNC_PREFIX}session_1`, HKSyncVersion: 1 }),
    ] as never);
    expect((await provider.exportActual(ACTUAL)).status).toBe("already_written");
    expect(fake.saveWorkoutSample).toHaveBeenCalledTimes(1);
  });
  it("deletes only records owned by this app", async () => {
    const { fake, bridge } = hkBridge();
    fake.queryWorkoutSamples.mockResolvedValueOnce([hkSample("ours", WORKOUTS_APP_ID), hkSample("theirs")] as never);
    await createHealthKitProvider(bridge, async () => {}).deleteOwned("session_1");
    expect(fake.deleteObjects).toHaveBeenCalledWith("HKWorkoutTypeIdentifier", { uuids: ["ours"] });
  });
  it("does not guess active time when paused intervals cannot be represented", async () => {
    const { fake, bridge } = hkBridge();
    const result = await createHealthKitProvider(bridge, async () => {}).exportActual({
      ...ACTUAL,
      active_seconds: 400,
    });
    expect(result.status).toBe("unsupported");
    expect(fake.saveWorkoutSample).not.toHaveBeenCalled();
  });
});

describe("minimal Health Connect adapter", () => {
  it("reports missing/update-required provider without initialization", async () => {
    const { fake, bridge } = hcBridge();
    fake.getSdkStatus.mockResolvedValueOnce(2);
    expect((await createHealthConnectProvider(bridge).availability()).status).toBe("update_required");
    expect(fake.initialize).not.toHaveBeenCalled();
  });
  it("requests only exercise scopes and handles partial permissions", async () => {
    const { fake, bridge } = hcBridge();
    fake.getGrantedPermissions.mockResolvedValue([{ accessType: "read", recordType: "ExerciseSession" }]);
    const provider = createHealthConnectProvider(bridge);
    const result = await provider.requestAccess({ read: true, write: false });
    expect(fake.requestPermission).toHaveBeenCalledWith([{ accessType: "read", recordType: "ExerciseSession" }]);
    expect(result.write).toBe("denied");
    await expect(provider.exportActual(ACTUAL)).rejects.toMatchObject({ code: "write_denied" });
  });
  it("gets a changes token before bootstrap, then paginates with a fixed window", async () => {
    const { fake, bridge } = hcBridge();
    fake.readRecords.mockResolvedValueOnce({ records: [hcRecord()], pageToken: "page-2" } as never);
    const provider = createHealthConnectProvider(bridge);
    const first = await provider.readPage(null, WINDOW);
    expect(first.has_more).toBe(true);
    expect(first.next_cursor.page_token).toBe("page-2");
    const second = await provider.readPage(first.next_cursor, { ...WINDOW, end: "2026-10-11T00:00:00.000Z" });
    expect(fake.getChanges).toHaveBeenCalledTimes(1);
    expect(fake.readRecords.mock.calls[1]).toEqual([
      "ExerciseSession",
      {
        timeRangeFilter: { operator: "between", startTime: WINDOW.start, endTime: WINDOW.end },
        pageSize: 100,
        ascendingOrder: true,
        pageToken: "page-2",
      },
    ]);
    expect(second.next_cursor.phase).toBe("changes");
  });
  it("handles delta deletion and unknown/restricted origin without route projections", async () => {
    const { fake, bridge } = hcBridge();
    fake.getChanges.mockResolvedValueOnce({
      upsertionChanges: [{ record: hcRecord("strava", "com.strava") }, { record: hcRecord("own", WORKOUTS_APP_ID) }],
      deletionChanges: [{ recordId: "old" }],
      nextChangesToken: "next",
      changesTokenExpired: false,
      hasMore: false,
    } as never);
    const page = await createHealthConnectProvider(bridge).readPage(
      {
        provider: "health_connect",
        window_start: WINDOW.start,
        window_end: WINDOW.end,
        phase: "changes",
        changes_token: "previous",
      },
      WINDOW
    );
    expect(page.observations).toHaveLength(1);
    expect(page.observations[0].ai_eligibility).toBe("restricted");
    expect(page.observations[0].duration_basis).toBe("elapsed_interval");
    expect(page.deleted_source_ids).toEqual(["health_connect:old"]);
    expect(page.next_cursor.changes_token).toBe("next");
  });
  it("expired tokens trigger a bounded snapshot reset with explicit incomplete deletion coverage", async () => {
    const { fake, bridge } = hcBridge();
    fake.getChanges.mockResolvedValueOnce({
      upsertionChanges: [],
      deletionChanges: [],
      nextChangesToken: "invalid",
      changesTokenExpired: true,
      hasMore: false,
    });
    const page = await createHealthConnectProvider(bridge).readPage(
      {
        provider: "health_connect",
        window_start: WINDOW.start,
        window_end: WINDOW.end,
        phase: "changes",
        changes_token: "expired",
      },
      WINDOW
    );
    expect(page.reset_required).toBe(true);
    expect(page.next_cursor.changes_token).toBe("changes-1");
    expect(page.coverage_notes.join(" ")).toContain("outside its coverage remain unknown");
  });
  it("writes idempotent client IDs and versions, no fabricated calories or routes", async () => {
    const { fake, bridge } = hcBridge();
    const provider = createHealthConnectProvider(bridge);
    await provider.exportActual(ACTUAL);
    await provider.exportActual(ACTUAL);
    expect(fake.insertRecords).toHaveBeenCalledTimes(2);
    const body = (fake.insertRecords.mock.calls[0] as unknown as [unknown[]])[0][0];
    expect(body).toEqual({
      recordType: "ExerciseSession",
      startTime: START,
      endTime: END,
      exerciseType: 56,
      title: "Håfa Workouts",
      metadata: { clientRecordId: `${SYNC_PREFIX}session_1`, clientRecordVersion: 1, recordingMethod: 3 },
    });
    await provider.deleteOwned("session_1");
    expect(fake.deleteRecordsByUuids).toHaveBeenCalledWith("ExerciseSession", [], [`${SYNC_PREFIX}session_1`]);
  });
});

describe("consent-scoped foreground synchronization", () => {
  it("uploads then checkpoints; repeated observations do not double count", async () => {
    const fixture = syncFixture();
    const result = await fixture.sync.refresh(WINDOW);
    expect(result.observations).toHaveLength(1);
    expect(fixture.deps.upload.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.deps.saveState.mock.invocationCallOrder[0]
    );
    expect(fixture.deps.saveState).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: PAGE.next_cursor, owner_scope: "owner-a" })
    );
    expect(reconcileObservations([OBSERVATION, OBSERVATION], [])).toHaveLength(1);
  });
  it("never checkpoints failed upload so the page can retry", async () => {
    const fixture = syncFixture();
    fixture.deps.upload.mockRejectedValueOnce(new Error("offline"));
    await expect(fixture.sync.refresh(WINDOW)).rejects.toThrow("offline");
    expect(fixture.deps.saveState).not.toHaveBeenCalled();
    await fixture.sync.refresh(WINDOW);
    expect(fixture.deps.upload).toHaveBeenCalledTimes(2);
  });
  it("does not read without separate upload consent", async () => {
    const fixture = syncFixture();
    fixture.setGrant({ ...GRANT, upload_to_server: false });
    await expect(fixture.sync.refresh(WINDOW)).rejects.toMatchObject({ code: "grant_changed" });
    expect(fixture.readPage).not.toHaveBeenCalled();
  });
  it("changes in account/generation/foreground stop upload and cursor advance", async () => {
    const fixture = syncFixture();
    fixture.readPage.mockImplementationOnce(async () => {
      fixture.setGrant({ ...GRANT, generation: 2 });
      return PAGE;
    });
    await expect(fixture.sync.refresh(WINDOW)).rejects.toMatchObject({ code: "grant_changed" });
    expect(fixture.deps.upload).not.toHaveBeenCalled();
    expect(fixture.deps.saveState).not.toHaveBeenCalled();
  });
  it("AI opt-in alone never blesses unknown upstream origin", async () => {
    const fixture = syncFixture();
    fixture.setGrant({ ...GRANT, use_for_ai: true });
    await fixture.sync.refresh(WINDOW);
    expect(
      (fixture.deps.upload.mock.calls[0] as unknown as [HealthPage, HealthGrant])[0].observations[0].ai_eligibility
    ).toBe("unknown");
  });
  it("disconnect stops reads locally even if server revocation fails", async () => {
    const fixture = syncFixture();
    fixture.deps.revoke.mockRejectedValueOnce(new Error("offline"));
    await expect(fixture.sync.disconnect()).rejects.toThrow("offline");
    await expect(fixture.sync.refresh(WINDOW)).rejects.toMatchObject({ code: "grant_changed" });
    expect(fixture.readPage).not.toHaveBeenCalled();
    expect(fixture.deps.saveState).toHaveBeenCalledWith(expect.objectContaining({ disconnected: true, cursor: null }));
  });
  it("persisted disconnect survives coordinator recreation", async () => {
    const fixture = syncFixture();
    fixture.setState({
      owner_scope: GRANT.owner_scope,
      generation: 1,
      provider: "apple_health",
      disconnected: true,
      cursor: null,
      last_sync_at: null,
    });
    await expect(fixture.sync.refresh(WINDOW)).rejects.toMatchObject({ code: "disconnected" });
    expect(fixture.readPage).not.toHaveBeenCalled();
  });
  it("disconnect cannot be overwritten by an older checkpoint awaiting storage", async () => {
    const fixture = syncFixture();
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    fixture.deps.saveState.mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const refresh = fixture.sync.refresh(WINDOW);
    await waiting;
    const disconnect = fixture.sync.disconnect();
    release();
    await expect(refresh).rejects.toMatchObject({ code: "grant_changed" });
    await disconnect;
    expect(fixture.deps.saveState.mock.calls.at(-1)?.[0].disconnected).toBe(true);
  });
  it("caps pagination without dropping the next checkpoint", async () => {
    const fixture = syncFixture();
    fixture.readPage.mockResolvedValue({ ...PAGE, has_more: true });
    expect((await fixture.sync.refresh(WINDOW, 2)).has_more).toBe(true);
    expect(fixture.readPage).toHaveBeenCalledTimes(2);
  });
  it("write-back requires separate write consent and the current owner", async () => {
    const fixture = syncFixture();
    await expect(fixture.sync.exportActual(ACTUAL, GRANT.owner_scope)).rejects.toMatchObject({
      code: "write_not_consented",
    });
    fixture.setGrant({ ...GRANT, write_actuals: true });
    await expect(fixture.sync.exportActual(ACTUAL, "different-owner")).rejects.toMatchObject({
      code: "write_not_consented",
    });
    expect((await fixture.sync.exportActual(ACTUAL, GRANT.owner_scope)).status).toBe("written");
  });
});

describe("projection and platform boundaries", () => {
  it("source duplicates retain provenance and overlap candidates, not an invented equivalent", () => {
    const second = { ...OBSERVATION, source_id: "apple_health:two", origin_id: "different" };
    expect(
      reconcileObservations([OBSERVATION, second, OBSERVATION], []).map((record) => record.possible_duplicate_of)
    ).toEqual([["apple_health:two"], ["apple_health:external-1"]]);
    expect(reconcileObservations([OBSERVATION], [OBSERVATION.source_id])).toEqual([]);
    expect(eligibility("com.strava.app")).toBe("restricted");
    expect(eligibility("com.apple.health")).toBe("unknown");
  });
  it("normalizes timezone offsets, rejects unbounded history or fabricated actuals", () => {
    expect(validateWindow({ start: "2026-10-01T10:00:00+10:00", end: "2026-10-02T10:00:00+10:00" }).start).toBe(START);
    expect(() => validateWindow({ start: "2025-01-01", end: "2026-01-01" })).toThrow();
    expect(() => validateActual({ ...ACTUAL, active_seconds: 0 })).toThrow();
  });
  it("web fallback never loads native packages or requests permission", async () => {
    const provider = await createNativeHealthProvider();
    expect((await provider.availability()).status).toBe("native_build_required");
    await expect(provider.requestAccess({ read: true, write: false })).rejects.toMatchObject({
      code: "native_build_required",
    });
  });
});

describe("native export and anchor integration regressions", () => {
  it("retains the original bounded cursor window across later Apple delta reads", async () => {
    const { bridge } = hkBridge();
    const provider = createHealthKitProvider(bridge, async () => {});
    const initial = { start: "2026-09-10T00:00:00.000Z", end: "2026-10-10T00:00:00.000Z" };
    const page = await provider.readPage(null, initial);
    const next = await provider.readPage(page.next_cursor, {
      start: "2026-09-11T00:00:00.000Z",
      end: "2026-10-11T00:00:00.000Z",
    });
    expect(next.next_cursor.window_start).toBe(initial.start);
    expect(next.next_cursor.window_end).toBe(initial.end);
    expect(() =>
      validateWindow({ start: next.next_cursor.window_start, end: next.next_cursor.window_end })
    ).not.toThrow();
  });
  it("rechecks owner and write consent after the asynchronous local-state read, before OS export", async () => {
    let grant = { ...GRANT, write_actuals: true };
    const exportActual = vi.fn(async () => ({
      status: "written" as const,
      canonical_session_id: "session_1",
      revision: 1,
    }));
    const provider = { platform: "apple_health", exportActual } as unknown as HealthProvider;
    const sync = createHealthSync(provider, {
      currentGrant: async () => grant,
      isForeground: () => true,
      loadState: async () => {
        grant = { ...grant, owner_scope: "owner-b", generation: 2 };
        return null;
      },
      saveState: async () => {},
      upload: async () => {},
      revoke: async () => {},
    });
    await expect(sync.exportActual(ACTUAL, "owner-a")).rejects.toMatchObject({ code: "write_grant_changed" });
    expect(exportActual).not.toHaveBeenCalled();
  });
});

describe("recorded pause timing", () => {
  const paused = {
    ...ACTUAL,
    active_seconds: 400,
    active_intervals: [
      { started_at: START, ended_at: "2026-10-01T00:02:00.000Z" },
      { started_at: "2026-10-01T00:05:20.000Z", ended_at: END },
    ],
  };
  it("validates exact boundaries and refuses overlaps or mismatched active duration", () => {
    expect(validateActual(paused)).toBeNull();
    expect(pausedIntervals(paused)).toEqual([
      { started_at: "2026-10-01T00:02:00.000Z", ended_at: "2026-10-01T00:05:20.000Z" },
    ]);
    expect(() => validateActual({ ...paused, active_seconds: 399 })).not.toThrow();
    expect(() => validateActual({ ...paused, active_seconds: 390 })).toThrow("match active time");
    expect(() =>
      validateActual({
        ...paused,
        active_intervals: [
          { started_at: START, ended_at: END },
          { started_at: START, ended_at: END },
        ],
      })
    ).toThrow("nonoverlapping");
  });
  it("exports one iOS workout through the builder bridge and retains sync lineage", async () => {
    const { fake, bridge } = hkBridge();
    const writer = { savePausedWorkout: vi.fn(async (_payload: string) => "paused-id") };
    const result = await createHealthKitProvider(bridge, async () => {}, writer).exportActual(paused);
    expect(result.source_id).toBe("apple_health:paused-id");
    expect(JSON.parse(writer.savePausedWorkout.mock.calls[0][0])).toMatchObject({
      canonical_session_id: "session_1",
      revision: 1,
      activity_type: 37,
      active_intervals: paused.active_intervals,
    });
    expect(fake.saveWorkoutSample).not.toHaveBeenCalled();
  });
  it("uses the native Android segment writer rather than the SDK's broken samples-to-laps mapper", async () => {
    const { fake, bridge } = hcBridge();
    const writer = { savePausedWorkout: vi.fn(async (_payload: string) => "paused-id") };
    expect((await createHealthConnectProvider(bridge, writer).exportActual(paused)).source_id).toBe(
      "health_connect:paused-id"
    );
    expect(fake.insertRecords).not.toHaveBeenCalled();
    expect(JSON.parse(writer.savePausedWorkout.mock.calls[0][0]).activity_type).toBe(56);
  });
  it("fails closed for a build without the pause module, even with known intervals", async () => {
    const { fake, bridge } = hcBridge();
    expect((await createHealthConnectProvider(bridge).exportActual(paused)).status).toBe("unsupported");
    expect(fake.insertRecords).not.toHaveBeenCalled();
  });
});
