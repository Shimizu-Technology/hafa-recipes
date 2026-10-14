import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTrainingStore } from "./training";
import type { Workout } from "./models";

const fixture = vi.hoisted(() => ({ store: null as ReturnType<typeof createTrainingStore> | null,
  listeners: new Set<(state: string) => void>(), saveSession: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/context", async () => {
  const { useSyncExternalStore } = await import("react");
  const api = { sessions: async () => [], saveSession: fixture.saveSession };
  return { useTraining: () => ({ api, owner: "owner", units: "metric", enrollment: { enrolled: true, generation: 1 } }),
    useOfflineTraining: () => ({ store: fixture.store, state: useSyncExternalStore(fixture.store!.subscribe, fixture.store!.snapshot),
      ready: true, error: "", retry() {} }) };
});
vi.mock("@/components/reminders-provider", () => ({ useReminders: () => ({ state: { error: "", settings: { rest_enabled: false } } }) }));
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() }, Linking: { openURL: vi.fn() }, AppState: {
  addEventListener: (_event: string, listener: (state: string) => void) => {
    fixture.listeners.add(listener); return { remove: () => fixture.listeners.delete(listener) };
  },
} }));
vi.mock("expo-router", () => ({ router: { replace: fixture.replace, push: vi.fn() } }));
vi.mock("@/components/ui", () => ({ Screen: "Screen", Card: "Card", Copy: "Copy", Notice: "Notice", Button: "Button",
  Chip: "Chip", ChipRow: "ChipRow", Empty: "Empty", Field: "Field", IconButton: "IconButton", ListRow: "ListRow",
  RestTimer: "RestTimer", Row: "Row", SectionHeader: "SectionHeader", Segmented: "Segmented", SetRow: "SetRow", Sheet: "Sheet",
  formatClock: (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
  haptics: { light() {}, success() {} } }));
import Training from "../app/training";

let renderer: ReactTestRenderer | undefined, cache: QueryClient;
const workout: Workout = { id: "source", generation: 1, revision: 1, title: "Whole-source AMRAP", kind: "session", provenance: "source",
  blocks: [{ id: "main", label: "Circuit", grouping: "circuit", execution: { mode: "amrap", time_cap_seconds: 1200 },
    exercises: Array.from({ length: 9 }, (_, index) => ({ name: `Exercise ${index + 1}`, reps_min: 10 })) }] };
async function settle() { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); }
const footer = () => renderer!.root.findByType("Screen" as never).props.footer;
const text = () => renderer!.root.findAllByType("Copy" as never).map((node) => node.children.filter((child) => typeof child === "string").join("")).join("\n");
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(10000); fixture.listeners.clear(); fixture.replace.mockReset(); fixture.saveSession.mockReset();
  const memory = new Map<string, string>();
  fixture.store = createTrainingStore({ getItem: async (key) => memory.get(key) ?? null,
    setItem: async (key, value) => { memory.set(key, value); }, removeItem: async (key) => { memory.delete(key); } }, "owner", 1);
  await fixture.store.load(); await fixture.store.start(workout, { workout_id: "source", workout_revision: 1 }, "client");
  await fixture.store.activityType("strength_training");
  fixture.saveSession.mockImplementation(async (request) => ({ id: "saved", content: request }));
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Training))); }); await settle();
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; cache.clear(); vi.useRealTimers(); });

it("shows the typed cap and explicitly pauses once on background without counting time away", async () => {
  expect(text()).toContain("20:00 source time cap"); expect(footer().props.title).toBe("Log this exercise");
  const pause = vi.spyOn(fixture.store!, "pause");
  await act(async () => { fixture.listeners.forEach((listener) => { listener("inactive"); listener("background"); }); }); await settle();
  expect(pause).toHaveBeenCalledTimes(1); expect(fixture.store!.snapshot().active!.paused).toBe(true);
  await act(async () => { vi.advanceTimersByTime(60000); }); await settle();
  expect(fixture.store!.snapshot().active!.active_milliseconds).toBe(0);
  expect(footer().props.disabled).toBe(true); expect(text()).toContain("20:00");
});

it("expiry does not imply completion; actual work enables an explicit cap save and preserves the original source", async () => {
  await act(async () => {
    const reps = renderer!.root.findAllByType("Field" as never).find((node) => node.props.label === "Actual reps")!;
    reps.props.onChange("10");
  }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals).toHaveLength(1);
  await act(async () => { vi.setSystemTime(1210000); await fixture.store!.checkpoint(); }); await settle();
  expect(fixture.store!.snapshot().history).toEqual([]); expect(footer().props.title).toBe("Finish at time cap and save");
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().history[0].request).toMatchObject({ status: "completed", active_seconds: 1200 });
  expect(fixture.store!.snapshot().history[0].workout).toEqual(workout);
  expect(fixture.replace).toHaveBeenCalledWith("/(tabs)/progress");
});

it("an expired empty circuit still asks for actual work instead of offering a completed save", async () => {
  await act(async () => { vi.setSystemTime(1210000); await fixture.store!.checkpoint(); }); await settle();
  expect(footer().props.title).toBe("Log this exercise"); expect(footer().props.disabled).toBe(false);
  expect(fixture.store!.snapshot().history).toEqual([]);
});


it("a cap cannot silently discard an entered final exercise", async () => {
  const reps = () => renderer!.root.findAllByType("Field" as never).find((node) => node.props.label === "Actual reps")!;
  await act(async () => { reps().props.onChange("10"); }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  await act(async () => { reps().props.onChange("8"); }); await settle();
  await act(async () => { vi.setSystemTime(1210000); await fixture.store!.checkpoint(); }); await settle();
  expect(footer().props.title).toBe("Log this exercise");
  expect(fixture.store!.snapshot().history).toEqual([]);
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals.map((actual) => actual.reps)).toEqual([10, 8]);
  expect(footer().props.title).toBe("Finish at time cap and save");
});
