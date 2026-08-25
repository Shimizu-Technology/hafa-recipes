export interface AccountAccessError {
  status: number | null;
  detail: string | null;
  kind: 'identity' | 'recovery' | 'network';
}

interface HttpErrorShape {
  response?: {
    status?: unknown;
    data?: { detail?: unknown };
  };
  status?: unknown;
}

interface SignInProvider {
  provider: string;
  verification?: { status?: string | null } | null;
}

export interface SignInMethodSnapshot {
  passwordEnabled?: boolean;
  externalAccounts?: readonly SignInProvider[];
}

export function classifyAccountAccessError(error: unknown): AccountAccessError {
  const candidate = error && typeof error === 'object' ? error as HttpErrorShape : null;
  const responseStatus = candidate?.response?.status ?? candidate?.status;
  const status = typeof responseStatus === 'number' ? responseStatus : null;
  const responseDetail = candidate?.response?.data?.detail;
  const detail = typeof responseDetail === 'string'
    ? responseDetail
    : error instanceof Error ? error.message : null;

  if (status === 409 && detail === 'Account recovery required') {
    return { status, detail, kind: 'recovery' };
  }
  if (status === 401 || status === 403 || status === 409) {
    return { status, detail, kind: 'identity' };
  }
  return { status, detail, kind: 'network' };
}

export function shouldRetryAccountRequest(failureCount: number, error: unknown): boolean {
  const { status } = classifyAccountAccessError(error);
  if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return false;
  }
  return failureCount < 2;
}

export function canUseVerifiedAccountOffline(
  error: AccountAccessError | null,
  exactOwnerWasVerified: boolean,
): boolean {
  return exactOwnerWasVerified && error?.kind === 'network' && (
    error.status === null || error.status === 408 || error.status === 429 || error.status >= 500
  );
}

export function hasDurableSignInMethod(user: SignInMethodSnapshot | null | undefined): boolean {
  if (!user) return false;
  if (user.passwordEnabled) return true;
  return (user.externalAccounts ?? []).some((account) => {
    const provider = account.provider.replace(/^oauth_/, '');
    return (provider === 'apple' || provider === 'google') &&
      account.verification?.status === 'verified';
  });
}

export function isCancelledAppleSignIn(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ERR_REQUEST_CANCELED',
  );
}

export function clerkErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const errors = 'errors' in error && Array.isArray(error.errors) ? error.errors : [];
  const first = errors[0];
  if (first && typeof first === 'object') {
    if (typeof first.longMessage === 'string' && first.longMessage) return first.longMessage;
    if (typeof first.message === 'string' && first.message) return first.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Production temporarily unmounts navigation while its owner boundary is verified. */
export function shouldNavigateAfterSessionActivation(environment: string): boolean {
  return environment !== 'production';
}
