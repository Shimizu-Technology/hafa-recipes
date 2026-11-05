import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBabyApi } from "./api";
import { emptyState, optimisticRecord, type DeviceState } from "./models";
import { carePollMs, todayCareRows, useTodayCare } from "./today-care";

const scope = vi.hoisted(() => ({ account: null as unknown, focused: true, appState: "active" }));
vi.mock("./context", () => ({ useBaby: () => scope.account }));
vi.mock("react-native", () => ({ AppState: { get currentState() { return scope.appState; } } }));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return { useFocusEffect: (callback: () => (() => void) | undefined) =>
    React.useEffect(() => scope.focused ? callback() : undefined, [callback, scope.focused]) };
});
const care = (id: string, child_id: string | null = null, occurred_at = "2026-10-19T00:00:00Z") => optimisticRecord({
  id, kind: "feeding", child_id, occurred_at, title: id, body: "", data: { method: "breast" },
});
const page = (rows: ReturnType<typeof care>[]) => Response.json({ items: rows, total: rows.length, has_more: false });
let renderer: ReactTestRenderer | undefined, result: ReturnType<typeof useTodayCare>;
function Probe() { result = useTodayCare(); return null; }
function setup(transport: (url: string, init?: RequestInit) => Promise<Response>) {
  const account = {
    owner: "parent", current: () => true,
    state: { ...emptyState(), bootstrap: { generation: 1, active: true, ai_available: true, children: [],
      profile: { display_name: "Parent", ai_consent: true, timezone: "Pacific/Guam" } } } as DeviceState,
    api: createBabyApi("https://service.example", async () => "token", () => true, transport),
    commit: vi.fn(async (change: (state: DeviceState) => DeviceState) => { account.state = change(account.state); }),
  };
  scope.account = account;
  return account;
}
async function mount() { await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); }); }
async function render() { await act(async () => renderer!.update(React.createElement(Probe))); }
beforeEach(() => {
  scope.focused = true;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated")) throw Error(String(args[0]));
  });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });

it("restores real older care behind100newer sources using the scoped latest3API request", async () => {
  const saved = care("older-care"), transport = vi.fn(async (_url: string) => page([saved]));
  const account = setup(transport);
  account.state.records = Array.from({ length: 100 }, (_, i) => ({ ...care(`source-${i}`), kind: "source" }));
  expect(todayCareRows(account.state, null, null)).toEqual([]);
  await mount();
  const params = new URL(transport.mock.calls[0][0] ?? "").searchParams;
  expect(params.getAll("kinds")).toEqual(["feeding", "sleep", "diaper"]);
  expect(params.get("limit")).toBe("100");
  expect(params.get("include_general")).toBe("true");
  expect(result.rows.map((row) => row.id)).toEqual([saved.id]);
  expect(account.state.records).toContainEqual(saved);
});
it("switches child scope and refuses an older child's late response", async () => {
  let release!: (response: Response) => void;
  const transport = vi.fn(async (url: string) => new URL(url).searchParams.get("child_id") === "first"
    ? new Promise<Response>((resolve) => { release = resolve; }) : page([care("second-care", "second")]));
  const account = setup(transport);
  account.state.selectedChild = "first";
  await mount();
  account.state = { ...account.state, selectedChild: "second" };
  await render();
  await act(async () => release(page([care("first-care", "first")])));
  expect(result.rows.map((row) => row.id)).toEqual(["second-care"]);
  expect(account.state.records.map((row) => row.id)).toEqual(["second-care"]);
});
it("makes latest successful IDs authoritative over cached remotely deleted care", async () => {
  const account = setup(async () => page([]));
  account.state.records = [care("deleted-remotely")];
  await mount();
  expect(result.rows).toEqual([]);
  expect(account.state.records).toHaveLength(1); // cache retained for other offline views
});
it("keeps offline cached care, overlays pending saves/deletes, and limits to3in child order", async () => {
  const account = setup(async () => { throw Error("offline"); });
  account.state.selectedChild = "child";
  account.state.records = [care("deleted", "child"), care("old", "child"), care("other", "other"),
    care("general"), care("third", "child", "2026-10-18T00:00:00Z")];
  account.state.outbox = [
    { type: "save", id: "save", generation: 1, files: [], record: care("new", "child", "2026-10-20T00:00:00Z") },
    { type: "delete", id: "delete", generation: 1, record: care("deleted", "child") },
  ];
  await mount();
  expect(result.error).toContain("Could not connect");
  expect(result.loading).toBe(false);
  expect(result.rows.map((row) => row.id)).toEqual(["new", "old", "general"]);
});
it("keeps just-synced local care visible while excluding unrelated oldcache from a server page", async () => {
  const account = setup(async () => page([care("server")]));
  const local = care("local", null, "2026-10-20T00:00:00Z");
  account.state.records = [care("old-unrelated")];
  account.state.outbox = [{ type: "save", id: "save", generation: 1, files: [], record: local }];
  await mount();
  account.state = { ...account.state, records: [...account.state.records, local], outbox: [] };
  await render();
  expect(result.rows.map((row) => row.id)).toEqual(["local", "server"]);
});
it("falls back to all private cached care on offline refocus after a local save finished syncing", async () => {
  const transport = vi.fn().mockResolvedValueOnce(page([care("server")])).mockRejectedValueOnce(Error("offline"));
  const account = setup(transport);
  await mount();
  account.state.records.push(care("new-local", null, "2026-10-20T00:00:00Z"));
  scope.focused = false; await render();
  scope.focused = true; await render();
  expect(result.error).toBeTruthy();
  expect(result.rows.map((row) => row.id)).toEqual(["new-local", "server"]);
});
it("does not roll back a newer synced revision or resurrect a just-synced delete from a held read", async () => {
  let release!: (response: Response) => void;
  const account = setup(() => new Promise<Response>((resolve) => { release = resolve; }));
  const older = { ...care("corrected"), revision: 1 }, removed = care("removed");
  account.state.records = [older, removed];
  await mount();
  account.state.outbox = [{ type: "delete", id: "delete", generation: 1, record: removed }];
  await render();
  const correction = { ...older, title: "Corrected feeding", revision: 2 };
  account.state = { ...account.state, records: [correction], outbox: [] };
  await render();
  await act(async () => release(page([older, removed])));
  expect(account.state.records).toEqual([correction]);
  expect(result.rows).toEqual([correction]);
});
it("fences overlapping refreshes and refreshes again on focus", async () => {
  let release!: (response: Response) => void;
  const transport = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }))
    .mockResolvedValueOnce(page([care("fresh")])).mockResolvedValueOnce(page([care("refocused")]));
  const account = setup(transport);
  await mount();
  await act(async () => result.refresh());
  await act(async () => release(page([care("stale")])));
  expect(account.state.records.map((row) => row.id)).toEqual(["fresh"]);
  scope.focused = false; await render();
  scope.focused = true; await render();
  expect(result.rows.map((row) => row.id)).toEqual(["refocused"]);
  expect(transport).toHaveBeenCalledTimes(3);
});
it("does not merge a held response after blur or owner change", async () => {
  let release!: (response: Response) => void;
  const account = setup(() => new Promise<Response>((resolve) => { release = resolve; }));
  await mount();
  scope.focused = false; await render();
  scope.account = { ...account, owner: "another-parent", state: { ...account.state, records: [] } };
  await render();
  await act(async () => release(page([care("private-old-care")])));
  expect(account.commit).not.toHaveBeenCalled();
  expect(result.rows).toEqual([]);
});
it("retires a prior owner's response even while the screen remains focused", async () => {
  let release!: (response: Response) => void;
  const first = setup(() => new Promise<Response>((resolve) => { release = resolve; }));
  await mount();
  const second = setup(async () => page([care("new-owner-care")]));
  second.owner = "another-parent";
  await render();
  await act(async () => release(page([care("old-owner-private-care")])));
  expect(first.commit).not.toHaveBeenCalled();
  expect(result.rows.map((row) => row.id)).toEqual(["new-owner-care"]);
});
it("rechecks the generation lease inside a queued durable commit before merging returned care", async () => {
  const account = setup(async () => page([care("retired-care")]));
  let commit!: () => void;
  account.commit.mockImplementation((change) => new Promise<void>((resolve, reject) => {
    commit = () => { try { account.state = change(account.state); resolve(); } catch (failure) { reject(failure); } };
  }));
  await mount();
  await act(async () => {
    await account.api.erase(1);
    account.state = { ...emptyState(), bootstrap: { ...account.state.bootstrap!, generation: 2 } };
    commit();
  });
  expect(account.state.records).toEqual([]);
  expect(result.rows).toEqual([]);
});

it("looks for the other phone's care every 15 seconds while focused, quietly, and only in the foreground", async () => {
  vi.useFakeTimers();
  try {
    const transport = vi.fn(async (_url: string) => page([care("mine")]));
    setup(transport);
    await mount();
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockImplementation(async () => page([care("mine"), care("other-phone", null, "2026-10-20T00:00:00Z")]));
    await act(async () => { await vi.advanceTimersByTimeAsync(carePollMs); });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(result.all.map((row) => row.id)).toEqual(["other-phone", "mine"]);
    // A dropped signal doesn't throw away what's on screen or raise a banner.
    transport.mockImplementation(async () => { throw new TypeError("offline"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(carePollMs); });
    expect(result.error).toBe("");
    expect(result.loading).toBe(false);
    expect(result.all.map((row) => row.id)).toEqual(["other-phone", "mine"]);
    // But a panel showing a "Last" can say it may be behind, until a look gets through.
    expect(result.stale).toBe(true);
    transport.mockImplementation(async () => page([care("mine"), care("other-phone", null, "2026-10-20T00:00:00Z")]));
    await act(async () => { await vi.advanceTimersByTimeAsync(carePollMs); });
    expect(result.stale).toBe(false);
    transport.mockImplementation(async () => { throw new TypeError("offline"); });
    scope.appState = "background";
    const calls = transport.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(carePollMs * 2); });
    expect(transport).toHaveBeenCalledTimes(calls);
    scope.appState = "active";
    await act(async () => renderer!.unmount());
    renderer = undefined;
    await vi.advanceTimersByTimeAsync(carePollMs * 2);
    expect(transport).toHaveBeenCalledTimes(calls);
  } finally { vi.useRealTimers(); scope.appState = "active"; }
});

describe("how long a log saved on this phone outlives a look that doesn't have it", () => {
  const dose = (id: string, at: string) => ({ ...care(id, "baby", at), kind: "medicine" as const, title: "Tylenol", data: { name: "Tylenol" } });
  const older = dose("older-dose", "2026-11-03T00:00:00Z"), recent = dose("recent-dose", "2026-11-04T00:00:00Z");
  const save = (record: ReturnType<typeof dose>) => ({ id: `save-${record.id}`, generation: 1, type: "save" as const, record, files: [] });
  function Medicine() { result = useTodayCare({ kinds: ["medicine"], child: "baby" }); return null; }
  const mountMedicine = () => act(async () => { renderer = TestRenderer.create(React.createElement(Medicine)); });
  const rerender = () => act(async () => renderer!.update(React.createElement(Medicine)));
  const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(carePollMs); });
  const ids = () => result.all.map((row) => row.id);
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("lets go once a look begun after the save finished doesn't have it: another phone deleted it", async () => {
    let remote = [older];
    const account = setup(async () => page(remote as never));
    account.state = { ...account.state, records: [older], outbox: [save(recent)] };
    await mountMedicine();
    expect(ids()).toEqual(["recent-dose", "older-dose"]);
    // It lands, and another phone removes it before any look sees it.
    account.state = { ...account.state, records: [older, { ...recent, revision: 1 }], outbox: [] };
    await rerender();
    await poll();
    expect(ids()).toEqual(["older-dose"]);
    await poll();
    expect(ids()).toEqual(["older-dose"]);
  });
  it("keeps a save still queued, however many looks don't have it", async () => {
    const account = setup(async () => page([older] as never));
    account.state = { ...account.state, records: [older], outbox: [save(recent)] };
    await mountMedicine();
    await poll();
    await poll();
    expect(ids()).toEqual(["recent-dose", "older-dose"]);
  });
  it("keeps a save that landed during a look begun before it did: that look can't know", async () => {
    let answer!: (response: Response) => void;
    const transport = vi.fn(async (_url: string) => page([older] as never));
    const account = setup(transport);
    account.state = { ...account.state, records: [older], outbox: [save(recent)] };
    await mountMedicine();
    // A look begins while it's queued, and is still out when the save lands.
    transport.mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
    await poll();
    account.state = { ...account.state, records: [older, { ...recent, revision: 1 }], outbox: [] };
    await rerender();
    await act(async () => { answer(page([older] as never)); await vi.advanceTimersByTimeAsync(0); });
    expect(ids()).toEqual(["recent-dose", "older-dose"]);
    // The next look began after it landed, so it has the last word, whichever way that goes.
    transport.mockImplementation(async () => page([{ ...recent, revision: 1 }, older] as never));
    await poll();
    expect(ids()).toEqual(["recent-dose", "older-dose"]);
    transport.mockImplementation(async () => page([older] as never));
    await poll();
    expect(ids()).toEqual(["older-dose"]);
  });
  it("keeps a save queued and landed entirely inside one look", async () => {
    let answer!: (response: Response) => void;
    const transport = vi.fn(async (_url: string) => page([older] as never));
    const account = setup(transport);
    account.state = { ...account.state, records: [older] };
    await mountMedicine();
    transport.mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
    await poll();
    account.state = { ...account.state, outbox: [save(recent)] };
    await rerender();
    account.state = { ...account.state, records: [older, { ...recent, revision: 1 }], outbox: [] };
    await rerender();
    await act(async () => { answer(page([older] as never)); await vi.advanceTimersByTimeAsync(0); });
    expect(ids()).toEqual(["recent-dose", "older-dose"]);
    await poll();
    expect(ids()).toEqual(["older-dose"]);
  });
  it("doesn't let a failed look retire anything", async () => {
    const transport = vi.fn(async (_url: string) => page([older] as never));
    const account = setup(transport);
    account.state = { ...account.state, records: [older], outbox: [save(recent)] };
    await mountMedicine();
    account.state = { ...account.state, records: [older, { ...recent, revision: 1 }], outbox: [] };
    await rerender();
    transport.mockImplementation(async () => { throw new TypeError("offline"); });
    await poll();
    expect(ids()).toEqual(["recent-dose", "older-dose"]);
    expect(result.stale).toBe(true);
  });
});

it("reads every page with the real hook, so an old shot behind a hundred newer custom logs is still found", async () => {
  const shot = { ...care("old-shot", "baby", "2026-10-01T00:00:00Z"), kind: "custom" as const, title: "Hep B", data: { label: "Shot" } };
  const newer = Array.from({ length: 100 }, (_, index) => ({ ...care(`custom-${index}`, "baby"), kind: "custom" as const, data: { label: "Bath" } }));
  const transport = vi.fn(async (url: string) => Response.json({ items: new URL(url).searchParams.has("offset") ? [shot] : newer, total: 101, has_more: !new URL(url).searchParams.has("offset") }));
  setup(transport);
  function Paged() { result = useTodayCare({ kinds: ["custom"], pages: 50, limit: 5000, child: "baby" }); return null; }
  await act(async () => { renderer = TestRenderer.create(React.createElement(Paged)); });
  expect(transport).toHaveBeenCalledTimes(2);
  expect(new URL(transport.mock.calls[1][0]).searchParams.get("offset")).toBe("100");
  expect(result.all.find((row) => row.id === "old-shot")).toMatchObject({ title: "Hep B" });
});
