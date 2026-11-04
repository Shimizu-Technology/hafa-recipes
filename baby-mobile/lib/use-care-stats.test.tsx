import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState } from "./models";
import { answer, day } from "./care-stats-fixtures";
import type { StatsChoice } from "./care-stats";

const mock = vi.hoisted(() => ({ baby: null as any, appState: "active", listeners: new Set<(state: string) => void>() }));
vi.mock("react-native", () => ({ AppState: { get currentState() { return mock.appState; }, addEventListener: (_: string, listener: (state: string) => void) => { mock.listeners.add(listener); return { remove: () => mock.listeners.delete(listener) }; } } }));
vi.mock("expo-router", async () => { const { useEffect } = await import("react"); return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) }; });
vi.mock("./context", () => ({ useBaby: () => mock.baby }));
import { useCareStats } from "./use-care-stats";

const seven: StatsChoice = { range: "7d" }, rolling: StatsChoice = { range: "24h" };
let renderer: ReactTestRenderer | undefined, shown: ReturnType<typeof useCareStats>;
function Probe({ choice, child = "baby" }: { choice: StatsChoice | null; child?: string }) { shown = useCareStats(choice, child); return null; }
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
async function mount(choice: StatsChoice | null) { await act(async () => { renderer = create(<Probe choice={choice} />); }); await settle(); }
const careStats = () => mock.baby.api.careStats as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers({ now: new Date("2026-11-04T04:14:00Z") });
  mock.appState = "active"; mock.listeners.clear();
  mock.baby = { owner: "owner", state: { ...emptyState(), bootstrap: { generation: 1, profile: { timezone: "Pacific/Guam" } } }, api: { careStats: vi.fn(async () => answer([day("2026-11-04", true)], "24h")) } };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("keeps the time of its read, and has no error when it's fresh", async () => {
  await mount(seven);
  expect(shown.stats).toBeTruthy();
  expect(shown.error).toBeUndefined();
  expect(shown.fetchedAt).toEqual(new Date("2026-11-04T04:14:00Z"));
});
it("reads a rolling 24 hours again as the window moves, but only while the app is in front", async () => {
  await mount(rolling);
  expect(careStats()).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(careStats()).toHaveBeenCalledTimes(2);
  expect(shown.fetchedAt).toEqual(new Date("2026-11-04T04:15:00Z"));
  mock.appState = "background";
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(careStats()).toHaveBeenCalledTimes(2);
});
it("leaves calendar ranges alone between reads", async () => {
  await mount(seven);
  await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
  expect(careStats()).toHaveBeenCalledTimes(1);
});
it("reads again on coming back to the app, so numbers from hours ago don't sit there unmarked", async () => {
  await mount(seven);
  await act(async () => { for (const listener of mock.listeners) listener("active"); });
  await settle();
  expect(careStats()).toHaveBeenCalledTimes(2);
});
it("keeps the last numbers and their time when a read fails, with the reason", async () => {
  await mount(seven);
  const first = shown.stats;
  careStats().mockRejectedValueOnce(Error("You're offline."));
  await vi.setSystemTime(new Date("2026-11-04T05:00:00Z"));
  await act(async () => { await shown.refresh(); });
  expect(shown.stats).toBe(first);
  expect(shown.error).toBe("You're offline.");
  expect(shown.fetchedAt).toEqual(new Date("2026-11-04T04:14:00Z"));
});
it("has nothing to show for another baby's range, however fresh the last one was", async () => {
  await mount(seven);
  careStats().mockRejectedValueOnce(Error("You're offline."));
  await act(async () => { renderer!.update(<Probe choice={seven} child="sister" />); });
  await settle();
  expect(shown.stats).toBeUndefined();
  expect(shown.fetchedAt).toBeUndefined();
  expect(shown.error).toBe("You're offline.");
});
it("reads again when the queue changes, even if it's the same length", async () => {
  mock.baby.state = { ...mock.baby.state, outbox: [{ id: "one" }] };
  await mount(seven);
  mock.baby = { ...mock.baby, state: { ...mock.baby.state, outbox: [{ id: "two" }] } };
  await act(async () => { renderer!.update(<Probe choice={seven} />); });
  await settle();
  expect(careStats()).toHaveBeenCalledTimes(2);
});
it("doesn't show a time zone's old days after the family's clock changes", async () => {
  await mount(seven);
  careStats().mockImplementationOnce(() => new Promise(() => undefined));
  mock.baby = { ...mock.baby, state: { ...mock.baby.state, bootstrap: { generation: 1, profile: { timezone: "Asia/Tokyo" } } } };
  await act(async () => { renderer!.update(<Probe choice={seven} />); });
  expect(shown.stats).toBeUndefined();
});
