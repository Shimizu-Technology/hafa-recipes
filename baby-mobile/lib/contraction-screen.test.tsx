import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type Mutation } from "./models";
import { pendingRecords } from "./outbox";

const scope = vi.hoisted(() => ({ careError: "", account: null as any, toast: vi.fn(), open: vi.fn(async () => undefined), push: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable", useWindowDimensions: () => ({ fontScale: 1 }), Linking: { openURL: scope.open },
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } }));
vi.mock("expo-router", () => ({ router: { push: scope.push }, useFocusEffect: () => undefined }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `id-${++id}` }; });
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/contractions", () => import("./contractions"));
vi.mock("@/lib/medical-wording", () => import("./medical-wording"));
vi.mock("@/lib/quick-care", () => import("./quick-care"));
vi.mock("@/lib/session-actions", () => import("./session-actions"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/feed-timer", () => import("./feed-timer"));
vi.mock("@/lib/running-feed", () => ({ finishTimer: vi.fn() }));
vi.mock("@/lib/today-care", () => ({ useTodayCare: () => ({ all: pendingRecords(scope.account.state), rows: [], loading: false, error: scope.careError ?? "", refresh: vi.fn() }) }));
const ui = vi.hoisted(() => ({ Button: "Button", Card: "Card", Copy: "Copy", Empty: "Empty", Grouped: "Grouped", Icon: "Icon", Notice: "Notice", PressTarget: "Pressable", Row: "Row", Screen: "Screen", Section: "Section",
  fonts: {}, radii: {}, tap: () => undefined, typeScale: {}, useColors: () => ({}), useToast: () => scope.toast }));
vi.mock("@/components/ui", () => ui);
vi.mock("../components/ui", () => ui);
vi.mock("@/components/care-glance", () => ({ useMinuteClock: () => new Date() }));
vi.mock("@/components/feed-timer", async () => {
  const { useRef } = await import("react");
  // As the real one: it stops moving when asked not to tick.
  return { useSecondClock: (running: boolean) => { const held = useRef(new Date()); if (running) held.current = new Date(); return held.current; } };
});
vi.mock("@/components/doctor-note", () => import("../components/doctor-note"));
vi.mock("@/components/medical-source", () => import("../components/medical-source"));
vi.mock("@/components/sync-status", () => ({ SyncStatus: "SyncStatus" }));
import Contractions from "../app/contractions";

const start = new Date("2026-11-05T02:00:00.000Z");
let renderer: ReactTestRenderer | undefined;
function setup() {
  const b = {
    get records() { return pendingRecords(b.state); },
    state: { ...emptyState(), bootstrap: { generation: 2, active: true, ai_available: false, children: [{ id: "baby", name: "Mia", revision: 1, due_date: "2026-12-10" }],
      profile: { display_name: "K", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState,
    commit: vi.fn(async (change: (state: DeviceState) => DeviceState) => { b.state = change(b.state); }),
    queue: vi.fn(async (m: Mutation) => { b.state = { ...b.state, outbox: [...b.state.outbox, m] }; }),
    sync: vi.fn(async () => undefined),
    api: { search: vi.fn(async () => ({ items: [] as BabyRecord[], total: 0, has_more: false })) },
  };
  scope.account = b;
  return b;
}
const mount = () => act(async () => { renderer = create(<Contractions />); });
const refresh = () => act(async () => renderer!.update(<Contractions />));
const target = (label: string) => renderer!.root.findAll((n) => String(n.type) === "Pressable").find((n) => String(n.props.accessibilityLabel).startsWith(label));
const words = () => renderer!.root.findAll((n) => ["Copy", "Text", "Notice"].includes(String(n.type))).map((n) => [n.props.children].flat().join("")).join(" | ");
const saves = () => scope.account.state.outbox.filter((m: Mutation) => m.type === "save") as Extract<Mutation, { type: "save" }>[];
const stops = () => scope.account.state.outbox.filter((m: Mutation) => m.type === "session_action") as Extract<Mutation, { type: "session_action" }>[];
const running = (id: string, minutes = 0): BabyRecord => ({ ...optimisticRecord({ id, kind: "contraction", title: "Contraction", body: "", child_id: "baby", occurred_at: new Date(start.getTime() - minutes * 60_000).toISOString(), data: {} }), revision: 1 });
const button = (title: string) => renderer!.root.findAll((n) => String(n.type) === "Button").filter((n) => n.props.title === title);

beforeEach(() => {
  vi.useFakeTimers({ now: start });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  scope.toast.mockClear(); scope.open.mockClear(); scope.push.mockClear();
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("saves on Start and on Stop, as one record, with Undo, in a big target", async () => {
  setup();
  await mount();
  expect(target("Start")!.props.style.minHeight).toBeGreaterThanOrEqual(120);
  await act(async () => { await target("Start")!.props.onPress(); });
  await refresh();
  expect(saves()).toHaveLength(1);
  expect(saves()[0].record).toMatchObject({ kind: "contraction", child_id: "baby", title: "Contraction", occurred_at: start.toISOString(), data: {} });
  expect(scope.toast.mock.lastCall![1].label).toBe("Undo");
  await act(async () => { vi.advanceTimersByTime(45_000); });
  await act(async () => { await target("Stop")!.props.onPress(); });
  await refresh();
  // The stop is its own durable change with its own identity, not an edit that could conflict.
  expect(saves()).toHaveLength(1);
  expect(stops()).toEqual([expect.objectContaining({ record_id: saves()[0].record.id, action: expect.objectContaining({ action: "finish", at: new Date(start.getTime() + 45_000).toISOString() }) })]);
  expect(pendingRecords(scope.account.state)[0].data.end_at).toBe(new Date(start.getTime() + 45_000).toISOString());
  expect(target("Start")).toBeDefined();
  expect(words()).toContain("1 in the last hour · about 45 sec long");
});

it("takes back the stop on Undo, with its own identity, even after the stop has gone out", async () => {
  setup();
  await mount();
  await act(async () => { await target("Start")!.props.onPress(); }); await refresh();
  await act(async () => { await target("Stop")!.props.onPress(); }); await refresh();
  await act(async () => { await scope.toast.mock.lastCall![1].onPress(); }); await refresh();
  expect(stops().map((m) => m.action.action)).toEqual(["finish", "undo"]);
  expect(stops()[1].action.target).toBe(stops()[0].id);
  expect(target("Stop")).toBeDefined();
});

it("keeps the last hour moving after a stop, as older ones drop out", async () => {
  setup();
  await mount();
  await act(async () => { await target("Start")!.props.onPress(); }); await refresh();
  await act(async () => { vi.advanceTimersByTime(45_000); });
  await act(async () => { await target("Stop")!.props.onPress(); }); await refresh();
  expect(words()).toContain("1 in the last hour");
  await act(async () => { vi.advanceTimersByTime(60 * 60_000); }); await refresh();
  expect(words()).toContain("None in the last hour");
});

it("keeps two overlapping contractions in reach, and either can be stopped", async () => {
  const b = setup();
  b.state = { ...b.state, records: [running("mine", 1), running("theirs", 2)] };
  await mount();
  // The big button stops the newest. The other is named beside it, not hidden.
  expect(target("Stop")).toBeDefined();
  expect(words()).toContain("Another one is still timing");
  await act(async () => { await button("Stop this one")[0].props.onPress(); }); await refresh();
  expect(stops()).toEqual([expect.objectContaining({ record_id: "theirs" })]);
  expect(button("Stop this one")).toEqual([]);
  await act(async () => { await target("Stop")!.props.onPress(); }); await refresh();
  expect(stops().map((m) => m.record_id)).toEqual(["theirs", "mine"]);
  expect(target("Start")).toBeDefined();
});

describe("the doctor note", () => {
  const note = (id: string, child: string, body: string): BabyRecord => ({ ...optimisticRecord({ id, kind: "journal", title: "What my doctor told me", body, child_id: child, occurred_at: start.toISOString(), data: { provenance: "clinician_instruction" } }), revision: 1 });
  const field = () => renderer!.root.findAll((n) => String(n.type) === "TextInput")[0];
  const sisters = (b: ReturnType<typeof setup>, selected: string) => {
    b.state = { ...b.state, selectedChild: selected, bootstrap: { ...b.state.bootstrap!, children: [{ id: "baby", name: "Mia", revision: 1, due_date: "2026-12-10" }, { id: "sister", name: "Noa", revision: 1, due_date: "2026-12-10" }] } };
  };
  it("never shows or overwrites another baby's", async () => {
    const b = setup();
    sisters(b, "baby");
    b.state = { ...b.state, records: [note("theirs", "sister", "Sister's note")] };
    await mount();
    expect(field().props.value).toBe("");
    await act(async () => field().props.onChangeText("Mia's note"));
    await act(async () => field().props.onBlur());
    expect(saves()[0].record).toMatchObject({ child_id: "baby", body: "Mia's note" });
    expect(saves()[0].record.id).not.toBe("theirs");
  });
  it("looks for this baby's only", async () => {
    const b = setup();
    sisters(b, "baby");
    b.api.search = vi.fn(async () => ({ items: [note("theirs", "sister", "Sister's note")], total: 1, has_more: false }));
    await mount();
    expect(b.api.search).toHaveBeenCalledWith("What my doctor told me", "journal", "baby", { limit: 5 });
    expect(b.state.records.some((row) => row.id === "theirs")).toBe(false);
  });
  it("saves what's typed to the baby it was typed for, and starts from the other's when the baby changes", async () => {
    const b = setup();
    sisters(b, "baby");
    b.state = { ...b.state, records: [note("theirs", "sister", "Sister's note")] };
    await mount();
    await act(async () => field().props.onChangeText("Half typed for Mia"));
    b.state = { ...b.state, selectedChild: "sister" };
    await refresh();
    expect(field().props.value).toBe("Sister's note");
    expect(saves()[0].record).toMatchObject({ child_id: "baby", body: "Half typed for Mia" });
    expect(pendingRecords(b.state).find((row) => row.id === "theirs")?.body).toBe("Sister's note");
  });
});

it("starts once on a double tap", async () => {
  setup();
  await mount();
  await act(async () => { const press = target("Start")!.props.onPress; void press(); void press(); });
  expect(saves()).toHaveLength(1);
});

it("shows no rule, no go-to-hospital wording, and no text of ours under 37 weeks; only CDC's words, attributed and linked", async () => {
  setup();
  await mount();
  const all = words();
  expect(all).not.toMatch(/hospital|preterm|37 weeks|call your|go in|water has broken/i);
  expect(all).toContain("Urgent maternal warning signs, during pregnancy and in the year after delivery.");
  expect(all).toContain("CDC, Hear Her: Urgent Maternal Warning Signs");
  await act(async () => { target("Source: CDC")!.props.onPress(); });
  expect(scope.open).toHaveBeenCalledWith("https://www.cdc.gov/hearher/maternal-warning-signs/index.html");
});

it("keeps what her doctor told her as one private entry labelled a clinician instruction, offline too", async () => {
  const b = setup();
  await mount();
  const field = () => renderer!.root.findAll((n) => String(n.type) === "TextInput")[0];
  expect(field().props.accessibilityLabel).toBe("What my doctor told me");
  await act(async () => field().props.onChangeText("Call the office at 5 minutes apart"));
  await act(async () => field().props.onBlur());
  expect(saves()[0].record).toMatchObject({ kind: "journal", title: "What my doctor told me", body: "Call the office at 5 minutes apart", data: { provenance: "clinician_instruction" } });
  await refresh();
  await act(async () => field().props.onChangeText("Call at 4 minutes apart"));
  await act(async () => field().props.onBlur());
  expect(saves()).toHaveLength(2);
  expect(saves()[1].record.id).toBe(saves()[0].record.id);
  expect(b.records.filter((row: BabyRecord) => row.kind === "journal")).toHaveLength(1);
  await refresh();
  await act(async () => field().props.onBlur());
  expect(saves()).toHaveLength(2);
});

it("saves a note she leaves mid-typing, and finds one from another phone", async () => {
  const b = setup();
  const remote = optimisticRecord({ id: "note", kind: "journal", title: "What my doctor told me", body: "From the other phone", child_id: "baby", occurred_at: start.toISOString(), data: { provenance: "clinician_instruction" } });
  b.api.search.mockResolvedValueOnce({ items: [remote], total: 1, has_more: false });
  await mount();
  await refresh();
  expect(renderer!.root.findAll((n) => String(n.type) === "TextInput")[0].props.value).toBe("From the other phone");
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "TextInput")[0].props.onChangeText("Changed, then left"));
  await act(async () => renderer!.unmount());
  renderer = undefined;
  expect(saves()[0].record).toMatchObject({ id: "note", body: "Changed, then left" });
});

it("leaves being offline to the one calm line, and still says when something else went wrong", async () => {
  const account = setup() as ReturnType<typeof setup> & { unreachable?: boolean; online?: boolean };
  scope.careError = "Could not connect.";
  account.unreachable = true;
  await mount();
  const notices = () => JSON.stringify(renderer!.toJSON());
  expect(notices()).not.toContain("Could not connect.");
  await act(async () => renderer!.unmount());
  account.unreachable = false; account.online = false;
  await mount();
  expect(notices()).not.toContain("Could not connect.");
  await act(async () => renderer!.unmount());
  account.online = true;
  scope.careError = "Something else went wrong.";
  await mount();
  expect(notices()).toContain("Something else went wrong.");
  scope.careError = "";
});
