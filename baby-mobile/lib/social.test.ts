import { afterEach, expect, it, vi } from "vitest";
const open = vi.hoisted(() => vi.fn());
vi.mock("expo-web-browser", () => ({ openAuthSessionAsync: open }));
import { socialSignIn } from "./social";
afterEach(() => vi.clearAllMocks());
function fixture() {
  const signIn = { id: "attempt_A", firstFactorVerification: { status: "unverified", externalVerificationRedirectURL: "https://accounts.google.com/" },
    create: vi.fn(), reload: vi.fn() };
  signIn.create.mockResolvedValue(signIn);
  return signIn;
}
it.each(["external_account_not_found", "sign_up_if_missing_transfer"])("handles verified transfer signal %s without creating an account", async code => {
  const signIn = fixture();
  open.mockResolvedValue({ type: "success", url: `hafababy://oauth-callback?error=${code}&rotating_token_nonce=verified` });
  signIn.reload.mockImplementation(async () => {
    signIn.firstFactorVerification.status = "transferable";
    throw { errors: [{ code }] };
  });
  expect(await socialSignIn(signIn as any, "oauth_google")).toBe(signIn);
  expect(signIn.reload).toHaveBeenCalledWith({ rotatingTokenNonce: "verified" });
});
it("never treats a callback error or a claimed transfer as verified without Clerk state and nonce", async () => {
  const signIn = fixture();
  open.mockResolvedValue({ type: "success", url: "hafababy://oauth-callback?error=external_account_not_found" });
  await expect(socialSignIn(signIn as any, "oauth_google")).rejects.toThrow();
  expect(signIn.reload).not.toHaveBeenCalled();
  open.mockResolvedValue({ type: "success", url: "hafababy://oauth-callback?error=external_account_not_found&rotating_token_nonce=unverified" });
  signIn.reload.mockRejectedValue({ errors: [{ code: "external_account_not_found" }] });
  await expect(socialSignIn(signIn as any, "oauth_google")).rejects.toEqual({ errors: [{ code: "external_account_not_found" }] });
});
it("rejects a callback for a superseded sign-in attempt", async () => {
  const signIn = fixture();
  open.mockImplementation(async () => { signIn.id = "attempt_B"; return { type: "success", url: "hafababy://oauth-callback?rotating_token_nonce=verified" }; });
  await expect(socialSignIn(signIn as any, "oauth_google")).rejects.toThrow("changed");
  expect(signIn.reload).not.toHaveBeenCalled();
});
