import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState } from "./models";

const mock = vi.hoisted(() => ({ baby: null as any, care: [] as any[], requests: [] as any[], params: {} as Record<string, string>, push: vi.fn(), fontScale: 1, quick: [] as any[], error: "" }));
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
vi.mock("@/lib/today-care", () => ({ useTodayCare: (options: any = {}) => {
  mock.requests.push(options);
  return { all: mock.care, rows: mock.care, loading: false, error: options.occurred_from ? mock.error : "", refresh: vi.fn() };
} }));
const ui = vi.hoisted(() => ({
  PressTarget: "Pressable", Icon: "Icon", Copy: "Copy", Grouped: "Grouped", Notice: "Notice", Row: "Row", Screen: "Screen", Empty: "Empty",
  HeaderAction: "HeaderAction", fonts: {}, radii: {}, typeScale: { caption: {} }, useColors: () => ({}),
}));
vi.mock("@/components/ui", () => ui);
vi.mock("../components/ui", () => ui);
vi.mock("../components/record-row", () => ({ kindIcon: {} }));
vi.mock("@/components/child-filter", () => ({ ChildFilter: "ChildFilter" }));
vi.mock("@/components/sync-status", () => ({ SyncStatus: "SyncStatus" }));
vi.mock("@/components/care-glance", () => ({ useMinuteClock: () => new Date() }));
vi.mock("@/components/quick-log", () => ({ QuickLog: (props: any) => { mock.quick.push(props); return "quick-log"; } }));
vi.mock("@/components/tracker-day", () => import("../components/tracker-day"));
import Tracker from "../app/(tabs)/tracker/index";
import { timelineDetail } from "../components/tracker-day";

const now = new Date("2026-11-04T03:00:00.000Z"); // Wednesday Nov 4, 1 PM in Guam
let renderer: ReactTestRenderer | undefined;
const row = (id: string, kind: "feeding" | "diaper" | "sleep" | "journal", occurred_at: string, data: BabyRecord["data"] = {}, body = "") =>
  optimisticRecord({ id, kind, title: kind === "journal" ? "First night" : "", body, child_id: kind === "journal" ? null : "baby", occurred_at, data });
const screen = () => renderer!.root.findAll((n) => String(n.type) === "Screen")[0];
const targets = () => renderer!.root.findAll((n) => String(n.type) === "Pressable");
const target = (label: string) => targets().find((n) => n.props.accessibilityLabel === label || n.props.accessibilityLabel?.startsWith(label));
const copy = () => renderer!.root.findAll((n) => String(n.type) === "Copy").map((n) => n.props.children);
const titles = () => renderer!.root.findAll((n) => String(n.type) === "Text").map((n) => [n.props.children].flat().join(""));
async function mount() { await act(async () => { renderer = create(<Tracker />); }); }
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
  mock.care = []; mock.requests = []; mock.params = {}; mock.push.mockClear(); mock.fontScale = 1; mock.quick = []; mock.error = "";
  mock.baby = { state: { ...emptyState(), bootstrap: { generation: 1, active: true, ai_available: false,
    children: [{ id: "baby", name: "Mia", revision: 1, birth_date: "2026-10-25" }],
    profile: { display_name: "K", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
  expect(day).toMatchObject({ occurred_from: "2026-11-02T14:00:00.000Z", occurred_to: "2026-11-04T14:00:00.000Z", poll: true, kinds: ["feeding", "sleep", "diaper", "journal", "question"] });
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
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "HeaderAction")[0].props.onPress());
  expect(copy()).toContain("Today");
});

it("logs into the day on screen: past days ask for the time, future days have no quick log", async () => {
  await mount();
  expect(lastQuick().pastDay).toBeUndefined();
  await press("Day before");
  expect(lastQuick().pastDay).toEqual({ key: "2026-11-03", timezone: "Pacific/Guam" });
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "HeaderAction")[0].props.onPress());
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

it("has no quick log before the birth, and says when care will appear", async () => {
  mock.baby.state.bootstrap.children = [{ id: "baby", name: "Mia", revision: 1, due_date: "2026-12-10" }];
  await mount();
  expect(screen().props.footer).toBeFalsy();
  expect(renderer!.root.findAll((n) => String(n.type) === "Empty")[0].props.body).toContain("once the baby’s here");
});

it("moves the quick log into the page at the largest text sizes", async () => {
  mock.fontScale = 2;
  await mount();
  expect(screen().props.footer).toBeFalsy();
  expect(mock.quick.length).toBeGreaterThan(0);
});

it("describes a timeline row with what the title doesn't say", () => {
  const started = "2026-11-04T02:45:00.000Z", actions = [{ id: "s", action: "start" as const, at: started, side: "left" as const }];
  expect(timelineDetail(row("x", "feeding", started, { method: "breast", actions }), now)).toBe("Feeding now");
  expect(timelineDetail(row("x", "feeding", "2026-11-03T02:45:00.000Z", { method: "breast", actions: [{ ...actions[0], at: "2026-11-03T02:45:00.000Z" }] }), now)).toBe("No end time");
  expect(timelineDetail(row("x", "diaper", started, { type: "dirty" }, "First black one\nsecond line"), now)).toBe("First black one");
  expect(timelineDetail(row("x", "sleep", started, { end_at: "2026-11-04T03:45:00.000Z" }), now)).toMatch(/to/);
});
