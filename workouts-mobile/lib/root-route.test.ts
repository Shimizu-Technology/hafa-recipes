import { it, expect, vi } from "vitest";
const auth = vi.hoisted(() => ({ value: { isLoaded: true, isSignedIn: false } }));
vi.mock("@clerk/expo", () => ({ useAuth: () => auth.value }));
vi.mock("expo-router", () => ({ Redirect: () => null, useLocalSearchParams: () => ({ source: "legacy" }), Tabs: Object.assign(() => null, { Screen: () => null }) }));
vi.mock("@/components/ui", () => ({ TabIcon: () => null, AddTabIcon: () => null, useColors: () => ({}) }));
vi.mock("@/components/workouts-tab-bar", () => ({ WorkoutsTabBar: () => null }));
import Layout from "../app/(tabs)/_layout";
import RootDestination from "../app/index";
it("cold root renders sign-in destination after Clerk resolves instead of shared/undefined", () => {
  auth.value = { isLoaded: true, isSignedIn: false };
  expect(RootDestination()?.props.href).toBe("/sign-in");
});
it("authenticated cold root opens the saved-workout Library and unresolved authentication never guesses a destination", () => {
  auth.value = { isLoaded: true, isSignedIn: true };
  expect(RootDestination()?.props.href).toBe("/(tabs)/library");
  auth.value = { isLoaded: false, isSignedIn: false };
  expect(RootDestination()).toBeNull();
});


it("shows four destinations and keeps legacy routes hidden", () => {
  const screens = Layout().props.children.props.children as Array<{ props: { name: string; options: { title?: string; href?: null } } }>;
  expect(screens.filter(screen => screen.props.options.href !== null).map(screen => screen.props.options.title))
    .toEqual(["Discover", "Library", "Add", "Train"]);
  expect(screens.find(screen => screen.props.name === "index")!.props.options.href).toBeNull();
});

import LegacyPlan from "../app/(tabs)/plan";
import LegacyProgress from "../app/(tabs)/progress";
import LegacyToday from "../app/(tabs)/index";
it("redirects legacy routes with their parameters", () => {
  expect(LegacyPlan().props.href).toEqual({ pathname: "/(tabs)/train", params: { source: "legacy" } });
  expect(LegacyToday().props.href).toEqual({ pathname: "/(tabs)/train", params: { source: "legacy" } });
  expect(LegacyProgress().props.href).toEqual({ pathname: "/history-progress", params: { source: "legacy" } });
});
it("announces the visible tab positions out of four", () => {
  const screens = Layout().props.children.props.children;
  expect(screens.filter((s: any) => s.props.options.href !== null).map((s: any) => s.props.options.tabBarAccessibilityLabel))
    .toEqual(["Discover, tab, 1 of 4", "Library, tab, 2 of 4", "Add a workout, tab, 3 of 4", "Train, tab, 4 of 4"]);
});
