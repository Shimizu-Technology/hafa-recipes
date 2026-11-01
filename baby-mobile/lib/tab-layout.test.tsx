import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ push: vi.fn(), keyboard: {} as Record<string, () => void>, care: false, heights: [] as number[] }));
vi.mock("react-native", () => ({
  View: "View", Text: "Text", Platform: { OS: "ios" }, StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.33 },
  Keyboard: { addListener: (name: string, callback: () => void) => { mock.keyboard[name] = callback; return { remove() {} }; } },
}));
vi.mock("expo-router", () => ({ router: { push: mock.push }, Tabs: Object.assign(({ children, ...props }: any) => React.createElement("Tabs", props, children), { Screen: "TabScreen" }) }));
vi.mock("@/lib/context", () => ({ useBaby: () => ({ state: { bootstrap: { children: [], profile: { timezone: "Pacific/Guam" } } } }) }));
vi.mock("@/lib/timing", () => ({ careLogsStarted: () => mock.care, profileToday: () => "2026-11-02" }));
vi.mock("@/lib/bottom-overlay", () => ({ reportTabBarHeight: (height: number) => mock.heights.push(height) }));
vi.mock("../components/ui", () => ({
  Icon: "Icon", tap: () => undefined, PressTarget: "PressTarget",
  useColors: () => ({ action: "cocoa", onAction: "sand", muted: "muted", accentTint: "tint", tabBar: "white", tabBarBorder: "line" }),
}));
vi.mock("@/components/tab-bar", () => import("../components/tab-bar"));
import TabLayout from "../app/(tabs)/_layout";
import { BabyTabBar } from "../components/tab-bar";

let renderer: ReactTestRenderer | undefined;
const routes = ["(today)", "library", "journal", "ask"].map((name) => ({ key: `${name}-key`, name, params: undefined }));
const navigation = { emit: vi.fn(() => ({ defaultPrevented: false })), navigate: vi.fn() };
async function mount(index = 0) {
  await act(async () => { renderer = create(<BabyTabBar state={{ index, routes } as any} navigation={navigation as any}
    insets={{ top: 0, bottom: 34, left: 0, right: 0 }} descriptors={{} as any} />); });
}
const targets = () => renderer!.root.findAllByType("PressTarget" as React.ElementType);
beforeEach(() => { mock.push.mockClear(); navigation.emit.mockClear(); navigation.navigate.mockClear(); mock.care = false; });
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; });

it("draws its own bar instead of native tabs, so iOS 18, 26 and Android match", () => {
  const tabs = TabLayout();
  expect(tabs.props.screenOptions).toEqual({ headerShown: false, lazy: false });
  expect((tabs.props.children as { props: { name: string } }[]).map((tab) => tab.props.name)).toEqual(["(today)", "library", "journal", "ask"]);
});

it("orders Today · Saved · Add · Journal · Ask and marks the selected tab with a filled icon in a pill", async () => {
  await mount(1);
  expect(targets().map((t) => t.props.accessibilityLabel)).toEqual(["Today", "Saved", "Add", "Journal", "Ask"]);
  expect(targets()[1].props.accessibilityState).toEqual({ selected: true });
  const icons = renderer!.root.findAllByType("Icon" as React.ElementType).map((icon) => icon.props.name);
  expect(icons).toEqual(["sunny-outline", "bookmark", "add", "book-outline", "chatbubble-ellipses-outline"]);
  const pills = renderer!.root.findAll((node) => String(node.type) === "View" && node.props.style?.[0]?.width === 56);
  expect(pills.map((pill) => pill.props.style[1].backgroundColor)).toEqual(["transparent", "tint", "cocoa", "transparent", "transparent"]);
});

it("gives every tab and the centre Add a target of at least 44×44 around the smaller pill", async () => {
  await mount();
  for (const target of targets()) {
    expect(target.props.style.height).toBeGreaterThanOrEqual(44);
    expect(target.props.style.minWidth).toBeGreaterThanOrEqual(44);
  }
});

it("opens the Add sheet from the centre and describes what it offers before and after birth", async () => {
  await mount();
  expect(targets()[2].props.accessibilityHint).toBe("Save a source, write in your journal, or keep a doctor question");
  await act(async () => targets()[2].props.onPress());
  expect(mock.push).toHaveBeenCalledWith("/add");
  mock.care = true;
  await mount();
  expect(targets()[2].props.accessibilityHint).toBe("Save a source, write, or log care");
});

it("switches tabs, and leaves a second tap on the current tab to its stack", async () => {
  await mount(0);
  await act(async () => targets()[3].props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith("journal", undefined);
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
