import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ push: vi.fn(), keyboard: {} as Record<string, () => void>, heights: [] as number[],
  reduced: false, springs: [] as number[] }));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Platform: { OS: "ios" }, StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.33 },
  AccessibilityInfo: { isReduceMotionEnabled: async () => mock.reduced, addEventListener: () => ({ remove() {} }) },
  Animated: {
    View: "AnimatedView",
    Value: class { value: number; constructor(v: number) { this.value = v; } setValue(v: number) { this.value = v; } },
    spring: (value: { value: number }, config: { toValue: number }) => ({ start() { mock.springs.push(config.toValue); value.value = config.toValue; } }),
  },
  Keyboard: { addListener: (name: string, callback: () => void) => { mock.keyboard[name] = callback; return { remove() {} }; } },
}));
vi.mock("expo-router", () => ({ router: { push: mock.push }, Tabs: Object.assign(({ children, ...props }: any) => React.createElement("Tabs", props, children), { Screen: "TabScreen" }) }));
vi.mock("@/lib/bottom-overlay", () => ({ reportTabBarHeight: (height: number) => mock.heights.push(height) }));
vi.mock("../components/ui", () => ({
  Icon: "Icon", tap: () => undefined, PressTarget: "PressTarget", fonts: { semibold: "semibold", bold: "bold" },
  useColors: () => ({ muted: "muted", tabInk: "ink", tabIndicator: "blush", addFill: "clay", onAdd: "white", tabBar: "white", tabBarBorder: "line" }),
}));
vi.mock("@/components/tab-bar", () => import("../components/tab-bar"));
import TabLayout from "../app/(tabs)/_layout";
import { BabyTabBar } from "../components/tab-bar";

let renderer: ReactTestRenderer | undefined;
const routes = ["(today)", "tracker", "library", "ask"].map((name) => ({ key: `${name}-key`, name, params: undefined }));
const navigation = { emit: vi.fn(() => ({ defaultPrevented: false })), navigate: vi.fn() };
async function mount(index = 0) {
  await act(async () => { renderer = create(<BabyTabBar state={{ index, routes } as any} navigation={navigation as any}
    insets={{ top: 0, bottom: 34, left: 0, right: 0 }} descriptors={{} as any} />); });
}
const targets = () => renderer!.root.findAllByType("PressTarget" as React.ElementType);
beforeEach(() => { mock.push.mockClear(); navigation.emit.mockClear(); navigation.navigate.mockClear(); mock.reduced = false; mock.springs = []; });
/** Lay the 5-slot row out at 400pt, so each slot is 80pt wide. */
const layOut = () => act(() => renderer!.root.findAll((node) => String(node.type) === "View" && node.props.style?.height === 56 && !!node.props.onLayout)[0]
  .props.onLayout({ nativeEvent: { layout: { width: 400 } } }));
const indicator = () => renderer!.root.findAllByType("AnimatedView" as React.ElementType)[0];
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

it("draws its own bar instead of native tabs, so iOS 18, 26 and Android match", () => {
  const tabs = TabLayout();
  expect(tabs.props.screenOptions).toEqual({ headerShown: false, lazy: false });
  expect((tabs.props.children as { props: { name: string } }[]).map((tab) => tab.props.name)).toEqual(["(today)", "tracker", "library", "ask"]);
});

it("orders Today · Tracker · Add · Saved · Ask and marks the selected tab with a filled icon on a blush pill", async () => {
  await mount(1);
  expect(targets().map((t) => t.props.accessibilityLabel)).toEqual(["Today", "Tracker", "Add", "Saved", "Ask"]);
  expect(targets()[1].props.accessibilityState).toEqual({ selected: true });
  const icons = renderer!.root.findAllByType("Icon" as React.ElementType).map((icon) => icon.props.name);
  expect(icons).toEqual(["sunny-outline", "calendar", "add", "bookmark-outline", "chatbubble-ellipses-outline"]);
  // The Add is a deep-clay circle: the one filled object in the bar.
  const add = renderer!.root.findAll((node) => String(node.type) === "View" && node.props.style?.[0]?.width === 36 && node.props.style?.[0]?.borderRadius === 18);
  expect(add.map((circle) => circle.props.style[1].backgroundColor)).toEqual(["clay"]);
  await layOut();
  expect(indicator().props.style[1]).toMatchObject({ width: 80, transform: [{ translateX: { value: 80 } }] });
  expect(indicator().findByType("View" as React.ElementType).props.style[1].backgroundColor).toBe("blush");
  expect(mock.springs).toEqual([]); // placed, not slid, on first layout
});

it("slides the pill to the next tab, past the centre Add, and jumps under Reduce Motion", async () => {
  await mount(1);
  await layOut();
  await act(async () => renderer!.update(<BabyTabBar state={{ index: 2, routes } as any} navigation={navigation as any}
    insets={{ top: 0, bottom: 34, left: 0, right: 0 }} descriptors={{} as any} />));
  expect(mock.springs).toEqual([240]);
  act(() => renderer!.unmount()); renderer = undefined; mock.springs = []; mock.reduced = true;
  await mount(1);
  await layOut();
  await act(async () => renderer!.update(<BabyTabBar state={{ index: 3, routes } as any} navigation={navigation as any}
    insets={{ top: 0, bottom: 34, left: 0, right: 0 }} descriptors={{} as any} />));
  expect(mock.springs).toEqual([]);
  expect(indicator().props.style[1].transform[0].translateX.value).toBe(320);
});

it("gives every tab and the centre Add a target of at least 44×44 around the smaller pill", async () => {
  await mount();
  for (const target of targets()) {
    expect(target.props.style.height).toBeGreaterThanOrEqual(44);
    expect(target.props.style.minWidth).toBeGreaterThanOrEqual(44);
  }
});

it("opens the Add sheet from the centre and describes what it offers", async () => {
  await mount();
  expect(targets()[2].props.accessibilityHint).toBe("Save a video or link, write in your journal, keep a doctor question, or make a list");
  await act(async () => targets()[2].props.onPress());
  expect(mock.push).toHaveBeenCalledWith("/add");
});

it("switches tabs, and leaves a second tap on the current tab to its stack", async () => {
  await mount(0);
  await act(async () => targets()[3].props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith("library", undefined);
  await act(async () => targets()[0].props.onPress());
  expect(navigation.emit).toHaveBeenLastCalledWith({ type: "tabPress", target: "(today)-key", canPreventDefault: true });
  expect(navigation.navigate).toHaveBeenCalledTimes(1);
});

it("reports its height for toasts and hides while the keyboard is up", async () => {
  await mount();
  const bar = renderer!.root.findAllByType("View" as React.ElementType)[0];
  act(() => bar.props.onLayout({ nativeEvent: { layout: { height: 90 } } }));
  expect(mock.heights).toContain(90);
  expect(bar.props.style.paddingBottom).toBe(34);
  await act(async () => mock.keyboard.keyboardWillShow());
  expect(renderer!.toJSON()).toBeNull();
  await act(async () => mock.keyboard.keyboardWillHide());
  expect(targets()).toHaveLength(5);
});
