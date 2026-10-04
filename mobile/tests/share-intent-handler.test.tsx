import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  alert: vi.fn(), replace: vi.fn(), reset: vi.fn(), add: vi.fn(), ack: vi.fn(), metadata: vi.fn(),
  scopeOwner: vi.fn(), getShareIntent: vi.fn(), signedIn: true,
  payload: { webUrl: 'https://example.com/recipe', files: null, text: null, type: 'weburl', _hafa: {} as Record<string, unknown> },
  action: { kind: 'url', url: 'https://example.com/recipe' } as Record<string, unknown>,
  hasIntent: true,
}));
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert }, Platform: { OS: 'ios' } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'android-capture' }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: mocks.signedIn }) }));
const router = { replace: mocks.replace };
vi.mock('expo-router', () => ({ useRouter: () => router }));
vi.mock('expo-share-intent', () => ({
  ShareIntentModule: { getShareIntent: mocks.getShareIntent },
  useShareIntentContext: () => ({ hasShareIntent: mocks.hasIntent, shareIntent: mocks.payload, resetShareIntent: mocks.reset }),
}));
vi.mock('@/modules/hafa-share-bridge/src', () => ({ getCurrentCaptureMetadata: mocks.metadata, acknowledgeCapture: mocks.ack }));
vi.mock('@/lib/shareCapture', () => ({ resolveShareIntent: () => mocks.action }));
vi.mock('@/lib/importInbox', () => ({ importInbox: { add: mocks.add }, getShareScopeOwner: mocks.scopeOwner }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => queryClient }));
const queryClient = { invalidateQueries: vi.fn() };
vi.mock('@/hooks/useRecipes', () => ({ extractionJobKeys: { all: ['jobs'] }, useCurrentUserIdentity: () => ({ data: { id: 'durable-owner' } }) }));
vi.mock('@/hooks/useImportInbox', () => ({ useImportInboxProcessor: () => undefined }));
vi.mock('@/hooks/useShareSession', () => ({ useShareSession: () => undefined }));
import { useHandleShareIntent } from '../hooks/useShareIntent';
function Harness() { useHandleShareIntent(); return null; }
let renderer: ReactTestRenderer;
async function render() { await act(async () => { renderer = create(<Harness />); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.signedIn = true; mocks.hasIntent = true;
  mocks.payload = { webUrl: 'https://example.com/recipe', files: null, text: null, type: 'weburl', _hafa: { captureKey: 'key-a', captureId: 'capture-a', accountScopeId: 'scope-a' } };
  mocks.action = { kind: 'url', url: 'https://example.com/recipe' };
  mocks.metadata.mockResolvedValue(JSON.stringify({ captureKey: 'key-a', captureId: 'capture-a', accountScopeId: 'scope-a' }));
  mocks.scopeOwner.mockResolvedValue('durable-owner'); mocks.add.mockResolvedValue(undefined); mocks.ack.mockResolvedValue(true);
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.useRealTimers(); });
describe('durable share intake', () => {
  it('persists before acknowledging the exact native capture and never clears the whole native queue', async () => {
    await render();
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'capture-a', ownerId: 'durable-owner', state: 'ready', request: expect.objectContaining({ is_public: false }) }));
    expect(mocks.ack).toHaveBeenCalledWith('key-a');
    expect(mocks.add.mock.invocationCallOrder[0]).toBeLessThan(mocks.ack.mock.invocationCallOrder[0]);
    expect(mocks.reset).toHaveBeenCalledWith(false);
    expect(mocks.replace).toHaveBeenCalledWith({ pathname: '/', params: { inboxCaptureId: 'capture-a' } });
  });
  it('processes B arriving while A persists without reopening or clearing B for A', async () => {
    let finishA!: () => void;
    mocks.add.mockImplementationOnce(() => new Promise<void>((resolve) => { finishA = resolve; }));
    await render();
    mocks.payload = { webUrl: 'https://example.com/b', files: null, text: null, type: 'weburl', _hafa: { captureKey: 'key-b', captureId: 'capture-b', accountScopeId: 'scope-a' } };
    mocks.action = { kind: 'url', url: 'https://example.com/b' };
    mocks.metadata.mockResolvedValue(JSON.stringify({ captureKey: 'key-b', captureId: 'capture-b', accountScopeId: 'scope-a' }));
    await act(async () => renderer.update(<Harness />));
    await act(async () => finishA());
    expect(mocks.add.mock.calls.map(([entry]) => entry.id)).toEqual(['capture-a', 'capture-b']);
    expect(mocks.ack.mock.calls.map(([key]) => key)).toEqual(['key-a', 'key-b']);
    expect(mocks.reset).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith({ pathname: '/', params: { inboxCaptureId: 'capture-b' } });
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(mocks.getShareIntent).toHaveBeenCalled();
  });
  it('ignores duplicate A2 snapshots while the native head moves to queued B', async () => {
    let finishA!: () => void;
    mocks.add.mockImplementationOnce(() => new Promise<void>((resolve) => { finishA = resolve; }));
    await render();
    mocks.payload = { ...mocks.payload, _hafa: { ...mocks.payload._hafa } };
    await act(async () => renderer.update(<Harness />));
    mocks.metadata.mockResolvedValue(JSON.stringify({ captureKey: 'key-b', captureId: 'capture-b', accountScopeId: 'scope-a' }));
    await act(async () => finishA());
    expect(mocks.add).toHaveBeenCalledOnce(); expect(mocks.ack).toHaveBeenCalledExactlyOnceWith('key-a');
    expect(mocks.metadata).not.toHaveBeenCalled();
    mocks.getShareIntent.mockImplementationOnce(async () => {
      mocks.payload = { webUrl: 'https://example.com/b', files: null, text: null, type: 'weburl', _hafa: { captureKey: 'key-b', captureId: 'capture-b', accountScopeId: 'scope-a' } };
      mocks.action = { kind: 'url', url: 'https://example.com/b' };
      renderer.update(<Harness />);
    });
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(mocks.add.mock.calls.map(([entry]) => [entry.id, entry.capture.url])).toEqual([
      ['capture-a', 'https://example.com/recipe'], ['capture-b', 'https://example.com/b'],
    ]);
    expect(mocks.ack.mock.calls.map(([key]) => key)).toEqual(['key-a', 'key-b']);
    expect(mocks.metadata).not.toHaveBeenCalled();
  });
  it('rejects unsupported A by its exact identity and drains supported B', async () => {
    mocks.action = { kind: 'unsupported', message: 'Share JPEG, PNG, GIF, or WebP recipe images.' };
    await render();
    expect(mocks.ack).toHaveBeenCalledExactlyOnceWith('key-a');
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.reset).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.alert).toHaveBeenCalledWith('Could Not Import Share', mocks.action.message);
    // A duplicate foreground snapshot must not reject or consume B again.
    mocks.payload = { ...mocks.payload, _hafa: { ...mocks.payload._hafa } };
    await act(async () => renderer.update(<Harness />));
    expect(mocks.ack).toHaveBeenCalledOnce();
    mocks.getShareIntent.mockImplementationOnce(async () => {
      mocks.payload = { webUrl: 'https://example.com/b', files: null, text: null, type: 'weburl', _hafa: { captureKey: 'key-b', captureId: 'capture-b', accountScopeId: 'scope-a' } };
      mocks.action = { kind: 'url', url: 'https://example.com/b' };
      renderer.update(<Harness />);
    });
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'capture-b', capture: { kind: 'url', url: 'https://example.com/b' } }));
    expect(mocks.ack.mock.calls.map(([key]) => key)).toEqual(['key-a', 'key-b']);
  });
  it('preserves unsupported A after acknowledgment failure and retries the same key safely', async () => {
    mocks.action = { kind: 'unsupported', message: 'Share supported recipe images.' };
    mocks.ack.mockResolvedValueOnce(false);
    await render();
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(mocks.getShareIntent).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith('Shared Recipe Saved for Later', expect.stringContaining('still saved'));
    // A native refresh emits a fresh object with the original atomic identity.
    mocks.payload = { ...mocks.payload, _hafa: { ...mocks.payload._hafa } };
    await act(async () => renderer.update(<Harness />));
    expect(mocks.ack.mock.calls.map(([key]) => key)).toEqual(['key-a', 'key-a']);
    expect(mocks.reset).toHaveBeenCalledExactlyOnceWith(false);
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(mocks.getShareIntent).toHaveBeenCalledOnce();
  });
  it('retains sign-in-required native captures without acknowledging or draining them', async () => {
    mocks.signedIn = false;
    mocks.action = { kind: 'sign-in-required' };
    await render();
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(mocks.getShareIntent).not.toHaveBeenCalled();
    expect(mocks.reset).toHaveBeenCalledWith(false);
    // Authentication recovery can replay the preserved capture for intake.
    mocks.signedIn = true;
    mocks.action = { kind: 'url', url: 'https://example.com/recipe' };
    await act(async () => renderer.update(<Harness />));
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'capture-a' }));
    expect(mocks.ack).toHaveBeenCalledExactlyOnceWith('key-a');
  });
  it('retains native content when the durable write fails', async () => {
    mocks.add.mockRejectedValueOnce(new Error('Disk full'));
    await render();
    expect(mocks.ack).not.toHaveBeenCalled(); expect(mocks.reset).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith('Shared Recipe Saved for Later', 'Disk full');
  });
  it('retains a signed-out URL without silently assigning it after sign-in', async () => {
    mocks.signedIn = false;
    mocks.payload._hafa = { captureKey: 'key-a', captureId: 'capture-a' };
    await render();
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ ownerId: null, state: 'waiting' }));
    expect(mocks.ack).toHaveBeenCalledWith('key-a');
  });
  it('uses the original native owner after an account switch', async () => {
    mocks.scopeOwner.mockResolvedValue('different-original-owner');
    await render();
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'different-original-owner' }));
  });
  it('quarantines a scoped capture whose owner mapping is unavailable', async () => {
    mocks.scopeOwner.mockResolvedValue(null);
    await render();
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ ownerId: null, accountScopeId: 'scope-a', state: 'waiting' }));
  });
  it('stores server-submitted jobs without starting another extraction', async () => {
    mocks.payload._hafa = { captureKey: 'key-a', captureId: 'capture-a', accountScopeId: 'scope-a', submitted: true, jobId: 'job-a' };
    await render();
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ state: 'accepted', jobId: 'job-a' }));
  });
  it('preserves text and images durably before route consumption', async () => {
    mocks.action = { kind: 'text', text: '2 cups rice. Cook the rice.' };
    await render();
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ capture: mocks.action, state: 'waiting' }));
  });
});
