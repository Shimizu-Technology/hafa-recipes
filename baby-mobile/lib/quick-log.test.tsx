import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type DeviceState, type Mutation } from "./models";
import { pendingRecords } from "./outbox";

const scope = vi.hoisted(() => ({ reader: false, account: null as any, toast: vi.fn(), taps: [] as string[], fontScale: 1, announced: [] as string[], details: true }));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Pressable: "Pressable", TextInput: "TextInput", ScrollView: "ScrollView", useWindowDimensions: () => ({ fontScale: scope.fontScale }),
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  Alert: { alert() {} },
  AccessibilityInfo: { isScreenReaderEnabled: async () => scope.reader, announceForAccessibility: (text: string) => scope.announced.push(text) },
  Animated: { View: "AnimatedView", Value: class { setValue() {} stopAnimation() {} }, timing: () => ({ start(done?: (result: { finished: boolean }) => void) { done?.({ finished: true }); } }) },
}));
vi.mock("expo-router", () => ({ router: { push: vi.fn() }, useFocusEffect: () => undefined }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `id-${++id}` }; });
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/care-glance", () => import("./care-glance"));
vi.mock("@/lib/feed-timer", () => import("./feed-timer"));
vi.mock("@/lib/running-feed", () => import("./running-feed"));
vi.mock("@/lib/feed-reducer", () => import("./feed-reducer"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/quick-care", () => import("./quick-care"));
vi.mock("@/lib/outbox", () => import("./outbox"));
vi.mock("@/lib/api", () => ({ get sendsCareDetails() { return scope.details; } }));
vi.mock("../components/date-field", () => ({ DateField: "DateField" }));
vi.mock("../components/ui", () => ({ PressTarget: "Pressable", Icon: "Icon", Button: "Button", Card: "Card", Copy: "Copy", easeOut: () => 0,
  fonts: {}, radii: {}, typeScale: { footnote: { fontSize: 14 } }, useColors: () => ({}), useToast: () => scope.toast, tap: (kind = "select") => scope.taps.push(kind) }));
vi.mock("../components/motion", () => ({ useReducedMotion: () => false }));
import { QuickLog, quickTarget } from "../components/quick-log";
import { amendCare, careWrite } from "./quick-care";
import { boundFeed, feedWrite, finishFeed, finishTimer, startFeed, switchFeed, undoWindow } from "./running-feed";
import { CareGlance } from "../components/care-glance";
import { runningFeed, runningLimit } from "./feed-reducer";

const start = new Date("2026-11-04T17:00:00.000Z");
const child = { id: "baby", name: "Mia", revision: 1, birth_date: "2026-11-01" };
let renderer: ReactTestRenderer | undefined;
function setup() {
  const b = {
    get records() { return pendingRecords(b.state); },
    state: { ...emptyState(), bootstrap: { generation: 2, active: true, ai_available: false, children: [child],
      profile: { display_name: "K", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState,
    commit: vi.fn(async (change: (state: DeviceState) => DeviceState) => { b.state = change(b.state); }),
    queue: vi.fn(async (m: Mutation) => { b.state = { ...b.state, outbox: [...b.state.outbox, m] }; }),
    sync: vi.fn(async () => undefined),
  };
  scope.account = b;
  return b;
}
const breast = (id: string, side: "left" | "right" | "both", at = "2026-11-04T15:00:00.000Z") => ({ id, kind: "feeding", title: "Feeding", body: "", child_id: "baby",
  occurred_at: at, data: { method: "breast", side }, revision: 1, created_at: at, updated_at: at }) as BabyRecord;
const view = (rows: BabyRecord[]) => <QuickLog child={child} rows={[...pendingRecords(scope.account.state), ...rows]} now={new Date()} />;
async function mount(rows: BabyRecord[] = []) { await act(async () => { renderer = create(view(rows)); }); }
async function refresh(rows: BabyRecord[] = []) { await act(async () => renderer!.update(view(rows))); }
const targets = () => renderer!.root.findAll((n) => String(n.type) === "Pressable");
const target = (label: string) => targets().find((n) => n.props.accessibilityLabel === label || n.props.accessibilityLabel?.startsWith(`${label},`));
async function press(label: string, rows: BabyRecord[] = []) {
  const node = target(label);
  expect(node, label).toBeDefined();
  await act(async () => { await node!.props.onPress(); });
  await refresh(rows);
}
const texts = () => renderer!.root.findAll((n) => String(n.type) === "Text").map((n) => [n.props.children].flat().join(""));
const lastSave = () => saves().at(-1)!.record;
const saves = () => scope.account.state.outbox.filter((m: Mutation) => m.type === "save") as Extract<Mutation, { type: "save" }>[];

beforeEach(() => {
  vi.useFakeTimers({ now: start });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scope.reader = false; scope.toast.mockClear(); scope.taps = []; scope.fontScale = 1; scope.announced = []; scope.details = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("saves a left feed in two taps: inline sides with next highlighted, no system sheet, haptic and Undo", async () => {
  const b = setup(), rows = [breast("last", "right")];
  await mount(rows);
  expect(target("Left")).toBeUndefined();
  await press("Breastfeed", rows);
  // Opposite of the side the last feed started on, marked in words as well as colour.
  expect(target("Left, Next")?.props.accessibilityLabel).toBe("Left, Next");
  expect(target("Right")?.props.accessibilityLabel).toBe("Right");
  expect(target("Both")).toBeDefined();
  expect(b.state.outbox).toEqual([]);
  await press("Left, Next", rows);
  expect(saves()).toHaveLength(1);
  expect(saves()[0].record).toMatchObject({ kind: "feeding", child_id: "baby", occurred_at: start.toISOString(),
    data: { method: "breast", side: "left", state: "running", actions: [{ action: "start", at: start.toISOString(), side: "left" }] } });
  expect(b.commit).toHaveBeenCalledOnce();
  expect(scope.taps.at(-1)).toBe("success");
  expect(target("Left")).toBeUndefined();
  expect(target("Undo Left")).toBeDefined();
  expect(texts()).toContain("You can put the phone down. It stays saved.");
  expect(b.state.feedTimer).toBeUndefined();
});

it("saves through the outbox with no connection, so airplane mode changes nothing", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Right");
  expect(pendingRecords(b.state).map((r) => r.data.side)).toEqual(["right"]);
  expect(texts().some((t) => t.startsWith("Right · 00:00"))).toBe(true);
  expect(b.state.outbox.map((m) => m.type)).toEqual(["save"]);
});

it("saves Both finished, with no duration and no running card", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Both");
  expect(saves()[0].record.data).toEqual({ method: "breast", side: "both" });
  expect(target("Done")).toBeUndefined();
});

const feedActions = () => scope.account.state.outbox.filter((m: Mutation) => m.type === "feed_action") as Extract<Mutation, { type: "feed_action" }>[];

it("switches and finishes through durable actions behind the record: both sides, a duration only once finished", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Left");
  const id = saves()[0].record.id;
  expect(saves()[0].record.data.duration_minutes).toBeUndefined();
  vi.setSystemTime(start.getTime() + 5 * 60_000);
  await press("Switch to Right");
  expect(feedActions().map((m) => m.action.action)).toEqual(["switch"]);
  expect(feedActions()[0]).toMatchObject({ record_id: id, action: { side: "right", at: new Date(start.getTime() + 5 * 60_000).toISOString() } });
  expect(texts().some((t) => t.startsWith("Left 05:00"))).toBe(true);
  vi.setSystemTime(start.getTime() + 8 * 60_000);
  await press("Done");
  expect(pendingRecords(b.state)).toHaveLength(1);
  expect(pendingRecords(b.state)[0]).toMatchObject({ occurred_at: start.toISOString(), data: { state: "finished", side: "both", duration_minutes: 8 } });
  expect(target("Done")).toBeUndefined();
  expect(saves()).toHaveLength(1);
});

it("undoes each step: start removes the record, switch and done are taken back before they leave the phone", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Left");
  await press("Undo Left");
  expect(pendingRecords(b.state)).toEqual([]);
  b.state = { ...b.state, outbox: [] };

  await refresh();
  await press("Breastfeed");
  await press("Left");
  vi.setSystemTime(start.getTime() + 60_000);
  await press("Switch to Right");
  await press("Undo Switched to Right");
  expect(feedActions()).toEqual([]);
  expect(pendingRecords(b.state)[0].data.side).toBe("left");
  vi.setSystemTime(start.getTime() + 3 * 60_000);
  await press("Done");
  expect(pendingRecords(b.state)[0].data.state).toBe("finished");
  const undo = targets().find((n) => n.props.accessibilityLabel?.startsWith("Undo Breastfeeding"));
  await act(async () => { await undo!.props.onPress(); });
  await refresh();
  expect(feedActions()).toEqual([]);
  expect(pendingRecords(b.state)[0].data.state).toBe("running");
  expect(pendingRecords(b.state)[0].data.duration_minutes).toBeUndefined();
  expect(target("Done")).toBeDefined();
});

it("says so when a finished feed has already reached the server, and switches back when a switch has", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Left");
  vi.setSystemTime(start.getTime() + 60_000);
  await press("Switch to Right");
  b.state = { ...b.state, outbox: b.state.outbox.filter((m) => m.type !== "feed_action"),
    records: [{ ...pendingRecords(b.state)[0], data: { method: "breast", side: "both", state: "running", actions: [
      ...saves()[0].record.data.actions!, { id: "sent", action: "switch", at: new Date().toISOString(), side: "right" }] } }] };
  await press("Undo Switched to Right");
  expect(feedActions()).toEqual([expect.objectContaining({ action: expect.objectContaining({ action: "switch", side: "left" }) })]);
  await refresh();
  vi.setSystemTime(start.getTime() + 2 * 60_000);
  await refresh();
  await press("Done");
  b.state = { ...b.state, outbox: [] };
  const undo = targets().find((n) => n.props.accessibilityLabel?.startsWith("Undo Breastfeeding"));
  await act(async () => { await undo!.props.onPress(); });
  expect(scope.toast).toHaveBeenCalledWith("This feed is already finished. You can change it in Tracker.");
});

it("keeps two taps in one frame from saving twice", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  const left = target("Left")!;
  await act(async () => { void left.props.onPress(); void left.props.onPress(); });
  expect(saves()).toHaveLength(1);
});

it("stops showing a feed as running after an hour, saved with no duration", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Left");
  expect(runningFeed(pendingRecords(b.state), "baby", new Date(start.getTime() + runningLimit - 1))).toBeDefined();
  expect(runningFeed(pendingRecords(b.state), "baby", new Date(start.getTime() + runningLimit))).toBeUndefined();
  vi.setSystemTime(start.getTime() + runningLimit);
  await refresh();
  expect(target("Done")).toBeUndefined();
  expect(pendingRecords(b.state)[0].data.duration_minutes).toBeUndefined();
});

it("shows a feed the other phone started, and finishes it from here", async () => {
  const b = setup(), startedElsewhere = { ...breast("elsewhere", "right", start.toISOString()),
    data: { method: "breast", side: "right", state: "running", actions: [{ id: "a1", action: "start", at: start.toISOString(), side: "right" }] } } as BabyRecord;
  b.state = { ...b.state, records: [startedElsewhere] };
  await mount();
  expect(texts().some((t) => t.startsWith("Right · 00:00"))).toBe(true);
  vi.setSystemTime(start.getTime() + 4 * 60_000);
  await press("Done");
  expect(feedActions()[0]).toMatchObject({ record_id: "elsewhere", action: { action: "finish" } });
  expect(pendingRecords(b.state)[0].data).toMatchObject({ state: "finished", duration_minutes: 4 });
});

it("moves a running feed's start with the time chip, and the clock follows", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Left");
  const chip = targets().find((n) => n.props.accessibilityLabel?.startsWith("Change time,"))!;
  await act(async () => chip.props.onPress());
  await refresh();
  await press("5 min ago");
  const moved = new Date(start.getTime() - 5 * 60_000).toISOString();
  expect(pendingRecords(b.state)[0]).toMatchObject({ occurred_at: moved, data: { actions: [{ action: "start", at: moved }] } });
  expect(texts().some((t) => t.startsWith("Left · 05:00"))).toBe(true);
});

it("leaves an older timer to finish on its own card first", async () => {
  const b = setup();
  b.state = { ...b.state, feedTimer: { child_id: "baby", generation: 2, started_at: start.toISOString(), segments: [{ side: "left", started_at: start.toISOString() }] } };
  await act(async () => { renderer = create(<QuickLog child={child} rows={[]} now={new Date()} />); });
  expect(target("Done")).toBeUndefined();
  await press("Feeding");
  expect(target("Left")).toBeUndefined();
  expect(scope.toast).toHaveBeenCalledWith(expect.stringContaining("timer is running"));
});

it("gives every night target at least 56pt; only the optional time chip is smaller, at 44pt", async () => {
  setup();
  await mount();
  const check = () => {
    for (const node of targets().filter((n) => n.props.accessibilityLabel !== undefined)) {
      const label: string = node.props.accessibilityLabel;
      expect(node.props.style.minHeight, label).toBeGreaterThanOrEqual(label.startsWith("Change time") ? 44 : quickTarget);
    }
  };
  for (const tile of ["Breastfeed", "Bottle", "Diaper", "Sleep"]) { await press(tile); check(); }
  await press("Breastfeed");
  await press("Left");
  check();
});

it("clears what saved on its own, and Undo goes with it", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Both");
  expect(target("Undo Both sides")).toBeDefined();
  await act(async () => { await vi.advanceTimersByTimeAsync(5999); });
  expect(target("Undo Both sides")).toBeDefined();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(target("Undo Both sides")).toBeUndefined();
  expect(pendingRecords(b.state)).toHaveLength(1);
});

it("keeps a saved row up long enough to reach Undo with VoiceOver, and says what saved", async () => {
  const { AccessibilityInfo } = await import("react-native");
  vi.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
  setup();
  await mount();
  await press("Breastfeed");
  await press("Both");
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(target("Undo Both sides")).toBeDefined();
  expect(scope.announced).toEqual(["Both sides saved. Undo available."]);
});

it("shows last fed and next side on opening, with no tap, for eyes and VoiceOver", async () => {
  setup();
  await act(async () => { renderer = create(<CareGlance child={child} rows={[breast("last", "left")]} now={new Date()} />); });
  expect(texts()).toEqual(expect.arrayContaining(["Last fed", "Next side", "Right"]));
  const hero = targets()[0];
  expect(hero.props.accessibilityLabel).toContain("Last fed 2 h ago.");
  expect(hero.props.accessibilityLabel).toContain("Next side right.");
});
it("shows the running side on the hero while feeding, and no next side until nothing is running", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Left");
  const running = runningFeed(pendingRecords(b.state), "baby", new Date())!;
  await act(async () => renderer!.update(<CareGlance child={child} rows={pendingRecords(b.state)} now={new Date()} running={running} />));
  expect(texts()).toEqual(expect.arrayContaining(["Feeding now", "Left"]));
  expect(texts()).not.toContain("Next side");
  await act(async () => renderer!.update(<CareGlance child={child} rows={pendingRecords(b.state)} now={new Date()} />));
  expect(texts()).toEqual(expect.arrayContaining(["Next side", "Right"]));
});
it("says Just now rather than 0m ago", async () => {
  setup();
  await act(async () => { renderer = create(<CareGlance child={child} rows={[breast("now", "left", start.toISOString())]} now={new Date()} />); });
  expect(texts()).toContain("Just now");
  expect(texts().join(" ")).not.toContain("0m");
});
it("has no next side to show before the first feed, and says so plainly", async () => {
  setup();
  await act(async () => { renderer = create(<CareGlance child={child} rows={[]} now={new Date()} />); });
  expect(texts()).not.toContain("Next side");
});

const bottle = (id: string, data: Partial<BabyRecord["data"]>, at = "2026-11-04T15:00:00.000Z") => ({ id, kind: "feeding", title: "Feeding", body: "", child_id: "baby",
  occurred_at: at, data: { method: "bottle", ...data }, revision: 1, created_at: at, updated_at: at }) as BabyRecord;

it("starts a bottle from the last one and saves when a milk is chosen", async () => {
  const rows = [bottle("last", { amount: 2.5, unit: "oz", contents: "formula" })];
  setup();
  await mount(rows);
  await press("Bottle", rows);
  expect(texts()).toContain("2.5 oz");
  expect(texts()).toContain("Same as last time");
  await press("Formula", rows);
  expect(lastSave().data).toEqual({ method: "bottle", amount: 2.5, unit: "oz", contents: "formula" });
  expect(lastSave().occurred_at).toBe(start.toISOString());
  expect(target("Undo Formula, 2.5 oz")).toBeDefined();
});

it("defaults to ounces, steps the amount, and keeps the last unit used", async () => {
  setup();
  await mount();
  await press("Bottle");
  expect(texts()).toContain("3 oz");
  await press("More");
  expect(texts()).toContain("3.5 oz");
  await press("Less"); await press("Less");
  expect(texts()).toContain("2.5 oz");
  await press("2.5 oz");
  expect(texts()).toContain("80 mL");
  await press("Breast milk");
  expect(lastSave().data).toMatchObject({ amount: 80, unit: "ml", contents: "breast_milk" });
  const rows = [bottle("ml", { amount: 80, unit: "ml" })];
  await act(async () => renderer!.update(view(rows)));
  await press("Bottle", rows);
  expect(texts()).toContain("80 mL");
});

it("saves a diaper on one choice in stored words, with no sheet and no Save", async () => {
  setup();
  await mount();
  await press("Diaper");
  for (const label of ["Pee", "Poo", "Both", "Dry"]) expect(target(label), label).toBeDefined();
  await press("Pee");
  expect(lastSave()).toMatchObject({ kind: "diaper", data: { type: "wet" } });
  expect(target("Black")).toBeUndefined();
  expect(renderer!.root.findAll((n) => String(n.type) === "TextInput")).toHaveLength(1);
});

it.each([["Poo", "dirty"], ["Both", "both"]])("offers colour after %s, one tap per change, with Undo intact", async (label, type) => {
  const b = setup();
  await mount();
  await press("Diaper");
  await press(label);
  expect(lastSave().data).toEqual({ type });
  for (const colour of ["Black", "Green", "Yellow", "Brown", "Other"]) expect(target(colour), colour).toBeDefined();
  await press("Green");
  expect(pendingRecords(b.state)[0].data).toEqual({ type, color: "green" });
  expect(target("Green")!.props.accessibilityState).toEqual({ selected: true });
  // A second tap clears it with an explicit null: the API keeps a field a PATCH leaves out.
  await press("Green");
  expect(pendingRecords(b.state)[0].data).toEqual({ type, color: null });
  await press(`Undo ${label}`);
  expect(pendingRecords(b.state)).toEqual([]);
});

it("stores no colour for Other: she says what it was in the note", async () => {
  const b = setup();
  await mount();
  await press("Diaper");
  await press("Poo");
  await press("Black");
  await press("Other");
  expect(pendingRecords(b.state)[0].data.color).toBeNull();
  expect(renderer!.root.findAll((n) => String(n.type) === "TextInput")[0].props.placeholder).toBe("What colour? (optional)");
});

it("saves a note on leaving the field, as its own change, and holds the row while she writes", async () => {
  const b = setup();
  await mount();
  await press("Diaper");
  await press("Poo");
  const input = () => renderer!.root.findAll((n) => String(n.type) === "TextInput")[0];
  await act(async () => input().props.onFocus());
  await act(async () => input().props.onChangeText("  First black one  "));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(target("Undo Poo")).toBeDefined();
  await act(async () => input().props.onBlur());
  expect(pendingRecords(b.state)[0].body).toBe("First black one");
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(target("Undo Poo")).toBeUndefined();
  expect(pendingRecords(b.state)[0].body).toBe("First black one");
});

it("keeps Formula and the colour chips she picked, with Other storing no colour", async () => {
  setup();
  await mount();
  await press("Diaper");
  await press("Poo");
  expect(["Black", "Green", "Yellow", "Brown", "Red", "White", "Other"].every((label) => target(label))).toBe(true);
  await press("Red");
  expect(lastSave().data.color).toBe("red");
  await press("Other");
  expect(lastSave().data.color).toBeNull();
  await press("Bottle");
  await press("Formula");
  expect(lastSave().data).toEqual({ method: "bottle", amount: 3, unit: "oz", contents: "formula" });
});

it("starts and ends sleep from one panel, and undoes the end", async () => {
  const b = setup();
  await mount();
  await press("Sleep");
  await press("Start");
  expect(lastSave()).toMatchObject({ kind: "sleep", data: {}, occurred_at: start.toISOString() });
  vi.setSystemTime(start.getTime() + 90 * 60_000);
  await refresh();
  expect(target("Sleeping")).toBeDefined();
  await press("Sleeping");
  await press("End");
  expect(pendingRecords(b.state)[0].data.end_at).toBe(new Date(start.getTime() + 90 * 60_000).toISOString());
  await press("Undo Slept 1 h 30 min");
  expect(pendingRecords(b.state)[0].data.end_at).toBeUndefined();
});

it("stamps a log now by default, and the time chip changes it before or after saving", async () => {
  const b = setup();
  await mount();
  await press("Diaper");
  await press("Change time, Now");
  await press("15 min ago");
  await press("Pee");
  expect(lastSave().occurred_at).toBe(new Date(start.getTime() - 15 * 60_000).toISOString());
  // The next log is back to now.
  await press("Diaper");
  expect(target("Change time, Now")).toBeDefined();
  await press("Dry");
  expect(lastSave().occurred_at).toBe(start.toISOString());
  const chip = targets().find((n) => n.props.accessibilityLabel?.startsWith("Change time,"))!;
  await act(async () => chip.props.onPress());
  await refresh();
  await press("30 min ago");
  const moved = pendingRecords(b.state).find((r) => r.data.type === "dry")!;
  expect(moved.occurred_at).toBe(new Date(start.getTime() - 30 * 60_000).toISOString());
});

it("holds no health advice in anything the log shows", async () => {
  setup();
  await mount();
  await press("Diaper");
  await press("Poo");
  await press("Black");
  expect(texts().join(" ")).not.toMatch(/doctor|call|normal|meconium|expected|worry|concern/i);
});

describe("logging another day", () => {
  const pastDay = { key: "2026-11-01", timezone: "Pacific/Guam" }, noon = "2026-11-01T02:00:00.000Z";
  const past = () => <QuickLog child={child} rows={[breast("last", "left")]} now={new Date()} pastDay={pastDay} />;
  async function mountPast() { await act(async () => { renderer = create(past()); }); }
  async function tapPast(label: string) {
    const node = target(label);
    expect(node, label).toBeDefined();
    await act(async () => { await node!.props.onPress(); });
    await act(async () => renderer!.update(past()));
  }
  it("asks for the time, on that day, with the times already open", async () => {
    setup();
    await mountPast();
    await tapPast("Diaper");
    for (const label of ["8 AM", "12 PM", "4 PM", "8 PM", "11 PM", "Pick a time"]) expect(target(label), label).toBeDefined();
    expect(target("Now")).toBeUndefined();
    await tapPast("4 PM");
    await tapPast("Pee");
    expect(lastSave().occurred_at).toBe("2026-11-01T06:00:00.000Z");
  });
  it("saves nothing until she chooses a time: opening the choices isn't an answer", async () => {
    const b = setup();
    await mountPast();
    await tapPast("Diaper");
    expect(target("Change time, Choose a time")).toBeDefined();
    await tapPast("Dry");
    expect(b.state.outbox).toEqual([]);
    expect(texts()).toContain("Choose a time first.");
    await tapPast("8 PM");
    expect(texts()).not.toContain("Choose a time first.");
    await tapPast("Dry");
    expect(lastSave().occurred_at).toBe("2026-11-01T10:00:00.000Z");
  });
  it("asks on every kind: feed, bottle and sleep", async () => {
    const b = setup();
    await mountPast();
    await tapPast("Breastfeed"); await tapPast("Left");
    await tapPast("Bottle"); await tapPast("Formula");
    await tapPast("Sleep"); await tapPast("2 hr");
    expect(b.state.outbox).toEqual([]);
  });
  it("saves a left feed on that day with no running card, and no start action", async () => {
    const b = setup();
    await mountPast();
    await tapPast("Breastfeed");
    await tapPast("12 PM");
    await tapPast("Left");
    expect(lastSave()).toMatchObject({ occurred_at: noon, data: { method: "breast", side: "left" } });
    expect(lastSave().data.actions).toBeUndefined();
    expect(target("Done")).toBeUndefined();
    expect(runningFeed(pendingRecords(b.state), "baby", new Date("2026-11-01T02:30:00.000Z"))).toBeUndefined();
  });
  it("logs a sleep whole, with how long instead of Start and End", async () => {
    setup();
    await mountPast();
    await tapPast("Sleep");
    expect(target("Start")).toBeUndefined();
    await tapPast("12 PM");
    await tapPast("2 hr");
    expect(lastSave()).toMatchObject({ kind: "sleep", occurred_at: noon, data: { end_at: "2026-11-01T04:00:00.000Z" } });
  });
});

it("shrinks what just saved to one line when another log opens, so the dock never buries the page", async () => {
  setup();
  await mount();
  await press("Diaper");
  await press("Poo");
  expect(target("Green")).toBeDefined();
  await press("Bottle");
  expect(target("Green")).toBeUndefined();
  expect(renderer!.root.findAll((n) => String(n.type) === "TextInput")).toHaveLength(0);
  expect(target("Undo Poo")).toBeDefined();
  // Closing the other log brings it back, while it's still there.
  await press("Bottle");
  expect(target("Green")).toBeDefined();
});

it("keeps a note she was mid-way through when the next log saves, and starts the next row empty", async () => {
  const b = setup();
  await mount();
  await press("Diaper");
  await press("Poo");
  const input = () => renderer!.root.findAll((n) => String(n.type) === "TextInput")[0];
  await act(async () => input().props.onChangeText("Half a thought"));
  await press("Diaper");
  await press("Pee");
  expect(pendingRecords(b.state).find((r) => r.data.type === "dirty")!.body).toBe("Half a thought");
  expect(input().props.value).toBe("");
  expect(pendingRecords(b.state).find((r) => r.data.type === "wet")!.body).toBe("");
});

it("drops a half-written note when the entry itself is undone, and doesn't bring the entry back", async () => {
  const b = setup();
  await mount();
  await press("Diaper");
  await press("Poo");
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "TextInput")[0].props.onChangeText("Never mind"));
  await press("Undo Poo");
  expect(pendingRecords(b.state)).toEqual([]);
  expect(b.state.outbox.map((m) => m.type)).toEqual(["save", "delete"]);
});

it("gives each tile its own row at the largest text sizes, so no word breaks in half", async () => {
  setup();
  scope.fontScale = 3.1;
  await mount();
  expect(target("Breastfeed")!.props.style.flexBasis).toBe("100%");
  scope.fontScale = 1.4;
  await refresh();
  expect(target("Breastfeed")!.props.style.flexBasis).toBe("45%");
  scope.fontScale = 1;
  await refresh();
  expect(target("Breastfeed")!.props.style.flexBasis).toBe(0);
});

describe("a note and a colour, seconds apart", () => {
  it("builds each change inside the write, so the colour never undoes the note", async () => {
    const b = setup(), record = careWrite("diaper", "baby", { type: "dirty" }, start);
    b.state = { ...b.state, outbox: [{ id: "create", generation: 2, type: "save", record, files: [] }] };
    // What a screen holds is a render old: it hasn't seen the note yet.
    const rendered = { ...b, get records() { return [{ ...record, revision: 0, created_at: "", updated_at: "" }]; } };
    await amendCare(rendered as never, record.id, () => ({ body: "seedy" }));
    await amendCare(rendered as never, record.id, (row) => ({ data: { ...row.data, color: "yellow" } }));
    expect(lastSave()).toMatchObject({ body: "seedy", data: { color: "yellow" } });
    expect(pendingRecords(b.state)[0]).toMatchObject({ body: "seedy", data: { color: "yellow" } });
  });
});

describe("a timer from an older build", () => {
  const timer = (started = start) => ({ child_id: "baby", generation: 2, started_at: started.toISOString(), segments: [{ side: "left" as const, started_at: started.toISOString() }] });
  it("stops another feed starting from any screen, because the guard is in the write", async () => {
    const b = setup();
    b.state = { ...b.state, feedTimer: timer() };
    await expect(startFeed(b as never, feedWrite("baby", "left", start))).rejects.toThrow("timer is running");
    expect(b.state.outbox).toEqual([]);
    await expect(startFeed(b as never, careWrite("feeding", "baby", { method: "breast", side: "both" }, start))).rejects.toThrow("timer is running");
    await expect(startFeed(b as never, feedWrite("sibling", "left", start))).resolves.toBeTypeOf("function");
  });
  it("finishes into a new entry when nothing is bound to it, and clears in one write", async () => {
    const b = setup();
    b.state = { ...b.state, feedTimer: timer() };
    await finishTimer(b as never, timer(), new Date(start.getTime() + 300_000));
    expect(saves()).toHaveLength(1);
    expect(b.state.feedTimer).toBeUndefined();
  });
  it("finishes against the record already started during it, never a second log", async () => {
    const b = setup(), started = feedWrite("baby", "right", new Date(start.getTime() + 60_000));
    b.state = { ...b.state, feedTimer: timer(), outbox: [{ id: "create", generation: 2, type: "save", record: started, files: [] }] };
    const done = await finishTimer(b as never, timer(), new Date(start.getTime() + 300_000));
    expect(saves()).toHaveLength(1);
    expect(feedActions()).toEqual([expect.objectContaining({ record_id: started.id, action: expect.objectContaining({ action: "finish" }) })]);
    expect(b.state.feedTimer).toBeUndefined();
    await done.undo();
    expect(feedActions()).toEqual([]);
    expect(b.state.feedTimer?.started_at).toBe(start.toISOString());
  });
  it("doesn't bind to a feed from before it", () => {
    setup();
    const earlier = { ...feedWrite("baby", "right", new Date(start.getTime() - 60_000)), revision: 1, created_at: "", updated_at: "" };
    expect(boundFeed([earlier], timer(), new Date(start.getTime() + 60_000))).toBeUndefined();
  });
});

describe("the Undo window", () => {
  const running = async () => { const b = setup(); await mount(); await press("Breastfeed"); await press("Left"); return b; };
  const held = () => Date.parse(feedActions()[0].hold_until!) - Date.now();
  it("holds a Done as long as Undo shows, and takes Undo away before it can send", async () => {
    await running();
    await press("Done");
    expect(held()).toBe(undoWindow(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(5900); });
    expect(targets().some((n) => String(n.props.accessibilityLabel).startsWith("Undo Breastfeeding"))).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await refresh();
    expect(targets().some((n) => String(n.props.accessibilityLabel).startsWith("Undo"))).toBe(false);
  });
  it("gives VoiceOver the full 20 seconds on both", async () => {
    scope.reader = true;
    await running();
    await press("Switch to Right");
    expect(held()).toBe(20_500);
    await act(async () => { await vi.advanceTimersByTimeAsync(19_000); });
    expect(targets().some((n) => String(n.props.accessibilityLabel).startsWith("Undo Switched"))).toBe(true);
    expect(Date.parse(feedActions()[0].hold_until!)).toBeGreaterThan(Date.now());
  });
  it("doesn't restart when another panel opens, so it can't outlast the hold", async () => {
    await running();
    await press("Done");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await press("Diaper");
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    await refresh();
    expect(targets().some((n) => String(n.props.accessibilityLabel).startsWith("Undo"))).toBe(false);
  });
  it("can't take back a tap whose request has begun: the API may accept it", async () => {
    const b = await running(), feed = runningFeed(pendingRecords(b.state), "baby", new Date())!;
    const undoDone = await finishFeed(b as never, feed), id = feedActions()[0].id;
    b.state = { ...b.state, outbox: b.state.outbox.map((m: Mutation) => (m.id === id ? { ...m, sent: true } : m)) };
    await expect(undoDone()).rejects.toThrow("already finished");
    expect(feedActions().map((m) => m.id)).toEqual([id]);
  });
  it("answers a switch already on its way with the opposite switch", async () => {
    const b = await running(), feed = runningFeed(pendingRecords(b.state), "baby", new Date())!;
    const undoSwitch = await switchFeed(b as never, feed), id = feedActions()[0].id;
    b.state = { ...b.state, outbox: b.state.outbox.map((m: Mutation) => (m.id === id ? { ...m, sent: true } : m)) };
    await undoSwitch();
    expect(feedActions().map((m) => m.action.side)).toEqual(["right", "left"]);
  });
});

it("gives every time choice a 56pt target, on another day too", async () => {
  setup();
  await act(async () => { renderer = create(<QuickLog child={child} rows={[]} now={new Date()} pastDay={{ key: "2026-11-01", timezone: "Pacific/Guam" }} />); });
  await act(async () => target("Diaper")!.props.onPress());
  for (const label of ["8 AM", "12 PM", "4 PM", "8 PM", "11 PM", "Pick a time"]) expect(target(label)!.props.style.minHeight).toBeGreaterThanOrEqual(56);
  await act(async () => renderer!.unmount());
  renderer = undefined;
  await mount();
  await press("Diaper");
  await press("Dry");
  await press("Change time");
  for (const label of ["Now", "5 min ago", "15 min ago", "30 min ago", "1 hour ago", "Pick a time"]) expect(target(label)!.props.style.minHeight).toBeGreaterThanOrEqual(56);
});

it("hides the next side in the panel while a feed runs", async () => {
  setup();
  const rows = [breast("last", "right")];
  await mount(rows);
  await press("Breastfeed", rows);
  expect(target("Left, Next")).toBeDefined();
  await press("Left", rows);
  await press("Feeding", rows);
  expect(target("Left, Next")).toBeUndefined();
  expect(target("Right, Next")).toBeUndefined();
});

it("reads and offers times on the family's clock, not the phone's", async () => {
  // 17:00Z reads as 2:00 AM only on this clock, whatever zone the machine running this is in.
  const b = setup();
  b.state.bootstrap!.profile.timezone = "Asia/Tokyo";
  await mount();
  await press("Diaper");
  await press("Dry");
  expect(target("Change time")!.props.accessibilityLabel).toMatch(/2:00.AM/);
  await press("Change time");
  await press("Pick a time");
  expect(renderer!.root.findAll((n) => String(n.type) === "DateField")[0].props.timeZone).toBe("Asia/Tokyo");
});
