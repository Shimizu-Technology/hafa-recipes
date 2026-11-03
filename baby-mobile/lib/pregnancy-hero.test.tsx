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
vi.mock("@/lib/source-title", () => ({ sourceTitle: () => "" }));
vi.mock("../components/saved-post-row", () => ({ SavedPostRow: "SavedPostRow" }));
vi.mock("../components/ui", () => ({
  Card: "Card", Copy: "Copy", Grouped: "Grouped", Icon: "Icon", PressTarget: "PressTarget", Section: "Section",
  fonts: { rounded: "rounded" }, typeScale: { footnote: { fontSize: 13 }, number: { fontSize: 44, lineHeight: 52 }, subhead: { fontSize: 15 } },
  useColors: () => ({ accentText: "teal", text: "black", muted: "grey" }),
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

it("keeps 'Week 34 · Day 3' together on one line when it fits", async () => {
  await render();
  expect(hero()).toHaveLength(1);
  expect(texts(hero()[0]).join("").replace(/ /g, " ")).toBe("Week 34 · Day 3");
  await act(async () => hero()[0].props.onTextLayout({ nativeEvent: { lines: [{ text: "Week 34 · Day 3" }] } }));
  expect(hero()).toHaveLength(1); // still one line, still joined
});
it("moves 'Day 3' to its own line without a dangling dot when the numeral must wrap", async () => {
  scope.fontScale = 3.1;
  await render();
  await act(async () => hero()[0].props.onTextLayout({ nativeEvent: { lines: [{ text: "Week 34" }, { text: "· Day 3" }] } }));
  expect(hero().map((n) => texts(n).join(""))).toEqual(["Week 34", "Day 3"]);
  expect(hero().some((n) => texts(n).join("").includes("·"))).toBe(false);
});
it("re-decides on every text-size or width change instead of staying stacked", async () => {
  scope.fontScale = 3.1;
  await render();
  await act(async () => hero()[0].props.onTextLayout({ nativeEvent: { lines: [{ text: "Week 34" }, { text: "· Day 3" }] } }));
  expect(hero()).toHaveLength(2);
  scope.fontScale = 1; await render();
  expect(hero()).toHaveLength(1);
  expect(texts(hero()[0]).join("").replace(/ /g, " ")).toBe("Week 34 · Day 3");
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
