import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type Mutation } from "./models";
import { withPendingBirths } from "./outbox";

const scope = vi.hoisted(() => ({
  careError: "",
  account: null as unknown,
  care: [] as unknown[],
  tint: "#59453B",
  alerts: [] as { title: string; buttons: { text: string; onPress?: () => void }[] }[],
  toast: vi.fn(),
  push: vi.fn(),
  fontScale: 1,
  haptic: vi.fn(async () => undefined),
}));
vi.mock("react-native", () => ({
  useWindowDimensions: () => ({ fontScale: scope.fontScale }), Platform: { OS: "ios" }, View: "View", Pressable: "Pressable", Text: "Text",
  AccessibilityInfo: { isScreenReaderEnabled: async () => false, announceForAccessibility() {} },
  Animated: { View: "AnimatedView", Value: class { setValue() {} stopAnimation() {} }, timing: () => ({ start() {} }) },
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  TextInput: "TextInput", ScrollView: "ScrollView",
  Alert: { alert: (title: string, _message: string, buttons = []) => scope.alerts.push({ title, buttons }) },
}));
vi.mock("expo-router", async () => {
  const React = await import("react");
  return { Stack: { Screen: "StackScreen" }, router: { push: scope.push },
    useFocusEffect: (callback: () => (() => void) | undefined) => React.useEffect(() => callback(), [callback]) };
});
vi.mock("expo-haptics", () => ({ selectionAsync: scope.haptic, NotificationFeedbackType: { Success: "success" } }));
vi.mock("expo-crypto", () => { let id = 0; return { randomUUID: () => `fixture-${++id}` }; });
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/care-glance", () => import("./care-glance"));
vi.mock("@/lib/today-routines", () => import("./today-routines"));
vi.mock("@/lib/quick-care", () => import("./quick-care"));
vi.mock("@/lib/feed-timer", () => import("./feed-timer"));
vi.mock("@/lib/context", () => ({ useBaby: () => scope.account }));
vi.mock("@/lib/today-care", () => ({
  useTodayCare: () => ({ rows: scope.care.slice(0, 3), all: scope.care, loading: false, error: scope.careError, refresh: vi.fn() }),
}));
const ui = await vi.hoisted(async () => {
  const { createElement } = await import("react");
  return {
    PressTarget: "Pressable", Button: "Button", Card: "Card", Copy: "Copy", Empty: "Empty", Icon: "Icon", Loading: "Loading", Notice: "Notice",
    typeScale: { headline: {} }, radii: { tile: 22 }, Grouped: "Grouped", Row: "Row", Section: "Section", useColors: () => ({ text: "#000", hero: "#fff", action: scope.tint }), useToast: () => scope.toast,
    fonts: { regular: "r", semibold: "s", bold: "b" }, easeOut: () => 0, tap: () => void scope.haptic(),
    // The docked footer holds the quick log, so render it inside the screen.
    Screen: ({ children, footer, ...props }: Record<string, unknown>) => createElement("Screen", { ...props, docked: !!footer }, children as never, footer as never),
  };
});
vi.mock("@/components/ui", () => ui);
vi.mock("../components/ui", () => ui);
vi.mock("@/components/record-row", () => ({ RecordRow: "RecordRow", kindIcon: { feeding: "f", sleep: "s", diaper: "d" } }));
vi.mock("@/components/child-filter", () => ({ ChildFilter: "ChildFilter" }));
vi.mock("@/components/sync-status", () => ({ SyncStatus: "SyncStatus" }));
vi.mock("@/components/stage-options", () => ({ BabySetupCard: "BabySetupCard" }));
vi.mock("@/components/care-glance", () => ({ CareGlance: "CareGlance", useMinuteClock: () => new Date() }));
vi.mock("@/components/feed-timer", () => import("../components/feed-timer"));
vi.mock("@/components/quick-log", () => import("../components/quick-log"));
vi.mock("@/components/tracker-suggestion", () => ({ TrackerSuggestion: "TrackerSuggestion" }));
vi.mock("@/components/more-logs", () => import("../components/more-logs"));
vi.mock("@/lib/more-logs", () => import("./more-logs"));
vi.mock("@/lib/trackers", () => import("./trackers"));
vi.mock("@/lib/running-feed", () => import("./running-feed"));
vi.mock("@/lib/feed-reducer", () => import("./feed-reducer"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/care-summary", () => import("./care-summary"));
vi.mock("@/lib/use-care-summary", () => ({ useCareSummary: () => undefined }));
vi.mock("@/lib/api", () => ({ sendsCareDetails: false }));
vi.mock("../components/date-field", () => ({ DateField: "DateField" }));
vi.mock("../components/motion", () => ({ useReducedMotion: () => false }));
vi.mock("@/components/tips", () => ({ BabyAgeCard: "BabyAgeCard", PregnancyHero: "PregnancyHero", TipSection: "TipSection", WeekDetails: "WeekDetails" }));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/components/event-row", () => ({ NextEvent: "NextEvent" }));
vi.mock("@/components/visit-sections", async () => {
  const { useState } = await import("react");
  return { useVisitDrafts: () => { const [typed, setTyped] = useState<Record<string, string>>({}); return { typed, write: (target: string, text: string) => setTyped((held) => ({ ...held, [target]: text })) }; } };
});
vi.mock("@/lib/use-timing-tips", () => ({ useTimingTips: () => ({ rows: [], total: 0 }) }));
import Today from "../app/(tabs)/(today)/index";

const start = new Date("2026-10-20T03:00:00.000Z");
let renderer: ReactTestRenderer | undefined;
function setup() {
  const account = {
    records: [] as BabyRecord[],
    state: { ...emptyState(), bootstrap: { generation: 2, active: true, ai_available: false,
      children: [{ id: "baby", name: "Mia", revision: 1 }],
      profile: { display_name: "Kami Shimizu", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState,
    commit: vi.fn(async (change: (state: DeviceState) => DeviceState) => { account.state = change(account.state); }),
    queue: vi.fn(async (m: Mutation) => { account.state = { ...account.state, outbox: [...account.state.outbox, m] }; }),
    sync: vi.fn(async () => undefined),
  };
  scope.account = account;
  return account;
}
const find = (type: string, match: (props: Record<string, unknown>) => boolean) =>
  renderer!.root.findAll((node) => String(node.type) === type && match(node.props));
async function render() {
  await act(async () => {
    if (renderer) renderer.update(React.createElement(Today));
    else renderer = TestRenderer.create(React.createElement(Today));
  });
}
/** A timer started on an older build: no record behind it yet. */
function legacyTimer(account: ReturnType<typeof setup>, side: "left" | "right" = "right") {
  account.state = { ...account.state, feedTimer: { child_id: "baby", generation: 2, started_at: start.toISOString(), segments: [{ side, started_at: start.toISOString() }] } };
}
async function tapFeedTile(label = "Breastfeed") {
  const tile = find("Pressable", (p) => p.accessibilityLabel === label)[0];
  expect(tile, label).toBeDefined();
  await act(async () => (tile.props.onPress as () => void)());
  await render();
}
async function press(title: string) {
  const button = find("Button", (p) => (p.accessibilityLabel ?? p.title) === title)[0];
  expect(button, title).toBeDefined();
  await act(async () => { (button.props.onPress as () => void)(); });
  await render();
}
const elapsed = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const clock = () => find("Text", () => true).map((node) => node.props.children).find((text) => /^\d/.test(String(text)));

beforeEach(() => {
  vi.useFakeTimers({ now: start });
  vi.clearAllMocks();
  scope.alerts = []; scope.care = []; scope.fontScale = 1;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes("react-test-renderer is deprecated")) throw Error(String(args[0]));
  });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

it("finishes a timer from an older build the old way: timed, switched, saved once with Undo, then gone", async () => {
  const account = setup();
  account.state.bootstrap!.children[0].birth_date = "2026-10-01";
  legacyTimer(account);
  await render();
  expect(find("Pressable", (p) => p.accessibilityLabel === "Feeding")).toHaveLength(1);

  await elapsed(5 * 60_000);
  expect(clock()).toBe("05:00");
  expect(find("View", (p) => p.accessible === true)[0].props.accessibilityLabel).toBe("Feeding Mia. Right side, 5 minutes");
  expect(find("Button", p => p.title === "Switch")[0].props.accessibilityLabel).toBe("Switch to left");
  await press("Switch to left");
  await elapsed(2 * 60_000);
  await press("Pause");
  await elapsed(30 * 60_000);
  await press("Resume");
  await elapsed(60_000);
  await press("Stop");

  expect(account.state.feedTimer).toBeUndefined();
  expect(account.state.outbox).toHaveLength(1);
  const saved = account.state.outbox[0] as Extract<Mutation, { type: "save" }>;
  expect(saved.record).toMatchObject({ kind: "feeding", child_id: "baby", occurred_at: start.toISOString(),
    data: { method: "breast", side: "both", duration_minutes: 8 } });
  const [message, action] = scope.toast.mock.calls[scope.toast.mock.calls.length - 1];
  expect(message).toBe("Breastfeeding · Both sides · 8 min · logged");
  expect(find("Button", (p) => p.title === "Stop")).toHaveLength(0);

  await act(async () => action.onPress());
  expect(account.state.outbox.map((m) => m.type)).toEqual(["save", "delete"]);
  expect(account.state.feedTimer).toBeUndefined();
});

it("discards a timer only after confirming, and keeps one timer at a time", async () => {
  const account = setup();
  account.state.bootstrap!.children[0].birth_date = "2026-10-01";
  legacyTimer(account);
  await render();
  await tapFeedTile("Feeding");
  expect(scope.toast).toHaveBeenCalledWith(expect.stringContaining("timer is running"));

  await press("Cancel timer");
  expect(account.state.feedTimer).toBeDefined();
  const confirm = scope.alerts.find((alert) => alert.title === "Discard this feeding timer?")!;
  await act(async () => confirm.buttons.find((b) => b.text === "Keep timing")?.onPress?.());
  expect(account.state.feedTimer).toBeDefined();
  await act(async () => confirm.buttons.find((b) => b.text === "Discard")!.onPress!());
  await render();
  expect(account.state.feedTimer).toBeUndefined();
  expect(account.state.outbox).toEqual([]);
  expect(find("Button", (p) => p.title === "Stop")).toHaveLength(0);
});

it("restores a persisted timer after restart and hides one from an older space", async () => {
  const account = setup();
  account.state.bootstrap!.children[0].birth_date = "2026-10-01";
  account.state = { ...account.state, feedTimer: { child_id: "baby", generation: 2, started_at: start.toISOString(),
    segments: [{ side: "left", started_at: start.toISOString(), ended_at: new Date(start.getTime() + 4 * 60_000).toISOString() }],
    paused_at: new Date(start.getTime() + 4 * 60_000).toISOString() } };
  vi.setSystemTime(start.getTime() + 60 * 60_000);
  await render();
  expect(clock()).toBe("04:00");
  expect(find("Button", (p) => p.title === "Resume")).toHaveLength(1);

  account.state = { ...account.state, bootstrap: { ...account.state.bootstrap!, generation: 3 } };
  await render();
  expect(find("Button", (p) => p.title === "Stop")).toHaveLength(0);
  expect(find("Pressable", (p) => p.accessibilityLabel === "Breastfeed")).toHaveLength(1);
});

it("renders the initial empty care state without raw text in the screen layout", async () => {
  setup();
  await render();
  const children = React.Children.toArray(find("Screen", () => true)[0].props.children);
  expect(children.filter(child => typeof child === "string")).toEqual([]);
});

it("uses the child name in the header, replaces the hero with a timer, and stacks quick logs at large text", async () => {
  const account = setup();
  account.state.bootstrap!.children[0].birth_date = "2026-08-20";
  await render();
  expect(find("StackScreen", () => true)[0].props.options.title).toBe("Mia");
  expect(find("Screen", () => true)[0].props.subtitle).toBe("2 months old");
  expect(find("CareGlance", () => true)).toHaveLength(1);
  // Docked in the thumb's reach, until the largest text sizes where it scrolls with the page instead.
  expect(find("Screen", () => true)[0].props.docked).toBe(true);
  scope.fontScale = 3.1; await render();
  expect(find("Screen", () => true)[0].props.docked).toBe(false);
  expect(find("Pressable", p => p.accessibilityLabel === "Breastfeed")).toHaveLength(1);
  scope.fontScale = 1;
  legacyTimer(account); await render();
  expect(find("CareGlance", () => true)).toHaveLength(0);
  expect(find("Button", p => p.title === "Stop")).toHaveLength(1);
});
it("leads with the pregnancy and saved tips while pregnant, then switches to care once the birth date arrives", async () => {
  const account = setup(), child = account.state.bootstrap!.children[0];
  child.due_date = "2026-11-20";
  scope.care = [optimisticRecord({ id: "another-baby-feed", kind: "feeding", child_id: "baby", title: "Feed", body: "", occurred_at: start.toISOString(), data: { method: "breast" } })];
  await render();
  expect(find("StackScreen", () => true)[0].props.options.title).toBe("Mia");
  // This week's saved tips live inside the hero; "Coming up" follows it.
  expect(find("PregnancyHero", () => true)).toHaveLength(1);
  expect(find("WeekDetails", () => true)[0].props.tips).toBeDefined();
  expect(find("TipSection", () => true).map((n) => n.props.title)).toEqual(["Coming up"]);
  expect(find("Pressable", p => p.accessibilityLabel === "Breastfeed")).toHaveLength(0);
  expect(find("CareGlance", () => true)).toHaveLength(0);
  // Add has these now: nothing here says it twice.
  for (const label of ["Save a link", "Journal", "Doctor question"]) expect(find("Pressable", p => p.accessibilityLabel === label)).toHaveLength(0);
  // Under the tiles, above everything else, so she needn't scroll for it in labour.
  expect(find("Row", () => true).map((n) => n.props.title)).toEqual(["Baby’s here?", "Lists & routines"]);
  const order = renderer!.root.findAll((n) => ["PregnancyHero", "Row", "WeekDetails"].includes(String(n.type)) || String(n.props.accessibilityLabel) === "Vitamins & medicine").map((n) => String(n.type) === "Row" ? n.props.title : n.props.accessibilityLabel ?? String(n.type));
  expect([...new Set(order)].slice(0, 4)).toEqual(["PregnancyHero", "Vitamins & medicine", "Baby’s here?", "WeekDetails"]);
  await act(async () => (find("Row", p => p.title === "Baby’s here?")[0].props.onPress as () => void)());
  child.birth_date = "2026-11-02"; await render();
  expect(find("PregnancyHero", () => true)).toHaveLength(1);
  child.birth_date = "2026-10-19"; await render();
  expect(find("PregnancyHero", () => true)).toHaveLength(0);
  expect(find("CareGlance", () => true)).toHaveLength(1);
  expect(find("Pressable", p => p.accessibilityLabel === "Breastfeed")).toHaveLength(1);
  expect(find("BabyAgeCard", () => true)[0].props.tips).toBeDefined();
  expect(find("TipSection", () => true)).toHaveLength(0);
  account.state.bootstrap!.children = []; await render();
  expect(find("StackScreen", () => true)[0].props.options.title).toBe("Today");
  expect(find("BabySetupCard", () => true)[0].props.child).toBeNull();
  expect(find("Row", () => true).map((n) => n.props.title)).toEqual(["Lists & routines", "Journal", "Care history"]);
});

it("asks a named baby with no date which stage they're in, keeping care only if some is logged", async () => {
  setup();
  await render();
  expect(find("BabySetupCard", () => true)[0].props.child.id).toBe("baby");
  expect(find("CareGlance", () => true)).toHaveLength(0);
  expect(find("Pressable", p => p.accessibilityLabel === "Breastfeed")).toHaveLength(0);
  expect(find("Screen", () => true)[0].props.subtitle).toBeUndefined();
  scope.care = [optimisticRecord({ id: "logged", kind: "feeding", child_id: "baby", title: "Feed", body: "", occurred_at: start.toISOString(), data: { method: "breast", side: "left" } })];
  await render();
  expect(find("BabySetupCard", () => true)).toHaveLength(1);
  expect(find("CareGlance", () => true)).toHaveLength(1);
  expect(find("Pressable", p => p.accessibilityLabel === "Breastfeed")).toHaveLength(1);
});
it("is quiet about loading care only when there's no baby at all", async () => {
  const account = setup();
  scope.careError = "Could not connect.";
  // A named baby with no date and nothing cached: there may well be care to load, and she needs the retry.
  await render();
  expect(find("Notice", () => true)).toHaveLength(1);
  expect(find("Button", (p) => p.title === "Try loading care again")).toHaveLength(1);
  account.state.bootstrap!.children[0].birth_date = "2026-10-01"; await render();
  expect(find("Notice", () => true)).toHaveLength(1);
  account.state.bootstrap!.children = []; await render();
  expect(find("Notice", () => true)).toHaveLength(0);
  expect(find("Button", (p) => p.title === "Try loading care again")).toHaveLength(0);
  scope.careError = "";
});
it("drops the setup card as soon as there's a date", async () => {
  const account = setup();
  account.state.bootstrap!.children[0].birth_date = "2026-10-01"; await render();
  expect(find("BabySetupCard", () => true)).toHaveLength(0);
  account.state.bootstrap!.children[0].birth_date = null; account.state.bootstrap!.children[0].due_date = "2026-12-10"; await render();
  expect(find("BabySetupCard", () => true)).toHaveLength(0);
});
describe("Baby's here?", () => {
  const due = () => {
    const account = setup();
    account.state.bootstrap!.children[0].due_date = "2026-11-20";
    account.state.records = [optimisticRecord({ id: "c", kind: "contraction", child_id: "baby", title: "Contraction", body: "", occurred_at: start.toISOString(), data: {} })];
    // As the provider does on every write.
    account.commit = vi.fn(async (change: (state: DeviceState) => DeviceState) => { account.state = withPendingBirths(change(account.state)); });
    account.queue = vi.fn(async (m: Mutation) => { account.state = withPendingBirths({ ...account.state, outbox: [...account.state.outbox, m] }); });
    return account;
  };
  const here = () => find("Row", (p) => p.title === "Baby’s here?")[0];
  it("keeps today's date on this phone in one tap and turns on care at once, with nothing lost and an Undo", async () => {
    const account = due();
    await render();
    await act(async () => { (here().props.onPress as () => void)(); });
    expect(account.state.outbox).toEqual([expect.objectContaining({ type: "child_birth", child_id: "baby", birth_date: "2026-10-20", previous: null, generation: 2 })]);
    await render();
    expect(account.state.bootstrap!.children[0]).toMatchObject({ birth_date: "2026-10-20", due_date: "2026-11-20", revision: 1 });
    expect(find("Pressable", (p) => p.accessibilityLabel === "Breastfeed")).toHaveLength(1);
    expect(find("CareGlance", () => true)).toHaveLength(1);
    expect(account.state.records.map((row) => row.id)).toEqual(["c"]);
    const [message, action] = scope.toast.mock.lastCall as [string, { label: string; onPress: () => Promise<void> }];
    expect(message).toContain("Birth date set to today");
    expect(action.label).toBe("Undo");
    await act(async () => { await action.onPress(); });
    expect(account.state.outbox).toEqual([]);
    await render();
    expect(find("Row", (p) => p.title === "Baby’s here?")).toHaveLength(1);
  });
  it("undoes by going back the same way once the request has begun, because the API may have it", async () => {
    const account = due();
    await render();
    await act(async () => { (here().props.onPress as () => void)(); });
    const first = account.state.outbox[0];
    account.state = { ...account.state, outbox: [{ ...first, sent: true } as Mutation] };
    const [, action] = scope.toast.mock.lastCall as [string, { onPress: () => Promise<void> }];
    await act(async () => { await action.onPress(); });
    expect(account.state.outbox.map((m) => (m.type === "child_birth" ? [m.birth_date, m.previous] : []))).toEqual([["2026-10-20", null], [null, "2026-10-20"]]);
    expect(account.state.bootstrap!.children[0].birth_date).toBeNull();
  });
  it("uses the family's day, not the phone's", async () => {
    const account = due();
    account.state.bootstrap!.profile.timezone = "Pacific/Kiritimati";
    vi.setSystemTime(new Date("2026-10-20T11:00:00.000Z"));
    await render();
    await act(async () => { (here().props.onPress as () => void)(); });
    expect(account.state.outbox[0]).toMatchObject({ birth_date: "2026-10-21" });
  });
  it("says why when this phone can't keep it, and leaves her where she was", async () => {
    const account = due();
    account.queue = vi.fn(async () => { throw Error("Restore your private device data before saving."); });
    await render();
    await act(async () => { (here().props.onPress as () => void)(); });
    expect(scope.toast).toHaveBeenCalledWith("Restore your private device data before saving.");
    expect(account.state.bootstrap!.children[0].birth_date).toBeUndefined();
  });
  it("reaches both tools from Today in one tap", async () => {
    due();
    await render();
    for (const [title, route] of [["Contraction timer", "/contractions"], ["Kick counter", "/kicks"]]) {
      (find("Pressable", (p) => p.accessibilityLabel === title)[0].props.onPress as () => void)();
      expect(scope.push).toHaveBeenCalledWith(route);
    }
  });
});

it("keeps child B's routine out of child A's Today summary when Everything is selected", async () => {
  const account = setup();
  account.state.bootstrap!.children.push({ id: "other-baby", name: "Noah", revision: 1 });
  const routine = (id: string, child_id: string | null) => optimisticRecord({
    id, kind: "routine", title: id, body: "", child_id, occurred_at: start.toISOString(),
    data: { items: [{ id: "pack", label: "Pack bag", done: false }] },
  });
  account.records = [routine("Noah's checklist", "other-baby"), routine("Mia's checklist", "baby"), routine("General checklist", null)];
  await render();
  expect(find("Screen", () => true)[0].props.title).toBe("Mia");
  expect(find("Row", p => p.title === "Mia's checklist")).toHaveLength(1);
  expect(find("Row", p => p.title === "Noah's checklist")).toHaveLength(0);
  account.records = account.records.filter(row => row.child_id !== "baby");
  await render();
  expect(find("Row", p => p.title === "General checklist")).toHaveLength(1);
  account.state.selectedChild = "other-baby";
  await render();
  expect(find("Screen", () => true)[0].props.title).toBe("Noah");
  expect(find("Row", p => p.title === "Noah's checklist")).toHaveLength(1);
});
it("asks for the birth date instead of a late pregnancy week once the due date is past 44 weeks 6 days", async () => {
  const account = setup();
  account.state.bootstrap!.children[0].due_date = "2026-09-01"; // 329 days on Oct 20 in Guam
  await render();
  expect(find("PregnancyHero", () => true)).toHaveLength(0);
  expect(find("TipSection", () => true)).toHaveLength(0);
  expect(find("CareGlance", () => true)).toHaveLength(0);
  expect(find("Row", p => p.title === "Baby’s here?")).toHaveLength(0);
  expect(find("Copy", p => String(p.children).startsWith("Due Sep 1 · 49 days past due."))).toHaveLength(1);
  await press("Add the birth date");
  expect(scope.push).toHaveBeenLastCalledWith({ pathname: "/child", params: { id: "baby", stage: "here" } });
});
it("keeps the pregnancy layout with a sibling's running feed timer on top", async () => {
  const account = setup(), state = account.state;
  state.bootstrap!.children = [{ id: "ana", name: "Ana", birth_date: "2025-01-05", revision: 1 }, { id: "baby", name: "Mia", due_date: "2026-11-20", revision: 1 }];
  await render();
  // Nobody selected: Today follows the one ongoing pregnancy, as the API does, not the first child by name.
  expect(find("StackScreen", () => true)[0].props.options.title).toBe("Mia");
  expect(find("PregnancyHero", () => true)[0].props.child.id).toBe("baby");
  account.state = { ...account.state, feedTimer: { child_id: "ana", generation: 2, started_at: start.toISOString(), segments: [{ side: "left", started_at: start.toISOString() }] } };
  await render();
  expect(find("View", p => String(p.accessibilityLabel).startsWith("Feeding Ana."))).toHaveLength(1);
  expect(find("Button", p => p.title === "Stop")).toHaveLength(1);
  expect(find("PregnancyHero", () => true)).toHaveLength(1);
  expect(find("TipSection", () => true).map((n) => n.props.title)).toEqual(["Coming up"]);
  account.state = { ...account.state, selectedChild: "ana" };
  await render();
  expect(find("PregnancyHero", () => true)).toHaveLength(0);
  expect(find("CareGlance", () => true)).toHaveLength(0); // the timer replaces the care hero
  expect(find("Pressable", p => p.accessibilityLabel === "Feeding")).toHaveLength(1);
});

it("keeps a half-typed question across a due baby's layout and a born baby's, which are different screens", async () => {
  const account = setup(), bootstrap = account.state.bootstrap!, due = { id: "noa", name: "Noa", revision: 1, due_date: "2026-12-10" }, born = { id: "kai", name: "Kai", revision: 1, birth_date: "2026-01-15" };
  account.state = { ...account.state, selectedChild: "noa", bootstrap: { ...bootstrap, children: [due, born] } };
  await render();
  const drafts = () => find("NextEvent", () => true)[0].props.drafts as { typed: Record<string, string>; write: (target: string, text: string) => void };
  expect(find("NextEvent", () => true)[0].props.childId).toBe("noa");
  await act(async () => drafts().write("visit:noa", "Half typed"));
  account.state = { ...account.state, selectedChild: "kai" };
  await render();
  expect(find("NextEvent", () => true)[0].props.childId).toBe("kai");
  expect(drafts().typed["visit:noa"]).toBe("Half typed");
  account.state = { ...account.state, selectedChild: "noa" };
  await render();
  expect(drafts().typed["visit:noa"]).toBe("Half typed");
});

describe("Today follows the trackers", () => {
  const tiles = () => find("Pressable", () => true).map((node) => node.props.accessibilityLabel);
  const baby = (details: object, birth_date = "2026-10-01") => { const account = setup(); Object.assign(account.state.bootstrap!.children[0], { birth_date, details }); return account; };
  const expecting = (details: object = {}) => { const account = setup(); Object.assign(account.state.bootstrap!.children[0], { due_date: "2026-12-10", details }); return account; };
  it("while expecting, leads with the week, then that stage's trackers as tiles, then the next event", async () => {
    expecting();
    await render();
    const seen = renderer!.root.findAll((n) => ["PregnancyHero", "WeekDetails", "NextEvent", "TipSection"].includes(String(n.type)) || (String(n.type) === "Pressable" && !!n.props.accessibilityLabel))
      .map((n) => n.props.accessibilityLabel ?? String(n.type));
    expect(seen).toEqual(["PregnancyHero", "Kick counter", "Contraction timer", "How I’m feeling", "My weight", "Blood pressure", "Vitamins & medicine", "WeekDetails", "NextEvent", "TipSection"]);
  });
  it("takes a tracker off expecting Today when it's off, and adds one when it's on", async () => {
    expecting({ tracking: { expecting_my_weight: false, expecting_diaper: true } });
    await render();
    expect(tiles()).not.toContain("My weight");
    expect(tiles()).toContain("Diaper");
    (find("Pressable", (p) => p.accessibilityLabel === "Diaper")[0].props.onPress as () => void)();
    expect(scope.push).toHaveBeenCalledWith({ pathname: "/add", params: { open: "diaper" } });
  });
  it("leaves the calendar to Add once the baby's here, unless something's coming up, and keeps it while expecting", async () => {
    baby({});
    await render();
    expect(find("NextEvent", () => true)[0].props.quiet).toBe(true);
    await act(async () => renderer!.unmount()); renderer = undefined;
    expecting();
    await render();
    expect(find("NextEvent", () => true)[0].props.quiet).toBeFalsy();
  });
  it("keeps the feed card when only diapers are off, and drops Next side when nursing is off", async () => {
    baby({ tracking: { diaper: false } });
    await render();
    expect(find("CareGlance", () => true)[0].props.sides).toBe(true);
    await act(async () => renderer!.unmount()); renderer = undefined;
    baby({ tracking: { breast: false } });
    await render();
    expect(find("CareGlance", () => true)[0].props.sides).toBe(false);
  });
  it("keeps a way to end a sleep already running when Sleep is switched off, and says when two are", async () => {
    baby({ tracking: { sleep: false } });
    const sleep = (id: string) => optimisticRecord({ id, kind: "sleep", child_id: "baby", title: "Sleep", body: "", occurred_at: start.toISOString(), data: {} } as never);
    await render();
    expect(tiles()).not.toContain("Sleep");
    scope.care = [sleep("a")];
    await render();
    expect(tiles()).toContain("Sleeping");
    expect(find("Row", () => true).map((n) => n.props.title)).toContain("Sleeping now");
    scope.care = [sleep("a"), sleep("b")];
    await render();
    expect(find("Row", () => true).map((n) => n.props.title)).toContain("2 sleeps running");
  });
  it("is the same docked log as before by default", async () => {
    baby({});
    await render();
    expect(tiles().filter((label) => ["Breastfeed", "Bottle", "Diaper", "Sleep"].includes(label))).toEqual(["Breastfeed", "Bottle", "Diaper", "Sleep"]);
    expect(find("Row", () => true).map((n) => n.props.title)).toContain("0 diapers today");
    expect(find("CareGlance", () => true)).toHaveLength(1);
  });
  it("turning diapers off takes every diaper button and count off Today", async () => {
    baby({ tracking: { diaper: false } });
    await render();
    expect(tiles()).not.toContain("Diaper");
    expect(find("Row", () => true).map((n) => n.props.title)).not.toContain("0 diapers today");
    const line = tiles().find((label) => label?.startsWith("Today:"))!;
    expect(line).toContain("feeds");
    expect(line).not.toContain("pee");
    expect(find("Row", () => true).map((n) => n.props.title)).toContain("Care history");
  });
  it("how she's feeding sets the tiles, and the first left is the big one", async () => {
    baby({ feeding: "bottle" });
    await render();
    expect(tiles()).not.toContain("Breastfeed");
    expect(tiles()).toContain("Bottle");
  });
  it("drops the feed card once no feed tracker is on, unless a feed is running", async () => {
    baby({ tracking: { breast: false, bottle: false } });
    await render();
    expect(find("CareGlance", () => true)).toHaveLength(0);
    scope.care = [optimisticRecord({ id: "f", kind: "feeding", child_id: "baby", title: "Feed", body: "", occurred_at: start.toISOString(),
      data: { method: "breast", side: "left", actions: [{ id: "a", action: "start", side: "left", at: start.toISOString() }] } } as never)];
    await render();
    expect(find("CareGlance", () => true)).toHaveLength(1);
  });
  it("adds a pinned tracker to the dock, and opens it in Add, where the keyboard has room", async () => {
    baby({ tracking: { pumping: true, milestone: true } });
    await render();
    expect(tiles()).toEqual(expect.arrayContaining(["Breastfeed", "Pumping", "Milestones"]));
    (find("Pressable", (p) => p.accessibilityLabel === "Pumping")[0].props.onPress as () => void)();
    expect(scope.push).toHaveBeenLastCalledWith({ pathname: "/add", params: { open: "pumping" } });
    (find("Pressable", (p) => p.accessibilityLabel === "Milestones")[0].props.onPress as () => void)();
    expect(scope.push).toHaveBeenLastCalledWith("/milestones");
    // Its tile says it already, so the row steps back.
    expect(find("Row", () => true).map((n) => n.props.title)).not.toContain("Milestones");
  });
  it("has the suggestion card only once the baby's here", async () => {
    baby({});
    await render();
    expect(find("TrackerSuggestion", () => true)).toHaveLength(1);
    await act(async () => renderer!.unmount()); renderer = undefined;
    expecting();
    await render();
    expect(find("TrackerSuggestion", () => true)).toHaveLength(0);
  });
  it("points to What shows when she's turned everything off, rather than leave no way back", async () => {
    baby({ tracking: { breast: false, bottle: false, diaper: false, sleep: false } });
    await render();
    const row = find("Row", (p) => p.title === "What shows")[0];
    expect(row).toBeDefined();
    (row.props.onPress as () => void)();
    expect(scope.push).toHaveBeenCalledWith({ pathname: "/what-shows", params: { child: "baby" } });
  });
  it("offers what she'd log about herself while she's expecting", async () => {
    expecting();
    await render();
    for (const label of ["How I’m feeling", "My weight", "Blood pressure", "Vitamins & medicine"]) expect(tiles()).toContain(label);
    expect(tiles()).not.toContain("Pumping");
  });
  it("leaves the docked log alone once the baby's here: these are off Today by default", async () => {
    baby({});
    await render();
    expect(tiles()).toContain("Breastfeed");
    for (const label of ["Pumping", "Medicine", "Temperature", "Growth", "How I’m feeling"]) expect(tiles()).not.toContain(label);
  });
});
