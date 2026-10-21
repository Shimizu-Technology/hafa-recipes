import { requireOptionalNativeModule } from "expo-modules-core";
export interface ShareSession {
  credential_id: string;
  token: string;
  generation: number;
  auto_process_epoch?: number;
  expires_at: string;
}
export interface NativeShare {
  token: string;
  capture_id: string;
  record_id: string;
  occurred_at: string;
  automatic_epoch?: number;
  scope?: string;
  status?: "saved" | "deferred" | "queued";
  import_id?: string;
  url?: string;
  text?: string;
  files: { path: string; fileName: string; mimeType: string }[];
}
const bridge = requireOptionalNativeModule<{
  pending(): Promise<NativeShare | null>;
  acknowledge(token: string): boolean;
  clear(): void;
  installationId(): Promise<string>;
  configureSession(token: string, base: string, expires: string, owner: string, generation: number, automaticEpoch: number): Promise<void>;
  sessionOwner(): Promise<string | null>;
  clearSession(preserveUnassigned: boolean): Promise<void>;
}>("HafaBabyShare");
export const nativeSharingAvailable = !!bridge;
export const pendingShare = () => bridge?.pending() ?? Promise.resolve(null);
export const acknowledgeShare = (token: string) => bridge?.acknowledge(token) ?? false;
export const clearPendingShares = () => bridge?.clear();
export const installationId = () => bridge?.installationId() ?? Promise.reject(Error("Native sharing unavailable"));
export const sessionOwner = () => bridge?.sessionOwner() ?? Promise.resolve(null);
export const clearSession = (preserveUnassigned = false) => bridge?.clearSession(preserveUnassigned) ?? Promise.resolve();
export const configureSession = (session: ShareSession, base: string, owner: string) =>
  bridge?.configureSession(session.token, base, session.expires_at, owner, session.generation, session.auto_process_epoch ?? 0) ?? Promise.resolve();
