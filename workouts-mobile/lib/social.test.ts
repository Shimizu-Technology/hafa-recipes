import { it, expect } from "vitest";
// Pure callback validation stays separately tested without loading native browser modules.
import { callbackNonce } from "./oauth-callback";
it("checks the Workouts callback origin before accepting its nonce", () => {
  expect(callbackNonce("hafaworkouts://oauth-callback?rotating_token_nonce=valid")).toBe("valid");
  expect(() => callbackNonce("hafarecipes://oauth-callback?rotating_token_nonce=valid")).toThrow("Unexpected");
  expect(callbackNonce("hafaworkouts://oauth-callback?error=access_denied")).toBeNull();
});
