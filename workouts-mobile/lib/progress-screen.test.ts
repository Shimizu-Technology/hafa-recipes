import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TrainingSession, Workout } from "./models";
import type { SavedLocalSession } from "./training";
const fixture = vi.hoisted(() => ({ history: [] as SavedLocalSession[], remote: [] as TrainingSession[], session: vi.fn() }));
vi.mock("@/lib/context", () => {
  const api = { sessions: async () => fixture.remote, session: fixture.session, saveSession: vi.fn(),
    activityLog: async () => ({ items: [], has_more: false, timezone: "UTC", today: "2026-10-10", limit: 50, offset: 0 }) };
  return { useTraining: () => ({ api, owner: "owner", enrollment: { enrolled: true, generation: 1 } }),
    useOfflineTraining: () => ({ state: { history: fixture.history }, error: "", store: { sync: vi.fn() } }) };
});
vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() }, useFocusEffect() {} }));
vi.mock("@/components/ui", () => ({ Screen: "Screen", Card: "Card", Copy: "Copy", Notice: "Notice", Button: "Button",
  AccountButton: "AccountButton", Empty: "Empty", useColors: () => ({ muted: "gray" }) }));
import Progress from "../app/(tabs)/progress";
let renderer: ReactTestRenderer | undefined, cache: QueryClient;
const workout: Workout = { id: "workout", generation: 1, revision: 1, title: "Strength", kind: "session", provenance: "user",
  blocks: [{ id: "main", label: "Strength", grouping: "sequential", exercises: [{ name: "Row", sets: 2 }] }] };
function saved(id: string, previous?: string): TrainingSession {
  return { id, client_session_id: `client-${id}`, generation: 1, title: "Strength", status: "completed", duration_minutes: 2,
    started_at: "2026-10-10T00:00:00Z", content: { client_session_id: `client-${id}`, workout_id: "workout", workout_revision: 1,
      started_at: "2026-10-10T00:00:00Z", finished_at: "2026-10-10T00:02:00Z", status: "completed", prescription_snapshot: workout,
      ...(previous ? { supersedes_session_id: previous } : {}), actuals: [8, previous ? 6 : 7].map((reps, i) => ({
        block_id: "main", exercise_index: 0, round_index: 1, set_index: i + 1, reps, completed: true })) } };
}
function local(s: TrainingSession, state: SavedLocalSession["state"]): SavedLocalSession {
  const { prescription_snapshot, ...request } = s.content;
  return { generation: 1, workout: prescription_snapshot, request, state, ...(state === "synced" ? { synced_id: s.id } : {}),
    ...(state === "blocked" ? { problem: "Correction conflict requires review" } : {}) };
}
const tree = () => createElement(QueryClientProvider, { client: cache }, createElement(Progress));
async function settle() { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((done) => setTimeout(done, 5)); }); }
const text = () => renderer!.root.findAll((node) => String(node.type) === "Copy" || String(node.type) === "Notice")
  .map((node) => node.children.filter((child) => typeof child === "string").join("")).join("\n");
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.history = []; fixture.remote = []; fixture.session.mockReset();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; cache.clear(); });

it("mounted Progress shows one session immediately after a local correction and retains it through sync with stale/fresh server cache", async () => {
  const original = saved("A"), correction = saved("B", "A");
  fixture.history = [local(original, "synced")]; fixture.remote = [original];
  await act(async () => { renderer = create(tree()); }); await settle();
  expect(text()).toContain("1 workout session with recorded actuals");
  expect(text()).toContain("1 day with recorded training");
  fixture.history = [local(correction, "queued"), ...fixture.history];
  await act(async () => { renderer!.update(tree()); });
  expect(text()).toContain("1 workout session with recorded actuals");
  expect(text()).toContain("correction to the same workout session");
  expect(text()).toContain("6 reps"); expect(text()).not.toContain("7 reps");
  expect(renderer!.root.findAll((node) => String(node.type) === "Button").some((node) => node.props.title === "Retry sync")).toBe(true);
  fixture.history = [local(correction, "synced"), local(original, "synced")];
  await act(async () => { renderer!.update(tree()); });
  expect(text()).toContain("1 workout session with recorded actuals"); expect(text()).not.toContain("7 reps");
  await act(async () => { cache.setQueryData(["owner", "sessions", 1], [correction]); }); await settle();
  expect(text()).toContain("1 workout session with recorded actuals");
  expect(fixture.session).not.toHaveBeenCalled();
});

it("mounted blocked correction stays visible with its conflict and original actuals while counted only once", async () => {
  const original = saved("A"); fixture.remote = [original];
  fixture.history = [local(saved("B", "A"), "blocked"), local(original, "synced")];
  await act(async () => { renderer = create(tree()); }); await settle();
  expect(text()).toContain("1 workout session with recorded actuals");
  expect(text()).toContain("7 reps"); expect(text()).toContain("6 reps");
  expect(text()).toContain("Correction conflict requires review");
  expect(text()).toContain("does not replace the saved actuals");
  expect(renderer!.root.findAll((node) => String(node.type) === "Button").some((node) => node.props.title === "View original saved session")).toBe(true);
});

it("mounted incomplete ancestry pauses totals, keeps original records, and offers retry without exposing transport errors", async () => {
  fixture.history = [local(saved("A"), "synced")]; fixture.remote = [saved("C", "B")];
  fixture.session.mockRejectedValue(Error("PRIVATE transport body"));
  await act(async () => { renderer = create(tree()); }); await settle();
  expect(text()).toContain("Session totals stay paused"); expect(text()).not.toContain("PRIVATE transport body");
  expect(text()).not.toContain("workout sessions with recorded actuals");
  expect(renderer!.root.findAll((node) => String(node.type) === "Button").some((node) => node.props.title === "Retry correction history")).toBe(true);
});

it("one device-only queued correction still counts while offline without unnecessary ancestor reads", async () => {
  fixture.history = [local(saved("B", "A"), "queued")];
  fixture.session.mockRejectedValue(Error("offline"));
  await act(async () => { renderer = create(tree()); }); await settle();
  expect(text()).toContain("1 workout session with recorded actuals");
  expect(fixture.session).not.toHaveBeenCalled();
  expect(renderer!.root.findAll((node) => String(node.type) === "Button").some((node) => node.props.title === "Retry sync")).toBe(true);
});

it("S05 queued 8/6 correction of synced 8/7 is one workout immediately on opening Progress", async () => {
  const original = saved("A"); fixture.remote = [original];
  fixture.history = [local(saved("B", "A"), "queued"), local(original, "synced")];
  await act(async () => { renderer = create(tree()); }); await settle();
  expect(text()).not.toContain("2 workout sessions with recorded actuals");
  expect(text()).toMatch(/1 workout sessions? with recorded actuals/);
  expect(text()).toContain("6 reps"); expect(text()).not.toContain("7 reps");
});
