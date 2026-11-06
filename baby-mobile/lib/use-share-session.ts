import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { useAuth } from "@clerk/expo";
import { useBaby } from "./context";
import { configuration } from "./config";
import * as Share from "@/modules/hafa-baby-share/src";
import {
  beginShareSessionSync,
  isShareSessionCurrent,
  isShareSessionSuspended,
  onShareSessionAsked,
  revokeShareAuthority,
  serializeShareSession,
} from "./share-session-state";
import { sessionScope, shareDestination, shareOwner } from "./share-scope";
import { accessKey, generationOf, spaceFence, spacesLive } from "./spaces";
export { revokeShareSession } from "./share-session-state";

export function ShareSessionGuard() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (isLoaded && !isSignedIn && Platform.OS === "ios") void revokeShareAuthority().catch(() => undefined);
  }, [isLoaded, isSignedIn]);
  return null;
}
export function useShareSession() {
  const b = useBaby();
  const generation = b.state.bootstrap?.generation;
  const automaticEpoch = b.state.bootstrap?.profile.auto_process_epoch ?? 0;
  const active = b.state.bootstrap?.active !== false;
  // Create family, joining and leaving each revoke the credential, so they each get a new one, for where captures now go.
  // The flag turning on is the same: this phone is ready for a family once it's asked as client 3.
  const access = `${spacesLive(b.state.bootstrap)}:${accessKey(b.state.bootstrap)}`;
  useEffect(() => {
    if (Platform.OS !== "ios" || !Share.nativeSharingAvailable || !b.owner || !generation || !active) return;
    let alive = true, running: Promise<void> | null = null;
    const ticket = beginShareSessionSync();
    const current = () => alive && isShareSessionCurrent(ticket) && b.current();
    const send = async () => {
      try {
        await serializeShareSession(async () => {
          if (!current()) return;
          // Only another account's retires what's here. A new credential for this one rebinds, and captures keep their ids and receipts.
          const previous = await Share.sessionOwner();
          if (previous && shareOwner(previous) !== b.owner) await Share.clearSession();
        });
        if (!current()) return;
        const bootstrap = b.state.bootstrap!, destination = shareDestination(bootstrap);
        const session = await b.api.request<Share.ShareSession>("/share/session", "POST",
          { installation_id: await Share.installationId() }, spaceFence(bootstrap, destination));
        await serializeShareSession(async () => {
          if (!current() || session.generation !== generationOf(bootstrap, destination)) return;
          await Share.configureSession(session, configuration.apiBase, b.owner, sessionScope(bootstrap, session));
          // Permission-version refreshes replace this effect without retiring
          // same-account captures. Account cleanup is serialized separately.
          if (!current() && (isShareSessionSuspended() || !b.current())) await Share.clearSession(true);
        });
      } catch {
        // Keep an existing same-account capability when offline. Expired tokens
        // only produce the truthful local-save confirmation in the extension.
      }
    };
    const sync = () => current() ? running ??= send().finally(() => { running = null; }) : Promise.resolve();
    void sync();
    const listener = AppState.addEventListener("change", state => { if (state === "active") void sync(); });
    const stopAsking = onShareSessionAsked(sync);
    return () => { alive = false; listener.remove(); stopAsking(); };
  }, [b.api, b.owner, generation, active, automaticEpoch, access]);
}
