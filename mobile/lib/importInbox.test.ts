import { describe, expect, it, vi } from 'vitest';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }));
import { createImportInbox, visibleImportEntries, type ImportInboxEntry } from './importInbox';

const entry = (id: string, ownerId: string | null = 'owner-a'): ImportInboxEntry => ({
  id, ownerId, capture: { kind: 'url', url: `https://example.com/${id}` },
  createdAt: 1, state: ownerId ? 'ready' : 'waiting',
});
function storage() {
  let value: string | null = null;
  return { getItem: vi.fn(async () => value), setItem: vi.fn(async (_key: string, next: string) => { value = next; }) };
}

describe('durable import inbox', () => {
  it('serializes concurrent captures and recovers all pending entries after restart', async () => {
    const persisted = storage();
    const inbox = createImportInbox(persisted);
    await Promise.all([inbox.add(entry('a')), inbox.add(entry('b')), inbox.add(entry('c'))]);
    const restarted = createImportInbox(persisted);
    await restarted.hydrate();
    expect(restarted.snapshot().map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
  it('does not expose a capture until its write succeeds', async () => {
    const persisted = storage();
    persisted.setItem.mockRejectedValueOnce(new Error('Disk full'));
    const inbox = createImportInbox(persisted);
    await expect(inbox.add(entry('a'))).rejects.toThrow('Disk full');
    expect(inbox.snapshot()).toEqual([]);
    await inbox.add(entry('a'));
    expect(inbox.snapshot()).toHaveLength(1);
  });
  it('deduplicates capture delivery without resetting an accepted job', async () => {
    const inbox = createImportInbox(storage());
    await inbox.add(entry('a'));
    await inbox.patch('a', { state: 'accepted', jobId: 'job-a' });
    await inbox.add(entry('a'));
    expect(inbox.snapshot()).toMatchObject([{ id: 'a', state: 'accepted', jobId: 'job-a' }]);
  });
  it('requires explicit association for signed-out shares and isolates accounts', async () => {
    const inbox = createImportInbox(storage());
    await inbox.add(entry('a'));
    await inbox.add(entry('signed-out', null));
    expect(visibleImportEntries(inbox.snapshot(), 'owner-b').map((item) => item.id)).toEqual(['signed-out']);
    expect(inbox.snapshot()[1].state).toBe('waiting');
    await inbox.claim('signed-out', 'owner-b');
    await inbox.claim('a', 'owner-b');
    expect(inbox.snapshot()).toMatchObject([{ ownerId: 'owner-a' }, { ownerId: 'owner-b', state: 'ready' }]);
  });
  it('quarantines unknown scoped shares rather than assigning them to the current account', async () => {
    const inbox = createImportInbox(storage());
    await inbox.add({ ...entry('old-account', null), accountScopeId: 'opaque-old-scope' });
    await inbox.claim('old-account', 'owner-b');
    expect(inbox.snapshot()[0].ownerId).toBeNull();
    expect(visibleImportEntries(inbox.snapshot(), 'owner-b')).toEqual([]);
  });
  it('never deletes a pending capture when a different job completes', async () => {
    const inbox = createImportInbox(storage());
    await inbox.add(entry('a'));
    await inbox.add(entry('b'));
    await inbox.patch('a', { state: 'accepted', recipeId: 'recipe-a' });
    expect(visibleImportEntries(inbox.snapshot(), 'owner-a')).toMatchObject([{ id: 'b', state: 'ready' }]);
  });
});
