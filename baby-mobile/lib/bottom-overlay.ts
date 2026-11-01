/**
 * Placement for app-wide overlays (toasts) near the tab bar.
 *
 * The JS tab bar reports its measured height (bar + home indicator) here; overlays
 * mounted at the root use it while a tab screen is showing.
 */
import { useSyncExternalStore } from "react";

/** Space between a floating overlay and the chrome below it. */
export const OVERLAY_GAP = 12;

let tabBarHeight = 0;
/** Docked footers (the Ask composer, selection bars) on focused screens, by owner. */
const dockedFooters = new Map<object, number>();
let dockedFooterHeight = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const notify = () => listeners.forEach((listener) => listener());
const getInset = () => tabBarHeight;

/** Record the tab bar's height from the window bottom (bar + home indicator). */
export function reportTabBarHeight(height: number) {
  if (!(height > 0) || height === tabBarHeight) return;
  tabBarHeight = height;
  notify();
}

export function useTabBarHeight(): number {
  return useSyncExternalStore(subscribe, getInset, getInset);
}

/**
 * Record a focused screen's docked footer height, measured up from the bottom of that screen,
 * so toasts clear it. Pass 0 (or unmount) when it hides, blurs, or rides the keyboard.
 */
export function reportDockedFooter(owner: object, height: number) {
  if (height > 0) dockedFooters.set(owner, height);
  else dockedFooters.delete(owner);
  const next = Math.max(0, ...dockedFooters.values());
  if (next === dockedFooterHeight) return;
  dockedFooterHeight = next;
  notify();
}

/** Height of the tallest docked footer on a focused screen, or 0. */
export const getDockedFooterHeight = () => dockedFooterHeight;

export function useDockedFooterHeight(): number {
  return useSyncExternalStore(subscribe, getDockedFooterHeight, getDockedFooterHeight);
}

/** The tab bar is on screen whenever the root route is the tab group. */
export function isTabRoute(segments: readonly string[]): boolean {
  return segments[0] === "(tabs)";
}

/**
 * Distance from the window bottom: just above the tab bar in tabs, else the screen's own
 * clearance, and always above a docked footer such as the Ask composer. Tab screens end at
 * the top of the bar, so their footer stacks on it; elsewhere it is measured from the window.
 */
export function overlayBottom({ inTabs, tabInset, windowInset, clearance, footer = 0 }: {
  inTabs: boolean; tabInset: number; windowInset: number; clearance: number; footer?: number;
}): number {
  if (inTabs && tabInset > 0) return tabInset + Math.max(0, footer) + OVERLAY_GAP;
  const base = windowInset + clearance;
  return footer > 0 ? Math.max(base, footer + OVERLAY_GAP) : base;
}
