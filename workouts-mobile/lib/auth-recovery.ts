export type Verification = "signup" | "email_code" | "totp" | "reset";
export const SEND_COOLDOWN_MS = 30000;
export function validVerificationCode(value: string) {
  return /^\d{6}$/.test(value.trim());
}
export function safeAuthFailure(error: unknown, verification: Verification | null = null) {
  const value =
    error && typeof error === "object"
      ? (error as {
          errors?: Array<{ code?: unknown }>;
          code?: unknown;
          status?: unknown;
          statusCode?: unknown;
          name?: unknown;
        })
      : {};
  const codes = [
    value.code,
    ...(Array.isArray(value.errors) ? value.errors.slice(0, 12).map((item) => item?.code) : []),
  ].filter((code) => typeof code === "string" && code.length <= 64);
  if (verification && codes.some((code) => ["verification_expired", "form_code_expired"].includes(String(code))))
    return verification === "totp"
      ? "That code expired. Use the current code from your authenticator app."
      : "That code expired. Request a new email code, then enter the newest one.";
  if (
    verification &&
    codes.some((code) => ["form_code_incorrect", "verification_failed", "form_code_invalid"].includes(String(code)))
  )
    return "That code did not verify. Check the six digits and use the newest code, then try again.";
  if (
    value.status === 429 ||
    value.statusCode === 429 ||
    codes.some((code) => ["too_many_requests", "rate_limit_exceeded"].includes(String(code)))
  )
    return "Too many attempts. Wait a little before trying again; requesting codes repeatedly will not help.";
  if (
    codes.some((code) => ["network_error", "network_request_failed", "api_connection_error"].includes(String(code))) ||
    value.name === "TypeError"
  )
    return "Could not reach sign-in. Check your connection, then retry this step.";
  return verification
    ? "Could not verify this step. Retry, request a new email code if available, or return to sign-in."
    : "Could not complete sign-in. Check your details and connection, then try again.";
}
interface Factor {
  strategy: string;
  emailAddressId?: string;
}
export interface VerificationResources {
  signIn?: {
    supportedSecondFactors?: Factor[] | null;
    supportedFirstFactors?: Factor[] | null;
    prepareSecondFactor(params: { strategy: "email_code"; emailAddressId?: string }): Promise<unknown>;
    prepareFirstFactor(params: { strategy: "reset_password_email_code"; emailAddressId: string }): Promise<unknown>;
  };
  signUp?: { prepareEmailAddressVerification(params: { strategy: "email_code" }): Promise<unknown> };
}
export async function resendVerification(kind: Verification, resources: VerificationResources) {
  if (kind === "signup" && resources.signUp) {
    await resources.signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    return;
  }
  if (kind === "email_code" && resources.signIn) {
    const factor = resources.signIn.supportedSecondFactors?.find((f) => f.strategy === "email_code");
    if (!factor) throw Error("unsupported");
    await resources.signIn.prepareSecondFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
    return;
  }
  if (kind === "reset" && resources.signIn) {
    const factor = resources.signIn.supportedFirstFactors?.find((f) => f.strategy === "reset_password_email_code");
    if (!factor?.emailAddressId) throw Error("unsupported");
    await resources.signIn.prepareFirstFactor({
      strategy: "reset_password_email_code",
      emailAddressId: factor.emailAddressId,
    });
    return;
  }
  throw Error("unsupported");
}
export function remainingCooldown(until: number, now: number) {
  return Math.max(0, Math.ceil((until - now) / 1000));
}
export function createSendGate(now = Date.now) {
  let until = 0;
  return {
    reserve() {
      if (now() < until) return null;
      until = now() + SEND_COOLDOWN_MS;
      return until;
    },
    remaining() {
      return remainingCooldown(until, now());
    },
  };
}
export function restartSignIn(email: string) {
  return { mode: "signin" as const, email, password: "", code: "", verification: null };
}
