export const callbackUrl = "hafababy://oauth-callback";
export function callbackNonce(url: string): string | null {
  const actual = new URL(url),
    expected = new URL(callbackUrl);
  if (actual.protocol !== expected.protocol || actual.host !== expected.host || actual.pathname !== expected.pathname)
    throw Error("Unexpected sign-in callback");
  if (actual.searchParams.has("error")) return null;
  const nonce = actual.searchParams.get("rotating_token_nonce");
  if (!nonce) throw Error("Sign-in callback could not be verified");
  return nonce;
}
