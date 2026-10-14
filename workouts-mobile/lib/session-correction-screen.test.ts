import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTrainingStore } from "./training";
import type { TrainingSession, Workout } from "./models";

const fixture = vi.hoisted(() => ({ store: null as ReturnType<typeof createTrainingStore> | null,
  session: vi.fn(), saveSession: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({ owner: "owner", units: "imperial",
  api: { session: fixture.session, saveSession: fixture.saveSession } }),
  useOfflineTraining: () => ({ store: fixture.store, ready: true }) }));
vi.mock("expo-router", () => ({ router: { replace: fixture.replace }, useLocalSearchParams: () => ({ id: "saved" }) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "correction-client" }));
vi.mock("@/components/health-export", () => ({ HealthExport: () => null }));
vi.mock("@/components/query-state", () => ({ QueryState: "QueryState" }));
vi.mock("@/components/ui", () => ({ Screen: "Screen", Card: "Card", Copy: "Copy", Choice: "Choice", Field: "Field", Notice: "Notice", Button: "Button" }));
import SessionDetail from "../app/session/[id]";

let renderer: ReactTestRenderer | undefined, cache: QueryClient;
const workout: Workout = { id: "workout", revision: 1, generation: 1, title: "Run", provenance: "user", kind: "session",
  blocks: [{ id: "main", label: "Main", grouping: "sequential", exercises: [{ name: "Run", sets: 1, distance_meters: 1609.344 }] }] };
const saved: TrainingSession = { id: "saved", generation: 1, client_session_id: "original", title: "Run", status: "completed",
  started_at: "2026-10-14T00:00:00Z", content: { client_session_id: "original", started_at: "2026-10-14T00:00:00Z",
    finished_at: "2026-10-14T00:30:00Z", status: "completed", workout_id: "workout", workout_revision: 1,
    activity_type: "running", active_seconds: 1800, prescription_snapshot: workout,
    actuals: [{ block_id: "main", exercise_index: 0, set_index: 1, round_index: 1, side: null, completed: true,
      distance_meters: 1609.344, effort: 6, load: 10, load_unit: "lb", load_convention: "total" }] } };
async function settle() { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
const button = (title: string) => renderer!.root.findAllByType("Button" as never).find(node => node.props.title === title)!;
const field = (label: string) => renderer!.root.findAllByType("Field" as never).find(node => node.props.label === label)!;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.session.mockResolvedValue(saved); fixture.saveSession.mockRejectedValue(Error("offline fixture")); fixture.replace.mockReset();
  const memory = new Map<string, string>();
  fixture.store = createTrainingStore({ getItem: async key => memory.get(key) ?? null,
    setItem: async (key, value) => { memory.set(key, value); }, removeItem: async key => { memory.delete(key); } }, "owner", 1);
  await fixture.store.load();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(SessionDetail))); }); await settle();
  await act(async () => button("Correct these results").props.onPress());
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; cache.clear(); });

it("keeps decimal miles, effort and load as typed, then saves their numeric values without changing the original", async () => {
  for (const [label, values] of [
    ["Actual distance · miles", ["1", "1.", "1.5"]],
    ["Actual effort · 0 to 10", ["7", "7.", "7.5"]],
    ["Actual load · lb", ["12", "12.", "12.5"]],
  ] as const) {
    for (const value of values) { await act(async () => field(label).props.onChange(value)); expect(field(label).props.value).toBe(value); }
  }
  await act(async () => button("Save correction").props.onPress()); await settle();
  const correction = fixture.store!.snapshot().history[0];
  expect(correction.request.actuals[0]).toMatchObject({ distance_meters: 1.5 * 1609.344, effort: 7.5, load: 12.5 });
  expect(correction.request).toMatchObject({ supersedes_session_id: "saved", active_seconds: 1800 });
  expect(saved.content.actuals[0]).toMatchObject({ distance_meters: 1609.344, effort: 6, load: 10 });
  expect(fixture.replace).toHaveBeenCalledWith("/(tabs)/progress");
});

it("keeps an invalid effort draft editable and clears optional values only when saving", async () => {
  await act(async () => { field("Actual effort · 0 to 10").props.onChange("7.."); field("Actual load · lb").props.onChange(""); });
  await act(async () => button("Save correction").props.onPress()); await settle();
  expect(fixture.store!.snapshot().history).toEqual([]); expect(field("Actual effort · 0 to 10").props.value).toBe("7..");
  await act(async () => field("Actual effort · 0 to 10").props.onChange(""));
  await act(async () => button("Save correction").props.onPress()); await settle();
  expect(fixture.store!.snapshot().history[0].request.actuals[0]).toMatchObject({ effort: null, load: null, distance_meters: 1609.344 });
});
