import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTrainingStore } from "./training";
import type { Workout } from "./models";

const fixture = vi.hoisted(() => ({ store: null as ReturnType<typeof createTrainingStore> | null,
  owner: "owner", generation: 1, current: true, storage: null as { isCurrent(): boolean } | null,
  listeners: new Set<(state: string) => void>(), writeFailure: false, saveSession: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/context", async () => {
  const { useSyncExternalStore } = await import("react");
  const api = { sessions: async () => [], saveSession: fixture.saveSession };
  return { useTraining: () => ({ api, owner: fixture.owner, units: "metric", enrollment: { enrolled: true, generation: fixture.generation },
    storage: fixture.storage, isCurrentAccount: () => fixture.current }),
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
  fixture.owner = "owner"; fixture.generation = 1; fixture.current = true; fixture.storage = { isCurrent: () => fixture.current };
  vi.useFakeTimers(); vi.setSystemTime(10000); fixture.writeFailure = false; fixture.listeners.clear(); fixture.replace.mockReset(); fixture.saveSession.mockReset();
  const memory = new Map<string, string>();
  fixture.store = createTrainingStore({ getItem: async (key) => memory.get(key) ?? null,
    setItem: async (key, value) => { if (fixture.writeFailure) throw Error("device write failed"); memory.set(key, value); }, removeItem: async (key) => { memory.delete(key); } }, "owner", 1);
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

const field = (label: string) => renderer!.root.findAllByType("Field" as never).find(node => node.props.label === label)!;
const action = (title: string) => renderer!.root.findAllByType("Button" as never).find(node => node.props.title === title)!;
const partial = () => renderer!.root.findAllByType("ListRow" as never).find(node => node.props.title === "Finish as partial session")!;
const finishSheet = () => renderer!.root.findAllByType("Sheet" as never).find(node => node.props.title === "Keep your current entry?")!;
async function recordedThenTyped() {
  await act(async () => { field("Actual reps").props.onChange("10"); }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  await act(async () => { action("Add load or feedback").props.onPress(); }); await settle();
  await act(async () => { field("Actual reps").props.onChange("8"); field("Set notes").props.onChange("Last effort"); }); await settle();
}
it("offers deliberate partial-finish choices and keeps typed details when training continues", async () => {
  await recordedThenTyped();
  await act(async () => { partial().props.onPress(); }); await settle();
  expect(finishSheet().props.visible).toBe(true);
  expect(fixture.store!.snapshot().history).toEqual([]);
  await act(async () => { action("Keep training").props.onPress(); }); await settle();
  expect(finishSheet().props.visible).toBe(false);
  expect(field("Actual reps").props.value).toBe("8");
  expect(fixture.store!.snapshot().active!.input).toMatchObject({ reps: "8", notes: "Last effort" });
});
it("logs the typed entry before finishing a partial session without duplicating after a failed finish", async () => {
  await recordedThenTyped();
  await act(async () => { partial().props.onPress(); }); await settle();
  const original = fixture.store!.finish;
  vi.spyOn(fixture.store!, "finish").mockRejectedValueOnce(Error("finish write interrupted"));
  await act(async () => { action("Log and finish").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals).toHaveLength(2);
  expect(fixture.store!.snapshot().active!.input).toEqual({});
  expect(fixture.store!.snapshot().history).toEqual([]);
  vi.mocked(fixture.store!.finish).mockImplementation(original);
  await act(async () => { action("Finish and save partial session").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().history[0].request).toMatchObject({ status: "partial", actuals: [{ reps: 10 }, { reps: 8, notes: "Last effort" }] });
  expect(fixture.replace).toHaveBeenCalledWith("/(tabs)/progress");
});
it("finishes without the unlogged entry only after explicit choice and retains it if persistence fails", async () => {
  await recordedThenTyped();
  await act(async () => { partial().props.onPress(); }); await settle();
  fixture.writeFailure = true;
  await act(async () => { action("Finish without this entry").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.input).toMatchObject({ reps: "8", notes: "Last effort" });
  expect(fixture.store!.snapshot().history).toEqual([]);
  fixture.writeFailure = false;
  await act(async () => { action("Finish without this entry").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().history[0].request.actuals).toHaveLength(1);
  expect(fixture.store!.snapshot().history[0].request.actuals[0].reps).toBe(10);
});
it("catches a same-turn typed value before the partial-finish handler or state render can lag", async () => {
  await act(async () => { field("Actual reps").props.onChange("10"); }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  const finish = partial().props.onPress;
  await act(async () => { field("Actual reps").props.onChange("9"); finish(); }); await settle();
  expect(finishSheet().props.visible).toBe(true);
  expect(fixture.store!.snapshot().history).toEqual([]);
});

it("keeps invalid unlogged actuals available to correct instead of finishing or discarding them", async () => {
  await recordedThenTyped();
  await act(async () => { field("Actual reps").props.onChange("-1"); partial().props.onPress(); }); await settle();
  await act(async () => { action("Log and finish").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().history).toEqual([]);
  expect(fixture.store!.snapshot().active!.actuals).toHaveLength(1);
  expect(field("Actual reps").props.value).toBe("-1");
  expect(finishSheet().props.visible).toBe(true);
});


it.each(["account", "session"] as const)("an old partial finish cannot navigate or sync after its %s is replaced", async changed => {
  await recordedThenTyped();
  await act(async () => { partial().props.onPress(); }); await settle();
  const oldStore = fixture.store!, finish = oldStore.finish;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(oldStore, "finish").mockImplementation(async (...args) => { await finish(...args); await held; });
  const oldSync = vi.spyOn(oldStore, "sync");
  await act(async () => { action("Finish without this entry").props.onPress(); }); await settle();
  const memory = new Map<string, string>();
  const replacement = changed === "session" ? oldStore : createTrainingStore({ getItem: async key => memory.get(key) ?? null,
    setItem: async (key, value) => { memory.set(key, value); }, removeItem: async key => { memory.delete(key); } }, "other", 1);
  await replacement.load(); await replacement.start(workout, { workout_id: "source", workout_revision: 1 }, "replacement");
  await replacement.input({ reps: "6" });
  if (changed === "account") { fixture.owner = "other"; fixture.storage = { isCurrent: () => true }; }
  fixture.store = replacement;
  await act(async () => { renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(Training))); }); await settle();
  expect(field("Actual reps").props.value).toBe("6");
  await act(async () => { release(); }); await settle();
  expect(fixture.replace).not.toHaveBeenCalled(); expect(oldSync).not.toHaveBeenCalled();
  expect(replacement.snapshot().active!.input).toEqual({ reps: "6" });
  expect(footer().props.busy).toBe(false);
});


it("an old logged entry acknowledgement cannot clear a newer same-store session input", async () => {
  await recordedThenTyped();
  await act(async () => { partial().props.onPress(); }); await settle();
  const store = fixture.store!, log = store.log;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(store, "log").mockImplementation(async actual => { await log(actual); await held; });
  await act(async () => { action("Log and finish").props.onPress(); }); await settle();
  expect(store.snapshot().active!.actuals).toHaveLength(2);
  await act(async () => {
    await store.discard();
    await store.start(workout, { workout_id: "source", workout_revision: 1 }, "replacement-after-log");
    await store.input({ reps: "6", notes: "New session entry" });
  }); await settle();
  expect(field("Actual reps").props.value).toBe("6");
  await act(async () => { release(); }); await settle();
  expect(field("Actual reps").props.value).toBe("6");
  expect(store.snapshot().active!.input).toEqual({ reps: "6", notes: "New session entry" });
  expect(store.snapshot().active!.actuals).toEqual([]);
  expect(fixture.replace).not.toHaveBeenCalled(); expect(fixture.saveSession).not.toHaveBeenCalled();
});


it("a delayed log acknowledgement preserves the next cursor's edited reps and notes", async () => {
  await recordedThenTyped();
  const store = fixture.store!, log = store.log;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(store, "log").mockImplementation(async actual => { await log(actual); await held; });
  const session = store.snapshot().active!.id, cursor = store.snapshot().active!.cursor;
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(store.snapshot().active!.id).toBe(session);
  expect(store.snapshot().active!.cursor).toBe(cursor + 1);
  await act(async () => { action("Add load or feedback").props.onPress(); }); await settle();
  await act(async () => { field("Actual reps").props.onChange("6"); field("Set notes").props.onChange("Next cursor entry"); }); await settle();
  expect(store.snapshot().active!.input).toMatchObject({ reps: "6", notes: "Next cursor entry" });
  await act(async () => { release(); }); await settle();
  expect(field("Actual reps").props.value).toBe("6");
  expect(field("Set notes").props.value).toBe("Next cursor entry");
  expect(store.snapshot().active!.input).toMatchObject({ reps: "6", notes: "Next cursor entry" });
  // Use the retained UI ref on the next real log, not merely persisted state.
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(store.snapshot().active!.actuals.at(-1)).toMatchObject({ reps: 6, notes: "Next cursor entry" });
});
