// Select only challenge methods actually offered by Clerk for this sign-in.
// Email codes can represent Device Trust, including its legacy needs_second_factor status.
export type CodeFactor =
  | { strategy: 'email_code'; emailAddressId: string; safeIdentifier: string }
  | { strategy: 'phone_code'; phoneNumberId: string; safeIdentifier: string }
  | { strategy: 'totp' }
  | { strategy: 'backup_code' };

export function supportedCodeFactors(factors: readonly { strategy: string }[] | null | undefined): CodeFactor[] {
  return (factors ?? []).filter((factor): factor is CodeFactor =>
    ['email_code', 'phone_code', 'totp', 'backup_code'].includes(factor.strategy),
  ).sort((a, b) => {
    const priority = ['totp', 'email_code', 'phone_code', 'backup_code'];
    return priority.indexOf(a.strategy) - priority.indexOf(b.strategy);
  });
}

export function secondFactorLabel(factor: CodeFactor): string {
  switch (factor.strategy) {
    case 'email_code': return `Email a code to ${factor.safeIdentifier}`;
    case 'phone_code': return `Text a code to ${factor.safeIdentifier}`;
    case 'totp': return 'Use an authenticator app';
    case 'backup_code': return 'Use a backup code';
  }
}
