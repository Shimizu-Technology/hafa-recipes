import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';

const secureValues = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: vi.fn(async (key: string) => secureValues.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureValues.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureValues.delete(key);
  }),
}));

vi.mock('expo-crypto', () => ({
  getRandomBytes: vi.fn(() => Uint8Array.from({ length: 32 }, (_, index) => index)),
}));

vi.mock('./apiConfig', () => ({
  API_BASE_URL: 'https://api.example.test',
}));

import {
  clerkEnvironmentForKey,
  getOrCreateInstallationId,
  loadMigrationGrant,
  markMigrationSignedOut,
  parseStoredMigrationGrant,
  redeemMigrationGrant,
  resolveClerkEnvironment,
  requestMigrationGrant,
  saveMigrationGrantForSession,
  shouldRefreshMigrationGrant,
} from './clerkMigration';

const rawGrant = `cmg_${'a'.repeat(43)}`;
const expiresAt = '2026-11-15T00:00:00Z';

describe('Clerk migration state', () => {
  beforeEach(() => {
    secureValues.clear();
  });

  it('derives the environment only from recognized Clerk key prefixes', () => {
    expect(clerkEnvironmentForKey('pk_test_example')).toBe('development');
    expect(clerkEnvironmentForKey('pk_live_example')).toBe('production');
    expect(clerkEnvironmentForKey('not-a-clerk-key')).toBe('unknown');
    expect(resolveClerkEnvironment('pk_test_example', 'development')).toBe('development');
    expect(() => resolveClerkEnvironment('pk_test_example', 'production')).toThrow(
      'Clerk environment does not match the publishable key',
    );
    expect(() => resolveClerkEnvironment('pk_test_example', 'staging')).toThrow(
      'must be development or production',
    );
    expect(() =>
      resolveClerkEnvironment('pk_test_example', 'development', 'production'),
    ).toThrow('Production releases must use the Clerk production environment');
    expect(() =>
      resolveClerkEnvironment('pk_test_example', 'development', ' Production '),
    ).toThrow('Production releases must use the Clerk production environment');
    expect(
      resolveClerkEnvironment('pk_live_example', 'production', 'production'),
    ).toBe('production');
  });

  it('rejects malformed stored grants and refreshes grants near expiry', () => {
    expect(parseStoredMigrationGrant('not-json')).toBeNull();
    expect(parseStoredMigrationGrant(JSON.stringify({ grant: 'secret', expiresAt }))).toBeNull();

    const stored = { grant: rawGrant, expiresAt };
    expect(parseStoredMigrationGrant(JSON.stringify(stored))).toEqual(stored);
    expect(shouldRefreshMigrationGrant(stored, Date.parse('2026-09-01T00:00:00Z'))).toBe(false);
    expect(shouldRefreshMigrationGrant(stored, Date.parse('2026-10-20T00:00:00Z'))).toBe(true);
  });

  it('keeps one stable, cryptographically generated installation ID', async () => {
    const first = await getOrCreateInstallationId();
    const second = await getOrCreateInstallationId();

    expect(first).toMatch(/^cmi_[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it('makes a deliberate sign-out terminal until a later development sign-in', async () => {
    await saveMigrationGrantForSession({ grant: rawGrant, expiresAt }, 'sess_original');
    await markMigrationSignedOut('sess_original');
    expect(await loadMigrationGrant()).toBeNull();

    expect(
      await saveMigrationGrantForSession({ grant: rawGrant, expiresAt }, 'sess_original'),
    ).toBe(false);
    expect(
      await saveMigrationGrantForSession({ grant: rawGrant, expiresAt }, 'sess_new'),
    ).toBe(true);
    expect(await loadMigrationGrant()).toEqual({ grant: rawGrant, expiresAt });
  });

  it('rejects sign-out preparation if neither the opt-out nor grant deletion persists', async () => {
    vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('keychain write failed'));
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('keychain delete failed'));

    await expect(markMigrationSignedOut('sess_original')).rejects.toThrow(
      'keychain delete failed',
    );
  });

  it('honors the session opt-out if grant deletion is interrupted', async () => {
    await saveMigrationGrantForSession({ grant: rawGrant, expiresAt }, 'sess_original');
    vi.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(
      new Error('keychain delete interrupted'),
    );

    await expect(markMigrationSignedOut('sess_original')).rejects.toThrow(
      'keychain delete interrupted',
    );
    await expect(loadMigrationGrant()).resolves.toBeNull();
  });

  it('serializes an in-flight grant save with a newer sign-out decision', async () => {
    let releaseGrantWrite!: () => void;
    const grantWriteStarted = new Promise<void>((resolve) => {
      vi.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key, value) => {
        secureValues.set(key, value);
        resolve();
        await new Promise<void>((release) => {
          releaseGrantWrite = release;
        });
      });
    });

    const save = saveMigrationGrantForSession(
      { grant: rawGrant, expiresAt },
      'sess_original',
    );
    await grantWriteStarted;
    const signOut = markMigrationSignedOut('sess_original');
    releaseGrantWrite();

    await expect(Promise.all([save, signOut])).resolves.toEqual([true, undefined]);
    expect(await loadMigrationGrant()).toBeNull();
  });
});

describe('Clerk migration API transport', () => {
  it('creates a grant with the Clerk JWT in a header and installation ID in JSON', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        installation_id: `cmi_${'b'.repeat(64)}`,
      });
      return new Response(JSON.stringify({ grant: rawGrant, expires_at: expiresAt }), {
        status: 200,
      });
    });

    await expect(
      requestMigrationGrant('session-token', `cmi_${'b'.repeat(64)}`, fetchImpl),
    ).resolves.toEqual({ grant: rawGrant, expiresAt });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/api/auth/clerk-transition/grants',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('redeems only through the Authorization header and returns the ticket', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({ Authorization: `Bearer ${rawGrant}` });
      expect(init?.body).toBeUndefined();
      return new Response(JSON.stringify({ ticket: `ticket_${'x'.repeat(40)}` }), {
        status: 200,
      });
    });

    await expect(redeemMigrationGrant(rawGrant, fetchImpl)).resolves.toEqual({
      status: 'success',
      ticket: `ticket_${'x'.repeat(40)}`,
    });
  });

  it('distinguishes terminal replay from retryable provider and network failures', async () => {
    const gone = vi.fn(async () => new Response(null, { status: 410 }));
    const unavailable = vi.fn(async () => new Response(null, { status: 502 }));
    const offline = vi.fn(async () => {
      throw new TypeError('network unavailable');
    });

    await expect(redeemMigrationGrant(rawGrant, gone)).resolves.toEqual({ status: 'terminal' });
    await expect(redeemMigrationGrant(rawGrant, unavailable)).resolves.toEqual({ status: 'retryable' });
    await expect(redeemMigrationGrant(rawGrant, offline)).resolves.toEqual({ status: 'retryable' });
  });
});
