import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import * as ShareBridge from '@/modules/hafa-share-bridge/src';
import { api, API_BASE_URL } from '@/lib/api';
import { useCurrentUserIdentity } from './useRecipes';
import { saveShareScopeOwner } from '@/lib/importInbox';

export const SHARE_SESSION_KEY = '@hafa/share-session-owner/v1';
type SessionOwner = { ownerId: string; subject: string; accountScopeId: string; expiresAt: string };
// Native writes must serialize across effect generations, including an account
// change while a previous configureSession is awaiting the native bridge.
let nativeMutations: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = nativeMutations.then(operation);
  nativeMutations = next.catch(() => undefined);
  return next;
}
async function readOwner(): Promise<SessionOwner | null> {
  const raw = await AsyncStorage.getItem(SHARE_SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as SessionOwner; } catch { return null; }
}
async function clearOwner() {
  await ShareBridge.clearSession(true);
  await AsyncStorage.removeItem(SHARE_SESSION_KEY);
}

/** The extension receives an expiring share-only capability, never a Clerk token. */
export function useShareSession() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const identity = useCurrentUserIdentity(Boolean(isSignedIn));
  const ownerId = isSignedIn ? identity.data?.id : null;
  const active = useRef({ ownerId, subject: userId, signedIn: Boolean(isSignedIn) });
  active.current = { ownerId, subject: userId, signedIn: Boolean(isSignedIn) };
  useEffect(() => {
    if (Platform.OS !== 'ios' || !isLoaded) return;
    let cancelled = false;
    let syncing = false;
    const current = () => !cancelled && active.current.ownerId === ownerId && active.current.subject === userId;
    const sync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const provision = await serialize(async () => {
          if (!current()) return false;
          const saved = await readOwner();
          if (!current()) return false;
          if (!isSignedIn) {
            await clearOwner();
            return false;
          }
          // A different Clerk subject must lose the old capability even while
          // its stable application identity is still being resolved.
          if (saved && (saved.subject !== userId || (ownerId && saved.ownerId !== ownerId))) {
            await clearOwner();
            if (!current()) return false;
          }
          if (!ownerId || !userId) return false;
          // A healthy 30-day capability remains usable offline. Refresh near
          // expiry without revoking the existing capability first.
          return !(saved?.ownerId === ownerId && saved.subject === userId &&
            Date.parse(saved.expiresAt) - Date.now() > 24 * 60 * 60 * 1000);
        });
        if (!provision || !current() || !ownerId || !userId) return;
        const installationId = await ShareBridge.getInstallationId();
        if (!current()) return;
        const credential = await api.createShareCredential({
          installation_id: installationId, location: 'Guam', is_public: false,
        }, () => { if (!current()) throw new Error('Share account changed.'); });
        if (!current()) return;
        await serialize(async () => {
          if (!current()) return;
          const saved = await readOwner();
          if (!current()) return;
          if (saved && (saved.ownerId !== ownerId || saved.subject !== userId)) {
            await clearOwner();
            if (!current()) return;
          }
          await saveShareScopeOwner(credential.account_scope_id, ownerId);
          if (!current()) return;
          await ShareBridge.configureSession(credential.token, API_BASE_URL,
            credential.account_scope_id, credential.expires_at, credential.location, credential.is_public);
          // An account transition can happen while the native call is pending.
          // Remove that stale configuration before any later account writes.
          if (active.current.ownerId !== ownerId || active.current.subject !== userId || !active.current.signedIn) {
            await clearOwner();
            return;
          }
          await AsyncStorage.setItem(SHARE_SESSION_KEY, JSON.stringify({
            ownerId, subject: userId, accountScopeId: credential.account_scope_id, expiresAt: credential.expires_at,
          } satisfies SessionOwner));
        });
      } catch {
        // A failed refresh preserves a same-account capability. Captures remain
        // in the native queue; retry provisioning on the next foreground.
      } finally { syncing = false; }
    };
    void sync();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    return () => { cancelled = true; subscription.remove(); };
  }, [isLoaded, isSignedIn, ownerId, userId]);
}
