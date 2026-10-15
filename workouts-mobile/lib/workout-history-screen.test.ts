import { createContext, createElement, startTransition, Suspense, useContext, type Context, type PropsWithChildren } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import type { Workout } from "./models";
const f = vi.hoisted(() => ({ owner: "owner", generation: 1, current: true, paramsContext: null as Context<string> | null,
  workout: vi.fn(), workoutVersions: vi.fn(), restoreWorkoutVersion: vi.fn(), dismissTo: vi.fn() }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({
  owner: f.owner, enrollment: { enrolled: true, generation: f.generation }, api: f,
  storage: { isCurrent: () => f.current }, isCurrentAccount: () => f.current,
}) }));
vi.mock("expo-router", () => ({ router: { dismissTo: f.dismissTo }, useLocalSearchParams: () => ({ id: useContext(f.paramsContext!) }) }));
vi.mock("@/components/ui", () => ({ Screen: "Screen", Button: "Button", Card: "Card", Copy: "Copy", Notice: "Notice", SectionHeader: "SectionHeader" }));
vi.mock("@/components/query-state", () => ({ QueryState: ({ children }: PropsWithChildren) => children }));
vi.mock("@/components/workout-instructions", () => ({ WorkoutInstructions: "Instructions" }));
vi.mock("@/components/workout-source", () => ({ WorkoutSource: "Source" }));
import WorkoutHistory from "../app/workout-history/[id]";
let tree: ReactTestRenderer | undefined, cache: QueryClient;
f.paramsContext = createContext("workout");
const workout: Workout = { id: "workout", generation: 1, revision: 3, title: "Edited", kind: "session", provenance: "source", blocks: [] };
const original = { id: "version1", revision: 1, created_at: "2026-10-15", workout: { ...workout, revision: 1, title: "Original", instructions: ["Rest after each round"], notes: ["Private note"], source_url: "https://example.test/reel" } };
const nodes = (type: string) => tree!.root.findAll((node) => String(node.type) === type);
const button = (title: string) => nodes("Button").find((node) => node.props.title.startsWith(title))!;
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise((done) => setTimeout(done, 5)); }); }
async function render() {
  await act(async () => { const element = createElement(QueryClientProvider, { client: cache }, createElement(WorkoutHistory));
    if (tree) tree.update(element); else tree = create(element); }); await settle();
}
async function click(title: string) { await act(async () => { button(title).props.onPress(); }); await settle(); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.owner = "owner"; f.generation = 1; f.current = true; f.dismissTo.mockReset();
  f.workout.mockReset().mockResolvedValue(workout); f.workoutVersions.mockReset().mockResolvedValue([original]);
  f.restoreWorkoutVersion.mockReset().mockResolvedValue({ ...original.workout, revision: 4 });
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => { if (tree) await act(async () => { tree!.unmount(); }); tree = undefined; cache.clear(); });

it("requires inspecting an earlier snapshot before restoring and refreshes the saved workout", async () => {
  await render(); expect(button("Restore as new version")).toBeUndefined();
  await click("Review version 1");
  expect(nodes("Instructions")[0].props.notes).toEqual(original.workout.notes);
  expect(nodes("Instructions")[0].props.instructions).toEqual(original.workout.instructions);
  expect(nodes("Source")[0].props.source.source_url).toBe(original.workout.source_url);
  await click("Restore as new version");
  expect(f.restoreWorkoutVersion).toHaveBeenCalledWith(workout, "version1");
  expect(cache.getQueryData<Workout>(["owner", "workout", "workout", 1])?.revision).toBe(4);
  expect(f.dismissTo).toHaveBeenCalledWith({ pathname: "/workout/[id]", params: { id: "workout" } });
});
it("retries the same frozen command after an uncertain response and offers an explicit conflict reload", async () => {
  f.restoreWorkoutVersion.mockRejectedValueOnce(Error("Lost acknowledgement")).mockRejectedValueOnce(new ApiError("Changed", 409));
  await render(); await click("Review version 1"); await click("Restore as new version");
  cache.setQueryData(["owner", "workout", "workout", 1], { ...workout, revision: 9 }); await settle();
  await click("Retry restoring this version");
  expect(f.restoreWorkoutVersion.mock.calls.map((call) => call[0].revision)).toEqual([3, 3]);
  expect(nodes("Notice")[0].props.children).toContain("Reload its latest version");
  expect(button("Retry restoring this version")).toBeUndefined();
  expect(button("Reload latest workout").props.secondary).not.toBe(true);
  f.workout.mockResolvedValue({ ...workout, revision: 10 }); await click("Reload latest workout");
  await click("Restore as new version");
  expect(f.restoreWorkoutVersion.mock.calls.at(-1)?.[0].revision).toBe(10);
});
it("pages older versions without truncating the list", async () => {
  f.workoutVersions.mockImplementation(async (_id, offset) => offset === 0
    ? Array.from({ length: 20 }, (_, index) => ({ ...original, id: `v${index}`, revision: 40 - index })) : [original]);
  await render(); await click("Load older versions");
  expect(f.workoutVersions.mock.calls.map((call) => call[1])).toEqual([0, 20]);
  expect(button("Review version 1")).toBeDefined();
});
it.each(["owner", "generation"] as const)("ignores an acknowledgement after the %s changes", async (field) => {
  let resolve!: (value: Workout) => void;
  f.restoreWorkoutVersion.mockReturnValueOnce(new Promise<Workout>((done) => { resolve = done; }));
  await render(); await click("Review version 1"); await click("Restore as new version");
  if (field === "owner") f.owner = "other"; else f.generation = 2;
  await render(); resolve({ ...original.workout, revision: 4 }); await settle();
  expect(f.dismissTo).not.toHaveBeenCalled();
  expect(cache.getQueryData<Workout>(["owner", "workout", "workout", 1])?.revision).toBe(3);
});
it("stops a stale confirmation when its private storage is retired", async () => {
  await render(); await click("Review version 1"); f.current = false; await click("Restore as new version");
  expect(f.restoreWorkoutVersion).not.toHaveBeenCalled();
});
it("an uncommitted route cannot retire the committed restore acknowledgement", async () => {
  let resolve!: (value: Workout) => void;
  f.restoreWorkoutVersion.mockReturnValueOnce(new Promise<Workout>((done) => { resolve = done; }));
  const Params = f.paramsContext!;
  const suspended = new Promise<never>(() => undefined);
  function Gate({ pending }: { pending: boolean }) { if (pending) throw suspended; return null; }
  const screen = (id: string, pending: boolean) => createElement(QueryClientProvider, { client: cache },
    createElement(Suspense, { fallback: createElement("Fallback") },
      createElement(Params.Provider, { value: id }, createElement(WorkoutHistory), createElement(Gate, { pending }))));
  await act(async () => { tree = create(screen("workout", false)); }); await settle();
  await click("Review version 1"); await click("Restore as new version");
  await act(async () => { startTransition(() => tree!.update(screen("uncommitted", true))); });
  expect(nodes("Fallback")).toHaveLength(0);
  await act(async () => resolve({ ...original.workout, revision: 4 })); await settle();
  expect(f.dismissTo).toHaveBeenCalledWith({ pathname: "/workout/[id]", params: { id: "workout" } });
});
it("a committed route change unlocks its own restore and ignores the previous reply", async () => {
  let resolve!: (value: Workout) => void;
  f.restoreWorkoutVersion.mockReturnValueOnce(new Promise<Workout>((done) => { resolve = done; }));
  const Params = f.paramsContext!;
  const screen = (id: string) => createElement(QueryClientProvider, { client: cache },
    createElement(Params.Provider, { value: id }, createElement(WorkoutHistory)));
  await act(async () => { tree = create(screen("workout")); }); await settle();
  await click("Review version 1"); await click("Restore as new version");
  await act(async () => { tree!.update(screen("another")); }); await settle();
  expect(button("Review version 1").props.disabled).toBe(false);
  await act(async () => resolve({ ...original.workout, revision: 4 })); await settle();
  expect(f.dismissTo).not.toHaveBeenCalled();
});
