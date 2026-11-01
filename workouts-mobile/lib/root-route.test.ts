import { it, expect, vi } from "vitest";
const auth = vi.hoisted(() => ({ value: { isLoaded: true, isSignedIn: false } }));
vi.mock("@clerk/expo", () => ({ useAuth: () => auth.value }));
vi.mock("expo-router", () => ({ Redirect: () => null, useLocalSearchParams: () => ({ source: "legacy", session_id: "saved" }) }));
vi.mock("expo-router/unstable-native-tabs", () => ({ NativeTabs: Object.assign(() => null, { Trigger: Object.assign(() => null, { Label: () => null, Icon: () => null }) }) }));
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
it("uses four native tabs in the approved order, with a separate Search role", () => {
  const tabs = Layout();
  // iOS 18's full-width bar must keep its material over the photo grid.
  expect(tabs.props).toMatchObject({ tintColor: "coral", minimizeBehavior: "onScrollDown", disableTransparentOnScrollEdge: true });
  expect(unstable_settings.initialRouteName).toBe("train");
  expect(tabs.props.children.map((tab: { props: any }) => tab.props.name)).toEqual(["train", "library", "discover", "search"]);
  expect(tabs.props.children.map((tab: { props: any }) => tab.props.children[0].props.children)).toEqual(["Today", "Library", "Discover", "Search"]);
  expect(tabs.props.children[3].props.role).toBe("search");
  expect(tabs.props.children.map((tab: { props: any }) => tab.props.children[1].props.sf)).toEqual([
    "figure.run",
    { default: "square.stack", selected: "square.stack.fill" },
    { default: "safari", selected: "safari.fill" },
    "magnifyingglass",
  ]);
});
it("redirects legacy training and capture routes without dropping parameters", () => {
  const params = { source: "legacy", session_id: "saved" };
  expect(LegacyPlan().props.href).toEqual({ pathname: "/(tabs)/train", params });
  expect(LegacyToday().props.href).toEqual({ pathname: "/(tabs)/train", params });
  expect(LegacyProgress().props.href).toEqual({ pathname: "/history-progress", params });
  expect(Capture().props.href).toEqual({ pathname: "/extract", params });
});
