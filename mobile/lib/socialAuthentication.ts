import type { SignInResource } from '@clerk/shared/types';
import * as WebBrowser from 'expo-web-browser';

export type StrictSocialSignInResult =
  | { status: 'complete'; sessionId: string }
  | { status: 'account_not_found' }
  | { status: 'cancelled' }
  | { status: 'incomplete' };

function classifySignIn(signIn: SignInResource): StrictSocialSignInResult {
  if (signIn.status === 'complete' && signIn.createdSessionId) {
    return { status: 'complete', sessionId: signIn.createdSessionId };
  }
  if (signIn.firstFactorVerification?.status === 'transferable') {
    return { status: 'account_not_found' };
  }
  return { status: 'incomplete' };
}

export function verifiedOAuthCallbackNonce(callbackUrl: string, redirectUrl: string): string {
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
  if (!nonce) throw new Error('The sign-in callback could not be verified');
  return nonce;
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

  const nonce = verifiedOAuthCallbackNonce(result.url, redirectUrl);

  await signIn.reload({ rotatingTokenNonce: nonce });
  return classifySignIn(signIn);
}
