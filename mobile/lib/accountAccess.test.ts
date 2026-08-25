import { describe, expect, it } from 'vitest';

import {
  classifyAccountAccessError,
  canUseVerifiedAccountOffline,
  clerkErrorMessage,
  hasDurableSignInMethod,
  isCancelledAppleSignIn,
  shouldNavigateAfterSessionActivation,
  shouldRetryAccountRequest,
} from './accountAccess';

describe('account identity errors', () => {
  it('distinguishes recovery conflicts from forbidden, unauthorized, and transport failures', () => {
    expect(classifyAccountAccessError({
      response: { status: 409, data: { detail: 'Account recovery required' } },
    })).toEqual({ status: 409, detail: 'Account recovery required', kind: 'recovery' });
    expect(classifyAccountAccessError({ response: { status: 403 } }).kind).toBe('identity');
    expect(classifyAccountAccessError({ status: 401 }).kind).toBe('identity');
    expect(classifyAccountAccessError(new Error('offline')).kind).toBe('network');
  });

  it('never retries terminal authentication failures but retries temporary failures', () => {
    for (const status of [401, 403, 404, 409]) {
      expect(shouldRetryAccountRequest(0, { response: { status } })).toBe(false);
    }
    expect(shouldRetryAccountRequest(0, { response: { status: 429 } })).toBe(true);
    expect(shouldRetryAccountRequest(1, new Error('offline'))).toBe(true);
    expect(shouldRetryAccountRequest(2, new Error('offline'))).toBe(false);
  });

  it('permits verified offline owners only for network failures, never identity rejections', () => {
    const network = classifyAccountAccessError(new Error('offline'));
    expect(canUseVerifiedAccountOffline(network, true)).toBe(true);
    expect(canUseVerifiedAccountOffline(network, false)).toBe(false);

    for (const status of [401, 403, 409]) {
      const rejected = classifyAccountAccessError({ response: { status } });
      expect(canUseVerifiedAccountOffline(rejected, true)).toBe(false);
    }
  });

  it('recognizes only verified Apple/Google accounts or a usable password', () => {
    expect(hasDurableSignInMethod(null)).toBe(false);
    expect(hasDurableSignInMethod({ passwordEnabled: true })).toBe(true);
    expect(hasDurableSignInMethod({
      externalAccounts: [{ provider: 'apple', verification: { status: 'verified' } }],
    })).toBe(true);
    expect(hasDurableSignInMethod({
      externalAccounts: [{ provider: 'oauth_apple', verification: { status: 'verified' } }],
    })).toBe(true);
    expect(hasDurableSignInMethod({
      externalAccounts: [{ provider: 'google', verification: { status: 'unverified' } }],
    })).toBe(false);
  });

  it('handles Apple cancellation and Clerk-friendly errors', () => {
    expect(isCancelledAppleSignIn({ code: 'ERR_REQUEST_CANCELED' })).toBe(true);
    expect(isCancelledAppleSignIn(new Error('different'))).toBe(false);
    expect(clerkErrorMessage({ errors: [{ longMessage: 'Try the original account' }] }, 'fallback'))
      .toBe('Try the original account');
    expect(clerkErrorMessage({}, 'fallback')).toBe('fallback');
  });

  it('defers production navigation until the private-account gate remounts the navigator', () => {
    expect(shouldNavigateAfterSessionActivation('production')).toBe(false);
    expect(shouldNavigateAfterSessionActivation('development')).toBe(true);
    expect(shouldNavigateAfterSessionActivation('unknown')).toBe(true);
  });
});
