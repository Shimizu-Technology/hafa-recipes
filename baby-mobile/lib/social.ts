import type { SignInResource } from "@clerk/shared/types";
import * as WebBrowser from "expo-web-browser";
import { callbackNonce, callbackUrl } from "./oauth-callback";
export { callbackUrl } from "./oauth-callback";
// Verify the provider first; account creation remains a separate explicit step.
export async function socialSignIn(signIn: SignInResource, strategy: "oauth_google" | "oauth_apple") {
  const result = await signIn.create({ strategy, redirectUrl: callbackUrl });
  const attempt = result.id;
  const url = result.firstFactorVerification.externalVerificationRedirectURL;
  if (!url) throw new Error("Could not open sign-in provider");
  const browser = await WebBrowser.openAuthSessionAsync(url.toString(), callbackUrl);
  if (browser.type !== "success") return null;
  const nonce = callbackNonce(browser.url);
  if (!attempt || signIn.id !== attempt) throw Error("The sign-in attempt changed.");
  try { await signIn.reload({ rotatingTokenNonce: nonce }); }
  catch (failure) {
    const errors = failure && typeof failure === "object" && "errors" in failure ? failure.errors : [];
    const transfer = Array.isArray(errors) && errors.some(error =>
      error && ["external_account_not_found", "sign_up_if_missing_transfer"].includes(error.code));
    if (!transfer || signIn.id !== attempt || signIn.firstFactorVerification.status !== "transferable") throw failure;
  }
  if (signIn.id !== attempt) throw Error("The sign-in attempt changed.");
  return signIn;
}
