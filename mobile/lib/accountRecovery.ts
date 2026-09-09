import type { SignInResource } from '@clerk/shared/types';

export type ExistingAccountPasswordRecoveryResult =
  | { status: 'complete'; sessionId: string }
  | { status: 'needs_second_factor' }
  | { status: 'incomplete' };

interface ClerkErrorShape {
  errors?: Array<{ code?: unknown }>;
}

export function isUnknownRecoveryAccountError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const errors = (error as ClerkErrorShape).errors;
  return Array.isArray(errors) && errors.some((item) =>
    item?.code === 'form_identifier_not_found',
  );
}

/** Start an existing-account password reset. This strategy can never create a user. */
export async function beginExistingAccountPasswordRecovery(
  signIn: SignInResource,
  email: string,
): Promise<void> {
  const identifier = email.trim().toLowerCase();
  if (!identifier) throw new Error('Enter the email address already connected to your recipes.');

  await signIn.create({
    strategy: 'reset_password_email_code',
    identifier,
  });
}

export async function completeExistingAccountPasswordRecovery(
  signIn: SignInResource,
  code: string,
  password: string,
): Promise<ExistingAccountPasswordRecoveryResult> {
  const verificationCode = code.trim();
  if (!/^\d{6}$/.test(verificationCode)) {
    throw new Error('Enter the six-digit verification code from your email.');
  }
  if (password.length < 8) {
    throw new Error('Create a password with at least eight characters.');
  }

  const completed = await signIn.attemptFirstFactor({
    strategy: 'reset_password_email_code',
    code: verificationCode,
    password,
  });

  if (completed.status === 'complete' && completed.createdSessionId) {
    return { status: 'complete', sessionId: completed.createdSessionId };
  }
  if (completed.status === 'needs_second_factor') return { status: 'needs_second_factor' };
  return { status: 'incomplete' };
}
