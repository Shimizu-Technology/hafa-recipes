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
  it('makes a definitively rejected claim editable and retryable with its original capture ID', async () => {
    const persisted = storage();
    const inbox = createImportInbox(persisted);
    await inbox.add(entry('rejected'));
    await inbox.claimForSubmit('rejected', 'owner-a', inbox.snapshot()[0]);
    await inbox.rejectSubmission('rejected', 'owner-a', 'Review public sharing.');
    const restarted = createImportInbox(persisted);
    await restarted.hydrate();
    expect(restarted.snapshot()[0]).toMatchObject({ id: 'rejected', state: 'error', submissionClaimed: false });
    const request = { url: 'https://example.com/rejected', notes: 'Corrected notes', is_public: false };
    await restarted.claim('rejected', 'owner-a', request);
    expect(await restarted.claimForSubmit('rejected', 'owner-a', restarted.snapshot()[0])).toMatchObject({
      id: 'rejected', state: 'submitting', submissionClaimed: true, request,
    });
    await restarted.removeWaiting('rejected', 'owner-a');
    expect(restarted.snapshot()).toHaveLength(1);
  });

  it.each(['owner', 'id', 'job', 'recipe', 'accepted'] as const)(
    'does not release a different or confirmed claim after rejection: %s', async (boundary) => {
      const inbox = createImportInbox(storage());
      await inbox.add({ ...entry('protected'), state: 'submitting', submissionClaimed: true });
      if (boundary === 'job') await inbox.patch('protected', { jobId: 'known-job' });
      if (boundary === 'recipe') await inbox.patch('protected', { recipeId: 'known-recipe' });
      if (boundary === 'accepted') await inbox.patch('protected', { state: 'accepted' });
      const before = inbox.snapshot();
      await inbox.rejectSubmission(boundary === 'id' ? 'different' : 'protected',
        boundary === 'owner' ? 'owner-b' : 'owner-a', 'Rejected');
      expect(inbox.snapshot()).toEqual(before);
    },
  );

  it('retains the exact submission request through a claim/receipt crash and refuses local removal after reload', async () => {
    const persisted = storage();
    const inbox = createImportInbox(persisted);
    const request = { url: 'https://example.com/shared', location: 'Hawaii', notes: '2 cups rice', is_public: true };
    await inbox.add({ ...entry('crashed'), request });
    await inbox.claimForSubmit('crashed', 'owner-a', inbox.snapshot()[0]);
    const restarted = createImportInbox(persisted);
    await restarted.hydrate();
    await restarted.removeWaiting('crashed', 'owner-a');
    await restarted.claim('crashed', 'owner-a', { ...request, notes: 'Changed request' });
    expect(restarted.snapshot()).toMatchObject([{ id: 'crashed', state: 'submitting', submissionClaimed: true, request }]);
    expect(await restarted.claimForSubmit('crashed', 'owner-a', restarted.snapshot()[0])).toBeNull();
  });

  it('serializes removal and submission claims, retaining only an owned current entry', async () => {
    const inbox = createImportInbox(storage());
    await inbox.add(entry('removed'));
    const removed = inbox.snapshot()[0];
    await inbox.removeWaiting('removed', 'owner-a');
    expect(await inbox.claimForSubmit('removed', 'owner-a', removed)).toBeNull();
    await inbox.add(entry('kept'));
    const kept = inbox.snapshot()[0];
    expect(await inbox.claimForSubmit('kept', 'owner-b', kept)).toBeNull();
    await inbox.removeWaiting('kept', 'owner-b');
    expect(inbox.snapshot()).toEqual([kept]);
    const [first, second] = await Promise.all([
      inbox.claimForSubmit('kept', 'owner-a', kept), inbox.claimForSubmit('kept', 'owner-a', kept),
    ]);
    expect(first).toMatchObject({ id: 'kept', state: 'submitting', submissionClaimed: true });
    expect(second).toBeNull();
    await inbox.removeWaiting('kept', 'owner-a');
    await inbox.patch('kept', { state: 'error', error: 'Uncertain start' });
    await inbox.claim('kept', 'owner-a');
    await inbox.removeWaiting('kept', 'owner-a');
    expect(inbox.snapshot()).toMatchObject([{ id: 'kept', state: 'error', submissionClaimed: true }]);
  });

  it('does not claim a changed entry or expose a claim when persistence fails', async () => {
    const persisted = storage();
    const inbox = createImportInbox(persisted);
    await inbox.add(entry('a'));
    const old = inbox.snapshot()[0];
    await inbox.patch('a', { request: { url: 'https://example.com/new' } });
    expect(await inbox.claimForSubmit('a', 'owner-a', old)).toBeNull();
    persisted.setItem.mockRejectedValueOnce(new Error('Disk full'));
    await expect(inbox.claimForSubmit('a', 'owner-a', inbox.snapshot()[0])).rejects.toThrow('Disk full');
    expect(inbox.snapshot()[0].state).toBe('ready');
  });

  it('retains URL captions and request notes through restart and explicit account association', async () => {
    const persisted = storage();
    const inbox = createImportInbox(persisted);
    const notes = '2 cups rice\nSimmer 20 minutes.';
    const request = { url: 'https://example.com/shared', notes, location: 'Hawaii', is_public: false };
    await inbox.add({ ...entry('shared', null), capture: { kind: 'url', url: request.url, notes }, request });
    const restarted = createImportInbox(persisted);
    await restarted.hydrate();
    expect(restarted.snapshot()[0]).toMatchObject({ ownerId: null, state: 'waiting', capture: { notes }, request });
    await restarted.claim('shared', 'owner-b');
    expect(restarted.snapshot()[0]).toMatchObject({ ownerId: 'owner-b', state: 'ready', capture: { notes }, request });
    await restarted.patch('shared', { state: 'accepted', jobId: 'job-shared' });
    await restarted.add({ ...entry('shared'), capture: { kind: 'url', url: request.url, notes }, request });
    expect(restarted.snapshot()[0]).toEqual(expect.objectContaining({
      ownerId: 'owner-b', state: 'accepted', jobId: 'job-shared', capture: { kind: 'url', url: '' },
    }));
    expect(restarted.snapshot()[0].request).toBeUndefined();
    expect(persisted.setItem.mock.lastCall?.[1]).not.toContain(notes.split('\n')[0]);
  });

  it('redacts captions for native jobs already accepted instead of changing or resubmitting them', async () => {
    const inbox = createImportInbox(storage());
    await inbox.add({ ...entry('native'), state: 'accepted', jobId: 'job-native',
      capture: { kind: 'url', url: 'https://example.com/native', notes: '2 cups rice' },
      request: { url: 'https://example.com/native', notes: '2 cups rice' } });
    expect(inbox.snapshot()[0]).toMatchObject({ state: 'accepted', jobId: 'job-native', capture: { kind: 'url', url: '' } });
    expect(inbox.snapshot()[0].request).toBeUndefined();
  });

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
