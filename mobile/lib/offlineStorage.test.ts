import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    api: {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => void values.set(key, value)),
      removeItem: vi.fn(async (key: string) => void values.delete(key)),
      getAllKeys: vi.fn(async () => [...values.keys()]),
      multiRemove: vi.fn(async (keys: string[]) => keys.forEach((key) => values.delete(key))),
      multiSet: vi.fn(async (entries: [string, string][]) =>
        entries.forEach(([key, value]) => values.set(key, value)),
      ),
    },
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage.api }));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async (_algorithm: string, value: string) => `hash:${value}`),
}));

import {
  addToSyncQueue,
  bindOfflineGroceryIdentity,
  cacheGrocerySnapshot,
  clearActiveGroceryScope,
  getCachedGrocerySnapshot,
  getPendingSyncQueue,
} from './offlineStorage';
import type { GroceryMutationRequest, GrocerySnapshot } from '../types/recipe';

function snapshot(accountScopeId = 'account-a', listId = 'list-a'): GrocerySnapshot {
  return {
    account_scope_id: accountScopeId,
    list: {
      id: listId,
      name: 'Groceries',
      is_shared: false,
      members: [],
      revision: 1,
      created_at: '2026-08-20T00:00:00Z',
      updated_at: '2026-08-20T00:00:00Z',
    },
    items: [],
    total: 0,
    checked: 0,
    unchecked: 0,
    server_time: '2026-08-20T00:00:00Z',
  };
}

function mutation(listId = 'list-a'): GroceryMutationRequest {
  return {
    mutation_id: 'mutation-a',
    operation: 'add',
    list_id: listId,
    item_id: 'item-a',
    item: { name: 'Milk' },
  };
}

describe('account-scoped offline grocery storage', () => {
  beforeEach(() => {
    storage.values.clear();
    vi.clearAllMocks();
  });

  it('removes legacy unscoped data when binding the first loaded identity', async () => {
    storage.values.set('@hafa_grocery_list', '[{"name":"private"}]');
    await bindOfflineGroceryIdentity('clerk-user-a');

    expect(storage.values.has('@hafa_grocery_list')).toBe(false);
    expect(storage.values.get('@hafa_grocery_identity_v2')).toBe('hash:clerk-user-a');
  });

  it('persists a snapshot and exact durable mutation within its server scope', async () => {
    await bindOfflineGroceryIdentity('clerk-user-a');
    await cacheGrocerySnapshot(snapshot());
    const request = mutation();
    await addToSyncQueue(request);

    expect(await getCachedGrocerySnapshot()).toEqual(snapshot());
    expect((await getPendingSyncQueue())[0].mutation).toEqual(request);
  });

  it('scrubs private data on direct account switch', async () => {
    await bindOfflineGroceryIdentity('clerk-user-a');
    await cacheGrocerySnapshot(snapshot());
    await addToSyncQueue(mutation());
    await bindOfflineGroceryIdentity('clerk-user-b');

    expect(await getCachedGrocerySnapshot()).toBeNull();
    expect(await getPendingSyncQueue()).toEqual([]);
  });

  it('drops the previous list queue when server membership changes scope', async () => {
    await bindOfflineGroceryIdentity('clerk-user-a');
    await cacheGrocerySnapshot(snapshot());
    await addToSyncQueue(mutation());
    await cacheGrocerySnapshot(snapshot('account-a', 'list-b'));

    expect((await getCachedGrocerySnapshot())?.list.id).toBe('list-b');
    expect(await getPendingSyncQueue()).toEqual([]);
  });

  it('refuses to queue a mutation for an inactive list', async () => {
    await bindOfflineGroceryIdentity('clerk-user-a');
    await cacheGrocerySnapshot(snapshot());
    await expect(addToSyncQueue(mutation('list-b'))).rejects.toThrow('inactive list');
  });

  it('clears the active scope without removing the bound identity marker', async () => {
    await bindOfflineGroceryIdentity('clerk-user-a');
    await cacheGrocerySnapshot(snapshot());
    await clearActiveGroceryScope();

    expect(await getCachedGrocerySnapshot()).toBeNull();
    expect(storage.values.get('@hafa_grocery_identity_v2')).toBe('hash:clerk-user-a');
  });
});
