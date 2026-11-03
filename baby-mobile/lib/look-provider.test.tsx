import React, { useContext } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  env: "development" as string, storage: new Map<string, string>(), initialUrl: null as string | null,
  listener: null as null | ((event: { url: string }) => void), fontLoads: [] as string[][],
}));
vi.mock("react-native", () => ({
  Linking: {
    getInitialURL: async () => mock.initialUrl,
    addEventListener: (_: string, fn: (event: { url: string }) => void) => { mock.listener = fn; return { remove() { mock.listener = null; } }; },
  },
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
  useColorScheme: () => "light",
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: async (key: string) => mock.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { mock.storage.set(key, value); },
  removeItem: async (key: string) => { mock.storage.delete(key); },
} }));
vi.mock("expo-font", () => ({ loadAsync: async (fonts: Record<string, number>) => { mock.fontLoads.push(Object.keys(fonts)); } }));
vi.mock("expo-splash-screen", () => ({ preventAutoHideAsync: async () => {}, hideAsync: async () => {} }));
vi.mock("@/lib/config", () => ({ configuration: { get environment() { return mock.env; } } }));
vi.mock("@/lib/look-context", () => import("./look-context"));
vi.mock("@/lib/looks", () => import("./looks"));
vi.mock("@/lib/look-fonts", () => ({ lookFonts: { current: {}, soft: { Newsreader_500Medium: 1, DMSans_400Regular: 2 },
  scrapbook: { YoungSerif_400Regular: 3 }, warm: { Fraunces_600SemiBold: 4 } } }));
vi.mock("../components/looks/bits", () => ({ DateBlock: "DateBlock", DetailHero: "DetailHero", Placeholder: "Placeholder", Tape: "Tape" }));
vi.mock("../components/looks/motion", () => ({ Entrance: "Entrance", SavedMoment: "SavedMoment", primeReduceMotion: () => () => {} }));
vi.mock("../components/looks/tab-bar", () => ({ LookTabBar: "LookTabBar" }));
vi.mock("../components/looks/today", () => ({ TodayMoment: "TodayMoment" }));

import type { LookState } from "./look-context";

let seen: LookState | null = null;
async function mount() {
  vi.resetModules();
  const { LookProvider } = await import("../components/look-provider");
  // The provider's own module instance of the context, after the reset.
  const { LookContext } = await import("@/lib/look-context");
  function Probe() { seen = useContext(LookContext); return null; }
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => { tree = create(<LookProvider><Probe /></LookProvider>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return tree!;
}
beforeEach(() => { mock.env = "development"; mock.storage.clear(); mock.initialUrl = null; mock.listener = null; mock.fontLoads = []; seen = null; });
afterEach(() => { vi.resetModules(); });

it("starts on current with no choice saved, and supplies no look parts", async () => {
  await mount();
  expect(seen!.look.id).toBe("current");
  expect(seen!.enabled).toBe(true);
  expect(seen!.parts).toEqual({});
});

it("persists a chosen look, loads its fonts first, and restores it on the next launch", async () => {
  await mount();
  await act(async () => { seen!.setLook("soft"); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(seen!.look.id).toBe("soft");
  expect(mock.fontLoads).toContainEqual(["Newsreader_500Medium", "DMSans_400Regular"]);
  expect(mock.storage.get("@hafa/look-preview")).toBe("soft");
  expect(Object.keys(seen!.parts)).toContain("TabBar");
  seen = null;
  await mount();
  expect(seen!.look.id).toBe("soft");
  // Choosing current clears the stored choice.
  await act(async () => { seen!.setLook("current"); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(mock.storage.has("@hafa/look-preview")).toBe(false);
});

it("follows the design-preview deep link at launch and while open", async () => {
  mock.initialUrl = "hafababy://design-preview?look=warm";
  await mount();
  expect(seen!.look.id).toBe("warm");
  expect(mock.storage.get("@hafa/look-preview")).toBe("warm");
  await act(async () => { mock.listener!({ url: "hafababy://design-preview?look=scrapbook" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(seen!.look.id).toBe("scrapbook");
  await act(async () => { mock.listener!({ url: "hafababy://oauth-callback?look=soft" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(seen!.look.id).toBe("scrapbook");
  await act(async () => { mock.listener!({ url: "hafababy://design-preview?look=current" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(seen!.look.id).toBe("current");
});

it("ignores stored choices, links and setLook in production builds", async () => {
  mock.env = "production";
  mock.storage.set("@hafa/look-preview", "soft");
  mock.initialUrl = "hafababy://design-preview?look=warm";
  await mount();
  expect(seen!.enabled).toBe(false);
  expect(seen!.look.id).toBe("current");
  expect(mock.listener).toBeNull();
  await act(async () => { seen!.setLook("scrapbook"); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(seen!.look.id).toBe("current");
  expect(mock.fontLoads).toEqual([]);
});
