import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState } from "./models";

const mock = vi.hoisted(() => ({ summaries: [] as unknown[][], otherAsks: [] as unknown[][], others: undefined as ReadonlyMap<string, string[]> | undefined, gone: new Set<string>(), baby: null as any, care: [] as any[], requests: [] as any[], params: {} as Record<string, string>, push: vi.fn(), fontScale: 1, quick: [] as any[], error: "", summary: undefined as any, statsAsks: [] as unknown[][], statsRefresh: vi.fn() }));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView",
  useWindowDimensions: () => ({ fontScale: mock.fontScale }),
}));
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return { Stack: { Screen: () => null }, router: { push: mock.push }, useLocalSearchParams: () => mock.params, useFocusEffect: (fn: () => void) => useEffect(fn, [fn]) };
});
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/feed-reducer", () => import("./feed-reducer"));
vi.mock("@/lib/contractions", () => import("./contractions"));
vi.mock("@/lib/kicks", () => import("./kicks"));
vi.mock("@/lib/care-summary", () => import("./care-summary"));
vi.mock("@/lib/care-days", () => import("./care-days"));
vi.mock("@/lib/use-care-summary", () => ({ useCareSummary: (...args: unknown[]) => { mock.summaries.push(args); return mock.summary; },
  useOtherDays: (...args: unknown[]) => { mock.otherAsks.push(args); return mock.others; }, useDeleted: () => mock.gone }));
vi.mock("@/components/feed-timer", () => ({ LegacyTimer: "LegacyTimer" }));
vi.mock("@/lib/today-care", () => ({ useTodayCare: (options: any = {}) => {
  mock.requests.push(options);
  return { all: mock.care, rows: mock.care, loading: false, error: options.occurred_from ? mock.error : "", refresh: vi.fn() };
} }));
const ui = vi.hoisted(() => ({
  FilterChips: "FilterChips", PressTarget: "Pressable", Icon: "Icon", Copy: "Copy", Grouped: "Grouped", Notice: "Notice", Row: "Row", Screen: "Screen", Empty: "Empty",
  fonts: {}, radii: {}, typeScale: { caption: {} }, useColors: () => ({}),
}));
vi.mock("@/components/ui", () => ui);
vi.mock("../components/ui", () => ui);
vi.mock("../components/record-row", () => ({ kindIcon: {} }));
vi.mock("@/components/tab-stack", () => ({ HeaderPill: "HeaderPill" }));
vi.mock("@/components/child-filter", () => ({ ChildFilter: "ChildFilter" }));
vi.mock("@/components/sync-status", () => ({ SyncStatus: "SyncStatus" }));
vi.mock("@/components/care-glance", () => ({ useMinuteClock: () => new Date() }));
vi.mock("@/components/quick-log", () => ({ QuickLog: (props: any) => { mock.quick.push(props); return "quick-log"; } }));
vi.mock("@/components/tracker-day", () => import("../components/tracker-day"));
vi.mock("@/components/tracker-month", () => ({ TrackerMonth: "TrackerMonth" }));
vi.mock("@/components/tracker-stats", () => ({ TrackerStats: "TrackerStats" }));
vi.mock("@/lib/use-care-stats", () => ({ useCareStats: (choice: unknown, child: unknown) => { mock.statsAsks.push([choice, child]); return { loading: false, refresh: mock.statsRefresh }; } }));
import Tracker from "../app/(tabs)/tracker/index";
import { timelineDetail } from "../components/tracker-day";
import { ChildFilter } from "@/components/child-filter";

const now = new Date("2026-11-04T03:00:00.000Z"); // Wednesday Nov 4, 1 PM in Guam
let renderer: ReactTestRenderer | undefined;
const row = (id: string, kind: "feeding" | "diaper" | "sleep" | "journal", occurred_at: string, data: BabyRecord["data"] = {}, body = "") =>
  optimisticRecord({ id, kind, title: kind === "journal" ? "First night" : "", body, child_id: kind === "journal" ? null : "baby", occurred_at, data });
const screen = () => renderer!.root.findAll((n) => String(n.type) === "Screen")[0];
const targets = () => renderer!.root.findAll((n) => String(n.type) === "Pressable");
const target = (label: string) => targets().find((n) => n.props.accessibilityLabel === label || n.props.accessibilityLabel?.startsWith(label));
const copy = () => renderer!.root.findAll((n) => String(n.type) === "Copy").map((n) => n.props.children);
const titles = () => renderer!.root.findAll((n) => String(n.type) === "Text").map((n) => [n.props.children].flat().join(""));
async function mount() { mock.baby.state.records = mock.care; await act(async () => { renderer = create(<Tracker />); }); }
async function press(label: string) {
  const node = target(label);
  expect(node, label).toBeDefined();
  await act(async () => node!.props.onPress());
}
const lastQuick = () => screen().props.footer.props;
beforeEach(() => {
  vi.useFakeTimers({ now });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mock.summaries = []; mock.otherAsks = []; mock.others = undefined; mock.gone = new Set(); mock.care = []; mock.requests = []; mock.params = {}; mock.push.mockClear(); mock.fontScale = 1; mock.quick = []; mock.error = ""; mock.summary = undefined; mock.statsAsks = []; mock.statsRefresh = vi.fn();
  mock.baby = { state: { ...emptyState(), bootstrap: { generation: 1, active: true, ai_available: false,
    children: [{ id: "baby", name: "Mia", revision: 1, birth_date: "2026-10-25" }],
    profile: { display_name: "K", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("one baby at a time", () => {
  const two = () => {
    mock.baby.state.bootstrap.children = [{ id: "baby", name: "Mia", revision: 1, birth_date: "2026-10-25" }, { id: "sister", name: "Noa", revision: 1, birth_date: "2026-10-25" }];
    mock.baby.commit = vi.fn(async () => undefined);
  };
  it("uses the same baby for the timeline, totals, dots and logging when nothing is selected", async () => {
    two();
    await mount();
    expect(mock.requests.length).toBeGreaterThan(0);
    const child = mock.summaries[0][0];
    expect(child).toBe("baby");
    expect(mock.requests.every((request) => request.child === child)).toBe(true);
    expect(mock.otherAsks[0][0]).toBe(child);
    expect(lastQuick().child.id).toBe(child);
    // It names that baby. "Everything" would say something the screen isn't showing.
    expect(renderer!.root.findByType(ChildFilter as never).props.only).toBe(child);
  });
  it("follows a selected baby everywhere", async () => {
    two();
    mock.baby.state.selectedChild = "sister";
    await mount();
    expect(mock.summaries[0][0]).toBe("sister");
    expect(mock.requests.every((request) => request.child === "sister")).toBe(true);
    expect(lastQuick().child.id).toBe("sister");
  });
});

describe("Stats", () => {
  const stats = () => renderer!.root.findByType("TrackerStats" as never);
  const views = () => renderer!.root.findAll((n) => String(n.type) === "FilterChips").find((n) => n.props.label === "Tracker view")!;
  it("is one tap from Day, and asks for nothing until it's open", async () => {
    await mount();
    expect(mock.statsAsks.at(-1)![0]).toBeNull();
    await act(async () => views().props.onChange("stats"));
    expect(mock.statsAsks.at(-1)).toEqual([{ range: "7d" }, "baby"]);
    expect(stats().props.childId).toBe("baby");
  });
  it("a bar opens its day, and coming back finds the same range", async () => {
    await mount();
    await act(async () => views().props.onChange("stats"));
    await act(async () => stats().props.onChoose({ range: "30d" }));
    await act(async () => stats().props.onOpen("2026-10-30"));
    expect(views().props.value).toBe("day");
    expect(renderer!.root.findAll((n) => String(n.type) === "Copy").map((n) => n.props.children).join()).toContain("Oct 30");
    await act(async () => views().props.onChange("stats"));
    expect(mock.statsAsks.at(-1)![0]).toEqual({ range: "30d" });
  });
  it("pull to refresh reads the numbers again", async () => {
    await mount();
    await act(async () => views().props.onChange("stats"));
    await act(async () => { await screen().props.onRefresh(); });
    expect(mock.statsRefresh).toHaveBeenCalled();
  });
});

describe("the week strip's dots", () => {
  const marked = () => renderer!.root.findAll((n) => String(n.type) === "Pressable").filter((n) => String(n.props.accessibilityLabel).includes("has entries")).map((n) => String(n.props.accessibilityLabel));
  it("shows days with only a note, question, contraction or kick session", async () => {
    mock.others = new Map([["2026-11-02", ["kick"]]]);
    await mount();
    expect(marked().join()).toContain("November 2");
    expect(marked().join()).not.toContain("November 3");
  });
  it("takes a queued delete off, and keeps it off once it has left the queue", async () => {
    mock.others = new Map([["2026-11-02", ["kick"]]]);
    mock.baby.state.outbox = [{ id: "d", generation: 1, type: "delete", record: { ...optimisticRecord({ id: "kick", kind: "kick_session", title: "", body: "", child_id: "baby", occurred_at: "2026-11-02T02:00:00.000Z", data: {} }), revision: 1 } }];
    await mount();
    expect(marked()).toEqual([]);
    mock.baby.state.outbox = [];
    mock.gone = new Set(["kick"]);
    await act(async () => renderer!.update(<Tracker />));
    expect(marked()).toEqual([]);
  });
});

it("opens on today with a summary, the quick log and everything in order, newest first", async () => {
  mock.care = [
    row("old", "diaper", "2026-11-03T22:00:00.000Z", { type: "wet" }), row("new", "feeding", "2026-11-04T02:00:00.000Z", { method: "breast", side: "left" }),
    row("note", "journal", "2026-11-04T01:00:00.000Z"), row("yesterday", "diaper", "2026-11-03T10:00:00.000Z", { type: "dry" }),
  ];
  await mount();
  expect(copy()).toContain("Today");
  expect(copy()).toContain("1 feed · 1 pee · 0 poo · 0h sleep");
  expect(screen().props.footer).toBeTruthy();
  const rows = targets().filter((n) => n.props.accessibilityHint === "Opens this entry to change it").map((n) => n.props.accessibilityLabel);
  expect(rows.map((l) => l.split(", ").slice(1).join(", ").split(". ")[0])).toEqual(["Breastfeeding · Left side", "Journal entry", "Diaper · Pee"]);
  await press("Newest first");
  const flipped = targets().filter((n) => n.props.accessibilityHint === "Opens this entry to change it").map((n) => n.props.accessibilityLabel);
  expect(flipped[0]).toContain("Diaper · Pee");
  expect(target("Oldest first")).toBeDefined();
});

it("asks the API for the day and the one before, for a sleep over midnight", async () => {
  await mount();
  const day = mock.requests.find((r) => r.occurred_from);
  expect(day).toMatchObject({ occurred_from: "2026-11-02T14:00:00.000Z", occurred_to: "2026-11-04T14:00:00.000Z", poll: true, kinds: ["feeding", "sleep", "diaper", "journal", "question", "contraction", "kick_session"] });
});

it("reaches any recent day in one tap, and steps by day, with a way back to today", async () => {
  mock.care = [row("d", "diaper", "2026-11-02T00:00:00.000Z", { type: "wet" })];
  await mount();
  expect(target("Back to today")).toBeUndefined();
  const monday = targets().find((n) => String(n.props.accessibilityLabel).includes("November 2"))!;
  expect(monday.props.accessibilityLabel).toContain("has entries");
  await act(async () => monday.props.onPress());
  expect(copy()).toContain("0 feeds · 1 pee · 0 poo · 0h sleep");
  expect(titles().join(" ")).toContain("Diaper · Pee");
  expect(mock.requests.filter((r) => r.occurred_from).at(-1)).toMatchObject({ poll: false });
  await act(async () => target("Day before")!.props.onPress());
  expect(copy().join(" ")).toContain("Nov 1");
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "HeaderPill")[0].props.onPress());
  expect(copy()).toContain("Today");
});

it("logs into the day on screen: past days ask for the time, future days have no quick log", async () => {
  await mount();
  expect(lastQuick().pastDay).toBeUndefined();
  await press("Day before");
  expect(lastQuick().pastDay).toEqual({ key: "2026-11-03", timezone: "Pacific/Guam" });
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "HeaderPill")[0].props.onPress());
  await press("Day after");
  expect(screen().props.footer).toBeFalsy();
  const empty = renderer!.root.findAll((n) => String(n.type) === "Empty")[0];
  expect(empty.props.title).toBe("Nothing planned yet");
});

it("opens a day from a link, and ignores anything that isn't a date", async () => {
  mock.params = { day: "2026-10-26", at: "1" };
  await mount();
  expect(copy().join(" ")).toContain("Oct 26");
  await act(async () => { mock.params = { day: "../../secrets", at: "2" }; renderer!.update(<Tracker />); });
  expect(copy().join(" ")).toContain("Oct 26");
});

it("opens an entry from the timeline, to change it", async () => {
  mock.care = [row("feed", "feeding", "2026-11-04T02:00:00.000Z", { method: "bottle", amount: 3, unit: "oz" })];
  await mount();
  await act(async () => targets().find((n) => n.props.accessibilityHint === "Opens this entry to change it")!.props.onPress());
  expect(mock.push).toHaveBeenCalledWith({ pathname: "/record/[id]", params: { id: "feed" } });
});

it("shows what's on the phone when it can't reach the service", async () => {
  mock.error = "Could not connect.";
  mock.care = [row("d", "diaper", "2026-11-04T01:00:00.000Z", { type: "wet" })];
  await mount();
  expect(renderer!.root.findAll((n) => String(n.type) === "Notice")).toHaveLength(1);
  expect(titles().join(" ")).toContain("Diaper · Pee");
});

it("before the birth, opens on the calendar and the tools, with no quick log, and a day still opens", async () => {
  mock.baby.state.bootstrap.children = [{ id: "baby", name: "Mia", revision: 1, due_date: "2026-12-10" }];
  await mount();
  expect(screen().props.footer).toBeFalsy();
  expect(renderer!.root.findAll((n) => String(n.type) === "TrackerMonth")).toHaveLength(1);
  const rows = () => renderer!.root.findAll((n) => String(n.type) === "Row");
  expect(rows().map((n) => n.props.title)).toEqual(["Contraction timer", "Kick counter", "Doctor summary", "Care history"]);
  await act(async () => rows()[0].props.onPress());
  expect(mock.push).toHaveBeenCalledWith("/contractions");
  await act(async () => rows()[1].props.onPress());
  expect(mock.push).toHaveBeenCalledWith("/kicks");
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "TrackerMonth")[0].props.onOpen("2026-11-02"));
  expect(screen().props.footer).toBeFalsy();
  expect(renderer!.root.findAll((n) => String(n.type) === "Empty")[0].props.body).toContain("once the baby’s here");
});

it("goes straight to the day and the log once she's born, with nothing else to choose", async () => {
  mock.baby.state.bootstrap.children = [{ id: "baby", name: "Mia", revision: 1, due_date: "2026-12-10" }];
  await mount();
  mock.baby.state = { ...mock.baby.state, bootstrap: { ...mock.baby.state.bootstrap, children: [{ id: "baby", name: "Mia", revision: 2, due_date: "2026-12-10", birth_date: "2026-11-04" }] } };
  await act(async () => renderer!.update(<Tracker />));
  expect(renderer!.root.findAll((n) => String(n.type) === "TrackerMonth")).toHaveLength(0);
  expect(screen().props.footer).toBeTruthy();
  expect(renderer!.root.findAll((n) => String(n.type) === "Row").map((n) => n.props.title)).toEqual(["Doctor summary", "Care history"]);
});

it("moves the quick log into the page at the largest text sizes", async () => {
  mock.fontScale = 2;
  await mount();
  expect(screen().props.footer).toBeFalsy();
  expect(mock.quick.length).toBeGreaterThan(0);
});

it("describes a timeline row with what the title doesn't say", () => {
  const started = "2026-11-04T02:45:00.000Z", actions = [{ id: "s", action: "start" as const, at: started, side: "left" as const }];
  expect(timelineDetail(row("x", "feeding", started, { method: "breast", actions }), { now })).toBe("Feeding now");
  expect(timelineDetail(row("x", "feeding", "2026-11-03T02:45:00.000Z", { method: "breast", actions: [{ ...actions[0], at: "2026-11-03T02:45:00.000Z" }] }), { now })).toBe("No end time");
  expect(timelineDetail(row("x", "diaper", started, { type: "dirty" }, "First black one\nsecond line"), { now })).toBe("First black one");
  expect(timelineDetail(row("x", "sleep", started, { end_at: "2026-11-04T03:45:00.000Z" }), { now })).toMatch(/to/);
});

it("opens a day from the calendar, back in the Day view with its quick log", async () => {
  await mount();
  const chips = () => renderer!.root.findAll((n) => String(n.type) === "FilterChips")[0];
  expect(chips().props.options.map((o: any) => o.label)).toEqual(["Day", "Calendar", "Stats"]);
  await act(async () => chips().props.onChange("month"));
  expect(screen().props.footer).toBeFalsy();
  const month = renderer!.root.findAll((n) => String(n.type) === "TrackerMonth")[0];
  expect(month.props).toMatchObject({ today: "2026-11-04", childId: "baby", birthDate: "2026-10-25" });
  await act(async () => month.props.onOpen("2026-10-26"));
  expect(chips().props.value).toBe("day");
  expect(copy().join(" ")).toContain("Oct 26");
  expect(lastQuick().pastDay).toEqual({ key: "2026-10-26", timezone: "Pacific/Guam" });
});

it("takes the day's line from the API, so a sleep still going adds nothing and one over midnight counts", async () => {
  mock.care = [row("open", "sleep", "2026-11-03T20:00:00.000Z")];
  mock.summary = { "2026-11-04": { date: "2026-11-04", feeding: { count: 4 }, diapers: { count: 3, pee: 2, poo: 1, dry: 0 }, sleep: { total_minutes: 300 }, dots: ["feeding"] }, "2026-11-02": { date: "2026-11-02", feeding: { count: 0 }, diapers: { count: 0, pee: 0, poo: 0, dry: 0 }, sleep: { total_minutes: 60 }, dots: ["sleep"] } };
  await mount();
  expect(copy()).toContain("4 feeds · 2 pee · 1 poo · 5h sleep");
  expect(targets().find((n) => String(n.props.accessibilityLabel).includes("November 2"))!.props.accessibilityLabel).toContain("has entries");
});

it("lists a sleep that ran over midnight on the second day too, to change it from there", async () => {
  mock.care = [row("night", "sleep", "2026-11-03T12:00:00.000Z", { end_at: "2026-11-03T16:00:00.000Z" }), row("before", "sleep", "2026-11-03T02:00:00.000Z", { end_at: "2026-11-03T03:00:00.000Z" })];
  mock.summary = {};
  await mount();
  const rows = targets().filter((n) => n.props.accessibilityHint === "Opens this entry to change it");
  expect(rows).toHaveLength(1);
  expect(rows[0].props.accessibilityLabel).toContain("Began the day before");
  await press("Day before");
  expect(targets().filter((n) => n.props.accessibilityHint === "Opens this entry to change it")).toHaveLength(2);
});

it("shows a timer from an older build on Tracker, today only", async () => {
  await mount();
  const timers = () => renderer!.root.findAll((n) => String(n.type) === "LegacyTimer");
  expect(timers()).toHaveLength(1);
  await press("Day before");
  expect(timers()).toHaveLength(0);
});

it("only says Feeding now for the newest feed, offline too", () => {
  const started = "2026-11-04T02:30:00.000Z", older = row("old", "feeding", started, { method: "breast", state: "running", actions: [{ id: "s", action: "start", at: started, side: "left" }] }),
    newer = row("new", "feeding", "2026-11-04T02:50:00.000Z", { method: "breast", state: "running", actions: [{ id: "t", action: "start", at: "2026-11-04T02:50:00.000Z", side: "right" }] });
  expect(timelineDetail(older, { rows: [older, newer], now })).toBe("No end time");
  expect(timelineDetail(newer, { rows: [older, newer], now })).toBe("Feeding now");
});

it("writes a row's clock on the family's clock", () => {
  expect(timelineDetail(row("x", "sleep", "2026-11-04T01:00:00.000Z", { end_at: "2026-11-04T02:00:00.000Z" }), { now, timeZone: "Asia/Tokyo" })).toMatch(/^10:00.AM to 11:00.AM$/);
});

it("lists a contraction on its day, saying how long it lasted", () => {
  const started = "2026-11-04T02:45:00.000Z";
  expect(timelineDetail(optimisticRecord({ id: "c", kind: "contraction", title: "Contraction", body: "", child_id: "baby", occurred_at: started, data: { end_at: "2026-11-04T02:45:45.000Z" } }), { now })).toBe("45 sec");
});
