import { Platform } from "react-native";
import type { EventSubscription } from "expo-modules-core";
export interface WatchBridge {
  setPlans(json: string): Promise<void>;
  clearPlans(): Promise<void>;
  purgeResults(owner: string, account?: string): Promise<void>;
  pendingResults(): Promise<string[]>;
  markImported(id: string): Promise<void>;
  addListener(event: "onResults", listener: () => void): EventSubscription;
}
export async function nativeWatchBridge(): Promise<WatchBridge | null> {
  if (Platform.OS !== "ios") return null;
  try {
    const { requireOptionalNativeModule } = await import("expo-modules-core");
    return requireOptionalNativeModule<WatchBridge>("HafaWatch");
  } catch { return null; }
}

/** Sign-out keeps unimported results for the same application account's return. */
let plansEpoch = 0;
export const watchPlansEpoch = () => plansEpoch;
export async function clearWatchPlans() { plansEpoch++; await (await nativeWatchBridge())?.clearPlans(); }

// Cleanup invalidates in-flight passes. Only a failed sign-out explicitly resumes the mounted account.
let resyncToken = 0;
const resyncListeners = new Set<() => void>();
export const watchResyncToken = () => resyncToken;
export function subscribeWatchResync(listener: () => void) {
  resyncListeners.add(listener);
  return () => { resyncListeners.delete(listener); };
}
export function resumeWatchSync() { resyncToken++; resyncListeners.forEach(listener => listener()); }
