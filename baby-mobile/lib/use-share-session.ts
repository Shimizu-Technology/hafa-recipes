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
  sharesChanged,
} from "./share-session-state";
import { sessionReachable, sessionScope, shareDestination, shareOwner } from "./share-scope";
import { shareCategories } from "./share-categories";
import { accessKey, generationOf, spaceFence, spacesLive } from "./spaces";
export { revokeShareSession } from "./share-session-state";

export function ShareSessionGuard() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (!isLoaded || Platform.OS !== "ios") return;
    if (!isSignedIn) {
      const retire = () => void revokeShareAuthority().catch(() => undefined);
      retire();
      const app = AppState.addEventListener("change", state => { if (state === "active") retire(); });
      return () => app.remove();
    }
    // From the moment Clerk knows, since the rest of the setup can be held up. Clearing a space also clears this while
    // she's still signed in, so it's said again on the way to another app, which is where a share can come from.
    const note = () => void serializeShareSession(() => Share.noteSignedIn()).catch(() => undefined);
    note();
    const app = AppState.addEventListener("change", (state) => { if (state !== "active") note(); });
    return () => app.remove();
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
          // Left or removed from its family, or its space cleared: it can't write there any more. It and its category
          // names go now, not after the new one arrives, which might not. Captures it made are kept for the rebind.
          else if (previous && !sessionReachable(previous, b.owner, b.state.bootstrap)) await Share.suspendSession();
          // Before asking for the credential, which is the part that can fail.
          await Share.noteSignedIn().catch(() => undefined);
        });
        if (!current()) return;
        const bootstrap = b.state.bootstrap!, destination = shareDestination(bootstrap);
        // Asked alongside the credential. A list that can't be had leaves the last one, which the sheet only shows for the same tag.
        const categories = Promise.resolve().then(() => b.api.records({ kind: "collection", limit: 100 })).catch(() => null);
        const session = await b.api.request<Share.ShareSession>("/share/session", "POST",
          { installation_id: await Share.installationId() }, spaceFence(bootstrap, destination));
        await serializeShareSession(async () => {
          if (!current() || session.generation !== generationOf(bootstrap, destination)) return;
          await Share.configureSession(session, configuration.apiBase, b.owner, sessionScope(bootstrap, session));
          // Permission-version refreshes replace this effect without retiring
          // same-account captures. Account cleanup is serialized separately.
          if (!current() && (isShareSessionSuspended() || !b.current())) await Share.suspendSession();
        });
        // Native refuses a list for any credential but the one that's there now.
        const page = await categories;
        if (page && current()) await serializeShareSession(() => Share.publishCategories(
          shareCategories(page.items, spacesLive(bootstrap) ? session.space_id : undefined),
          b.owner, session.generation, sessionScope(bootstrap, session))).catch(() => undefined);
        // Connected, so whatever's waiting can be offered to this account now.
        if (current()) sharesChanged();
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
