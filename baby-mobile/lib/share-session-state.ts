import * as Share from "@/modules/hafa-baby-share/src";

let version = 0;
let suspended = false;
let mutations: Promise<unknown> = Promise.resolve();

export function serializeShareSession<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutations.catch(() => undefined).then(operation);
  mutations = next;
  return next;
}

export function beginShareSessionSync(): number {
  suspended = false;
  return ++version;
}
export function isShareSessionCurrent(ticket: number): boolean {
  return !suspended && ticket === version;
}
export function isShareSessionSuspended(): boolean {
  return suspended;
}

function revoke(preserveUnassigned: boolean): Promise<void> {
  version++;
  suspended = true;
  return serializeShareSession(() => Share.clearSession(preserveUnassigned));
}
/** Explicit account sign-out/erase retires authority and all native captures. */
export function revokeShareSession(): Promise<void> {
  return revoke(false);
}
/** Initial signed-out guard retires authority, retaining unassigned originals. */
export function revokeShareAuthority(): Promise<void> {
  return revoke(true);
}
