/**
 * Placement for app-wide overlays (toasts) above the tab bar.
 *
 * The JS tab bar reports its measured height (bar + home indicator) here;
 * overlays mounted at the root use it while a tab screen is showing.
 */
import { useSyncExternalStore } from "react";

/** Space between a floating overlay and the chrome below it. */
export const OVERLAY_GAP = 12;

let tabScreenBottomInset = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getInset = () => tabScreenBottomInset;

/** Record the tab bar's height including the home indicator. */
export function reportTabScreenBottomInset(bottom: number) {
  if (!(bottom > 0) || bottom === tabScreenBottomInset) return;
  tabScreenBottomInset = bottom;
  listeners.forEach((listener) => listener());
}

export function useTabScreenBottomInset(): number {
  return useSyncExternalStore(subscribe, getInset, getInset);
}

/** The tab bar is on screen whenever the root route is the tab group. */
export function isTabRoute(segments: readonly string[]): boolean {
  return segments[0] === "(tabs)";
}

/** Distance from the window bottom: just above the measured tab bar in tabs, else the screen's own clearance. */
export function overlayBottom({ inTabs, tabInset, windowInset, clearance }: {
  inTabs: boolean; tabInset: number; windowInset: number; clearance: number;
}): number {
  return inTabs && tabInset > 0 ? tabInset + OVERLAY_GAP : windowInset + clearance;
}
