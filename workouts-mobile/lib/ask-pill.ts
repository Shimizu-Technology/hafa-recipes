/**
 * Shared state for the floating Ask Coach pill: collapsed while the person scrolls down,
 * hidden while a screen needs the space (e.g. Library's selection footer).
 */
import { useSyncExternalStore } from "react";

let state = { collapsed: false, hidden: false };
let lastY = 0;
const listeners = new Set<() => void>();
const set = (next: Partial<typeof state>) => {
  if (Object.entries(next).every(([key, value]) => state[key as keyof typeof state] === value)) return;
  state = { ...state, ...next };
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const get = () => state;

export function useAskPill() { return useSyncExternalStore(subscribe, get, get); }
export function setAskPillHidden(hidden: boolean) { set({ hidden }); }
/** Pass a list's scroll offset: down by more than 8pt collapses the pill; up, or near the top, expands it. */
export function reportAskScroll(y: number) {
  const delta = y - lastY;
  if (y < 24) set({ collapsed: false });
  else if (delta > 8) set({ collapsed: true });
  else if (delta < -8) set({ collapsed: false });
  if (Math.abs(delta) > 8 || y < 24) lastY = y;
}
/** A new screen starts expanded. */
export function resetAskScroll() { lastY = 0; set({ collapsed: false }); }
/** Current state without subscribing (tests, event handlers). */
export const peekAskPill = get;
