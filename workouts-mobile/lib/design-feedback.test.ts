import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { light } from "../constants/theme";
const f = vi.hoisted(() => ({ listeners: new Set<(value: string) => void>(), start: vi.fn(), stop: vi.fn(), announce: vi.fn(), reduced: false, appState: "active" }));
vi.mock("react-native", () => {
  class Value { constructor(public value: number) {} setValue(v: number) { this.value = v; } }
  return { View: "View", Pressable: "Pressable", ScrollView: "ScrollView", Modal: "Modal", KeyboardAvoidingView: "KeyboardAvoidingView", Platform: { OS: "ios" }, RefreshControl: "RefreshControl",
    AccessibilityInfo: { announceForAccessibility: f.announce },
    AppState: { get currentState() { return f.appState; }, addEventListener: (_: string, fn: (value: string) => void) => { f.listeners.add(fn); return { remove: () => f.listeners.delete(fn) }; } },
    Animated: { View: "AnimatedView", Value, timing: () => ({ start() {} }), sequence: () => ({}), loop: () => ({ start: f.start, stop: f.stop }) } };
});
vi.mock("../components/design/foundation", () => ({ Copy: "Copy", SurfaceProvider: "SurfaceProvider", useColors: () => light, useSurface: () => "surface", useReducedMotion: () => f.reduced }));
vi.mock("../components/design/controls", () => ({ Chip: "Chip", IconButton: "IconButton" }));
vi.mock("../components/design/press", () => ({ animatedPressableComponent: () => "Pressable", usePressScale: () => ({ scale: 1, opacity: 1 }) }));
vi.mock("../components/brand-mark", () => ({ BrandLockup: "BrandLockup", BrandMark: "BrandMark" }));
vi.mock("../components/native-tab-stack", () => ({ useNativeHeader: () => false }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock("expo-router", () => ({ router: {} }));
vi.mock("expo-image", () => ({ Image: "Image" }));
import { Skeleton, ToastProvider, useToast } from "../components/design/surfaces";
let view: ReactTestRenderer | undefined;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; f.listeners.clear(); f.start.mockClear(); f.stop.mockClear(); f.announce.mockClear(); f.reduced = false; f.appState = "active"; vi.useFakeTimers(); });
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
