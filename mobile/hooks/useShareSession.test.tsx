import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  owner: 'owner-a' as string | undefined, subject: 'subject-a', signedIn: true,
  storage: new Map<string, string>(), foreground: null as ((state: string) => void) | null,
  clear: vi.fn(), configure: vi.fn(), provision: vi.fn(), scopeOwner: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { addEventListener: (_: string, listener: (state: string) => void) => {
  mocks.foreground = listener; return { remove: vi.fn() };
} } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => mocks.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { mocks.storage.set(key, value); },
  removeItem: async (key: string) => { mocks.storage.delete(key); },
} }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: mocks.signedIn, userId: mocks.subject }) }));
vi.mock('./useRecipes', () => ({ useCurrentUserIdentity: () => ({ data: mocks.owner ? { id: mocks.owner } : undefined }) }));
vi.mock('@/modules/hafa-share-bridge/src', () => ({ clearSession: mocks.clear, configureSession: mocks.configure, getInstallationId: async () => 'installation' }));
vi.mock('@/lib/api', () => ({ API_BASE_URL: 'https://api.example', api: { createShareCredential: mocks.provision } }));
vi.mock('@/lib/importInbox', () => ({ saveShareScopeOwner: mocks.scopeOwner }));
import { SHARE_SESSION_KEY, useShareSession } from './useShareSession';
function Harness() { useShareSession(); return null; }
let renderer: ReactTestRenderer | undefined;
const expiry = () => new Date(Date.now() + 30 * 86400000).toISOString();
const credential = (scope: string) => ({ token: `token-${scope}`, account_scope_id: scope, expires_at: expiry(), location: 'Guam', is_public: false });
beforeEach(() => {
  vi.clearAllMocks(); mocks.storage.clear(); mocks.owner = 'owner-a'; mocks.subject = 'subject-a'; mocks.signedIn = true;
  mocks.clear.mockResolvedValue(true); mocks.configure.mockResolvedValue(undefined); mocks.scopeOwner.mockResolvedValue(undefined);
  mocks.provision.mockResolvedValue(credential('scope-a'));
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });
describe('native sharing session ownership', () => {
  it('preserves a valid same-account capability through offline foregrounds', async () => {
    mocks.storage.set(SHARE_SESSION_KEY, JSON.stringify({ ownerId: 'owner-a', subject: 'subject-a', accountScopeId: 'scope-a', expiresAt: expiry() }));
    mocks.provision.mockRejectedValue(new Error('Offline'));
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { mocks.foreground!('active'); });
    expect(mocks.clear).not.toHaveBeenCalled(); expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.storage.has(SHARE_SESSION_KEY)).toBe(true);
  });
  it('preserves a near-expiry capability if its refresh fails offline', async () => {
    mocks.storage.set(SHARE_SESSION_KEY, JSON.stringify({ ownerId: 'owner-a', subject: 'subject-a', accountScopeId: 'scope-a', expiresAt: new Date(Date.now() + 3600000).toISOString() }));
    mocks.provision.mockRejectedValue(new Error('Offline'));
    await act(async () => { renderer = create(<Harness />); });
    expect(mocks.provision).toHaveBeenCalledOnce(); expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.storage.has(SHARE_SESSION_KEY)).toBe(true);
  });
  it('serializes delayed account A configuration before clearing it and configuring B', async () => {
    let finishA!: () => void;
    mocks.configure.mockImplementationOnce(() => new Promise<void>((resolve) => { finishA = resolve; }));
    await act(async () => { renderer = create(<Harness />); });
    expect(mocks.configure).toHaveBeenCalledOnce();
    mocks.owner = 'owner-b'; mocks.subject = 'subject-b'; mocks.provision.mockResolvedValue(credential('scope-b'));
    await act(async () => renderer!.update(<Harness />));
    expect(mocks.configure).toHaveBeenCalledOnce();
    await act(async () => finishA());
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.configure).toHaveBeenCalledTimes(2);
    expect(mocks.clear.mock.invocationCallOrder[0]).toBeLessThan(mocks.configure.mock.invocationCallOrder[1]);
    expect(JSON.parse(mocks.storage.get(SHARE_SESSION_KEY)!)).toMatchObject({ ownerId: 'owner-b', subject: 'subject-b', accountScopeId: 'scope-b' });
  });
  it('clears A during a subject transition before B identity is available', async () => {
    mocks.storage.set(SHARE_SESSION_KEY, JSON.stringify({ ownerId: 'owner-a', subject: 'subject-a', accountScopeId: 'scope-a', expiresAt: expiry() }));
    await act(async () => { renderer = create(<Harness />); });
    mocks.owner = undefined; mocks.subject = 'subject-b';
    await act(async () => renderer!.update(<Harness />));
    expect(mocks.clear).toHaveBeenCalledOnce(); expect(mocks.provision).not.toHaveBeenCalled();
  });
  it('waits for a delayed old-account clear before configuring the next account', async () => {
    mocks.storage.set(SHARE_SESSION_KEY, JSON.stringify({ ownerId: 'owner-old', subject: 'subject-old', accountScopeId: 'scope-old', expiresAt: expiry() }));
    let finishClear!: () => void;
    mocks.clear.mockImplementationOnce(() => new Promise<void>((resolve) => { finishClear = resolve; }));
    await act(async () => { renderer = create(<Harness />); });
    mocks.owner = 'owner-b'; mocks.subject = 'subject-b'; mocks.provision.mockResolvedValue(credential('scope-b'));
    await act(async () => renderer!.update(<Harness />));
    expect(mocks.configure).not.toHaveBeenCalled();
    await act(async () => finishClear());
    expect(mocks.provision).toHaveBeenCalledOnce();
    expect(mocks.configure).toHaveBeenCalledOnce();
    expect(mocks.configure.mock.calls[0][2]).toBe('scope-b');
    expect(JSON.parse(mocks.storage.get(SHARE_SESSION_KEY)!)).toMatchObject({ ownerId: 'owner-b' });
  });
  it('does not apply an old network response after signing out', async () => {
    let finish!: (value: ReturnType<typeof credential>) => void;
    mocks.provision.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => { renderer = create(<Harness />); });
    mocks.signedIn = false;
    await act(async () => renderer!.update(<Harness />));
    await act(async () => finish(credential('scope-a')));
    expect(mocks.configure).not.toHaveBeenCalled(); expect(mocks.clear).toHaveBeenCalledOnce();
  });
});
