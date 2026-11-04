import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type Mutation } from "./models";

const mock = vi.hoisted(() => ({ baby: null as any, fontScale: 1, focus: [] as (() => void)[] }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", useWindowDimensions: () => ({ fontScale: mock.fontScale }), AppState: { currentState: "active" } }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return { useFocusEffect: (fn: () => void) => { mock.focus.push(fn); return useEffect(fn, [fn]); } };
});
vi.mock("@/lib/care-days", () => import("./care-days"));
vi.mock("@/lib/use-care-summary", () => import("./use-care-summary"));
vi.mock("./context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/lib/care-summary", () => import("./care-summary"));
vi.mock("@/lib/tracker", () => import("./tracker"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("../components/ui", () => ({ Copy: "Copy", Icon: "Icon", Notice: "Notice", PressTarget: "Pressable", fonts: {}, useColors: () => ({}) }));
import { TrackerMonth, monthGrid, stepMonth } from "../components/tracker-month";
import { careDays, firstCareDay } from "./care-days";
import { recordDay } from "./tracker";

const today = "2026-11-04";
const entry = (id: string, occurred_at: string, kind: "feeding" | "journal" = "feeding"): BabyRecord =>
  optimisticRecord({ id, kind, title: id, body: "", child_id: kind === "journal" ? null : "baby", occurred_at, data: { method: "breast" } });
let renderer: ReactTestRenderer | undefined;
const careDay = (date: string, feeds = 1) => ({ date, feeding: { count: feeds }, diapers: { count: 0, pee: 0, poo: 0, dry: 0 }, sleep: { total_minutes: 0 }, dots: feeds ? ["feeding"] : [] });
function setup(rows: BabyRecord[] = [], outbox: Mutation[] = []) {
  const records = vi.fn(async (filters: any) => {
    const list = rows.filter((row) => (!filters.occurred_from || row.occurred_at >= filters.occurred_from) && (!filters.occurred_to || row.occurred_at < filters.occurred_to)
      && filters.kinds.includes(row.kind)).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    const offset = filters.offset ?? 0;
    return { items: list.slice(offset, offset + filters.limit), total: list.length, has_more: offset + filters.limit < list.length };
  });
  const careSummary = vi.fn(async () => ({ days: rows.filter((row) => row.kind === "feeding").map((row) => careDay(recordDay(row.occurred_at, "Pacific/Guam"))) }));
  mock.baby = { api: { records, careSummary }, state: { ...emptyState(), outbox, bootstrap: { generation: 1, active: true, ai_available: false, children: [], profile: { display_name: "", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState };
  return records;
}
const targets = () => renderer!.root.findAll((n) => String(n.type) === "Pressable");
const target = (label: string) => targets().find((n) => String(n.props.accessibilityLabel).startsWith(label));
const heading = () => renderer!.root.findAll((n) => String(n.type) === "Copy")[0].props.children;
const onOpen = vi.fn();
async function mount(props: Partial<React.ComponentProps<typeof TrackerMonth>> = {}) {
  await act(async () => { renderer = create(<TrackerMonth today={today} day={today} childId="baby" onOpen={onOpen} {...props} />); });
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => undefined); onOpen.mockClear(); mock.fontScale = 1; });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("lays a month out in whole weeks, with the days around it, and steps across years", () => {
  const { weeks } = monthGrid("2026-11");
  expect(weeks[0]).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
  expect(weeks.at(-1)!.at(-1)).toBe("2026-12-05");
  expect(monthGrid("2026-02").weeks.flat().filter((key) => key.startsWith("2026-02"))).toHaveLength(28);
  expect(stepMonth("2026-12", 1)).toBe("2027-01");
  expect(stepMonth("2026-01", -1)).toBe("2025-12");
});

it("marks days that have something, from the API and from this phone, and opens a day on tap", async () => {
  const unsynced: Mutation = { id: "m", generation: 1, type: "save", files: [], record: { id: "u", kind: "diaper", title: "", body: "", child_id: "baby", occurred_at: "2026-10-31T20:00:00Z", data: { type: "wet" } } };
  const records = setup([entry("a", "2026-11-02T02:00:00.000Z"), entry("note", "2026-11-03T02:00:00.000Z", "journal")], [unsynced]);
  await mount();
  expect(heading()).toContain("November");
  const dotted = targets().filter((n) => String(n.props.accessibilityLabel).includes("has entries")).map((n) => n.props.accessibilityLabel);
  expect(dotted).toHaveLength(3);
  expect(dotted.join()).toMatch(/November 1.*November 2.*November 3/);
  expect(target("Wednesday, November 4")?.props.accessibilityLabel).toContain("today");
  await act(async () => target("Monday, November 2")!.props.onPress());
  expect(onOpen).toHaveBeenCalledWith("2026-11-02");
  expect(mock.baby.api.careSummary).toHaveBeenCalledWith("2026-11-01", "2026-12-05", "baby");
  expect(records).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["journal", "question", "contraction", "kick_session", "milestone"], occurred_from: "2026-10-31T14:00:00.000Z", child_id: "baby" }));
});

it("reaches the first day home in three taps or fewer: Tracker, Calendar, First log, however long ago", async () => {
  setup([entry("newest", "2026-11-03T02:00:00.000Z"), entry("oldest", "2026-08-26T02:00:00.000Z"), entry("middle", "2026-09-26T02:00:00.000Z")]);
  await mount();
  const jump = target("First log")!;
  expect(jump.props.accessibilityLabel).toContain("August 26, 2026");
  await act(async () => jump.props.onPress());
  expect(onOpen).toHaveBeenCalledWith("2026-08-26");
});

it("offers the birth date too, when it differs from the first log", async () => {
  setup([entry("a", "2026-08-26T02:00:00.000Z")]);
  await mount({ birthDate: "2026-08-24" });
  expect(target("Born")!.props.accessibilityLabel).toContain("August 24, 2026");
  await act(async () => renderer!.unmount());
  setup([entry("a", "2026-08-26T02:00:00.000Z")]);
  await mount({ birthDate: "2026-08-26" });
  expect(target("Born")).toBeUndefined();
});

it("moves between months, fetching each once it's on screen, and ignores a late answer", async () => {
  const records = setup([entry("oct", "2026-10-10T02:00:00.000Z")]);
  await mount();
  await act(async () => target("Previous month")!.props.onPress());
  expect(heading()).toContain("October");
  expect(target("Saturday, October 10")?.props.accessibilityLabel).toContain("has entries");
  await act(async () => target("Next month")!.props.onPress());
  expect(heading()).toContain("November");
  expect(records.mock.calls.filter(([f]: any[]) => f.occurred_from).length).toBeGreaterThanOrEqual(3);
});

it("still opens days and shows this phone's dots when the service can't be reached", async () => {
  setup();
  mock.baby.api.records = vi.fn(async () => { throw new TypeError("offline"); });
  mock.baby.state.records = [entry("cached", "2026-11-02T02:00:00.000Z")];
  await mount();
  expect(target("Monday, November 2")?.props.accessibilityLabel).toContain("has entries");
  expect(renderer!.root.findAll((n) => String(n.type) === "Notice")).toHaveLength(1);
  await act(async () => target("Monday, November 2")!.props.onPress());
  expect(onOpen).toHaveBeenCalledWith("2026-11-02");
});

it("gives every day a 44pt target at least, and names it for VoiceOver", async () => {
  setup();
  await mount();
  for (const node of targets()) if (String(node.props.accessibilityLabel).includes("day,")) expect(node.props.style.minHeight).toBeGreaterThanOrEqual(44);
});

it("reads every page of notes in a busy month, and stops when a screen has moved on", async () => {
  const rows = Array.from({ length: 250 }, (_, i) => entry(`r${i}`, new Date(Date.UTC(2026, 10, 1 + (i % 28), 2, i % 60)).toISOString(), "journal"));
  const records = setup(rows);
  const { others } = await careDays(mock.baby, "baby", "2026-11-01", "2026-12-05", "Pacific/Guam");
  expect(others.size).toBe(28);
  expect(others.get("2026-11-02")).toContain("r1");
  expect(records).toHaveBeenCalledTimes(3);
  records.mockClear();
  await careDays(mock.baby, "baby", "2026-11-01", "2026-12-05", "Pacific/Guam", () => false);
  expect(records).toHaveBeenCalledOnce();
});

it("takes a queued delete's dot away, so a day never promises what's gone", async () => {
  const saved = entry("a", "2026-11-02T02:00:00.000Z"), gone: Mutation = { id: "m", generation: 1, type: "delete", record: saved };
  setup([saved], [gone]);
  mock.baby.state.records = [saved];
  await mount();
  expect(targets().filter((n) => String(n.props.accessibilityLabel).includes("has entries"))).toEqual([]);
});

const dots = () => targets().filter((n) => String(n.props.accessibilityLabel).includes("has entries")).map((n) => String(n.props.accessibilityLabel));
it("takes a queued delete of the last note off its day, whatever the API last said", async () => {
  const note = entry("note", "2026-11-03T02:00:00.000Z", "journal"), gone: Mutation = { id: "m", generation: 1, type: "delete", record: note };
  setup([note]);
  await mount();
  expect(dots().join()).toContain("November 3");
  mock.baby.state = { ...mock.baby.state, outbox: [gone] };
  await act(async () => renderer!.update(<TrackerMonth today={today} day={today} childId="baby" onOpen={onOpen} />));
  expect(dots()).toEqual([]);
  // It stays off once the delete has landed and left the queue, before the next answer comes back.
  mock.baby.api.records = vi.fn(() => new Promise(() => undefined));
  mock.baby.state = { ...mock.baby.state, outbox: [] };
  await act(async () => renderer!.update(<TrackerMonth today={today} day={today} childId="baby" onOpen={onOpen} />));
  expect(dots()).toEqual([]);
});

it("reads the month again on coming back, and whenever a queued change leaves", async () => {
  const note = entry("note", "2026-11-03T02:00:00.000Z", "journal");
  const records = setup([]);
  await mount();
  expect(dots()).toEqual([]);
  // The other phone wrote while this tab was away. Coming back runs the focus effect again.
  records.mockImplementation(async () => ({ items: [note], total: 1, has_more: false }));
  await act(async () => { mock.focus.at(-1)!(); });
  expect(dots().join()).toContain("November 3");
  const before = mock.baby.api.careSummary.mock.calls.length;
  mock.baby.state = { ...mock.baby.state, outbox: [{ id: "m", generation: 1, type: "save", files: [], record: entry("x", "2026-11-05T02:00:00.000Z") }] };
  await act(async () => renderer!.update(<TrackerMonth today={today} day={today} childId="baby" onOpen={onOpen} />));
  expect(mock.baby.api.careSummary.mock.calls.length).toBeGreaterThan(before);
});

it("doesn't show one baby's first log on another's calendar while it's looking", async () => {
  setup([entry("a", "2026-08-26T02:00:00.000Z")]);
  await mount();
  expect(target("First log")).toBeDefined();
  mock.baby.api.records = vi.fn(() => new Promise(() => undefined));
  await act(async () => renderer!.update(<TrackerMonth today={today} day={today} childId="sister" onOpen={onOpen} />));
  expect(target("First log")).toBeUndefined();
});

it("finds no first day when nothing is logged", async () => {
  setup();
  expect(await firstCareDay(mock.baby, "baby", "Pacific/Guam")).toBeUndefined();
});
