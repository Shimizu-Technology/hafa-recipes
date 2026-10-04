import { randomUUID } from 'expo-crypto';
import type { ImportInboxEntry } from './importInbox';

type Inbox = {
  hydrate(): Promise<void>;
  snapshot(): ImportInboxEntry[];
  add(entry: ImportInboxEntry): Promise<void>;
};
export type LegacyShareReceipt = {
  id: string;
  url: string;
  entry: ImportInboxEntry;
  persisted: boolean;
  inFlight: Promise<void> | null;
  restoreExisting: boolean;
};

/** Session receipts survive auth-driven screen unmounts. Route IDs also let a
 * restarted app reconcile the durable inbox without assigning an old share to
 * whichever account signs in next. Only the currently retained URL is reused;
 * observing cleared route parameters permits a later identical share. */
export function createLegacyShareReceipts(idFactory = randomUUID) {
  const receipts = new Map<string, LegacyShareReceipt>();
  let active: LegacyShareReceipt | null = null;
  const receive = (url: string, routeId: string | undefined, ownerId: string | null): LegacyShareReceipt => {
    const retained = routeId ? receipts.get(routeId) : active?.url === url ? active : null;
    if (retained) {
      if (retained.url !== url) throw new Error('The shared link changed during its handoff. Please share it again.');
      active = retained;
      return retained;
    }
    // A pre-existing route ID without its session receipt is a resumed handoff.
    // Its original owner must come from storage, never the new current account.
    const originalOwner = routeId ? null : ownerId;
    const id = routeId || idFactory();
    const receipt: LegacyShareReceipt = {
      id, url, persisted: false, inFlight: null, restoreExisting: Boolean(routeId),
      entry: { id, ownerId: originalOwner, createdAt: Date.now(), state: originalOwner ? 'ready' : 'waiting',
        capture: { kind: 'url', url }, request: { url, location: 'Guam', notes: '', is_public: false } },
    };
    receipts.set(id, receipt); active = receipt;
    return receipt;
  };
  const persist = (receipt: LegacyShareReceipt, inbox: Inbox): Promise<void> => {
    if (receipt.persisted) return Promise.resolve();
    if (receipt.inFlight) return receipt.inFlight;
    const operation = (async () => {
      await inbox.hydrate();
      if (receipt.restoreExisting) {
        const stored = inbox.snapshot().find((entry) => entry.id === receipt.id);
        if (stored) {
          if (stored.state !== 'accepted' && (stored.capture.kind !== 'url' || stored.capture.url !== receipt.url)) {
            throw new Error('The saved share does not match this link. Please share it again.');
          }
          receipt.entry = stored;
          receipt.persisted = true;
          return;
        }
        // Nothing survived before the restart. Keep the link unassigned until
        // the cook explicitly chooses to import it into the current account.
      }
      await inbox.add(receipt.entry);
      receipt.persisted = true;
    })();
    receipt.inFlight = operation;
    void operation.finally(() => { if (receipt.inFlight === operation) receipt.inFlight = null; }).catch(() => undefined);
    return operation;
  };
  return { receive, persist, clearRoute: () => { active = null; }, isCurrent: (receipt: LegacyShareReceipt) => active === receipt };
}

export const legacyShareReceipts = createLegacyShareReceipts();
