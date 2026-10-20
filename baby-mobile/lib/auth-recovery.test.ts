import { expect, it } from "vitest";
import { safeAuthFailure } from "./auth-recovery";

const clerk = (code: string) => ({ errors: [{ code, message: "provider text that must not be shown" }] });

it("explains fixable sign-in problems in plain language", () => {
  expect(safeAuthFailure(clerk("form_identifier_exists"))).toContain("already has a Håfa account");
  expect(safeAuthFailure(clerk("form_password_pwned"))).toContain("data breach");
  expect(safeAuthFailure(clerk("form_password_incorrect"))).toContain("doesn’t match");
  expect(safeAuthFailure(clerk("form_identifier_not_found"))).toContain("No Håfa account");
});

it("keeps code-step messages and never echoes provider text", () => {
  expect(safeAuthFailure(clerk("form_code_incorrect"), "signup")).toContain("did not verify");
  expect(safeAuthFailure(clerk("unexpected_thing"))).toBe(
    "Could not complete sign-in. Check your details and connection, then try again."
  );
  expect(safeAuthFailure(clerk("form_password_pwned"))).not.toContain("provider text");
});
