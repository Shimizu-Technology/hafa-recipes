import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';

const secureValues = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: vi.fn(async (key: string) => secureValues.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { secureValues.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { secureValues.delete(key); }),
}));

import {
  beginAccountOnboarding,
  clearAccountOnboarding,
  clearVerifiedAccountOwner,
  failAccountOnboarding,
  getAccountOnboardingState,
  hasVerifiedAccountOwner,
  rememberVerifiedAccountOwner,
  restoreAccountOnboarding,
  subscribeToAccountOnboarding,
} from './accountOnboarding';

describe('durable explicit account onboarding intent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAccountOnboarding();
    secureValues.clear();
  });

  it('persists the exact session and user before allowing onboarding', async () => {
    await beginAccountOnboarding('sess_new', 'user_new');
    expect(getAccountOnboardingState()).toEqual({
      status: 'pending', sessionId: 'sess_new', userId: 'user_new',
    });
    expect([...secureValues.values()]).toEqual([
      JSON.stringify({ sessionId: 'sess_new', userId: 'user_new' }),
    ]);
  });

  it('fails closed if the explicit intent cannot be saved securely', async () => {
    vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('keychain unavailable'));
    await expect(beginAccountOnboarding('sess_new', 'user_new')).rejects.toThrow('keychain unavailable');
    expect(getAccountOnboardingState()).toEqual({ status: 'idle' });
  });

  it('restores an interrupted setup only for the exact original session and owner', async () => {
    secureValues.set(
      'hafa.account-onboarding.intent.v1',
      JSON.stringify({ sessionId: 'sess_original', userId: 'user_original' }),
    );
    await restoreAccountOnboarding('sess_other', 'user_other');
    expect(getAccountOnboardingState()).toEqual({ status: 'idle' });
    expect(secureValues.has('hafa.account-onboarding.intent.v1')).toBe(false);

    secureValues.set(
      'hafa.account-onboarding.intent.v1',
      JSON.stringify({ sessionId: 'sess_original', userId: 'user_original' }),
    );
    await restoreAccountOnboarding('sess_original', 'user_original');
    expect(getAccountOnboardingState()).toEqual(expect.objectContaining({
      status: 'failed', sessionId: 'sess_original', userId: 'user_original',
    }));
  });

  it('rejects corrupted persisted intent rather than starting a different account', async () => {
    secureValues.set('hafa.account-onboarding.intent.v1', '{bad json');
    await expect(restoreAccountOnboarding('sess_original', 'user_original'))
      .rejects.toThrow('could not be verified');
    expect(getAccountOnboardingState()).toEqual({ status: 'idle' });
  });

  it('does not let another session fail or clear the current owner’s intent', async () => {
    await beginAccountOnboarding('sess_original', 'user_original');
    failAccountOnboarding('sess_other', new Error('wrong account'));
    await clearAccountOnboarding('sess_other');
    expect(getAccountOnboardingState()).toEqual({
      status: 'pending', sessionId: 'sess_original', userId: 'user_original',
    });
    expect(secureValues.size).toBe(1);
  });

  it('notifies subscribers and deletes durable state only after setup succeeds', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAccountOnboarding(listener);
    await beginAccountOnboarding('sess_new', 'user_new');
    failAccountOnboarding('sess_new', new Error('temporarily unavailable'));
    await clearAccountOnboarding('sess_new');
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(3);
    expect(secureValues.size).toBe(0);
    expect(getAccountOnboardingState()).toEqual({ status: 'idle' });
  });

  it('permits offline access only for the exact previously verified session and owner', async () => {
    await rememberVerifiedAccountOwner('sess_verified', 'user_verified');
    await expect(hasVerifiedAccountOwner('sess_verified', 'user_verified')).resolves.toBe(true);
    await expect(hasVerifiedAccountOwner('sess_other', 'user_verified')).resolves.toBe(false);
    await expect(hasVerifiedAccountOwner('sess_verified', 'user_other')).resolves.toBe(false);

    await clearVerifiedAccountOwner();
    await expect(hasVerifiedAccountOwner('sess_verified', 'user_verified')).resolves.toBe(false);
  });

  it('fails closed for corrupted offline-owner verification', async () => {
    secureValues.set('hafa.account-access.verified-owner.v1', 'not json');
    await expect(hasVerifiedAccountOwner('sess_verified', 'user_verified')).resolves.toBe(false);
  });
});
