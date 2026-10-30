import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scheduleOnceCommand } from "./schedule-once";
import type { Workout } from "./models";
const f = vi.hoisted(() => ({ map: new Map<string, string>(), save: vi.fn(), replace: vi.fn() }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({ workout_id: "source" }), router: { push() {}, replace: f.replace } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "one-request" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Copy: "Copy", Field: "Field", Notice: "Notice",
  Screen: ({ children, footer }: { children: never; footer: never }) => createElement("Screen", null, children, footer) }));
vi.mock("@/components/calendar-date", () => ({ CalendarDate: "Date" }));
const workout: Workout = { id: "source", revision: 2, generation: 1, title: "Saved workout", kind: "session", provenance: "source",
  blocks: [{ id: "main", label: "Main", grouping: "sequential", exercises: [{ name: "Squat" }] }] };
vi.mock("@/lib/context", () => {
  const storage = { isCurrent: () => true, getItem: async (key: string) => f.map.get(key) ?? null,
    setItem: async (key: string, value: string) => { f.map.set(key, value); }, removeItem: async (key: string) => { f.map.delete(key); } };
  const api = { workout: async () => workout, scheduleOnce: f.save };
  return { useTraining: () => ({ api, owner: "owner", enrollment: { enrolled: true, generation: 1 }, storage, isCurrentAccount: () => true }) };
});
import ScheduleOnce from "../app/schedule-once";
let view: ReactTestRenderer | undefined, cache: QueryClient;
async function settle() { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(done => setTimeout(done, 5)); }); }
async function mount() { await act(async () => { view = create(createElement(QueryClientProvider, { client: cache }, createElement(ScheduleOnce))); }); await settle(); }
const nodes = (type: string) => view!.root.findAll(n => String(n.type) === type);
const button = (title: string) => nodes("Button").find(n => n.props.title === title)!;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.map.clear(); f.save.mockReset(); f.save.mockResolvedValue({ id: "plan" }); cache = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(async () => { await act(async () => view?.unmount()); view = undefined; cache.clear(); });
it("schedules a source snapshot without a profile and resumes an identical command after a network failure", async () => {
  await mount();
  await act(async () => nodes("Date")[0].props.onChange("2026-11-04"));
  await act(async () => nodes("Field")[0].props.onChange("18:30"));
  f.save.mockRejectedValueOnce(Error("Offline"));
  await act(async () => button("Save session").props.onPress()); await settle();
  const command = f.save.mock.calls[0][0];
  expect(command.proposal.sessions).toHaveLength(1);
  expect(command.proposal.sessions[0]).toMatchObject({ date: "2026-11-04", purpose: "Saved workout · 18:30" });
  expect(command.proposal.sessions[0].workout).not.toHaveProperty("id");
  expect(command.proposal.sessions[0].workout.blocks).toEqual(workout.blocks);
  await act(async () => view!.unmount()); view = undefined; await mount();
  await act(async () => button("Retry schedule").props.onPress()); await settle();
  expect(f.save.mock.calls[1][0]).toEqual(command);
  expect(nodes("Notice").some(n => n.props.children === "Session scheduled.")).toBe(true);
  expect(f.save).toHaveBeenCalledTimes(2);
});
it("rejects an invalid time and leaves unknown prescription fields untouched", () => {
  expect(() => scheduleOnceCommand(workout, "2026-11-04", "25:30", "id")).toThrow("Use a time");
  const command = scheduleOnceCommand(workout, "2026-11-04", "", "id");
  expect(command.proposal.sessions[0].workout.blocks[0].exercises[0].sets).toBeUndefined();
});
