import { Children, createElement, isValidElement, type ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTrainingStore } from "./training";
import type { Workout } from "./models";

const fixture = vi.hoisted(() => ({ store: null as ReturnType<typeof createTrainingStore> | null,
  fontScale: 1,
  owner: "owner", generation: 1, current: true, storage: null as { isCurrent(): boolean } | null,
  listeners: new Set<(state: string) => void>(), writeFailure: false, saveSession: vi.fn(), replace: vi.fn(), dismiss: vi.fn(), success: vi.fn(), announce: vi.fn() }));
vi.mock("@/lib/context", async () => {
  const { useSyncExternalStore } = await import("react");
  const api = { sessions: async () => [], saveSession: fixture.saveSession };
  return { useTraining: () => ({ api, owner: fixture.owner, units: "metric", enrollment: { enrolled: true, generation: fixture.generation },
    storage: fixture.storage, isCurrentAccount: () => fixture.current }),
    useOfflineTraining: () => ({ store: fixture.store, state: useSyncExternalStore(fixture.store!.subscribe, fixture.store!.snapshot),
      ready: true, error: "", retry() {} }) };
});
vi.mock("@/components/reminders-provider", () => ({ useReminders: () => ({ state: { error: "", settings: { rest_enabled: false } } }) }));
vi.mock("react-native", () => ({ useWindowDimensions: () => ({ width: 390, fontScale: fixture.fontScale }), View: "View", Alert: { alert: vi.fn() }, Linking: { openURL: vi.fn() }, Keyboard: { dismiss: fixture.dismiss }, AppState: {
  addEventListener: (_event: string, listener: (state: string) => void) => {
    fixture.listeners.add(listener); return { remove: () => fixture.listeners.delete(listener) };
  },
} }));
vi.mock("expo-router", () => ({ router: { replace: fixture.replace, push: vi.fn() } }));
vi.mock("@/components/ui", () => ({ Screen: "Screen", Card: "Card", Copy: "Copy", Notice: "Notice", Button: "Button",
  Chip: "Chip", ChipRow: "ChipRow", Empty: "Empty", Field: "Field", IconButton: "IconButton", ListRow: "ListRow",
  RestTimer: "RestTimer", Row: "Row", SectionHeader: "SectionHeader", Segmented: "Segmented", SetRow: "SetRow", Sheet: "Sheet", StatTile: "StatTile",
  formatClock: (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
  ListGroup: "ListGroup", Stack: "Stack", haptics: { light() {}, tick() {}, success: fixture.success } }));
vi.mock("@/components/training/number-stepper", () => ({ NumberStepper: "NumberStepper" }));
vi.mock("@/components/training/set-entry", () => ({ SetNumberField: "SetNumberField" }));
vi.mock("@/components/training/session-parts", () => ({ LastLogged: "LastLogged", RestDone: "RestDone", SetProgress: "SetProgress",
  announce: fixture.announce }));
import Training from "../app/training";
import { WorkoutStartSheet } from "../components/workout-start-sheet";

let renderer: ReactTestRenderer | undefined, cache: QueryClient;
const workout: Workout = { id: "source", generation: 1, revision: 1, title: "Whole-source AMRAP", kind: "session", provenance: "source",
  blocks: [{ id: "main", label: "Circuit", grouping: "circuit", execution: { mode: "amrap", time_cap_seconds: 1200 },
    exercises: Array.from({ length: 9 }, (_, index) => ({ name: `Exercise ${index + 1}`, reps_min: 10 })) }] };
async function settle() { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); }
const footer = () => Children.toArray(renderer!.root.findByType("Screen" as never).props.footer.props.children)
  .find(child => isValidElement(child) && child.type === ("Button" as never)) as ReactElement<{ title: string; disabled: boolean; busy: boolean; onPress(): void }>;
const text = () => renderer!.root.findAllByType("Copy" as never).map((node) => node.children.filter((child) => typeof child === "string").join("")).join("\n");
beforeEach(async () => {
  fixture.fontScale = 1;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.owner = "owner"; fixture.generation = 1; fixture.current = true; fixture.storage = { isCurrent: () => fixture.current };
  vi.useFakeTimers(); vi.setSystemTime(10000); fixture.writeFailure = false; fixture.listeners.clear(); fixture.replace.mockReset(); fixture.saveSession.mockReset();
  fixture.dismiss.mockReset(); fixture.success.mockReset(); fixture.announce.mockReset();
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
  expect(text()).toContain("20:00 time cap"); expect(footer().props.title).toBe("Log exercise");
  const pause = vi.spyOn(fixture.store!, "pause");
  await act(async () => { fixture.listeners.forEach((listener) => { listener("inactive"); listener("background"); }); }); await settle();
  expect(pause).toHaveBeenCalledTimes(1); expect(fixture.store!.snapshot().active!.paused).toBe(true);
  await act(async () => { vi.advanceTimersByTime(60000); }); await settle();
  expect(fixture.store!.snapshot().active!.active_milliseconds).toBe(0);
  expect(footer().props.disabled).toBe(true); expect(text()).toContain("20:00");
});

it("expiry does not imply completion; actual work enables an explicit cap save and preserves the original source", async () => {
  await act(async () => {
    const reps = renderer!.root.findAllByType("SetNumberField" as never).find((node) => node.props.label === "Reps")!;
    reps.props.onChange("10");
  }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals).toHaveLength(1);
  await act(async () => { vi.setSystemTime(1210000); await fixture.store!.checkpoint(); }); await settle();
  expect(fixture.store!.snapshot().history).toEqual([]); expect(footer().props.title).toBe("Finish at time cap and save");
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().history[0].request).toMatchObject({ status: "completed", active_seconds: 1200 });
  expect(fixture.store!.snapshot().history[0].workout).toEqual(workout);
  expect(fixture.replace).not.toHaveBeenCalled();
  expect(renderer!.root.findAllByType("StatTile" as never).map((tile) => [tile.props.label, tile.props.value]))
    .toEqual([["Set logged", 1], ["Exercise", 1], ["Active time", 20]]);
  await act(async () => { done().props.onPress(); }); await settle();
  expect(fixture.replace).toHaveBeenCalledWith("/(tabs)/progress");
});

it("an expired empty circuit still asks for actual work instead of offering a completed save", async () => {
  await act(async () => { vi.setSystemTime(1210000); await fixture.store!.checkpoint(); }); await settle();
  expect(footer().props.title).toBe("Log exercise"); expect(footer().props.disabled).toBe(false);
  expect(fixture.store!.snapshot().history).toEqual([]);
});


it("a cap cannot silently discard an entered final exercise", async () => {
  const reps = () => renderer!.root.findAllByType("SetNumberField" as never).find((node) => node.props.label === "Reps")!;
  await act(async () => { reps().props.onChange("10"); }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  await act(async () => { reps().props.onChange("8"); }); await settle();
  await act(async () => { vi.setSystemTime(1210000); await fixture.store!.checkpoint(); }); await settle();
  expect(footer().props.title).toBe("Log exercise");
  expect(fixture.store!.snapshot().history).toEqual([]);
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals.map((actual) => actual.reps)).toEqual([10, 8]);
  expect(footer().props.title).toBe("Finish at time cap and save");
});

const field = (label: string) => [...renderer!.root.findAllByType("Field" as never), ...renderer!.root.findAllByType("SetNumberField" as never)]
  .find(node => node.props.label === label)!;
const done = () => renderer!.root.findByType("Screen" as never).props.footer;
function footerAction(title: string) {
  function find(children: unknown): ReactElement<{ title: string; disabled: boolean; busy: boolean; onPress(): void }> | undefined {
    for (const child of Children.toArray(children as never)) {
      if (!isValidElement<{ title?: string; children?: unknown }>(child)) continue;
      if (child.type === ("Button" as never) && child.props.title === title) return child as never;
      const nested = find(child.props.children);
      if (nested) return nested;
    }
  }
  return find(renderer!.root.findByType("Screen" as never).props.footer);
}
const action = (title: string) => renderer!.root.findAllByType("Button" as never).find(node => node.props.title === title) ?? footerAction(title)!;
const partial = () => action("Finish");
const notesAndFeel = () => renderer!.root.findAllByType("ListRow" as never).find(node => node.props.title === "Notes & feel")!;
const sheet = (title: string) => renderer!.root.findAllByType("Sheet" as never).find(node => node.props.title === title)!;
const finishSheet = () => renderer!.root.findAllByType("Sheet" as never).find(node => node.props.title === "Keep your current entry?")!;
async function recordedThenTyped() {
  await act(async () => { field("Reps").props.onChange("10"); }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  await act(async () => { notesAndFeel().props.onPress(); }); await settle();
  expect(sheet("Notes & feel").props.visible).toBe(true);
  await act(async () => { field("Reps").props.onChange("8"); field("Set notes").props.onChange("Last effort"); }); await settle();
}
it("asks for the missing activity in the partial-save sheet even without an unlogged entry", async () => {
  await act(async () => {
    await fixture.store!.discard();
    await fixture.store!.start(workout, { workout_id: "source", workout_revision: 1 }, "new-client");
  }); await settle();
  await act(async () => { field("Reps").props.onChange("10"); }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  await act(async () => { partial().props.onPress(); }); await settle();
  expect(renderer!.root.findAllByType("Sheet" as never).find(node => node.props.title === "Save partial session")!.props.visible).toBe(true);
  expect(fixture.store!.snapshot().history).toHaveLength(0);
  const activity = renderer!.root.findAllByType("Chip" as never).filter(node => node.props.label === "General fitness").at(-1)!;
  await act(async () => { activity.props.onPress(); }); await settle();
  await act(async () => { action("Finish and save partial session").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().history[0].request).toMatchObject({ status: "partial", activity_type: "general_fitness", actuals: [{ reps: 10 }] });
});
it("offers deliberate partial-finish choices and keeps typed details when training continues", async () => {
  await recordedThenTyped();
  await act(async () => { partial().props.onPress(); }); await settle();
  expect(finishSheet().props.visible).toBe(true);
  expect(fixture.store!.snapshot().history).toEqual([]);
  await act(async () => { action("Keep training").props.onPress(); }); await settle();
  expect(finishSheet().props.visible).toBe(false);
  expect(field("Reps").props.value).toBe("8");
  expect(fixture.store!.snapshot().active!.input).toMatchObject({ reps: "8", notes: "Last effort" });
});

it("opens instructions directly after the final set without transitioning between native sheets", async () => {
  const fixed: Workout = { ...workout, instructions: ["Rest between rounds"], blocks: [{
    id: "main", label: "Session", grouping: "sequential", exercises: [{ name: "Squat", sets: 1, reps_min: 8 }],
  }] };
  await act(async () => {
    await fixture.store!.discard();
    await fixture.store!.start(fixed, { workout_id: "source", workout_revision: 1 }, "fixed-client");
  }); await settle();
  await act(async () => { field("Reps").props.onChange("8"); }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.cursor).toBe(1);
  await act(async () => { action("Workout instructions").props.onPress(); }); await settle();
  expect(renderer!.root.findAllByType("Sheet" as never).find(node => node.props.title === "Workout instructions")!.props.visible).toBe(true);
  expect(renderer!.root.findAllByType("Sheet" as never).find(node => node.props.title === "Session")!.props.visible).toBe(false);
  expect(text()).toContain("Rest between rounds");
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
  expect(renderer!.root.findByType("Screen" as never).props.title).toBe("Partial session saved");
  await act(async () => { done().props.onPress(); }); await settle();
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
  await act(async () => { field("Reps").props.onChange("10"); }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  const finish = partial().props.onPress;
  await act(async () => { field("Reps").props.onChange("9"); finish(); }); await settle();
  expect(finishSheet().props.visible).toBe(true);
  expect(fixture.store!.snapshot().history).toEqual([]);
});

it("keeps invalid unlogged actuals available to correct instead of finishing or discarding them", async () => {
  await recordedThenTyped();
  await act(async () => { field("Reps").props.onChange("-1"); partial().props.onPress(); }); await settle();
  await act(async () => { action("Log and finish").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().history).toEqual([]);
  expect(fixture.store!.snapshot().active!.actuals).toHaveLength(1);
  expect(field("Reps").props.value).toBe("-1");
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
  expect(field("Reps").props.value).toBe("6");
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
  expect(field("Reps").props.value).toBe("6");
  await act(async () => { release(); }); await settle();
  expect(field("Reps").props.value).toBe("6");
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
  await act(async () => { notesAndFeel().props.onPress(); }); await settle();
  expect(sheet("Notes & feel").props.visible).toBe(true);
  await act(async () => { field("Reps").props.onChange("6"); field("Set notes").props.onChange("Next cursor entry"); }); await settle();
  expect(store.snapshot().active!.input).toMatchObject({ reps: "6", notes: "Next cursor entry" });
  await act(async () => { release(); }); await settle();
  expect(field("Reps").props.value).toBe("6");
  expect(field("Set notes").props.value).toBe("Next cursor entry");
  expect(store.snapshot().active!.input).toMatchObject({ reps: "6", notes: "Next cursor entry" });
  // Use the retained UI ref on the next real log, not merely persisted state.
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(store.snapshot().active!.actuals.at(-1)).toMatchObject({ reps: 6, notes: "Next cursor entry" });
});

const squats: Workout = { ...workout, provenance: "user", blocks: [{ id: "main", label: "Main", grouping: "sequential",
  exercises: [{ name: "Squat", sets: 2, reps_min: 8, reps_max: 10, rest_seconds: 60 }] }] };
let squatSession = 0;
async function startSquats() {
  await act(async () => {
    await fixture.store!.discard();
    await fixture.store!.start(squats, { workout_id: "source", workout_revision: 1 }, `squats-${++squatSession}`);
  }); await settle();
}
const restDone = () => renderer!.root.findAllByType("RestDone" as never);
it("logs the prescribed reps in one tap, then confirms, rests, signals rest done once and can undo", async () => {
  await startSquats();
  expect(field("Reps").props.value).toBe("8");
  expect(text()).toContain("Set 1 of 2");
  expect(fixture.store!.snapshot().active!.input ?? {}).toEqual({});
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals).toMatchObject([{ reps: 8, completed: true }]);
  expect(fixture.dismiss).toHaveBeenCalled();
  expect(fixture.announce).toHaveBeenCalledWith("Logged Squat. 8 reps");
  expect(renderer!.root.findByType("LastLogged" as never).props.title).toBe("Logged · Squat, set 1");
  expect(renderer!.root.findAllByType("RestTimer" as never)).toHaveLength(1);
  expect(field("Reps").props.value).toBe("8");
  await act(async () => { vi.advanceTimersByTime(61000); }); await settle();
  expect(renderer!.root.findAllByType("RestTimer" as never)).toHaveLength(0);
  expect(restDone()).toHaveLength(1);
  await act(async () => { vi.advanceTimersByTime(1000); }); await settle();
  expect(fixture.success).toHaveBeenCalledTimes(1);
  expect(fixture.announce).toHaveBeenCalledWith("Rest done");
  // Returning to the screen inside the "Rest done" window does not alert again.
  await act(async () => { renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement("View"))); }); await settle();
  await act(async () => { renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(Training))); }); await settle();
  expect(restDone()).toHaveLength(1);
  expect(fixture.success).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(3000); }); await settle();
  expect(restDone()).toHaveLength(0);
  await act(async () => { renderer!.root.findByType("LastLogged" as never).props.onUndo(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals).toEqual([]);
  const skip = renderer!.root.findAllByType("ListRow" as never).find((row) => row.props.title === "Skip this set")!;
  await act(async () => { skip.props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals).toMatchObject([{ completed: false, reps: null }]);
});
it("keeps a cleared value blank instead of restoring the prefill", async () => {
  await startSquats();
  await act(async () => { field("Reps").props.onChange(""); }); await settle();
  expect(field("Reps").props.value).toBe("");
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals).toEqual([]);
  expect(renderer!.root.findByType("Screen" as never).props.footer.props.children[0].props.children)
    .toBe("Record actual reps, time or distance before completing a set.");
});
it("saves a finished session with the inferred activity and summarises it before Progress", async () => {
  await startSquats();
  await act(async () => { footer().props.onPress(); }); await settle();
  await act(async () => { field("Reps").props.onChange("9"); }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(footer().props.title).toBe("Finish and save session");
  expect(renderer!.root.findAllByType("Chip" as never).find((chip) => chip.props.selected)!.props.label).toBe("Strength training");
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().history[0].request).toMatchObject({ status: "completed", activity_type: "strength_training",
    actuals: [{ reps: 8 }, { reps: 9 }] });
  expect(renderer!.root.findAllByType("StatTile" as never).map((tile) => tile.props.value).slice(0, 2)).toEqual([2, 1]);
  expect(fixture.replace).not.toHaveBeenCalled();
  await act(async () => { done().props.onPress(); }); await settle();
  expect(fixture.replace).toHaveBeenCalledWith("/(tabs)/progress");
});
it("ending rest early stays silent", async () => {
  await startSquats();
  await act(async () => { footer().props.onPress(); }); await settle();
  await act(async () => { renderer!.root.findByType("RestTimer" as never).props.onSkip(); }); await settle();
  await act(async () => { vi.advanceTimersByTime(65000); }); await settle();
  expect(restDone()).toHaveLength(0);
  expect(fixture.success).not.toHaveBeenCalled();
  expect(fixture.announce).not.toHaveBeenCalledWith("Rest done");
});
it("a partial finish saves only logged sets, never the untouched prefill, and a failed finish stores no activity", async () => {
  await startSquats();
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(field("Reps").props.value).toBe("8");
  await act(async () => { partial().props.onPress(); }); await settle();
  expect(renderer!.root.findAllByType("Sheet" as never).find(node => node.props.title === "Save partial session")!.props.visible).toBe(true);
  fixture.writeFailure = true;
  await act(async () => { action("Finish and save partial session").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().history).toEqual([]);
  expect(fixture.store!.snapshot().active!.activity_type).toBeNull();
  fixture.writeFailure = false;
  await act(async () => { action("Finish and save partial session").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().history[0].request).toMatchObject({ status: "partial", activity_type: "strength_training" });
  expect(fixture.store!.snapshot().history[0].request.actuals).toHaveLength(1);
});

const rows = (title: string) => renderer!.root.findAllByType("ListRow" as never).filter(node => node.props.title === title);
it("offers another round only for open-ended sessions, both mid-session and at the end", async () => {
  expect(rows("Add another round")).toHaveLength(0);
  await act(async () => { await fixture.store!.discard(); }); await settle();
  const open: Workout = { ...workout, id: "open", title: "Kettlebell E2MOM ladder", blocks: [{ id: "main", label: "Ladder", grouping: "circuit",
    exercises: [{ name: "Swing", reps_min: 10 }, { name: "Goblet squat", reps_min: 5 }] }] };
  await act(async () => { await fixture.store!.start(open, { workout_id: "open", workout_revision: 1 }, "open", Date.now(), { log_as_you_go: true }); }); await settle();
  expect(rows("Add another round")).toHaveLength(1);
  await act(async () => { rows("Add another round")[0].props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.steps.map(step => step.round_index)).toEqual([1, 1, 2, 2]);
  for (const reps of ["10", "5", "10", "5"]) {
    await act(async () => { field("Reps").props.onChange(reps); }); await settle();
    await act(async () => { footer().props.onPress(); }); await settle();
  }
  await act(async () => { action("Add another round").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.steps).toHaveLength(6);
  expect(fixture.store!.snapshot().active!.cursor).toBe(4);
});

it("the start sheet logs as you go, starts a bounded round count, or opens the editor", async () => {
  const onStart = vi.fn(), onEdit = vi.fn();
  await act(async () => renderer!.unmount());
  await act(async () => { renderer = create(createElement(WorkoutStartSheet, { visible: true, busy: false, onClose() {}, onStart, onEdit })); });
  const icon = (label: string) => renderer!.root.findAllByType("IconButton" as never).find(node => node.props.label === label)!;
  await act(async () => rows("Log as I go")[0].props.onPress());
  expect(onStart).toHaveBeenLastCalledWith({ log_as_you_go: true });
  expect(action("Start 3 rounds")).toBeDefined();
  for (let i = 0; i < 3; i++) await act(async () => icon("Fewer rounds").props.onPress());
  expect(icon("Fewer rounds").props.disabled).toBe(true);
  await act(async () => icon("More rounds").props.onPress());
  await act(async () => action("Start 2 rounds").props.onPress());
  expect(onStart).toHaveBeenLastCalledWith({ rounds: 2 });
  await act(async () => rows("Edit workout")[0].props.onPress());
  expect(onEdit).toHaveBeenCalledOnce();
  expect(rows("Edit workout")[0].props.detail).toBe("Add sets and reps first");
  await act(async () => renderer!.update(createElement(WorkoutStartSheet, { visible: true, busy: false, timedParts: true, onClose() {}, onStart, onEdit })));
  expect(rows("Edit workout")[0].props.detail).toBe("Split the timed parts first");
  expect(text()).toContain("more than one timed part");
  await act(async () => renderer!.unmount()); renderer = undefined;
});
const kettlebell: Workout = { ...workout, provenance: "user", blocks: [{ id: "main", label: "Main", grouping: "sequential",
  exercises: [{ name: "Goblet squat", sets: 3, reps_min: 10, load: 16, load_unit: "kg", load_convention: "total" }] }] };
async function startKettlebell() {
  await act(async () => {
    await fixture.store!.discard();
    await fixture.store!.start(kettlebell, { workout_id: "source", workout_revision: 1 }, `kb-${++squatSession}`);
  }); await settle();
}
it("shows reps and weight side by side on every set, with no expansion to repeat", async () => {
  await startKettlebell();
  expect(renderer!.root.findByType("Screen" as never).props.title).toBe("Goblet squat");
  expect(field("Reps").props.value).toBe("10"); expect(field("Weight · kg").props.value).toBe("16");
  await act(async () => { field("Weight · kg").props.onChange("20"); }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(footer().props.title).toBe("Log set");
  expect(fixture.store!.snapshot().active!.actuals[0]).toMatchObject({ reps: 10, load: 20, load_unit: "kg", load_convention: "total" });
  // The next set keeps the weight on screen, prefilled from the set just logged.
  expect(field("Weight · kg").props.value).toBe("20");
  expect(text()).toContain("Set 2 of 3");
});
it("logs typed weight on a bodyweight exercise as total weight unless another kind is chosen", async () => {
  await startSquats();
  expect(field("Weight · kg").props.value).toBe("");
  await act(async () => { field("Weight · kg").props.onLabelPress(); }); await settle();
  expect(sheet("Weight").props.visible).toBe(true);
  await act(async () => { field("Weight · kg").props.onChange("12"); }); await settle();
  const perHand = renderer!.root.findAllByType("Chip" as never).find((chip) => chip.props.label === "Per hand")!;
  await act(async () => { perHand.props.onPress(); }); await settle();
  expect(field("Weight · kg").props.note).toBe("Per hand");
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals[0]).toMatchObject({ reps: 8, load: 12, load_convention: "per_hand" });
});
it("changes what to record from the field label instead of a switch on every set", async () => {
  await startSquats();
  expect(renderer!.root.findAllByType("Segmented" as never).filter((node) => node.props.label === "What to record")
    .every((node) => sheet("What to record").findAllByType("Segmented" as never).includes(node))).toBe(true);
  await act(async () => { field("Reps").props.onLabelPress(); }); await settle();
  expect(sheet("What to record").props.visible).toBe(true);
  const segmented = sheet("What to record").findByType("Segmented" as never);
  await act(async () => { segmented.props.onChange("time"); }); await settle();
  expect(sheet("What to record").props.visible).toBe(false);
  await act(async () => { field("Time · sec").props.onChange("45"); }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals[0]).toMatchObject({ duration_seconds: 45, reps: null });
});
it("asks about pain plainly in Notes & feel and saves the answers with the set", async () => {
  await startSquats();
  await act(async () => { notesAndFeel().props.onPress(); }); await settle();
  expect(text()).toContain("Any pain?");
  const chip = (label: string) => sheet("Notes & feel").findAllByType("Chip" as never).find((node) => node.props.label === label)!;
  expect(chip("Yes")).toBeDefined(); expect(chip("No")).toBeDefined();
  await act(async () => { chip("Yes").props.onPress(); chip("Hard").props.onPress(); field("Effort · 0 to 10").props.onChange("8"); }); await settle();
  expect(notesAndFeel().props.detail).toBe("Effort 8/10 · Hard · Pain");
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals[0]).toMatchObject({ pain_reported: true, difficulty: "hard", effort: 8 });
  expect(notesAndFeel().props.detail).toBe("Effort, how it felt, any pain");
});
it("shows every set from last time on one line", async () => {
  await startKettlebell();
  for (const reps of ["10", "10", "8"]) {
    await act(async () => { field("Reps").props.onChange(reps); }); await settle();
    await act(async () => { footer().props.onPress(); }); await settle();
  }
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().history).toHaveLength(1);
  await act(async () => { await fixture.store!.start(kettlebell, { workout_id: "source", workout_revision: 1 }, "kb-again"); }); await settle();
  expect(text()).toContain("Last time · 10, 10, 8 @ 16 kg");
});
it("saves only the measure on screen and keeps the weight kind on skipped sets", async () => {
  const dumbbells: Workout = { ...workout, provenance: "user", blocks: [{ id: "main", label: "Main", grouping: "sequential",
    exercises: [{ name: "Curl", sets: 3, reps_min: 10, load_convention: "per_hand" }] }] };
  await act(async () => {
    await fixture.store!.discard();
    await fixture.store!.start(dumbbells, { workout_id: "source", workout_revision: 1 }, "dumbbells");
  }); await settle();
  await act(async () => { field("Reps").props.onChange("12"); field("Weight · kg").props.onChange("10"); }); await settle();
  expect(field("Weight · kg").props.note).toBe("Per hand");
  await act(async () => { field("Reps").props.onLabelPress(); }); await settle();
  await act(async () => { sheet("What to record").findByType("Segmented" as never).props.onChange("time"); }); await settle();
  await act(async () => { field("Time · sec").props.onChange("40"); }); await settle();
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals[0]).toMatchObject({ reps: null, duration_seconds: 40, load: 10, load_convention: "per_hand" });
  await act(async () => { field("Weight · kg").props.onChange("12"); }); await settle();
  const skip = renderer!.root.findAllByType("ListRow" as never).find((row) => row.props.title === "Skip this set")!;
  await act(async () => { skip.props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals[1]).toMatchObject({ completed: false, load: 12, load_unit: "kg", load_convention: "per_hand" });
});

it.each([
  ["circuit", 5, undefined, false],
  ["circuit", 1, undefined, false],
  ["superset", 3, undefined, false],
  ["sequential", undefined, 3, false],
  ["sequential", undefined, undefined, true],
  ["circuit", undefined, undefined, true],
] as const)("shows the open-ended hint only without sets or rounds (%s, %s, %s)", async (grouping, rounds, sets, showHint) => {
  const fixed: Workout = { ...workout, blocks: [{ id: "main", label: "Work", grouping, rounds,
    exercises: [{ name: "Squat", sets, reps_min: 8 }] }] };
  await act(async () => {
    await fixture.store!.discard();
    await fixture.store!.start(fixed, { workout_id: "source", workout_revision: 1 }, "fixed-client", Date.now(), { log_as_you_go: true });
  }); await settle();
  expect(text().includes("No set count given")).toBe(showHint);
});


it("keeps the rest countdown visible and resettable while the session is paused", async () => {
  await act(async () => { await fixture.store!.timer("rest", 30); }); await settle();
  await act(async () => { vi.setSystemTime(15000); await fixture.store!.pause(true); }); await settle();
  await act(async () => { vi.advanceTimersByTime(60000); }); await settle();
  expect(renderer!.root.findByType("RestTimer" as never).props.remaining).toBe(25);
  expect(action("Reset rest")).toBeDefined();
  expect(fixture.store!.snapshot().active!.actuals).toEqual([]);
});
it("shows the frozen exercise timer with an explicit reset and resumes from its value", async () => {
  const fixed: Workout = { ...workout, provenance: "user", blocks: [{ id: "main", label: "Hold", grouping: "sequential", exercises: [{ name: "Plank", sets: 1, duration_seconds: 30 }] }] };
  await act(async () => { await fixture.store!.discard(); await fixture.store!.start(fixed, { workout_id: "source", workout_revision: 1 }, "hold"); }); await settle();
  await act(async () => { action("Start timer").props.onPress(); }); await settle();
  await act(async () => { vi.setSystemTime(15000); await fixture.store!.pause(true); }); await settle();
  expect(action("Reset timer")).toBeDefined();
  expect(text()).toContain("0:05");
  await act(async () => { action("Reset timer").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.interval_elapsed_milliseconds).toBe(0);
  await act(async () => { await fixture.store!.pause(false); vi.advanceTimersByTime(2000); }); await settle();
  expect(text()).toContain("0:02");
});


it.each(["manual", "background"])("allows Use this time at the cap after late %s pause without logging automatically", async mode => {
  const timed: Workout = { ...workout, blocks: [{ id: "main", label: "Hold", grouping: "circuit", execution: { mode: "amrap", time_cap_seconds: 60 }, exercises: [{ name: "Plank", duration_seconds: 30 }] }] };
  await act(async () => { await fixture.store!.discard(); await fixture.store!.start(timed, { workout_id: "source", workout_revision: 1 }, "cap-hold"); }); await settle();
  await act(async () => { action("Start timer").props.onPress(); }); await settle();
  await act(async () => {
    vi.setSystemTime(80000);
    if (mode === "background") fixture.listeners.forEach(listener => listener("background"));
    else await fixture.store!.pause(true);
  }); await settle();
  expect(text()).toContain("1:00");
  expect(action("Use this time").props.disabled).toBe(false);
  await act(async () => { action("Use this time").props.onPress(); }); await settle();
  expect(field("Time · sec").props.value).toBe("60");
  expect(fixture.store!.snapshot().active!.actuals).toEqual([]);
  expect(footer().props.disabled).toBe(false);
  await act(async () => { footer().props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.actuals[0].duration_seconds).toBe(60);
});

it("keeps labelled Pause/Resume and Finish beside the main logging action", async () => {
  expect(action("Pause").props.disabled).toBe(false);
  expect(partial().props.disabled).toBe(false);
  expect(renderer!.root.findAllByType("IconButton" as never).some(node => node.props.label === "Pause session")).toBe(false);
  await act(async () => { action("Pause").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.paused).toBe(true);
  expect(footer().props.disabled).toBe(true);
  await act(async () => { action("Resume").props.onPress(); }); await settle();
  expect(fixture.store!.snapshot().active!.paused).toBe(false);
});
it("offers discard confirmation when Finish is tapped with zero logged work", async () => {
  const { Alert } = await import("react-native");
  vi.mocked(Alert.alert).mockClear();
  await act(async () => { partial().props.onPress(); }); await settle();
  expect(Alert.alert).toHaveBeenCalledWith("Discard this session?", expect.any(String), expect.any(Array));
  expect(fixture.store!.snapshot().active).not.toBeNull();
  expect(fixture.store!.snapshot().history).toEqual([]);
});

it("stacks set fields when large text changes and preserves both fields", async () => {
  fixture.fontScale = 3.1;
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(Training))));
  const fields = renderer!.root.findAllByType("SetNumberField" as never);
  expect(fields).toHaveLength(2);
  expect(fields[0].parent!.props.style.flexDirection).toBe("column");
  expect(fields[0].props.label).toBe("Reps");
  expect(fields[1].props.label).toBe("Weight · kg");
});
