import { createElement, Fragment } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { light } from "../constants/theme";
const f = vi.hoisted(() => ({ segments: ["(tabs)", "library"], listeners: new Set<(value: string) => void>(), start: vi.fn(), stop: vi.fn(), announce: vi.fn(), reduced: false, fontScale: 1, appState: "active" }));
vi.mock("react-native", () => {
  class Value { constructor(public value: number) {} setValue(v: number) { this.value = v; } }
  return { useWindowDimensions: () => ({ fontScale: f.fontScale, width: 390 }), View: "View", Pressable: "Pressable", ScrollView: "ScrollView", Modal: "Modal", KeyboardAvoidingView: "KeyboardAvoidingView", Platform: { OS: "ios" }, RefreshControl: "RefreshControl",
    AccessibilityInfo: { announceForAccessibility: f.announce },
    AppState: { get currentState() { return f.appState; }, addEventListener: (_: string, fn: (value: string) => void) => { f.listeners.add(fn); return { remove: () => f.listeners.delete(fn) }; } },
    Animated: { View: "AnimatedView", Value, timing: () => ({ start() {} }), sequence: () => ({}), loop: () => ({ start: f.start, stop: f.stop }) } };
});
vi.mock("../components/design/foundation", () => ({ Copy: "Copy", SurfaceProvider: "SurfaceProvider", useColors: () => light, useSurface: () => "surface", useGroupedPage: () => false, useReducedMotion: () => f.reduced }));
vi.mock("../components/design/controls", () => ({ Chip: "Chip", IconButton: "IconButton" }));
vi.mock("../components/design/press", () => ({ animatedPressableComponent: () => "Pressable", usePressScale: () => ({ scale: 1, opacity: 1 }) }));
vi.mock("../components/brand-mark", () => ({ BrandLockup: "BrandLockup", BrandMark: "BrandMark" }));
vi.mock("../components/native-tab-stack", () => ({ useNativeHeader: () => false }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34 }) }));
vi.mock("expo-router", () => ({ router: {}, useSegments: () => f.segments }));
vi.mock("expo-image", () => ({ Image: "Image" }));
import { Skeleton, ToastProvider, useToast, ListRow, ListGroup, Notice } from "../components/design/surfaces";
import { reportTabScreenBottomInset } from "./bottom-overlay";
let view: ReactTestRenderer | undefined;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; f.listeners.clear(); f.start.mockClear(); f.stop.mockClear(); f.announce.mockClear(); f.reduced = false; f.fontScale = 1; f.appState = "active"; vi.useFakeTimers(); });
afterEach(() => { act(() => view?.unmount()); vi.useRealTimers(); });
it("stops skeleton loops while backgrounded and resumes only when active", () => {
  act(() => { view = create(createElement(Skeleton)); }); expect(f.start).toHaveBeenCalledOnce();
  act(() => f.listeners.forEach(fn => fn("background"))); expect(f.stop).toHaveBeenCalledOnce();
  act(() => f.listeners.forEach(fn => fn("active"))); expect(f.start).toHaveBeenCalledTimes(2);
});
it("never starts a pulse when mounted in the background or under Reduce Motion", () => {
  f.appState = "background";
  act(() => { view = create(createElement(Skeleton)); }); expect(f.start).not.toHaveBeenCalled();
  f.reduced = true; act(() => f.listeners.forEach(fn => fn("active"))); expect(f.start).not.toHaveBeenCalled();
});
it("announces confirmed toast messages on iOS", () => {
  let show: ReturnType<typeof useToast>;
  function Probe() { show = useToast(); return null; }
  act(() => { view = create(createElement(ToastProvider, null, createElement(Probe))); });
  act(() => show!("Saved to your library"));
  expect(f.announce).toHaveBeenCalledWith("Saved to your library");
});

it("keeps toasts above the tab bar and the Ask Coach pill", () => {
  let show: ReturnType<typeof useToast>;
  function Probe() { show = useToast(); return null; }
  reportTabScreenBottomInset(83);
  act(() => { view = create(createElement(ToastProvider, null, createElement(Probe))); });
  act(() => show!("Saved to your library"));
  const toastBottom = () => view!.root.findAll(n => (n.type as unknown) === "AnimatedView" && n.props.accessibilityRole === "alert")[0].props.style.bottom;
  // Bar height + gap, then the 48pt pill and its 8pt spacing.
  expect(toastBottom()).toBe(83 + 12 + 56);
  act(() => view!.unmount());
  f.segments = ["session", "abc"];
  act(() => { view = create(createElement(ToastProvider, null, createElement(Probe))); });
  act(() => show!("Set logged"));
  // Off the tabs it keeps clear of bottom action bars such as the session controls.
  expect(toastBottom()).toBe(34 + 72);
  f.segments = ["(tabs)", "library"];
});

it("renders a distinct PR badge and announces Personal record with the score", () => {
  act(() => { view = create(createElement(ListRow, { title: "3 + 12", detail: "Nov 17 · Rx", badge: "PR", onPress() {} })); });
  expect(view!.root.findByType("Pressable" as never).props.accessibilityLabel).toBe("3 + 12. Nov 17 · Rx. Personal record");
  const badge = view!.root.findAllByType("Copy" as never).find(n => n.props.children === "PR")!;
  expect(badge.props).toMatchObject({ kind: "label", color: light.onAccent });
  expect(badge.parent!.props.style.backgroundColor).toBe(light.accent);
});

it("preserves ordinary ListRow VoiceOver labels without appending every visual value", () => {
  act(() => { view = create(createElement(ListRow, { title: "Saved sessions", detail: "View history", value: "12", onPress() {} })); });
  expect(view!.root.findByType("Pressable" as never).props.accessibilityLabel).toBe("Saved sessions. View history");
  expect(view!.root.findAllByType("Copy" as never).some((n) => n.props.children === "12")).toBe(true);
});

it.each([1, 3.1])("gives notice prose the full width at accessibility scale %s", fontScale => {
  f.fontScale = fontScale;
  const text = "Review each class part before saving. Check all reps, loads, distances and times. Your gym class stays private.";
  act(() => { view = create(createElement(Notice, {}, text)); });
  const container = view!.root.findByProps({ accessibilityLiveRegion: "polite" });
  expect(container.props.style.flexDirection).toBe(fontScale === 1 ? "row" : "column");
  const copy = view!.root.findByType("Copy" as never);
  expect(copy.props.children).toBe(text);
  expect(copy.props.numberOfLines).toBeUndefined();
  if (fontScale > 1) expect(copy.props.style).toMatchObject({ flex: undefined, alignSelf: "stretch" });
});
it("gives rows from sibling fragments distinct keys", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    act(() => { view = create(createElement(ListGroup, null,
      createElement(Fragment, null, createElement("Row", { id: "a" }), createElement("Row", { id: "b" })),
      createElement(Fragment, null, createElement("Row", { id: "c" }), createElement("Row", { id: "d" })))); });
    expect(view!.root.findAllByType("Row" as never).map(row => row.props.id)).toEqual(["a", "b", "c", "d"]);
    act(() => { view!.update(createElement(ListGroup, null,
      createElement(Fragment, { key: "a" }, createElement("Row", { id: "in-fragment" })),
      createElement("Row", { id: "explicit", key: "a/.0" }))); });
    expect(view!.root.findAllByType("Row" as never).map(row => row.props.id)).toEqual(["in-fragment", "explicit"]);
    expect(error.mock.calls.some(call => String(call[0]).includes("same key"))).toBe(false);
  } finally { error.mockRestore(); }
});
