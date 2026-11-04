import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type DeviceState, type Mutation } from "./models";
import { pendingRecords } from "./outbox";

const scope = vi.hoisted(() => ({ account: null as any, toast: vi.fn(), taps: [] as string[], fontScale: 1, announced: [] as string[] }));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Pressable: "Pressable", useWindowDimensions: () => ({ fontScale: scope.fontScale }),
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  Alert: { alert() {} },
  AccessibilityInfo: { isScreenReaderEnabled: async () => false, announceForAccessibility: (text: string) => scope.announced.push(text) },
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
vi.mock("../components/ui", () => ({ PressTarget: "Pressable", Icon: "Icon", Button: "Button", Card: "Card", Copy: "Copy", easeOut: () => 0,
  fonts: {}, radii: {}, typeScale: { footnote: { fontSize: 14 } }, useColors: () => ({}), useToast: () => scope.toast, tap: (kind = "select") => scope.taps.push(kind) }));
vi.mock("../components/motion", () => ({ useReducedMotion: () => false }));
import { QuickLog, quickTarget } from "../components/quick-log";
import { CareGlance } from "../components/care-glance";
import { runningFeed, runningLimit } from "./running-feed";

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
const view = (rows: BabyRecord[]) => <QuickLog child={child} rows={[...pendingRecords(scope.account.state), ...rows]} now={new Date()} onBottle={() => undefined} onDiaper={() => undefined} sleeping={false} onSleep={() => undefined} />;
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
const saves = () => scope.account.state.outbox.filter((m: Mutation) => m.type === "save") as Extract<Mutation, { type: "save" }>[];

beforeEach(() => {
  vi.useFakeTimers({ now: start });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scope.toast.mockClear(); scope.taps = []; scope.fontScale = 1; scope.announced = [];
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
  expect(saves()[0].record).toMatchObject({ kind: "feeding", child_id: "baby", occurred_at: start.toISOString(), data: { method: "breast", side: "left" } });
  expect(b.sync).toHaveBeenCalled();
  expect(scope.taps.at(-1)).toBe("success");
  expect(target("Left")).toBeUndefined();
  expect(target("Undo Left")).toBeDefined();
  expect(texts()).toContain("You can put the phone down. It stays saved.");
  expect(b.state.feedTimer).toMatchObject({ record_id: saves()[0].record.id });
});

it("saves through the outbox with no connection, so airplane mode changes nothing", async () => {
  const b = setup();
  b.sync.mockRejectedValue(new Error("offline"));
  await mount();
  await press("Breastfeed");
  await press("Right");
  expect(pendingRecords(b.state).map((r) => r.data.side)).toEqual(["right"]);
  expect(texts().some((t) => t.startsWith("Right · 00:00"))).toBe(true);
});

it("saves Both finished, with no duration and no running card", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Both");
  expect(saves()[0].record.data).toEqual({ method: "breast", side: "both" });
  expect(b.state.feedTimer).toBeUndefined();
  expect(target("Done")).toBeUndefined();
});

it("switches and finishes: both sides, a duration only once finished, in one record", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Left");
  expect(saves()[0].record.data.duration_minutes).toBeUndefined();
  vi.setSystemTime(start.getTime() + 5 * 60_000);
  await press("Switch to Right");
  expect(b.state.feedTimer!.segments.map((s) => s.side)).toEqual(["left", "right"]);
  expect(texts().some((t) => t.startsWith("Left 05:00"))).toBe(true);
  vi.setSystemTime(start.getTime() + 8 * 60_000);
  await press("Done");
  expect(b.state.feedTimer).toBeUndefined();
  expect(pendingRecords(b.state)).toHaveLength(1);
  expect(pendingRecords(b.state)[0].data).toMatchObject({ method: "breast", side: "both", duration_minutes: 8 });
  expect(pendingRecords(b.state)[0].occurred_at).toBe(start.toISOString());
});

it("undoes each step: start removes the record, switch and done put the feed back as it was", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Left");
  await press("Undo Left");
  expect(pendingRecords(b.state)).toEqual([]);
  expect(b.state.feedTimer).toBeUndefined();

  await press("Breastfeed");
  await press("Left");
  vi.setSystemTime(start.getTime() + 60_000);
  await press("Switch to Right");
  await press("Undo Switched to Right");
  expect(b.state.feedTimer!.segments.map((s) => s.side)).toEqual(["left"]);
  vi.setSystemTime(start.getTime() + 3 * 60_000);
  await press("Done");
  expect(b.state.feedTimer).toBeUndefined();
  const undo = targets().find((n) => n.props.accessibilityLabel?.startsWith("Undo Breastfeeding"));
  await act(async () => { await undo!.props.onPress(); });
  expect(b.state.feedTimer).toMatchObject({ segments: [{ side: "left" }] });
  expect(pendingRecords(b.state)[0].data.duration_minutes).toBeUndefined();
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
  expect(runningFeed(b.state, "baby", new Date(start.getTime() + runningLimit - 1))).toBeDefined();
  expect(runningFeed(b.state, "baby", new Date(start.getTime() + runningLimit))).toBeUndefined();
  vi.setSystemTime(start.getTime() + runningLimit);
  await refresh();
  expect(target("Done")).toBeUndefined();
  expect(pendingRecords(b.state)[0].data.duration_minutes).toBeUndefined();
});

it("leaves an older timer to finish on its own card first", async () => {
  const b = setup();
  b.state = { ...b.state, feedTimer: { child_id: "baby", generation: 2, started_at: start.toISOString(), segments: [{ side: "left", started_at: start.toISOString() }] } };
  await act(async () => { renderer = create(<QuickLog child={child} rows={[]} now={new Date()} legacyTimer onBottle={() => undefined} onDiaper={() => undefined} sleeping={false} onSleep={() => undefined} />); });
  expect(target("Done")).toBeUndefined();
  await press("Feeding");
  expect(target("Left")).toBeUndefined();
  expect(scope.toast).toHaveBeenCalledWith(expect.stringContaining("timer is running"));
});

it("gives every night target at least 56pt", async () => {
  setup();
  await mount();
  await press("Breastfeed");
  for (const node of targets().filter((n) => n.props.accessibilityLabel !== undefined))
    expect(node.props.style.minHeight, node.props.accessibilityLabel).toBeGreaterThanOrEqual(quickTarget);
  await press("Left");
  for (const node of targets().filter((n) => n.props.accessibilityLabel !== undefined))
    expect(node.props.style.minHeight, node.props.accessibilityLabel).toBeGreaterThanOrEqual(quickTarget);
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
it("shows the running side on the hero while feeding, and still the next side", async () => {
  const b = setup();
  await mount();
  await press("Breastfeed");
  await press("Left");
  const running = runningFeed(b.state, "baby", new Date())!;
  await act(async () => renderer!.update(<CareGlance child={child} rows={pendingRecords(b.state)} now={new Date()} running={running} />));
  expect(texts()).toEqual(expect.arrayContaining(["Feeding now", "Left", "Next side", "Right"]));
});
it("has no next side to show before the first feed, and says so plainly", async () => {
  setup();
  await act(async () => { renderer = create(<CareGlance child={child} rows={[]} now={new Date()} />); });
  expect(texts()).not.toContain("Next side");
});
