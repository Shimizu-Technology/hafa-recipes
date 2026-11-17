import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import type { TrainingStore } from "./training";
const f = vi.hoisted(() => ({ epoch: 0, listeners: [] as Array<() => void>, pending: vi.fn(async () => []), setPlans: vi.fn(),
  token: 0, resync: new Set<() => void>(), saves: vi.fn(), catalog: {} as Record<string, unknown>, remove: vi.fn() }));
vi.mock("react-native", () => ({ AppState: { currentState: "active", addEventListener: () => ({ remove: f.remove }) } }));
vi.mock("./watch-native", () => ({ watchPlansEpoch: () => f.epoch, watchResyncToken: () => f.token,
  subscribeWatchResync: (listener: () => void) => { f.resync.add(listener); return () => { f.resync.delete(listener); }; }, nativeWatchBridge: async () => ({
  pendingResults: f.pending, setPlans: f.setPlans, markImported: vi.fn(), addListener: () => ({ remove: f.remove }),
}) }));
const context = { api: { library: (): unknown[] => [], programs: () => [], profile: () => ({ timezone: "UTC" }) }, owner: "A",
  enrollment: { generation: 1, enrolled: true }, units: "metric", isCurrentAccount: () => true, storage: { isCurrent: () => true },
  localDrafts: { load: async () => f.catalog, save: async (_owner: string, _key: string, value: Record<string, unknown>) => { f.catalog = value; f.saves(); } } };
vi.mock("./context", () => ({ useTraining: () => context }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryFn }: { queryFn(): unknown }) => ({ data: queryFn() }) }));
import { useWatchSync } from "./use-watch-sync";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.useRealTimers());
it("debounces store bursts, skips identical contexts and refuses stale writes after clearing plans", async () => {
  vi.useFakeTimers(); f.pending.mockClear(); f.setPlans.mockClear(); f.catalog = {}; f.saves.mockClear();
  // Stable query objects model React Query's structural sharing.
  const library = [{ id: "w", revision: 1, generation: 1, title: "Class", kind: "session", provenance: "user", blocks: [], programming: { source_kind: "gym", date: new Date().toISOString().slice(0, 10) } }], programs: never[] = [], profile = { timezone: "UTC" };
  context.api.library = () => library; context.api.programs = () => programs; context.api.profile = () => profile;
  const store = { snapshot: () => ({ version: 1, generation: 1, history: [], active: null }), getLeadIn: () => 3,
    subscribe: (fn: () => void) => { f.listeners.push(fn); return () => { f.listeners = f.listeners.filter(x => x !== fn); }; } } as unknown as TrainingStore;
  function Harness() { useWatchSync(store, true); return null; }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Harness)); });
  for (let i = 0; i < 20; i++) f.listeners.forEach(fn => fn());
  await act(async () => { await vi.advanceTimersByTimeAsync(299); }); expect(f.pending).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(f.pending).toHaveBeenCalledOnce(); expect(f.setPlans).toHaveBeenCalledOnce();
  f.listeners.forEach(fn => fn());
  await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(f.pending).toHaveBeenCalledTimes(2); expect(f.setPlans).toHaveBeenCalledOnce();
  expect(f.saves).toHaveBeenCalledOnce();
  f.epoch++; f.listeners.forEach(fn => fn());
  await act(async () => { await vi.advanceTimersByTimeAsync(300); }); expect(f.pending).toHaveBeenCalledTimes(2);
  // Failed sign-out resumes the same mounted account. A later store change sends plans again.
  await act(async () => { f.token++; f.resync.forEach(fn => fn()); });
  f.listeners.forEach(fn => fn());
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(f.setPlans).toHaveBeenCalledTimes(2);
  // Successful local erase changes the storage lease even when server deletion fails.
  f.epoch++;
  context.storage = { isCurrent: () => true };
  await act(async () => tree.update(createElement(Harness)));
  f.listeners.forEach(fn => fn());
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(f.setPlans).toHaveBeenCalledTimes(3);
  await act(async () => tree.unmount()); expect(f.listeners).toHaveLength(0);
});
