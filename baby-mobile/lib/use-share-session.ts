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
  revokeShareAuthority,
  serializeShareSession,
} from "./share-session-state";
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
  useEffect(() => {
    if (Platform.OS !== "ios" || !Share.nativeSharingAvailable || !b.owner || !generation || !active) return;
    let alive = true, running = false;
    const ticket = beginShareSessionSync();
    const current = () => alive && isShareSessionCurrent(ticket) && b.current();
    const sync = async () => {
      if (!current() || running) return;
      running = true;
      try {
        await serializeShareSession(async () => {
          if (!current()) return;
          const previous = await Share.sessionOwner();
          if (previous && previous !== `${b.owner}:${generation}`) await Share.clearSession();
        });
        if (!current()) return;
        const session = await b.api.request<Share.ShareSession>("/share/session", "POST",
          { installation_id: await Share.installationId() }, generation);
        await serializeShareSession(async () => {
          if (!current() || session.generation !== generation) return;
          await Share.configureSession(session, configuration.apiBase, b.owner);
          // Permission-version refreshes replace this effect without retiring
          // same-account captures. Account cleanup is serialized separately.
          if (!current() && (isShareSessionSuspended() || !b.current())) await Share.clearSession(true);
        });
      } catch {
        // Keep an existing same-account capability when offline. Expired tokens
        // only produce the truthful local-save confirmation in the extension.
      } finally { running = false; }
    };
    void sync();
    const listener = AppState.addEventListener("change", state => { if (state === "active") void sync(); });
    return () => { alive = false; listener.remove(); };
  }, [b.api, b.owner, generation, active, automaticEpoch]);
}
