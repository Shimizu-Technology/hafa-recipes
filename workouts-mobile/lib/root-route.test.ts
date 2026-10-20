import { it, expect, vi } from "vitest";
const auth = vi.hoisted(() => ({ value: { isLoaded: true, isSignedIn: false } }));
vi.mock("@clerk/expo", () => ({ useAuth: () => auth.value }));
vi.mock("expo-router", () => ({ Redirect: () => null, Tabs: Object.assign(() => null, { Screen: () => null }) }));
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


it("shows five Recipes-style destinations while keeping Today routable from Train", () => {
  const screens = Layout().props.children.props.children as Array<{ props: { name: string; options: { title?: string; href?: null } } }>;
  expect(screens.filter(screen => screen.props.options.href !== null).map(screen => screen.props.options.title))
    .toEqual(["Discover", "Library", "Add", "Train", "Progress"]);
  expect(screens.find(screen => screen.props.name === "index")!.props.options.href).toBeNull();
});
