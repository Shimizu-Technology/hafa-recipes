import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { API_BASE_URL } from './apiConfig';

export type ClerkEnvironment = 'development' | 'production' | 'unknown';

export interface StoredMigrationGrant {
  grant: string;
  expiresAt: string;
}

export type MigrationGrantRedemption =
  | { status: 'success'; ticket: string }
  | { status: 'terminal' }
  | { status: 'retryable' };

export interface ProductionAccountOnboarding {
  status: 'created' | 'existing';
  appUserId: string;
}

export class ProductionAccountOnboardingError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ProductionAccountOnboardingError';
    this.status = status;
  }
}

const INSTALLATION_ID_KEY = 'hafa.clerk-transition.installation-id.v1';
const MIGRATION_GRANT_KEY = 'hafa.clerk-transition.grant.v1';
const MIGRATION_SIGNED_OUT_KEY = 'hafa.clerk-transition.signed-out.v1';
const GRANT_REFRESH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const GRANT_PATTERN = /^cmg_[A-Za-z0-9_-]{40,124}$/;
const INSTALLATION_PATTERN = /^cmi_[A-Za-z0-9_-]{40,124}$/;
const TICKET_PATTERN = /^.{20,2048}$/;
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
let migrationStateQueue: Promise<void> = Promise.resolve();

function serializeMigrationState<T>(operation: () => Promise<T>): Promise<T> {
  const result = migrationStateQueue.then(operation, operation);
  migrationStateQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function isValidSessionId(sessionId: string): boolean {
  return sessionId.length > 0 && sessionId.length <= 256;
}

export function clerkEnvironmentForKey(publishableKey: string): ClerkEnvironment {
  if (publishableKey.startsWith('pk_test_')) return 'development';
  if (publishableKey.startsWith('pk_live_')) return 'production';
  return 'unknown';
}

export function resolveClerkEnvironment(
  publishableKey: string,
  configured = process.env.EXPO_PUBLIC_CLERK_ENVIRONMENT,
  appEnvironment = process.env.EXPO_PUBLIC_APP_ENV,
): ClerkEnvironment {
  const inferred = clerkEnvironmentForKey(publishableKey);
  const resolved = (() => {
    if (!configured) return inferred;
    if (configured === 'development' || configured === 'production') {
      if (inferred !== 'unknown' && configured !== inferred) {
        throw new Error('Clerk environment does not match the publishable key');
      }
      return configured;
    }
    throw new Error('EXPO_PUBLIC_CLERK_ENVIRONMENT must be development or production');
  })();

  if (appEnvironment?.trim().toLowerCase() === 'production' && resolved !== 'production') {
    throw new Error('Production releases must use the Clerk production environment');
  }

  return resolved;
}

export const CLERK_ENVIRONMENT = resolveClerkEnvironment(
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
);

function isStoredMigrationGrant(value: unknown): value is StoredMigrationGrant {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredMigrationGrant>;
  return (
    typeof candidate.grant === 'string' &&
    GRANT_PATTERN.test(candidate.grant) &&
    typeof candidate.expiresAt === 'string' &&
    Number.isFinite(Date.parse(candidate.expiresAt))
  );
}

export function parseStoredMigrationGrant(
  serialized: string | null,
): StoredMigrationGrant | null {
  if (!serialized) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isStoredMigrationGrant(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function shouldRefreshMigrationGrant(
  storedGrant: StoredMigrationGrant | null,
  nowMs = Date.now(),
): boolean {
  if (!storedGrant) return true;
  return Date.parse(storedGrant.expiresAt) <= nowMs + GRANT_REFRESH_WINDOW_MS;
}

function randomInstallationId(): string {
  const bytes = Crypto.getRandomBytes(32);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `cmi_${hex}`;
}

export async function getOrCreateInstallationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  if (existing && INSTALLATION_PATTERN.test(existing)) return existing;

  const installationId = randomInstallationId();
  await SecureStore.setItemAsync(
    INSTALLATION_ID_KEY,
    installationId,
    SECURE_STORE_OPTIONS,
  );
  return installationId;
}

export async function loadMigrationGrant(): Promise<StoredMigrationGrant | null> {
  const optedOut = await SecureStore.getItemAsync(MIGRATION_SIGNED_OUT_KEY);
  if (optedOut) {
    await SecureStore.deleteItemAsync(MIGRATION_GRANT_KEY);
    return null;
  }

  const serialized = await SecureStore.getItemAsync(MIGRATION_GRANT_KEY);
  const grant = parseStoredMigrationGrant(serialized);
  if (!grant && serialized) {
    await SecureStore.deleteItemAsync(MIGRATION_GRANT_KEY);
  }
  return grant;
}

async function writeMigrationGrant(
  grant: StoredMigrationGrant,
): Promise<void> {
  if (!isStoredMigrationGrant(grant)) {
    throw new Error('Migration grant response is invalid');
  }
  await SecureStore.setItemAsync(
    MIGRATION_GRANT_KEY,
    JSON.stringify(grant),
    SECURE_STORE_OPTIONS,
  );
}

export async function saveMigrationGrantForSession(
  grant: StoredMigrationGrant,
  sessionId: string,
): Promise<boolean> {
  if (!isStoredMigrationGrant(grant)) {
    throw new Error('Migration grant response is invalid');
  }
  if (!isValidSessionId(sessionId)) {
    throw new Error('Clerk session is invalid');
  }

  return serializeMigrationState(async () => {
    const signedOutSessionId = await SecureStore.getItemAsync(MIGRATION_SIGNED_OUT_KEY);
    if (signedOutSessionId === '1' || signedOutSessionId === sessionId) {
      await clearMigrationGrant();
      return false;
    }

    // A different session means the person explicitly signed in again after
    // opting out. Only that new session may re-enable migration provisioning.
    if (signedOutSessionId) {
      await SecureStore.deleteItemAsync(MIGRATION_SIGNED_OUT_KEY);
    }
    await writeMigrationGrant(grant);
    return true;
  });
}

export async function clearMigrationGrant(): Promise<void> {
  await SecureStore.deleteItemAsync(MIGRATION_GRANT_KEY);
}

export async function markMigrationSignedOut(sessionId: string): Promise<void> {
  if (!isValidSessionId(sessionId)) {
    throw new Error('Clerk session is invalid');
  }

  // Set the opt-out first so a grant cannot silently sign the person back in
  // if the app is interrupted between these two SecureStore operations.
  await serializeMigrationState(async () => {
    try {
      await SecureStore.setItemAsync(
        MIGRATION_SIGNED_OUT_KEY,
        sessionId,
        SECURE_STORE_OPTIONS,
      );
    } finally {
      // Still remove the credential if writing the stronger opt-out marker fails.
      await clearMigrationGrant();
    }
  });
}

export async function requestMigrationGrant(
  sessionToken: string,
  installationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredMigrationGrant> {
  if (!sessionToken || !INSTALLATION_PATTERN.test(installationId)) {
    throw new Error('Migration grant request is invalid');
  }

  const response = await fetchImpl(`${API_BASE_URL}/api/auth/clerk-transition/grants`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ installation_id: installationId }),
  });

  if (!response.ok) {
    throw new Error(`Migration grant request failed (${response.status})`);
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') {
    throw new Error('Migration grant response is invalid');
  }
  const candidate = payload as { grant?: unknown; expires_at?: unknown };
  const grant = {
    grant: candidate.grant,
    expiresAt: candidate.expires_at,
  };
  if (!isStoredMigrationGrant(grant)) {
    throw new Error('Migration grant response is invalid');
  }
  return grant;
}

export async function redeemMigrationGrant(
  migrationGrant: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MigrationGrantRedemption> {
  if (!GRANT_PATTERN.test(migrationGrant)) return { status: 'terminal' };

  try {
    const response = await fetchImpl(`${API_BASE_URL}/api/auth/clerk-transition/redeem`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${migrationGrant}`,
      },
    });

    if (response.status === 410) return { status: 'terminal' };
    if (!response.ok) return { status: 'retryable' };

    const payload: unknown = await response.json();
    const ticket =
      payload && typeof payload === 'object'
        ? (payload as { ticket?: unknown }).ticket
        : null;
    if (typeof ticket !== 'string' || !TICKET_PATTERN.test(ticket)) {
      return { status: 'retryable' };
    }
    return { status: 'success', ticket };
  } catch {
    return { status: 'retryable' };
  }
}

/** Create an application owner only after the person explicitly chose sign-up. */
export async function onboardProductionAccount(
  sessionToken: string,
  installationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProductionAccountOnboarding> {
  if (!sessionToken || !/^cmi_[a-f0-9]{64}$/.test(installationId)) {
    throw new Error('Account setup request is invalid');
  }

  const response = await fetchImpl(`${API_BASE_URL}/api/auth/clerk-transition/onboard`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      installation_id: installationId,
      intent: 'create_account',
    }),
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload &&
      typeof payload.detail === 'string'
        ? payload.detail
        : 'Account setup could not be completed';
    throw new ProductionAccountOnboardingError(response.status, detail);
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    !('status' in payload) ||
    !('app_user_id' in payload) ||
    (payload.status !== 'created' && payload.status !== 'existing') ||
    typeof payload.app_user_id !== 'string' ||
    !/^app_[a-f0-9]{32}$/.test(payload.app_user_id)
  ) {
    throw new Error('Account setup response is invalid');
  }
  return { status: payload.status, appUserId: payload.app_user_id };
}
