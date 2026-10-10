import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExportJob } from "./export-jobs";
const f = vi.hoisted(() => ({ map: new Map<string, string>(), active: "active", current: true, next: 0, finishHeld: null as (() => void) | null,
  changes: new Set<(state: string) => void>(), capabilities: vi.fn(), createJob: vi.fn(), job: vi.fn(), byRequest: vi.fn(),
  cancel: vi.fn(), page: vi.fn(), oldCreate: vi.fn(), oldDelete: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock("react-native", () => ({ AppState: {
  get currentState() { return f.active; }, addEventListener: (_: string, listener: (state: string) => void) => {
    f.changes.add(listener); return { remove: () => f.changes.delete(listener) };
  } } }));
vi.mock("expo-router", () => ({ useFocusEffect: (callback: () => (() => void)) => useEffect(callback, [callback]) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `screen-request-${++f.next}` }));
vi.mock("@clerk/expo", () => ({ useAuth: () => ({ userId: "screen-subject", sessionId: "screen-session" }) }));
vi.mock("@/lib/config", () => ({ configuration: { apiBase: "https://screen-fixture.invalid", clerkKey: "pk_test_fixture", clerkEnvironment: "development" } }));
vi.mock("@/lib/context", () => {
  const storage = { isCurrent: () => f.current, getItem: async (key: string) => f.map.get(key) ?? null,
    setItem: async (key: string, value: string) => { if (!f.current) throw Error("retired"); f.map.set(key, value); }, removeItem: async (key: string) => { f.map.delete(key); } };
  const enrollment = { enrolled: true, generation: 3 };
  const api = { capabilities: f.capabilities, createExportJob: f.createJob, exportJob: f.job, exportJobByRequest: f.byRequest,
    cancelExportJob: f.cancel, exportSnapshotPage: f.page, createExportSnapshot: f.oldCreate,
    deleteExportSnapshot: f.oldDelete, removeWorkoutsData: f.remove };
  return { useTraining: () => ({ owner: "screen-owner", enrollment, storage, api, isCurrentAccount: () => f.current,
    eraseLocalData: vi.fn(), invalidateAccount: vi.fn() }) };
});
vi.mock("@/components/ui", () => ({ Screen: "Screen", Card: "Card", Copy: "Copy", Notice: "Notice", Button: "Button", Choice: "Choice" }));
vi.mock("@/components/reminders-provider", () => ({ useReminders: () => ({ controller: null }) }));
vi.mock("@/lib/logout-recovery-native", () => ({ logoutRecovery: {} }));
vi.mock("@/lib/export-file", () => ({ savePrivateExport: f.save }));
import AccountData from "../app/account-data";

const manifest = { id: "screen-snapshot", generation: 3, schema_version: 1 as const, created_at: "2026-10-11T00:00:00Z",
  expires_at: "2026-10-11T00:10:00Z", page_count: 1, page_size: 10 as const, totals: { workouts: 0 } };
const ready: ExportJob = { id: "screen-job", request_id: "screen-request-1", generation: 3, schema_version: 1,
  status: "ready", admitted_at: manifest.created_at, deadline_at: "2026-10-11T00:02:00Z", expires_at: manifest.expires_at,
  started_at: null, finished_at: null, failure_code: null, cleanup_pending: false, manifest };
let renderer: ReactTestRenderer | null = null;
let cache: QueryClient;
const button = (title: string) => renderer!.root.findAll((node) => String(node.type) === "Button").find((node) => node.props.title === title)!;
async function render() {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(AccountData))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
async function press(title: string) {
  const target = button(title); expect(target).toBeDefined(); expect(target.props.disabled).not.toBe(true);
  await act(async () => { await target.props.onPress(); await new Promise((resolve) => setTimeout(resolve, 10)); });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); f.map.clear(); f.current = true; f.active = "active"; f.next = 0; f.changes.clear();
  f.capabilities.mockResolvedValue({ export_jobs: true }); f.createJob.mockResolvedValue(ready); f.job.mockResolvedValue(ready); f.byRequest.mockResolvedValue(ready);
  f.cancel.mockResolvedValue({ ...ready, status: "cancelled", manifest: null });
  f.page.mockResolvedValue({ snapshot_id: manifest.id, page: 0, page_count: 1, export: {
    schema_version: 1, generated_at: manifest.created_at, enrollment: { generation: 3 }, profile: null, profile_revision: 0,
    ai_consent: null, grants: [], totals: manifest.totals, datasets: { workouts: [] }, has_more: { workouts: false }, offset: 0, limit: 10 } });
  f.save.mockResolvedValue(undefined); f.oldDelete.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => { f.finishHeld?.(); f.finishHeld = null; renderer?.unmount(); });
  renderer = null; cache?.clear(); vi.useRealTimers();
});
it("requires deliberate preparation and a separate Save, then honestly labels the save sheet result and scoped cleanup", async () => {
  await render(); expect(f.createJob).not.toHaveBeenCalled();
  await press("Prepare private Workouts export"); expect(f.save).not.toHaveBeenCalled(); expect(f.page).not.toHaveBeenCalled();
  expect(button("Save complete private export")).toBeDefined();
  await press("Save complete private export");
  expect(f.save).toHaveBeenCalledTimes(1); expect(f.cancel).toHaveBeenCalledWith("screen-job", 3);
  expect(JSON.stringify(renderer!.toJSON())).toContain("cannot tell whether you saved");
  expect(button("Start a fresh private export")).toBeDefined();
});
it("keeps the same ready export and offers deliberate download retry after a page connection error", async () => {
  await render(); await press("Prepare private Workouts export"); f.page.mockRejectedValueOnce(Object.assign(Error("Offline page"), { status: 0 }));
  await press("Save complete private export"); expect(f.save).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
  await press("Retry download and save"); expect(f.createJob).toHaveBeenCalledTimes(1); expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.page.mock.calls.map((args) => args.slice(0, 3))).toEqual([["screen-snapshot", 0, 3], ["screen-snapshot", 0, 3]]);
});
it("shows uncertain cleanup without offering another Save or claiming the file was saved", async () => {
  await render(); await press("Prepare private Workouts export");
  f.cancel.mockRejectedValue(Object.assign(Error("Cleanup offline"), { status: 0 }));
  await press("Save complete private export");
  expect(button("Retry cancellation and cleanup")).toBeDefined(); expect(button("Save complete private export")).toBeUndefined();
  expect(JSON.stringify(renderer!.toJSON())).toContain("cleanup has not been acknowledged");
  expect(JSON.stringify(renderer!.toJSON())).toContain("cannot tell whether you saved");
});
it("does not select legacy fallback when a retained job exists but the capability later turns off", async () => {
  await render(); await press("Prepare private Workouts export");
  await act(async () => { renderer?.unmount(); }); renderer = null; cache.clear();
  f.capabilities.mockResolvedValue({ export_jobs: false }); await render();
  expect(button("Save complete private export")).toBeDefined(); expect(button("Export private Workouts JSON")).toBeUndefined();
  expect(f.createJob).toHaveBeenCalledTimes(1); expect(f.oldCreate).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
});
it("retains old 201 export behavior only after a known absent capability; discovery failure never falls back", async () => {
  f.capabilities.mockResolvedValue({}); f.oldCreate.mockResolvedValue(manifest);
  await render(); await press("Export private Workouts JSON");
  expect(f.oldCreate).toHaveBeenCalledWith(3); expect(f.oldDelete).toHaveBeenCalledWith("screen-snapshot", 3); expect(f.createJob).not.toHaveBeenCalled();
  await act(async () => { renderer?.unmount(); }); renderer = null; cache.clear();
  f.capabilities.mockRejectedValue(Error("No network")); await render();
  expect(button("Retry export availability")).toBeDefined(); expect(button("Export private Workouts JSON")).toBeUndefined();
  expect(f.oldCreate).toHaveBeenCalledTimes(1);
});
it("foreground polling is bounded and backgrounded screens do not send new requests or automatically recreate exports", async () => {
  vi.useFakeTimers();
  f.createJob.mockResolvedValue({ ...ready, status: "running", manifest: null }); f.job.mockResolvedValue({ ...ready, status: "running", manifest: null });
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(AccountData))); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  await act(async () => { button("Prepare private Workouts export").props.onPress(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(130000); });
  const checked = f.job.mock.calls.length;
  expect(checked).toBeGreaterThan(0); expect(checked).toBeLessThanOrEqual(30); expect(JSON.stringify(renderer!.toJSON())).toContain("Automatic checking paused");
  await act(async () => { f.active = "background"; f.changes.forEach((listener) => listener("background")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); }); expect(f.job).toHaveBeenCalledTimes(checked);
  await act(async () => { f.active = "active"; f.changes.forEach((listener) => listener("active")); });
  expect(f.createJob).toHaveBeenCalledTimes(1); expect(f.job).toHaveBeenCalledTimes(checked + 1); expect(f.save).not.toHaveBeenCalled();
});
it("recovers read-only after a remount while an aborted original admission is still settling", async () => {
  vi.useFakeTimers();
  let finish!: (receipt: ExportJob) => void;
  f.createJob.mockImplementation(() => new Promise<ExportJob>((resolve) => { finish = resolve; }));
  f.finishHeld = () => finish?.(ready);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const mount = () => create(createElement(QueryClientProvider, { client: cache }, createElement(AccountData)));
  await act(async () => { renderer = mount(); await vi.advanceTimersByTimeAsync(20); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  await act(async () => { button("Prepare private Workouts export").props.onPress(); });
  expect(f.createJob).toHaveBeenCalledTimes(1);
  await act(async () => { renderer?.unmount(); }); renderer = null;
  await act(async () => { renderer = mount(); await vi.advanceTimersByTimeAsync(20); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  expect(button("Prepare private Workouts export").props.disabled).toBe(true);
  await act(async () => { finish(ready); });
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(button("Save complete private export")).toBeDefined(); expect(f.createJob).toHaveBeenCalledTimes(1);
  expect(f.byRequest).toHaveBeenCalledWith("screen-request-1", 3, expect.any(AbortSignal)); expect(f.save).not.toHaveBeenCalled();
});
it("offers bounded original recovery after a held remount even when legacy capability is known", async () => {
  vi.useFakeTimers();
  let finish!: (receipt: ExportJob) => void;
  f.createJob.mockImplementation(() => new Promise<ExportJob>((resolve) => { finish = resolve; }));
  f.finishHeld = () => finish?.(ready);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const mount = () => create(createElement(QueryClientProvider, { client: cache }, createElement(AccountData)));
  await act(async () => { renderer = mount(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  await act(async () => { button("Prepare private Workouts export").props.onPress(); });
  expect(f.createJob).toHaveBeenCalledTimes(1);
  await act(async () => { renderer?.unmount(); }); renderer = null; cache.clear();
  f.capabilities.mockResolvedValue({ export_jobs: false });
  await act(async () => { renderer = mount(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(130000); });
  expect(button("Check original export recovery")).toBeDefined(); expect(button("Export private Workouts JSON")).toBeUndefined();
  expect(f.oldCreate).not.toHaveBeenCalled(); expect(f.createJob).toHaveBeenCalledTimes(1);
  await act(async () => { finish(ready); });
  await act(async () => { button("Check original export recovery").props.onPress(); });
  expect(button("Save complete private export")).toBeDefined(); expect(f.byRequest).toHaveBeenCalledWith("screen-request-1", 3, expect.any(AbortSignal));
  expect(f.oldCreate).not.toHaveBeenCalled(); expect(f.createJob).toHaveBeenCalledTimes(1); expect(f.save).not.toHaveBeenCalled();
});
