import { requireOptionalNativeModule } from "expo-modules-core";
export interface NativeShare {
  token: string;
  url?: string;
  text?: string;
  files: { path: string; fileName: string; mimeType: string }[];
}
const bridge = requireOptionalNativeModule<{
  pending(): Promise<NativeShare | null>;
  acknowledge(token: string): boolean;
  clear(): void;
}>("HafaBabyShare");
export const nativeSharingAvailable = !!bridge;
export const pendingShare = () => bridge?.pending() ?? Promise.resolve(null);
export const acknowledgeShare = (token: string) => bridge?.acknowledge(token) ?? false;
export const clearPendingShares = () => bridge?.clear();
