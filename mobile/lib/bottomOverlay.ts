/**
 * Placement for app-wide overlays (toasts, the cook timer) near the tab bar.
 *
 * The Håfa tab bar reports its height (bar + home indicator) here; overlays
 * mounted at the root use it while a tab screen is showing.
 */
import { useSyncExternalStore } from 'react';
import { useCookTimerRunning } from '@/contexts/CookTimerRunning';

/** Space between a floating overlay and the chrome below it. */
export const OVERLAY_GAP = 12;
/** Height of the timer pill docked above the tab bar. */
export const DOCKED_TIMER_HEIGHT = 40;

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
  return segments[0] === '(tabs)';
}

/**
 * Distance from the window bottom for a floating overlay. Inside tabs it sits
 * just above the measured tab bar; elsewhere it keeps the screen's own clearance
 * (for example cook mode's step controls).
 */
export function overlayBottom({ inTabs, tabInset, windowInset, clearance, stacked = 0 }: {
  inTabs: boolean;
  tabInset: number;
  windowInset: number;
  clearance: number;
  stacked?: number;
}): number {
  if (inTabs && tabInset > 0) return tabInset + OVERLAY_GAP + stacked;
  return windowInset + clearance + stacked;
}

/** Height of the floating Ask Håfa pill (kept here so lists can clear it without importing UI). */
export const ASK_PILL_HEIGHT = 48;

/**
 * Bottom padding for a tab screen's scroll content. Tab screens end at the top of
 * the opaque tab bar, so only the screen's own spacing, a docked cook timer pill
 * and the floating Ask pill need room for the last row to scroll clear.
 */
export function scrollEndPadding(base: number, timerDocked = false, askPill = false): number {
  return base
    + (timerDocked ? DOCKED_TIMER_HEIGHT + OVERLAY_GAP : 0)
    + (askPill ? ASK_PILL_HEIGHT + OVERLAY_GAP : 0);
}

/** `scrollEndPadding` for a tab screen, with room for a running timer and, where shown, the Ask pill. */
export function useTabScrollEndPadding(base: number, { askPill = false }: { askPill?: boolean } = {}): number {
  return scrollEndPadding(base, useCookTimerRunning(), askPill);
}

export type CookTimerPlacement = 'hidden' | 'dock' | 'top';

/** Where the running cook timer shows: docked above the tab bar, or under the header elsewhere. */
export function cookTimerPlacement({ running, inTabs }: { running: boolean; inTabs: boolean }): CookTimerPlacement {
  if (!running) return 'hidden';
  return inTabs ? 'dock' : 'top';
}
