import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureValues = vi.hoisted(() => new Map<string, string>());
const bridge = vi.hoisted(() => ({
  isAvailable: true,
  configureSession: vi.fn(),
  updateSnapshot: vi.fn(),
  getSessionStatus: vi.fn(),
  flushPending: vi.fn(),
  clearSession: vi.fn(),
}));
const apiMock = vi.hoisted(() => ({
  getGrocerySnapshot: vi.fn(),
  issueGroceryWidgetCredential: vi.fn(),
  revokeGroceryWidgetCredential: vi.fn(),
}));

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: vi.fn(async (key: string) => secureValues.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureValues.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureValues.delete(key);
  }),
}));
vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
}));
vi.mock('hafa-widget-bridge', () => ({ HafaWidgetBridge: bridge }));
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/lib/apiConfig', () => ({ API_BASE_URL: 'https://api.example.com' }));

import {
  bindGroceryWidgetIdentity,
  parseStoredGroceryWidgetSession,
  shouldRenewGroceryWidgetSession,
  synchronizeGroceryWidget,
  toWidgetGrocerySnapshot,
  type StoredGroceryWidgetSession,
} from './groceryWidget';
import type { GrocerySnapshot } from '@/types/recipe';

const SESSION_KEY = 'hafa.grocery-widget.session-metadata.v1';
const LIST_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_ID = '22222222-2222-4222-8222-222222222222';

function snapshot(): GrocerySnapshot {
  return {
    account_scope_id: 'scope-one',
    list: {
      id: LIST_ID,
      name: 'Our list',
      is_shared: true,
      members: [
        {
          user_id: 'stable-private-user-id',
          display_name: 'Leon',
          joined_at: '2026-08-01T00:00:00Z',
          is_you: true,
        },
      ],
      revision: 4,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-23T00:00:00Z',
    },
    items: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Rice',
        quantity: '1',
        unit: 'bag',
        notes: null,
        checked: false,
        recipe_id: null,
        recipe_title: null,
        added_by_name: 'Leon',
        created_at: '2026-08-23T00:00:00Z',
        updated_at: '2026-08-23T00:00:00Z',
      },
    ],
    total: 1,
    unchecked: 1,
    checked: 0,
    server_time: '2026-08-23T00:00:00Z',
  };
}

function storedSession(overrides: Partial<StoredGroceryWidgetSession> = {}) {
  return {
    version: 1 as const,
    clerkUserId: 'clerk-user-one',
    credentialId: CREDENTIAL_ID,
    accountScopeId: 'scope-one',
    listId: LIST_ID,
    expiresAt: '2027-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('grocery widget lifecycle', () => {
  beforeEach(() => {
    secureValues.clear();
    vi.clearAllMocks();
    bridge.isAvailable = true;
    bridge.configureSession.mockResolvedValue(undefined);
    bridge.updateSnapshot.mockResolvedValue(undefined);
    bridge.flushPending.mockResolvedValue(undefined);
    bridge.clearSession.mockResolvedValue(true);
    bridge.getSessionStatus.mockResolvedValue({
      available: true,
      hasCredential: false,
      accountScopeId: null,
      listId: null,
      pendingCount: 0,
      requiresReconnect: false,
    });
  });

  it('serializes only widget-safe list data', () => {
    const serialized = JSON.stringify(toWidgetGrocerySnapshot(snapshot()));
    expect(serialized).not.toContain('members');
    expect(serialized).not.toContain('stable-private-user-id');
    expect(JSON.parse(serialized).list).toEqual({
      id: LIST_ID,
      name: 'Our list',
      is_shared: true,
      revision: 4,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-23T00:00:00Z',
    });
  });

  it('rejects malformed stored metadata and renews near expiry', () => {
    expect(parseStoredGroceryWidgetSession('{"version":1}')).toBeNull();
    const session = storedSession({ expiresAt: '2026-08-30T00:00:00Z' });
    expect(
      shouldRenewGroceryWidgetSession(session, Date.parse('2026-08-24T00:00:01Z')),
    ).toBe(true);
    expect(
      shouldRenewGroceryWidgetSession(session, Date.parse('2026-08-22T23:59:59Z')),
    ).toBe(false);
  });

  it('scrubs and self-revokes native state at an identity boundary', async () => {
    secureValues.set(SESSION_KEY, JSON.stringify(storedSession()));
    bridge.getSessionStatus.mockResolvedValue({
      available: true,
      hasCredential: true,
      accountScopeId: 'scope-one',
      listId: LIST_ID,
      pendingCount: 1,
      requiresReconnect: false,
    });

    await bindGroceryWidgetIdentity('clerk-user-two');

    expect(bridge.clearSession).toHaveBeenCalledWith(true);
    expect(secureValues.has(SESSION_KEY)).toBe(false);
  });

  it('preserves a healthy native session for the same Clerk identity', async () => {
    secureValues.set(SESSION_KEY, JSON.stringify(storedSession()));
    bridge.getSessionStatus.mockResolvedValue({
      available: true,
      hasCredential: true,
      accountScopeId: 'scope-one',
      listId: LIST_ID,
      pendingCount: 0,
      requiresReconnect: false,
    });

    await bindGroceryWidgetIdentity('clerk-user-one');

    expect(bridge.clearSession).not.toHaveBeenCalled();
    expect(secureValues.has(SESSION_KEY)).toBe(true);
  });

  it('scrubs an incomplete native session even for the same Clerk identity', async () => {
    secureValues.set(SESSION_KEY, JSON.stringify(storedSession()));
    bridge.getSessionStatus.mockResolvedValue({
      available: true,
      hasCredential: true,
      accountScopeId: 'scope-one',
      listId: '44444444-4444-4444-8444-444444444444',
      pendingCount: 1,
      requiresReconnect: false,
    });

    await bindGroceryWidgetIdentity('clerk-user-one');

    expect(bridge.clearSession).toHaveBeenCalledWith(true);
    expect(secureValues.has(SESSION_KEY)).toBe(false);
  });

  it('provisions a scoped credential without persisting its bearer in JavaScript', async () => {
    apiMock.getGrocerySnapshot.mockResolvedValue(snapshot());
    apiMock.issueGroceryWidgetCredential.mockResolvedValue({
      credential_id: CREDENTIAL_ID,
      token: `hfw_v1.${CREDENTIAL_ID}.abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890_-`,
      list_id: LIST_ID,
      account_scope_id: 'scope-one',
      scopes: ['grocery:read', 'grocery:set_checked'],
      issued_at: '2026-08-23T00:00:00Z',
      expires_at: '2026-11-21T00:00:00Z',
    });

    await synchronizeGroceryWidget('clerk-user-one');

    expect(apiMock.issueGroceryWidgetCredential).toHaveBeenCalledWith(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expect.any(Function),
    );
    expect(bridge.configureSession).toHaveBeenCalledWith(
      expect.stringMatching(/^hfw_v1\./),
      'https://api.example.com',
      expect.stringContaining('"account_scope_id":"scope-one"'),
    );
    const persisted = secureValues.get(SESSION_KEY) ?? '';
    expect(persisted).toContain(CREDENTIAL_ID);
    expect(persisted).not.toContain('hfw_v1');
  });

  it('flushes widget actions and reuses a healthy scoped credential', async () => {
    secureValues.set(SESSION_KEY, JSON.stringify(storedSession()));
    bridge.getSessionStatus.mockResolvedValue({
      available: true,
      hasCredential: true,
      accountScopeId: 'scope-one',
      listId: LIST_ID,
      pendingCount: 1,
      requiresReconnect: false,
    });
    apiMock.getGrocerySnapshot.mockResolvedValue(snapshot());

    await synchronizeGroceryWidget('clerk-user-one');

    expect(bridge.flushPending).toHaveBeenCalledOnce();
    expect(apiMock.issueGroceryWidgetCredential).not.toHaveBeenCalled();
    expect(bridge.updateSnapshot).toHaveBeenCalledOnce();
  });

  it('self-revokes a newly issued bearer when its scope is invalid', async () => {
    apiMock.getGrocerySnapshot.mockResolvedValue(snapshot());
    const invalidToken =
      `hfw_v1.${CREDENTIAL_ID}.abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890_-`;
    apiMock.issueGroceryWidgetCredential.mockResolvedValue({
      credential_id: CREDENTIAL_ID,
      token: invalidToken,
      list_id: '44444444-4444-4444-8444-444444444444',
      account_scope_id: 'scope-one',
      scopes: ['grocery:read', 'grocery:set_checked'],
      issued_at: '2026-08-23T00:00:00Z',
      expires_at: '2026-11-21T00:00:00Z',
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(synchronizeGroceryWidget('clerk-user-one')).rejects.toThrow(
      'credential response is invalid',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/grocery/widget/session',
      expect.objectContaining({
        method: 'DELETE',
        headers: { Authorization: `Bearer ${invalidToken}` },
      }),
    );
    expect(bridge.configureSession).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
