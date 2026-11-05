import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState } from "./models";
import { answer, day } from "./care-stats-fixtures";
import type { CareStats, StatsChoice } from "./care-stats";

const mock = vi.hoisted(() => ({ baby: null as any, fontScale: 1, push: vi.fn() }));
vi.mock("expo-router", () => ({ router: { push: mock.push } }));
vi.mock("@/lib/doctor-summary", () => ({ summaryMaxDays: 31 }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", useWindowDimensions: () => ({ fontScale: mock.fontScale }), useColorScheme: () => "dark" }));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
vi.mock("@/lib/context", () => ({ useBaby: () => mock.baby }));
vi.mock("@/lib/care-stats", () => import("./care-stats"));
vi.mock("@/lib/care-format", () => import("./care-format"));
vi.mock("@/lib/contractions", () => import("./contractions"));
vi.mock("@/lib/tracker", () => import("./tracker"));
const ui = vi.hoisted(() => ({ QuietRow: "QuietRow", Button: "Button", Card: "Card", Copy: "Copy", Empty: "Empty", FilterChips: "FilterChips", Notice: "Notice", Section: "Section", fonts: {}, useColors: () => ({ progressFill: "#E0A894" }) }));
vi.mock("../components/ui", () => ui);
vi.mock("../components/date-field", () => ({ DateField: "DateField" }));
import { TrackerStats } from "../components/tracker-stats";
import { StatBars } from "../components/stat-bars";

const onOpen = vi.fn(), onChoose = vi.fn(), now = new Date("2026-11-04T10:00:00Z"), today = "2026-11-04";
let renderer: ReactTestRenderer | undefined;
const refresh = vi.fn(), fetchedAt = new Date("2026-11-04T04:14:00Z"); // 2:14 PM in Guam.
async function mount(stats?: CareStats, { choice = { range: "7d" } as StatsChoice, expecting = false, error = undefined as string | undefined, on = undefined as string[] | undefined } = {}) {
  on ??= expecting ? ["kicks", "contractions", "feeling", "my_weight", "blood_pressure", "vitamins"] : ["breast", "bottle", "diaper", "sleep"];
  await act(async () => { renderer = create(<TrackerStats on={on} answer={{ stats, fetchedAt, error, loading: !stats && !error, refresh }} choice={choice} onChoose={onChoose} today={today} childId="baby" now={now} onOpen={onOpen} />); });
}
const flat = () => JSON.stringify(renderer!.toJSON());
const bars = () => renderer!.root.findAll((n) => String(n.type) === "Pressable");
const feeds = (count: number) => ({ feeding: { ...day("x").feeding, count } });
const week = () => [...["10-29", "10-30", "10-31", "11-01", "11-02", "11-03"].map((d) => day(`2026-${d}`)), day(today, true)];

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => undefined);
  onOpen.mockClear(); onChoose.mockClear(); refresh.mockClear(); mock.fontScale = 1;
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
    expect(flat()).toContain("starts after a full day is logged");
    const labels = bars().map((bar) => bar.props.accessibilityLabel);
    expect(labels[0]).toContain("Nothing logged");
    expect(labels[6]).toContain("1 feed.");
    expect(flat()).toContain("–");
  });
  it("offline with no numbers yet, says so plainly instead of drawing any, and can try again", async () => {
    await mount(undefined, { error: "You're offline." });
    const empty = renderer!.root.findAll((n) => String(n.type) === "Empty");
    expect(empty).toHaveLength(1);
    expect(empty[0].props.body).toContain("You're offline.");
    expect(renderer!.root.findAll((n) => String(n.type) === "Svg")).toHaveLength(0);
    await act(async () => empty[0].props.action.props.onPress());
    expect(refresh).toHaveBeenCalled();
  });
  it("keeps an earlier read's numbers when a new one fails, and says when they're from", async () => {
    const days = week(); days[5] = day("2026-11-03", false, feeds(9));
    await mount(answer(days), { error: "You're offline." });
    expect(flat()).toMatch(/Showing numbers from 2:14\sPM\./);
    expect(flat()).toContain("9 feeds");
    expect(flat()).not.toContain("You're offline.");
  });
});

describe("the doctor summary, one tap away", () => {
  const pill = () => renderer!.root.findAll((n) => String(n.type) === "QuietRow").find((n) => n.props.title === "Doctor summary")!;
  it("opens on the same days and baby", async () => {
    mock.push.mockClear();
    await mount(answer(week()));
    await act(async () => pill().props.onPress());
    expect(mock.push).toHaveBeenCalledWith({ pathname: "/doctor-summary", params: { child: "baby", from: "2026-10-29", to: today } });
  });
  it("leaves the dates to her when the range won't fit a page", async () => {
    mock.push.mockClear();
    await mount(answer(Array.from({ length: 40 }, (_, n) => day(`2026-09-${String(n % 30 + 1).padStart(2, "0")}`))));
    await act(async () => pill().props.onPress());
    expect(mock.push).toHaveBeenCalledWith({ pathname: "/doctor-summary", params: { child: "baby" } });
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
  const queued = (id: string, occurred_at: string, changes = {}) => ({ id: `m${id}`, generation: 1, type: "save", files: [], record: { id, kind: "feeding", title: "", body: "", child_id: "baby", occurred_at, data: {}, ...changes } });
  const line = () => flat().match(/Showing numbers[^"]*/)?.[0];
  const barFor = (date: string) => bars().find((bar) => String(bar.props.accessibilityLabel).includes(date))!.props.accessibilityLabel;
  const range = (stats: CareStats) => { stats.range.start = "2026-10-28T14:00:00.000Z"; return stats; }; // Midnight on Oct 29 in Guam.
  it("shows only the API's numbers with a queued feed, and how many are waiting", async () => {
    mock.baby.state.outbox = [queued("f", "2026-11-03T02:00:00Z"), queued("g", "2026-11-03T03:00:00Z"), queued("h", "2026-11-02T03:00:00Z")];
    await mount(range(filled()));
    expect(barFor("November 3")).toContain("9 feeds");
    expect(line()).toMatch(/^Showing numbers from 2:14\sPM\. 3 entries are still waiting to sync\.$/);
  });
  it("a saved feed whose answer was lost, still queued, isn't counted twice", async () => {
    // The API has it among the nine; this phone hasn't heard.
    mock.baby.state.outbox = [queued("f", "2026-11-03T02:00:00Z")];
    mock.baby.state.records = [];
    await mount(range(filled()));
    expect(barFor("November 3")).toContain("9 feeds");
    expect(line()).toContain("1 entry is still waiting");
  });
  it("a queued correction leaves the API's number standing until it arrives", async () => {
    const held = { id: "d", kind: "diaper", title: "", body: "", child_id: "baby", occurred_at: "2026-11-03T02:00:00Z", data: { type: "wet" }, revision: 1, created_at: "", updated_at: "" };
    mock.baby.state.records = [held];
    mock.baby.state.outbox = [queued("d", held.occurred_at, { kind: "diaper", data: { type: "dirty" }, revision: 1 })];
    await mount(range(filled()));
    expect(bars().some((bar) => String(bar.props.accessibilityLabel).includes("November 3. 6 diapers: 5 pee, 2 poo, 0 dry"))).toBe(true);
    expect(line()).toContain("1 entry is still waiting");
  });
  it("says nothing about a queued entry outside the stated days", async () => {
    mock.baby.state.outbox = [queued("f", "2026-10-01T02:00:00Z")];
    await mount(range(filled()));
    expect(line()).toBeUndefined();
  });
  it("has no line when it's fresh and nothing is waiting", async () => {
    await mount(range(filled()));
    expect(line()).toBeUndefined();
  });
  it("won't say nothing was logged while her first logs are still on the phone", async () => {
    mock.baby.state.outbox = [queued("f", "2026-11-03T02:00:00Z")];
    await mount(range(answer(week())));
    const empty = renderer!.root.findAll((n) => String(n.type) === "Empty");
    expect(empty[0].props.title).not.toContain("Nothing logged");
    expect(line()).toContain("1 entry is still waiting");
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

it("leaves being offline to the one calm line above, and says only where the numbers come from", async () => {
  await mount(undefined, { error: "Something else went wrong." });
  expect(renderer!.root.findAll((n) => String(n.type) === "Empty")[0].props.body).toContain("Something else went wrong.");
  await act(async () => renderer!.unmount());
  mock.baby.unreachable = true;
  await mount(undefined, { error: "Could not connect. You're offline." });
  const empty = renderer!.root.findAll((n) => String(n.type) === "Empty")[0];
  expect(empty.props.body).toBe("Stats come from Håfa, so they’ll show here once it can be reached.");
  mock.baby.unreachable = false;
});

it("has one Doctor summary, reachable before any numbers have loaded", async () => {
  await mount(undefined, { error: "You're offline." });
  expect(renderer!.root.findAll((n) => String(n.type) === "QuietRow").filter((n) => n.props.title === "Doctor summary")).toHaveLength(1);
  await act(async () => renderer!.root.findAll((n) => String(n.type) === "QuietRow")[0].props.onPress());
  expect(mock.push).toHaveBeenCalledWith({ pathname: "/doctor-summary", params: { child: "baby" } });
});

describe("following the stage", () => {
  const sections = () => renderer!.root.findAll((n) => String(n.type) === "Section").map((n) => n.props.title);
  const empty = () => renderer!.root.findAll((n) => String(n.type) === "Empty")[0];
  const logged = (over: Partial<ReturnType<typeof day>> = {}) => { const days = week(); days[5] = day("2026-11-03", false, over); return days; };
  const kicked = () => { const stats = answer(logged({ kicks: { sessions: 2, movements: 21 } } as never)); stats.kicks = { sessions: 2, movements: 21 }; return stats; };
  const own = (stats: CareStats) => { stats.days = stats.days.map((one) => ({ ...one, own: { count: one.date === "2026-11-03" ? 3 : 0 } }));
    stats.own = { count: 3, logs: [{ label: "My weight", count: 2, latest_title: "152 lb", latest_at: "2026-11-03T10:00:00+10:00" }, { label: "Blood pressure", count: 1, latest_title: "118/76", latest_at: "2026-11-03T09:00:00+10:00" }] };
    return stats; };

  it("expecting, a blank range talks about what she can log now", async () => {
    await mount(answer(week()), { expecting: true });
    expect(empty().props.body).toMatch(/kicks, contractions and your own logs/i);
    expect(empty().props.body).not.toMatch(/feeds|diapers|sleep/i);
  });
  it("expecting, with kicks switched off, doesn't promise them", async () => {
    await mount(answer(week()), { expecting: true, on: ["contractions", "my_weight"] });
    expect(empty().props.body).not.toMatch(/kicks/i);
    expect(empty().props.body).toMatch(/contractions and your own logs/i);
  });
  it("after the birth, a blank range follows What shows", async () => {
    await mount(answer(week()), { on: ["breast", "sleep"] });
    expect(empty().props.body).toMatch(/feeds and sleep/i);
    expect(empty().props.body).not.toMatch(/diapers/i);
  });
  it("with nothing switched on, a blank range still reads well", async () => {
    await mount(answer(week()), { on: [] });
    expect(empty().props.body).toBe("What you log will add up here.");
  });
  it("says the last day when the range is 24 hours", async () => {
    await mount(answer(week()), { choice: { range: "24h" } });
    expect(empty().props.title).toBe("Nothing logged in the last 24 hours");
  });
  it("expecting, shows what's logged and names what isn't, with no empty charts", async () => {
    await mount(kicked(), { expecting: true });
    expect(sections()).toEqual(["Kicks"]);
    const words = renderer!.root.findAll((n) => String(n.type) === "Copy").flatMap((n) => n.children).join(" ");
    expect(words).toContain("Nothing logged in these days: contractions and your own logs.");
  });
  it("after the birth, a tracker she's switched off with no logs is gone, and one with logs stays", async () => {
    const days = logged({ ...feeds(2) }), stats = answer(days); stats.feeding.count = 2;
    await mount(stats, { on: ["breast", "sleep"] });
    expect(sections()).toEqual(["Feeding"]);
    const words = renderer!.root.findAll((n) => String(n.type) === "Copy").flatMap((n) => n.children).join(" ");
    expect(words).toContain("Nothing logged in these days: sleep.");
    expect(words).not.toContain("diapers");
    await act(async () => renderer!.unmount());
    await mount(stats, { on: ["sleep"] });
    expect(sections()).toEqual(["Feeding"]);
  });
  it("shows her own logs: how many, and the newest exactly as she typed it", async () => {
    await mount(own(answer(logged())), { expecting: true });
    expect(sections()).toEqual(["Your logs"]);
    const words = renderer!.root.findAll((n) => String(n.type) === "Copy" || String(n.type) === "Text").flatMap((n) => n.children).join(" ");
    expect(words).toContain("152 lb");
    expect(words).toContain("118/76");
    expect(words).toContain("My weight");
    expect(words).toContain("2 entries");
  });
  it("lists her logs in the app's own order, and a bar still opens its day", async () => {
    const stats = own(answer(logged()));
    await mount(stats, { expecting: true });
    const labels = renderer!.root.findAll((n) => n.props.accessibilityLabel?.startsWith?.("My weight") || n.props.accessibilityLabel?.startsWith?.("Blood pressure")).map((n) => n.props.accessibilityLabel);
    expect(labels[0]).toContain("My weight");
    const bar = bars().find((n) => String(n.props.accessibilityLabel).includes("3 entries"))!;
    await act(async () => bar.props.onPress());
    expect(onOpen).toHaveBeenCalledWith("2026-11-03");
  });
  it("never reads a number she typed", async () => {
    const stats = own(answer(logged())); stats.own!.logs[1].latest_title = "190/120";
    await mount(stats, { expecting: true });
    const words = renderer!.root.findAll((n) => String(n.type) === "Copy" || String(n.type) === "Text").flatMap((n) => n.children).join(" ").toLowerCase();
    expect(words).toContain("190/120");
    for (const word of ["high", "low", "normal", "range", "elevated", "healthy", "concern"]) expect(words).not.toContain(word);
  });
  it("shows nothing of hers from an API that hasn't sent any, and doesn't crash", async () => {
    await mount(kicked(), { expecting: true });
    expect(sections()).not.toContain("Your logs");
  });
  it("counts her queued log as waiting, whichever baby is on screen", async () => {
    mock.baby.state.outbox = [{ id: "m", generation: 1, type: "save", files: [], record: { id: "w", kind: "custom", title: "152 lb", body: "", child_id: null, occurred_at: "2026-11-03T12:00:00.000Z", data: { label: "My weight" } } }];
    await mount(answer(week()), { expecting: true });
    expect(empty().props.title).toBe("Nothing has reached Håfa yet");
  });
});
