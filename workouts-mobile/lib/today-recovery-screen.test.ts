import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Enrollment, Program, TrainingProfile } from "./models";

const fixture = vi.hoisted(() => ({
  owner: "owner-A", generation: 1, enrolled: true, current: true, epoch: 0, available: false,
  enrollment: vi.fn(), profile: vi.fn(), programs: vi.fn(), sessions: vi.fn(), start: vi.fn(),
  active: null as null | { workout: { title: string }; actuals: { completed: boolean }[] },
  drafts: new Map<string, string>(),
}));
vi.mock("@/lib/context", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const api = { profile: fixture.profile, programs: fixture.programs, sessions: fixture.sessions };
  return {
    useTraining: () => {
      const owner = fixture.owner, epoch = fixture.epoch;
      const member = { enrolled: fixture.enrolled, generation: fixture.generation,
        adult_confirmed: true, shared_account_deletion_acknowledged: true, disclosure_version: 1, enrolled_at: null };
      const enrollmentQuery = useQuery({ queryKey: [owner, "enrollment"], queryFn: fixture.enrollment, initialData: member });
      return { api, owner, enrollment: member, enrollmentQuery,
        isCurrentAccount: () => fixture.current && fixture.owner === owner,
        storage: { isCurrent: () => fixture.epoch === epoch } };
    },
    useOfflineTraining: () => ({ state: { active: fixture.active, history: [] }, error: "", ready: true, store: { start: fixture.start } }),
  };
});
vi.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator" }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-crypto", () => ({ randomUUID: vi.fn(() => "synthetic-session") }));
vi.mock("@/components/ui", () => ({
  Screen: "Screen", Card: "Card", Copy: "Copy", Empty: "Empty", Notice: "Notice", Button: "Button", AccountButton: "AccountButton",
  useColors: () => ({ action: "green", muted: "gray" }),
}));
import Today from "../app/(tabs)/index";
import { dateInTimezone } from "./training";

let cache: QueryClient, renderer: ReactTestRenderer | undefined;
const profile: TrainingProfile = { adult_confirmed: true, primary_goal: "strength", experience: "regular", equipment: [],
  available_days: [1], session_minutes: 30, timezone: "UTC", movement_exclusions: [], limitations: [], readiness: "ready" };
const member = (): Enrollment => ({ enrolled: fixture.enrolled, generation: fixture.generation,
  adult_confirmed: true, shared_account_deletion_acknowledged: true, disclosure_version: 1, enrolled_at: null });
const tree = () => createElement(QueryClientProvider, { client: cache },
  createElement(Today, { key: `${fixture.owner}:${fixture.generation}` }));
async function settle() { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((done) => setTimeout(done, 5)); }); }
const buttons = (title: string) => renderer!.root.findAllByType("Button" as never).filter((node) => node.props.title === title);
const notices = () => renderer!.root.findAllByType("Notice" as never).filter((node) => node.props.error);
const text = () => renderer!.root.findAll((node) => String(node.type) === "Copy" || String(node.type) === "Notice")
  .map((node) => node.children.filter((child) => typeof child === "string").join("")).join("\n");
async function mount() { await act(async () => { renderer = create(tree()); }); await settle(); }
async function retry() { await act(async () => { buttons("Try again")[0].props.onPress(); }); await settle(); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.owner = "owner-A"; fixture.generation = 1; fixture.enrolled = true; fixture.current = true;
  fixture.epoch = 0; fixture.available = false; fixture.active = null; fixture.drafts.clear();
  for (const mock of [fixture.enrollment, fixture.profile, fixture.programs, fixture.sessions, fixture.start]) mock.mockReset();
  const available = () => { if (!fixture.available) throw Error("The training service is unavailable. Your draft is safe."); };
  fixture.enrollment.mockImplementation(async () => { available(); return member(); });
  fixture.profile.mockImplementation(async () => { available(); return profile; });
  fixture.programs.mockImplementation(async () => { available(); return []; });
  fixture.sessions.mockImplementation(async () => { available(); return []; });
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; cache.clear(); });

it("one Today retry recovers all OFF→ON reads while preserving saved device training and drafts", async () => {
  fixture.active = { workout: { title: "Saved device strength" }, actuals: [{ completed: true }] };
  fixture.drafts.set("owner-A:profile", "unchanged private draft");
  await mount();
  expect(notices()).toHaveLength(1); expect(buttons("Try again")).toHaveLength(1);
  expect(buttons("Resume session")).toHaveLength(1);
  fixture.available = true;
  await retry();
  expect(notices()).toHaveLength(0); expect(buttons("Try again")).toHaveLength(0);
  expect(text()).toContain("Build strength"); expect(text()).toContain("Saved device strength");
  expect(cache.getQueryData(["owner-A", "profile", 1])).toEqual(profile);
  expect(cache.getQueryData(["owner-A", "programs", 1])).toEqual([]);
  expect(cache.getQueryData(["owner-A", "sessions", 1])).toEqual([]);
  for (const mock of [fixture.enrollment, fixture.profile, fixture.programs, fixture.sessions]) expect(mock).toHaveBeenCalledTimes(2);
  expect(fixture.drafts.get("owner-A:profile")).toBe("unchanged private draft");
  expect(fixture.start).not.toHaveBeenCalled();
});

it("a sessions-only failure has a retry and recovering actuals prevents offering an already completed planned session", async () => {
  fixture.available = true;
  const program = { id: "plan", generation: 1, revision: 1, status: "ready", sessions: [{ id: "today", date: dateInTimezone(new Date(), "UTC"),
    purpose: "Saved plan", workout: { title: "Already completed workout" } }] } as Program;
  fixture.programs.mockResolvedValue([program]);
  fixture.sessions.mockRejectedValue(Error("Saved sessions are unavailable."));
  await mount();
  expect(notices()).toHaveLength(1); expect(buttons("Try again")).toHaveLength(1);
  expect(buttons("Start this session")).toHaveLength(0);
  fixture.sessions.mockResolvedValue([{ content: { program_id: "plan", program_session_id: "today" } }]);
  await retry();
  expect(notices()).toHaveLength(0); expect(buttons("Start this session")).toHaveLength(0);
  expect(text()).toContain("Build strength");
  expect(fixture.start).not.toHaveBeenCalled();
});

it("repeated taps share one enrollment check and one set of Today refetches", async () => {
  await mount(); fixture.available = true;
  let finish!: (value: Enrollment) => void;
  fixture.enrollment.mockImplementationOnce(() => new Promise<Enrollment>((done) => { finish = done; }));
  const press = buttons("Try again")[0].props.onPress;
  await act(async () => { press(); press(); }); await settle();
  expect(fixture.enrollment).toHaveBeenCalledTimes(2);
  expect(fixture.profile).toHaveBeenCalledTimes(1);
  await act(async () => { finish(member()); }); await settle();
  for (const mock of [fixture.profile, fixture.programs, fixture.sessions]) expect(mock).toHaveBeenCalledTimes(2);
  expect(notices()).toHaveLength(0);
});

it("an enrollment denial cannot use retained membership to refetch private Today data", async () => {
  await mount(); fixture.available = true;
  fixture.enrollment.mockRejectedValue(Object.assign(Error("Review beta access."), { status: 403 }));
  await retry();
  expect(cache.getQueryData(["owner-A", "enrollment"])).toEqual(member());
  for (const mock of [fixture.profile, fixture.programs, fixture.sessions]) expect(mock).toHaveBeenCalledTimes(1);
  expect(notices()).toHaveLength(1); expect(buttons("Try again")).toHaveLength(1);
});

it.each(["account", "generation", "retired_device"])("a held enrollment retry stops old-scope reads after %s changes", async (change) => {
  await mount(); fixture.available = true;
  let finish!: (value: Enrollment) => void;
  fixture.enrollment.mockImplementationOnce(() => new Promise<Enrollment>((done) => { finish = done; }));
  await act(async () => { buttons("Try again")[0].props.onPress(); }); await settle();
  if (change === "account") fixture.current = false;
  if (change === "retired_device") fixture.epoch++;
  const checked = { ...member(), generation: change === "generation" ? 2 : 1 };
  await act(async () => { finish(checked); }); await settle();
  for (const mock of [fixture.profile, fixture.programs, fixture.sessions]) expect(mock).toHaveBeenCalledTimes(1);
  expect(cache.getQueryData(["owner-A", "profile", 1])).toBeUndefined();
  expect(buttons("Try again")).toHaveLength(1);
  expect(fixture.start).not.toHaveBeenCalled();
});
