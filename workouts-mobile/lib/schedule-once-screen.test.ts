import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isExpiredCoverError, scheduleOnceCommand } from "./schedule-once";
import type { Workout } from "./models";
const f = vi.hoisted(() => ({ map: new Map<string, string>(), uuid: 0, save: vi.fn(), replace: vi.fn() }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({ workout_id: "source" }), router: { push() {}, replace: f.replace } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => `request-${++f.uuid}` }));
vi.mock("@/components/ui", () => ({ Button: "Button", Copy: "Copy", Field: "Field", Notice: "Notice",
  Screen: ({ children, footer }: { children: never; footer: never }) => createElement("Screen", null, children, footer) }));
vi.mock("@/components/calendar-date", () => ({ CalendarDate: "Date" }));
const workout: Workout = { id: "source", revision: 2, generation: 1, title: "Saved workout", kind: "session", provenance: "source",
  blocks: [{ id: "main", label: "Main", grouping: "sequential", exercises: [{ name: "Squat" }] }],
  source_thumbnail_url: "https://media.example/cover.jpg", cover_origin: "user" };
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
  f.map.clear(); f.uuid = 0; f.save.mockReset(); f.save.mockResolvedValue({ id: "plan" }); cache = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
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
  await act(async () => button("Schedule another session").props.onPress()); await settle();
  await act(async () => nodes("Date")[0].props.onChange("2026-11-05"));
  await act(async () => button("Save session").props.onPress()); await settle();
  expect(f.save.mock.calls[2][0].request_id).not.toBe(command.request_id);
  expect(f.save.mock.calls[2][0].proposal.sessions[0].date).toBe("2026-11-05");
});
it("rejects an invalid time and leaves unknown prescription fields untouched", () => {
  expect(() => scheduleOnceCommand(workout, "2026-11-04", "25:30", "id")).toThrow("Use a time");
  const command = scheduleOnceCommand(workout, "2026-11-04", "", "id");
  expect(command.proposal.sessions[0].workout.blocks[0].exercises[0].sets).toBeUndefined();
});

const expired = () => Object.assign(Error("Source cover expired; save the workout without its cover"), { status: 422 });
it("explains an expired cover first, drops the offline notice and Retry, and schedules without the cover", async () => {
  await mount();
  await act(async () => nodes("Date")[0].props.onChange("2026-11-04"));
  f.save.mockRejectedValueOnce(expired());
  await act(async () => button("Save session").props.onPress()); await settle();
  const notices = nodes("Notice").map(n => String(n.props.children));
  expect(notices[0]).toMatch(/cover photo has expired/);
  expect(nodes("Notice")[0].props.error).toBe(true);
  expect(notices.some(text => text.includes("Saved on this device"))).toBe(false);
  expect(notices.filter(text => text.includes("Source cover expired"))).toHaveLength(0);
  expect(nodes("Button").some(n => n.props.title === "Retry schedule")).toBe(false);
  expect(button("Schedule without cover")).toBeDefined();
  await act(async () => button("Schedule without cover").props.onPress()); await settle();
  expect(f.save).toHaveBeenCalledTimes(2);
  const [first, second] = f.save.mock.calls.map(call => call[0]);
  expect(first.proposal.sessions[0].workout.source_thumbnail_url).toBe("https://media.example/cover.jpg");
  expect(second.proposal.sessions[0].workout).not.toHaveProperty("source_thumbnail_url");
  expect(second.proposal.sessions[0].workout).not.toHaveProperty("cover_origin");
  expect(second.proposal.sessions[0].workout.blocks).toEqual(first.proposal.sessions[0].workout.blocks);
  expect(second.request_id).not.toBe(first.request_id);
  expect(second.proposal.sessions[0]).toMatchObject({ date: "2026-11-04", purpose: "Saved workout" });
  expect(nodes("Notice").some(n => n.props.children === "Session scheduled.")).toBe(true);
});
it("keeps ordinary failures as the offline notice with Retry", async () => {
  await mount();
  f.save.mockRejectedValueOnce(Error("Offline"));
  await act(async () => button("Save session").props.onPress()); await settle();
  expect(nodes("Notice").some(n => String(n.props.children).includes("Saved on this device"))).toBe(true);
  expect(button("Retry schedule")).toBeDefined();
  expect(nodes("Button").some(n => n.props.title === "Schedule without cover")).toBe(false);
});
it("builds the without-cover command from the same prescription", () => {
  const withCover = { ...workout, source_thumbnail_url: "https://media.example/cover.jpg", cover_origin: "user" as const };
  const plain = scheduleOnceCommand(withCover, "2026-11-04", "", "a");
  const bare = scheduleOnceCommand(withCover, "2026-11-04", "", "b", { withoutCover: true });
  expect(plain.proposal.sessions[0].workout.source_thumbnail_url).toBe("https://media.example/cover.jpg");
  expect(bare.proposal.sessions[0].workout).not.toHaveProperty("source_thumbnail_url");
  expect(bare.proposal.sessions[0].workout).not.toHaveProperty("cover_origin");
  expect(bare.proposal.sessions[0].workout.title).toBe(plain.proposal.sessions[0].workout.title);
});
it("recognises an expired-cover rejection by its message or server detail", () => {
  expect(isExpiredCoverError(expired())).toBe(true);
  expect(isExpiredCoverError(Object.assign(Error("Some details could not be saved."), { detail: "Source cover expired; save the workout without its cover" }))).toBe(true);
  expect(isExpiredCoverError(Error("Offline"))).toBe(false);
  expect(isExpiredCoverError(undefined)).toBe(false);
});
