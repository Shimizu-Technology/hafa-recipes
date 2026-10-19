import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TrainingSession, Workout } from "./models";
import type { SavedLocalSession } from "./training";
import type { ResultRecoveryReceipt } from "./result-recovery";
import { draftKey } from "./drafts";
const fixture = vi.hoisted(() => ({ owner: "owner", generation: 1, receipts: [] as ResultRecoveryReceipt[], history: [] as SavedLocalSession[], remote: [] as TrainingSession[], session: vi.fn(), sessions: vi.fn(), ready: true, current: true, params: { id: "client-A" }, map: new Map<string, string>(), push: vi.fn(), replace: vi.fn(),
  store: { sync: vi.fn(async () => {}), retry: vi.fn(async () => {}), dismiss: vi.fn(async () => {}), recoverResult: vi.fn(async () => "saved-recovery") }, alert: vi.fn() }));
vi.mock("@/lib/context", () => {
  const storage = { isCurrent: () => fixture.current, getItem: async (key: string) => fixture.map.get(key) ?? null,
    setItem: async (key: string, value: string) => { fixture.map.set(key, value); }, removeItem: async (key: string) => { fixture.map.delete(key); } };
  const api = { saveWorkout: vi.fn(), sessions: fixture.sessions, session: fixture.session, saveSession: vi.fn(),
    activityLog: async () => ({ items: [], has_more: false, timezone: "UTC", today: "2026-10-10", limit: 50, offset: 0 }) };
  return { useTraining: () => ({ api, storage, isCurrentAccount: () => fixture.current, owner: fixture.owner, enrollment: { enrolled: true, generation: fixture.generation } }),
    useOfflineTraining: () => ({ state: { history: fixture.history, recovery_receipts: fixture.receipts }, error: "", ready: fixture.ready, store: fixture.store }) };
});
vi.mock("react-native", () => ({ View: "View", AppState: { addEventListener: () => ({ remove() {} }) }, Alert: { alert: fixture.alert } }));
vi.mock("expo-router", () => ({ router: { push: fixture.push, replace: fixture.replace },
  useLocalSearchParams: () => fixture.params, useFocusEffect() {} }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "recovery-uuid" }));
vi.mock("@/components/ui", () => ({ Screen: "Screen", Card: "Card", Copy: "Copy", Notice: "Notice", Button: "Button",
  AccountButton: "AccountButton", Empty: "Empty", IconButton: "IconButton", ListGroup: "ListGroup", ListRow: "ListRow",
  Row: "Row", SectionHeader: "SectionHeader", Skeleton: "Skeleton", useColors: () => ({ muted: "gray" }) }));
import Progress from "../app/(tabs)/progress";
import RecoverResult from "../app/recover-result/[id]";
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
const tree = (Component = Progress) => createElement(QueryClientProvider, { client: cache }, createElement(Component));
async function settle() { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((done) => setTimeout(done, 5)); }); }
const text = () => renderer!.root.findAll((node) => String(node.type) === "Copy" || String(node.type) === "Notice")
  .map((node) => node.children.filter((child) => typeof child === "string").join("")).join("\n");
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.owner = "owner"; fixture.generation = 1; fixture.receipts = [];
  fixture.history = []; fixture.remote = []; fixture.ready = true; fixture.current = true; fixture.map.clear();
  fixture.push.mockReset(); fixture.replace.mockReset(); fixture.params = { id: "client-A" }; fixture.store.recoverResult.mockReset();
  fixture.store.recoverResult.mockResolvedValue("saved-recovery"); fixture.sessions.mockReset();
  fixture.sessions.mockImplementation(async () => fixture.remote); fixture.session.mockReset(); fixture.alert.mockReset();
  Object.values(fixture.store).forEach((fn) => fn.mockClear());
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

it("a result the server rejected can be retried or discarded from this device after confirmation", async () => {
  const rejected = { ...local(saved("A"), "blocked"), problem: "The workout or plan for this session was deleted." };
  fixture.history = [rejected];
  await act(async () => { renderer = create(tree()); }); await settle();
  expect(text()).toContain("was deleted");
  const press = (title: string) => renderer!.root.findAll((node) => String(node.type) === "Button")
    .find((node) => node.props.title === title)!.props.onPress();
  await act(async () => { press("Try saving again"); }); await settle();
  expect(fixture.store.retry).toHaveBeenCalledWith("client-A");
  expect(fixture.store.sync).toHaveBeenCalledOnce();
  await act(async () => { press("Discard from this device"); });
  expect(fixture.store.dismiss).not.toHaveBeenCalled();
  const buttons = fixture.alert.mock.calls[0][2] as Array<{ text: string; onPress?(): void }>;
  await act(async () => { buttons.find((b) => b.text === "Discard")!.onPress!(); });
  expect(fixture.store.dismiss).toHaveBeenCalledWith("client-A");
});


it("shows initial history loading instead of a false empty library or zero-session summary", async () => {
  let resolve!: (records: TrainingSession[]) => void;
  fixture.sessions.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await act(async () => { renderer = create(tree()); }); await settle();
  expect(text()).toContain("Loading your saved training history");
  expect(renderer!.root.findAllByType("Empty" as never)).toHaveLength(0);
  expect(text()).not.toContain("workout sessions with recorded actuals");
  await act(async () => { resolve([saved("A")]); }); await settle();
  expect(text()).toContain("1 workout session with recorded actuals");
});
it("a failed initial history read has an actionable retry instead of an empty-library claim", async () => {
  fixture.sessions.mockRejectedValueOnce(Error("Training history unavailable"));
  await act(async () => { renderer = create(tree()); }); await settle();
  expect(renderer!.root.findAllByType("Empty" as never)).toHaveLength(0);
  const retry = renderer!.root.findAllByType("Button" as never).find((node) => node.props.title === "Retry loading training history")!;
  expect(retry).toBeDefined();
  await act(async () => { retry.props.onPress(); }); await settle();
  expect(renderer!.root.findAllByType("Empty" as never)).toHaveLength(1);
});
it("renders twenty history rows at a time without truncating authoritative counts or correction inputs", async () => {
  fixture.remote = Array.from({ length: 45 }, (_, index) => saved(`result-${index}`));
  await act(async () => { renderer = create(tree()); }); await settle();
  const views = () => renderer!.root.findAllByType("Button" as never).filter((node) => node.props.title === "View saved session");
  const more = () => renderer!.root.findAllByType("Button" as never).find((node) => node.props.title === "Show more sessions");
  expect(views()).toHaveLength(20); expect(text()).toContain("45 workout sessions with recorded actuals");
  await act(async () => { more()!.props.onPress(); }); expect(views()).toHaveLength(40);
  await act(async () => { more()!.props.onPress(); }); expect(views()).toHaveLength(45);
  expect(more()).toBeUndefined(); expect(fixture.remote).toHaveLength(45);
});


it.each([404, 410, 422])("Progress offers explicit source recovery only for missing-source status%i", async status => {
  fixture.history = [{ ...local(saved("A"), "blocked"), rejection_status: status }];
  await act(async () => { renderer = create(tree()); }); await settle();
  const recover = renderer!.root.findAllByType("Button" as never).find(node => node.props.title === "Recover result");
  expect(!!recover).toBe(status !== 422);
  if (recover) { await act(async () => recover.props.onPress());
    expect(fixture.push).toHaveBeenCalledWith({ pathname: "/recover-result/[id]", params: { id: "client-A" } }); }
});
it("reviewing an orphan shows its prescription and retries the same durable recovery command after reopening", async () => {
  fixture.history = [{ ...local(saved("A"), "blocked"), rejection_status: 404 }];
  fixture.store.recoverResult.mockRejectedValueOnce(Error("Offline; recovery stays saved"));
  await act(async () => { renderer = create(tree(RecoverResult)); }); await settle();
  expect(text()).toContain("Strength"); expect(text()).toContain("Row"); expect(text()).toContain("8 reps"); expect(text()).toContain("Nothing is shared");
  const save = () => renderer!.root.findAllByType("Button" as never).find(node => /Save private workout and result|Continue saving recovered result/.test(node.props.title))!;
  await act(async () => save().props.onPress()); await settle();
  const first = fixture.store.recoverResult.mock.calls[0] as unknown[];
  expect(first[0]).toBe("client-A"); expect(first[1]).toEqual({ creation_key: "recovery-uuid", client_session_id: "recovery-uuid" });
  await act(async () => renderer!.unmount()); renderer = undefined;
  await act(async () => { renderer = create(tree(RecoverResult)); }); await settle();
  await act(async () => save().props.onPress()); await settle();
  expect((fixture.store.recoverResult.mock.calls[1] as unknown[])[1]).toEqual(first[1]);
  expect(fixture.replace).toHaveBeenCalledWith({ pathname: "/session/[id]", params: { id: "saved-recovery" } });
});

it.each([403, 404, 409, 410, 422])("routes a permanently rejected recovery to Progress instead of offering another send after %i", async status => {
  const original = local(saved("A"), "blocked");
  fixture.history = [{ ...local(saved("B"), "blocked"), rejection_status: status,
    problem: "Recovered result needs attention", recovery_origin: { request: original.request, workout: original.workout } }];
  await act(async () => { renderer = create(tree(RecoverResult)); }); await settle();
  expect(text()).toContain("Recovered result needs attention");
  expect(text()).toContain("Your recorded work stays on this device");
  const buttons = renderer!.root.findAllByType("Button" as never);
  expect(buttons.some(node => /Continue saving|Save private/.test(node.props.title))).toBe(false);
  await act(async () => buttons.find(node => node.props.title === "Review in Progress")!.props.onPress());
  expect(fixture.replace).toHaveBeenCalledWith("/(tabs)/progress");
  expect(fixture.store.recoverResult).not.toHaveBeenCalled();
});

it.each([0, 401, 503])("keeps transient recovery status %i retryable with feedback before its action", async status => {
  const original = local(saved("A"), "blocked");
  fixture.history = [{ ...local(saved("B"), "blocked"), rejection_status: status,
    recovery_origin: { request: original.request, workout: original.workout } }];
  fixture.store.recoverResult.mockRejectedValue(Error("Connection unavailable; result retained"));
  await act(async () => { renderer = create(tree(RecoverResult)); }); await settle();
  const retry = renderer!.root.findAllByType("Button" as never).find(node => node.props.title === "Continue saving recovered result")!;
  await act(async () => retry.props.onPress()); await settle();
  const ordered = renderer!.root.findAll(node => String(node.type) === "Notice" || String(node.type) === "Button");
  expect(ordered.findIndex(node => node.children.join("").includes("Connection unavailable; result retained")))
    .toBeLessThan(ordered.findIndex(node => node.props.title === "Continue saving recovered result"));
  expect(text()).toContain("Connection unavailable; result retained");
});

it.each([404, 410])("can deliberately recover a newer missing source after status %i without resending the earlier recovery", async status => {
  const prior = local(saved("A"), "blocked");
  const latest = { ...local(saved("B"), "blocked"), rejection_status: status,
    workout: { ...workout, title: "Newest recovered prescription" },
    recovery_origin: { request: prior.request, workout: { ...prior.workout, title: "Older prescription" } } };
  fixture.history = [latest]; fixture.params = { id: "client-B" };
  await act(async () => { renderer = create(tree(RecoverResult)); }); await settle();
  expect(text()).toContain("Newest recovered prescription"); expect(text()).not.toContain("Older prescription");
  const save = renderer!.root.findAllByType("Button" as never).find(node => node.props.title === "Save private workout and result")!;
  expect(save).toBeDefined();
  await act(async () => save.props.onPress()); await settle();
  expect((fixture.store.recoverResult.mock.calls[0] as unknown[])[0]).toBe("client-B");
});


it.each(["owner", "generation", "id"] as const)("a held recovery cannot keep the next %s scope busy or apply its late acknowledgement", async change => {
  fixture.history = [{ ...local(saved("A"), "blocked"), rejection_status: 404 }];
  let release!: (id: string) => void;
  fixture.store.recoverResult.mockReturnValueOnce(new Promise<string>(resolve => { release = resolve; })).mockResolvedValue("new-result");
  await act(async () => { renderer = create(tree(RecoverResult)); }); await settle();
  const save = () => renderer!.root.findAll(node => String(node.type) === "Button")
    .find(node => /Save private workout and result|Continue saving recovered result/.test(node.props.title))!;
  const oldPress = save().props.onPress;
  await act(async () => oldPress()); await settle(); expect(save().props.busy).toBe(true);
  const oldCurrent = (fixture.store.recoverResult.mock.calls[0] as unknown[])[4] as () => boolean;
  if (change === "owner") fixture.owner = "next-owner";
  if (change === "generation") fixture.generation = 2;
  if (change === "id") fixture.params = { id: "client-B" };
  const next = local(saved(change === "id" ? "B" : "A"), "blocked");
  fixture.history = [{ ...next, generation: fixture.generation, rejection_status: 404,
    workout: { ...next.workout, generation: fixture.generation } }];
  await act(async () => renderer!.update(tree(RecoverResult))); await settle();
  expect(save().props.busy).toBe(false); expect(oldCurrent()).toBe(false);
  await act(async () => oldPress()); await settle(); expect(fixture.store.recoverResult).toHaveBeenCalledTimes(1);
  await act(async () => save().props.onPress()); await settle();
  expect(fixture.replace).toHaveBeenCalledTimes(1);
  expect(fixture.replace).toHaveBeenLastCalledWith({ pathname: "/session/[id]", params: { id: "new-result" } });
  await act(async () => release("old-result")); await settle(); expect(fixture.replace).toHaveBeenCalledTimes(1);
});
it("opens an accepted result from its receipt after history pruning and a lost local form acknowledgement", async () => {
  fixture.receipts = [{ original_id: "client-A", creation_key: "copy-key", client_session_id: "new-client", saved_id: "accepted-result" }];
  fixture.map.set(draftKey("owner", "result-recovery:1:client-A"), JSON.stringify({ version: 1, input: { reviewed: true },
    command: { creation_key: "copy-key", client_session_id: "new-client" }, terminal: false, removed: false }));
  await act(async () => { renderer = create(tree(RecoverResult)); }); await settle();
  const open = renderer!.root.findAll(node => String(node.type) === "Button").find(node => node.props.title === "View saved result")!;
  const oldOpen = open.props.onPress;
  await act(async () => oldOpen());
  expect(fixture.replace).toHaveBeenCalledWith({ pathname: "/session/[id]", params: { id: "accepted-result" } });
  expect(fixture.store.recoverResult).not.toHaveBeenCalled();
  fixture.replace.mockClear(); fixture.owner = "next-owner"; fixture.receipts = [];
  await act(async () => renderer!.update(tree(RecoverResult))); await settle();
  await act(async () => oldOpen()); expect(fixture.replace).not.toHaveBeenCalled();
});
