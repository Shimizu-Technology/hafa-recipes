import { it, expect, vi } from "vitest";
import {
  restartSignIn,
  safeAuthFailure,
  validVerificationCode,
  resendVerification,
  createSendGate,
} from "./auth-recovery";
import { inputTraits } from "./input-purpose";
it("requires exactly six ASCII digits and retains leading zeros", () => {
  for (const code of ["001234", "123456", " 123456 "]) expect(validVerificationCode(code)).toBe(true);
  for (const code of ["", "12345", "1234567", "12a456", "１２３４５６", "123 456"])
    expect(validVerificationCode(code)).toBe(false);
});
it("maps recognized verification failures without provider messages or identifier enumeration", () => {
  expect(
    safeAuthFailure({ errors: [{ code: "verification_expired", message: "private-email@example.test" }] }, "email_code")
  ).toContain("Request a new email code");
  expect(safeAuthFailure({ errors: [{ code: "verification_expired" }] }, "totp")).toContain("authenticator");
  expect(safeAuthFailure({ errors: [{ code: "form_code_incorrect" }] }, "signup")).toContain("did not verify");
  for (const code of ["form_identifier_not_found", "form_identifier_exists", "form_password_incorrect", "unknown"]) {
    const message = safeAuthFailure({ errors: [{ code, message: "sensitive provider content" }] });
    expect(message).toBe("Could not complete sign-in. Check your details and connection, then try again.");
    expect(message).not.toContain("sensitive");
  }
});
it("handles network/rate limits generically and reserves cooldown even after a failed send", () => {
  expect(safeAuthFailure({ status: 429 })).toContain("Wait");
  expect(safeAuthFailure({ code: "network_error" })).toContain("connection");
  let now = 1000;
  const gate = createSendGate(() => now);
  expect(gate.reserve()).toBe(31000);
  expect(gate.reserve()).toBeNull();
  now = 30500;
  expect(gate.remaining()).toBe(1);
  now = 31000;
  expect(gate.reserve()).toBe(61000);
});
it("resends client-trust/MFA through the current second factor, never recreates a sign-in or account", async () => {
  const second = vi.fn(async () => undefined),
    first = vi.fn(async () => undefined);
  const signIn = {
    supportedSecondFactors: [{ strategy: "email_code", emailAddressId: "factor-address" }],
    supportedFirstFactors: [{ strategy: "reset_password_email_code", emailAddressId: "reset-address" }],
    prepareSecondFactor: second,
    prepareFirstFactor: first,
  };
  await resendVerification("email_code", { signIn });
  expect(second).toHaveBeenCalledExactlyOnceWith({ strategy: "email_code", emailAddressId: "factor-address" });
  expect(first).not.toHaveBeenCalled();
  await resendVerification("reset", { signIn });
  expect(first).toHaveBeenCalledExactlyOnceWith({
    strategy: "reset_password_email_code",
    emailAddressId: "reset-address",
  });
});
it("prepares signup email verification on the existing signup resource; authenticator or missing factor does not send", async () => {
  const prepare = vi.fn(async () => undefined);
  await resendVerification("signup", { signUp: { prepareEmailAddressVerification: prepare } });
  expect(prepare).toHaveBeenCalledExactlyOnceWith({ strategy: "email_code" });
  await expect(resendVerification("totp", {})).rejects.toThrow("unsupported");
  await expect(resendVerification("email_code", {})).rejects.toThrow("unsupported");
  expect(prepare).toHaveBeenCalledTimes(1);
});
it("assigns correct platform traits only to auth fields, keeping ordinary numbers out of OTP autofill", () => {
  expect(inputTraits("verification-code", "ios")).toMatchObject({
    keyboardType: "number-pad",
    autoComplete: "one-time-code",
    textContentType: "oneTimeCode",
    maxLength: 6,
  });
  expect(inputTraits("verification-code", "android").autoComplete).toBe("2fa-app-otp");
  expect(inputTraits("email", "ios")).toMatchObject({
    autoComplete: "email",
    textContentType: "emailAddress",
    keyboardType: "email-address",
  });
  expect(inputTraits("current-password", "ios").textContentType).toBe("password");
  expect(inputTraits("new-password", "ios").textContentType).toBe("newPassword");
  expect(inputTraits(undefined, "ios", true)).toMatchObject({
    keyboardType: "decimal-pad",
    autoComplete: "off",
    textContentType: "none",
  });
});

it("returns to existing sign-in with the same email and no password/code or password-reset action", () => {
  expect(restartSignIn("owned@example.test")).toEqual({
    mode: "signin",
    email: "owned@example.test",
    password: "",
    code: "",
    verification: null,
  });
});
