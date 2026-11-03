import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Font from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { configuration } from "@/lib/config";
import { LookContext, type LookParts, type LookState } from "@/lib/look-context";
import { LOOKS, LOOK_STORAGE_KEY, lookPreviewEnabled, parseLookLink, resolveLook, type LookId } from "@/lib/looks";
import { lookFonts } from "@/lib/look-fonts";
import { DateBlock, DetailHero, Placeholder, Tape } from "./looks/bits";
import { Entrance, SavedMoment, primeReduceMotion } from "./looks/motion";
import { LookTabBar } from "./looks/tab-bar";
import { TodayMoment } from "./looks/today";

const lookParts: LookParts = { TabBar: LookTabBar, TodayMoment, Entrance, DetailHero, Placeholder, DateBlock, Tape, SavedMoment };
const enabled = lookPreviewEnabled(configuration.environment);
// Keep the splash up while a stored look and its fonts load, so the app never flashes the wrong design.
if (enabled) void SplashScreen.preventAutoHideAsync().catch(() => undefined);

async function loadFonts(id: LookId) {
  const fonts = lookFonts[id];
  if (Object.keys(fonts).length) await Font.loadAsync(fonts).catch(() => undefined);
}

/**
 * Design preview: holds the chosen look, persists it, follows `hafababy://design-preview?look=<id>`, and loads a
 * look's fonts before switching so the previous look stays on screen meanwhile. Production renders `current`
 * immediately and never reads storage, links or fonts.
 */
export function LookProvider({ children }: PropsWithChildren) {
  const [active, setActive] = useState<LookId>("current"), [ready, setReady] = useState(!enabled), requested = useRef<LookId>("current");
  async function choose(id: LookId, persist: boolean) {
    if (!enabled) return;
    requested.current = id;
    await loadFonts(id);
    if (requested.current !== id) return;
    setActive(id);
    if (persist) await (id === "current" ? AsyncStorage.removeItem(LOOK_STORAGE_KEY) : AsyncStorage.setItem(LOOK_STORAGE_KEY, id)).catch(() => undefined);
  }
  useEffect(() => {
    if (!enabled) return;
    const stopMotion = primeReduceMotion();
    let alive = true;
    void (async () => {
      const [stored, initial] = await Promise.all([AsyncStorage.getItem(LOOK_STORAGE_KEY).catch(() => null), Linking.getInitialURL().catch(() => null)]);
      const linked = parseLookLink(initial), id = linked ?? resolveLook(stored, enabled);
      await choose(id, !!linked);
      if (alive) setReady(true);
      void SplashScreen.hideAsync().catch(() => undefined);
    })();
    const subscription = Linking.addEventListener("url", ({ url }) => { const id = parseLookLink(url); if (id) void choose(id, true); });
    return () => { alive = false; subscription.remove(); stopMotion(); };
  }, []);
  const value = useMemo<LookState>(() => ({
    look: LOOKS[active], enabled, setLook: (id) => void choose(id, true), parts: active === "current" ? {} : lookParts,
  }), [active]);
  return <LookContext.Provider value={value}>{ready ? children : null}</LookContext.Provider>;
}
