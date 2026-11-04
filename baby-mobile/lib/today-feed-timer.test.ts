import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type Mutation } from "./models";

const scope = vi.hoisted(() => ({
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
  useTodayCare: () => ({ rows: scope.care.slice(0, 3), all: scope.care, loading: false, error: "", refresh: vi.fn() }),
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
vi.mock("@/components/care-glance", () => ({ CareGlance: "CareGlance", FirstStep: "FirstStep", useMinuteClock: () => new Date() }));
vi.mock("@/components/feed-timer", () => import("../components/feed-timer"));
vi.mock("@/components/quick-log", () => import("../components/quick-log"));
vi.mock("@/lib/running-feed", () => import("./running-feed"));
vi.mock("@/lib/feed-reducer", () => import("./feed-reducer"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/care-summary", () => import("./care-summary"));
vi.mock("@/lib/use-care-summary", () => ({ useCareSummary: () => undefined }));
vi.mock("@/lib/api", () => ({ sendsCareDetails: false }));
vi.mock("../components/date-field", () => ({ DateField: "DateField" }));
vi.mock("../components/motion", () => ({ useReducedMotion: () => false }));
vi.mock("@/components/tips", () => ({ PregnancyHero: "PregnancyHero", TipSection: "TipSection" }));
vi.mock("@/lib/timing", () => import("./timing"));
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
  expect(find("PregnancyHero", () => true)[0].props.tips).toBeDefined();
  expect(find("TipSection", () => true).map((n) => n.props.title)).toEqual(["Coming up"]);
  expect(find("Pressable", p => p.accessibilityLabel === "Breastfeed")).toHaveLength(0);
  expect(find("CareGlance", () => true)).toHaveLength(0);
  for (const label of ["Save a link", "Journal", "Doctor question"]) expect(find("Pressable", p => p.accessibilityLabel === label)).toHaveLength(1);
  expect(find("Row", () => true).map((n) => n.props.title)).toEqual(["Doctor questions", "Journal", "Lists & routines", "Baby’s here?"]);
  await act(async () => (find("Row", p => p.title === "Baby’s here?")[0].props.onPress as () => void)());
  child.birth_date = "2026-11-02"; await render();
  expect(find("PregnancyHero", () => true)).toHaveLength(1);
  child.birth_date = "2026-10-19"; await render();
  expect(find("PregnancyHero", () => true)).toHaveLength(0);
  expect(find("CareGlance", () => true)).toHaveLength(1);
  expect(find("Pressable", p => p.accessibilityLabel === "Breastfeed")).toHaveLength(1);
  expect(find("TipSection", () => true).map((n) => n.props.title)).toEqual(["For this age"]);
  account.state.bootstrap!.children = []; await render();
  expect(find("StackScreen", () => true)[0].props.options.title).toBe("Today");
  expect(find("FirstStep", () => true)[0].props.child).toBeNull();
  expect(find("Row", p => p.title === "Add a baby profile")).toHaveLength(1);
});

describe("Baby's here?", () => {
  const due = () => {
    const account = setup() as ReturnType<typeof setup> & { api: { child: ReturnType<typeof vi.fn> } };
    account.state.bootstrap!.children[0].due_date = "2026-11-20";
    account.state.records = [optimisticRecord({ id: "c", kind: "contraction", child_id: "baby", title: "Contraction", body: "", occurred_at: start.toISOString(), data: {} })];
    account.api = { child: vi.fn(async (value: object) => ({ ...account.state.bootstrap!.children[0], ...value, revision: 2 })) };
    return account;
  };
  const here = () => find("Row", (p) => p.title === "Baby’s here?")[0];
  it("sets today's date in one tap and turns on care, with nothing lost and an Undo", async () => {
    const account = due();
    await render();
    await act(async () => { (here().props.onPress as () => void)(); });
    expect(account.api.child).toHaveBeenCalledWith({ id: "baby", name: "Mia", due_date: "2026-11-20", birth_date: "2026-10-20", revision: 1 }, 2);
    await render();
    expect(account.state.bootstrap!.children[0]).toMatchObject({ birth_date: "2026-10-20", due_date: "2026-11-20" });
    expect(find("Pressable", (p) => p.accessibilityLabel === "Breastfeed")).toHaveLength(1);
    expect(find("CareGlance", () => true)).toHaveLength(1);
    expect(account.state.records.map((row) => row.id)).toEqual(["c"]);
    expect(account.state.outbox).toEqual([]);
    const [message, action] = scope.toast.mock.lastCall as [string, { label: string; onPress: () => Promise<void> }];
    expect(message).toContain("Birth date set to today");
    expect(action.label).toBe("Undo");
    await act(async () => { await action.onPress(); });
    expect(account.api.child).toHaveBeenLastCalledWith({ id: "baby", name: "Mia", due_date: "2026-11-20", birth_date: null, revision: 2 }, 2);
    await render();
    expect(find("Row", (p) => p.title === "Baby’s here?")).toHaveLength(1);
  });
  it("uses the family's day, not the phone's", async () => {
    const account = due();
    account.state.bootstrap!.profile.timezone = "Pacific/Kiritimati";
    vi.setSystemTime(new Date("2026-10-20T11:00:00.000Z"));
    await render();
    await act(async () => { (here().props.onPress as () => void)(); });
    expect(account.api.child).toHaveBeenCalledWith(expect.objectContaining({ birth_date: "2026-10-21" }), 2);
  });
  it("says why when it can't reach the service, and leaves her where she was", async () => {
    const account = due();
    account.api.child.mockRejectedValueOnce(Error("Connect to save this."));
    await render();
    await act(async () => { (here().props.onPress as () => void)(); });
    expect(scope.toast).toHaveBeenCalledWith("Connect to save this.");
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
  expect(scope.push).toHaveBeenLastCalledWith({ pathname: "/child", params: { id: "baby" } });
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

