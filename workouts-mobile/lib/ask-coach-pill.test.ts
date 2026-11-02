import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { light } from "../constants/theme";
const f = vi.hoisted(() => ({ push: vi.fn(), keyboard: false, fontScale: 1 }));
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable", Text: "Text", Platform: { OS: "ios" },
  useWindowDimensions: () => ({ fontScale: f.fontScale }), LayoutAnimation: { configureNext() {}, create: () => ({}) } }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("expo-router", () => ({ router: { push: f.push } }));
vi.mock("../components/design/foundation", () => ({ useColors: () => light, useReducedMotion: () => false, haptics: { light() {} } }));
vi.mock("../components/design/tab-bar", () => ({ useKeyboardShown: () => f.keyboard }));
import { AskCoachPill } from "../components/ask-coach-pill";
import { reportAskScroll, resetAskScroll } from "./ask-pill";

let view: ReactTestRenderer | undefined;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; f.push.mockClear(); f.keyboard = false; f.fontScale = 1; resetAskScroll(); });
afterEach(() => { act(() => view?.unmount()); view = undefined; });
const pillStyle = () => view!.root.findByType("Pressable" as never).props.style({ pressed: false });

it("stays a full touch target when it collapses to a circle while scrolling", () => {
  act(() => { view = create(createElement(AskCoachPill, { bottom: 102 })); });
  expect(pillStyle()).toMatchObject({ height: 48, minWidth: 48 });
  expect(view!.root.findAllByType("Text" as never)).toHaveLength(1);
  act(() => reportAskScroll(300));
  // Collapsed: the label goes, the 48pt circle stays (≥44pt in both directions).
  expect(view!.root.findAllByType("Text" as never)).toHaveLength(0);
  expect(pillStyle()).toMatchObject({ height: 48, minWidth: 48, paddingHorizontal: 0 });
  expect(Math.min(pillStyle().height, pillStyle().minWidth)).toBeGreaterThanOrEqual(44);
  act(() => view!.root.findByType("Pressable" as never).props.onPress());
  expect(f.push).toHaveBeenCalledWith("/coach");
});


it("uses the accessible icon-only entry at accessibility text sizes", () => {
  f.fontScale = 3;
  act(() => { view = create(createElement(AskCoachPill, { bottom: 102 })); });
  expect(view!.root.findAllByType("Text" as never)).toHaveLength(0);
  expect(view!.root.findByType("Pressable" as never).props.accessibilityLabel).toBe("Ask Coach");
});
