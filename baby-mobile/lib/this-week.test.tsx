import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callIf, dayOfLife, dayPlan, hiddenOnToday, sources, todoDone, weekPlan, withHidden } from "./this-week";
import type { Child, DeviceState } from "./models";

const m = vi.hoisted(() => ({ baby: null as any, push: vi.fn(), toast: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock("expo-router", () => ({ router: { push: m.push } }));
vi.mock("@/lib/context", () => ({ useBaby: () => m.baby }));
vi.mock("../components/medical-source", () => ({ MedicalSource: "MedicalSource" }));
vi.mock("../components/ui", () => ({ Copy: "Copy", Grouped: "Grouped", PressTarget: "PressTarget", Row: "Row", Section: "Section",
  fonts: {}, typeScale: {}, useColors: () => ({}), useToast: () => m.toast }));
import { DayOfLife, ThisWeek } from "../components/this-week";

describe("before the birth", () => {
  it("starts at week 28 and ends after 42", () => {
    expect(weekPlan(27)).toBeNull();
    expect(weekPlan(43)).toBeNull();
    expect(weekPlan(28)!.prepare.map((t) => t.label)).toEqual(["Start your hospital bag list", "Choose your baby’s doctor", "Write down questions for your next visit"]);
  });
  it("moves from visits every two weeks to weekly at 36, and asks about when to call", () => {
    expect(weekPlan(35)!.expect[0].text).toBe("Visits usually come every 2 weeks until week 36.");
    expect(weekPlan(36)!.expect[0].text).toBe("From week 36, visits are usually every week.");
    expect(weekPlan(36)!.prepare[0].label).toBe("Finish packing your bag");
    expect(weekPlan(37)!.prepare.some((t) => t.label.startsWith("Ask your provider when to call"))).toBe(true);
    expect(weekPlan(40)!.prepare[0].label).toBe("Keep your bag by the door");
  });
  it("cites every fact, and lists no to-do twice", () => {
    for (let week = 28; week <= 42; week++) {
      const plan = weekPlan(week)!;
      expect(plan.expect.every((line) => line.source.url.startsWith("https://"))).toBe(true);
      expect(new Set(plan.prepare.map((t) => t.id)).size).toBe(plan.prepare.length);
    }
  });
  it("knows a doctor or delivery place is already saved", () => {
    const child = { details: { doctor: { name: "Dr. Cruz", phone: "671-555-0101" } } } as Child;
    expect(todoDone({ id: "baby_doctor", label: "", link: "baby_doctor" }, null, child)).toBe(true);
    expect(todoDone({ id: "delivery", label: "", link: "delivery" }, { contacts: { delivery: null } }, child)).toBe(false);
    expect(todoDone({ id: "delivery", label: "", link: "delivery" }, { contacts: { delivery: { name: "GMH", phone: "671" } } }, child)).toBe(true);
  });
});

describe("after the birth", () => {
  it("counts the birth day as day 1, for two weeks", () => {
    expect(dayOfLife("2026-12-08", new Date(2026, 11, 8))).toBe(1);
    expect(dayOfLife("2026-12-08", new Date(2026, 11, 10, 23, 59))).toBe(3);
    expect(dayOfLife("2026-12-08", new Date(2026, 11, 7))).toBeNull();
    expect(dayPlan(15)).toBeNull();
    expect(dayPlan(0)).toBeNull();
  });
  it("follows AAP's days, and drops the nursing line for a bottle-fed baby", () => {
    expect(dayPlan(2)![0].text).toContain("days 1 and 2");
    expect(dayPlan(4)![0].text).toContain("days 3 and 4");
    expect(dayPlan(6)![0].text).toContain("6 or more wet diapers");
    expect(dayPlan(6)!.some((line) => line.text.startsWith("Breastfed newborns"))).toBe(true);
    expect(dayPlan(6, "bottle")!.some((line) => line.text.startsWith("Breastfed newborns"))).toBe(false);
    expect(dayPlan(3)!.some((line) => line.text.includes("48 hours"))).toBe(true);
    expect(dayPlan(4)!.some((line) => line.text.includes("48 hours"))).toBe(false);
    expect(dayPlan(9)!.every((line) => line.source === sources.enoughMilk)).toBe(true);
    expect(callIf.source.url).toBe("https://www.cdc.gov/infant-toddler-nutrition/breastfeeding/newborn-basics.html");
  });
  it("hides and shows each card on its own", () => {
    expect(withHidden(undefined, "this_week", true)).toEqual(["this_week"]);
    expect(withHidden(["this_week"], "this_week", true)).toEqual(["this_week"]);
    expect(hiddenOnToday(withHidden(["this_week"], "day_of_life", true), "this_week")).toBe(true);
    expect(withHidden(["this_week", "day_of_life"], "this_week", false)).toEqual(["day_of_life"]);
  });
});

describe("on Today", () => {
  let renderer: ReactTestRenderer | undefined;
  const all = (type: string) => renderer!.root.findAll((node) => String(node.type) === type);
  const words = () => all("Copy").map((node) => node.props.children);
  function setup(state: Partial<DeviceState> = {}, records: unknown[] = []) {
    let current = { hiddenToday: [], bootstrap: { contacts: {} }, ...state } as unknown as DeviceState;
    m.baby = { get state() { return current; }, records, commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { current = change(current); }) };
  }
  beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); m.push.mockClear(); m.toast.mockClear(); });
  afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
  // Due Dec 10: Nov 15 is 36 weeks 3 days.
  const expecting = { id: "c", name: "Baby", due_date: "2026-12-10", details: {} } as unknown as Child;

  it("leads with the bag and opens each to-do where she'd do it", async () => {
    setup({}, [{ id: "bag", kind: "routine", updated_at: "x", data: { routine_type: "checklist", items: [{ id: "bag:mom:a", label: "A", done: true }, { id: "bag:mom:b", label: "B", done: false }] } }]);
    await act(async () => { renderer = create(<ThisWeek child={expecting} today={new Date(2026, 10, 15)} />); });
    const rows = all("Row");
    expect(rows.map((row) => row.props.title)[0]).toBe("Finish packing your bag");
    expect(rows[0].props.detail).toBe("1 of 2 packed");
    // "Ask your provider when to call or come in once contractions start" is the whole point: never cut at two lines.
    expect(rows.every((row) => row.props.wrap)).toBe(true);
    expect(words()).toContain("From week 36, visits are usually every week.");
    await act(async () => rows[0].props.onPress());
    expect(m.push).toHaveBeenLastCalledWith("/hospital-bag");
    await act(async () => rows.find((row) => row.props.title.startsWith("Save where"))!.props.onPress());
    expect(m.push).toHaveBeenLastCalledWith({ pathname: "/profile", params: { open: "delivery" } });
    await act(async () => rows.find((row) => row.props.title.startsWith("Choose your baby"))!.props.onPress());
    expect(m.push).toHaveBeenLastCalledWith({ pathname: "/child", params: { id: "c", doctor: "1" } });
  });
  it("hides with Undo, and stays hidden", async () => {
    setup();
    await act(async () => { renderer = create(<ThisWeek child={expecting} today={new Date(2026, 10, 15)} />); });
    await act(async () => { all("Section")[0].props.action.props.onPress(); });
    expect(m.baby.state.hiddenToday).toEqual(["this_week"]);
    expect(m.toast.mock.calls[0][0]).toBe("This week hidden. What shows brings it back.");
    await act(async () => { renderer!.update(<ThisWeek child={expecting} today={new Date(2026, 10, 15)} />); });
    expect(renderer!.toJSON()).toBeNull();
    await act(async () => { m.toast.mock.calls[0][1].onPress(); });
    expect(m.baby.state.hiddenToday).toEqual([]);
  });
  it("shows Day 3 with what most babies do and when to call, with nothing about her own counts", async () => {
    setup();
    const born = { ...expecting, birth_date: "2026-12-08" } as Child;
    await act(async () => { renderer = create(<DayOfLife child={born} today={new Date(2026, 11, 10)} />); });
    expect(all("Section")[0].props.title).toBe("Day 3");
    expect(words()).toContain("On days 3 and 4, most babies have at least 2 poops a day, turning greenish to yellow.");
    expect(words()).toContain(callIf.text);
    expect(all("MedicalSource").length).toBeGreaterThanOrEqual(3);
    await act(async () => renderer!.unmount());
    setup({ hiddenToday: ["day_of_life"] });
    await act(async () => { renderer = create(<DayOfLife child={born} today={new Date(2026, 11, 10)} />); });
    expect(renderer!.toJSON()).toBeNull();
  });
});
