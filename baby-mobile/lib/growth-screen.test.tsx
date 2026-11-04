import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyState, type BabyRecord, type DeviceState } from "./models";

const m = vi.hoisted(() => ({ flow: { panel: null as string | null, toggle(id: string) { m.flow.panel = id; } }, account: null as any, rows: [] as unknown[], push: vi.fn(), now: new Date("2027-02-10T02:00:00.000Z") }));
vi.mock("react-native", () => ({ View: "View", useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "Circle", Line: "Line", Path: "Path", Text: "SvgText" }));
vi.mock("expo-router", () => ({ router: { push: m.push } }));
vi.mock("@/lib/context", () => ({ useBaby: () => m.account }));
vi.mock("@/lib/today-care", () => ({ useTodayCare: (options: unknown) => ({ all: m.rows, rows: [], error: "", options }) }));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/models", () => import("./models"));
vi.mock("@/lib/growth-chart", () => import("./growth-chart"));
vi.mock("@/lib/timing", () => import("./timing"));
vi.mock("@/lib/trackers", () => import("./trackers"));
const ui = vi.hoisted(() => ({ Button: "Button", Chips: "Chips", Copy: "Copy", Empty: "Empty", FilterChips: "FilterChips", Grouped: "Grouped", Notice: "Notice", Row: "Row", Screen: "Screen", Section: "Section", fonts: {}, useColors: () => ({ muted: "m", accent: "a", outline: "o", surface: "s" }) }));
vi.mock("@/components/ui", () => ui);
vi.mock("../components/ui", () => ui);
vi.mock("@/components/child-filter", () => ({ ChildFilter: "ChildFilter" }));
vi.mock("@/components/care-glance", () => ({ useMinuteClock: () => m.now }));
vi.mock("@/components/medical-source", () => ({ MedicalSource: "MedicalSource" }));
vi.mock("@/components/quick-log", () => ({ useLogFlow: () => m.flow }));
vi.mock("@/components/tracker-panel", () => ({ SavedLog: "SavedLog", TrackerPanel: "TrackerPanel" }));
import Growth from "../app/growth";

const row = (data: Record<string, unknown>, at: string) => ({ id: at, kind: "growth", title: "Growth", body: "", child_id: "kid", occurred_at: at, data, revision: 1, created_at: at, updated_at: at }) as BabyRecord;
let renderer: ReactTestRenderer | undefined;
function setup(sex?: string | null) {
  const state: DeviceState = { ...emptyState(), selectedChild: "kid",
    bootstrap: { generation: 1, active: true, ai_available: false, children: [{ id: "kid", name: "Isla", birth_date: "2026-12-10", revision: 1, ...(sex === undefined ? {} : { details: { sex } }) }], profile: { display_name: "K", timezone: "Pacific/Guam", ai_consent: false } } };
  m.account = { state, commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { m.account.state = change(m.account.state); }) };
}
const mount = async () => { await act(async () => { renderer = create(<Growth />); }); };
const rows = () => renderer!.root.findAll((n) => String(n.type) === "Row").map((n) => n.props);
const words = () => JSON.stringify(renderer!.toJSON());

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); m.rows = []; m.push.mockReset(); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("draws no chart and gives no percentile until a chart is chosen, and still lists what was measured", async () => {
  setup();
  m.rows = [row({ weight: 7.5, weight_unit: "lb" }, "2026-12-10T02:00:00.000Z")];
  await mount();
  expect(renderer!.root.findAll((n) => String(n.type) === "Svg")).toEqual([]);
  expect(rows()[0].title).toBe("7 lb 8 oz");
  expect(rows()[0].detail).not.toContain("percentile");
});

it("shows the hand-checked percentile for a baby's measurement, and says it to VoiceOver", async () => {
  setup("girl");
  // Born today in this row's own terms: a girl of 7 lb 8 oz at birth is the 64th.
  m.rows = [row({ weight: 7.5, weight_unit: "lb" }, "2026-12-10T02:00:00.000Z")];
  await mount();
  expect(rows()[0]).toMatchObject({ title: "7 lb 8 oz" });
  expect(rows()[0].detail).toContain("64th percentile");
  expect(renderer!.root.findByProps({ accessibilityRole: "image" }).props.accessibilityLabel).toBe("Weight chart. 1 measurement. The latest is 7 lb 8 oz, 64th percentile.");
});

it("reads nothing into a measurement, even far off the chart: no alarm, no judgement, no colour of its own", async () => {
  setup("boy");
  m.rows = [row({ weight: 1, weight_unit: "kg", length: 20, length_unit: "cm" }, "2027-01-10T02:00:00.000Z")];
  await mount();
  expect(rows()[0].detail).toContain("Below the 2nd percentile line");
  const text = words().replace(/“[^”]*”/g, "");
  expect(text).not.toMatch(/normal|healthy|underweight|overweight|too (small|big|low|high)|worr|concern|risk|alarm|warning|should|see a doctor|call/i);
  await act(async () => renderer!.root.findByProps({ accessibilityRole: "image" }).props.onLayout({ nativeEvent: { layout: { width: 340 } } }));
  const colors = new Set(renderer!.root.findAll((n) => String(n.type) === "Circle").map((n) => n.props.fill));
  expect([...colors]).toEqual(["a"]);
});

it("keeps our own lines out, and CDC's attribution and non-endorsement in", async () => {
  setup("girl");
  await mount();
  const text = words();
  expect(text).toContain("Source: CDC");
  expect(text).toContain("does not imply endorsement");
  expect(text).toContain("Percentile curves show the distribution of selected body measurements in children.");
  expect(text).not.toContain("born early");
  expect(text).not.toContain("says less than");
});

it("marks what falls past 24 months without a percentile, and uses CDC's own words for why", async () => {
  setup("girl");
  m.rows = [row({ weight: 13, weight_unit: "kg" }, "2029-01-20T02:00:00.000Z")];
  m.now = new Date("2029-02-01T02:00:00.000Z");
  await mount();
  expect(rows()[0].detail).toContain("Outside this chart");
  expect(words()).toContain("At age 2 years, CDC recommends transitioning to the CDC Growth Charts.");
  m.now = new Date("2027-02-10T02:00:00.000Z");
});

it("asks which chart when the profile has no answer, shows it for this visit, and stores nothing about the baby", async () => {
  setup("not_sure");
  await mount();
  expect(renderer!.root.findAll((n) => n.props.accessibilityRole === "image")).toEqual([]);
  expect(words()).toContain("CDC’s charts are separate for boys and girls.");
  const before = JSON.stringify(m.account.state);
  await act(async () => renderer!.root.findByProps({ label: "Which chart", value: "" }).props.onChange("girls"));
  expect(renderer!.root.findAll((n) => n.props.accessibilityRole === "image")).toHaveLength(1);
  expect(JSON.stringify(m.account.state)).toBe(before);
  expect(m.account.commit).not.toHaveBeenCalled();
});

it("doesn't carry a chart she picked for one baby over to another", async () => {
  setup("not_sure");
  const bootstrap = m.account.state.bootstrap;
  m.account.state = { ...m.account.state, bootstrap: { ...bootstrap, children: [...bootstrap.children, { id: "sister", name: "Mia", birth_date: "2026-12-10", revision: 1 }] } };
  await mount();
  await act(async () => renderer!.root.findByProps({ label: "Which chart", value: "" }).props.onChange("boys"));
  expect(renderer!.root.findAll((n) => n.props.accessibilityRole === "image")).toHaveLength(1);
  m.account.state = { ...m.account.state, selectedChild: "sister" };
  await act(async () => renderer!.update(<Growth />));
  expect(renderer!.root.findAll((n) => n.props.accessibilityRole === "image")).toEqual([]);
  expect(renderer!.root.findByProps({ label: "Which chart" }).props.value).toBe("");
});
it("goes straight to the chart when the profile has an answer, and can still show the other one", async () => {
  setup("boy");
  m.rows = [row({ weight: 7.5, weight_unit: "lb" }, "2026-12-10T02:00:00.000Z")];
  await mount();
  const boys = rows()[0].detail;
  await act(async () => renderer!.root.findByProps({ label: "Which chart", value: "boys" }).props.onChange("girls"));
  expect(rows()[0].detail).toContain("64th percentile");
  expect(rows()[0].detail).not.toBe(boys);
});

it("opens the same growth panel Tracker uses", async () => {
  setup("girl");
  await mount();
  expect(renderer!.root.findAll((n) => String(n.type) === "TrackerPanel")).toEqual([]);
  m.flow.toggle("growth");
  await act(async () => renderer!.update(<Growth />));
  expect(renderer!.root.findAll((n) => String(n.type) === "TrackerPanel")[0].props.tracker.id).toBe("growth");
  m.flow.panel = null;
});
