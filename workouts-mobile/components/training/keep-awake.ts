import { useEffect } from "react";
// Installed and natively linked through `expo` (SDK 57); declare it directly at the next dependency-lock review.
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

/** Keeps the screen on while `active`, so a timed clock stays visible and its cues fire with the phone set down. */
export function useKeepAwakeWhile(active: boolean, tag: string) {
  useEffect(() => {
    if (!active) return;
    void activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => { void deactivateKeepAwake(tag).catch(() => undefined); };
  }, [active, tag]);
}
