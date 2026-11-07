import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../components/health-note", () => ({ HealthNote: "HealthNote" }));
import type { BabyRecord, Child } from "./models";

const scope = vi.hoisted(() => ({ fontScale: 1, width: 390 }));
vi.mock("@/lib/weekly-content", () => import("./weekly-content"));
vi.mock("react-native", () => ({
  Text: "Text", View: "View", Pressable: "Pressable", useWindowDimensions: () => ({ fontScale: scope.fontScale, width: scope.width }),
}));
vi.mock("expo-router", () => ({ router: { navigate() {} } }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ records: [] }) }));
vi.mock("@/lib/suggestions", () => ({ pendingSuggestion: () => null }));
vi.mock("@/lib/source-title", () => ({ sourceTitle: (row?: { title?: string }) => row?.title ?? "" }));
vi.mock("../components/saved-post-row", () => ({ SavedPostRow: "SavedPostRow", Monogram: "Monogram", safeThumbnail: () => undefined }));
vi.mock("../components/motion", () => ({ FadeUp: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("../components/ui", () => ({
  Card: "Card", Copy: "Copy", Grouped: "Grouped", Icon: "Icon", PressTarget: "PressTarget", Section: "Section",
  fonts: { display: "display", displayItalic: "italic", medium: "medium", semibold: "semibold" }, radii: { hero: 28, thumb: 14 },
  typeScale: { footnote: { fontSize: 14 }, subhead: { fontSize: 15 } },
  useColors: () => ({ accentText: "clay", text: "cocoa", muted: "grey", hero: "blush", border: "line", progressTrack: "track", progressFill: "fill" }),
}));
vi.mock("@/lib/timing", () => import("./timing"));
import { BabyAgeCard, PregnancyHero, WeekDetails } from "../components/tips";
import { weekWaiting } from "../components/week-facts";

const child = { id: "isla", name: "Isla", due_date: "2026-12-10", revision: 1 } as Child;
const now = new Date(2026, 10, 1);
let renderer: ReactTestRenderer | undefined;
const render = () => act(() => { if (renderer) renderer.update(React.createElement(PregnancyHero, { child, now })); else renderer = create(React.createElement(PregnancyHero, { child, now })); });
const texts = (node: { children: unknown[] }): string[] => node.children.map((c) => typeof c === "string" ? c : texts(c as { children: unknown[] }).join("")) as string[];
const hero = () => renderer!.root.findAll((n) => (n.type as unknown) === "Text").filter((n) => n.props.maxFontSizeMultiplier === 1.5);
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); scope.fontScale = 1; scope.width = 390; });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

it("keeps 'Week 34 Day 3' together on one line when it fits", async () => {
  await render();
  expect(hero()).toHaveLength(1);
  expect(texts(hero()[0]).join("").replace(/ /g, " ")).toBe("Week 34  Day 3");
  await act(async () => hero()[0].props.onTextLayout({ nativeEvent: { lines: [{ text: "Week 34  Day 3" }] } }));
  expect(hero()).toHaveLength(1); // still one line, still joined
});
it("moves 'Day 3' to its own line when the numeral must wrap", async () => {
  scope.fontScale = 3.1;
  await render();
  await act(async () => hero()[0].props.onTextLayout({ nativeEvent: { lines: [{ text: "Week 34" }, { text: "Day 3" }] } }));
  expect(hero().map((n) => texts(n).join(""))).toEqual(["Week 34", "Day 3"]);
});
it("re-decides on every text-size or width change instead of staying stacked", async () => {
  scope.fontScale = 3.1;
  await render();
  await act(async () => hero()[0].props.onTextLayout({ nativeEvent: { lines: [{ text: "Week 34" }, { text: "Day 3" }] } }));
  expect(hero()).toHaveLength(2);
  scope.fontScale = 1; await render();
  expect(hero()).toHaveLength(1);
  expect(texts(hero()[0]).join("").replace(/ /g, " ")).toBe("Week 34  Day 3");
});
it("keeps one spoken label whichever way it lays out", async () => {
  scope.fontScale = 3.1;
  await render();
  const label = () => renderer!.root.findAll((n) => n.props.accessible === true)[0].props.accessibilityLabel;
  const before = label();
  await act(async () => hero()[0].props.onTextLayout({ nativeEvent: { lines: [{ text: "a" }, { text: "b" }] } }));
  expect(label()).toBe(before);
  expect(before).toMatch(/^Week 34, day 3\./);
});
it("is compact: week, progress, the due line and one short waiting line, whatever's saved", async () => {
  await act(async () => { renderer = create(React.createElement(PregnancyHero, { child, now })); });
  const copy = renderer!.root.findAll((n) => (n.type as unknown) === "Copy").map((n) => n.props.children);
  expect(copy).toEqual([]); // Reviewed facts live below the compact hero.
  expect(weekWaiting.length).toBeLessThanOrEqual(46);
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("Saved for week");
  const fill = renderer!.root.findAll((n) => (n.type as unknown) === "View" && n.props.style?.backgroundColor === "fill")[0];
  expect(parseFloat(fill.props.style.width)).toBeCloseTo(((34 + 3 / 7) / 40) * 100);
  expect(renderer!.root.findAll((n) => n.props.accessible === true)[0].props.accessibilityLabel).toContain("34 of 40 weeks");
});
it("shows the tips saved for this week, three at most, with See all, in their own card", async () => {
  const tip = (id: string) => ({ id, kind: "source", title: `Tip ${id}`, data: {} }) as never;
  await act(async () => { renderer = create(React.createElement(WeekDetails, { child, now, tips: ["a", "b", "c", "d"].map(tip) })); });
  const copy = renderer!.root.findAll((n) => (n.type as unknown) === "Copy").map((n) => n.props.children);
  expect(copy).toContain("Saved for week 34");
  const buttons = renderer!.root.findAll((n) => (n.type as unknown) === "PressTarget");
  expect(buttons.map((n) => n.props.accessibilityLabel).filter((label) => !String(label).startsWith("Source:"))).toEqual(["See all, Saved for week 34", "Tip a", "Tip b", "Tip c"]);
});
it("has no Saved heading at all with nothing saved", async () => {
  await act(async () => { renderer = create(React.createElement(WeekDetails, { child, now, tips: [] })); });
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("Saved for week");
  expect(renderer!.root.findAll((n) => (n.type as unknown) === "PressTarget" && !String(n.props.accessibilityLabel).startsWith("Source:"))).toHaveLength(0);
});

describe("BabyAgeCard", () => {
  const born = { ...child, birth_date: "2026-12-10", due_date: null } as Child;
  const shown = () => JSON.stringify(renderer!.toJSON());
  const mount = (at: Date, tips: BabyRecord[] = []) => act(async () => { renderer = create(React.createElement(BabyAgeCard, { child: born, now: at, tips })); });
  it("names the week, shows reviewed lines, and keeps her saved tips beside it", async () => {
    await mount(new Date(2026, 11, 20), [{ id: "t1", kind: "source", title: "Latch tips", data: {} } as BabyRecord]);
    expect(shown()).toContain("Week 2");
    expect(shown()).not.toContain("once a doctor");
    expect(shown()).toContain("Crying is how your baby");
    expect(shown()).toContain("Latch tips");
  });
  it("switches to months after week 12, and says where tips will go when there are none", async () => {
    await mount(new Date(2027, 5, 10));
    expect(shown()).toContain("6 months");
    expect(shown()).toContain("Tips you save for this age show up here.");
  });
  it("past 24 months has no age card, and her tips still have a home", async () => {
    await mount(new Date(2029, 5, 10), [{ id: "t1", kind: "source", title: "Latch tips", data: {} } as BabyRecord]);
    expect(renderer!.root.findAll((n) => String(n.type) === "Section")[0].props.title).toBe("For this age");
  });
});
