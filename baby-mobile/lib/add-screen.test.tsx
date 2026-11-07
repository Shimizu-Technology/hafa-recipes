import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type Child, type DeviceState, type Mutation } from "./models";
import { pendingRecords } from "./outbox";
import { keepItems, trackersFor } from "./trackers";

const scope = vi.hoisted(() => ({ params: {} as Record<string, string>, account: null as any, toast: vi.fn(), replace: vi.fn(), push: vi.fn(), back: vi.fn(), care: [] as any[], fontScale: 1 }));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Pressable: "Pressable", TextInput: "TextInput", ScrollView: "ScrollView", useWindowDimensions: () => ({ fontScale: scope.fontScale }),
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  Alert: { alert() {} },
  AccessibilityInfo: { isScreenReaderEnabled: async () => false, announceForAccessibility: () => undefined },
  Animated: { View: "AnimatedView", Value: class { setValue() {} stopAnimation() {} }, timing: () => ({ start() {} }) },
}));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null }, router: { replace: scope.replace, push: scope.push, back: scope.back, canGoBack: () => true }, useLocalSearchParams: () => scope.params, useFocusEffect: () => undefined }));
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
const ui = await vi.hoisted(async () => ({ KeyboardSave: (await import("react")).createContext(null), KeyboardDone: "KeyboardDone", PressTarget: "Pressable", Icon: "Icon", Button: "Button", Card: "Card", Copy: "Copy", Grouped: "Grouped", Row: "Row", QuietRow: "QuietRow", Screen: "Screen", OnSurface: "OnSurface", Field: "Field", Chips: "Chips",
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
  scope.params = {}; scope.care = []; scope.fontScale = 1; scope.toast.mockClear(); scope.replace.mockClear(); scope.push.mockClear(); scope.back.mockClear();
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
      "For you", "How I’m feeling", "My weight", "Blood pressure", "Vitamins & medicine", "What shows"]);
  });
  it("makes Keep the same tiles, saying more to VoiceOver as a hint", async () => {
    setup([newborn]);
    await mount();
    for (const item of keepItems) expect(tile(item.label)!.props.accessibilityHint).toBe(item.detail);
    await press(keepItems[0].label);
    expect(scope.replace).toHaveBeenCalledWith({ pathname: "/edit", params: { kind: keepItems[0].kind } });
  });
  it("keeps Journal one tap from writing, with past entries right under it", async () => {
    setup([newborn]);
    await mount();
    await press("Journal");
    expect(scope.replace).toHaveBeenLastCalledWith({ pathname: "/edit", params: { kind: "journal" } });
    const past = renderer!.root.findByType("QuietRow" as React.ElementType);
    expect(past.props.title).toBe("Your journal");
    await act(async () => past.props.onPress());
    expect(scope.replace).toHaveBeenLastCalledWith({ pathname: "/journal", params: { filter: "all", at: expect.any(String) } });
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
      "Keep", ...keepItems.map((item) => item.label), "What shows"]);
  });
  it("brings in a tracker from another stage only when it's on, and What shows still has it", async () => {
    setup([{ ...expected, details: { tracking: { expecting_diaper: true } } }]);
    await mount();
    expect(shown().slice(1, shown().indexOf("Keep"))).toContain("Diaper");
    expect(shown()).not.toContain("Sleep");
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
  it("opens straight to a panel when a tile on Today sends it there", async () => {
    scope.params = { open: "diaper" };
    setup([newborn]);
    await mount();
    expect(tile("Pee")).toBeDefined();
    await press("Pee");
    expect(saves().map((m) => m.record.kind)).toEqual(["diaper"]);
    expect(scope.back).toHaveBeenCalledOnce();
  });
  it("ignores an open it doesn't know", async () => {
    scope.params = { open: "nothing" };
    setup([newborn]);
    await mount();
    expect(tile("Breastfeed")).toBeDefined();
  });
  it("follows her switches: what's off moves down, and what's on from another stage comes in", async () => {
    setup([{ ...newborn, details: { tracking: { diaper: false, pumping: true, kicks: true } } }]);
    await mount();
    const seen = shown();
    expect(seen.slice(1, seen.indexOf("Keep"))).toEqual(["Breastfeed", "Bottle", "Sleep", "Kick counter", "Pumping"]);
    expect(seen.slice(seen.indexOf("For Mia"))).toContain("Diaper");
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
  it("leads with the date a named baby still needs, as Today does, with the logs still there", async () => {
    setup([{ id: "kid", name: "Noa", revision: 1 }]);
    await mount();
    expect(order()[0]).toBe("Is Noa here yet?");
    expect(order()).toContain("Breastfeed");
    await act(async () => rows()[0].props.onPress());
    expect(scope.replace).toHaveBeenCalledWith({ pathname: "/child", params: { id: "kid" } });
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
  describe("from the independent review", () => {
    const open = (id: string, minutes: number, end?: string) => { const at = new Date(now.getTime() - minutes * 60_000).toISOString();
      return { id, kind: "sleep", child_id: "baby", title: "Sleep", body: "", occurred_at: at, data: end ? { end_at: end } : {}, revision: 1, created_at: at, updated_at: at } as BabyRecord; };
    it.each([false, true])("Undo after unmount and a baby switch deletes only the original record; synced=%s", async (synced) => {
      const b = setup([newborn, { ...newborn, id: "two", name: "Kai" }], "baby");
      b.online = false;
      await mount(); await press("Diaper"); await press("Pee");
      const original = saves()[0].record, first = original.id, undo = scope.toast.mock.calls.at(-1)![1].onPress;
      if (synced) b.state = { ...b.state, outbox: [], records: [{ ...original, revision: 8, created_at: now.toISOString(), updated_at: now.toISOString() }] as BabyRecord[] };
      act(() => renderer!.unmount()); renderer = undefined;
      b.state = { ...b.state, selectedChild: "two", records: [...b.state.records,
        { id: "newer", kind: "diaper", child_id: "two", title: "Diaper", body: "", occurred_at: now.toISOString(), data: { type: "wet" }, revision: 1, created_at: now.toISOString(), updated_at: now.toISOString() } as BabyRecord] };
      await undo();
      expect(b.records.map((r: BabyRecord) => r.id)).toEqual(["newer"]);
      if (synced) { expect(b.state.outbox.filter((m) => m.type === "delete").map((m: any) => m.record.id)).toEqual([first]); }
    });
    it("a double tap before the phone write resolves queues one diaper", async () => {
      const b = setup([newborn]); let release!: () => void;
      const wait = new Promise<void>((resolve) => { release = resolve; });
      b.queue = vi.fn(async (m: Mutation) => { await wait; b.state = { ...b.state, outbox: [...b.state.outbox, m] }; });
      await mount(); await press("Diaper");
      const onPress = tile("Pee")!.props.onPress;
      await act(async () => { onPress(); onPress(); await Promise.resolve(); });
      expect(b.queue).toHaveBeenCalledOnce();
      await act(async () => { release(); await wait; });
      expect(saves()).toHaveLength(1);
    });
    it("a hidden sleep and breast tracker can still finish from Add", async () => {
      const b = setup([newborn]);
      const at = new Date(now.getTime() - 60_000).toISOString(), sleep = open("s", 1);
      scope.care = [sleep, { ...feedWrite("baby", "left", new Date(at)), revision: 1, created_at: at, updated_at: at } as unknown as BabyRecord];
      b.state.records = scope.care;
      await mount();
      expect(tile("Done")).toBeDefined();
      await press("Sleeping"); await press("End");
      expect(saves().at(-1)!.record).toMatchObject({ id: "s", data: { end_at: expect.any(String) } });
    });
    it("a switched-off sleep and breast tracker can still finish from Add", async () => {
      const b = setup([{ ...newborn, details: { tracking: { sleep: false, breast: false } } }]);
      const at = new Date(now.getTime() - 60_000).toISOString();
      scope.care = [open("s", 1), { ...feedWrite("baby", "left", new Date(at)), revision: 1, created_at: at, updated_at: at } as unknown as BabyRecord];
      b.state.records = scope.care;
      await mount();
      expect(tile("Done")).toBeDefined();
      await press("Sleeping"); await press("End");
      expect(saves().at(-1)!.record).toMatchObject({ id: "s", data: { end_at: expect.any(String) } });
    });
    it("a sleep under way can still be ended from Add while expecting, when Sleep isn't one of her tiles", async () => {
      const b = setup([expected]), sleep = { ...open("s", 1), child_id: "due" };
      scope.care = [sleep]; b.state.records = scope.care;
      await mount();
      await press("Sleeping"); await press("End");
      expect(saves().at(-1)!.record).toMatchObject({ id: "s", data: { end_at: expect.any(String) } });
    });
    it("maternal logs never attach to either baby", async () => {
      setup([expected, newborn], "due");
      await mount(); await press("How I’m feeling"); await press("Good");
      expect(saves()[0].record.child_id).toBeNull();
    });
    it("a late-arriving sleep from another phone isn't stranded: both show as running, and End both clears them", async () => {
      const b = setup([newborn]); b.online = false;
      // Start stays exactly as it is offline: this phone can't know about the other's yet.
      await mount(); await press("Sleep"); await press("Start");
      expect(saves().map((m) => m.record.kind)).toEqual(["sleep"]);
      b.state = { ...b.state, records: [open("other-phone", 1)] }; scope.care = b.records;
      await act(async () => renderer!.update(<Add />));
      await press("Sleeping");
      expect(texts().join(" ")).toContain("2 sleeps running");
      expect(tile("Start")).toBeUndefined();
      await press("End both");
      scope.care = b.records;
      await act(async () => renderer!.update(<Add />));
      expect(b.records.filter((r: BabyRecord) => r.kind === "sleep" && !r.data.end_at)).toHaveLength(0);
      expect(tile("Sleeping")).toBeUndefined();
      expect(scope.toast.mock.calls.at(-1)![0]).toBe("Saved: 2 sleeps ended");
    });
    it("takes both back with one Undo", async () => {
      const b = setup([newborn]);
      scope.care = [open("a", 10), open("b", 60)]; b.state.records = scope.care;
      await mount(); await press("Sleeping"); await press("End both");
      await act(async () => { await scope.toast.mock.calls.at(-1)![1].onPress(); });
      expect(b.records.filter((r: BabyRecord) => r.kind === "sleep" && !r.data.end_at).map((r: BabyRecord) => r.id).sort()).toEqual(["a", "b"]);
    });
    it("hands a Done's own expiry to the toast, so Undo goes before the hold ends", async () => {
      const b = setup([newborn]), at = new Date(now.getTime() - 60_000).toISOString();
      scope.care = [{ ...feedWrite("baby", "left", new Date(at)), revision: 1, created_at: at, updated_at: at }];
      b.state.records = scope.care;
      let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
      b.queue = vi.fn(async (m: Mutation) => { await wait; b.state = { ...b.state, outbox: [...b.state.outbox, m] }; });
      await mount();
      await act(async () => { tile("Done")!.props.onPress(); await Promise.resolve(); });
      // A second to persist locally: the hold already began, and no toast exists until saving finishes.
      await act(async () => { vi.advanceTimersByTime(1000); release(); await wait; });
      const held = b.state.outbox.find((m) => m.type === "feed_action")! as Extract<Mutation, { type: "feed_action" }>;
      const action = scope.toast.mock.calls.at(-1)![1];
      expect(action.until).toBeLessThan(Date.parse(held.hold_until!));
      expect(action.until).toBe(now.getTime() + 6000);
    });
    it("gives a plain save no expiry of its own", async () => {
      setup([newborn]);
      await mount(); await press("Diaper"); await press("Pee");
      expect(scope.toast.mock.calls.at(-1)![1].until).toBeUndefined();
    });
  });
});

it("an old pending save does not close the second baby's new panel, and still says it saved", async () => {
  const b = setup([newborn, { ...newborn, id: "two", name: "Kai" }], "baby");
  let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
  b.queue = vi.fn(async (m: Mutation) => { await wait; b.state = { ...b.state, outbox: [...b.state.outbox, m] }; });
  await mount(); await press("Diaper");
  await act(async () => { tile("Pee")!.props.onPress(); await Promise.resolve(); });
  b.state = { ...b.state, selectedChild: "two" };
  await act(async () => renderer!.update(<Add />));
  await press("Temperature");
  expect(renderer!.root.findAll((n) => String(n.type) === "Button").map((n) => n.props.accessibilityLabel)).toContain("Save temperature");
  await act(async () => { release(); await wait; });
  expect(saves()[0].record.child_id).toBe("baby");
  expect(scope.back).not.toHaveBeenCalled();
  // The panel she opened for Kai is still open, and what saved for Mia still offers Undo.
  expect(renderer!.root.findAll((n) => String(n.type) === "Button").map((n) => n.props.accessibilityLabel)).toContain("Save temperature");
  expect(scope.toast.mock.calls.at(-1)![0]).toBe("Saved: Pee, for Mia");
});
it("doesn't navigate after the sheet has already gone", async () => {
  const b = setup([newborn]);
  let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
  b.queue = vi.fn(async (m: Mutation) => { await wait; b.state = { ...b.state, outbox: [...b.state.outbox, m] }; });
  await mount(); await press("Diaper");
  await act(async () => { tile("Pee")!.props.onPress(); await Promise.resolve(); });
  act(() => renderer!.unmount()); renderer = undefined;
  await act(async () => { release(); await wait; });
  expect(scope.back).not.toHaveBeenCalled();
  expect(scope.toast.mock.calls.at(-1)![0]).toBe("Saved: Pee");
});
