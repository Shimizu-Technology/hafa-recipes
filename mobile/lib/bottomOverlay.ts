/**
 * Placement for app-wide overlays (toasts, the cook timer) near the native tab bar.
 *
 * JS can't measure the native tab bar, but each tab screen's own safe area
 * already includes it (and the iOS 26 bottom accessory). Tab stacks report that
 * inset here; overlays mounted at the root use it while a tab screen is showing.
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { useCookTimerRunning } from '@/contexts/CookTimerRunning';

/** Space between a floating overlay and the chrome below it. */
export const OVERLAY_GAP = 12;
/** Height of the timer pill docked above the tab bar where no native accessory exists. */
export const DOCKED_TIMER_HEIGHT = 40;

let tabScreenBottomInset = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const getInset = () => tabScreenBottomInset;

/** Record the focused tab screen's bottom safe-area inset (tab bar + home indicator). */
export function reportTabScreenBottomInset(bottom: number) {
  if (!(bottom > 0) || bottom === tabScreenBottomInset) return;
  tabScreenBottomInset = bottom;
  listeners.forEach((listener) => listener());
}

export function useTabScreenBottomInset(): number {
  return useSyncExternalStore(subscribe, getInset, getInset);
}

/** The native tab bar is on screen whenever the root route is the tab group. */
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

/**
 * Bottom padding for a tab screen's scroll content. On iOS the native tab bar and
 * home indicator come from `contentInsetAdjustmentBehavior="automatic"`; that prop
 * is iOS-only, so other platforms add the safe-area inset themselves. A docked
 * cook timer pill also needs room so the last row can scroll clear of it.
 */
export function scrollEndPadding(safeAreaBottom: number, base: number, timerDocked = false): number {
  const timer = timerDocked ? DOCKED_TIMER_HEIGHT + OVERLAY_GAP : 0;
  return (Platform.OS === 'ios' ? base : safeAreaBottom + base) + timer;
}

/** `scrollEndPadding` for a tab screen, with room for the docked timer pill where there's no native accessory. */
export function useTabScrollEndPadding(safeAreaBottom: number, base: number): number {
  const running = useCookTimerRunning();
  const docked = cookTimerPlacement({ running, inTabs: true, supportsAccessory: supportsTabBottomAccessory }) === 'dock';
  return scrollEndPadding(safeAreaBottom, base, docked);
}

export type CookTimerPlacement = 'hidden' | 'accessory' | 'dock' | 'top';

/**
 * Where the running cook timer shows: the native bottom accessory on iOS 26 tabs,
 * a pill docked above older tab bars, or the top pill on screens without tabs.
 */
export function cookTimerPlacement({ running, inTabs, supportsAccessory }: {
  running: boolean;
  inTabs: boolean;
  supportsAccessory: boolean;
}): CookTimerPlacement {
  if (!running) return 'hidden';
  if (!inTabs) return 'top';
  return supportsAccessory ? 'accessory' : 'dock';
}

/** `NativeTabs.BottomAccessory` exists on iOS 26 and later only. */
export const supportsTabBottomAccessory = Platform.OS === 'ios'
  && Number.parseInt(String(Platform.Version), 10) >= 26;
