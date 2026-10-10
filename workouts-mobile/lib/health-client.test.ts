import { describe, it, expect, vi } from "vitest";
import {
  createHealthClient,
  healthOwnerScope,
  syncParts,
  type HealthApi,
  type HealthConnection,
  type SyncBody,
} from "./health-client";
import type { HealthPage, HealthObservation, HealthProvider } from "./health/types";
const start = "2026-10-01T00:00:00.000Z",
  end = "2026-10-01T00:10:00.000Z";
const observation: HealthObservation = {
  provider: "health_connect",
  source_id: "health_connect:one",
  origin_id: "third-party",
  started_at: start,
  ended_at: end,
  duration_seconds: 600,
  duration_basis: "elapsed_interval",
  activity_type: "running",
  ai_eligibility: "unknown",
};
const page: HealthPage = {
  observations: [observation],
  deleted_source_ids: [],
  next_cursor: {
    provider: "health_connect",
    window_start: "2026-09-20T00:00:00.000Z",
    window_end: "2026-10-10T00:00:00.000Z",
    phase: "changes",
    changes_token: "token",
  },
  has_more: false,
  reset_required: false,
  coverage_notes: [],
};
function fixture() {
  const data = new Map<string, string>();
  const storage = {
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: async (k: string) => {
      data.delete(k);
    },
  };
  let connection: HealthConnection = {
    provider: "health_connect",
    generation: 2,
    revision: 3,
    connected: true,
    read_on_device: true,
    upload_to_server: true,
    use_for_ai: false,
    write_actuals: true,
    last_sync_at: null,
    cursor: null,
  };
  let current: string | null = healthOwnerScope("stable-owner", 2);
  let id = 0;
  const api = {
    healthConnection: vi.fn(async () => ({ ...connection })),
    saveHealthConnection: vi.fn(async (_provider, choices, revision, generation) => {
      if (revision !== connection.revision || generation !== connection.generation) throw Error("stale");
      connection = { ...connection, ...choices, revision: revision + 1 };
      return { ...connection };
    }),
    uploadHealth: vi.fn(async (_provider, body: SyncBody) => ({ receipt_id: body.receipt_id })),
    reconcileHealth: vi.fn(async () => ({})),
    prepareHealthExport: vi.fn(async (_provider, session) => ({
      status: "ready",
      intent_id: session,
      actual: {
        canonical_session_id: session,
        revision: 1,
        status: "partial",
        started_at: start,
        ended_at: end,
        active_seconds: 600,
        activity: "running",
      },
    })),
    acknowledgeHealthExport: vi.fn(async () => ({})),
  } as unknown as HealthApi;
  const provider = {
    platform: "health_connect",
    readPage: vi.fn(async () => page),
    exportActual: vi.fn(async (actual) => ({
      status: "written",
      source_id: `health_connect:${actual.canonical_session_id}`,
      canonical_session_id: actual.canonical_session_id,
      revision: 1,
    })),
  } as unknown as HealthProvider;
  const deps = {
    api,
    storage,
    owner: "stable-owner",
    enrollment_generation: 2,
    provider,
    provider_name: "health_connect" as const,
    currentOwnerScope: () => current,
    isForeground: () => true,
    uuid: () => `receipt-${++id}`,
  };
  return {
    data,
    api,
    provider,
    deps,
    client: createHealthClient(deps),
    setConnection: (patch: Partial<HealthConnection>) => {
      connection = { ...connection, ...patch };
    },
    setOwner: (value: string | null) => {
      current = value;
    },
  };
}
describe("durable private health transport", () => {
  it("bounds receipts by count and serialized bytes, with the cursor only on the final part", () => {
    const parts = syncParts(
      {
        ...page,
        observations: Array.from({ length: 250 }, (_, i) => ({
          ...observation,
          source_id: `id${i}`,
          possible_duplicate_of: Array(20).fill("x".repeat(250)),
        })),
      },
      3,
      () => "uuid"
    );
    expect(parts.length).toBeGreaterThan(2);
    expect(
      parts.every((p) => p.observations.length <= 200 && new TextEncoder().encode(JSON.stringify(p)).length < 128000)
    ).toBe(true);
    expect(parts.slice(0, -1).every((p) => p.next_cursor === null && p.has_more)).toBe(true);
    expect(parts.at(-1)?.next_cursor).toEqual(page.next_cursor);
  });
  it("replays the same receipt after upload loss and checkpoints only after complete reconciliation", async () => {
    const f = fixture();
    const upload = vi.mocked(f.api.uploadHealth);
    upload.mockRejectedValueOnce(Error("offline"));
    await expect(f.client.refresh()).rejects.toThrow("offline");
    expect([...f.data.entries()].find(([k]) => k.endsWith(":state"))).toBeUndefined();
    await f.client.refresh();
    expect(upload.mock.calls[0][1]).toEqual(upload.mock.calls[1][1]);
    expect(upload.mock.calls[0][2]).toBe(2);
    expect(upload.mock.calls[0][1].expected_revision).toBe(3);
    expect(f.api.reconcileHealth).toHaveBeenCalledWith(
      "health_connect",
      expect.objectContaining({ expected_revision: 3, receipt_ids: ["receipt-1"] }),
      2
    );
  });
  it("retries failed snapshot reconciliation with identical receipt coverage without rereading or losing it", async () => {
    const f = fixture();
    vi.mocked(f.api.reconcileHealth).mockRejectedValueOnce(Error("offline reconcile"));
    await expect(f.client.refresh()).rejects.toThrow("offline reconcile");
    expect([...f.data.keys()].some((k) => k.endsWith(":upload"))).toBe(true);
    await f.client.refresh();
    expect(vi.mocked(f.api.reconcileHealth).mock.calls[0][1]).toEqual(
      vi.mocked(f.api.reconcileHealth).mock.calls[1][1]
    );
    expect(vi.mocked(f.api.uploadHealth).mock.calls.filter((c) => c[1].receipt_id === "receipt-1")).toHaveLength(1);
  });
  it("does not replay pending uploads after the connection revision changes", async () => {
    const f = fixture();
    vi.mocked(f.api.uploadHealth).mockRejectedValueOnce(Error("offline"));
    await expect(f.client.refresh()).rejects.toThrow();
    f.setConnection({ revision: 4 });
    await expect(f.client.refresh()).rejects.toMatchObject({ code: "grant_changed" });
    expect(f.api.uploadHealth).toHaveBeenCalledTimes(1);
  });
  it("persists local disconnection even offline, and explicitly reconnects with fresh permissions", async () => {
    const f = fixture();
    vi.mocked(f.api.saveHealthConnection).mockRejectedValueOnce(Error("offline"));
    await expect(f.client.disconnect(3)).rejects.toThrow("offline");
    const reopened = createHealthClient(f.deps);
    expect(await reopened.isDisconnectedLocally()).toBe(true);
    await expect(reopened.refresh()).rejects.toThrow();
    expect(f.provider.readPage).not.toHaveBeenCalled();
    await reopened.retryDisconnect();
    await reopened.saveChoices(
      { connected: true, read_on_device: true, upload_to_server: true, use_for_ai: false, write_actuals: true },
      4
    );
    await reopened.refresh();
    expect(f.provider.readPage).toHaveBeenCalled();
  });
  it("a disconnection can be followed by an explicit reconnect on the same coordinator instance", async () => {
    const f = fixture();
    await f.client.disconnect(3);
    await f.client.saveChoices(
      { connected: true, read_on_device: true, upload_to_server: true, use_for_ai: false, write_actuals: false },
      4
    );
    await f.client.refresh();
    expect(f.provider.readPage).toHaveBeenCalled();
  });
  it("account changes after preparing an export stop the OS write", async () => {
    const f = fixture();
    vi.mocked(f.api.prepareHealthExport).mockImplementationOnce(async () => {
      f.setOwner(healthOwnerScope("other-owner", 2));
      return { status: "unsupported", intent_id: null, actual: null };
    });
    await expect(f.client.exportSession("one")).rejects.toMatchObject({ code: "owner_changed" });
    expect(f.provider.exportActual).not.toHaveBeenCalled();
  });
  it("retains original-revision write acknowledgments across retries and refuses to refence them", async () => {
    const f = fixture();
    vi.mocked(f.api.acknowledgeHealthExport).mockRejectedValueOnce(Error("offline ack"));
    await expect(f.client.exportSession("one")).rejects.toThrow("offline ack");
    const reopened = createHealthClient(f.deps);
    await reopened.retryAcknowledgment();
    expect(vi.mocked(f.api.acknowledgeHealthExport).mock.calls[1]).toEqual(
      vi.mocked(f.api.acknowledgeHealthExport).mock.calls[0]
    );
    vi.mocked(f.api.acknowledgeHealthExport).mockRejectedValueOnce(Error("offline ack"));
    await expect(reopened.exportSession("two")).rejects.toThrow();
    f.setConnection({ revision: 4 });
    await expect(reopened.retryAcknowledgment()).rejects.toMatchObject({ code: "grant_changed" });
    expect(f.api.acknowledgeHealthExport).toHaveBeenCalledTimes(3);
  });
});

it("queues an original-revision disconnection even when the first grant lookup is offline", async () => {
  const f = fixture();
  vi.mocked(f.api.healthConnection).mockRejectedValueOnce(Error("offline before grant"));
  await expect(f.client.disconnect(3)).rejects.toThrow("offline before grant");
  expect(await f.client.isDisconnectedLocally()).toBe(true);
  await createHealthClient(f.deps).retryDisconnect();
  expect(f.api.saveHealthConnection).toHaveBeenCalledWith(
    "health_connect",
    expect.objectContaining({ connected: false }),
    3,
    2
  );
});
