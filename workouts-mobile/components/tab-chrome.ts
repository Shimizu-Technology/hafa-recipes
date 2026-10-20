import { createContext, useContext, useSyncExternalStore } from "react";

/** True for screens rendered inside the main tab navigator (their Screen gets the centered tab header). */
export const TabRootContext = createContext(false);
export function useIsTabRoot() {
  return useContext(TabRootContext);
}

// Height of the floating coach button / Resume bar above the tabs, so tab screens can
// pad their scroll content and the last rows never sit underneath it.
let overlayHeight = 0;
const listeners = new Set<() => void>();
export function setTabOverlayHeight(height: number) {
  const next = Math.max(0, Math.round(height));
  if (next === overlayHeight) return;
  overlayHeight = next;
  listeners.forEach(listener => listener());
}
export function useTabOverlayHeight() {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => overlayHeight,
    () => 0
  );
}
