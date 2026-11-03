import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Child } from "./models";

const scope = vi.hoisted(() => ({ fontScale: 1, width: 390 }));
vi.mock("react-native", () => ({
  Text: "Text", View: "View", useWindowDimensions: () => ({ fontScale: scope.fontScale, width: scope.width }),
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
import { PregnancyHero } from "../components/tips";

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
it("shows a 34-of-40 bar and the tips saved for this week, three at most, with See all", async () => {
  const tip = (id: string) => ({ id, kind: "source", title: `Tip ${id}`, data: {} }) as never;
  await act(async () => { renderer = create(React.createElement(PregnancyHero, { child, now, tips: ["a", "b", "c", "d"].map(tip) })); });
  const copy = renderer!.root.findAll((n) => (n.type as unknown) === "Copy").map((n) => n.props.children);
  expect(copy).toContain("Saved for week 34");
  expect(copy).toContain("34 of 40 weeks");
  const buttons = renderer!.root.findAll((n) => (n.type as unknown) === "PressTarget");
  expect(buttons.map((n) => n.props.accessibilityLabel)).toEqual(["See all, Saved for week 34", "Tip a", "Tip b", "Tip c"]);
  const fill = renderer!.root.findAll((n) => (n.type as unknown) === "View" && n.props.style?.backgroundColor === "fill")[0];
  expect(parseFloat(fill.props.style.width)).toBeCloseTo(((34 + 3 / 7) / 40) * 100);
});
it("says where this week's tips will appear when none are saved yet", async () => {
  await act(async () => { renderer = create(React.createElement(PregnancyHero, { child, now, tips: [] })); });
  const copy = renderer!.root.findAll((n) => (n.type as unknown) === "Copy").map((n) => n.props.children);
  expect(copy).toContain("Tips you save for this point in your pregnancy show up here.");
  expect(renderer!.root.findAll((n) => (n.type as unknown) === "PressTarget")).toHaveLength(0);
});
