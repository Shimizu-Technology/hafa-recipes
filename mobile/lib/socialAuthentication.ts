import type { SignInResource } from '@clerk/shared/types';
import * as WebBrowser from 'expo-web-browser';

export type StrictSocialSignInResult =
  | { status: 'complete'; sessionId: string }
  | { status: 'account_not_found' }
  | { status: 'cancelled' }
  | { status: 'incomplete' };

export const MOBILE_OAUTH_CALLBACK_URL = 'hafarecipes://oauth-callback';

export type OAuthCallbackResult =
  | { status: 'verified'; nonce: string }
  | { status: 'cancelled' }
  | { status: 'provider_error' };

function classifySignIn(signIn: SignInResource): StrictSocialSignInResult {
  if (signIn.status === 'complete' && signIn.createdSessionId) {
    return { status: 'complete', sessionId: signIn.createdSessionId };
  }
  if (signIn.firstFactorVerification?.status === 'transferable') {
    return { status: 'account_not_found' };
  }
  return { status: 'incomplete' };
}

export function inspectOAuthCallback(callbackUrl: string, redirectUrl: string): OAuthCallbackResult {
  const callback = new URL(callbackUrl);
  const expected = new URL(redirectUrl);
  if (
    callback.protocol !== expected.protocol ||
    callback.host !== expected.host ||
    callback.pathname !== expected.pathname
  ) {
    throw new Error('The sign-in callback returned to an unexpected application');
  }
  const nonce = callback.searchParams.get('rotating_token_nonce');
  if (nonce) return { status: 'verified', nonce };

  const providerError = callback.searchParams.get('error');
  if (providerError === 'access_denied' || providerError === 'user_cancelled') {
    return { status: 'cancelled' };
  }
  if (providerError) return { status: 'provider_error' };
  throw new Error('The sign-in callback could not be verified');
}

/** Unlike Clerk's useSSO helper, this sign-in path never transfers into sign-up. */
export async function signInWithAppleToken(
  signIn: SignInResource,
  identityToken: string,
): Promise<StrictSocialSignInResult> {
  if (!identityToken) throw new Error('Apple did not provide a sign-in credential');
  const result = await signIn.create({ strategy: 'oauth_token_apple', token: identityToken });
  return classifySignIn(result);
}

export async function signInWithBrowserProvider(
  signIn: SignInResource,
  strategy: 'oauth_apple' | 'oauth_google',
  redirectUrl: string,
  openSession: typeof WebBrowser.openAuthSessionAsync = WebBrowser.openAuthSessionAsync,
): Promise<StrictSocialSignInResult> {
  const initial = await signIn.create({ strategy, redirectUrl });
  const verificationUrl = initial.firstFactorVerification.externalVerificationRedirectURL;
  if (!verificationUrl) throw new Error('The sign-in provider did not return a secure link');

  const result = await openSession(verificationUrl.toString(), redirectUrl);
  if (result.type !== 'success' || !result.url) return { status: 'cancelled' };

  const callback = inspectOAuthCallback(result.url, redirectUrl);
  if (callback.status === 'cancelled') return { status: 'cancelled' };
  if (callback.status === 'provider_error') return { status: 'incomplete' };

  await signIn.reload({ rotatingTokenNonce: callback.nonce });
  return classifySignIn(signIn);
}
