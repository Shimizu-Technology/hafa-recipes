import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActivityRecord } from "./activity-log";

const LEGACY_ID = "11111111-2222-4333-8444-555555555555";
const f = vi.hoisted(() => ({
  params: {} as { id?: string },
  map: new Map<string, string>(),
  saveActivity: vi.fn(),
  activity: vi.fn(),
}));
vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return {
    router: { push: vi.fn(), replace: vi.fn() },
    useLocalSearchParams: () => f.params,
    useFocusEffect: (effect: () => (() => void) | void) => useEffect(effect, [effect]),
  };
});
vi.mock("expo-crypto", () => ({ randomUUID: () => "request-uuid" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Card: "Card", Choice: "Choice", Copy: "Copy", Field: "Field",
  Notice: "Notice", Screen: "Screen" }));
vi.mock("@/components/calendar-date", () => ({ CalendarDate: "CalendarDate" }));
vi.mock("@/components/query-state", () => ({ QueryState: ({ loading, children }: { loading: boolean; children: unknown }) => loading ? null : children }));
vi.mock("@/lib/context", () => {
  const storage = { isCurrent: () => true, getItem: async (key: string) => f.map.get(key) ?? null,
    setItem: async (key: string, value: string) => { f.map.set(key, value); }, removeItem: async (key: string) => { f.map.delete(key); } };
  const api = {
    activityLog: async () => ({ items: [], has_more: false, timezone: "UTC", today: "2026-10-10", limit: 50, offset: 0 }),
    activity: f.activity,
    saveActivity: f.saveActivity,
  };
  return { useTraining: () => ({ api, storage, owner: "owner", units: "metric", enrollment: { enrolled: true, generation: 1 } }) };
});
import ActivityEditor from "../app/activity";

const legacy: ActivityRecord = {
  id: LEGACY_ID, generation: 1, revision: 3, status: "active", source: "user", read_only: false, legacy: true,
  completed_confirmed: null, origin_id: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  content: { kind: "walk", date: "2026-10-01", name: "Evening walk", duration_minutes: 30, strenuous: false, distance_km: null, notes: null },
};
let renderer: ReactTestRenderer | undefined;
let cache: QueryClient;
async function settle() { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((done) => setTimeout(done, 5)); }); }
async function mount() {
  await act(async () => {
    renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(ActivityEditor)));
  });
  await settle();
}
const nodes = (type: string) => renderer!.root.findAll((node) => String(node.type) === type);
const confirmChoice = () => nodes("Choice").find((node) => node.props.label === "This activity already happened");
const button = (title: string) => nodes("Button").find((node) => node.props.title === title)!;
const errors = () => nodes("Notice").filter((node) => node.props.error).map((node) => node.props.children).join(" ");
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  f.params = {}; f.map.clear(); f.saveActivity.mockReset(); f.activity.mockReset();
  f.saveActivity.mockImplementation(async (_id: string | null, body: { date: string }) => ({ ...legacy, id: "saved", legacy: false,
    completed_confirmed: true, content: { ...legacy.content!, date: body.date }, profile_revision: 1 }));
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; cache.clear(); });

it("a new activity saves without a confirmation checkbox because logging today or a past date is the confirmation", async () => {
  await mount();
  expect(confirmChoice()).toBeUndefined();
  await act(async () => nodes("Field").find((node) => node.props.label === "Duration · whole minutes")!.props.onChange("25"));
  await act(async () => { await button("Save activity").props.onPress(); });
  await settle();
  expect(errors()).toBe("");
  expect(f.saveActivity).toHaveBeenCalledOnce();
  expect(f.saveActivity.mock.calls[0][0]).toBeNull();
  expect(f.saveActivity.mock.calls[0][1]).toMatchObject({ request_id: "request-uuid", date: "2026-10-10", duration_minutes: 25 });
});

it("an older unconfirmed entry still shows the confirmation and cannot be adopted until it is ticked", async () => {
  f.params = { id: LEGACY_ID };
  f.activity.mockResolvedValue(legacy);
  await mount();
  const choice = confirmChoice();
  expect(choice).toBeDefined();
  expect(choice!.props.selected).toBe(false);
  await act(async () => { await button("Confirm and save").props.onPress(); });
  expect(f.saveActivity).not.toHaveBeenCalled();
  expect(errors()).toContain("Confirm this activity already happened");
  await act(async () => confirmChoice()!.props.onPress());
  expect(confirmChoice()!.props.selected).toBe(true);
  await act(async () => { await button("Confirm and save").props.onPress(); });
  await settle();
  expect(f.saveActivity).toHaveBeenCalledOnce();
  expect(f.saveActivity.mock.calls[0][0]).toBe(LEGACY_ID);
  expect(f.saveActivity.mock.calls[0][1]).toMatchObject({ expected_revision: 3, date: "2026-10-01" });
});

it("a new-entry draft saved before this change resumes confirmed, while a saved command keeps its original fields", async () => {
  const { draftKey } = await import("./drafts");
  const old = { owner: "owner", generation: 1, target_id: null, kind: "run", date: "2026-10-09", name: "", duration: "40",
    distance: "", distance_unit: "km", notes: "", strenuous: null, confirm_completed: false };
  f.map.set(draftKey("owner", "activity-command:1:new"), JSON.stringify({ input: old, operation: null, finished: false }));
  await mount();
  expect(confirmChoice()).toBeUndefined();
  expect(nodes("Field").find((node) => node.props.label === "Duration · whole minutes")!.props.value).toBe("40");
  await act(async () => { await button("Save activity").props.onPress(); });
  await settle();
  expect(errors()).toBe("");
  expect(f.saveActivity.mock.calls[0][1]).toMatchObject({ date: "2026-10-09", duration_minutes: 40, kind: "run" });

  await act(async () => renderer!.unmount()); renderer = undefined; cache.clear(); f.map.clear(); f.saveActivity.mockClear();
  const operation = { owner: "owner", generation: 1, target_id: null, action: "save",
    body: { request_id: "original-request", kind: "run", date: "2026-10-09", duration_minutes: 40, strenuous: null } };
  f.map.set(draftKey("owner", "activity-command:1:new"),
    JSON.stringify({ input: { ...old, operation }, operation, finished: false }));
  await mount();
  // The pending command is untouched: its draft is not rewritten and retry resends the exact original body.
  expect(confirmChoice()!.props.selected).toBe(false);
  await act(async () => { await button("Retry save").props.onPress(); });
  await settle();
  expect(f.saveActivity).toHaveBeenCalledWith(null, operation.body, 1);
});
