import { describe, expect, it, vi } from 'vitest';
vi.mock('expo-crypto', () => ({ randomUUID: () => 'receipt-default' }));
import { createLegacyShareReceipts } from './legacyShareReceipts';
import type { ImportInboxEntry } from './importInbox';
const makeInbox = (entries: ImportInboxEntry[] = []) => ({ hydrate: vi.fn(async () => undefined), snapshot: () => entries, add: vi.fn(async (_entry: ImportInboxEntry) => undefined) });
describe('legacy route receipt lifetime', () => {
  it('reconciles a restarted route with its durable original owner without another enqueue', async () => {
    const original: ImportInboxEntry = { id: 'receipt-a', ownerId: 'owner-a', createdAt: 1, state: 'ready', capture: { kind: 'url', url: 'https://example.com/a' } };
    const inbox = makeInbox([original]); const receipts = createLegacyShareReceipts();
    const restored = receipts.receive('https://example.com/a', 'receipt-a', 'owner-b');
    await receipts.persist(restored, inbox);
    expect(restored.entry.ownerId).toBe('owner-a'); expect(inbox.add).not.toHaveBeenCalled();
  });
  it('keeps an unknown resumed route unassigned instead of adopting its current account', async () => {
    const inbox = makeInbox(); const receipts = createLegacyShareReceipts();
    await receipts.persist(receipts.receive('https://example.com/a', 'receipt-a', 'owner-b'), inbox);
    expect(inbox.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'receipt-a', ownerId: null, state: 'waiting' }));
  });
  it('retains the original receipt while a hydration boundary spans a new account', async () => {
    let finish!: () => void;
    const inbox = makeInbox(); inbox.hydrate.mockImplementationOnce(() => new Promise<undefined>((resolve) => { finish = () => resolve(undefined); }));
    const receipts = createLegacyShareReceipts(() => 'receipt-a');
    const first = receipts.receive('https://example.com/a', undefined, 'owner-a');
    const write = receipts.persist(first, inbox);
    const remount = receipts.receive('https://example.com/a', undefined, 'owner-b');
    expect(remount).toBe(first); expect(receipts.persist(remount, inbox)).toBe(write);
    finish(); await write;
    expect(inbox.add).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ownerId: 'owner-a' }));
  });
  it('permits a fresh identical link only after its previous route is cleared', async () => {
    const ids = vi.fn().mockReturnValueOnce('receipt-a').mockReturnValueOnce('receipt-b');
    const receipts = createLegacyShareReceipts(ids);
    const first = receipts.receive('https://example.com/a', undefined, 'owner-a');
    receipts.clearRoute();
    const second = receipts.receive('https://example.com/a', undefined, 'owner-b');
    expect(second.id).toBe('receipt-b'); expect(second).not.toBe(first); expect(second.entry.ownerId).toBe('owner-b');
  });
  it('stops conflicting persisted capture identities instead of rewriting their content', async () => {
    const inbox = makeInbox([{ id: 'receipt-a', ownerId: 'owner-a', createdAt: 1, state: 'ready', capture: { kind: 'url', url: 'https://example.com/original' } }]);
    const receipts = createLegacyShareReceipts();
    await expect(receipts.persist(receipts.receive('https://example.com/different', 'receipt-a', 'owner-b'), inbox)).rejects.toThrow('does not match');
    expect(inbox.add).not.toHaveBeenCalled();
  });
});
