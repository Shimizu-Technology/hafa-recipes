import { Platform } from "react-native";
import type { EventSubscription } from "expo-modules-core";
export interface WatchBridge {
  setPlans(json: string): Promise<void>;
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
