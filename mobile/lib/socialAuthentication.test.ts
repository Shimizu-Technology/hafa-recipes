import type { SignInResource } from '@clerk/shared/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: vi.fn() }));

import {
  signInWithAppleToken,
  signInWithBrowserProvider,
  verifiedOAuthCallbackNonce,
} from './socialAuthentication';

const callback = 'hafarecipes://oauth-callback';

function makeSignIn(status: 'complete' | 'transferable' | 'needs_first_factor') {
  const resource = {
    status: status === 'complete' ? 'complete' : 'needs_first_factor',
    createdSessionId: status === 'complete' ? 'sess_existing' : null,
    firstFactorVerification: {
      status: status === 'transferable' ? 'transferable' : 'verified',
      externalVerificationRedirectURL: new URL('https://accounts.example.test/authorize'),
    },
    create: vi.fn(),
    reload: vi.fn(),
  };
  resource.create.mockResolvedValue(resource);
  resource.reload.mockResolvedValue(resource);
  return resource as unknown as SignInResource;
}

describe('strict existing-account social sign-in', () => {
  it('exchanges a native Apple token exclusively through the sign-in resource', async () => {
    const signIn = makeSignIn('complete');
    await expect(signInWithAppleToken(signIn, 'apple-identity-token')).resolves.toEqual({
      status: 'complete', sessionId: 'sess_existing',
    });
    expect(signIn.create).toHaveBeenCalledWith({
      strategy: 'oauth_token_apple', token: 'apple-identity-token',
    });
  });

  it('reports unknown Apple identities without transferring into sign-up', async () => {
    const signIn = makeSignIn('transferable');
    await expect(signInWithAppleToken(signIn, 'apple-token')).resolves.toEqual({
      status: 'account_not_found',
    });
    expect(signIn.create).toHaveBeenCalledTimes(1);
  });

  it('reloads browser sign-in only after verifying the exact callback and nonce', async () => {
    const signIn = makeSignIn('complete');
    const openSession = vi.fn(async () => ({
      type: 'success' as const,
      url: `${callback}?rotating_token_nonce=safe-nonce`,
    }));

    await expect(signInWithBrowserProvider(signIn, 'oauth_google', callback, openSession))
      .resolves.toEqual({ status: 'complete', sessionId: 'sess_existing' });
    expect(signIn.reload).toHaveBeenCalledWith({ rotatingTokenNonce: 'safe-nonce' });
  });

  it('rejects malicious schemes, destinations, and missing nonces', () => {
    expect(() => verifiedOAuthCallbackNonce(
      'evil://oauth-callback?rotating_token_nonce=stolen', callback,
    )).toThrow('unexpected application');
    expect(() => verifiedOAuthCallbackNonce(
      'hafarecipes://other-callback?rotating_token_nonce=stolen', callback,
    )).toThrow('unexpected application');
    expect(() => verifiedOAuthCallbackNonce(callback, callback)).toThrow('could not be verified');
  });

  it('never reloads an unknown or cancelled browser sign-in', async () => {
    const signIn = makeSignIn('transferable');
    const completed = vi.fn(async () => ({
      type: 'success' as const,
      url: `${callback}?rotating_token_nonce=safe-nonce`,
    }));
    await expect(signInWithBrowserProvider(signIn, 'oauth_google', callback, completed))
      .resolves.toEqual({ status: 'account_not_found' });

    const cancelled = vi.fn(async () => ({
      type: 'cancel' as import('expo-web-browser').WebBrowserResultType,
    }));
    vi.mocked(signIn.reload).mockClear();
    await expect(signInWithBrowserProvider(signIn, 'oauth_google', callback, cancelled))
      .resolves.toEqual({ status: 'cancelled' });
    expect(signIn.reload).not.toHaveBeenCalled();
  });
});
