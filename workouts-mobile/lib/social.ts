import type { SignInResource } from "@clerk/shared/types";
import * as WebBrowser from "expo-web-browser";
import { callbackNonce, callbackUrl } from "./oauth-callback";
export { callbackUrl } from "./oauth-callback";
// Existing-account sign-in deliberately does not transfer into sign-up.
export async function socialSignIn(signIn: SignInResource, strategy: "oauth_google" | "oauth_apple") {
  const result = await signIn.create({ strategy, redirectUrl: callbackUrl });
  const url = result.firstFactorVerification.externalVerificationRedirectURL;
  if (!url) throw new Error("Could not open sign-in provider");
  const browser = await WebBrowser.openAuthSessionAsync(url.toString(), callbackUrl);
  if (browser.type !== "success") return null;
  const nonce = callbackNonce(browser.url);
  if (!nonce) return null;
  await signIn.reload({ rotatingTokenNonce: nonce });
  return signIn;
}
