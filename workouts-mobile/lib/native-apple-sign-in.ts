import type { SignInResource } from "@clerk/shared/types";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";

// Match Recipes' native credential request while keeping existing-account sign-in strict.
export async function nativeAppleSignIn(signIn: Pick<SignInResource, "create">) {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: Crypto.randomUUID(),
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_REQUEST_CANCELED")
      return null;
    throw error;
  }
  if (!credential.identityToken)
    throw Object.assign(new Error("Apple sign-in credential unavailable"), { code: "apple_credential_missing" });
  return signIn.create({ strategy: "oauth_token_apple", token: credential.identityToken });
}
