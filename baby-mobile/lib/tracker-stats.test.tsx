import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState } from "./models";
import { answer, day } from "./care-stats-fixtures";
import type { CareStats, StatsChoice } from "./care-stats";

const mock = vi.hoisted(() => ({ baby: null as any, fontScale: 1 }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", useWindowDimensions: () => ({ fontScale: mock.fontScale }), useColorScheme: () => "dark" }));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/lib/care-stats", () => import("./care-stats"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/contractions", () => import("./contractions"));
vi.mock("@/lib/tracker", () => import("./tracker"));
const ui = vi.hoisted(() => ({ Card: "Card", Copy: "Copy", Empty: "Empty", FilterChips: "FilterChips", Notice: "Notice", Section: "Section", fonts: {}, useColors: () => ({ progressFill: "#E0A894" }) }));
vi.mock("../components/ui", () => ui);
vi.mock("../components/date-field", () => ({ DateField: "DateField" }));
import { TrackerStats } from "../components/tracker-stats";
import { StatBars } from "../components/stat-bars";

const onOpen = vi.fn(), onChoose = vi.fn(), now = new Date("2026-11-04T10:00:00Z"), today = "2026-11-04";
let renderer: ReactTestRenderer | undefined;
async function mount(stats?: CareStats, { choice = { range: "7d" } as StatsChoice, expecting = false, error = undefined as string | undefined } = {}) {
  await act(async () => { renderer = create(<TrackerStats answer={{ stats, error, loading: !stats && !error }} choice={choice} onChoose={onChoose} today={today} childId="baby" expecting={expecting} now={now} onOpen={onOpen} />); });
}
const flat = () => JSON.stringify(renderer!.toJSON());
const bars = () => renderer!.root.findAll((n) => String(n.type) === "Pressable");
const feeds = (count: number) => ({ feeding: { ...day("x").feeding, count } });
const week = () => [...["10-29", "10-30", "10-31", "11-01", "11-02", "11-03"].map((d) => day(`2026-${d}`)), day(today, true)];

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => undefined);
  onOpen.mockClear(); onChoose.mockClear(); mock.fontScale = 1;
  mock.baby = { state: { ...emptyState(), bootstrap: { generation: 1, active: true, ai_available: false, children: [], profile: { display_name: "", timezone: "Pacific/Guam", ai_consent: false } } } };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("with little or nothing logged", () => {
  it("says nothing's there, with no charts, when nothing was logged", async () => {
    await mount(answer(week()));
    expect(renderer!.root.findAll((n) => String(n.type) === "Empty")).toHaveLength(1);
    expect(renderer!.root.findAll((n) => String(n.type) === "Svg")).toHaveLength(0);
  });
  it("one feed today gives the count, no average, and a dash on the days with nothing", async () => {
    const days = week(); days[6] = day(today, true, feeds(1));
    const stats = answer(days); stats.feeding.average_per_day = null; stats.feeding.days_logged = 0; stats.feeding.days_total = 6;
    await mount(stats);
    expect(flat()).toContain("based on 0 logged days of 6");
    const labels = bars().map((bar) => bar.props.accessibilityLabel);
    expect(labels[0]).toContain("Nothing logged");
    expect(labels[6]).toContain("1 feed.");
    expect(flat()).toContain("–");
  });
  it("shows what could be read when the numbers can't be fetched, and the reason", async () => {
    await mount(undefined, { error: "You're offline." });
    expect(flat()).toContain("You're offline.");
    await act(async () => renderer!.unmount());
    await mount(answer(week()), { error: "You're offline." });
    expect(flat()).toContain("Showing the last numbers");
  });
});

describe("the rules for honest numbers", () => {
  const filled = () => { const days = week(); days[5] = day("2026-11-03", false, { ...feeds(9), diapers: { count: 6, pee: 5, poo: 2, dry: 0 } }); const stats = answer(days);
    stats.feeding.average_per_day = 9; stats.feeding.days_logged = 6; stats.feeding.days_total = 7; return stats; };
  it("says how many logged days an average rests on", async () => {
    await mount(filled());
    expect(flat()).toContain("based on 6 logged days of 7");
    expect(flat()).toContain("The paler bar is today so far");
  });
  it("the 24-hour range shows no daily averages", async () => {
    const stats = answer([day("2026-11-03", true, feeds(2)), day(today, true, feeds(3))], "24h");
    await mount(stats, { choice: { range: "24h" } });
    expect(flat()).not.toContain("based on");
    expect(flat()).not.toContain("paler");
    expect(flat()).toContain("The last 24 hours");
  });
  it("never passes judgment on anything it shows", async () => {
    await mount(filled());
    expect(flat().toLowerCase()).not.toMatch(/normal|abnormal|too (few|many|low|high)|healthy|concern/);
  });
  it("explains why a diaper with both makes a bar taller than its count", async () => {
    await mount(filled());
    expect(flat()).toContain("A diaper with both");
  });
  it("tells her when queued logs aren't in the averages yet", async () => {
    mock.baby.state.outbox = [{ id: "m", generation: 1, type: "save", files: [], record: { id: "f", kind: "feeding", title: "", body: "", child_id: "baby", occurred_at: "2026-11-03T02:00:00Z", data: {} } }];
    await mount(filled());
    expect(flat()).toContain("Averages catch up");
    expect(bars().find((bar) => String(bar.props.accessibilityLabel).includes("November 3"))!.props.accessibilityLabel).toContain("10 feeds");
  });
});

describe("what the charts do", () => {
  it("opens the day of the bar tapped", async () => {
    const days = week(); days[2] = day("2026-10-31", false, feeds(4));
    await mount(answer(days));
    await act(async () => bars().find((bar) => String(bar.props.accessibilityLabel).includes("October 31"))!.props.onPress());
    expect(onOpen).toHaveBeenCalledWith("2026-10-31");
  });
  it("speaks each diaper day in words", async () => {
    const days = week(); days[5] = day("2026-11-03", false, { diapers: { count: 4, pee: 3, poo: 2, dry: 0 } });
    await mount(answer(days));
    expect(bars().some((bar) => String(bar.props.accessibilityLabel).includes("4 diapers: 3 pee, 2 poo, 0 dry"))).toBe(true);
  });
  it("gives contractions and kicks their own sections before the birth, and leaves empty care out", async () => {
    const days = week(); days[5] = day("2026-11-03", false, { contractions: { count: 2, timed: 2, average_seconds: 45 }, kicks: { sessions: 1, movements: 7 } });
    const stats = answer(days); stats.contractions = { count: 2, timed: 2, average_seconds: 45 }; stats.kicks = { sessions: 1, movements: 7 };
    await mount(stats, { expecting: true });
    const titles = renderer!.root.findAll((n) => String(n.type) === "Section").map((n) => n.props.title);
    expect(titles).toEqual(["Contractions", "Kicks"]);
    expect(flat()).toContain("45 sec");
  });
  const slotWidth = async (fontScale: number) => {
    mock.fontScale = fontScale;
    const data = [{ key: "2026-11-03", labels: ["Tue", "Nov 3"] as [string, string], values: [3], cap: "3", spoken: "x", partial: false }];
    await act(async () => { renderer = create(<StatBars bars={data} colors={["#000"]} onOpen={onOpen} />); });
    const width = bars()[0].props.style({ pressed: false }).width;
    await act(async () => renderer!.unmount());
    return width;
  };
  it("keeps every bar a 44pt target, and widens its slot so large text never collides", async () => {
    expect(await slotWidth(1)).toBe(44);
    expect(await slotWidth(1.8)).toBe(79);
    // Chart labels stop growing at twice their size, and so does the slot.
    expect(await slotWidth(3)).toBe(88);
  });
});
