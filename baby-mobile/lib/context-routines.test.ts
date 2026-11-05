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
  failWrites: false,
  alert: vi.fn(),
  pushEnsure: vi.fn(async () => true),
  pushEnd: vi.fn(async () => undefined),
}));
vi.mock("react-native", () => ({
  Alert: { alert: (...args: unknown[]) => mock.alert(...args) },
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
      if (mock.failWrites) throw Error("Device storage unavailable");
      mock.state = s;
    },
    clear: async () => {},
    retire() {},
  }),
}));
vi.mock("../modules/hafa-baby-share/src", () => ({ clearPendingShares: () => mock.clearShares() }));
vi.mock("./files", () => ({ clearFiles: vi.fn(async () => {}), removeLocal: async () => {}, uploadFile: vi.fn() }));
vi.mock("./reminders", () => ({
  clearReminders: (...args: unknown[]) => mock.clear(...args),
  reconcileReminders: (...args: unknown[]) => mock.reconcile(...args),
}));
vi.mock("./share-session-state", () => ({ revokeShareSession: mock.revoke }));
vi.mock("./push-native", () => ({ nativePushDevice: () => ({ ensure: mock.pushEnsure, end: mock.pushEnd }) }));
import { BabyProvider, useBaby } from "./context";
import { ApiError, MovedError } from "./api";
import { notSentMessage } from "./outbox";
import { unavailableMessage } from "./spaces";
import { uploadFile } from "./files";
import { runningFeed } from "./feed-reducer";
import { switchFeed } from "./running-feed";
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
it("opening with no connection reads as offline, not as a sync problem", async () => {
  const offline = () => new ApiError("Could not connect. You’re offline.", 0);
  mock.api.bootstrap = vi.fn(async () => { throw offline(); });
  mock.saved = { ...emptyState(), bootstrap } as unknown as DeviceState;
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); await settle(); });
  expect(baby.error).toContain("Could not connect");
  expect(baby.unreachable).toBe(true);
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
describe("changing every later date of a repeat", () => {
  const series = { ...optimisticRecord({ id: "class", kind: "event", title: "Class", body: "", child_id: null, occurred_at: "2026-11-02T00:00:00.000Z", data: { timezone: "Pacific/Guam", recurrence: { frequency: "weekly" } } }), revision: 4 },
    ended = { ...series, data: { ...series.data, recurrence: { frequency: "weekly", until: "2026-11-15" } } },
    next = { id: "next", kind: "event" as const, title: "New class", body: "", child_id: null, occurred_at: "2026-11-16T00:00:00.000Z", data: series.data },
    split = { id: "next", generation: 1, type: "event_split" as const, series: { id: "class", kind: "event" as const, title: "Class", body: "", child_id: null, occurred_at: series.occurred_at, data: ended.data, revision: 4 }, event: next, from_start: "2026-11-16T00:00:00.000Z", files: [] },
    answer = { series: { ...ended, revision: 5 }, event: { ...optimisticRecord(next), revision: 1 } },
    flush = () => act(async () => { await settle(); await vi.advanceTimersByTimeAsync(0); await settle(); }),
    rows = () => baby.records.filter((row) => row.kind === "event").map((row) => [row.id, row.data.recurrence?.until ?? null]);
  beforeEach(() => {
    mock.api = { bootstrap: vi.fn(async () => bootstrap), identity: vi.fn(async () => ({ id: "owner" })), records: vi.fn(async () => page([])), lease: () => mock.lease, assertLease: () => undefined,
      save: vi.fn(async () => { throw Error("Each part must not be saved alone"); }), splitEvent: vi.fn(async () => answer) };
    mock.saved = { ...emptyState(), bootstrap, records: [series], outbox: [split] } as unknown as DeviceState;
  });
  it("sends one request holding both parts", async () => {
    await mount(); await flush();
    expect(mock.api.save).not.toHaveBeenCalled();
    expect(mock.api.splitEvent).toHaveBeenCalledExactlyOnceWith("class", { revision: 4, from_start: "2026-11-16T00:00:00.000Z", event: next }, 1);
    expect(baby.state.outbox).toEqual([]);
    expect(baby.state.records.find((row) => row.id === "class")).toMatchObject({ revision: 5 });
    expect(baby.state.records.find((row) => row.id === "next")).toMatchObject({ revision: 1, title: "New class" });
  });
  it("keeps both on the phone while there's no signal, and sends the same thing later", async () => {
    mock.api.splitEvent = vi.fn().mockRejectedValueOnce(new ApiError("Offline", 0)).mockResolvedValue(answer);
    await mount(); await flush();
    expect(baby.state.outbox.map((m) => m.id)).toEqual(["next"]);
    expect((baby.state.outbox[0] as any).error).toBeUndefined();
    expect(rows()).toEqual(expect.arrayContaining([["class", "2026-11-15"], ["next", null]]));
    await act(async () => { await baby.sync(); await settle(); });
    expect(mock.api.splitEvent.mock.calls[1]).toEqual(mock.api.splitEvent.mock.calls[0]);
    expect(baby.state.outbox).toEqual([]);
  });
  it("tries again by itself after a server error", async () => {
    mock.api.splitEvent = vi.fn().mockRejectedValueOnce(new ApiError("Busy", 503)).mockResolvedValue(answer);
    await mount(); await flush();
    expect(baby.state.outbox[0]).toMatchObject({ attempts: 1 });
    expect((baby.state.outbox[0] as any).error).toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); await settle(); });
    await flush();
    expect(baby.state.outbox).toEqual([]);
  });
  it.each([[422, "You can keep up to 200 repeating events"], [409, "Changed"]])("loses nothing when it's refused with a %s, and discarding brings every date back", async (status, words) => {
    mock.api.splitEvent = vi.fn(async () => { throw new ApiError(words, status); });
    await mount(); await flush();
    expect(baby.state.outbox[0]).toMatchObject({ id: "next", conflict: status === 409 });
    expect((baby.state.outbox[0] as any).error).toBeTruthy();
    expect(mock.api.save).not.toHaveBeenCalled();
    expect(baby.state.records.find((row) => row.id === "class")!.data.recurrence!.until).toBeUndefined();
    await act(async () => { await baby.discardQueued("next"); await settle(); });
    expect(baby.state.outbox).toEqual([]);
    expect(rows()).toEqual([["class", null]]);
  });
  it("forgets a split that landed and was removed since, without stopping the queue", async () => {
    mock.api.splitEvent = vi.fn(async () => { throw new ApiError("Removed", 410); });
    await mount(); await flush();
    expect(baby.state.outbox).toEqual([]);
  });
  it("takes the answer when the old series has gone since", async () => {
    mock.api.splitEvent = vi.fn(async () => ({ ...answer, series: null }));
    await mount(); await flush();
    expect(baby.state.outbox).toEqual([]);
    expect(baby.state.records.map((row) => row.id)).toEqual(["next"]);
  });
});
describe("from the review of #543: when the queue meets a failure", () => {
  const dose = { ...optimisticRecord({ id: "dose", kind: "medicine", title: "Tylenol", body: "", child_id: "baby", occurred_at: "2026-11-04T02:00:00.000Z", data: {} }), revision: 1 },
    undo = { id: "undo", generation: 1, type: "delete" as const, record: dose },
    flush = () => act(async () => { await settle(); await vi.advanceTimersByTimeAsync(0); await settle(); }),
    base = () => ({ bootstrap: vi.fn(async () => bootstrap), identity: vi.fn(async () => ({ id: "owner" })), records: vi.fn(async () => page([])), lease: () => mock.lease, assertLease: () => undefined });
  it("15: tries an Undo again after a server error, and doesn't ask her about it", async () => {
    let calls = 0;
    mock.api = { ...base(), remove: vi.fn(async () => { if (!calls++) throw new ApiError("Down", 503); }) };
    mock.saved = { ...emptyState(), bootstrap, records: [dose], outbox: [undo] } as unknown as DeviceState;
    await mount(); await flush();
    expect(mock.api.remove).toHaveBeenCalledTimes(1);
    expect(baby.state.outbox[0]).toMatchObject({ id: "undo", attempts: 1 });
    expect((baby.state.outbox[0] as any).error).toBeUndefined();
    expect(baby.state.outbox[0]).toHaveProperty("hold_until");
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); await settle(); });
    await act(async () => { await baby.sync(); await settle(); });
    expect(mock.api.remove).toHaveBeenCalledTimes(2);
    expect(baby.state.outbox).toEqual([]);
  });
  it("16: lets go of a replayed save whose entry was removed elsewhere, and later doses still go", async () => {
    const write = (id: string) => ({ id: `m-${id}`, generation: 1, type: "save" as const, files: [], record: { id, kind: "medicine" as const, title: id, body: "", child_id: "baby", occurred_at: "2026-11-04T02:00:00.000Z", data: {} } });
    mock.api = { ...base(), save: vi.fn(async (value: any) => { if (value.id === "gone") throw new ApiError("Removed", 410); return { ...optimisticRecord(value), revision: 1 }; }) };
    mock.saved = { ...emptyState(), bootstrap, records: [], outbox: [write("gone"), write("next")] } as unknown as DeviceState;
    await mount(); await flush();
    expect(baby.state.outbox).toEqual([]);
    expect(baby.state.records.map((row) => row.id)).toEqual(["next"]);
  });
  it("16: still stops at a 410 for a save with a file, where the upload may be what expired", async () => {
    const file = { id: "f", uri: "file://x", name: "x", mime_type: "image/png", uploaded_id: "up" };
    const write = { id: "m", generation: 1, type: "save" as const, files: [file], record: { id: "p", kind: "journal" as const, title: "p", body: "", child_id: null, occurred_at: "2026-11-04T02:00:00.000Z", data: {} } };
    mock.api = { ...base(), save: vi.fn(async () => { throw new ApiError("Upload expired", 410); }) };
    mock.saved = { ...emptyState(), bootstrap, records: [], outbox: [write] } as unknown as DeviceState;
    await mount(); await flush();
    expect(baby.state.outbox.map((m) => m.id)).toEqual(["m"]);
  });
});
describe("a What shows switch with no signal", () => {
  const child = { id: "baby", name: "Mia", revision: 3, birth_date: "2026-11-01", details: { sex: "girl", tracking: { kicks: true } } },
    server = { ...bootstrap, children: [child] },
    off = { id: "off", generation: 1, type: "child_tracking" as const, child_id: "baby", tracking: { diaper: false }, previous: { diaper: null } };
  beforeEach(() => {
    mock.api = { bootstrap: vi.fn(async () => server), identity: vi.fn(async () => ({ id: "owner" })), records: vi.fn(async () => page([])), lease: () => mock.lease, assertLease: () => undefined,
      child: vi.fn(async (value: any) => ({ ...child, revision: value.revision + 1, details: { ...child.details, tracking: { ...child.details.tracking, ...value.details.tracking } } })) };
    mock.saved = { ...emptyState(), bootstrap: server, outbox: [off] } as unknown as DeviceState;
  });
  const flush = () => act(async () => { await settle(); await vi.advanceTimersByTimeAsync(0); await settle(); });
  const shown = () => baby.state.bootstrap!.children[0];
  it("sends only that switch, at the revision the API has", async () => {
    await mount(); await flush();
    expect(mock.api.child).toHaveBeenCalledExactlyOnceWith({ id: "baby", details: { tracking: { diaper: false } }, revision: 3 }, 1);
    expect(baby.state.outbox).toEqual([]);
    expect(shown().details!.tracking).toEqual({ kicks: true, diaper: false });
  });
  it("keeps it through a refresh while the request fails", async () => {
    mock.api.child = vi.fn(async () => { throw new ApiError("Offline", 0); });
    await mount(); await flush();
    await act(async () => { await baby.refresh(); await settle(); });
    expect(shown().details!.tracking).toEqual({ kicks: true, diaper: false });
    expect(baby.state.outbox.map((m) => m.id)).toEqual(["off"]);
  });
  it("sends it again at the new revision after a conflict", async () => {
    let onServer: any = { ...child };
    mock.api.bootstrap = vi.fn(async () => ({ ...server, children: [onServer] }));
    mock.api.child = vi.fn().mockRejectedValueOnce(new ApiError("Changed", 409)).mockImplementation(async (value: any) => (onServer = { ...onServer, revision: value.revision + 1, details: { tracking: { ...onServer.details.tracking, ...value.details.tracking } } }));
    await mount(); await flush();
    expect(baby.state.outbox).toEqual([expect.objectContaining({ id: "off", attempts: 1 })]);
    onServer = { ...child, name: "Mia Rose", revision: 7 };
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); await settle(); });
    await flush();
    expect(mock.api.child).toHaveBeenLastCalledWith({ id: "baby", details: { tracking: { diaper: false } }, revision: 7 }, 1);
    expect(baby.state.outbox).toEqual([]);
    expect(shown()).toMatchObject({ name: "Mia Rose", revision: 8 });
  });
  it("is done without a write when the API already has it", async () => {
    mock.api.bootstrap = vi.fn(async () => ({ ...server, children: [{ ...child, details: { tracking: { diaper: false } } }] }));
    await mount(); await flush();
    expect(mock.api.child).not.toHaveBeenCalled();
    expect(baby.state.outbox).toEqual([]);
  });
  it("an offline switch preserves another phone's different switch", async () => {
    mock.api.bootstrap = vi.fn(async () => ({ ...server, children: [{ ...child, revision: 7, details: { sex: "girl", tracking: { kicks: true, bottle: false } } }] }));
    mock.api.child = vi.fn(async (v: any) => ({ ...child, revision: v.revision + 1, details: { sex: "girl", tracking: { kicks: true, bottle: false, ...v.details.tracking } } }));
    await mount(); await flush();
    expect(shown().details!.tracking).toMatchObject({ diaper: false, bottle: false, kicks: true });
    expect(mock.api.child.mock.calls[0][0]).toMatchObject({ revision: 7, details: { tracking: { diaper: false } } });
  });
  it("says so when the baby's profile has gone", async () => {
    mock.api.bootstrap = vi.fn(async () => ({ ...server, children: [] }));
    await mount(); await flush();
    expect(mock.api.child).not.toHaveBeenCalled();
    expect(baby.state.outbox).toEqual([expect.objectContaining({ id: "off", error: expect.stringContaining("removed") })]);
  });
});
describe("Baby's here with no signal", () => {
  const child = { id: "baby", name: "Mia", revision: 3, due_date: "2026-12-10", birth_date: null },
    server = { ...bootstrap, children: [child] },
    born = { id: "born", generation: 1, type: "child_birth" as const, child_id: "baby", birth_date: "2026-11-05", previous: null };
  beforeEach(() => {
    mock.api = { bootstrap: vi.fn(async () => server), identity: vi.fn(async () => ({ id: "owner" })), records: vi.fn(async () => page([])), lease: () => mock.lease, assertLease: () => undefined,
      child: vi.fn(async (value: any) => ({ ...child, ...value, revision: value.revision + 1 })) };
    mock.saved = { ...emptyState(), bootstrap: server, outbox: [born] } as DeviceState;
  });
  const flush = () => act(async () => { await settle(); await vi.advanceTimersByTimeAsync(0); await settle(); });
  const shown = () => baby.state.bootstrap!.children[0];
  it("sends only the date at the revision the API has, and care stays on throughout", async () => {
    await mount(); await flush();
    expect(mock.api.child).toHaveBeenCalledExactlyOnceWith({ id: "baby", birth_date: "2026-11-05", revision: 3 }, 1);
    expect(baby.state.outbox).toEqual([]);
    expect(shown()).toMatchObject({ birth_date: "2026-11-05", due_date: "2026-12-10", revision: 4 });
  });
  it("keeps the date through every bootstrap refresh while the request fails", async () => {
    mock.api.child = vi.fn(async () => { throw new ApiError("Offline", 0); });
    await mount(); await flush();
    expect(shown().birth_date).toBe("2026-11-05");
    await act(async () => { await baby.refresh(); await settle(); });
    expect(shown().birth_date).toBe("2026-11-05");
    expect(baby.state.outbox.map((m) => m.id)).toEqual(["born"]);
  });
  it("sends it again at the new revision after a conflict, never losing the date", async () => {
    let onServer = { ...child };
    mock.api.bootstrap = vi.fn(async () => ({ ...server, children: [onServer] }));
    mock.api.child = vi.fn().mockRejectedValueOnce(new ApiError("Changed", 409)).mockImplementation(async (value: any) => (onServer = { ...onServer, ...value, revision: value.revision + 1 }));
    await mount(); await flush();
    expect(baby.state.outbox).toEqual([expect.objectContaining({ id: "born", attempts: 1 })]);
    expect(shown().birth_date).toBe("2026-11-05");
    onServer = { ...child, due_date: "2026-12-11", revision: 7 };
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); await settle(); });
    await flush();
    expect(mock.api.child).toHaveBeenLastCalledWith({ id: "baby", birth_date: "2026-11-05", revision: 7 }, 1);
    expect(baby.state.outbox).toEqual([]);
    expect(shown()).toMatchObject({ birth_date: "2026-11-05", due_date: "2026-12-11", revision: 8 });
  });
  it("is done without a write when the lost request already landed", async () => {
    mock.api.bootstrap = vi.fn(async () => ({ ...server, children: [{ ...child, birth_date: "2026-11-05", revision: 4 }] }));
    await mount(); await flush();
    expect(mock.api.child).not.toHaveBeenCalled();
    expect(baby.state.outbox).toEqual([]);
    expect(shown()).toMatchObject({ birth_date: "2026-11-05", revision: 4 });
  });
  it("doesn't overwrite a different date saved elsewhere; it asks", async () => {
    mock.api.bootstrap = vi.fn(async () => ({ ...server, children: [{ ...child, birth_date: "2026-11-04", revision: 4 }] }));
    await mount(); await flush();
    expect(mock.api.child).not.toHaveBeenCalled();
    expect(baby.state.outbox[0]).toMatchObject({ id: "born" });
    expect((baby.state.outbox[0] as any).error).toContain("different birth date");
  });
  it("retries after a server error rather than asking her", async () => {
    mock.api.child = vi.fn().mockRejectedValueOnce(new ApiError("Busy", 503)).mockImplementation(async (value: any) => ({ ...child, ...value, revision: value.revision + 1 }));
    await mount(); await flush();
    expect(baby.state.outbox[0]).toMatchObject({ attempts: 1 });
    expect((baby.state.outbox[0] as any).error).toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); await settle(); });
    await flush();
    expect(baby.state.outbox).toEqual([]);
  });
  it("puts back what it saw when an unsent change is discarded", async () => {
    mock.api.child = vi.fn(async () => { throw new ApiError("Offline", 0); });
    await mount(); await flush();
    await act(async () => { await baby.discardQueued("born"); await settle(); });
    expect(baby.state.outbox).toEqual([]);
    expect(shown().birth_date).toBeNull();
  });
  it("restores what the API says when a sent change is discarded", async () => {
    const landed = { ...child, birth_date: "2026-11-05", revision: 4 };
    mock.api.bootstrap = vi.fn(async () => ({ ...server, children: [landed] }));
    mock.saved = { ...mock.saved!, outbox: [{ ...born, sent: true, error: "Review" }] };
    await mount(); await flush();
    await act(async () => { await baby.discardQueued("born", undefined, landed); await settle(); });
    expect(baby.state.outbox).toEqual([]);
    expect(shown()).toMatchObject({ birth_date: "2026-11-05", revision: 4 });
  });
});
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
  mock.pushEnsure.mockClear();
  mock.pushEnd.mockClear();
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
describe("feed actions in the sync loop", () => {
  const start = { id: "s", action: "start" as const, at: "2026-11-04T12:00:00.000Z", side: "left" as const },
    write = { id: "feed", kind: "feeding" as const, title: "Feeding", body: "", child_id: null, occurred_at: start.at, data: { method: "breast" as const, side: "left" as const, state: "running" as const, actions: [start] } },
    create = { id: "create", generation: 1, type: "save" as const, record: write, files: [] },
    action = (id: string, hold?: string) => ({ id, generation: 1, type: "feed_action" as const, record_id: "feed", ...(hold ? { hold_until: hold } : {}),
      action: { id, action: "finish" as const, at: "2026-11-04T12:09:00.000Z" } });
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-11-04T12:10:00.000Z"));
    mock.api.save = vi.fn(async (r: any) => ({ ...optimisticRecord(r), revision: 1 }));
    mock.api.feedAction = vi.fn(async (_id: string, value: any) => ({ ...optimisticRecord(write), revision: 2, data: { ...write.data, state: "finished", actions: [start, value] } }));
    mock.saved = { ...emptyState(), bootstrap } as DeviceState;
  });
  const queued = () => baby.state.outbox.map((m) => m.id);
  const flush = () => act(async () => { await settle(); await vi.advanceTimersByTimeAsync(0); await settle(); });

  it("sends the record's create first, then its action, and the action only after its create landed", async () => {
    mock.saved = { ...mock.saved!, outbox: [create, action("end")] };
    await mount(); await flush();
    expect(mock.api.save).toHaveBeenCalledOnce();
    expect(mock.api.feedAction.mock.invocationCallOrder[0]).toBeGreaterThan(mock.api.save.mock.invocationCallOrder[0]);
    expect(mock.api.feedAction).toHaveBeenCalledWith("feed", action("end").action, 1);
    expect(queued()).toEqual([]);
    expect(baby.state.records.find((r) => r.id === "feed")?.data.state).toBe("finished");
  });
  it("holds an action back if its create is rejected, and does not send it", async () => {
    mock.api.save = vi.fn(async () => { throw new ApiError("Review", 422); });
    mock.saved = { ...mock.saved!, outbox: [create, action("end")] };
    await mount(); await flush();
    expect(mock.api.feedAction).not.toHaveBeenCalled();
    expect(queued()).toEqual(["create", "end"]);
  });
  it("keeps an action on this phone through its Undo window, and sends it straight after without waiting for the 15-second pass", async () => {
    mock.saved = { ...mock.saved!, outbox: [action("end", "2026-11-04T12:10:06.500Z")] };
    await mount(); await flush();
    expect(mock.api.feedAction).not.toHaveBeenCalled();
    expect(queued()).toEqual(["end"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(6400); await settle(); });
    expect(mock.api.feedAction).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); await settle(); });
    expect(mock.api.feedAction).toHaveBeenCalledOnce();
    await flush();
    expect(queued()).toEqual([]);
  });
  it("retries after a dropped connection with the same action id, so it applies once", async () => {
    mock.api.feedAction.mockRejectedValueOnce(new ApiError("Offline", 0));
    mock.saved = { ...mock.saved!, outbox: [action("end")] };
    await mount(); await flush();
    expect(queued()).toEqual(["end"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); await settle(); });
    expect(mock.api.feedAction.mock.calls.map((call: any[]) => call[1].id)).toEqual(["end", "end"]);
    await flush();
    expect(queued()).toEqual([]);
  });
  const gone = () => { throw new ApiError("Gone", 404); };
  const timed = (over: object = {}) => ({ ...optimisticRecord(write), revision: 2, ...over });
  const plain = (over: object = {}) => ({ ...optimisticRecord({ ...write, data: { method: "breast" as const, side: "left" as const, state: "finished" as const } }), revision: 3, ...over });
  it("reads the record before dropping a tap, drops it only once it's known gone, and says so", async () => {
    mock.api.feedAction.mockRejectedValueOnce(new ApiError("Gone", 404));
    mock.api.record = vi.fn(async () => gone());
    mock.saved = { ...mock.saved!, records: [timed()], outbox: [action("end")] };
    await mount(); await flush();
    expect(mock.api.record).toHaveBeenCalledWith("feed");
    expect(queued()).toEqual([]);
    expect(baby.state.records).toEqual([]);
    expect(baby.state.feedNotices?.[0]).toContain("removed");
  });
  it("drops a tap on a feed made plain by hand, keeps that record, and says so", async () => {
    mock.api.feedAction.mockRejectedValueOnce(new ApiError("Edited", 409));
    mock.api.record = vi.fn(async () => plain());
    mock.saved = { ...mock.saved!, outbox: [action("end")] };
    await mount(); await flush();
    expect(queued()).toEqual([]);
    expect(baby.state.records.find((r) => r.id === "feed")?.revision).toBe(3);
    expect(baby.state.feedNotices?.[0]).toContain("changed");
  });
  it("consumes a tap the API already has, with nothing to tell her", async () => {
    mock.api.feedAction.mockRejectedValueOnce(new ApiError("Used", 409));
    mock.api.record = vi.fn(async () => timed({ data: { ...write.data, actions: [start, action("end").action] } }));
    mock.saved = { ...mock.saved!, outbox: [action("end")] };
    await mount(); await flush();
    expect(queued()).toEqual([]);
    expect(baby.state.feedNotices).toBeUndefined();
  });
  it("keeps a tap when the record can't be read, or the feed still takes taps, and asks her only if it never clears", async () => {
    mock.api.feedAction.mockRejectedValue(new ApiError("Edited", 409));
    mock.api.record = vi.fn(async () => { throw new ApiError("Service", 503); });
    mock.saved = { ...mock.saved!, outbox: [action("end")] };
    await mount(); await flush();
    expect(queued()).toEqual(["end"]);
    expect(baby.state.outbox[0]).toMatchObject({ attempts: 1 });
    expect(baby.state.outbox[0].error).toBeUndefined();
    mock.api.record = vi.fn(async () => timed());
    for (let i = 0; i < 6; i++) await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); await settle(); });
    expect(queued()).toEqual(["end"]);
    expect(baby.state.outbox[0].error).toContain("couldn’t be added");
    expect(baby.state.feedNotices).toBeUndefined();
  });
  it("keeps both notices when two taps fail, so one can't hide the other", async () => {
    mock.api.feedAction.mockRejectedValue(new ApiError("Gone", 404));
    mock.api.record = vi.fn(async () => gone());
    const plainTap = { ...action("second"), record_id: "other" };
    mock.saved = { ...mock.saved!, outbox: [action("end"), plainTap] };
    mock.api.record.mockImplementation(async (id: string) => { if (id === "feed") return gone(); return plain({ id: "other" }); });
    await mount(); await flush();
    expect(baby.state.feedNotices).toEqual(["This feed was removed.", "This feed was changed, and the saved one stands."]);
  });
  it("sends a stale edit at its own revision when a lost tap is replayed, so the API refuses it and nothing is overwritten", async () => {
    const answered = timed({ revision: 6, body: "From the other phone", data: { ...write.data, state: "finished", actions: [start, { ...action("end").action, revision: 5 }] } });
    mock.api.feedAction = vi.fn(async () => answered);
    mock.api.save = vi.fn(async () => { throw new ApiError("Changed", 409); });
    const stale = { id: "edit", generation: 1, type: "save" as const, files: [], record: { ...optimisticRecord(write), revision: 5, body: "Mine" } };
    mock.saved = { ...mock.saved!, records: [{ ...optimisticRecord(write), revision: 5 }], outbox: [action("end"), stale] };
    await mount(); await flush();
    expect(mock.api.save.mock.calls[0][0]).toMatchObject({ id: "feed", revision: 5, body: "Mine" });
    expect(baby.state.outbox[0]).toMatchObject({ id: "edit", conflict: true });
    expect(baby.state.records.find((r) => r.id === "feed")?.body).toBe("From the other phone");
  });
  it("moves a waiting edit by exactly the revision the tap made", async () => {
    mock.api.feedAction = vi.fn(async () => timed({ revision: 5, data: { ...write.data, state: "finished", actions: [start, { ...action("end").action, revision: 5 }] } }));
    mock.api.save = vi.fn(async (r: any) => ({ ...optimisticRecord(r), revision: 6 }));
    const waiting = { id: "edit", generation: 1, type: "save" as const, files: [], record: { ...optimisticRecord(write), revision: 4, body: "Mine" } };
    mock.saved = { ...mock.saved!, outbox: [action("end"), waiting] };
    await mount(); await flush();
    expect(mock.api.save.mock.calls[0][0]).toMatchObject({ revision: 5, body: "Mine" });
    expect(queued()).toEqual([]);
  });
  describe("when a queued change before another is discarded", () => {
    const running = (over: object = {}) => timed({ revision: 1, data: { ...write.data, state: "running", side: "left", actions: [start] }, ...over });
    const swap = { id: "swap", generation: 1, type: "feed_action" as const, record_id: "feed", action: { id: "swap", action: "switch" as const, at: "2026-11-04T12:05:00.000Z", side: "right" as const } };
    /** A note saved on the copy she sees, as the editor and quick log build it. */
    const noted = async (body: string, id = "note") => {
      const shown = baby.records.find((r) => r.id === "feed")!;
      await act(async () => { await baby.queue({ id, generation: 1, type: "save", files: [], record: { ...shown, body } }); await settle(); });
    };
    const offline = () => {
      mock.api.feedAction = vi.fn(async () => { throw new ApiError("Offline", 0); });
      mock.saved = { ...mock.saved!, records: [running()], outbox: [] };
    };
    const saved = (over: object = {}) => mock.api.save = vi.fn(async (r: any) => ({ ...optimisticRecord(r), revision: r.revision + 1, ...over }));
    const held = { ...swap, hold_until: "2030-01-01T00:00:00.000Z" };
    it("Switch, a note, then discard the Switch: both go, the row is as last synced and still running, and nothing is sent", async () => {
      offline(); saved();
      await mount(); await flush();
      await act(async () => { await baby.queue(held); await settle(); });
      expect(baby.records.find((r) => r.id === "feed")?.data.side).toBe("both");
      await noted("Sleepy today");
      await act(async () => { await baby.discardQueued("swap"); await settle(); });
      await flush();
      expect(queued()).toEqual([]);
      expect(baby.records.find((r) => r.id === "feed")).toEqual(running());
      expect(mock.api.save).not.toHaveBeenCalled();
      expect(mock.api.feedAction).not.toHaveBeenCalled();
    });
    it("sends a draft built on that Switch without anything that could finish the feed", async () => {
      offline(); saved();
      await mount(); await flush();
      await act(async () => { await baby.queue(held); await settle(); });
      const shown = baby.records.find((r) => r.id === "feed")!;
      await act(async () => { await baby.discardQueued("swap"); await settle(); });
      await act(async () => { await baby.queue({ id: "draft", generation: 1, type: "save", files: [], base: { after: [] }, record: { ...shown, body: "Typed on the old copy" } }); await settle(); });
      await flush();
      const sent = mock.api.save.mock.calls[0][0];
      expect(sent).toMatchObject({ revision: 1, body: "Typed on the old copy" });
      for (const key of ["actions", "state", "side", "duration_minutes", "end_at"]) expect(sent.data).not.toHaveProperty(key);
    });
    it("sends a side she changed by hand, since that is the correction", async () => {
      offline(); saved();
      await mount(); await flush();
      await act(async () => { await baby.queue({ id: "fix", generation: 1, type: "save", files: [], record: { ...running(), data: { ...running().data, side: "right" } } }); await settle(); });
      await flush();
      expect(mock.api.save.mock.calls[0][0].data.side).toBe("right");
    });
    it("leaves an earlier save to sync, and doesn't send what followed the one discarded", async () => {
      offline(); mock.api.save = vi.fn(async () => { throw new ApiError("Offline", 0); });
      await mount(); await flush();
      await noted("A", "a");
      await noted("A then B", "b");
      await noted("A then B then C", "c");
      saved();
      await act(async () => { await baby.discardQueued("b"); await settle(); });
      await flush();
      expect(mock.api.save.mock.calls.map(([r]: any[]) => r.body)).toEqual(["A"]);
      expect(queued()).toEqual([]);
    });
    it("removes the whole chain behind a conflict when she keeps the version she reviewed", async () => {
      const reviewed = running({ revision: 4, title: "From the other phone" });
      mock.api.save = vi.fn(async () => { throw new ApiError("Changed", 409); });
      mock.saved = { ...mock.saved!, records: [running()], outbox: [] };
      await mount(); await flush();
      await noted("Mine, first", "first");
      await flush();
      expect(baby.state.outbox[0]).toMatchObject({ id: "first", conflict: true });
      await noted("Mine, second", "second");
      await act(async () => { await baby.discardQueued("first", reviewed); await settle(); });
      await flush();
      expect(queued()).toEqual([]);
      expect(baby.records.find((r) => r.id === "feed")).toEqual(reviewed);
    });
    it("remembers what a landed tap made, for an editor opened before it landed", async () => {
      mock.api.feedAction = vi.fn(async () => timed({ revision: 2, data: { ...write.data, side: "both", actions: [start, { ...swap.action, revision: 2 }] } }));
      mock.saved = { ...mock.saved!, records: [running()], outbox: [swap] };
      await mount(); await flush();
      expect(baby.state.settled?.swap).toEqual({ made: 2 });
    });
    it("Undo of a tap with nothing after it asks nothing", async () => {
      offline(); saved(); mock.alert.mockClear();
      await mount(); await flush();
      let undo = async () => {};
      await act(async () => { undo = await switchFeed(baby, runningFeed(baby.records, null)!); await settle(); });
      await act(async () => { await undo(); await settle(); });
      expect(mock.alert).not.toHaveBeenCalled();
      expect(queued()).toEqual([]);
    });
    it("Undo of a tap says what else goes, and removes the chain once she agrees", async () => {
      offline(); saved(); mock.alert.mockReset();
      mock.alert.mockImplementation((_t: string, _m: string, buttons: { text: string; onPress: () => void }[]) => buttons.find((b) => b.text === "Undo")!.onPress());
      await mount(); await flush();
      let undo = async () => {};
      await act(async () => { undo = await switchFeed(baby, runningFeed(baby.records, null)!); await settle(); });
      await noted("Sleepy today");
      await act(async () => { await undo(); await settle(); });
      expect(mock.alert.mock.calls[0][1]).toBe("This also removes 1 later change to this entry.");
      expect(queued()).toEqual([]);
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); await settle(); });
      expect(mock.api.save).not.toHaveBeenCalled();
      expect(mock.api.feedAction).not.toHaveBeenCalled();
    });
    it("Undo leaves everything in place when she decides to keep it, and doesn't count as a switch back", async () => {
      offline(); saved(); mock.alert.mockReset();
      mock.alert.mockImplementation((_t: string, _m: string, buttons: { text: string; onPress: () => void }[]) => buttons.find((b) => b.text === "Keep it")!.onPress());
      await mount(); await flush();
      let undo = async () => {};
      await act(async () => { undo = await switchFeed(baby, runningFeed(baby.records, null)!); await settle(); });
      await noted("Sleepy today");
      const before = queued();
      await act(async () => { await expect(undo()).rejects.toThrow("Nothing was undone."); await settle(); });
      expect(queued()).toEqual(before);
    });
    it("commits as one write: a failed write leaves the chain whole, and a relaunch finds it whole or gone, never half", async () => {
      offline(); saved();
      await mount(); await flush();
      await act(async () => { await baby.queue(held); await settle(); });
      await noted("Sleepy today");
      const whole = mock.state!, writes: DeviceState[] = [];
      expect(whole.outbox.map((m) => m.id)).toEqual(["swap", "note"]);
      mock.failWrites = true;
      await act(async () => { await baby.discardQueued("swap").catch(() => undefined); await settle(); });
      mock.failWrites = false;
      expect(queued()).toEqual(["swap", "note"]);
      expect(mock.state).toBe(whole);
      expect(mock.api.save).not.toHaveBeenCalled();
      await act(async () => { await baby.discardQueued("swap"); await settle(); });
      writes.push(mock.state!);
      await act(async () => renderer?.unmount()); renderer = undefined;
      mock.saved = writes[0];
      await mount(); await flush();
      expect(queued()).toEqual([]);
      expect(baby.records.find((r) => r.id === "feed")).toEqual(running());
      expect(mock.api.save).not.toHaveBeenCalled();
    });
    it("loads a queue from an earlier test build with the longer form of base, and it still syncs", async () => {
      saved();
      const old = { id: "old", generation: 1, type: "save" as const, files: [], record: { ...write, body: "Kept", revision: 1 },
        base: { record: { title: "Feeding", body: "", child_id: null, occurred_at: start.at, data: {} }, after: [], files: [] } };
      mock.saved = { ...mock.saved!, records: [running()], outbox: [old], settled: { gone: { files: ["x"] }, landed: { made: 2 } } } as never;
      await mount(); await flush();
      expect(mock.api.save.mock.calls[0][0]).toMatchObject({ body: "Kept", revision: 1 });
      expect(mock.api.save.mock.calls[0][0]).not.toHaveProperty("base");
      expect(queued()).toEqual([]);
    });
    it("loads a queue from build 32 with no base or outcomes, and it still syncs", async () => {
      saved();
      const old = { id: "old", generation: 1, type: "save" as const, files: [], record: { ...write, body: "Kept", revision: 1 } };
      mock.saved = { ...mock.saved!, records: [running()], outbox: [old] };
      await mount(); await flush();
      expect(mock.api.save.mock.calls[0][0]).toMatchObject({ body: "Kept", revision: 1 });
      expect(queued()).toEqual([]);
    });
    it.each([
      ["journal", { kind: "journal", title: "Journal entry", data: {} }],
      ["question", { kind: "question", title: "Ask the midwife", data: {} }],
      ["saved post", { kind: "source", title: "A saved post", data: { url: "https://example.com/post", source_text: "A tip" } }],
      ["routine", { kind: "routine", title: "Vitamins", data: { enabled: false, cadence: "daily" } }],
    ])("takes an ordinary %s through conflict review: kept, reviewed, discarded with what followed", async (_name, shape: any) => {
      const row = { ...optimisticRecord({ id: "plain", body: "Saved", child_id: null, occurred_at: start.at, ...shape }), revision: 1 };
      const reviewed = { ...row, revision: 3, body: "From the other phone" };
      const edit = (id: string, body: string) => ({ id, generation: 1, type: "save" as const, files: [], record: { ...row, body } });
      mock.api.save = vi.fn(async () => { throw new ApiError("Changed", 409); });
      mock.saved = { ...mock.saved!, records: [row], outbox: [] };
      // Routines come back from a full read after each sync, so the API has to hold them too.
      mock.api.records = vi.fn(async () => (page(shape.kind === "routine" ? [reviewed] : [])));
      await mount(); await flush();
      await act(async () => { await baby.queue(edit("first", "Mine")); await settle(); });
      await flush();
      expect(baby.state.outbox[0]).toMatchObject({ id: "first", conflict: true });
      await act(async () => { await baby.queue(edit("second", "Mine again")); await settle(); });
      expect(queued()).toEqual(["first", "second"]);
      const calls = mock.api.save.mock.calls.length;
      await flush();
      expect(mock.api.save.mock.calls.length).toBe(calls);
      await act(async () => { await baby.discardQueued("first", reviewed); await settle(); });
      await flush();
      expect(queued()).toEqual([]);
      expect(baby.state.records.find((r) => r.id === "plain")).toEqual(reviewed);
      expect(mock.api.save.mock.calls.length).toBe(calls);
    });
    it.each(["journal", "question", "source", "routine"])("lets a reviewed %s save go at the version she reviewed", async (kind) => {
      const row = { ...optimisticRecord({ id: "plain", kind: kind as never, title: "Mine", body: "Saved", child_id: null, occurred_at: start.at, data: {} }), revision: 1 };
      mock.api.save = vi.fn(async (r: any) => { if (r.revision !== 3) throw new ApiError("Changed", 409); return { ...optimisticRecord(r), revision: 4 }; });
      mock.saved = { ...mock.saved!, records: [row], outbox: [] };
      mock.api.records = vi.fn(async () => (page(kind === "routine" ? [{ ...row, body: "Mine", revision: 4 }] : [])));
      await mount(); await flush();
      await act(async () => { await baby.queue({ id: "first", generation: 1, type: "save", files: [], record: { ...row, body: "Mine" } }); await settle(); });
      await flush();
      expect(baby.state.outbox[0]).toMatchObject({ id: "first", conflict: true });
      await act(async () => { await baby.commit((s) => ({ ...s, outbox: s.outbox.map((m: any) => ({ ...m, conflict: false, error: undefined, record: { ...m.record, revision: 3 } })) })); await baby.sync(); await settle(); });
      await flush();
      expect(queued()).toEqual([]);
      expect(baby.state.records.find((r) => r.id === "plain")).toMatchObject({ body: "Mine", revision: 4 });
    });
  });
  it("sends a session's tap by its own id, keeps it through a lost answer, and says so if the entry is gone", async () => {
    const tap = { id: "tap", generation: 1, type: "session_action" as const, record_id: "kicks", action: { id: "tap", action: "tap" as const, at: "2026-11-04T12:10:00.000Z" } };
    mock.api.sessionAction = vi.fn().mockRejectedValueOnce(new ApiError("Offline", 0)).mockImplementation(async (_id: string, value: any) => ({
      ...optimisticRecord({ id: "kicks", kind: "kick_session", title: "Kick count", body: "", child_id: null, occurred_at: value.at, data: { count: 2, session_actions: [value] } }), revision: 2 }));
    mock.saved = { ...mock.saved!, outbox: [tap] };
    await mount(); await flush();
    expect(queued()).toEqual(["tap"]);
    expect(baby.state.outbox[0]).toMatchObject({ sent: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); await settle(); });
    expect(mock.api.sessionAction.mock.calls.map((call: any[]) => call[1].id)).toEqual(["tap", "tap"]);
    await flush();
    expect(queued()).toEqual([]);
    expect(baby.state.records.find((r) => r.id === "kicks")?.data.count).toBe(2);
    mock.api.sessionAction = vi.fn(async () => { throw new ApiError("Gone", 404); });
    mock.api.record = vi.fn(async () => gone());
    await act(async () => { await baby.queue({ ...tap, id: "late", action: { ...tap.action, id: "late" } }); await settle(); });
    await flush();
    expect(baby.state.feedNotices?.[0]).toContain("entry was removed");
  });
  it("reads the record before discarding a sent tap, so a finished feed doesn't come back as running", async () => {
    mock.saved = { ...mock.saved!, records: [timed()], outbox: [{ ...action("end"), sent: true, error: "Needs review" }] };
    await mount(); await flush();
    const finished = timed({ revision: 3, data: { ...write.data, state: "finished", end_at: "2026-11-04T12:09:00.000Z" } });
    await act(async () => { await baby.discardQueued("end", finished); await settle(); });
    expect(queued()).toEqual([]);
    expect(baby.records.find((r) => r.id === "feed")?.data.state).toBe("finished");
  });
  it("forgets the row when the read says the record is gone", async () => {
    mock.saved = { ...mock.saved!, records: [timed()], outbox: [{ ...action("end"), sent: true, error: "Needs review" }] };
    await mount(); await flush();
    await act(async () => { await baby.discardQueued("end", null); await settle(); });
    expect(baby.records.find((r) => r.id === "feed")).toBeUndefined();
  });
  it("tells her when a switch landed after the feed had already finished", async () => {
    const late = { id: "swap", generation: 1, type: "feed_action" as const, record_id: "feed", action: { id: "swap", action: "switch" as const, at: "2026-11-04T12:09:30.000Z", side: "right" as const } };
    mock.api.feedAction = vi.fn(async () => timed({ revision: 3, data: { ...write.data, state: "finished", end_at: "2026-11-04T12:09:00.000Z" } }));
    mock.saved = { ...mock.saved!, outbox: [late] };
    await mount(); await flush();
    expect(baby.state.feedNotices?.[0]).toContain("already finished");
  });
  it.each([408, 429, 500, 503])("waits and retries the same tap after a %i, and later changes follow", async (status) => {
    mock.api.feedAction.mockRejectedValueOnce(new ApiError("Busy", status));
    const later = { id: "note", generation: 1, type: "save" as const, files: [], record: { ...write, body: "note", revision: 1 } };
    mock.api.save = vi.fn(async (r: any) => ({ ...optimisticRecord(r), revision: r.revision + 1 }));
    mock.saved = { ...mock.saved!, outbox: [action("end"), later] };
    await mount(); await flush();
    expect(baby.state.outbox[0]).toMatchObject({ id: "end", attempts: 1, sent: true });
    expect(baby.state.outbox[0].error).toBeUndefined();
    expect(mock.api.save).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); await settle(); });
    expect(mock.api.feedAction.mock.calls.map((call: any[]) => call[1].id)).toEqual(["end", "end"]);
    expect(queued()).toEqual([]);
    expect(mock.api.save).toHaveBeenCalledOnce();
  });
  it("keeps a contraction queued while the API's flag is off, and sends it when it answers", async () => {
    const write2 = { id: "c", kind: "contraction" as const, title: "Contraction", body: "", child_id: null, occurred_at: start.at, data: {} };
    mock.api.save = vi.fn(async (r: any) => ({ ...optimisticRecord(r), revision: 1 }));
    mock.api.save.mockRejectedValueOnce(new ApiError("This can't be saved yet", 503));
    mock.saved = { ...mock.saved!, outbox: [{ id: "c-save", generation: 1, type: "save" as const, record: write2, files: [] }] };
    await mount(); await flush();
    expect(baby.state.outbox[0]).toMatchObject({ id: "c-save", attempts: 1 });
    expect(baby.state.outbox[0].error).toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); await settle(); });
    expect(queued()).toEqual([]);
  });
  it("still asks for review on an ordinary save the API rejects with a 500", async () => {
    mock.api.save = vi.fn(async () => { throw new ApiError("Failed", 500); });
    mock.saved = { ...mock.saved!, outbox: [create] };
    await mount(); await flush();
    expect(baby.state.outbox[0].error).toBe("Failed");
  });
  it("sends a waiting edit at its own revision when someone else wrote first, so the API can stop it", async () => {
    // The tap lands at revision 3 on a record this phone knew at 1: another phone wrote revision 2.
    mock.api.feedAction = vi.fn(async () => timed({ revision: 3 }));
    const edit = { id: "note", generation: 1, type: "save" as const, files: [], record: { ...write, body: "mine", revision: 1 } };
    mock.api.save = vi.fn(async (r: any) => { if (r.revision !== 3) throw new ApiError("Changed", 409); return { ...optimisticRecord(r), revision: 4 }; });
    mock.saved = { ...mock.saved!, outbox: [action("end"), edit] };
    await mount(); await flush();
    expect(mock.api.save).toHaveBeenCalledWith(expect.objectContaining({ body: "mine", revision: 1 }), 1);
    expect(baby.state.outbox[0]).toMatchObject({ id: "note", conflict: true });
  });
  it("marks a tap sent before its request, and doesn't send one Undo took first", async () => {
    let release!: () => void;
    mock.api.feedAction = vi.fn(() => new Promise((yes) => { release = () => yes(timed({ revision: 2 })); }));
    mock.saved = { ...mock.saved!, outbox: [action("end")] };
    await mount(); await flush();
    expect(baby.state.outbox[0]).toMatchObject({ sent: true });
    await act(async () => { release(); await settle(); });
    expect(queued()).toEqual([]);
  });
  it("marks any other rejection for review, without losing it", async () => {
    mock.api.feedAction.mockRejectedValueOnce(new ApiError("Review", 422));
    mock.saved = { ...mock.saved!, outbox: [action("end")] };
    await mount(); await flush();
    expect(baby.state.outbox[0]).toMatchObject({ id: "end", error: "Review" });
  });
  it("keeps queued actions showing on a record the server has just replaced", async () => {
    mock.saved = { ...mock.saved!, outbox: [create, action("end", "2026-11-04T12:10:06.500Z")] };
    await mount(); await flush();
    expect(mock.api.save).toHaveBeenCalledOnce();
    expect(baby.records.find((r) => r.id === "feed")?.data).toMatchObject({ state: "finished", duration_minutes: 9 });
  });
});
describe("provider routine restore integration", () => {
  it("a phone whose push cleanup hangs at every step still finishes signing out", async () => {
    const { createPushDevice } = await vi.importActual<typeof import("./push-device")>("./push-device");
    const never = () => new Promise<never>(() => {});
    const hung = createPushDevice({
      platform: "ios", binding: "b", online: () => true, granted: async () => true, token: never, installation: never,
      read: async () => JSON.stringify({ installation: "i", registration: "1", token: "t" }), write: never, erase: never, put: never,
      remove: never, stopDelivery: never, readRevocation: never, writeRevocation: never, now: () => 0,
    });
    await mount();
    mock.pushEnd.mockImplementationOnce(() => hung.end(50).then(() => undefined));
    await act(async () => {
      const out = baby.signOut();
      await vi.advanceTimersByTimeAsync(60);
      await out;
    });
    expect(mock.signOut).toHaveBeenCalledOnce();
    expect(baby.error).toBeFalsy();
  });
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
  expect(mock.api.import).toHaveBeenCalledTimes(2);
  expect(baby.state.outbox.every(m => m.error === "Daily allowance reached")).toBe(true);
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

describe("independent durable outbox records", () => {
  it.each([403, 422, 429, 500, 503])("persists HTTP %i failure while care, source and reminder records continue", async (status) => {
    await mount();
    const journal = { ...row("photo"), kind: "journal" as const };
    const rows = [journal, { ...row("care"), kind: "diaper" as const }, { ...row("source"), kind: "source" as const }, row("reminder")];
    mock.api.save.mockImplementation(async (r: BabyRecord) => {
      if (r.id === journal.id) throw new ApiError("Could not save this change", status);
      return { ...r, revision: (r.revision ?? 0) + 1 };
    });
    await act(async () => { await baby.commit(s => ({ ...s, outbox: rows.map(record => ({ id: record.id, type: "save", generation: 1, record, files: [] })) })); });
    await act(async () => { await baby.sync(); });
    expect(mock.api.save.mock.calls.map(([r]: any[]) => r.id)).toEqual(["photo", "care", "source", "reminder"]);
    expect(mock.state?.outbox).toMatchObject([{ id: "photo", error: "Could not save this change" }]);
    await act(async () => { await baby.sync(); });
    expect(mock.api.save).toHaveBeenCalledTimes(4);
    // A cold provider restores the exact failed mutation; it never retries silently.
    mock.saved = mock.state;
    await act(async () => { renderer!.unmount(); });
    await mount();
    expect(baby.state.outbox[0].error).toBe("Could not save this change");
    expect(mock.api.save).toHaveBeenCalledTimes(4);
  });
  it("holds a later edit/delete behind failure, then advances revisions in order after Retry", async () => {
    await mount();
    const record = { ...row("journal", false, 1), kind: "journal" as const };
    await act(async () => { await baby.commit(s => ({ ...s, outbox: [
      { id: "first", type: "save", generation: 1, record, files: [], error: "Upload failed" },
      { id: "edit", type: "save", generation: 1, record: { ...record, body: "Updated" }, files: [] },
      { id: "delete", type: "delete", generation: 1, record },
    ] })); });
    await act(async () => { await baby.sync(); });
    expect(mock.api.save).not.toHaveBeenCalled(); expect(mock.api.remove).not.toHaveBeenCalled();
    await act(async () => { await baby.commit(s => ({ ...s, outbox: s.outbox.map(m => m.id === "first" ? { ...m, error: undefined } : m) })); });
    await act(async () => { await baby.sync(); });
    expect(mock.api.save.mock.calls.map(([r]: any[]) => r.revision)).toEqual([1, 2]);
    expect(mock.api.remove.mock.calls[0][0].revision).toBe(3);
    expect(mock.state?.outbox).toEqual([]);
  });
  it.each([0, 401])("pauses the whole pass on network/auth %i without marking records rejected", async (status) => {
    await mount();
    mock.api.save.mockRejectedValueOnce(new ApiError("Connection or sign in needed", status));
    await act(async () => { await baby.commit(s => ({ ...s, outbox: [row("first"), row("other")].map(record => ({ id: record.id, type: "save", generation: 1, record, files: [] })) })); });
    await act(async () => { await baby.sync(); });
    expect(mock.api.save).toHaveBeenCalledOnce();
    expect(mock.state?.outbox).toHaveLength(2);
    expect(mock.state?.outbox.every(m => !m.error)).toBe(true);
  });
});

it("keeps local file preparation failures on that entry while unrelated care syncs", async () => {
  await mount();
  vi.mocked(uploadFile).mockRejectedValueOnce(Error("Choose a file smaller than 25 MB."));
  const file = { id: "photo", uri: "file:///large.jpg", name: "large.jpg", mime_type: "image/jpeg" };
  await act(async () => { await baby.commit(s => ({ ...s, outbox: [
    { id: "photo", type: "save", generation: 1, record: { ...row("photo"), kind: "journal" }, files: [file] },
    { id: "care", type: "save", generation: 1, record: { ...row("diaper"), kind: "diaper" }, files: [] },
  ] })); });
  await act(async () => { await baby.sync(); });
  expect(mock.state?.outbox).toMatchObject([{ id: "photo", error: "Choose a file smaller than 25 MB.", files: [file] }]);
  expect(mock.api.save.mock.calls.map(([r]: any[]) => r.id)).toEqual(["diaper"]);
  expect(baby.error).toBe("");
});
it("holds source edits until a terminal import and rebases them before sending", async () => {
  const source = { ...row("source", false, 1), kind: "source" as const };
  mock.saved = { ...emptyState(), bootstrap, records: [source],
    imports: [{ id: "job", record_id: source.id, status: "queued", baseline: source }], outbox: [
      { id: "edit", type: "save", generation: 1, record: { ...source, body: "My later edit" }, files: [] },
    ] };
  mock.api.job = vi.fn(async () => ({ id: "job", record_id: source.id, status: "processing" }));
  mock.api.record = vi.fn(async () => ({ ...source, revision: 2 }));
  await mount();
  expect(mock.api.save).not.toHaveBeenCalled();
  expect(baby.state.outbox[0]).toMatchObject({ id: "edit", record: { revision: 1, body: "My later edit" } });
  mock.api.job.mockResolvedValue({ id: "job", record_id: source.id, status: "ready" });
  mock.api.record.mockResolvedValue({ ...source, revision: 3, data: { ...source.data, status: "ready", summary: "Processed summary" } });
  await act(async () => { await baby.sync(); await settle(); });
  expect(mock.api.save).toHaveBeenCalledOnce();
  expect(mock.api.save.mock.calls[0][0]).toMatchObject({ revision: 3, body: "My later edit", data: { status: "ready", summary: "Processed summary" } });
  expect(baby.state.outbox).toEqual([]);
});
it("restores phone-only files and errors without submitting them from a cold provider", async () => {
  const file = { id: "photo", uri: "file:///photo.jpg", name: "photo.jpg", mime_type: "image/jpeg" };
  mock.saved = { ...emptyState(), bootstrap, outbox: [
    { id: "kept", type: "save", generation: 1, record: { ...row("photo"), kind: "journal" }, files: [file], localOnly: true, error: "Upload failed" },
  ] };
  await mount();
  expect(baby.state.outbox[0]).toMatchObject({ localOnly: true, error: "Upload failed", files: [file] });
  expect(mock.api.save).not.toHaveBeenCalled();
});

describe("verified import completion (M1)", () => {
  const changes = [
    { title: "Other device title" }, { body: "Other device note" }, { child_id: "other-child" },
    { data: { topics: ["Other topic"] } }, { data: { source_text: "Other original" } },
    { data: { attachment_ids: ["other-photo"] } },
  ];
  it.each(changes)("conflicts instead of adopting a remote edit after import: %j", async (change) => {
    const source = { ...row("source", false, 1), kind: "source" as const };
    mock.saved = { ...emptyState(), bootstrap, records: [source], imports: [
      { id: "job", record_id: source.id, status: "processing", baseline: source },
    ], outbox: [{ id: "edit", type: "save", generation: 1, record: { ...source, body: "My local note" }, files: [] }] };
    mock.api.job = vi.fn(async () => ({ id: "job", record_id: source.id, status: "ready" }));
    mock.api.record = vi.fn(async () => ({ ...source, ...change, revision: 5 }));
    await mount();
    expect(mock.api.save).not.toHaveBeenCalled();
    expect(baby.state.outbox[0]).toMatchObject({ conflict: true, record: { revision: 1, body: "My local note" } });
  });
  it.each(changes)("conflicts on edits made during processing: %j", async (change) => {
    const source = { ...row("source", false, 1), kind: "source" as const };
    mock.saved = { ...emptyState(), bootstrap, records: [source], imports: [
      { id: "job", record_id: source.id, status: "processing", baseline: source },
    ], outbox: [{ id: "edit", type: "save", generation: 1, record: { ...source, body: "My local note" }, files: [] }] };
    mock.api.job = vi.fn(async () => ({ id: "job", record_id: source.id, status: "incomplete", error: "Edited while processing" }));
    mock.api.record = vi.fn(async () => ({ ...source, ...change, revision: 3 }));
    await mount();
    expect(mock.api.save).not.toHaveBeenCalled();
    expect(baby.state.outbox[0]).toMatchObject({ conflict: true, record: { revision: 1 } });
  });
  it("reconciles a completed admission replay after cold restore before releasing a later edit (S1)", async () => {
    const source = { ...row("source", false, 1), kind: "source" as const };
    mock.saved = { ...emptyState(), bootstrap, records: [source], outbox: [
      { id: "job", type: "import", generation: 1, record_id: source.id, files: [] },
      { id: "edit", type: "save", generation: 1, record: { ...source, body: "My note" }, files: [] },
    ] };
    mock.api.import = vi.fn(async () => {
      expect(mock.state?.outbox[0]).toMatchObject({ baseline: source });
      throw new ApiError("Offline before the admission receipt arrived", 0);
    });
    await mount();
    expect(baby.state.outbox[0]).toMatchObject({ baseline: source });
    mock.saved = mock.state;
    await act(async () => { renderer!.unmount(); });
    mock.api.import.mockResolvedValue({ id: "job", record_id: source.id, status: "ready" });
    mock.api.record = vi.fn(async () => ({ ...source, revision: 3, data: { ...source.data, status: "ready", source_text: "Acquired original" } }));
    await mount(); await act(settle);
    expect(mock.api.record).toHaveBeenCalledWith(source.id);
    expect(mock.api.save).toHaveBeenCalledOnce();
    expect(mock.api.save.mock.calls[0][0]).toMatchObject({ revision: 3, body: "My note", data: { source_text: "Acquired original" } });
    expect(baby.state.outbox).toEqual([]);
  });
});

it("checks Ask draft write leases inside the serialized commit (M3)", async () => {
  await mount();
  let valid = true;
  const draft = { ...row("draft"), kind: "journal" as const, body: "Stale question", files: [] };
  await act(async () => {
    const preceding = baby.commit(s => { valid = false; return s; });
    const saving = baby.saveDraft("chat:v2:guarded", draft, () => valid);
    await Promise.all([preceding, saving]);
  });
  expect(baby.state.drafts["chat:v2:guarded"]).toBeUndefined();
});

describe("fetching the other phone's changes", () => {
  const live = { ...bootstrap, personal_space_id: "p", spaces: [{ id: "p", kind: "personal", role: "parent", generation: 1, access_version: 1 }] };
  const diaper = { ...optimisticRecord({ id: "theirs", kind: "diaper", title: "Diaper", body: "", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data: { type: "wet" } }), revision: 1, space_id: "p" };
  const quiet = { spaces: [{ id: "p", generation: 1, access_version: 1, cursor: 3, has_more: false, reset: false, items: [] }], cursor: { p: 3 }, has_more: false, removed_space_ids: [] };
  const flush = () => act(async () => { await settle(); await vi.advanceTimersByTimeAsync(0); await settle(); });
  const setup = (answer: any, extra: object = {}) => {
    mock.api = { bootstrap: vi.fn(async () => answer), identity: vi.fn(async () => ({ id: "owner" })), records: vi.fn(async () => page([])), lease: () => mock.lease, assertLease: () => undefined, changes: vi.fn(async () => quiet), ...extra };
    mock.saved = { ...emptyState(), bootstrap: answer } as unknown as DeviceState;
  };
  it("doesn't call /changes while the API doesn't list spaces, which is the flag off", async () => {
    setup(bootstrap);
    await mount(); await flush();
    expect(mock.api.changes).not.toHaveBeenCalled();
    expect(baby.error).toBe("");
  });
  it("carries on from its saved cursor, keeps what arrived, and tells screens to read again", async () => {
    setup(live);
    mock.saved!.changes = { cursor: { p: 2 }, access: { p: 1 } };
    mock.api.changes.mockResolvedValueOnce({ ...quiet, spaces: [{ ...quiet.spaces[0], items: [{ ...diaper, seq: 3, entity: "record" }] }] });
    await mount(); await flush();
    expect(mock.api.changes.mock.calls[0]).toEqual([{ p: 2 }, { p: 1 }]);
    expect(baby.state.records.map((row) => row.id)).toContain("theirs");
    expect(baby.state.changes?.cursor.p).toBe(3);
    expect(baby.changeTick).toBe(1);
  });
  it("reads every page of a first snapshot in one go, up to a limit, and comes back for the rest", async () => {
    setup(live);
    let at = 0;
    mock.api.changes.mockImplementation(async () => { at++; const more = at < 25; return { ...quiet, has_more: more, cursor: { p: at }, spaces: [{ ...quiet.spaces[0], has_more: more, cursor: at }] }; });
    await mount(); await flush(); await flush();
    expect(at).toBe(25);
    expect(baby.state.changes?.cursor.p).toBe(25);
  });
  it("drops a read from before her access changed, so it can't put a family's rows back", async () => {
    const family = { id: "family-space", kind: "family", role: "parent", generation: 1, access_version: 1 };
    setup({ ...live, spaces: [...live.spaces, family] });
    await mount(); await flush();
    let answer: (value: RecordPage) => void = () => undefined;
    const usual = mock.api.records.getMockImplementation();
    mock.api.records.mockImplementation((filters: { kind?: string }) => filters.kind ? usual!(filters) : new Promise<RecordPage>((resolve) => { answer = resolve; }));
    let done: Promise<void> | undefined;
    await act(async () => { done = baby.refresh(); await flush(); });
    mock.api.records.mockImplementation(usual!);
    await act(async () => { await baby.commit((s) => ({ ...s, bootstrap: { ...s.bootstrap!, spaces: live.spaces } }) as DeviceState); });
    await act(async () => { answer(page([{ ...row("hers-no-more"), kind: "journal", space_id: "family-space" }])); await done; });
    expect(baby.state.records.some((r: BabyRecord) => r.id === "hers-no-more")).toBe(false);
  });
  it("still takes a read when her access hasn't changed", async () => {
    setup(live);
    await mount(); await flush();
    const usual = mock.api.records.getMockImplementation();
    mock.api.records.mockImplementation(async (filters: { kind?: string }) => filters.kind ? usual!(filters) : page([{ ...row("fresh"), kind: "journal" }]));
    await act(async () => { await baby.refresh(); });
    mock.api.records.mockImplementation(usual!);
    expect(baby.state.records.some((r: BabyRecord) => r.id === "fresh")).toBe(true);
  });
  it("still fetches the other phone's changes when a release keeps failing", async () => {
    setup(live, { releaseAttachment: vi.fn(async () => { throw new ApiError("Unavailable", 503); }) });
    mock.saved = { ...mock.saved, fileReleases: ["stuck"], fileUploads: { f: "stuck" } } as unknown as DeviceState;
    await mount(); await flush();
    expect(mock.api.changes).toHaveBeenCalled();
    expect(baby.state.fileReleases).toEqual(["stuck"]);
  });
  it("stops paging once the app goes to the background during a first snapshot", async () => {
    setup(live);
    const { AppState } = await import("react-native");
    let at = 0;
    mock.api.changes.mockImplementation(async () => {
      at++;
      if (at === 1) (AppState as { currentState: string }).currentState = "background";
      return { ...quiet, has_more: true, cursor: { p: at }, spaces: [{ ...quiet.spaces[0], has_more: true, cursor: at }] };
    });
    try {
      await mount(); await flush(); await flush();
      expect(at).toBe(1);
      expect(baby.state.changes?.cursor.p).toBe(1);
    } finally { (AppState as { currentState: string }).currentState = "active"; }
  });
  it("stops paging when the account has changed", async () => {
    setup(live);
    let at = 0;
    mock.api.changes.mockImplementation(async () => {
      at++;
      if (at === 1) await act(async () => { renderer?.unmount(); });
      return { ...quiet, has_more: true, cursor: { p: at }, spaces: [{ ...quiet.spaces[0], has_more: true, cursor: at }] };
    });
    await mount(); await flush();
    expect(at).toBe(1);
    renderer = undefined;
  });
  it("stops rather than spinning if an answer says there's more without moving on", async () => {
    setup(live);
    mock.api.changes.mockImplementation(async () => ({ ...quiet, has_more: true, spaces: [{ ...quiet.spaces[0], has_more: true }] }));
    await mount(); await flush(); await flush();
    expect(mock.api.changes.mock.calls.length).toBeLessThanOrEqual(3);
  });
  it("keeps quiet if the fetch fails: everything stays on this phone and the next pass asks again", async () => {
    setup(live, { changes: vi.fn(async () => { throw new ApiError("Offline", 0); }) });
    await mount(); await flush();
    expect(baby.error).toBe("");
    expect(baby.state.bootstrap).toMatchObject({ generation: 1 });
  });
});

describe("a family's protocol, through the sync loop", () => {
  const personal = "p", family = "f";
  const spaces = [{ id: personal, kind: "personal", role: "parent", generation: 1, access_version: 1 }, { id: family, kind: "family", role: "parent", generation: 1, access_version: 1 }];
  const live = { ...bootstrap, personal_space_id: personal, spaces, children: [{ id: "baby", name: "Baby", revision: 2, space_id: family, generation: 1 }] };
  const flush = () => act(async () => { await settle(); await vi.advanceTimersByTimeAsync(0); await settle(); await vi.advanceTimersByTimeAsync(0); await settle(); });
  const none = { spaces: [], cursor: {}, has_more: false, removed_space_ids: [] };
  const feed = (revision = 3, space_id = personal) => ({ ...optimisticRecord({ id: "feed", kind: "feeding", title: "Feed", body: "", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data: { method: "breast", state: "running", actions: [{ id: "s", action: "start", at: "2026-11-05T00:00:00.000Z", side: "left" }] } }), revision, space_id, generation: 1 });
  const tap = { id: "tap", generation: 1, space_id: personal, type: "feed_action" as const, record_id: "feed", action: { id: "tap", action: "finish" as const, at: "2026-11-05T00:10:00.000Z" } };
  const setup = (answer: any, saved: Partial<DeviceState>, extra: object = {}) => {
    mock.api = { bootstrap: vi.fn(async () => answer), identity: vi.fn(async () => ({ id: "owner" })), records: vi.fn(async () => page([])), lease: () => mock.lease, assertLease: () => undefined, changes: vi.fn(async () => none), ...extra };
    mock.saved = { ...emptyState(), bootstrap: answer, version: 2, ...saved } as unknown as DeviceState;
  };
  const movedError = () => new MovedError({ space_id: family, generation: 1, revision: 4, record: feed(4, family) });
  it("retargets a tap whose feed moved, and sends the same action id to the new space", async () => {
    const applied = { ...feed(5, family), data: { ...feed().data, actions: [...feed().data.actions!, { ...tap.action, revision: 5 }] } };
    const feedAction = vi.fn().mockRejectedValueOnce(movedError()).mockResolvedValue(applied);
    setup(live, { records: [feed()], outbox: [tap] }, { feedAction });
    await mount(); await flush(); await flush();
    expect(feedAction).toHaveBeenCalledTimes(2);
    expect(feedAction.mock.calls[0]).toEqual(["feed", tap.action, { generation: 1, space_id: personal }]);
    expect(feedAction.mock.calls[1]).toEqual(["feed", tap.action, { generation: 1, space_id: family }]);
    expect(baby.state.outbox).toEqual([]);
    expect(baby.state.records[0]).toMatchObject({ space_id: family, revision: 5 });
  });
  it("keeps a tap that got 404 when the row is still known here: same action id, later, and never drops the feed", async () => {
    const feedAction = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404)), record = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404));
    setup(live, { records: [feed()], outbox: [tap] }, { feedAction, record });
    await mount(); await flush();
    expect(baby.state.outbox).toHaveLength(1);
    expect(baby.state.outbox[0]).toMatchObject({ id: "tap" });
    expect(baby.state.records.map((row) => row.id)).toContain("feed");
    expect(baby.state.feedNotices ?? []).toEqual([]);
    expect(mock.api.changes).toHaveBeenCalled();
  });
  it("keeps the tap if the row was never cached here and nothing says it was removed", async () => {
    const feedAction = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404)), record = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404));
    setup(live, { records: [], outbox: [tap] }, { feedAction, record });
    await mount(); await flush();
    expect(baby.state.outbox).toMatchObject([{ id: "tap", action: { id: "tap" } }]);
    expect(baby.state.feedNotices ?? []).toEqual([]);
  });
  it("keeps the tap through an access reset, which empties the cache but says nothing about this row", async () => {
    const feedAction = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404)), record = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404));
    const changes = vi.fn(async () => ({ ...none, spaces: [{ id: personal, generation: 1, access_version: 2, cursor: 0, has_more: false, reset: true, items: [] }] }));
    setup(live, { records: [feed()], outbox: [tap] }, { feedAction, record, changes });
    await mount(); await flush();
    expect(baby.state.outbox).toMatchObject([{ id: "tap" }]);
    expect(baby.state.feedNotices ?? []).toEqual([]);
  });
  it("believes a removal /changes reported on an earlier pass", async () => {
    const feedAction = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404)), record = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404));
    setup(live, { records: [], outbox: [tap], removed: [`${personal}:feed`] }, { feedAction, record });
    await mount(); await flush();
    expect(baby.state.outbox).toEqual([]);
    expect(baby.state.feedNotices).toEqual(["This feed was removed."]);
  });
  it("only believes a feed is gone once /changes says it was removed", async () => {
    const feedAction = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404)), record = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404));
    const changes = vi.fn(async () => ({ ...none, spaces: [{ id: personal, generation: 1, access_version: 1, cursor: 9, has_more: false, reset: false, items: [{ id: "feed", removed: true, seq: 9 }] }] }));
    setup(live, { records: [feed()], outbox: [tap] }, { feedAction, record, changes });
    await mount(); await flush();
    expect(baby.state.outbox).toEqual([]);
    expect(baby.state.feedNotices).toEqual(["This feed was removed."]);
  });
  it("with the flag off, a tap's 404 still means the feed was removed, as before", async () => {
    const feedAction = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404)), record = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404));
    const { space_id: _, ...plain } = tap;
    setup(bootstrap, { records: [optimisticRecord({ id: "feed", kind: "feeding", title: "", body: "", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data: { state: "running" } })], outbox: [plain] }, { feedAction, record });
    await mount(); await flush();
    expect(baby.state.outbox).toEqual([]);
    expect(baby.state.feedNotices).toEqual(["This feed was removed."]);
  });
  it("sends items an older build gave up on after a 404, once, on updating", async () => {
    const save = { id: "old", generation: 1, type: "save" as const, files: [], error: unavailableMessage, record: { id: "e", kind: "diaper" as const, title: "", body: "", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data: {}, revision: 2 } };
    const saved = { ...optimisticRecord(save.record), revision: 3 }, saveCall = vi.fn(async () => saved);
    setup(bootstrap, { outbox: [save], version: undefined }, { save: saveCall });
    await mount(); await flush();
    expect(saveCall).toHaveBeenCalledTimes(1);
    expect(baby.state.outbox).toEqual([]);
  });
  it("on removal purges the family's rows, stops its queue, and leaves the rest working", async () => {
    const shared = feed(3, family), save = vi.fn(async (value: any) => ({ ...optimisticRecord(value), revision: 1 })), mine = { id: "mine", generation: 1, space_id: personal, type: "save" as const, files: [], record: { id: "mine", kind: "diaper" as const, title: "", body: "", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data: {} } };
    const queued = { ...tap, space_id: family };
    setup({ ...live, spaces: [spaces[0]], children: [] }, { bootstrap: live, records: [shared], outbox: [queued, mine] } as never, { save, feedAction: vi.fn() });
    await mount(); await flush();
    expect(baby.state.records.map((row) => row.id)).toEqual(["mine"]);
    expect(mock.api.feedAction).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(baby.state.outbox).toMatchObject([{ id: "tap", left_space: family, error: notSentMessage }]);
  });
  it("finishes a removal it learned of after the flag was off, when it had no list to compare", async () => {
    const shared = feed(3, family);
    setup({ ...live, spaces: [spaces[0]], children: [] }, { bootstrap: bootstrap, records: [shared], outbox: [{ ...tap, space_id: family }] } as never, { feedAction: vi.fn() });
    await mount(); await flush();
    expect(baby.state.records.map((row) => row.id)).toEqual([]);
    expect(mock.api.feedAction).not.toHaveBeenCalled();
    expect(baby.state.outbox).toMatchObject([{ id: "tap", left_space: family, error: notSentMessage }]);
  });
  describe("on joining a family", () => {
    const own = { id: "mine", name: "Mia", revision: 1, space_id: personal, generation: 1 }, theirs = { id: "fam", name: "Mia", revision: 1, space_id: family, generation: 1 };
    const before = { ...live, spaces: [spaces[0]], children: [own] }, after = { ...live, children: [own, theirs] };
    it("picks the family's baby for what she logs next, and leaves queued work and drafts where they were going", async () => {
      const save = vi.fn(async (value: any, _fence?: unknown) => ({ ...optimisticRecord(value), revision: 1 }));
      const queued = { id: "q", generation: 1, space_id: personal, type: "save" as const, files: [], record: { id: "q", kind: "diaper" as const, title: "", body: "", child_id: "mine", occurred_at: "2026-11-05T00:00:00.000Z", data: {} } };
      const draft = { id: "d", kind: "diaper" as const, title: "", body: "half typed", child_id: "mine", occurred_at: "2026-11-05T00:00:00.000Z", data: {}, files: [] };
      setup(after, { bootstrap: before, selectedChild: "mine", outbox: [queued], drafts: { "new:diaper": draft } } as never, { save });
      await mount(); await flush();
      expect(baby.state.selectedChild).toBe("fam");
      expect(save.mock.calls[0][0]).toMatchObject({ id: "q", child_id: "mine" });
      expect(save.mock.calls[0][1]).toEqual({ generation: 1, space_id: personal });
      expect(baby.state.drafts["new:diaper"]).toMatchObject({ child_id: "mine", space_id: personal, body: "half typed" });
    });
    it("doesn't change her choice on an ordinary refresh", async () => {
      setup(after, { bootstrap: after, selectedChild: "mine" } as never);
      await mount(); await flush();
      expect(baby.state.selectedChild).toBe("mine");
    });
  });
  it("forgets a held invite code when the account signs out", async () => {
    const family_ = await import("./family");
    family_.holdInvite({ id: "i", code: "hfbi_v1.x", role: "parent", expires_at: "2026-11-12T00:00:00Z", space_id: family }, "owner");
    setup(live, {});
    await mount(); await flush();
    await act(async () => { await baby.signOut(); });
    expect(family_.heldInvite("owner", family)).toBeNull();
  });
  it("purges nothing when the flag goes off, since the API has stopped saying", async () => {
    const shared = feed(3, family);
    setup(bootstrap, { bootstrap: live, records: [shared] } as never);
    await mount(); await flush();
    expect(baby.state.records.map((row) => row.id)).toEqual(["feed"]);
  });
  it("still sends a stamped change if the flag goes off, and doesn't refuse every save over a family's generation", async () => {
    const save = vi.fn(async (value: any) => ({ ...optimisticRecord(value), revision: 1 })), row = { id: "m", generation: 1, space_id: personal, type: "save" as const, files: [], record: { id: "m", kind: "diaper" as const, title: "", body: "", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data: {} } };
    const shared = { ...row, id: "s", generation: 9, space_id: family, record: { ...row.record, id: "s" } };
    setup({ ...bootstrap }, { bootstrap: { ...bootstrap }, outbox: [row, shared] } as never, { save });
    await mount(); await flush();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { await baby.commit((s) => ({ ...s, askNoticeSeen: true })); });
    expect(baby.state.askNoticeSeen).toBe(true);
  });
  describe("when the personal space is erased from another phone", () => {
    const cleared = { ...live, generation: 2, spaces: [{ ...spaces[0], generation: 2 }, spaces[1]] };
    const familyDraft = { id: "fd", kind: "journal", title: "", body: "family words", child_id: null, occurred_at: "2026-11-05T00:00:00.000Z", data: {}, files: [{ id: "f", uri: "file:///family.jpg", name: "family.jpg", mime_type: "image/jpeg" }], space_id: family };
    const queued = { ...tap, space_id: family, id: "fam", action: { ...tap.action, id: "fam" } };
    it("keeps the family's drafts and queue, its files, and pending captures", async () => {
      const { clearFiles } = await import("./files");
      vi.mocked(clearFiles).mockClear();
      mock.clearShares.mockClear();
      setup(cleared, { bootstrap: live, records: [feed(3, family)], outbox: [queued], drafts: { "record:fd": familyDraft, "new:journal": { ...familyDraft, id: "p", space_id: personal } } } as never, { feedAction: vi.fn(async () => feed(4, family)) });
      await mount(); await flush();
      expect(Object.keys(baby.state.drafts)).toEqual(["record:fd"]);
      expect(mock.clearShares).not.toHaveBeenCalled();
      expect((vi.mocked(clearFiles).mock.calls.at(-1)![1] as () => ReadonlySet<string>)()).toEqual(new Set(["file:///family.jpg"]));
    });
    it("doesn't refuse every save while the personal space waits to be started again", async () => {
      setup({ ...cleared, active: false, spaces: [spaces[1]] }, { bootstrap: live, records: [feed(3, family)], outbox: [queued] } as never, { feedAction: vi.fn() });
      await mount(); await flush();
      expect(baby.state.outbox.map((m) => m.id)).toEqual(["fam"]);
      expect(baby.state.bootstrap?.active).toBe(false);
      expect(baby.error).toBe("");
    });
    it("still clears everything with no family", async () => {
      mock.clearShares.mockClear();
      setup({ ...bootstrap, generation: 2 }, { bootstrap, outbox: [] } as never);
      await mount(); await flush();
      expect(mock.clearShares).toHaveBeenCalled();
    });
  });
  it("treats a release of an upload that's already gone as done, so it can't hold up the pass", async () => {
    const releaseAttachment = vi.fn().mockRejectedValue(new ApiError("Unavailable", 404));
    setup(live, { fileReleases: ["retired"], fileUploads: { f: "retired" } }, { releaseAttachment });
    await mount(); await flush();
    expect(baby.state.fileReleases).toEqual([]);
    expect(mock.api.changes).toHaveBeenCalled();
    expect(baby.error).toBe("");
  });
});
describe("the recheck: drafts, removal proof and files", () => {
  const p = "p", f = "f", own = { id: p, kind: "personal", role: "parent", generation: 1, access_version: 1 }, fam = { id: f, kind: "family", role: "parent", generation: 1, access_version: 1 };
  const quiet = { spaces: [], cursor: {}, has_more: false, removed_space_ids: [] };
  const settled = () => act(async () => { await settle(); await vi.advanceTimersByTimeAsync(0); await settle(); });
  const account = (over: object) => { mock.api = { bootstrap: vi.fn(async () => over), identity: vi.fn(async () => ({ id: "owner" })), records: vi.fn(async () => page([])), lease: () => mock.lease, assertLease: () => undefined, changes: vi.fn(async () => quiet) }; };
  const source = (over: object = {}) => ({ id: "draft", kind: "source", title: "T", body: "Keep these words", child_id: null, occurred_at: "2026-11-05T00:00:00Z", data: { topics: [], status: "saved" }, files: [], ...over }) as never;
  it("a new Shared draft is stamped when it's saved, so erasing the personal space leaves it", async () => {
    const before = { ...bootstrap, personal_space_id: p, spaces: [own, fam] }, after = { ...before, generation: 2, spaces: [{ ...own, generation: 2 }, fam] };
    account(before);
    mock.saved = { ...emptyState(), version: 2, bootstrap: before } as never;
    await mount(); await settled();
    await act(async () => { await baby.saveDraft("new:source", source({ shared: true })); await settle(); });
    expect(baby.state.drafts["new:source"]).toMatchObject({ space_id: f, generation: 1, shared: true });
    mock.api.bootstrap = vi.fn(async () => after);
    await act(async () => { await baby.refresh(); await settle(); });
    expect(baby.state.drafts["new:source"]).toMatchObject({ body: "Keep these words", space_id: f });
  });
  it("a new draft she made Just me is stamped personal, and erasure takes it", async () => {
    const before = { ...bootstrap, personal_space_id: p, spaces: [own, fam] }, after = { ...before, generation: 2, spaces: [{ ...own, generation: 2 }, fam] };
    account(before);
    mock.saved = { ...emptyState(), version: 2, bootstrap: before } as never;
    await mount(); await settled();
    await act(async () => { await baby.saveDraft("new:source", source({ shared: false })); await settle(); });
    expect(baby.state.drafts["new:source"]).toMatchObject({ space_id: p });
    mock.api.bootstrap = vi.fn(async () => after);
    await act(async () => { await baby.refresh(); await settle(); });
    expect(baby.state.drafts["new:source"]).toBeUndefined();
  });
  it("changing her mind moves the stamp with the choice", async () => {
    const before = { ...bootstrap, personal_space_id: p, spaces: [own, fam] };
    account(before);
    mock.saved = { ...emptyState(), version: 2, bootstrap: before } as never;
    await mount(); await settled();
    await act(async () => { await baby.saveDraft("new:source", source({ shared: true })); await settle(); });
    await act(async () => { await baby.saveDraft("new:source", source({ ...baby.state.drafts["new:source"], shared: false })); await settle(); });
    expect(baby.state.drafts["new:source"]).toMatchObject({ space_id: p, shared: false });
    await act(async () => { await baby.saveDraft("new:source", source({ ...baby.state.drafts["new:source"], shared: true })); await settle(); });
    expect(baby.state.drafts["new:source"]).toMatchObject({ space_id: f, shared: true });
  });
  it("a late save from an editor opened before joining can't overwrite the destination joining gave it", async () => {
    const before = { ...bootstrap, personal_space_id: p, spaces: [own] };
    account(before);
    mock.saved = { ...emptyState(), version: 2, bootstrap: before, drafts: { "new:source": source() } } as never;
    await mount(); await settled();
    const lateSave = baby.saveDraft;
    mock.api.bootstrap = vi.fn(async () => ({ ...before, spaces: [own, fam] }));
    await act(async () => { await baby.refresh(); await settle(); });
    expect(baby.state.drafts["new:source"].space_id).toBe(p);
    await act(async () => { await lateSave("new:source", source({ body: "Last private words" })); await settle(); });
    const { choiceFor } = await import("./spaces");
    expect(baby.state.drafts["new:source"]).toMatchObject({ body: "Last private words", space_id: p });
    expect(choiceFor(baby.state.bootstrap, baby.state.drafts["new:source"])?.space_id).toBe(p);
  });
  it("with no family yet, a new draft is stamped personal, and joining leaves it there", async () => {
    const before = { ...bootstrap, personal_space_id: p, spaces: [own] };
    account(before);
    mock.saved = { ...emptyState(), version: 2, bootstrap: before } as never;
    await mount(); await settled();
    await act(async () => { await baby.saveDraft("new:source", source()); await settle(); });
    expect(baby.state.drafts["new:source"]).toMatchObject({ space_id: p, generation: 1 });
  });
  it("an edit of a saved entry keeps its own space", async () => {
    const before = { ...bootstrap, personal_space_id: p, spaces: [own, fam] };
    account(before);
    mock.saved = { ...emptyState(), version: 2, bootstrap: before } as never;
    await mount(); await settled();
    await act(async () => { await baby.saveDraft("edit:x", source({ existing: true, space_id: f, generation: 1 })); await settle(); });
    expect(baby.state.drafts["edit:x"]).toMatchObject({ space_id: f });
    expect(baby.state.drafts["edit:x"].shared).toBeUndefined();
  });
  it("with the flag off, a draft is left unstamped", async () => {
    account(bootstrap);
    mock.saved = { ...emptyState(), version: 2, bootstrap } as never;
    await mount(); await settled();
    await act(async () => { await baby.saveDraft("new:source", source()); await settle(); });
    expect(baby.state.drafts["new:source"].space_id).toBeUndefined();
  });
  describe("a removal only counts in its own space", () => {
    const live = { ...bootstrap, personal_space_id: p, spaces: [own, fam], children: [] };
    const feed = { ...optimisticRecord({ id: "feed", kind: "feeding", title: "Feed", body: "", child_id: null, occurred_at: "2026-11-05T00:00:00Z", data: { method: "breast", state: "running", actions: [{ id: "start", action: "start", side: "left", at: "2026-11-05T00:00:00Z" }] } as never }), revision: 2, space_id: f, generation: 1 };
    const tap = { id: "tap", type: "feed_action", record_id: "feed", space_id: f, generation: 1, action: { id: "tap", action: "finish", at: "2026-11-05T00:10:00Z" } };
    const refused = () => ({ feedAction: vi.fn(async () => { throw new ApiError("Unavailable", 404); }), record: vi.fn(async () => { throw new ApiError("Unavailable", 404); }) });
    const answer = (items: object[], removed: string[] = [], space = p) => ({ spaces: [{ id: space, generation: 1, access_version: 1, cursor: 10, has_more: false, reset: false, items }], cursor: { [space]: 10 }, has_more: false, removed_space_ids: removed });
    it("an old personal move tombstone can't discard a family tap when removal happens after bootstrap", async () => {
      const changes = vi.fn(async () => answer([{ id: "feed", seq: 10, removed: true }], [f]));
      mock.api = { bootstrap: vi.fn(async () => live), identity: vi.fn(async () => ({ id: "owner" })), records: vi.fn(async () => page([])), lease: () => mock.lease, assertLease: () => undefined, changes, ...refused() };
      mock.saved = { ...emptyState(), version: 2, bootstrap: live, records: [feed], outbox: [tap] } as never;
      await mount(); await settled();
      expect(changes).toHaveBeenCalled();
      expect(baby.state.outbox).toMatchObject([{ id: "tap", left_space: f, error: expect.stringContaining("no longer in this family") }]);
      expect(baby.state.feedNotices ?? []).not.toContain("This feed was removed.");
    });
    it("a tombstone from the personal space alone doesn't discard a family tap, even with the family still here", async () => {
      const changes = vi.fn(async () => answer([{ id: "feed", seq: 10, removed: true }]));
      mock.api = { bootstrap: vi.fn(async () => live), identity: vi.fn(async () => ({ id: "owner" })), records: vi.fn(async () => page([])), lease: () => mock.lease, assertLease: () => undefined, changes, ...refused() };
      mock.saved = { ...emptyState(), version: 2, bootstrap: live, records: [feed], outbox: [tap] } as never;
      await mount(); await settled();
      expect(baby.state.outbox).toMatchObject([{ id: "tap" }]);
      expect(baby.state.outbox[0]).not.toHaveProperty("left_space");
      expect(baby.state.feedNotices ?? []).toEqual([]);
    });
    it("a removal from the family's own space still settles the tap", async () => {
      const changes = vi.fn(async () => answer([{ id: "feed", seq: 10, removed: true }], [], f));
      mock.api = { bootstrap: vi.fn(async () => live), identity: vi.fn(async () => ({ id: "owner" })), records: vi.fn(async () => page([])), lease: () => mock.lease, assertLease: () => undefined, changes, ...refused() };
      mock.saved = { ...emptyState(), version: 2, bootstrap: live, records: [feed], outbox: [tap] } as never;
      await mount(); await settled();
      expect(baby.state.outbox).toEqual([]);
      expect(baby.state.feedNotices).toContain("This feed was removed.");
    });
  });
  it("erasure racing a new family draft keeps that draft's file", async () => {
    const { clearFiles } = await import("./files");
    const live = { ...bootstrap, personal_space_id: p, spaces: [own, fam] };
    account(live);
    mock.saved = { ...emptyState(), version: 2, bootstrap: live } as never;
    await mount(); await settled();
    let release = () => undefined as void;
    mock.clear.mockImplementationOnce(() => new Promise<void>((yes) => { release = yes; }));
    mock.api.bootstrap = vi.fn(async () => ({ ...live, generation: 2, spaces: [{ ...own, generation: 2 }, fam] }));
    let refreshing: Promise<void> | undefined;
    await act(async () => { refreshing = baby.refresh(); await settle(); });
    const file = { id: "new-file", uri: "file:///new-family.jpg", name: "photo.jpg", mime_type: "image/jpeg" };
    const draft = source({ id: "new-draft", space_id: f, generation: 1, shared: true, files: [file] });
    await act(async () => { await baby.saveDraft("new:source", draft); await settle(); });
    vi.mocked(clearFiles).mockClear();
    await act(async () => { release(); await refreshing; await settle(); });
    expect(baby.state.drafts["new:source"]).toMatchObject({ id: "new-draft", files: [file] });
    const keep = vi.mocked(clearFiles).mock.calls.at(-1)?.[1] as () => ReadonlySet<string>;
    expect(keep().has(file.uri)).toBe(true);
  });
});
describe("this phone and the push flag", () => {
  it("with the flag off it never registers, and only forgets what it holds at sign-out", async () => {
    await mount();
    await act(async () => { await baby.sync(); await settle(); });
    expect(mock.pushEnsure).not.toHaveBeenCalled();
    await act(async () => { await baby.registerPush(); });
    expect(mock.pushEnsure).not.toHaveBeenCalled();
  });
  it("with the flag on it registers under the personal generation", async () => {
    mock.api.bootstrap = vi.fn(async () => ({ ...bootstrap, generation: 4, reminders: { push: true } }));
    await mount();
    await act(async () => { await baby.sync(); await settle(); });
    expect(mock.pushEnsure).toHaveBeenCalledWith(4);
  });
  it("sign-out ends the registration before the session goes", async () => {
    await mount();
    await act(async () => { await baby.signOut(); });
    expect(mock.pushEnd).toHaveBeenCalledOnce();
    expect(mock.pushEnd.mock.invocationCallOrder[0]).toBeLessThan(mock.signOut.mock.invocationCallOrder[0]);
  });
  it("a sign-out that was interrupted ends it when it picks up again", async () => {
    mock.cleanupOwner = "owner";
    await mount();
    expect(mock.pushEnd).toHaveBeenCalledOnce();
    expect(mock.pushEnd.mock.invocationCallOrder[0]).toBeLessThan(mock.signOut.mock.invocationCallOrder[0]);
  });
});
