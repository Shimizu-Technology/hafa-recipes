export const callbackUrl = "hafababy://oauth-callback";
export function callbackNonce(url: string): string {
  const actual = new URL(url),
    expected = new URL(callbackUrl);
  if (actual.protocol !== expected.protocol || actual.host !== expected.host || actual.pathname !== expected.pathname)
    throw Error("Unexpected sign-in callback");
  const failure = actual.searchParams.get("error");
  const nonce = actual.searchParams.get("rotating_token_nonce");
  // A transfer is not a completed sign-in. Its nonce must still be verified
  // against this exact Clerk attempt before offering account creation.
  if (failure && !(nonce && ["external_account_not_found", "sign_up_if_missing_transfer"].includes(failure)))
    throw Object.assign(new Error("The sign-in provider could not complete this request."), { code: "oauth_provider_error" });
  if (!nonce) throw Error("Sign-in callback could not be verified");
  return nonce;
}
