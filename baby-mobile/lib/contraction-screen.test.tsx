import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type Mutation } from "./models";
import { pendingRecords } from "./outbox";

const scope = vi.hoisted(() => ({ account: null as any, toast: vi.fn(), open: vi.fn(async () => undefined), push: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable", useWindowDimensions: () => ({ fontScale: 1 }), Linking: { openURL: scope.open },
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } }));
vi.mock("expo-router", () => ({ router: { push: scope.push }, useFocusEffect: () => undefined }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `id-${++id}` }; });
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/contractions", () => import("./contractions"));
vi.mock("@/lib/medical-wording", () => import("./medical-wording"));
vi.mock("@/lib/quick-care", () => import("./quick-care"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/feed-timer", () => import("./feed-timer"));
vi.mock("@/lib/running-feed", () => ({ finishTimer: vi.fn() }));
vi.mock("@/lib/today-care", () => ({ useTodayCare: () => ({ all: pendingRecords(scope.account.state), rows: [], loading: false, error: "", refresh: vi.fn() }) }));
const ui = vi.hoisted(() => ({ Button: "Button", Card: "Card", Copy: "Copy", Empty: "Empty", Grouped: "Grouped", Icon: "Icon", Notice: "Notice", PressTarget: "Pressable", Row: "Row", Screen: "Screen", Section: "Section",
  fonts: {}, radii: {}, tap: () => undefined, typeScale: {}, useColors: () => ({}), useToast: () => scope.toast }));
vi.mock("@/components/ui", () => ui);
vi.mock("../components/ui", () => ui);
vi.mock("@/components/care-glance", () => ({ useMinuteClock: () => new Date() }));
vi.mock("@/components/feed-timer", () => ({ useSecondClock: () => new Date() }));
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
  expect(saves().at(-1)!.record.data.end_at).toBe(new Date(start.getTime() + 45_000).toISOString());
  expect(saves().at(-1)!.record.id).toBe(saves()[0].record.id);
  expect(target("Start")).toBeDefined();
  expect(words()).toContain("1 in the last hour · about 45 sec long");
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
