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

export function clerkEnvironmentForKey(publishableKey: string): ClerkEnvironment {
  if (publishableKey.startsWith('pk_test_')) return 'development';
  if (publishableKey.startsWith('pk_live_')) return 'production';
  return 'unknown';
}

export function resolveClerkEnvironment(
  publishableKey: string,
  configured = process.env.EXPO_PUBLIC_CLERK_ENVIRONMENT,
): ClerkEnvironment {
  const inferred = clerkEnvironmentForKey(publishableKey);
  if (!configured) return inferred;
  if (configured === 'development' || configured === 'production') {
    if (inferred !== 'unknown' && configured !== inferred) {
      throw new Error('Clerk environment does not match the publishable key');
    }
    return configured;
  }
  throw new Error('EXPO_PUBLIC_CLERK_ENVIRONMENT must be development or production');
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
  if (optedOut === '1') {
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

export async function saveMigrationGrant(
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

export async function clearMigrationGrant(): Promise<void> {
  await SecureStore.deleteItemAsync(MIGRATION_GRANT_KEY);
}

export async function clearMigrationSignOut(): Promise<void> {
  await SecureStore.deleteItemAsync(MIGRATION_SIGNED_OUT_KEY);
}

export async function markMigrationSignedOut(): Promise<void> {
  // Set the opt-out first so a grant cannot silently sign the person back in
  // if the app is interrupted between these two SecureStore operations.
  try {
    await SecureStore.setItemAsync(
      MIGRATION_SIGNED_OUT_KEY,
      '1',
      SECURE_STORE_OPTIONS,
    );
  } finally {
    // Still remove the credential if writing the stronger opt-out marker fails.
    await clearMigrationGrant();
  }
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
