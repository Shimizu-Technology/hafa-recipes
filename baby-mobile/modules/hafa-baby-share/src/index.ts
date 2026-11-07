import { requireOptionalNativeModule } from "expo-modules-core";
export interface ShareSession {
  credential_id: string;
  token: string;
  generation: number;
  auto_process_epoch?: number;
  expires_at: string;
  /** Where its captures go. Only with the API's family stack on. */
  space_id?: string;
}
export interface NativeShare {
  token: string;
  capture_id: string;
  record_id: string;
  occurred_at: string;
  automatic_epoch?: number;
  scope?: string;
  status?: "saved" | "deferred" | "queued";
  /** Someone said this one, shared under no account, was theirs. It never counts as permission for AI. */
  claimed?: boolean;
  blocked?: "unreadable";
  import_id?: string;
  url?: string;
  text?: string;
  files: { path: string; fileName: string; mimeType: string }[];
}
/** A share kept on this phone under no account. Enough to recognize it, and no more. */
export interface WaitingShare {
  token: string;
  kind: "link" | "photo" | "video" | "audio" | "pdf" | "file" | "text";
  count: number;
  host?: string;
  shared_at: string;
  kept_until: string;
  /** Why the app can never take this one. */
  blocked?: "file_too_large" | "unsupported_file" | "unreadable";
}
const bridge = requireOptionalNativeModule<{
  noteSignedIn(): Promise<void>;
  pending(): Promise<NativeShare | null>;
  acknowledge(token: string): boolean;
  clear(keepWaiting: boolean, recoveringOwner: string | null): void;
  installationId(): Promise<string>;
  configureSession(token: string, base: string, expires: string, owner: string, generation: number, automaticEpoch: number, destination: string | null): Promise<void>;
  sessionOwner(): Promise<string | null>;
  clearSession(preserveUnassigned: boolean): Promise<void>;
  removalShareCount(): Promise<number>;
  waitingShareCount(): Promise<number>;
  waitingShares(owner: string): Promise<WaitingShare[]>;
  returnClaim(token: string, owner: string): Promise<boolean>;
  claimShare(token: string, owner: string, generation: number): Promise<"claimed" | "expired" | "refused">;
  discardShare(token: string): Promise<boolean>;
  blockShare(token: string, reason: string): Promise<boolean>;
  blockedShares(owner: string): Promise<WaitingShare[]>;
  removeBlockedShare(token: string, owner: string): Promise<boolean>;
}>("HafaBabyShare");
export const nativeSharingAvailable = !!bridge;
/** Lets the share sheet tell a sign-in that hasn't connected yet from being signed out. Clearing the session clears it. */
export const noteSignedIn = () => bridge?.noteSignedIn() ?? Promise.resolve();
export const pendingShare = () => bridge?.pending() ?? Promise.resolve(null);
export const acknowledgeShare = (token: string) => bridge?.acknowledge(token) ?? false;
/** `keepWaiting` keeps what was shared under no account, for when only this account's own data is going. */
export const clearPendingShares = (keepWaiting = false, recoveringOwner: string | null = null) => bridge?.clear(keepWaiting, recoveringOwner);
export const installationId = () => bridge?.installationId() ?? Promise.reject(Error("Native sharing unavailable"));
export const sessionOwner = () => bridge?.sessionOwner() ?? Promise.resolve(null);
export const clearSession = (preserveUnassigned = false) => bridge?.clearSession(preserveUnassigned) ?? Promise.resolve();
export const removalShareCount = () => bridge?.removalShareCount() ?? Promise.resolve(0);
export const waitingShareCount = () => bridge?.waitingShareCount() ?? Promise.resolve(0);
export const waitingShares = (owner: string) => bridge?.waitingShares(owner) ?? Promise.resolve([]);
export const claimShare = (token: string, owner: string, generation: number) => bridge?.claimShare(token, owner, generation) ?? Promise.resolve("refused" as const);
export const discardShare = (token: string) => bridge?.discardShare(token) ?? Promise.resolve(false);
export const blockShare = (token: string, reason: string) => bridge?.blockShare(token, reason) ?? Promise.resolve(false);
export const blockedShares = (owner: string) => bridge?.blockedShares(owner) ?? Promise.resolve([]);
export const removeBlockedShare = (token: string, owner: string) => bridge?.removeBlockedShare(token, owner) ?? Promise.resolve(false);
/** `destination` is `personal` or a family's id. None names no destination, as with the API's family flag off. */
export const configureSession = (session: ShareSession, base: string, owner: string, destination: string | null = null) =>
  bridge?.configureSession(session.token, base, session.expires_at, owner, session.generation, session.auto_process_epoch ?? 0, destination) ?? Promise.resolve();

export const returnClaim = (token: string, owner: string) => bridge?.returnClaim(token, owner) ?? Promise.resolve(false);
