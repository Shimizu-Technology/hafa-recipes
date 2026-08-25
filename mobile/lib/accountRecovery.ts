import type { EmailCodeFactor, SignInFirstFactor, SignInResource } from '@clerk/shared/types';

export type ExistingAccountRecoveryResult =
  | { status: 'complete'; sessionId: string }
  | { status: 'needs_second_factor' }
  | { status: 'incomplete' };

function isEmailCodeFactor(factor: SignInFirstFactor): factor is EmailCodeFactor {
  return factor.strategy === 'email_code';
}

/** Prove ownership of an existing verified mailbox without ever creating an account. */
export async function sendExistingAccountCode(
  signIn: SignInResource,
  email: string,
): Promise<void> {
  const identifier = email.trim().toLowerCase();
  if (!identifier) throw new Error('Enter the email address already connected to your recipes.');

  const attempt = await signIn.create({ identifier, signUpIfMissing: false });
  const emailFactor = attempt.supportedFirstFactors?.find(isEmailCodeFactor);
  if (!emailFactor?.emailAddressId) {
    throw new Error(
      'Email verification is not available for this account. Try your original sign-in method or contact support.',
    );
  }

  await signIn.prepareFirstFactor({
    strategy: 'email_code',
    emailAddressId: emailFactor.emailAddressId,
  });
}

export async function verifyExistingAccountCode(
  signIn: SignInResource,
  code: string,
): Promise<ExistingAccountRecoveryResult> {
  const verificationCode = code.trim();
  if (!/^\d{6}$/.test(verificationCode)) {
    throw new Error('Enter the six-digit verification code from your email.');
  }

  const attempt = await signIn.attemptFirstFactor({
    strategy: 'email_code',
    code: verificationCode,
  });

  if (attempt.status === 'complete' && attempt.createdSessionId) {
    return { status: 'complete', sessionId: attempt.createdSessionId };
  }
  if (attempt.status === 'needs_second_factor') return { status: 'needs_second_factor' };
  return { status: 'incomplete' };
}
