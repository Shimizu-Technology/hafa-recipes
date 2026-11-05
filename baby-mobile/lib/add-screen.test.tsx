import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type Child, type DeviceState, type Mutation } from "./models";
import { pendingRecords } from "./outbox";
import { keepItems, trackersFor } from "./trackers";

const scope = vi.hoisted(() => ({ account: null as any, toast: vi.fn(), replace: vi.fn(), push: vi.fn(), back: vi.fn(), care: [] as any[], fontScale: 1 }));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Pressable: "Pressable", TextInput: "TextInput", ScrollView: "ScrollView", useWindowDimensions: () => ({ fontScale: scope.fontScale }),
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  Alert: { alert() {} },
  AccessibilityInfo: { isScreenReaderEnabled: async () => false, announceForAccessibility: () => undefined },
  Animated: { View: "AnimatedView", Value: class { setValue() {} stopAnimation() {} }, timing: () => ({ start() {} }) },
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null }, router: { replace: scope.replace, push: scope.push, back: scope.back, canGoBack: () => true }, useFocusEffect: () => undefined }));
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
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/more-logs", () => import("./more-logs"));
vi.mock("@/lib/trackers", () => import("./trackers"));
vi.mock("@/lib/api", () => ({ sendsCareDetails: true }));
vi.mock("@/lib/today-care", () => ({ useTodayCare: () => ({ all: scope.care, rows: scope.care, loading: false, error: "", refresh: vi.fn() }) }));
const ui = vi.hoisted(() => ({ PressTarget: "Pressable", Icon: "Icon", Button: "Button", Card: "Card", Copy: "Copy", Grouped: "Grouped", Row: "Row", Screen: "Screen", OnSurface: "OnSurface", Field: "Field", Chips: "Chips",
  easeOut: () => 0, fonts: {}, radii: {}, typeScale: { footnote: { fontSize: 14 }, caption: {} }, useColors: () => ({}), useToast: () => scope.toast, tap: () => undefined }));
vi.mock("@/components/ui", () => ui);
vi.mock("../components/ui", () => ui);
vi.mock("./ui", () => ui);
vi.mock("@/components/record-row", () => ({ kindIcon: {} }));
vi.mock("@/components/feed-timer", () => ({ LegacyTimer: "LegacyTimer" }));
vi.mock("@/components/child-filter", () => ({ ChildFilter: "ChildFilter" }));
vi.mock("@/components/care-glance", () => ({ useMinuteClock: () => new Date() }));
vi.mock("@/components/quick-log", () => import("../components/quick-log"));
vi.mock("@/components/more-logs", () => import("../components/more-logs"));
vi.mock("@/components/tracker-panel", () => import("../components/tracker-panel"));
vi.mock("../components/motion", () => ({ useReducedMotion: () => false }));
vi.mock("../components/date-field", () => ({ DateField: "DateField" }));
vi.mock("../components/feed-timer", () => ({ useSecondClock: () => new Date() }));
import Add from "../app/add";
import { feedWrite } from "./running-feed";

const now = new Date("2026-11-04T17:00:00.000Z");
const newborn: Child = { id: "baby", name: "Mia", revision: 1, birth_date: "2026-11-01" };
const expected: Child = { id: "due", name: "Lani", revision: 1, due_date: "2026-12-10" };
let renderer: ReactTestRenderer | undefined;
function setup(children: Child[], selectedChild: string | null = null) {
  const b = {
    online: true,
    get records() { return pendingRecords(b.state); },
    state: { ...emptyState(), selectedChild, bootstrap: { generation: 2, active: true, ai_available: false, children,
      profile: { display_name: "K", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState,
    commit: vi.fn(async (change: (state: DeviceState) => DeviceState) => { b.state = change(b.state); }),
    queue: vi.fn(async (m: Mutation) => { b.state = { ...b.state, outbox: [...b.state.outbox, m] }; }),
    sync: vi.fn(async () => undefined),
  };
  scope.account = b;
  return b;
}
async function mount() { await act(async () => { renderer = create(<Add />); }); }
const tiles = () => renderer!.root.findAll((n) => String(n.type) === "Pressable");
const tile = (label: string) => tiles().find((n) => n.props.accessibilityLabel === label || n.props.accessibilityLabel?.startsWith(`${label},`));
async function press(label: string) {
  const node = tile(label);
  expect(node, label).toBeDefined();
  await act(async () => { await node!.props.onPress(); });
}
const texts = () => renderer!.root.findAll((n) => String(n.type) === "Text" || String(n.type) === "Copy").map((n) => [n.props.children].flat().join(""));
const rows = () => renderer!.root.findAll((n) => String(n.type) === "Row");
const saves = () => scope.account.state.outbox.filter((m: Mutation) => m.type === "save") as Extract<Mutation, { type: "save" }>[];
/** What's named on screen, in the order it's shown. */
const order = () => renderer!.root.findAll((n) => ["Pressable", "Row"].includes(String(n.type)) || (["Text", "Copy"].includes(String(n.type)) && ["Track", "More to track", "Keep"].some((word) => [n.props.children].flat().join("").startsWith(word))))
  .map((n) => n.props.accessibilityLabel ?? n.props.title ?? [n.props.children].flat().join(""));

beforeEach(() => {
  vi.useFakeTimers({ now });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scope.care = []; scope.fontScale = 1; scope.toast.mockClear(); scope.replace.mockClear(); scope.push.mockClear(); scope.back.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Add", () => {
  const heads = ["Track", "Keep", "For Mia", "For you"];
  const shown = () => renderer!.root.findAll((n) => ["Pressable", "Row"].includes(String(n.type)) || (["Text", "Copy"].includes(String(n.type)) && heads.some((word) => [n.props.children].flat().join("") === word || [n.props.children].flat().join("").startsWith("Track for") || [n.props.children].flat().join("").startsWith("For "))))
    .map((n) => n.props.accessibilityLabel ?? n.props.title ?? [n.props.children].flat().join(""));
  it("goes Track, then Keep, then the rest for the baby, then the rest for her", async () => {
    setup([newborn]);
    await mount();
    expect(shown()).toEqual(["Track", "Breastfeed", "Bottle", "Diaper", "Sleep",
      "Keep", ...keepItems.map((item) => item.label),
      "For Mia", "Pumping", "Medicine", "Temperature", "Growth", "Note", "Custom", "Shots", "Milestones",
      "For you", "How I’m feeling", "My weight", "Blood pressure", "Vitamins & medicine"]);
  });
  it("makes Keep the same tiles, saying more to VoiceOver as a hint", async () => {
    setup([newborn]);
    await mount();
    for (const item of keepItems) expect(tile(item.label)!.props.accessibilityHint).toBe(item.detail);
    await press(keepItems[0].label);
    expect(scope.replace).toHaveBeenCalledWith({ pathname: "/edit", params: { kind: keepItems[0].kind } });
  });
  it("after the birth, leaves the pregnancy timers out", async () => {
    setup([newborn]);
    await mount();
    expect(shown()).not.toContain("Kick counter");
    expect(shown()).not.toContain("Contraction timer");
  });
  it("while expecting, leaves feeds, diapers and sleep out, and has no empty heading", async () => {
    setup([expected]);
    await mount();
    expect(shown()).toEqual(["Track", "Kick counter", "Contraction timer", "How I’m feeling", "My weight", "Blood pressure", "Vitamins & medicine",
      "Keep", ...keepItems.map((item) => item.label)]);
  });
  it("logs a feed in two taps, closes, and offers Undo on the screen beneath", async () => {
    const b = setup([newborn]);
    await mount();
    await press("Breastfeed");
    await press("Left");
    expect(saves()).toHaveLength(1);
    expect(saves()[0].record).toMatchObject({ kind: "feeding", child_id: "baby" });
    expect(saves()[0].record.data).toMatchObject({ method: "breast" });
    expect(scope.back).toHaveBeenCalledOnce();
    const [message, action] = scope.toast.mock.calls.at(-1)!;
    expect(message).toBe("Saved: Left");
    await act(async () => { await action.onPress(); });
    expect(b.records.filter((row: BabyRecord) => row.kind === "feeding")).toHaveLength(0);
    expect(scope.toast.mock.calls.at(-1)![0]).toBe("Undone.");
  });
  it("closes the same way after a diaper, a bottle, a sleep and a form", async () => {
    for (const [first, second, kind] of [["Diaper", "Pee", "diaper"], ["Bottle", "Formula", "feeding"], ["Sleep", "Start", "sleep"], ["Pumping", "Both", "pumping"]]) {
      setup([newborn]);
      scope.back.mockClear();
      await mount();
      await press(first);
      await press(second);
      expect(saves().map((m) => m.record.kind)).toEqual([kind]);
      expect(scope.back).toHaveBeenCalledOnce();
      act(() => renderer!.unmount());
    }
    renderer = undefined;
  });
  it("stays open and says why if a save fails", async () => {
    const b = setup([newborn]);
    b.commit = vi.fn(async () => { throw Error("This phone can't keep that."); });
    b.queue = vi.fn(async () => { throw Error("This phone can't keep that."); });
    await mount();
    await press("Diaper");
    await press("Pee");
    expect(scope.back).not.toHaveBeenCalled();
    expect(scope.toast.mock.calls.at(-1)![0]).toBe("This phone can't keep that.");
  });
  it("opens one panel at a time, a quick one or a form", async () => {
    setup([newborn]);
    await mount();
    await press("Breastfeed");
    expect(tile("Left")).toBeDefined();
    await press("Temperature");
    expect(tile("Left")).toBeUndefined();
    expect(renderer!.root.findAll((n) => String(n.type) === "Button").map((n) => n.props.accessibilityLabel)).toContain("Save temperature");
    await press("Diaper");
    expect(renderer!.root.findAll((n) => String(n.type) === "Button")).toHaveLength(0);
    expect(tile("Pee")).toBeDefined();
  });
  it("sends the timers, shots and milestones to their own screens", async () => {
    for (const [child, label, to] of [[expected, "Kick counter", "/kicks"], [expected, "Contraction timer", "/contractions"], [newborn, "Shots", "/well-visits"], [newborn, "Milestones", "/milestones"]] as const) {
      setup([child]);
      await mount();
      await press(label);
      expect(scope.replace).toHaveBeenLastCalledWith(to);
      act(() => renderer!.unmount());
    }
    renderer = undefined;
  });
  it("leads with setting up a baby when there is none, with nothing to track", async () => {
    setup([]);
    await mount();
    const seen = order();
    expect(seen[0]).toBe("Set up your baby");
    expect(seen).not.toContain("Track");
    expect(seen).not.toContain("Breastfeed");
    expect(shown().slice(1)).toEqual(["Keep", ...keepItems.map((item) => item.label)]);
    await act(async () => rows()[0].props.onPress());
    expect(scope.replace).toHaveBeenCalledWith("/child");
  });
  it("with one baby, doesn't ask which", async () => {
    setup([newborn]);
    await mount();
    expect(renderer!.root.findAll((n) => String(n.type) === "ChildFilter")).toHaveLength(0);
    expect(texts()).toContain("Track");
  });
  it("with two babies, says whose log it is before and after", async () => {
    const second = { ...newborn, id: "two", name: "Kai" };
    setup([newborn, second], "two");
    await mount();
    expect(renderer!.root.findByType("ChildFilter" as any).props.only).toBe("two");
    expect(texts()).toContain("Track for Kai");
    expect(texts()).toContain("For Kai");
    await press("Diaper");
    expect(texts().join(" ")).toContain("For Kai");
    await press("Pee");
    expect(saves()[0].record.child_id).toBe("two");
    expect(scope.toast.mock.calls.at(-1)![0]).toBe("Saved: Pee, for Kai");
  });
  it("closes an open panel when the baby changes, so a tap can't land on the other", async () => {
    const second = { ...newborn, id: "two", name: "Kai" };
    const b = setup([newborn, second], "baby");
    await mount();
    await press("Breastfeed");
    expect(tile("Left")).toBeDefined();
    b.state = { ...b.state, selectedChild: "two" };
    await act(async () => renderer!.update(<Add />));
    expect(tile("Left")).toBeUndefined();
  });
  it("shows a running feed with its Switch and Done, and a sleep under way, as Today does", async () => {
    setup([newborn]);
    const at = new Date(now.getTime() - 60_000).toISOString();
    scope.care = [
      { id: "s", kind: "sleep", title: "Sleep", body: "", child_id: "baby", occurred_at: "2026-11-04T16:00:00.000Z", data: {}, revision: 1, created_at: "2026-11-04T16:00:00.000Z", updated_at: "2026-11-04T16:00:00.000Z" } as BabyRecord,
      { ...feedWrite("baby", "left", new Date(at)), revision: 1, created_at: at, updated_at: at } as unknown as BabyRecord,
    ];
    await mount();
    expect(tile("Sleeping")).toBeDefined();
    expect(tile("Feeding")).toBeDefined();
    expect(tile("Switch to Right")).toBeDefined();
    expect(tile("Done")).toBeDefined();
  });
  it("has the old timer card, where the block on feeding sends her", async () => {
    setup([newborn]);
    await mount();
    expect(renderer!.root.findAll((n) => String(n.type) === "LegacyTimer")).toHaveLength(1);
  });
});
