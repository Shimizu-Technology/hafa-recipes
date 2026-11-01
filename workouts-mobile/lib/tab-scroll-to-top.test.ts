import { createElement, createRef } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { light } from "../constants/theme";
// Stands in for the tab navigator: useScrollToTop registers here, and a re-tap of the selected tab calls it.
const f = vi.hoisted(() => ({ tab: true, registered: [] as { current: { scrollToTop(): void } }[] }));
vi.mock("react-native", () => ({ View: "View", Pressable: "Pressable", ScrollView: "ScrollView", Modal: "Modal", KeyboardAvoidingView: "KeyboardAvoidingView",
  Platform: { OS: "ios" }, RefreshControl: "RefreshControl", useWindowDimensions: () => ({ width: 402, height: 874, fontScale: 1 }),
  AccessibilityInfo: {}, AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) }, Animated: { View: "AnimatedView" } }));
vi.mock("../components/design/foundation", () => ({ Copy: "Copy", GroupedPage: { Provider: ({ children }: { children: unknown }) => children },
  SurfaceProvider: "SurfaceProvider", useColors: () => light, useGroupedPage: () => false, useSurface: () => "surface", useReducedMotion: () => false }));
vi.mock("../components/design/controls", () => ({ Chip: "Chip", HeaderButton: "HeaderButton", IconButton: "IconButton" }));
vi.mock("../components/design/press", () => ({ animatedPressableComponent: () => "Pressable", usePressScale: () => ({ scale: 1, opacity: 1 }) }));
vi.mock("../components/brand-mark", () => ({ BrandLockup: "BrandLockup", BrandMark: "BrandMark" }));
vi.mock("../components/native-tab-stack", () => ({ useNativeHeader: () => f.tab, headerActions: () => ({}), headerBack: () => ({}) }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Icon" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34 }) }));
vi.mock("expo-image", () => ({ Image: "Image" }));
vi.mock("expo-router", () => ({ router: { canGoBack: () => true }, useSegments: () => ["(tabs)", "train"], Stack: { Screen: "NativeHeader" },
  useScrollToTop: (ref: { current: { scrollToTop(): void } }) => { f.registered.push(ref); } }));
import { Screen } from "../components/design/surfaces";
import { TabScrollToTop, useScrollRest } from "../components/tab-scroll-to-top";

let view: ReactTestRenderer | undefined;
const retapSelectedTab = () => f.registered.forEach(ref => ref.current.scrollToTop());
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; f.tab = true; f.registered = []; });
afterEach(() => { act(() => view?.unmount()); view = undefined; });

it.each([["Today", false], ["Discover", false], ["Progress", true]])("re-tapping the selected tab scrolls %s back to the top", (title, native) => {
  const scrollTo = vi.fn();
  act(() => { view = create(createElement(Screen, { title, native }, createElement("Copy", null, "Body")), {
    createNodeMock: element => element.type === "ScrollView" ? { scrollTo } : null,
  }); });
  const scroll = view!.root.findByType("ScrollView" as never);
  // Under a large title the list rests above zero; the first drag records where "top" is.
  act(() => scroll.props.onScrollBeginDrag({ nativeEvent: { contentOffset: { y: -116 } } }));
  act(() => scroll.props.onScrollBeginDrag({ nativeEvent: { contentOffset: { y: 640 } } }));
  retapSelectedTab();
  expect(scrollTo).toHaveBeenCalledWith({ y: -116, animated: true });
});

it("pushed screens don't listen for tab re-taps", () => {
  act(() => { view = create(createElement(Screen, { title: "Workout", back: true }), { createNodeMock: () => ({ scrollTo: vi.fn() }) }); });
  expect(f.registered).toHaveLength(0);
  f.tab = false;
  act(() => { view!.update(createElement(Screen, { title: "Settings" })); });
  expect(f.registered).toHaveLength(0);
});

it("scrolls a list root (Library) with scrollToOffset to its resting offset", () => {
  const list = createRef<{ scrollToOffset(options: object): void }>();
  const scrollToOffset = vi.fn();
  (list as { current: unknown }).current = { scrollToOffset };
  let rest!: ReturnType<typeof useScrollRest>;
  function LibraryRoot() { rest = useScrollRest(); return createElement(TabScrollToTop, { target: list, rest: rest.rest }); }
  act(() => { view = create(createElement(LibraryRoot)); });
  retapSelectedTab();
  expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: true });
  act(() => rest.onScrollBeginDrag({ nativeEvent: { contentOffset: { y: -96 } } } as never));
  retapSelectedTab();
  expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: -96, animated: true });
});
