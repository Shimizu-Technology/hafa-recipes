import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Enrollment, Program, TrainingProfile, Workout, TrainingSession } from "./models";
import type { SavedLocalSession } from "./training";

const fixture = vi.hoisted(() => ({
  owner: "owner-A", generation: 1, enrolled: true, current: true, epoch: 0, available: false,
  enrollment: vi.fn(), profile: vi.fn(), programs: vi.fn(), sessions: vi.fn(), start: vi.fn(), updateProgram: vi.fn(), archiveProgram: vi.fn(), setReadiness: vi.fn(),
  active: null as null | { workout: { title: string }; actuals: { completed: boolean }[]; source?: { program_id: string; program_session_id: string } },
  drafts: new Map<string, string>(), history: [] as SavedLocalSession[], units: "metric" as "metric" | "imperial",
  session: vi.fn(), correct: vi.fn(), sync: vi.fn(), appListeners: new Set<(state: string) => void>(),
}));
vi.mock("@/lib/context", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const { useMemo } = await import("react");
  const api = { profile: fixture.profile, programs: fixture.programs, sessions: fixture.sessions, updateProgram: fixture.updateProgram, session: fixture.session, archiveProgram: fixture.archiveProgram, setReadiness: fixture.setReadiness };
  return {
    useTraining: () => {
      const owner = fixture.owner, epoch = fixture.epoch;
      const member = { enrolled: fixture.enrolled, generation: fixture.generation,
        adult_confirmed: true, shared_account_deletion_acknowledged: true, disclosure_version: 1, enrolled_at: null };
      const enrollmentQuery = useQuery({ queryKey: [owner, "enrollment"], queryFn: fixture.enrollment, initialData: member });
      const storage = useMemo(() => ({ isCurrent: () => fixture.epoch === epoch, getItem: async (key: string) => fixture.drafts.get(key) ?? null, setItem: async (key: string, value: string) => { fixture.drafts.set(key, value); }, removeItem: async (key: string) => { fixture.drafts.delete(key); } }), [owner, fixture.generation, epoch]);
      return { api, owner, units: fixture.units, enrollment: member, enrollmentQuery,
        isCurrentAccount: () => fixture.current && fixture.owner === owner, storage };
    },
    useOfflineTraining: () => {
      const store = useMemo(() => ({ start: fixture.start, correct: fixture.correct, sync: fixture.sync,
        snapshot: () => ({ active: fixture.active, history: fixture.history }) }), [fixture.owner, fixture.generation, fixture.epoch]);
      return { state: { active: fixture.active, history: fixture.history }, error: "", ready: true, store };
    },
  };
});
vi.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator", View: "View", Pressable: "Pressable",
  AppState: { addEventListener: (_event: string, listener: (state: string) => void) => {
    fixture.appListeners.add(listener); return { remove: () => fixture.appListeners.delete(listener) };
  } } }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("@/constants/theme", () => ({ radii: { md: 12 }, spacing: { xs: 8, sm: 12 } }));
vi.mock("expo-router", () => ({ Redirect: "Redirect", router: { push: vi.fn(), replace: vi.fn() }, useLocalSearchParams: () => ({ id: "saved-session" }), useFocusEffect: () => undefined }));
vi.mock("@/components/health-export", () => ({ HealthExport: "HealthExport" }));
vi.mock("expo-crypto", () => ({ randomUUID: vi.fn(() => "synthetic-session") }));
vi.mock("@/components/ui", () => ({
  Screen: "Screen", Card: "Card", Copy: "Copy", Empty: "Empty", Notice: "Notice", Button: "Button", AccountButton: "AccountButton",
  Chip: "Chip", ChipRow: "ChipRow", ListGroup: "ListGroup", ListRow: "ListRow", SectionHeader: "SectionHeader", WeekStrip: "WeekStrip",
  Choice: "Choice", Grow: "Grow", IconButton: "IconButton", Row: "Row", Sheet: "Sheet", Field: "Field", SkeletonCard: "SkeletonCard",
  useColors: () => ({ action: "green", muted: "gray" }),
}));
import { TrainToday as Today } from "@/components/train-today";
import TodayRoute from "../app/legacy-today";
import Plan from "../app/(tabs)/train/index";
import SessionDetail from "../app/session/[id]";
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
/** Plan sessions are compact rows grouped by week; tapping one opens its actions. Folded weeks open first. */
async function openSession(id: string) {
  const row = () => renderer!.root.findAll((node) => String(node.type) === "Pressable" && node.props.testID === `plan-session-${id}`)[0];
  if (!row()) for (const week of renderer!.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityState?.expanded === false))
    await act(async () => week.props.onPress());
  await act(async () => row().props.onPress());
}
/** Switches between current and archived plans from the "Your plans" heading. */
async function showPlans(label: string) {
  const heading = renderer!.root.findAllByType("SectionHeader" as never).find((node) => node.props.action?.label.startsWith(label))!;
  await act(async () => heading.props.action.onPress());
}
async function retry() { await act(async () => { buttons("Try again")[0].props.onPress(); }); await settle(); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.owner = "owner-A"; fixture.generation = 1; fixture.enrolled = true; fixture.current = true;
  fixture.epoch = 0; fixture.available = false; fixture.active = null; fixture.drafts.clear(); fixture.history = []; fixture.units = "metric";
  for (const mock of [fixture.enrollment, fixture.profile, fixture.programs, fixture.sessions, fixture.start, fixture.updateProgram, fixture.session, fixture.correct, fixture.sync, fixture.archiveProgram, fixture.setReadiness]) mock.mockReset();
  const available = () => { if (!fixture.available) throw Error("The training service is unavailable. Your draft is safe."); };
  fixture.enrollment.mockImplementation(async () => { available(); return member(); });
  fixture.profile.mockImplementation(async () => { available(); return profile; });
  fixture.programs.mockImplementation(async () => { available(); return []; });
  fixture.sessions.mockImplementation(async () => { available(); return []; });
  fixture.correct.mockResolvedValue(undefined); fixture.sync.mockResolvedValue(undefined);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
it("Plan distinguishes partial work and permits inspecting recorded work and explicitly moving an unused missed session", async () => {
  fixture.available = true;
  const workout: Workout = { id: "workout", revision: 1, generation: 1, title: "Strength", kind: "session", provenance: "source",
    blocks: [{ id: "main", label: "Work", grouping: "sequential", rounds: 1,
      exercises: [{ name: "Row", sets: 3, reps_min: 8, rest_seconds: 30, notes: "Keep your back steady" }] }] };
  const program: Program = { id: "plan", title: "My plan", generation: 1, revision: 1, status: "ready", questions: [], warnings: [],
    assumptions: [], source_ids: [], rule_version: "test", sessions: [{ id: "recorded", date: "2020-01-01", purpose: "Strength day", workout },
      { id: "missed", date: "2020-01-03", purpose: "Unused day", workout }] };
  const otherPlan = { ...program, id: "another-plan", sessions: [{ ...program.sessions[0], id: "future", date: "2099-01-01" }] };
  fixture.programs.mockResolvedValue([program, otherPlan]);
  fixture.sessions.mockResolvedValue([{ id: "saved", client_session_id: "client", generation: 1,
    content: { client_session_id: "client", program_id: "plan", program_session_id: "recorded", status: "partial",
      started_at: "2020-01-01T00:00:00Z", actuals: [{ completed: true }], prescription_snapshot: workout } }]);
  fixture.updateProgram.mockImplementation(async (updated) => ({ ...updated, revision: 2 }));
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Plan))); }); await settle();
  expect(buttons("Start session")).toHaveLength(1); // Only the next session (in the other plan) gets Start in the list.
  await openSession("recorded");
  expect(text()).toContain("Partially recorded"); expect(text()).not.toContain("Done. Nice work.");
  await act(async () => buttons("Show workout details")[0].props.onPress());
  expect(text()).toContain("Keep your back steady"); expect(text()).toContain("30s rest");
  expect(fixture.start).not.toHaveBeenCalled();
  expect(buttons("Choose a new date")).toHaveLength(0);
  await openSession("missed");
  expect(buttons("Choose a new date")).toHaveLength(1);
  await act(async () => buttons("Choose a new date")[0].props.onPress());
  const field = renderer!.root.findAllByType("Field" as never).find((n) => n.props.label === "New date · YYYY-MM-DD")!;
  expect(field.props.value).toBe(dateInTimezone(new Date(), "UTC"));
  await act(async () => field.props.onChange("2099-02-30"));
  await act(async () => buttons("Save new date")[0].props.onPress());
  expect(fixture.updateProgram).not.toHaveBeenCalled();
  expect(text()).toContain("Choose today or a future date");
  await act(async () => field.props.onChange("2099-01-01"));
  await act(async () => buttons("Save new date")[0].props.onPress());
  expect(fixture.updateProgram).not.toHaveBeenCalled();
  expect(text()).toContain("That day already has a planned session");
  await act(async () => field.props.onChange(dateInTimezone(new Date(), "UTC")));
  await act(async () => buttons("Save new date")[0].props.onPress()); await settle();
  expect(fixture.updateProgram).toHaveBeenCalledWith(expect.objectContaining({ sessions: [expect.objectContaining({ id: "recorded", date: "2020-01-01" }), expect.objectContaining({ id: "missed", date: dateInTimezone(new Date(), "UTC") })] }));
  expect(program.sessions[0].date).toBe("2020-01-01");
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; cache.clear(); });

it("one Today retry recovers all OFF→ON reads while preserving saved device training and drafts", async () => {
  fixture.active = { workout: { title: "Saved device strength" }, actuals: [{ completed: true }] };
  fixture.drafts.set("owner-A:profile", "unchanged private draft");
  await mount();
  expect(notices()).toHaveLength(1); expect(buttons("Try again")).toHaveLength(1);
  expect(buttons("Resume")).toHaveLength(1);
  fixture.available = true;
  await retry();
  expect(notices()).toHaveLength(0); expect(buttons("Try again")).toHaveLength(0);
  expect(text()).toContain("Saved device strength");
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
  expect(buttons("Start")).toHaveLength(0);
  fixture.sessions.mockResolvedValue([{ id: "saved", client_session_id: "client", generation: 1,
    content: { client_session_id: "client", program_id: "plan", program_session_id: "today", status: "completed",
      started_at: new Date().toISOString(), actuals: [{ completed: true }], prescription_snapshot: { blocks: [] } } }]);
  await retry();
  expect(notices()).toHaveLength(0); expect(buttons("Start")).toHaveLength(0);
  expect(text()).toContain("Done for today");
  expect(fixture.start).not.toHaveBeenCalled();
});
it("missed sessions remain visible with explicit recovery and no silent date changes", async () => {
  fixture.available = true;
  const program = { id: "plan", generation: 1, revision: 1, status: "ready", sessions: [{ id: "missed", date: "2020-01-01",
    purpose: "Saved plan", workout: { title: "Missed strength" } }] } as Program;
  fixture.programs.mockResolvedValue([program]);
  await mount();
  expect(text()).toContain("1 earlier session needs a new date");
  expect(text()).toContain("nothing moves on its own");
  expect(program.sessions[0].date).toBe("2020-01-01");
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


function recordedSession(): TrainingSession {
  const today = dateInTimezone(new Date(), "UTC");
  return { id: "saved-session", client_session_id: "saved-client", generation: 1, title: "Timed run", status: "completed",
    started_at: `${today}T00:00:00Z`, content: { client_session_id: "saved-client", workout_id: "run", workout_revision: 1,
      started_at: `${today}T00:00:00Z`, finished_at: `${today}T00:20:00Z`, status: "completed", actuals: [{
        block_id: "main", exercise_index: 0, round_index: 1, set_index: 1, completed: true,
        duration_seconds: 1200, distance_meters: 1609.344, effort: 7, difficulty: "hard", pain_reported: false, notes: "Original cue",
      }], prescription_snapshot: { id: "run", revision: 1, generation: 1, title: "Timed run", provenance: "user", kind: "session",
        blocks: [{ id: "main", label: "Run", grouping: "sequential", exercises: [{ name: "Run", sets: 1, duration_seconds: 1200 }] }] } } };
}
it("Today marks only effective recorded work and agrees with corrections, rejected uploads and old generations", async () => {
  fixture.available = true;
  const original = recordedSession();
  fixture.sessions.mockResolvedValue([original]);
  const { prescription_snapshot: workout, ...request } = original.content;
  const skipped = { ...request, client_session_id: "correction", supersedes_session_id: original.id,
    status: "partial" as const, actuals: [{ ...request.actuals[0], completed: false }] };
  fixture.history = [
    { generation: 1, state: "queued", request: skipped, workout },
    { generation: 1, state: "blocked", request: { ...request, client_session_id: "rejected" }, workout },
    { generation: 2, state: "queued", request: { ...request, client_session_id: "old" }, workout },
  ];
  await mount();
  const strip = () => renderer!.root.findByType("WeekStrip" as never).props.days as Array<{ state: string }>;
  expect(strip().some((day) => day.state === "done")).toBe(false);
  fixture.history.unshift({ generation: 1, state: "queued", request: { ...request, client_session_id: "new", status: "partial" }, workout });
  await act(async () => { renderer!.update(tree()); });
  expect(strip().filter((day) => day.state === "done")).toHaveLength(1);
});

it.each(["populated", "zero and absent"] as const)("saved-result correction exposes %s feedback and preserves imperial distance and immutable source", async feedback => {
  fixture.available = true; fixture.units = "imperial";
  const original = recordedSession();
  if (feedback === "zero and absent") Object.assign(original.content.actuals[0], {
    effort: 0, difficulty: null, notes: null,
  });
  const before = JSON.stringify(original);
  fixture.session.mockResolvedValue(original);
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(SessionDetail))); }); await settle();
  // The session table summarises each set's answers on one line under the exercise.
  expect(text()).toContain(feedback === "populated" ? "Effort 7/10" : "Effort 0/10");
  expect(text()).toContain("No pain");
  if (feedback === "populated") {
    expect(text()).toContain("Felt hard");
    expect(text()).toContain("Original cue");
  } else {
    expect(text()).not.toContain("Felt ");
    expect(text()).not.toContain("Original cue");
  }
  await act(async () => { buttons("Correct these results")[0].props.onPress(); });
  const field = (label: string) => renderer!.root.findAllByType("Field" as never).find((node) => node.props.label === label)!;
  expect(field("Actual distance · miles").props.value).toBe("1");
  await act(async () => {
    field("Actual distance · miles").props.onChange("2");
    field("Actual seconds").props.onChange("900");
    field("Actual effort · 0 to 10").props.onChange("5");
    field("Set notes").props.onChange("Corrected cue");
  });
  const choose = (label: string) => renderer!.root.findAllByType("Choice" as never).find((node) => node.props.label === label)!;
  await act(async () => { choose("manageable").props.onPress(); choose("Yes, pain reported").props.onPress(); });
  await act(async () => { buttons("Save correction")[0].props.onPress(); });
  expect(fixture.correct).toHaveBeenCalledWith(original, [expect.objectContaining({
    distance_meters: 3218.688, duration_seconds: 900, effort: 5, difficulty: "manageable", pain_reported: true, notes: "Corrected cue",
  })], "", "synthetic-session");
  expect(JSON.stringify(original)).toBe(before);
});

it("Today pauses recorded-day markers for missing correction ancestry and retries successfully", async () => {
  fixture.available = true;
  const original = { ...recordedSession(), id: "A", client_session_id: "client-A",
    content: { ...recordedSession().content, client_session_id: "client-A" } };
  const correction = { ...original, id: "C", client_session_id: "client-C", content: {
    ...original.content, client_session_id: "client-C", supersedes_session_id: "B",
  } };
  const { prescription_snapshot: workout, ...request } = original.content;
  fixture.history = [{ generation: 1, state: "synced", synced_id: "A", request, workout }];
  fixture.sessions.mockResolvedValue([correction]);
  fixture.session.mockRejectedValue(Error("PRIVATE transport body"));
  await mount();
  const days = () => renderer!.root.findByType("WeekStrip" as never).props.days as Array<{ state: string }>;
  expect(text()).toContain("Done-day checkmarks are paused");
  expect(text()).not.toContain("PRIVATE transport body");
  expect(days().some(day => day.state === "done")).toBe(false);
  expect(buttons("Check again")).toHaveLength(1);
  fixture.session.mockResolvedValue({ ...original, id: "B", client_session_id: "client-B", content: {
    ...original.content, client_session_id: "client-B", supersedes_session_id: "A",
  } });
  await act(async () => buttons("Check again")[0].props.onPress()); await settle();
  expect(text()).not.toContain("Done-day checkmarks are paused");
  expect(buttons("Check again")).toHaveLength(0);
  expect(days().filter(day => day.state === "done")).toHaveLength(1);
  expect(fixture.session.mock.calls).toEqual([["B"], ["B"]]);
  expect(fixture.start).not.toHaveBeenCalled();
});

it.each(["partial", "completed"])("Plan keeps recorded %s sessions with no completed sets frozen", async (status) => {
  fixture.available = true;
  const program = { id: "plan", generation: 1, revision: 1, status: "ready", sessions: [{ id: "recorded", date: "2020-01-01",
    purpose: "Saved plan", workout: { title: "Recorded strength" } }] } as Program;
  fixture.programs.mockResolvedValue([program]);
  fixture.sessions.mockResolvedValue([{ id: "saved", client_session_id: "client", generation: 1,
    content: { client_session_id: "client", program_id: "plan", program_session_id: "recorded", status,
      started_at: "2020-01-01T00:00:00Z", actuals: [], prescription_snapshot: { blocks: [] } } }]);
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Plan))); }); await settle();
  await openSession("recorded");
  expect(buttons("Choose a new date")).toHaveLength(0);
  expect(buttons("Move this session")).toHaveLength(0);
  expect(text()).toContain("Its original date stays in history");
  expect(fixture.updateProgram).not.toHaveBeenCalled();
});

it.each(["newer_revision", "retired_account"])("date recovery shares repeated taps and respects %s during a held save", async change => {
  fixture.available = true;
  const program: Program = { id: "plan", title: "Strength", generation: 1, revision: 1, status: "ready", sessions: [{
    id: "missed", date: "2020-01-01", purpose: "Strength", workout: { id: "w", title: "Strength", generation: 1, revision: 1,
      kind: "session", provenance: "user", blocks: [{ id: "main", label: "Main", grouping: "sequential", exercises: [{ name: "Row", sets: 2, reps_min: 8 }] }] },
  }], questions: [], warnings: [], assumptions: [], source_ids: [], rule_version: "test" };
  fixture.programs.mockResolvedValue([program]);
  let finish!: (p: Program) => void;
  fixture.updateProgram.mockImplementation(() => new Promise<Program>(done => { finish = done; }));
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Plan))); }); await settle();
  await openSession("missed");
  await act(async () => buttons("Choose a new date")[0].props.onPress());
  const press = buttons("Save new date")[0].props.onPress;
  await act(async () => { press(); press(); });
  expect(fixture.updateProgram).toHaveBeenCalledTimes(1);
  const requested = fixture.updateProgram.mock.calls[0][0];
  expect(requested.sessions[0]).toEqual({ ...program.sessions[0], date: dateInTimezone(new Date(), "UTC") });
  const newer = { ...program, revision: 3 };
  if (change === "newer_revision") await act(async () => { cache.setQueryData(["owner-A", "programs", 1], [newer]); });
  else { fixture.current = false; fixture.epoch++; }
  await act(async () => finish({ ...requested, revision: 2 })); await settle();
  expect(cache.getQueryData(["owner-A", "programs", 1])).toEqual([change === "newer_revision" ? newer : program]);
  expect(cache.getQueryData(["owner-B", "programs", 1])).toBeUndefined();
});

it("Plan explains a recovery-spacing rejection and retains the date edit for correction", async () => {
  fixture.available = true;
  const program = { id: "plan", title: "Strength", generation: 1, revision: 1, status: "ready",
    sessions: [{ id: "missed", date: "2020-01-01", purpose: "Strength", workout: { title: "Strength" } }] } as Program;
  fixture.programs.mockResolvedValue([program]);
  fixture.updateProgram.mockRejectedValue(Object.assign(new Error("Refresh the saved program."), {
    status: 409, detail: "Keep session spacing and avoid stacking training",
  }));
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Plan))); }); await settle();
  await openSession("missed");
  await act(async () => buttons("Choose a new date")[0].props.onPress());
  await act(async () => buttons("Save new date")[0].props.onPress()); await settle();
  expect(text()).toContain("Choose a date with a recovery day between demanding sessions.");
  expect(text()).not.toContain("Refresh the saved program.");
  expect(buttons("Save new date")).toHaveLength(1);
  expect(cache.getQueryData(["owner-A", "programs", 1])).toEqual([program]);
});

it("Plan archives and restores without losing its paused queue or changing dates", async () => {
  fixture.available = true;
  const paused: Program = { id: "plan", title: "Paused strength", generation: 1, revision: 1, status: "ready", sessions: [],
    questions: [], warnings: [], assumptions: [], source_ids: [], rule_version: "test",
    schedule_state: { status: "paused", paused_at: "2020-01-01", paused_sessions: [
      { id: "queued", date: "2020-01-01", purpose: "Saved order", workout: { id: "queued-workout", generation: 1, revision: 1,
        kind: "session", provenance: "source", title: "Queued strength", blocks: [] } }
    ] } };
  let programs = [paused];
  fixture.programs.mockImplementation(async () => programs);
  fixture.archiveProgram.mockImplementation(async (p, archived) => {
    const saved = { ...p, revision: p.revision + 1, schedule_state: archived ?
      { ...p.schedule_state, status: "paused", archived_at: "2026-10-10", archive_previous_status: "paused" } : paused.schedule_state };
    programs = [saved]; return saved;
  });
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Plan))); }); await settle();
  const menu = renderer!.root.findAllByType("IconButton" as never).find((n) => n.props.label === "More actions for Paused strength")!;
  await act(async () => menu.props.onPress());
  const archive = renderer!.root.findAllByType("ListRow" as never).find((n) => n.props.title === "Archive plan")!;
  await act(async () => archive.props.onPress()); await settle();
  expect(fixture.archiveProgram).toHaveBeenCalledWith(paused, true);
  expect(buttons("Plan your return with coach")).toHaveLength(0);
  expect(text()).toContain("Archived. Workout instructions and recorded training stay saved");
  await showPlans("Current plans");
  expect(text()).not.toContain("Queued strength");
  await showPlans("Archived");
  await act(async () => buttons("Restore plan")[0].props.onPress()); await settle();
  expect(fixture.archiveProgram.mock.calls[1][0].revision).toBe(2);
  expect(fixture.archiveProgram.mock.calls[1][1]).toBe(false);
  expect(buttons("Plan your return with coach")).toHaveLength(1);
  expect(text()).toContain("Queued strength");
  expect(paused.schedule_state?.paused_sessions?.[0].date).toBe("2020-01-01");
  expect(fixture.start).not.toHaveBeenCalled();
});


it("an in-flight archive stays with its original account and repeated taps share one request", async () => {
  fixture.available = true;
  const program: Program = { id: "plan", title: "Owner A plan", generation: 1, revision: 1, status: "ready", sessions: [],
    questions: [], warnings: [], assumptions: [], source_ids: [], rule_version: "test" };
  fixture.programs.mockResolvedValue([program]);
  let finish!: (p: Program) => void;
  fixture.archiveProgram.mockImplementation(() => new Promise<Program>((done) => { finish = done; }));
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Plan))); }); await settle();
  const menu = renderer!.root.findAllByType("IconButton" as never).find((n) => n.props.label === "More actions for Owner A plan")!;
  await act(async () => menu.props.onPress());
  const press = renderer!.root.findAllByType("ListRow" as never).find((n) => n.props.title === "Archive plan")!.props.onPress;
  await act(async () => { press(); press(); });
  expect(fixture.archiveProgram).toHaveBeenCalledTimes(1);
  fixture.owner = "owner-B"; fixture.epoch += 1;
  const archived = { ...program, revision: 2, schedule_state: { status: "paused" as const, archived_at: "2026-10-10" } };
  await act(async () => finish(archived)); await settle();
  expect(cache.getQueryData(["owner-A", "programs", 1])).toEqual([program]);
  expect(cache.getQueryData(["owner-B", "programs", 1])).toBeUndefined();
});

it("a held archive acknowledgment cannot replace a newer restored revision when refreshing fails", async () => {
  fixture.available = true;
  const program: Program = { id: "plan", title: "Strength", generation: 1, revision: 1, status: "ready", sessions: [],
    questions: [], warnings: [], assumptions: [], source_ids: [], rule_version: "test" };
  fixture.programs.mockResolvedValue([program]);
  let finish!: (p: Program) => void;
  fixture.archiveProgram.mockImplementation(() => new Promise<Program>((done) => { finish = done; }));
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Plan))); }); await settle();
  await act(async () => renderer!.root.findAllByType("IconButton" as never).find(n => n.props.label === "More actions for Strength")!.props.onPress());
  await act(async () => renderer!.root.findAllByType("ListRow" as never).find(n => n.props.title === "Archive plan")!.props.onPress());
  const restored = { ...program, revision: 3 };
  fixture.programs.mockRejectedValue(Error("History refresh unavailable"));
  await act(async () => { cache.setQueryData(["owner-A", "programs", 1], [restored]); });
  await act(async () => finish({ ...program, revision: 2, schedule_state: { status: "paused", archived_at: "2026-10-15" } })); await settle();
  expect(cache.getQueryData(["owner-A", "programs", 1])).toEqual([restored]);
  expect(buttons("Restore plan")).toHaveLength(0);
  expect(text()).not.toContain("Archived. Workout instructions");
});

it.each(["move", "archive"])("a held %s prevents an overlapping plan mutation from stale callbacks", async (first) => {
  fixture.available = true;
  const program: Program = { id: "plan", title: "Strength", generation: 1, revision: 1, status: "ready", sessions: [{
    id: "missed", date: "2020-01-01", purpose: "Strength", workout: { id: "w", title: "Strength", generation: 1, revision: 1,
      kind: "session", provenance: "user", blocks: [{ id: "main", label: "Main", grouping: "sequential", exercises: [{ name: "Row", sets: 2, reps_min: 8 }] }] },
  }], questions: [], warnings: [], assumptions: [], source_ids: [], rule_version: "test" };
  fixture.programs.mockResolvedValue([program]);
  let finish!: (p: Program) => void;
  const held = () => new Promise<Program>(done => { finish = done; });
  fixture.updateProgram.mockImplementation(held);
  fixture.archiveProgram.mockImplementation(held);
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Plan))); }); await settle();
  await openSession("missed");
  await act(async () => buttons("Choose a new date")[0].props.onPress());
  const move = buttons("Save new date")[0].props.onPress;
  await act(async () => renderer!.root.findAllByType("IconButton" as never).find(n => n.props.label === "More actions for Strength")!.props.onPress());
  const archive = renderer!.root.findAllByType("ListRow" as never).find(n => n.props.title === "Archive plan")!.props.onPress;
  await act(async () => { if (first === "move") { move(); archive(); } else { archive(); move(); } });
  expect(fixture.updateProgram).toHaveBeenCalledTimes(first === "move" ? 1 : 0);
  expect(fixture.archiveProgram).toHaveBeenCalledTimes(first === "archive" ? 1 : 0);
  await act(async () => finish({ ...program, revision: 2 })); await settle();
});

function maintainablePlan(): Program {
  const workout: Workout = { id: "w", title: "Strength session", generation: 1, revision: 1, kind: "session", provenance: "user",
    instructions: ["Rest between rounds"], notes: ["Private owner note"], source_context: { parts: [{ location: "caption", text: "2 x 8 rows" }], truncated: false },
    blocks: [{ id: "main", label: "Main", grouping: "sequential", exercises: [{ name: "Row", sets: 2, reps_min: 8, instructions: "Keep your back steady", notes: "Private cue" }] }] };
  return { id: "plan", title: "My plan", generation: 1, revision: 1, status: "ready", questions: [], warnings: [], assumptions: [],
    source_ids: [], rule_version: "test", sessions: [
      { id: "past", date: "2020-01-01", purpose: "Past", workout },
      { id: "today", date: dateInTimezone(new Date(), "UTC"), purpose: "Today", workout },
      { id: "future", date: "2099-01-02", purpose: "Future", workout },
    ] };
}
async function mountPlan(program = maintainablePlan()) {
  fixture.available = true; fixture.programs.mockResolvedValue([program]);
  fixture.updateProgram.mockImplementation(async p => ({ ...p, revision: p.revision + 1 }));
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Plan))); }); await settle();
  return program;
}
const planRow = (title: string) => renderer!.root.findAllByType("ListRow" as never).find(node => node.props.title === title)!;
async function openRename() {
  await act(async () => renderer!.root.findAllByType("IconButton" as never).find(node => node.props.label.startsWith("More actions for "))!.props.onPress());
  await act(async () => planRow("Rename plan").props.onPress());
}
it("renames a plan without changing its dates, workout instructions or recorded history", async () => {
  const original = await mountPlan(); await openRename();
  const name = renderer!.root.findAllByType("Field" as never).find(node => node.props.label === "Plan name")!;
  await act(async () => name.props.onChange(" My renamed plan "));
  await act(async () => buttons("Save plan name")[0].props.onPress()); await settle();
  expect(fixture.updateProgram).toHaveBeenCalledWith({ ...original, title: "My renamed plan" });
  expect(cache.getQueryData<Program[]>(["owner-A", "programs", 1])?.[0]).toMatchObject({ title: "My renamed plan", revision: 2, sessions: original.sessions });
  expect(original.title).toBe("My plan"); expect(fixture.start).not.toHaveBeenCalled();
});
it("removes only a confirmed future unrecorded day while preserving the other plan entries", async () => {
  const original = await mountPlan(); expect(buttons("Remove from plan")).toHaveLength(0);
  await openSession("future"); expect(buttons("Remove from plan")).toHaveLength(1);
  await act(async () => buttons("Remove from plan")[0].props.onPress());
  expect(fixture.updateProgram).not.toHaveBeenCalled();
  await act(async () => buttons("Keep planned session")[0].props.onPress());
  expect(fixture.updateProgram).not.toHaveBeenCalled();
  await act(async () => buttons("Remove from plan")[0].props.onPress());
  await act(async () => buttons("Remove planned session")[0].props.onPress()); await settle();
  expect(fixture.updateProgram).toHaveBeenCalledWith({ ...original, sessions: original.sessions.slice(0, 2) });
  expect(cache.getQueryData<Program[]>(["owner-A", "programs", 1])?.[0].sessions.map(session => session.id)).toEqual(["past", "today"]);
  expect(original.sessions).toHaveLength(3); expect(fixture.sessions).toHaveBeenCalledTimes(1);
});
it.each(["recorded", "active", "pending", "paused", "archived"])("does not offer removing %s planned work", async kind => {
  const program = maintainablePlan();
  if (kind === "recorded") fixture.sessions.mockResolvedValue([{ id: "recorded", generation: 1, client_session_id: "client", content: {
    client_session_id: "client", program_id: program.id, program_session_id: "future", status: "partial", started_at: "2099-01-02T00:00:00Z",
    actuals: [{ completed: true }], prescription_snapshot: program.sessions[2].workout } }]);
  if (kind === "active") fixture.active = { workout: { title: "Active future session" }, actuals: [], source: { program_id: program.id, program_session_id: "future" } };
  if (kind === "pending") fixture.history = [{ generation: 1, state: "blocked", workout: program.sessions[2].workout,
    request: { client_session_id: "pending", program_id: program.id, program_revision: 1, program_session_id: "future", started_at: "2099-01-02T00:00:00Z", finished_at: "2099-01-02T00:01:00Z", status: "partial", actuals: [] } }];
  if (kind === "paused") program.schedule_state = { status: "paused" };
  if (kind === "archived") program.schedule_state = { status: "paused", archived_at: "2026-10-15" };
  await mountPlan(program);
  if (kind === "archived") await showPlans("Archived");
  await openSession("future");
  expect(buttons("Show workout details")).toHaveLength(1);
  expect(buttons("Remove from plan")).toHaveLength(0);
});
it("rechecks live active training before confirming removal", async () => {
  const program = await mountPlan(); await openSession("future");
  await act(async () => buttons("Remove from plan")[0].props.onPress());
  fixture.active = { workout: { title: "Started on this device" }, actuals: [], source: { program_id: program.id, program_session_id: "future" } };
  await act(async () => buttons("Remove planned session")[0].props.onPress()); await settle();
  expect(fixture.updateProgram).not.toHaveBeenCalled(); expect(text()).toContain("Only future sessions");
});
it.each(["rename", "remove"])("a held %s fences duplicate taps and late acknowledgments after account changes", async kind => {
  const program = await mountPlan();
  let resolve!: (program: Program) => void;
  fixture.updateProgram.mockImplementationOnce(() => new Promise<Program>(done => { resolve = done; }));
  if (kind === "rename") await openRename();
  else { await openSession("future"); await act(async () => buttons("Remove from plan")[0].props.onPress()); }
  const press = buttons(kind === "rename" ? "Save plan name" : "Remove planned session")[0].props.onPress;
  await act(async () => { press(); press(); }); expect(fixture.updateProgram).toHaveBeenCalledTimes(1);
  fixture.owner = "owner-B"; fixture.epoch++;
  await act(async () => resolve({ ...program, title: "Old account acknowledgment", revision: 2 })); await settle();
  expect(cache.getQueryData(["owner-A", "programs", 1])).toEqual([program]);
  expect(cache.getQueryData(["owner-B", "programs", 1])).toBeUndefined();
});
it("rejects invalid names and stale program revisions before sending, and refreshes server conflicts", async () => {
  const program = await mountPlan(); await openRename();
  const name = () => renderer!.root.findAllByType("Field" as never).find(node => node.props.label === "Plan name")!;
  await act(async () => name().props.onChange("  "));
  await act(async () => buttons("Save plan name")[0].props.onPress());
  expect(fixture.updateProgram).not.toHaveBeenCalled(); expect(text()).toContain("Use a plan name");
  await act(async () => name().props.onChange("Good name"));
  await act(async () => { cache.setQueryData(["owner-A", "programs", 1], [{ ...program, revision: 2 }]); });
  await act(async () => buttons("Save plan name")[0].props.onPress());
  expect(fixture.updateProgram).not.toHaveBeenCalled(); expect(text()).toContain("This plan changed");
  await act(async () => buttons("Keep original name")[0].props.onPress()); await openRename();
  fixture.updateProgram.mockRejectedValueOnce(Object.assign(Error("Refresh the saved program."), { status: 409 }));
  await act(async () => buttons("Save plan name")[0].props.onPress()); await settle();
  expect(fixture.updateProgram).toHaveBeenCalledTimes(1); expect(fixture.programs.mock.calls.length).toBeGreaterThan(1);
  expect(text()).toContain("Refresh the saved program");
});

it("does not write a held maintenance acknowledgment into a new enrollment or overwrite a newer plan revision", async () => {
  const program = await mountPlan(); await openRename();
  let resolve!: (program: Program) => void;
  fixture.updateProgram.mockImplementationOnce(() => new Promise<Program>(done => { resolve = done; }));
  await act(async () => buttons("Save plan name")[0].props.onPress());
  const newer = { ...program, revision: 3, title: "Newer server title" };
  await act(async () => { cache.setQueryData(["owner-A", "programs", 1], [newer]); });
  await act(async () => resolve({ ...program, revision: 2 })); await settle();
  expect(cache.getQueryData(["owner-A", "programs", 1])).toEqual([newer]);
  await openRename();
  fixture.updateProgram.mockImplementationOnce(() => new Promise<Program>(done => { resolve = done; }));
  await act(async () => buttons("Save plan name")[0].props.onPress());
  fixture.generation = 2; fixture.programs.mockResolvedValue([]);
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(Plan)))); await settle();
  await act(async () => resolve({ ...newer, revision: 4 })); await settle();
  expect(cache.getQueryData(["owner-A", "programs", 1])).toEqual([newer]);
  expect(cache.getQueryData(["owner-A", "programs", 2])).toEqual([]);
});

it("an old generation acknowledgment cannot unlock an in-flight maintenance command in the new generation", async () => {
  const original = await mountPlan(); await openRename();
  let oldAck!: (program: Program) => void, newAck!: (program: Program) => void;
  fixture.updateProgram.mockImplementationOnce(() => new Promise<Program>(done => { oldAck = done; }));
  await act(async () => buttons("Save plan name")[0].props.onPress());
  const next = { ...original, generation: 2, title: "New enrollment plan" };
  fixture.generation = 2; fixture.programs.mockResolvedValue([next]);
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(Plan)))); await settle();
  await openRename();
  fixture.updateProgram.mockImplementationOnce(() => new Promise<Program>(done => { newAck = done; }));
  const press = buttons("Save plan name")[0].props.onPress;
  await act(async () => press());
  await act(async () => oldAck({ ...original, revision: 2 })); await settle();
  await act(async () => press());
  expect(fixture.updateProgram).toHaveBeenCalledTimes(2);
  expect(cache.getQueryData(["owner-A", "programs", 1])).toEqual([original]);
  expect(cache.getQueryData(["owner-A", "programs", 2])).toEqual([next]);
  await act(async () => newAck({ ...next, revision: 2 })); await settle();
  expect(cache.getQueryData<Program[]>(["owner-A", "programs", 2])?.[0].revision).toBe(2);
});

it.each(["owner", "storage", "generation"] as const)("a retired native date callback cannot overwrite the %s scope's new editor", async kind => {
  await mountPlan(); await openSession("future");
  await act(async () => buttons("Move this session")[0].props.onPress());
  const old = renderer!.root.findAllByType("Field" as never).find(node => node.props.label === "New date · YYYY-MM-DD")!.props.onChange;
  if (kind === "owner") fixture.owner = "owner-B";
  else if (kind === "storage") fixture.epoch += 1;
  else fixture.generation += 1;
  await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(Plan)))); await settle();
  expect(buttons("Move this session")).toHaveLength(0); // A new scope closes the old session sheet.
  await openSession("future");
  await act(async () => buttons("Move this session")[0].props.onPress());
  await act(async () => old("2099-08-20"));
  const field = renderer!.root.findAllByType("Field" as never).find(node => node.props.label === "New date · YYYY-MM-DD")!;
  expect(field.props.value).toBe("2099-01-02"); expect(fixture.updateProgram).not.toHaveBeenCalled();
});
it("a native date callback for the previous editor cannot overwrite a different session or a reopened editor", async () => {
  await mountPlan(); await openSession("future");
  await act(async () => buttons("Move this session")[0].props.onPress());
  const old = renderer!.root.findAllByType("Field" as never).find(node => node.props.label === "New date · YYYY-MM-DD")!.props.onChange;
  await openSession("today");
  await act(async () => buttons("Move this session")[0].props.onPress());
  await act(async () => old("2099-08-20"));
  expect(renderer!.root.findAllByType("Field" as never).find(node => node.props.label === "New date · YYYY-MM-DD")!.props.value).toBe(dateInTimezone(new Date(), "UTC"));
  await openSession("future");
  await act(async () => buttons("Move this session")[0].props.onPress());
  await act(async () => old("2099-08-21"));
  expect(renderer!.root.findAllByType("Field" as never).find(node => node.props.label === "New date · YYYY-MM-DD")!.props.value).toBe("2099-01-02");
});

const readinessRejection = () => Object.assign(new Error("Refresh the saved program."), {
  status: 409, detail: "Confirm readiness before applying a training change",
});
async function requirePlanReadiness() {
  await mountPlan();
  fixture.updateProgram.mockRejectedValueOnce(readinessRejection());
  await openSession("future");
  await act(async () => buttons("Move this session")[0].props.onPress());
  const date = renderer!.root.findAllByType("Field" as never).find(node => node.props.label === "New date · YYYY-MM-DD")!;
  await act(async () => date.props.onChange("2099-02-10"));
  await act(async () => buttons("Save new date")[0].props.onPress()); await settle();
}
it("confirms expired daily readiness in the date editor and preserves the entered date through a failed confirmation", async () => {
  await requirePlanReadiness();
  expect(text()).toContain("Confirm your current readiness in the date editor");
  expect(buttons("I’m ready to train today")).toHaveLength(1);
  fixture.setReadiness.mockRejectedValueOnce(Error("Readiness confirmation unavailable"));
  await act(async () => buttons("I’m ready to train today")[0].props.onPress()); await settle();
  expect(text()).toContain("Readiness confirmation unavailable");
  fixture.setReadiness.mockResolvedValueOnce({ state: "ready" });
  await act(async () => buttons("I’m ready to train today")[0].props.onPress()); await settle();
  expect(fixture.setReadiness.mock.calls).toEqual([["ready", 1], ["ready", 1]]);
  expect(buttons("I’m ready to train today")).toHaveLength(0);
  expect(fixture.updateProgram).toHaveBeenCalledTimes(1); // Confirmation never moves a session implicitly.
  expect(renderer!.root.findAllByType("Field" as never).find(node => node.props.label === "New date · YYYY-MM-DD")!.props.value).toBe("2099-02-10");
  await act(async () => buttons("Save new date")[0].props.onPress()); await settle();
  expect(fixture.updateProgram.mock.calls[1][0].sessions.at(-1).date).toBe("2099-02-10");
});
it.each(["owner", "storage", "editor"] as const)("a readiness confirmation callback cannot borrow a replacement %s", async kind => {
  await requirePlanReadiness();
  const oldConfirm = buttons("I’m ready to train today")[0].props.onPress;
  if (kind === "editor") { await openSession("today"); await act(async () => buttons("Move this session")[0].props.onPress()); }
  else {
    if (kind === "owner") fixture.owner = "owner-B"; else fixture.epoch += 1;
    await act(async () => renderer!.update(createElement(QueryClientProvider, { client: cache }, createElement(Plan)))); await settle();
  }
  await act(async () => oldConfirm()); await settle();
  expect(fixture.setReadiness).not.toHaveBeenCalled();
});
it("a held readiness acknowledgment preserves a newly opened date editor", async () => {
  await requirePlanReadiness();
  let finish!: () => void;
  fixture.setReadiness.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => { buttons("I’m ready to train today")[0].props.onPress(); });
  // Open another session's date editor while the confirmation is held.
  await openSession("today");
  await act(async () => buttons("Move this session")[0].props.onPress());
  await act(async () => finish()); await settle();
  expect(buttons("Save new date")).toHaveLength(1);
  expect(renderer!.root.findAllByType("Field" as never).find(node => node.props.label === "New date · YYYY-MM-DD")!.props.value).toBe(dateInTimezone(new Date(), "UTC"));
  expect(fixture.updateProgram).toHaveBeenCalledTimes(1);
});


it("Plan refetches only stale queries on return and every query when pulled down", async () => {
  let now = Date.parse("2026-10-19T08:00:00Z");
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  try {
    await mountPlan();
    const calls = () => [fixture.programs, fixture.sessions, fixture.profile].map((mock) => mock.mock.calls.length);
    expect(calls()).toEqual([1, 1, 1]);
    const foreground = async () => { await act(async () => { for (const listener of [...fixture.appListeners]) listener("active"); }); await settle(); };
    await foreground();
    expect(calls()).toEqual([1, 1, 1]); // Fresh data is left alone.
    // Programs and profile were refreshed recently; only sessions (e.g. recorded on another device) went stale.
    now += 31_000;
    for (const key of [["owner-A", "programs", 1], ["owner-A", "profile", 1]])
      await act(async () => { cache.setQueryData(key, cache.getQueryData(key), { updatedAt: now - 1_000 }); });
    await settle();
    await foreground();
    expect(calls()).toEqual([1, 2, 1]);
    const screen = () => renderer!.root.findAllByType("Screen" as never)[0];
    await act(async () => screen().props.onRefresh()); await settle();
    expect(calls()).toEqual([2, 3, 2]);
    expect(screen().props.refreshing).toBe(false);
  } finally { clock.mockRestore(); }
});

it("Train leads with Resume during active training and only explains blocked starts", async () => {
  const { router } = await import("expo-router");
  fixture.active = { workout: { title: "In progress" }, actuals: [] };
  await mountPlan();
  expect(renderer!.root.findAllByType("Screen" as never)[0].props.title).toBe("Today");
  expect(buttons("Start")).toHaveLength(0); expect(buttons("Start session")).toHaveLength(0);
  await act(async () => buttons("Resume")[0].props.onPress());
  expect(router.push).toHaveBeenLastCalledWith("/training");
  await openSession("future");
  expect(buttons("Start session")[0].props.disabled).toBe(true);
  expect(text()).toContain("Finish your current session first.");
});

it("Train shows today's session once, folds past weeks and keeps old Today links working", async () => {
  fixture.sessions.mockResolvedValue([{ id: "saved", client_session_id: "client", generation: 1, content: { client_session_id: "client",
    program_id: "plan", program_session_id: "past", status: "completed", started_at: "2020-01-01T00:00:00Z", actuals: [{ completed: true }],
    prescription_snapshot: { blocks: [] } } }]);
  await mountPlan();
  expect(buttons("Start")).toHaveLength(1); // Today's session starts from the top only.
  expect(buttons("Start session")).toHaveLength(0);
  const weeks = renderer!.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityState);
  expect(weeks.map((w) => w.props.accessibilityState.expanded)).toEqual([false, true, true]); // The finished past week folds away.
  await act(async () => { renderer = create(createElement(TodayRoute)); });
  expect(renderer!.root.findByType("Redirect" as never).props.href).toEqual({ pathname: "/(tabs)/train", params: { id: "saved-session" } });
});


it("keeps the existing Coach entry reachable from Today", async () => {
  const { router } = await import("expo-router");
  fixture.available = true;
  await mount();
  const coach = renderer!.root.findAll(node => String(node.type) === "ListRow").find(node => node.props.title === "Ask Coach")!;
  expect(coach.props.icon).toBe("chatbubble-ellipses-outline");
  await act(async () => coach.props.onPress());
  expect(router.push).toHaveBeenLastCalledWith("/coach");
});

it("the Today hero gives each state one clear next step", async () => {
  const { router } = await import("expo-router");
  fixture.available = true;
  const remount = async () => { if (renderer) await act(async () => renderer!.unmount()); cache.clear(); await mount(); };
  fixture.profile.mockResolvedValue(null);
  await mount();
  expect(text()).toContain("Set up your training");
  await act(async () => buttons("Build a plan")[0].props.onPress());
  expect(router.push).toHaveBeenLastCalledWith({ pathname: "/profile", params: { return_to: "build-plan" } });
  fixture.profile.mockResolvedValue(profile);
  await remount();
  expect(text()).toContain("No plan yet");
  await act(async () => buttons("Build a plan")[0].props.onPress());
  expect(router.push).toHaveBeenLastCalledWith("/build-plan");
  await act(async () => buttons("Pick a workout from your library")[0].props.onPress());
  expect(router.push).toHaveBeenLastCalledWith("/(tabs)/library");
  const plan = (date: string, title: string) => ({ id: "plan", generation: 1, revision: 1, status: "ready",
    sessions: [{ id: "s", date, purpose: "Strength day", workout: { title, estimated_minutes: 30 } }] }) as Program;
  fixture.programs.mockResolvedValue([plan("2099-01-01", "Future strength")]);
  await remount();
  expect(text()).toContain("Rest day"); expect(text()).toContain("Future strength");
  expect(buttons("Start")).toHaveLength(0);
  fixture.programs.mockResolvedValue([plan(dateInTimezone(new Date(), "UTC"), "Today strength")]);
  await remount();
  expect(text()).toContain("Today strength");
  await act(async () => buttons("Start")[0].props.onPress()); await settle();
  expect(fixture.start).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenLastCalledWith("/training");
});

it("partly recorded work today settles the hero instead of offering a second Start", async () => {
  fixture.available = true;
  const today = dateInTimezone(new Date(), "UTC");
  fixture.programs.mockResolvedValue([{ id: "plan", generation: 1, revision: 1, status: "ready", sessions: [
    { id: "today", date: today, purpose: "Strength", workout: { title: "Today strength" } },
    { id: "missed", date: "2020-01-01", purpose: "Strength", workout: { title: "Earlier strength" } }] } as Program]);
  fixture.sessions.mockResolvedValue(["today", "missed"].map((id) => ({ id, client_session_id: id, generation: 1, content: {
    client_session_id: id, program_id: "plan", program_session_id: id, status: "partial", started_at: `${today}T00:00:00Z`,
    actuals: [{ completed: true }, { completed: false }], prescription_snapshot: { blocks: [] } } })));
  await mount();
  expect(buttons("Start")).toHaveLength(0);
  expect(text()).toContain("Done for today");
  expect(text()).not.toContain("a new date. Tap one below");
});

it("keeps a saved missed-session receipt reachable after all missed sessions have moved", async () => {
  const { dayAdjustments } = await import("./day-adjustments");
  const p = { id: "shifted", title: "Shifted plan", revision: 2, generation: 1, sessions: [], status: "ready" } as unknown as Program;
  await dayAdjustments({ isCurrent: () => true, getItem: async key => fixture.drafts.get(key) ?? null, setItem: async (key, value) => { fixture.drafts.set(key, value); }, removeItem: async key => { fixture.drafts.delete(key); } }, fixture.owner, 1).save({ owner: fixture.owner, generation: 1, program: p, proposal: { id: "shift-receipt", proposal: { state: "accepted", status: "ready", session_ids: [], questions: [], before: { proposal: { sessions: [] } }, program: { proposal: { sessions: [] } } } }, state: "accepted", pending: null });
  fixture.available = true; await mount();
  expect(buttons("Missed sessions")).toHaveLength(0);
  expect(buttons("Review saved adjustment · Shifted plan")).toHaveLength(1);
});

it("Train retains cached plan rows after a refetch error and recovers on retry", async () => {
  fixture.available = true;
  const workout: Workout = { id: "workout", revision: 1, generation: 1, title: "Cached workout", kind: "session", provenance: "user", blocks: [] };
  const program: Program = { id: "cached-plan", title: "Cached plan", generation: 1, revision: 1, status: "ready", questions: [], warnings: [], assumptions: [], source_ids: [], rule_version: "test", sessions: [{ id: "cached-day", date: "2099-01-01", purpose: "Strength", workout }] };
  fixture.programs.mockResolvedValue([program]);
  await act(async () => { renderer = create(createElement(QueryClientProvider, { client: cache }, createElement(Plan))); }); await settle();
  const rows = () => renderer!.root.findAll((n) => String(n.type) === "IconButton" && n.props.label === "More actions for Cached plan");
  expect(rows()).toHaveLength(1);
  fixture.programs.mockRejectedValueOnce(Error("Offline"));
  await act(async () => { await cache.invalidateQueries({ queryKey: [fixture.owner, "programs", 1] }); }); await settle();
  expect(text()).toContain("Showing your saved content");
  expect(rows()).toHaveLength(1);
  await retry();
  expect(rows()).toHaveLength(1);
});
