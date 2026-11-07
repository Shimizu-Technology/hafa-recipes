import { useEffect, useState } from "react";
import { Alert, AppState } from "react-native";
import * as Share from "@/modules/hafa-baby-share/src";
import type { WaitingShare } from "@/modules/hafa-baby-share/src";
import { isShareSessionSuspended, onSharesChanged, serializeShareSession, sharesChanged } from "./share-session-state";

const counted = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const fileWords: Record<WaitingShare["kind"], string> = { link: "Link", photo: "Photo", video: "Video", audio: "Audio", pdf: "PDF", file: "File", text: "Text" };

/** What the card names a share by: its type and website, and nothing a next person shouldn't read. */
export function shareLabel(share: WaitingShare) {
  if (share.kind === "link" && share.host) return `Link from ${share.host}`;
  if (share.kind === "photo" && share.count > 1) return `${share.count} photos`;
  return fileWords[share.kind];
}
const clock = (date: Date) => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const shortDate = (date: Date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
export function shareWhen(share: WaitingShare, now = new Date()) {
  const shared = new Date(share.shared_at), yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const day = shared.toDateString() === now.toDateString() ? "Today" : shared.toDateString() === yesterday.toDateString() ? "Yesterday" : shortDate(shared);
  return `${day}, ${clock(shared)}`;
}
export const shareKeptUntil = (share: WaitingShare) => `kept until ${shortDate(new Date(share.kept_until))}`;
export const expiredNotice = (count: number) => `${count === 1 ? "That share’s" : "Those shares’"} 30 days are up. ${count === 1 ? "It can’t" : "They can’t"} be added any more.`;
export const signInNotice = (count: number) => `${counted(count, "share")} ${count === 1 ? "is" : "are"} waiting on this phone. Sign in to add ${count === 1 ? "it" : "them"}.`;
/** Sign-out and erase keep clearing everything on the phone. These say so first. */
export const removedWarning = (count: number) => `${counted(count, "share")} waiting here will be removed.`;

export const waitingShareCount = () => Share.waitingShareCount().catch(() => 0);
/** Signed out, the count is all this phone says about what's waiting. */
export function useWaitingShareCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => void waitingShareCount().then((next) => { if (alive) setCount(next); });
    load();
    const app = AppState.addEventListener("change", (state) => { if (state === "active") load(); });
    const stop = onSharesChanged(load);
    return () => { alive = false; app.remove(); stop(); };
  }, []);
  return count;
}
/** The few ways out of an account that aren't Settings' own, where a waiting share would otherwise go unmentioned. */
export async function confirmSignOut(signOut: () => void) {
  const count = await waitingShareCount();
  if (!count) return signOut();
  Alert.alert("Sign out and clear this phone?", `${removedWarning(count)} Signing out also removes unsynced entries and drafts.`, [
    { text: "Keep working", style: "cancel" },
    { text: "Sign out and clear device", style: "destructive", onPress: signOut },
  ]);
}

/**
 * Says these are this account's, or as many as it still can. Takes its turn with sign-out, so the two can't cross. It only
 * changes who they belong to: they aren't saved until the drain has written them to the outbox, and `onClaimSettled` says so.
 */
export async function addWaitingShares(tokens: string[], owner: string, generation: number, current: () => boolean) {
  const result = await serializeShareSession(async () => {
    const done = { claimed: [] as string[], expired: 0, refused: 0 };
    for (const token of tokens) {
      if (!current() || isShareSessionSuspended()) { done.refused++; continue; }
      // Keep earlier successes registered even if a later native claim fails.
      const answer = await Share.claimShare(token, owner, generation).catch(() => "refused");
      if (answer === "claimed") done.claimed.push(token);
      else if (answer === "expired") done.expired++;
      else done.refused++;
    }
    return done;
  });
  sharesChanged();
  return result;
}
export async function removeWaitingShare(token: string) {
  const removed = await serializeShareSession(() => Share.discardShare(token));
  sharesChanged();
  return removed;
}
