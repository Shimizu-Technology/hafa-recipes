import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type Child, type DeviceState, type Mutation } from "./models";
import { pendingRecords } from "./outbox";
import { keepItems, trackersFor } from "./trackers";

const scope = vi.hoisted(() => ({ account: null as any, toast: vi.fn(), replace: vi.fn(), push: vi.fn(), care: [] as any[], fontScale: 1 }));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Pressable: "Pressable", TextInput: "TextInput", ScrollView: "ScrollView", useWindowDimensions: () => ({ fontScale: scope.fontScale }),
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  Alert: { alert() {} },
  AccessibilityInfo: { isScreenReaderEnabled: async () => false, announceForAccessibility: () => undefined },
  Animated: { View: "AnimatedView", Value: class { setValue() {} stopAnimation() {} }, timing: () => ({ start() {} }) },
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null }, router: { replace: scope.replace, push: scope.push }, useFocusEffect: () => undefined }));
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
vi.mock("@/components/child-filter", () => ({ ChildFilter: "ChildFilter" }));
vi.mock("@/components/care-glance", () => ({ useMinuteClock: () => new Date() }));
vi.mock("@/components/quick-log", () => import("../components/quick-log"));
vi.mock("@/components/more-logs", () => import("../components/more-logs"));
vi.mock("@/components/tracker-panel", () => import("../components/tracker-panel"));
vi.mock("../components/motion", () => ({ useReducedMotion: () => false }));
vi.mock("../components/date-field", () => ({ DateField: "DateField" }));
vi.mock("../components/feed-timer", () => ({ useSecondClock: () => new Date() }));
import Add from "../app/add";

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
  scope.care = []; scope.fontScale = 1; scope.toast.mockClear(); scope.replace.mockClear(); scope.push.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Add", () => {
  it("has a newborn's four first, then the others more quietly, then what to keep", async () => {
    setup([newborn]);
    await mount();
    const seen = order();
    expect(seen.slice(0, 6)).toEqual(["Track", "Breastfeed", "Bottle", "Diaper", "Sleep", "More to track"]);
    expect(seen.indexOf("Keep")).toBeGreaterThan(seen.indexOf("More to track"));
    expect(seen.slice(seen.indexOf("Keep") + 1)).toEqual(keepItems.map((item) => item.title));
  });
  it("leaves nothing out, at either stage", async () => {
    for (const [child, stage] of [[newborn, "born"], [expected, "expecting"]] as const) {
      setup([child]);
      await mount();
      const seen = order();
      for (const tracker of trackersFor(stage)) expect(seen, tracker.label).toContain(tracker.label);
      for (const item of keepItems) expect(seen, item.title).toContain(item.title);
      act(() => renderer!.unmount());
    }
    renderer = undefined;
  });
  it("leads with what's on while expecting: the timers and her logs, with feeds under More", async () => {
    setup([expected]);
    await mount();
    const seen = order();
    expect(seen.slice(1, seen.indexOf("More to track"))).toEqual(["Kick counter", "Contraction timer", "How I’m feeling", "My weight", "Blood pressure", "Vitamins & medicine"]);
    expect(seen.indexOf("Breastfeed")).toBeGreaterThan(seen.indexOf("More to track"));
  });
  it("logs a feed in two taps: Breast, then side", async () => {
    setup([newborn]);
    await mount();
    await press("Breastfeed");
    await press("Left");
    expect(saves()).toHaveLength(1);
    expect(saves()[0].record).toMatchObject({ kind: "feeding", child_id: "baby" });
    expect(saves()[0].record.data).toMatchObject({ method: "breast" });
    expect(texts()).toContain("Left");
    expect(texts()).toContain("Saved");
  });
  it("logs a diaper, a bottle and a sleep with the same panels as Today", async () => {
    setup([newborn]);
    await mount();
    await press("Diaper");
    await press("Pee");
    await press("Bottle");
    await press("Formula");
    await press("Sleep");
    await press("Start");
    expect(saves().map((m) => m.record.kind)).toEqual(["diaper", "feeding", "sleep"]);
  });
  it("opens one panel at a time, a quick one or a form", async () => {
    setup([newborn]);
    await mount();
    await press("Breastfeed");
    expect(tile("Left")).toBeDefined();
    await press("Temperature");
    expect(tile("Left")).toBeUndefined();
    expect(tile("Save temperature")).toBeUndefined(); // The mocked Button isn't a Pressable.
    expect(renderer!.root.findAll((n) => String(n.type) === "Button").map((n) => n.props.accessibilityLabel)).toContain("Save temperature");
    await press("Diaper");
    expect(renderer!.root.findAll((n) => String(n.type) === "Button")).toHaveLength(0);
    expect(tile("Pee")).toBeDefined();
  });
  it("sends the timers, shots and milestones to their own screens", async () => {
    for (const [label, to] of [["Kick counter", "/kicks"], ["Contraction timer", "/contractions"], ["Shots", "/well-visits"], ["Milestones", "/milestones"]]) {
      setup([newborn]);
      await mount();
      await press(label);
      expect(scope.replace).toHaveBeenLastCalledWith(to);
      act(() => renderer!.unmount());
    }
    renderer = undefined;
  });
  it("keeps by opening the editor", async () => {
    setup([newborn]);
    await mount();
    await act(async () => rows().find((row) => row.props.title === keepItems[0].title)!.props.onPress());
    expect(scope.replace).toHaveBeenCalledWith({ pathname: "/edit", params: { kind: keepItems[0].kind } });
  });
  it("leads with setting up a baby when there is none, with nothing to track", async () => {
    setup([]);
    await mount();
    const seen = order();
    expect(seen[0]).toBe("Set up your baby");
    expect(seen).not.toContain("Track");
    expect(seen).not.toContain("Breastfeed");
    expect(seen.slice(seen.indexOf("Keep") + 1)).toEqual(keepItems.map((item) => item.title));
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
    await press("Diaper");
    expect(texts().join(" ")).toContain("For Kai");
    await press("Pee");
    expect(saves()[0].record.child_id).toBe("two");
    expect(texts()).toContain("Pee, for Kai");
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
  it("shows a running feed and a sleep under way, as Today does", async () => {
    setup([newborn]);
    scope.care = [{ id: "s", kind: "sleep", title: "Sleep", body: "", child_id: "baby", occurred_at: "2026-11-04T16:00:00.000Z", data: {}, revision: 1, created_at: "2026-11-04T16:00:00.000Z", updated_at: "2026-11-04T16:00:00.000Z" } as BabyRecord];
    await mount();
    expect(tile("Sleeping")).toBeDefined();
  });
});
