import { expect, it } from "vitest";
import { redirectSystemPath } from "../app/+native-intent";
it("preserves ordinary internal paths while rejecting dangerous incoming links", () => {
  expect(redirectSystemPath({path:"/record/1234-abcd",initial:true})).toBe("/record/1234-abcd");
  for (const path of ["/record/\u0000private", "/" + "x".repeat(8200), "/record?x=%C2%C2%C2", "//example.test/private", "hafababy://oauth-callback?code=fixture"]) {
    expect(redirectSystemPath({path,initial:true})).toBe("/");
  }
});

import { callbackNonce } from "./oauth-callback";
it("distinguishes provider failures from cancellation and rejects unverified callbacks", () => {
  expect(() => callbackNonce("hafababy://oauth-callback?error=access_denied&error_description=private-provider-detail"))
    .toThrow(expect.objectContaining({ code: "oauth_provider_error", message: "The sign-in provider could not complete this request." }));
  expect(() => callbackNonce("hafababy://oauth-callback")).toThrow("could not be verified");
  expect(() => callbackNonce("https://example.test/oauth-callback?rotating_token_nonce=secret")).toThrow("Unexpected");
  expect(callbackNonce("hafababy://oauth-callback?rotating_token_nonce=verified")).toBe("verified");
});
