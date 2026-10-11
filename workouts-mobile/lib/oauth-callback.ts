import { safeIncomingEncoding } from "./native-intent";
export const callbackUrl = "hafaworkouts://oauth-callback";
export function callbackNonce(url: string): string | null {
  if (!safeIncomingEncoding(url)) throw new Error("Malformed sign-in callback");
  const actual = new URL(url);
  const expected = new URL(callbackUrl);
  if (actual.protocol !== expected.protocol || actual.host !== expected.host || actual.pathname !== expected.pathname)
    throw new Error("Unexpected sign-in callback");
  if (actual.searchParams.has("error")) return null;
  const nonce = actual.searchParams.get("rotating_token_nonce");
  if (!nonce) throw new Error("Sign-in callback could not be verified");
  return nonce;
}
