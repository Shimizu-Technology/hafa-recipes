import { it, expect, vi } from "vitest";
const auth = vi.hoisted(() => ({ value: { isLoaded: true, isSignedIn: false } }));
vi.mock("@clerk/expo", () => ({ useAuth: () => auth.value }));
vi.mock("expo-router", () => ({ Redirect: () => null }));
import RootDestination from "../app/index";
it("cold root renders sign-in destination after Clerk resolves instead of shared/undefined", () => {
  auth.value = { isLoaded: true, isSignedIn: false };
  expect(RootDestination()?.props.href).toBe("/sign-in");
});
it("authenticated cold root renders Today via tabs and unresolved authentication never guesses a destination", () => {
  auth.value = { isLoaded: true, isSignedIn: true };
  expect(RootDestination()?.props.href).toBe("/(tabs)");
  auth.value = { isLoaded: false, isSignedIn: false };
  expect(RootDestination()).toBeNull();
});
