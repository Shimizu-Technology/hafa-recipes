import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { useAuth } from "@clerk/expo";
import { useTraining } from "@/lib/context";
import { configuration } from "@/lib/config";
import { nativeShareVisibilityKey, nativeSharePreferenceVersion, nativeSharingSuspended, observeNativeShareAuthSession,
  refreshNativeSharing, revokeNativeSharing, serializeShare, subscribeNativeSharePreference } from "@/lib/native-share-session";
import * as Share from "@/modules/hafa-workouts-share/src";

export function NativeShareAccountGuard() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  useEffect(() => {
    if (Platform.OS !== "ios" || !isLoaded) return;
    const binding = isSignedIn && userId && sessionId ? `${configuration.clerkEnvironment}:${configuration.clerkKey}:${userId}:${sessionId}` : null;
    if (observeNativeShareAuthSession(binding) || !binding) void revokeNativeSharing().then(refreshNativeSharing).catch(() => undefined);
  }, [isLoaded, isSignedIn, userId, sessionId]);
  return null;
}
export function useNativeShareSession() {
  const { api, owner, enrollment, localDrafts, isCurrentAccount } = useTraining();
  const generation = enrollment?.enrolled ? enrollment.generation : undefined;
  const account = useRef(isCurrentAccount); account.current = isCurrentAccount;
  useEffect(() => {
    if (Platform.OS !== "ios" || !Share.nativeSharingAvailable || !generation) return;
    let alive = true; let syncing = false; let again = false;
    const current = () => alive && account.current() && !nativeSharingSuspended();
    const sync = async () => {
      if (!current()) return;
      if (syncing) { again = true; return; } syncing = true;
      const policyVersion = nativeSharePreferenceVersion();
      try {
        await serializeShare(async () => {
          if (!current()) return;
          const previous = await Share.sessionOwner();
          if (previous && previous !== `${owner}:${generation}`) await Share.clearSession();
        });
        // Network calls stay outside the native mutation queue. Sign-out must
        // disable an existing capability immediately, even during a slow refresh.
        if (!current()) return;
        const consent = await api.aiConsent();
        if (!current()) return;
        if (!consent.accepted || consent.disclosure_version !== 1) { await revokeNativeSharing(); return; }
        const requested = await localDrafts.load<boolean>(owner, nativeShareVisibilityKey) === true;
        const disclosure = requested ? await api.publishingDisclosure() : null;
        if (!current()) return;
        const session = await api.createShareSession(await Share.installationId(), requested && disclosure?.requires_acceptance === false, generation);
        await serializeShare(async () => {
          if (!current() || policyVersion !== nativeSharePreferenceVersion()) return;
          if (session.generation !== generation) return;
          await Share.configureSession(session, configuration.apiBase, owner);
          if (!current() || policyVersion !== nativeSharePreferenceVersion()) await Share.clearSession();
        });
      } catch {
        // Keep a same-account capability when offline. Native captures remain
        // durable even after it expires; foreground intake retries by capture ID.
      } finally { syncing = false; if (again && alive) { again = false; void sync(); } }
    };
    void sync();
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void sync(); });
    const unsubscribe = subscribeNativeSharePreference(() => { void sync(); });
    return () => { alive = false; subscription.remove(); unsubscribe(); void revokeNativeSharing().catch(() => undefined); };
  }, [api, owner, generation, localDrafts]);
}
