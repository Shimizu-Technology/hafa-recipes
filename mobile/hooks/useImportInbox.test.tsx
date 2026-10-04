import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  owner: 'owner-a', data: null as string | null, start: vi.fn(), reset: vi.fn(),
  disclosure: vi.fn(async () => ({ requires_acceptance: false })),
  extraction: { isReady: true, isExtracting: true, isComplete: false, isFailed: false, canRetryStart: false, jobId: 'job-a' as string | null, recipeId: null as string | null, requestKey: null as string | null },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => mocks.data, setItem: async (_key: string, value: string) => { mocks.data = value; } } }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: true }) }));
vi.mock('@/hooks/useRecipes', () => ({ useCurrentUserIdentity: () => ({ data: { id: mocks.owner } }) }));
vi.mock('@/lib/api', () => ({ api: { getPublishingDisclosure: mocks.disclosure } }));
vi.mock('@/contexts/ExtractionContext', () => ({ useAsyncExtraction: () => ({ ...mocks.extraction, startExtraction: mocks.start, reset: mocks.reset }) }));
import { importInbox } from '@/lib/importInbox';
import { useImportInboxProcessor } from './useImportInbox';
function Harness() { useImportInboxProcessor(); return null; }
let renderer: ReactTestRenderer | undefined;
beforeEach(async () => {
  vi.clearAllMocks(); mocks.owner = 'owner-a';
  mocks.extraction = { isReady: true, isExtracting: true, isComplete: false, isFailed: false, canRetryStart: false, jobId: 'job-a', recipeId: null, requestKey: null };
  await importInbox.hydrate();
  for (const entry of importInbox.snapshot()) await importInbox.remove(entry.id);
  mocks.reset.mockResolvedValue(undefined); mocks.start.mockResolvedValue({ jobId: 'job-b' });
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });
describe('import intake coordinator', () => {
  it('keeps B queued while A runs, then submits B once with its stable capture key', async () => {
    await importInbox.add({ id: 'b', ownerId: 'owner-a', createdAt: 1, state: 'ready', capture: { kind: 'url', url: 'https://example.com/b' } });
    await act(async () => { renderer = create(<Harness />); });
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.extraction.isExtracting = false; mocks.extraction.isComplete = true;
    await act(async () => renderer!.update(<Harness />));
    expect(mocks.reset).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({ url: 'https://example.com/b', location: 'Guam', notes: '', is_public: false }, 'share:b');
    expect(importInbox.snapshot()[0]).toMatchObject({ state: 'accepted', jobId: 'job-b' });
    await act(async () => renderer!.update(<Harness />));
    expect(mocks.start).toHaveBeenCalledOnce();
  });
  it('waits for visible publishing acceptance before starting a public captured link', async () => {
    mocks.disclosure.mockResolvedValueOnce({ requires_acceptance: true });
    await importInbox.add({ id: 'public', ownerId: 'owner-a', createdAt: 1, state: 'ready', capture: { kind: 'url', url: 'https://example.com/public' }, request: { url: 'https://example.com/public', is_public: true } });
    mocks.extraction.isExtracting = false;
    await act(async () => { renderer = create(<Harness />); });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(importInbox.snapshot()[0]).toMatchObject({ state: 'waiting', request: { is_public: true } });
  });
  it('starts an accepted public capture without silently making it private', async () => {
    await importInbox.add({ id: 'public', ownerId: 'owner-a', createdAt: 1, state: 'ready', capture: { kind: 'url', url: 'https://example.com/public' }, request: { url: 'https://example.com/public', is_public: true } });
    mocks.extraction.isExtracting = false;
    await act(async () => { renderer = create(<Harness />); });
    expect(mocks.start).toHaveBeenCalledWith({ url: 'https://example.com/public', is_public: true }, 'share:public');
  });
  it('does not auto-submit unassigned or another account captures', async () => {
    await importInbox.add({ id: 'signed-out', ownerId: null, createdAt: 1, state: 'waiting', capture: { kind: 'url', url: 'https://example.com/b' } });
    await importInbox.add({ id: 'old-account', ownerId: 'owner-old', createdAt: 1, state: 'ready', capture: { kind: 'url', url: 'https://example.com/c' } });
    mocks.extraction.isExtracting = false; mocks.extraction.jobId = null;
    await act(async () => { renderer = create(<Harness />); });
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('pauses queued B while A has an uncertain start that needs reconnecting', async () => {
    await importInbox.add({ id: 'b', ownerId: 'owner-a', createdAt: 1, state: 'ready', capture: { kind: 'url', url: 'https://example.com/b' } });
    mocks.extraction.isExtracting = false; mocks.extraction.canRetryStart = true;
    await act(async () => { renderer = create(<Harness />); });
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.reset).not.toHaveBeenCalled();
  });
  it('preserves an uncertain submission and reconciles a successful reconnect', async () => {
    await importInbox.add({ id: 'b', ownerId: 'owner-a', createdAt: 1, state: 'ready', capture: { kind: 'url', url: 'https://example.com/b' } });
    mocks.extraction.isExtracting = false; mocks.extraction.jobId = null;
    mocks.start.mockRejectedValueOnce(new Error('Connection dropped'));
    await act(async () => { renderer = create(<Harness />); });
    expect(importInbox.snapshot()[0]).toMatchObject({ state: 'error', capture: { url: 'https://example.com/b' } });
    mocks.extraction.requestKey = 'share:b'; mocks.extraction.isExtracting = true; mocks.extraction.jobId = 'job-b';
    await act(async () => renderer!.update(<Harness />));
    expect(importInbox.snapshot()[0]).toMatchObject({ state: 'accepted', jobId: 'job-b' });
    expect(mocks.start).toHaveBeenCalledOnce();
  });
});
