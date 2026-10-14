import * as Share from "@/modules/hafa-workouts-share/src";
import type { drafts } from "./drafts";
let mutations: Promise<unknown> = Promise.resolve();
export function serializeShare<R>(operation: () => Promise<R>): Promise<R> {
  const next = mutations.catch(() => undefined).then(operation); mutations = next;
  return next;
}
/** Retire every in-flight registration before awaiting native I/O. */
export function revokeNativeSharing() { preferenceVersion++; return serializeShare(Share.clearSession); }
export const nativeShareVisibilityKey = "native-share-public";
const preferenceListeners = new Set<() => void>();
let preferenceVersion = 0;
let authSession: string | null | undefined;
let suspended = false;
let suspension = 0;
export const nativeSharePreferenceVersion = () => preferenceVersion;
export const nativeSharingSuspended = () => suspended;
export const refreshNativeSharing = () => preferenceListeners.forEach(listener => listener());
/** A changed authenticated session can resume; a rerender of the pending sign-out session cannot. */
export function observeNativeShareAuthSession(binding: string | null) {
  if (authSession === binding) return false;
  authSession = binding; suspended = binding === null; suspension++; preferenceVersion++;
  return true;
}
export function suspendNativeSharing() {
  const lease = ++suspension, binding = authSession;
  suspended = true;
  return { clear: revokeNativeSharing(), resume() {
    if (lease !== suspension || binding !== authSession) return;
    suspended = false; suspension++; preferenceVersion++;
    refreshNativeSharing();
  } };
}
export function subscribeNativeSharePreference(listener: () => void) {
  preferenceListeners.add(listener); return () => { preferenceListeners.delete(listener); };
}
export async function setNativeShareVisibility(storage: ReturnType<typeof drafts>, owner: string, isPublic: boolean, guard: () => void) {
  guard(); preferenceVersion++; await revokeNativeSharing(); guard();
  await storage.save(owner, nativeShareVisibilityKey, isPublic); guard();
  refreshNativeSharing();
}

/** Fence native registration throughout a consent mutation, including an uncertain response. */
export async function updateNativeSharingConsent<T>(change: () => Promise<T>): Promise<T> {
  const sharing = suspendNativeSharing();
  try { await sharing.clear; return await change(); }
  finally { sharing.resume(); }
}
