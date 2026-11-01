import { it, expect, vi } from "vitest";
const auth = vi.hoisted(() => ({ value: { isLoaded: true, isSignedIn: false } }));
vi.mock("@clerk/expo", () => ({ useAuth: () => auth.value }));
vi.mock("expo-router", () => ({ Redirect: () => null, useLocalSearchParams: () => ({ source: "legacy", session_id: "saved" }) }));
vi.mock("expo-router/js-tabs", () => ({ Tabs: Object.assign(() => null, { Screen: () => null }) }));
vi.mock("@/components/design/tab-bar", () => ({ AppTabBar: "AppTabBar" }));
vi.mock("@/components/ui", () => ({ useColors: () => ({ accent: "coral" }) }));
import Layout, { unstable_settings } from "../app/(tabs)/_layout";
import RootDestination from "../app/index";
import LegacyPlan from "../app/plan";
import LegacyProgress from "../app/progress";
import LegacyToday from "../app/legacy-today";
import Capture from "../app/capture";
it("waits for auth and sends signed-in cold launches to Today", () => {
  auth.value = { isLoaded: true, isSignedIn: false };
  expect(RootDestination()?.props.href).toBe("/sign-in");
  auth.value = { isLoaded: true, isSignedIn: true };
  expect(RootDestination()?.props.href).toBe("/(tabs)/train");
  auth.value = { isLoaded: false, isSignedIn: false };
  expect(RootDestination()).toBeNull();
});
it("draws its own tab bar over Today, Library, Discover and Progress, keeping Search reachable by link", () => {
  const tabs = Layout();
  expect(unstable_settings.initialRouteName).toBe("train");
  expect(tabs.props.screenOptions).toMatchObject({ headerShown: false });
  expect(tabs.props.tabBar({}).type).toBe("AppTabBar");
  expect(tabs.props.children.map((tab: { props: any }) => tab.props.name)).toEqual(["train", "library", "discover", "progress", "search"]);
  expect(tabs.props.children[4].props.options).toEqual({ href: null });
});
it("redirects legacy training and capture routes without dropping parameters", () => {
  const params = { source: "legacy", session_id: "saved" };
  expect(LegacyPlan().props.href).toEqual({ pathname: "/(tabs)/train", params });
  expect(LegacyToday().props.href).toEqual({ pathname: "/(tabs)/train", params });
  expect(LegacyProgress().props.href).toEqual({ pathname: "/history-progress", params });
  expect(Capture().props.href).toEqual({ pathname: "/extract", params });
});
