/**
 * Whether the floating Ask Håfa pill is folded to its icon. Tab lists report their
 * scroll offset: scrolling down folds it, scrolling up or reaching the top unfolds it.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

const TOP = 24;
const STEP = 8;
let collapsed = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const get = () => collapsed;

export function setAskPillCollapsed(next: boolean) {
  if (next === collapsed) return;
  collapsed = next;
  listeners.forEach(listener => listener());
}

export function useAskPillCollapsed(): boolean {
  return useSyncExternalStore(subscribe, get, get);
}

/** Folding decision for one scroll update; null leaves the pill as it is. */
export function askPillCollapseFor(previousY: number, y: number): boolean | null {
  if (y <= TOP) return false;
  if (y - previousY > STEP) return true;
  if (previousY - y > STEP) return false;
  return null;
}

/** `onScroll` for a tab list that sits under the pill. */
export function useAskPillScroll() {
  const last = useRef(0);
  return useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    const next = askPillCollapseFor(last.current, y);
    if (next === null) return;
    last.current = y;
    setAskPillCollapsed(next);
  }, []);
}

/** Tabs whose lists can share the screen with the pill; Grocery rows end in their own controls. */
const ASK_TABS = new Set(['recipes', 'discover', 'planner']);

/** Whether the floating pill belongs on this route (signed-in tab roots except Grocery). */
export function showsAskPill(segments: readonly string[], signedIn: boolean): boolean {
  return signedIn && segments[0] === '(tabs)' && ASK_TABS.has(segments[1] ?? 'recipes');
}
