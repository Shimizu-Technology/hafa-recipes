import { createContext, useContext } from 'react';

// A separate boolean so tab chrome and lists re-render only when a timer starts or stops, not every tick.
export const CookTimerRunningContext = createContext(false);

/** True while a cook timer is counting outside cook mode. */
export function useCookTimerRunning() {
  return useContext(CookTimerRunningContext);
}
