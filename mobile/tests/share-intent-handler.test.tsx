import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  alert: vi.fn(), replace: vi.fn(), reset: vi.fn(), add: vi.fn(), ack: vi.fn(), metadata: vi.fn(),
  scopeOwner: vi.fn(), getShareIntent: vi.fn(), signedIn: true,
  payload: { webUrl: 'https://example.com/recipe', files: null, text: null, type: 'weburl' },
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
  it('retains native content when the durable write fails', async () => {
    mocks.add.mockRejectedValueOnce(new Error('Disk full'));
    await render();
    expect(mocks.ack).not.toHaveBeenCalled(); expect(mocks.reset).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith('Shared Recipe Saved for Later', 'Disk full');
  });
  it('retains a signed-out URL without silently assigning it after sign-in', async () => {
    mocks.signedIn = false;
    mocks.metadata.mockResolvedValue(JSON.stringify({ captureKey: 'key-a', captureId: 'capture-a' }));
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
    mocks.metadata.mockResolvedValue(JSON.stringify({ captureKey: 'key-a', captureId: 'capture-a', accountScopeId: 'scope-a', submitted: true, jobId: 'job-a' }));
    await render();
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ state: 'accepted', jobId: 'job-a' }));
  });
  it('preserves text and images durably before route consumption', async () => {
    mocks.action = { kind: 'text', text: '2 cups rice. Cook the rice.' };
    await render();
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ capture: mocks.action, state: 'waiting' }));
  });
});
