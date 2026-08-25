import * as SecureStore from 'expo-secure-store';

export type AccountOnboardingState =
  | { status: 'idle' }
  | { status: 'pending'; sessionId: string; userId: string }
  | { status: 'failed'; sessionId: string; userId: string; error: unknown };

let onboardingState: AccountOnboardingState = { status: 'idle' };
const listeners = new Set<() => void>();
const ONBOARDING_INTENT_KEY = 'hafa.account-onboarding.intent.v1';
const VERIFIED_OWNER_KEY = 'hafa.account-access.verified-owner.v1';
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function setOnboardingState(next: AccountOnboardingState): void {
  onboardingState = next;
  listeners.forEach((listener) => listener());
}

export function subscribeToAccountOnboarding(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAccountOnboardingState(): AccountOnboardingState {
  return onboardingState;
}

export async function beginAccountOnboarding(sessionId: string, userId: string): Promise<void> {
  if (!sessionId || !userId) throw new Error('A completed account identity is required');
  await SecureStore.setItemAsync(
    ONBOARDING_INTENT_KEY,
    JSON.stringify({ sessionId, userId }),
    SECURE_STORE_OPTIONS,
  );
  setOnboardingState({ status: 'pending', sessionId, userId });
}

export async function restoreAccountOnboarding(sessionId: string, userId: string): Promise<void> {
  if (onboardingState.status !== 'idle') return;
  const stored = await SecureStore.getItemAsync(ONBOARDING_INTENT_KEY, SECURE_STORE_OPTIONS);
  if (!stored) return;
  // A new explicit sign-up can establish its in-memory intent while the read is in flight.
  if ((getAccountOnboardingState() as AccountOnboardingState).status !== 'idle') return;

  let intent: unknown;
  try {
    intent = JSON.parse(stored);
  } catch {
    throw new Error('The saved account setup request could not be verified');
  }

  if (
    !intent || typeof intent !== 'object' ||
    !('sessionId' in intent) || !('userId' in intent) ||
    typeof intent.sessionId !== 'string' || typeof intent.userId !== 'string'
  ) {
    throw new Error('The saved account setup request could not be verified');
  }

  if (intent.sessionId === sessionId && intent.userId === userId) {
    setOnboardingState({
      status: 'failed',
      sessionId,
      userId,
      error: new Error('Account setup was interrupted. Please try again.'),
    });
  } else {
    // An explicit account switch must never inherit another session's signup intent.
    await SecureStore.deleteItemAsync(ONBOARDING_INTENT_KEY, SECURE_STORE_OPTIONS);
  }
}

export function failAccountOnboarding(sessionId: string, error: unknown): void {
  if (onboardingState.status === 'pending' && onboardingState.sessionId === sessionId) {
    setOnboardingState({ status: 'failed', sessionId, userId: onboardingState.userId, error });
  }
}

export async function clearAccountOnboarding(sessionId?: string): Promise<void> {
  if (
    sessionId &&
    onboardingState.status !== 'idle' &&
    onboardingState.sessionId !== sessionId
  ) {
    return;
  }
  await SecureStore.deleteItemAsync(ONBOARDING_INTENT_KEY, SECURE_STORE_OPTIONS);
  setOnboardingState({ status: 'idle' });
}

/** Offline access is safe only after this exact session and owner passed the API boundary. */
export async function rememberVerifiedAccountOwner(sessionId: string, userId: string): Promise<void> {
  if (!sessionId || !userId) throw new Error('A verified account identity is required');
  await SecureStore.setItemAsync(
    VERIFIED_OWNER_KEY,
    JSON.stringify({ sessionId, userId }),
    SECURE_STORE_OPTIONS,
  );
}

export async function hasVerifiedAccountOwner(sessionId: string, userId: string): Promise<boolean> {
  if (!sessionId || !userId) return false;
  const stored = await SecureStore.getItemAsync(VERIFIED_OWNER_KEY, SECURE_STORE_OPTIONS);
  if (!stored) return false;
  try {
    const owner: unknown = JSON.parse(stored);
    const exactOwner = Boolean(
      owner && typeof owner === 'object' &&
      'sessionId' in owner && owner.sessionId === sessionId &&
      'userId' in owner && owner.userId === userId,
    );
    if (!exactOwner) await SecureStore.deleteItemAsync(VERIFIED_OWNER_KEY, SECURE_STORE_OPTIONS);
    return exactOwner;
  } catch {
    return false;
  }
}

export async function clearVerifiedAccountOwner(): Promise<void> {
  await SecureStore.deleteItemAsync(VERIFIED_OWNER_KEY, SECURE_STORE_OPTIONS);
}
