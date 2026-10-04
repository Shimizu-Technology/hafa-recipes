import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  owner: 'owner-a' as string | undefined, subject: 'subject-a', signedIn: true,
  storage: new Map<string, string>(), foreground: null as ((state: string) => void) | null,
  clear: vi.fn(), configure: vi.fn(), preferences: vi.fn(), provision: vi.fn(), scopeOwner: vi.fn(), disclosure: vi.fn(),
  settings: { ready: true, isPublic: true, location: 'Guam' },
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
vi.mock('./useImportPreferences', () => ({ useImportPreferences: () => mocks.settings }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('@/modules/hafa-share-bridge/src', () => ({ configurePreferences: mocks.preferences, clearSession: mocks.clear, configureSession: mocks.configure, getInstallationId: async () => 'installation' }));
vi.mock('@/lib/api', () => ({ API_BASE_URL: 'https://api.example', api: { createShareCredential: mocks.provision, getPublishingDisclosure: mocks.disclosure } }));
vi.mock('@/lib/importInbox', () => ({ saveShareScopeOwner: mocks.scopeOwner }));
import { SHARE_SESSION_KEY, useShareSession } from './useShareSession';
function Harness() { useShareSession(); return null; }
let renderer: ReactTestRenderer | undefined;
const expiry = () => new Date(Date.now() + 30 * 86400000).toISOString();
const credential = (scope: string) => ({ token: `token-${scope}`, account_scope_id: scope, expires_at: expiry(), location: 'Guam', is_public: true });
beforeEach(() => {
  vi.clearAllMocks(); mocks.storage.clear(); mocks.owner = 'owner-a'; mocks.subject = 'subject-a'; mocks.signedIn = true;
  mocks.settings = { ready: true, isPublic: true, location: 'Guam' }; mocks.disclosure.mockResolvedValue({ requires_acceptance: false });
  mocks.preferences.mockResolvedValue(undefined); mocks.clear.mockResolvedValue(true); mocks.configure.mockResolvedValue(undefined); mocks.scopeOwner.mockResolvedValue(undefined);
  mocks.provision.mockResolvedValue(credential('scope-a'));
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });
describe('native sharing session ownership', () => {
  it('preserves a valid same-account capability through offline foregrounds', async () => {
    mocks.storage.set(SHARE_SESSION_KEY, JSON.stringify({ ownerId: 'owner-a', subject: 'subject-a', accountScopeId: 'scope-a', expiresAt: expiry(), policyVersion: 2, location: 'Guam', isPublic: true }));
    mocks.provision.mockRejectedValue(new Error('Offline'));
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { mocks.foreground!('active'); });
    expect(mocks.clear).not.toHaveBeenCalled(); expect(mocks.provision).not.toHaveBeenCalled();
    expect(mocks.storage.has(SHARE_SESSION_KEY)).toBe(true);
  });
  it('upgrades a healthy legacy private session instead of caching the bug for 30 days', async () => {
    mocks.storage.set(SHARE_SESSION_KEY, JSON.stringify({ ownerId: 'owner-a', subject: 'subject-a', accountScopeId: 'scope-a', expiresAt: expiry() }));
    await act(async () => { renderer = create(<Harness />); });
    expect(mocks.provision).toHaveBeenCalledWith(expect.objectContaining({ is_public: true }), expect.any(Function));
    expect(mocks.preferences).toHaveBeenCalledWith('scope-a', 'Guam', true);
    expect(JSON.parse(mocks.storage.get(SHARE_SESSION_KEY)!)).toMatchObject({ policyVersion: 2, isPublic: true });
  });
  it('keeps a public capture queued for consent using a private capability until disclosure is accepted', async () => {
    mocks.disclosure.mockResolvedValue({ requires_acceptance: true });
    mocks.provision.mockResolvedValue({ ...credential('scope-a'), is_public: false });
    await act(async () => { renderer = create(<Harness />); });
    expect(mocks.provision).toHaveBeenCalledWith(expect.objectContaining({ is_public: false }), expect.any(Function));
    expect(mocks.configure.mock.calls[0][5]).toBe(false);
    expect(mocks.preferences).toHaveBeenCalledWith('scope-a', 'Guam', true);
  });
  it('preserves private intent without any credential when first provisioning fails offline', async () => {
    mocks.settings.isPublic = false;
    mocks.provision.mockRejectedValue(new Error('Offline'));
    await act(async () => { renderer = create(<Harness />); });
    expect(mocks.preferences).toHaveBeenCalledWith('', 'Guam', false);
    expect(mocks.preferences.mock.invocationCallOrder[0]).toBeLessThan(mocks.provision.mock.invocationCallOrder[0]);
    expect(mocks.configure).not.toHaveBeenCalled();
  });
  it('applies explicit private intent before an offline credential refresh', async () => {
    mocks.storage.set(SHARE_SESSION_KEY, JSON.stringify({ ownerId: 'owner-a', subject: 'subject-a', accountScopeId: 'scope-a', expiresAt: expiry(), policyVersion: 2, location: 'Guam', isPublic: true }));
    mocks.settings.isPublic = false;
    mocks.provision.mockRejectedValue(new Error('Offline'));
    await act(async () => { renderer = create(<Harness />); });
    expect(mocks.preferences).toHaveBeenCalledWith('scope-a', 'Guam', false);
    expect(mocks.provision).toHaveBeenCalledWith(expect.objectContaining({ is_public: false }), expect.any(Function));
    expect(mocks.clear).not.toHaveBeenCalled();
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
    mocks.storage.set(SHARE_SESSION_KEY, JSON.stringify({ ownerId: 'owner-a', subject: 'subject-a', accountScopeId: 'scope-a', expiresAt: expiry(), policyVersion: 2, location: 'Guam', isPublic: true }));
    await act(async () => { renderer = create(<Harness />); });
    mocks.owner = undefined; mocks.subject = 'subject-b';
    await act(async () => renderer!.update(<Harness />));
    expect(mocks.clear).toHaveBeenCalledOnce(); expect(mocks.provision).not.toHaveBeenCalled();
  });
  it('waits for a delayed old-account clear before configuring the next account', async () => {
    mocks.storage.set(SHARE_SESSION_KEY, JSON.stringify({ ownerId: 'owner-old', subject: 'subject-old', accountScopeId: 'scope-old', expiresAt: expiry(), policyVersion: 2, location: 'Guam', isPublic: true }));
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
