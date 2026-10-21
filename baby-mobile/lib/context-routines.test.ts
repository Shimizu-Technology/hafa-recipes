import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type RecordPage } from "./models";
const mock = vi.hoisted(() => ({
  api: {} as any,
  saved: null as DeviceState | null,
  state: null as DeviceState | null,
  user: "user",
  lease: 1,
  foreground: null as null | ((status: string) => void),
  reconcile: vi.fn(),
  clear: vi.fn(),
  clearShares: vi.fn(),
  signOut: vi.fn(),
  revoke: vi.fn(async () => undefined),
  cleanupOwner: null as string | null,
  readCleanup: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    currentState: "active",
    addEventListener: (_: string, fn: (s: string) => void) => {
      mock.foreground = fn;
      return { remove() {} };
    },
  },
}));
vi.mock("@clerk/expo", () => ({
  useAuth: () => ({ userId: mock.user, getToken: async () => "token" }),
  useClerk: () => ({ signOut: mock.signOut }),
}));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  getItemAsync: async (key: string) => key.endsWith(".cleanup") ? mock.readCleanup() : null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
vi.mock("@react-native-community/netinfo", () => ({ default: { addEventListener: () => () => {} } }));
vi.mock("./config", () => ({ configuration: { clerkEnvironment: "test", clerkKey: "test", apiBase: "test" } }));
vi.mock("./api", async (original) => ({ ...(await original<object>()), createBabyApi: () => mock.api }));
vi.mock("./vault", () => ({
  storageKey: () => "key",
  createVault: () => ({ write: async () => {}, read: async () => null, clear: async () => {}, retire() {} }),
}));
vi.mock("./device-vault", () => ({
  createDeviceVault: () => ({
    read: async () => mock.saved,
    write: async (s: DeviceState) => {
      mock.state = s;
    },
    clear: async () => {},
    retire() {},
  }),
}));
vi.mock("../modules/hafa-baby-share/src", () => ({ clearPendingShares: () => mock.clearShares() }));
vi.mock("./files", () => ({ clearFiles: async () => {}, removeLocal: async () => {}, uploadFile: vi.fn() }));
vi.mock("./reminders", () => ({
  clearReminders: (...args: unknown[]) => mock.clear(...args),
  reconcileReminders: (...args: unknown[]) => mock.reconcile(...args),
}));
vi.mock("./share-session-state", () => ({ revokeShareSession: mock.revoke }));
import { BabyProvider, useBaby } from "./context";
import { ApiError } from "./api";
let baby!: ReturnType<typeof useBaby>, renderer: ReactTestRenderer | undefined;
function Probe() {
  baby = useBaby();
  return null;
}
it("retries initial records loading quietly before starting routine sync", async () => {
  mock.api.records.mockRejectedValueOnce(new ApiError("Temporary service failure", 503));
  await mount();
  expect(baby.error).toBe("");
  await act(async () => { await vi.advanceTimersByTimeAsync(300); await settle(); });
  expect(baby.error).toBe(""); expect(baby.state.bootstrap).toEqual(bootstrap);
  expect(mock.api.records.mock.calls.filter(([filters]: any[]) => !filters.kind)).toHaveLength(2);
});
function row(id: string, enabled = true, revision = 1): BabyRecord {
  return {
    ...optimisticRecord({
      id,
      kind: "routine",
      title: id,
      body: "",
      child_id: null,
      occurred_at: "2026-10-20T00:00:00Z",
      data: { enabled, reminder_at: "2027-01-01T10:00:00Z" },
    }),
    revision,
  };
}
const bootstrap = {
  generation: 1,
  children: [],
  ai_available: false,
  profile: { display_name: "", timezone: "UTC", ai_consent: false },
};
const page = (items: BabyRecord[], total = items.length, has_more = false): RecordPage => ({ items, total, has_more });
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
async function mount() {
  await act(async () => {
    renderer = create(React.createElement(BabyProvider, null, React.createElement(Probe)));
    await settle();
  });
}
function held() {
  let resolve!: (v: RecordPage) => void;
  const promise = new Promise<RecordPage>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.saved = null;
  mock.state = null;
  mock.user = "user";
  mock.lease = 1;
  mock.reconcile.mockReset().mockResolvedValue(undefined);
  mock.clear.mockReset().mockResolvedValue(undefined);
  mock.clearShares.mockReset();
  mock.signOut.mockReset().mockResolvedValue(undefined);
  mock.revoke.mockClear();
  mock.cleanupOwner = null;
  mock.readCleanup.mockReset().mockImplementation(async () => mock.cleanupOwner);
  mock.api = {
    identity: vi.fn(async () => ({ id: "owner" })),
    bootstrap: vi.fn(async () => bootstrap),
    records: vi.fn(async () => page([])),
    lease: () => mock.lease,
    assertLease: (lease: number) => {
      if (lease !== mock.lease) throw Error("old lease");
    },
    save: vi.fn(async (r: BabyRecord) => ({ ...r, revision: r.revision + 1 })),
    remove: vi.fn(async () => {}),
    erase: vi.fn(async () => {
      mock.lease++;
    }),
  };
});
afterEach(async () => {
  if (renderer)
    await act(async () => {
      renderer!.unmount();
    });
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("provider routine restore integration", () => {
  it("retries failed live sign-out cleanup without reopening the Baby space", async () => {
    await mount();
    const bootstrapCalls = mock.api.bootstrap.mock.calls.length;
    mock.clearShares.mockImplementationOnce(() => { throw Error("native cleanup unavailable"); });
    await act(async () => { await expect(baby.signOut()).rejects.toThrow("native cleanup unavailable"); });
    expect(baby.ready).toBe(false);
    expect(mock.signOut).not.toHaveBeenCalled();
    await act(async () => { await baby.refresh(); });
    expect(mock.signOut, baby.error).toHaveBeenCalledOnce();
    expect(mock.api.bootstrap).toHaveBeenCalledTimes(bootstrapCalls);
    expect(baby.ready).toBe(false);
    expect(baby.state.bootstrap).toBeUndefined();
  });
  it("does not reopen or write from a held bootstrap after sign-out cleanup fails", async () => {
    await mount();
    let resolve!: (value: typeof bootstrap) => void;
    mock.api.bootstrap.mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
    let syncing!: Promise<void>;
    await act(async () => { syncing = baby.sync(); await settle(); });
    const previous = mock.state;
    mock.clearShares.mockImplementationOnce(() => { throw Error("native cleanup unavailable"); });
    await act(async () => { await expect(baby.signOut()).rejects.toThrow("native cleanup unavailable"); });
    await act(async () => { resolve(bootstrap); await syncing; });
    expect(baby.ready).toBe(false);
    expect(mock.state).toBe(previous);
    expect(mock.signOut).not.toHaveBeenCalled();
  });
  it("does not clear global native captures when a retired initializer finishes reading its cleanup marker", async () => {
    let resolve!: (owner: string) => void;
    mock.readCleanup.mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
    await mount();
    await act(async () => { renderer!.unmount(); });
    await act(async () => { resolve("previous-owner"); await settle(); });
    expect(mock.clearShares).not.toHaveBeenCalled();
    expect(mock.signOut).not.toHaveBeenCalled();
  });
  it("clears native pending captures when erasing Baby without deleting the shared account", async () => {
    await mount();
    mock.clearShares.mockClear();
    mock.api.bootstrap.mockResolvedValue({ ...bootstrap, generation: 2, active: false });
    await act(async () => { await baby.erase(); });
    expect(mock.clearShares).toHaveBeenCalled();
    expect(mock.signOut).not.toHaveBeenCalled();
    expect(baby.state.bootstrap).toMatchObject({ generation: 2, active: false });
  });
  it("keeps a new generation closed until pending-share cleanup succeeds on retry", async () => {
    await mount();
    mock.api.bootstrap.mockResolvedValue({ ...bootstrap, generation: 2 });
    mock.clearShares.mockImplementationOnce(() => { throw Error("native cleanup unavailable"); });
    await act(async () => { await baby.refresh(); });
    expect(baby.ready).toBe(false);
    expect(baby.state.bootstrap?.generation).toBe(1);
    await act(async () => { await baby.refresh(); });
    expect(baby.ready).toBe(true);
    expect(baby.state.bootstrap?.generation).toBe(2);
  });
  it("offers closed-space cleanup recovery after remote erasure already succeeded", async () => {
    await mount();
    mock.api.bootstrap.mockResolvedValue({ ...bootstrap, generation: 2, active: false });
    mock.clearShares.mockImplementationOnce(() => { throw Error("native cleanup unavailable"); });
    await act(async () => { await expect(baby.erase()).rejects.toThrow(); });
    expect(baby.ready).toBe(false);
    expect(baby.error).toContain("cleanup");
    await act(async () => { await baby.refresh(); });
    expect(baby.ready).toBe(true);
    expect(baby.state.bootstrap).toMatchObject({ generation: 2, active: false });
  });
  it("retires captures on an inactive cold restore even with the same saved generation", async () => {
    const inactive = { ...bootstrap, generation: 2, active: false };
    mock.saved = { ...emptyState(), bootstrap: inactive };
    mock.api.bootstrap.mockResolvedValue(inactive);
    await mount();
    expect(mock.clearShares).toHaveBeenCalled();
    expect(baby.ready).toBe(true);
  });
  it("retries native share cleanup before completing interrupted sign-out recovery", async () => {
    mock.cleanupOwner = "owner";
    mock.clearShares.mockImplementationOnce(() => { throw Error("native cleanup unavailable"); });
    await mount();
    expect(mock.signOut).not.toHaveBeenCalled();
    expect(baby.ready).toBe(false);
    await act(async () => { await baby.refresh(); });
    expect(mock.clearShares).toHaveBeenCalledTimes(2);
    expect(mock.signOut).toHaveBeenCalledOnce();
  });
  it("clears a removed child's saved filter on cold restoration without discarding retained records", async () => {
    const record = { ...row("retained"), kind: "journal" as const };
    mock.saved = { ...emptyState(), bootstrap, selectedChild: "removed-child", records: [record] };
    await mount();
    expect(baby.state.selectedChild).toBeNull();
    expect(mock.state?.selectedChild).toBeNull();
    expect(baby.records).toContainEqual(record);
  });
  it("preserves a valid child filter and clears it after an authoritative child removal", async () => {
    const child = { id: "child", name: "Child", birth_date: null, due_date: null, revision: 1 };
    const withChild = { ...bootstrap, children: [child] };
    mock.saved = { ...emptyState(), bootstrap: withChild, selectedChild: child.id };
    mock.api.bootstrap.mockResolvedValue(withChild);
    await mount();
    expect(baby.state.selectedChild).toBe(child.id);
    mock.api.bootstrap.mockResolvedValue(bootstrap);
    await act(async () => { await baby.refresh(); });
    expect(baby.state.selectedChild).toBeNull();
    expect(mock.state?.selectedChild).toBeNull();
  });
  it("restores an old routine on first open and refreshes remote edits/disables/deletes periodically and on foreground", async () => {
    let remote = [row("old-behind-history")];
    const mixed = Array.from({ length: 100 }, (_, i) => ({ ...row("source" + i), kind: "source" as const }));
    mock.api.records.mockImplementation(async (filters: any) => page(filters.kind === "routine" ? remote : mixed));
    await mount();
    expect(baby.records.some((r) => r.id === "old-behind-history")).toBe(true);
    expect(baby.state.routine_sync).toMatchObject({ complete: true, owner: "owner", generation: 1 });
    remote = [{ ...row("old-behind-history", false, 2), title: "edited remotely" }];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
      await settle();
    });
    expect(baby.records.find((r) => r.id === "old-behind-history")).toMatchObject({
      title: "edited remotely",
      data: { enabled: false },
    });
    remote = [];
    await act(async () => {
      mock.foreground!("active");
      await settle();
    });
    expect(baby.records.some((r) => r.kind === "routine")).toBe(false);
  });
  it("preserves the full previous snapshot after a later-page failure", async () => {
    mock.saved = {
      ...emptyState(),
      bootstrap,
      records: [row("keep")],
      routine_sync: { owner: "owner", generation: 1, complete: true, managed_ids: [] },
    };
    mock.api.records.mockImplementation(async (f: any) => {
      if (!f.kind) return page([]);
      if (!f.offset) return page([row("partial")], 2, true);
      throw Error("offline");
    });
    await mount();
    expect(baby.records.map((r) => r.id)).toEqual(["keep"]);
    expect(baby.state.routine_sync?.complete).toBe(true);
  });
  it("discards a held snapshot after an accepted local write, and retries successfully next sync", async () => {
    await mount();
    const delayed = held();
    let first = true;
    mock.api.records.mockImplementation(async (filters: any) => {
      if (!filters.kind) return page([]);
      if (first) {
        first = false;
        return delayed.promise;
      }
      return page([row("local", false, 2)]);
    });
    let reading!: Promise<void>;
    await act(async () => {
      reading = baby.refresh();
      await settle();
    });
    await act(async () => {
      await baby.queue({ id: "edit", type: "save", generation: 1, record: row("local", false), files: [] });
      await settle();
    });
    // The real outbox save is acknowledged while an independent refresh is held.
    expect(mock.api.save).toHaveBeenCalledTimes(1);
    expect(baby.state.outbox).toEqual([]);
    expect(baby.records.find((r) => r.id === "local")?.revision).toBe(2);
    await act(async () => {
      delayed.resolve(page([row("stale", true)]));
      await reading;
      await settle();
    });
    expect(baby.records.map((r) => r.id)).toEqual(["local"]);
    await act(async () => {
      await baby.sync();
    });
    expect(baby.records.map((r) => r.id)).toEqual(["local"]);
    expect(baby.state.routine_sync?.complete).toBe(true);
  });
  it("still restores remote routines when an unrelated attachment release fails", async () => {
    mock.api.records.mockImplementation(async (filters: any) => page(filters.kind ? [row("removed-remotely")] : []));
    await mount();
    await act(async () => {
      await baby.commit((s) => ({ ...s, fileReleases: ["retry-release"] }));
    });
    mock.api.releaseAttachment = vi.fn(async () => {
      throw Error("offline upload cleanup");
    });
    mock.api.records.mockResolvedValue(page([]));
    await act(async () => {
      await baby.sync();
    });
    expect(baby.records.some((r) => r.kind === "routine")).toBe(false);
    expect(baby.state.fileReleases).toEqual(["retry-release"]);
  });
  it("does not repopulate a deleted Baby generation from a held routine page", async () => {
    await mount();
    const delayed = held();
    mock.api.records.mockReturnValueOnce(delayed.promise);
    let reading!: Promise<void>;
    await act(async () => {
      reading = baby.sync();
      await settle();
    });
    mock.api.bootstrap.mockResolvedValue({ ...bootstrap, generation: 2, active: false });
    await act(async () => {
      await baby.erase();
    });
    await act(async () => {
      delayed.resolve(page([row("erased")]));
      await reading;
    });
    expect(baby.records).toEqual([]);
    expect(baby.state.routine_sync).toBeUndefined();
  });
  it("does not install a held account response after unmount", async () => {
    await mount();
    const delayed = held();
    mock.api.records.mockReturnValueOnce(delayed.promise);
    let reading!: Promise<void>;
    await act(async () => {
      reading = baby.sync();
      await settle();
      renderer!.unmount();
    });
    const previous = mock.state;
    delayed.resolve(page([row("previous-owner")]));
    await reading;
    expect(mock.state).toBe(previous);
  });
});


it("waits for a conflicted original save before admitting its automatic import", async () => {
  const profile = { ...bootstrap.profile, ai_consent: true, auto_process_shares: true };
  mock.api.bootstrap.mockResolvedValue({ ...bootstrap, profile });
  const source = { ...row("shared-source"), kind: "source" as const, data: { status: "saved" } };
  mock.saved = { ...emptyState(), bootstrap: { ...bootstrap, profile }, outbox: [
    { id: "save-original", generation: 1, type: "save", record: source, files: [], error: "Try again", conflict: true },
    { id: "automatic-import", generation: 1, type: "import", record_id: source.id, files: [], automatic: true },
  ] };
  mock.api.import = vi.fn(async () => ({ id: "automatic-import", record_id: source.id, status: "queued" }));
  await mount();
  expect(mock.api.import).not.toHaveBeenCalled();
  expect(baby.state.outbox).toHaveLength(2);
  await act(async () => { await baby.commit(s => ({ ...s, outbox: s.outbox.map(m => ({ ...m, error: undefined, conflict: false })) })); });
  await act(async () => { await baby.sync(); });
  expect(mock.api.save).toHaveBeenCalledOnce();
  expect(mock.api.import).toHaveBeenCalledOnce();
  expect(mock.api.save.mock.invocationCallOrder[0]).toBeLessThan(mock.api.import.mock.invocationCallOrder[0]);
  expect(mock.api.import.mock.calls[0][0]).toMatchObject({ id: "automatic-import", record_id: source.id, automatic: true });
});
it("drops withdrawn automatic work but keeps the original and explicit manual work", async () => {
  mock.saved = { ...emptyState(), bootstrap, outbox: [
    { id: "automatic-import", generation: 1, type: "import", record_id: "original", files: [], automatic: true },
    { id: "manual-import", generation: 1, type: "import", record_id: "manual", files: [], error: "retry manually" },
  ] };
  mock.api.import = vi.fn();
  await mount();
  expect(mock.api.import).not.toHaveBeenCalled();
  expect(baby.state.outbox.map(m => m.id)).toEqual(["manual-import"]);
});
it("revokes native authority before signing out or erasing server data", async () => {
  await mount();
  await act(async () => { await baby.erase(); });
  expect(mock.revoke.mock.invocationCallOrder[0]).toBeLessThan(mock.api.erase.mock.invocationCallOrder[0]);
  mock.revoke.mockClear();
  await act(async () => { await baby.signOut(); });
  expect(mock.revoke.mock.invocationCallOrder[0]).toBeLessThan(mock.signOut.mock.invocationCallOrder[0]);
});

it("does not revive an offline automatic import after remote permission off and on", async () => {
  mock.saved = { ...emptyState(), bootstrap, outbox: [
    { id: "old-automatic", generation: 1, type: "import", record_id: "original", files: [], automatic: true, automatic_epoch: 0 },
  ] };
  mock.api.bootstrap.mockResolvedValue({ ...bootstrap, profile: { ...bootstrap.profile,
    ai_consent: true, auto_process_shares: true, auto_process_epoch: 1 } });
  mock.api.import = vi.fn();
  await mount();
  expect(mock.api.import).not.toHaveBeenCalled();
  expect(baby.state.outbox).toHaveLength(0);
});

it("continues original and journal saves when automatic imports hit a quota", async () => {
  const { ApiError } = await import("./api");
  const profile = { ...bootstrap.profile, ai_consent: true, auto_process_shares: true, auto_process_epoch: 1 };
  mock.api.bootstrap.mockResolvedValue({ ...bootstrap, profile });
  const source = (id: string) => ({ ...row(id), kind: "source" as const, data: { status: "saved" } });
  mock.saved = { ...emptyState(), bootstrap: { ...bootstrap, profile }, outbox: [
    { id: "save-A", generation: 1, type: "save", record: source("A"), files: [] },
    { id: "import-A", generation: 1, type: "import", record_id: "A", files: [], automatic: true, automatic_epoch: 1 },
    { id: "save-B", generation: 1, type: "save", record: source("B"), files: [] },
    { id: "import-B", generation: 1, type: "import", record_id: "B", files: [], automatic: true, automatic_epoch: 1 },
    { id: "journal-save", generation: 1, type: "save", record: { ...row("journal"), kind: "journal" }, files: [] },
  ] };
  mock.api.import = vi.fn().mockRejectedValue(new ApiError("Daily allowance reached", 429));
  await mount();
  expect(mock.api.import).toHaveBeenCalledOnce();
  expect(mock.api.save.mock.calls.map(([record]: [BabyRecord]) => record.id)).toEqual(["A", "B", "journal"]);
  expect(baby.state.outbox.map(m => m.id)).toEqual(["import-A", "import-B"]);
});
it("refreshes persisted native progress and its source when processing finishes", async () => {
  mock.saved = { ...emptyState(), bootstrap, imports: [{ id: "capture", record_id: "source", status: "queued" }] };
  mock.api.job = vi.fn(async () => ({ id: "capture", record_id: "source", status: "ready" }));
  mock.api.record = vi.fn(async () => ({ ...row("source"), kind: "source", data: { status: "ready", summary: "Extracted takeaway" } }));
  await mount();
  expect(baby.state.imports[0].status).toBe("ready");
  expect(baby.records.find(r => r.id === "source")?.data.summary).toBe("Extracted takeaway");
});
it("retains terminal polling until the updated source is safely persisted", async () => {
  const { ApiError } = await import("./api");
  const original = { ...row("source"), kind: "source" as const, data: { status: "queued" } };
  mock.saved = { ...emptyState(), bootstrap, records: [original],
    imports: [{ id: "capture", record_id: "source", status: "queued" }] };
  mock.api.job = vi.fn(async () => ({ id: "capture", record_id: "source", status: "ready" }));
  mock.api.record = vi.fn().mockRejectedValueOnce(new ApiError("Temporary failure", 503))
    .mockResolvedValue({ ...original, revision: 3, data: { status: "ready", summary: "Useful result" } });
  await mount();
  expect(baby.state.imports[0].status).toBe("queued");
  expect(baby.records.find(r => r.id === "source")?.data.summary).toBeUndefined();
  await act(async () => { await baby.sync(); });
  expect(baby.state.imports[0].status).toBe("ready");
  expect(baby.records.find(r => r.id === "source")?.data.summary).toBe("Useful result");
});
