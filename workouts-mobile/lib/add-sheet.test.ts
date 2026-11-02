import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getRoutes } from "expo-router/build/getRoutesCore";
import { getReactNavigationConfig } from "expo-router/build/getReactNavigationConfig";
import { getStateFromPath } from "expo-router/build/react-navigation/core/getStateFromPath";
import { StackRouter, StackActions, type StackNavigationState } from "expo-router/build/react-navigation/routers/StackRouter";
import type { RequireContext } from "expo-router/build/types";
const f = vi.hoisted(() => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn(), canGoBack: vi.fn(), os: "ios" }));
vi.mock("react-native", () => ({ ScrollView: "ScrollView", Platform: { get OS() { return f.os; } } }));
vi.mock("expo-router", () => ({ router: { replace: f.replace, back: f.back, push: f.push, canGoBack: f.canGoBack } }));
vi.mock("@/components/ui", () => ({ Copy: "Copy", IconButton: "IconButton", Row: "Row", ListGroup: "ListGroup", ListRow: "ListRow", useColors: () => ({ groupedBackground: "grouped" }) }));
// Import the real root linking settings without bootstrapping device/auth services.
vi.mock("@/components/reminders-provider", () => ({}));
vi.mock("@/lib/sharing", () => ({}));
vi.mock("expo-share-intent", () => ({}));
vi.mock("@/components/share-capture", () => ({}));
vi.mock("@/components/native-share-session", () => ({}));
vi.mock("@/lib/private-device", () => ({}));
vi.mock("@clerk/expo", () => ({}));
vi.mock("@clerk/expo/token-cache", () => ({}));
vi.mock("react-native-safe-area-context", () => ({}));
vi.mock("expo-status-bar", () => ({}));
vi.mock("@/lib/config", () => ({}));
vi.mock("@/lib/context", () => ({}));
vi.mock("@/components/logout-recovery-boundary", () => ({}));
vi.mock("@/components/signup-gate", () => ({}));
vi.mock("@/components/account-identity", () => ({}));
vi.mock("@/lib/logout-recovery-native", () => ({}));
vi.mock("@/lib/logout-recovery", () => ({}));
import { unstable_settings } from "../app/_layout";
import { unstable_settings as tabSettings } from "../app/(tabs)/_layout";
vi.mock("expo-router/js-tabs", () => ({}));
vi.mock("@/components/design/tab-bar", () => ({}));
import Add from "../app/add";
const navigation = StackRouter({ initialRouteName: "(tabs)" });
const config = { routeNames: ["(tabs)", "add", "extract", "capture", "add-workout", "build-plan"], routeParamList: {}, routeGetIdList: {} };
let state: StackNavigationState<Record<string, object | undefined>>;
function dispatch(action: Parameters<typeof navigation.getStateForAction>[1]) {
  state = navigation.getStateForAction(state, action, config) as typeof state ?? state;
}
function coldAdd() {
  const modules: Record<string, object> = {
    "./_layout.tsx": { default: () => null, unstable_settings },
    "./(tabs)/_layout.tsx": { default: () => null, unstable_settings: tabSettings },
    "./(tabs)/train.tsx": { default: () => null },
    ...Object.fromEntries(config.routeNames.filter(name => name !== "(tabs)").map(name => [`./${name}.tsx`, { default: () => null }])),
  };
  const context = Object.assign((key: string) => modules[key], { keys: () => Object.keys(modules) }) as RequireContext;
  const routes = getRoutes(context, { skipGenerated: true, getSystemRoute: () => { throw Error("Unexpected system route"); } })!;
  const linking = getReactNavigationConfig(routes, true);
  // React Navigation's core parser needs Expo's pathless group normalized.
  const tabs = linking.screens["(tabs)"];
  if (typeof tabs === "object") tabs.path = "";
  const parsed = getStateFromPath("/add", linking)!;
  return navigation.getRehydratedState({ ...parsed, type: "stack" }, config);
}
const routeNames = () => state.routes.map(route => route.name);
let tree: ReactTestRenderer;
let frames: FrameRequestCallback[];
beforeEach(() => {
  vi.clearAllMocks(); f.os = "ios"; frames = [];
  state = coldAdd();
  f.canGoBack.mockImplementation(() => state.index > 0);
  f.back.mockImplementation(() => dispatch({ type: "GO_BACK" }));
  f.push.mockImplementation((href: string) => dispatch(StackActions.push(href.slice(1))));
  f.replace.mockImplementation((href: string) => dispatch(StackActions.replace(href === "/(tabs)/train" ? "(tabs)" : href.slice(1))));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
});
afterEach(async () => { if (tree) await act(() => tree.unmount()); vi.unstubAllGlobals(); });
const choices = [
  ["Paste a link", "/extract"], ["Record/upload", "/capture"], ["Build a workout", "/add-workout"],
  ["Import a plan", "/extract"], ["Build a plan", "/build-plan"],
] as const;
it.each(choices)("dismisses the native sheet before opening %s", async (label, path) => {
  await act(() => { tree = create(createElement(Add)); });
  const row = tree.root.findAllByType("ListRow" as any).find(row => row.props.title === label)!;
  await act(() => row.props.onPress());
  expect(routeNames()).toEqual(["(tabs)"]);
  expect(f.back).toHaveBeenCalledOnce();
  expect(f.push).not.toHaveBeenCalled();
  await act(() => frames[0](0));
  expect(f.push).toHaveBeenCalledExactlyOnceWith(path);
  expect(routeNames()).toEqual(["(tabs)", path.slice(1)]);
  expect(f.replace).not.toHaveBeenCalled();
  await act(() => row.props.onPress());
  expect(f.back).toHaveBeenCalledOnce();
});
it("replaces the regular web route without retaining an Add page in history", async () => {
  f.os = "web";
  await act(() => { tree = create(createElement(Add)); });
  await act(() => tree.root.findAllByType("ListRow" as any)[0].props.onPress());
  expect(f.replace).toHaveBeenCalledExactlyOnceWith("/extract");
  expect(f.back).not.toHaveBeenCalled();
  expect(routeNames()).toEqual(["(tabs)", "extract"]);
});
it("provides an in-content close action where Android sheets have no native header", async () => {
  f.os = "android";
  await act(() => { tree = create(createElement(Add)); });
  await act(() => tree.root.findByType("IconButton" as any).props.onPress());
  expect(f.back).toHaveBeenCalledOnce();
});


it("anchors a cold Add deep link above Today so Close returns to the tabs", async () => {
  expect(routeNames()).toEqual(["(tabs)", "add"]);
  expect(tabSettings.initialRouteName).toBe("train");
  f.os = "android";
  await act(() => { tree = create(createElement(Add)); });
  await act(() => tree.root.findByType("IconButton" as any).props.onPress());
  expect(routeNames()).toEqual(["(tabs)"]);
  expect(state.index).toBe(0);
});
it("Close replaces an unanchored Add route with Today when back is unavailable", async () => {
  state = navigation.getRehydratedState({ stale: true, routes: [{ name: "add" }] }, config);
  f.os = "android";
  await act(() => { tree = create(createElement(Add)); });
  await act(() => tree.root.findByType("IconButton" as any).props.onPress());
  expect(f.replace).toHaveBeenCalledExactlyOnceWith("/(tabs)/train");
  expect(routeNames()).toEqual(["(tabs)"]);
});
it("replaces an unanchored native Add route when choosing a flow", async () => {
  state = navigation.getRehydratedState({ stale: true, routes: [{ name: "add" }] }, config);
  await act(() => { tree = create(createElement(Add)); });
  await act(() => tree.root.findAllByType("ListRow" as any)[0].props.onPress());
  expect(routeNames()).toEqual(["extract"]);
  expect(frames).toHaveLength(0);
});
