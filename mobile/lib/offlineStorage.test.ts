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
  assertGroceryStorageLease,
  bindOfflineGroceryIdentity,
  cacheGrocerySnapshot,
  cacheServerGrocerySnapshot,
  clearActiveGroceryScope,
  getCachedGrocerySnapshot,
  getGroceryStorageLease,
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
    const lease = getGroceryStorageLease();
    await cacheGrocerySnapshot(snapshot(), lease);
    const request = mutation();
    await addToSyncQueue(request, lease);

    expect(await getCachedGrocerySnapshot(lease)).toEqual(snapshot());
    expect((await getPendingSyncQueue(lease))[0].mutation).toEqual(request);
  });

  it('scrubs private data on direct account switch', async () => {
    await bindOfflineGroceryIdentity('clerk-user-a');
    const oldLease = getGroceryStorageLease();
    await cacheGrocerySnapshot(snapshot(), oldLease);
    await addToSyncQueue(mutation(), oldLease);
    await bindOfflineGroceryIdentity('clerk-user-b');
    const newLease = getGroceryStorageLease();

    expect(await getCachedGrocerySnapshot(newLease)).toBeNull();
    expect(await getPendingSyncQueue(newLease)).toEqual([]);
    await expect(cacheGrocerySnapshot(snapshot(), oldLease)).rejects.toThrow('identity');
    expect(() => assertGroceryStorageLease(oldLease)).toThrow('identity');
  });

  it('drops the previous list queue when server membership changes scope', async () => {
    await bindOfflineGroceryIdentity('clerk-user-a');
    const lease = getGroceryStorageLease();
    await cacheGrocerySnapshot(snapshot(), lease);
    await addToSyncQueue(mutation(), lease);
    await cacheGrocerySnapshot(snapshot('account-a', 'list-b'), lease);

    expect((await getCachedGrocerySnapshot(lease))?.list.id).toBe('list-b');
    expect(await getPendingSyncQueue(lease)).toEqual([]);
  });

  it('refuses to queue a mutation for an inactive list', async () => {
    await bindOfflineGroceryIdentity('clerk-user-a');
    const lease = getGroceryStorageLease();
    await cacheGrocerySnapshot(snapshot(), lease);
    await expect(addToSyncQueue(mutation('list-b'), lease)).rejects.toThrow('inactive list');
  });

  it('clears the active scope without removing the bound identity marker', async () => {
    await bindOfflineGroceryIdentity('clerk-user-a');
    const oldLease = getGroceryStorageLease();
    await cacheGrocerySnapshot(snapshot(), oldLease);
    await clearActiveGroceryScope(oldLease);
    const newLease = getGroceryStorageLease();

    expect(await getCachedGrocerySnapshot(newLease)).toBeNull();
    expect(storage.values.get('@hafa_grocery_identity_v2')).toBe('hash:clerk-user-a');
    await expect(cacheGrocerySnapshot(snapshot(), oldLease)).rejects.toThrow('scope changed');
  });

  it('atomically reapplies queued desired state over a server refresh', async () => {
    await bindOfflineGroceryIdentity('clerk-user-a');
    const lease = getGroceryStorageLease();
    const initial = snapshot();
    initial.items = [
      {
        id: 'item-a',
        name: 'Milk',
        quantity: null,
        unit: null,
        notes: null,
        checked: false,
        recipe_id: null,
        recipe_title: null,
        added_by_name: null,
        created_at: '2026-08-20T00:00:00Z',
        updated_at: '2026-08-20T00:00:00Z',
      },
    ];
    initial.total = 1;
    initial.unchecked = 1;
    await cacheGrocerySnapshot(initial, lease);
    await addToSyncQueue(
      {
        mutation_id: 'check-a',
        operation: 'set_checked',
        list_id: 'list-a',
        item_id: 'item-a',
        checked: true,
      },
      lease,
    );

    const refreshed = await cacheServerGrocerySnapshot(initial, lease);
    expect(refreshed.items[0].checked).toBe(true);
    expect(refreshed).toMatchObject({ checked: 1, unchecked: 0 });
  });

  it('finishes membership cleanup when a same-identity rebind starts before cleanup', async () => {
    await bindOfflineGroceryIdentity('clerk-user-a');
    const oldLease = getGroceryStorageLease();
    await cacheGrocerySnapshot(snapshot(), oldLease);
    await addToSyncQueue(mutation(), oldLease);

    const rebind = bindOfflineGroceryIdentity('clerk-user-a');
    const cleanup = clearActiveGroceryScope(oldLease);
    await Promise.all([cleanup, rebind]);

    const reboundLease = getGroceryStorageLease();
    expect(await getCachedGrocerySnapshot(reboundLease)).toBeNull();
    expect(await getPendingSyncQueue(reboundLease)).toEqual([]);
  });

  it('does not let a completed request from another identity clear the current scope', async () => {
    await bindOfflineGroceryIdentity('clerk-user-a');
    const oldLease = getGroceryStorageLease();
    await cacheGrocerySnapshot(snapshot(), oldLease);

    await bindOfflineGroceryIdentity('clerk-user-b');
    const currentLease = getGroceryStorageLease();
    await cacheGrocerySnapshot(snapshot('account-b', 'list-b'), currentLease);
    await clearActiveGroceryScope(oldLease);

    expect(await getCachedGrocerySnapshot(currentLease)).toEqual(
      snapshot('account-b', 'list-b'),
    );
  });
});

it('invalidates grocery leases, isolates pending work from B and restores it when A returns', async () => {
  const { offlineRecipes } = await import('./offlineRecipes');
  await offlineRecipes.bindSubject('same-subject'); await offlineRecipes.verify('same-subject', 'owner-a');
  await bindOfflineGroceryIdentity('same-subject');
  const a = getGroceryStorageLease(); await cacheGrocerySnapshot(snapshot(), a);
  const privateAdd = { ...mutation(), item: { name: 'Secret ingredient', recipe_id: 'private-a', recipe_title: 'A family secret' } };
  await addToSyncQueue(privateAdd, a);
  expect(await getPendingSyncQueue(a)).toHaveLength(1);
  await offlineRecipes.verify('same-subject', 'owner-b');
  expect(() => assertGroceryStorageLease(a)).toThrow();
  const b = getGroceryStorageLease(); await cacheGrocerySnapshot(snapshot('account-b', 'list-b'), b);
  expect(await getPendingSyncQueue(b)).toEqual([]);
  expect(JSON.stringify(await getCachedGrocerySnapshot(b))).not.toContain('A family secret');
  await offlineRecipes.verify('same-subject', 'owner-a');
  const returned = getGroceryStorageLease();
  await cacheServerGrocerySnapshot(snapshot(), returned);
  expect((await getPendingSyncQueue(returned))[0].mutation.item?.recipe_title).toBe('A family secret');
  await expect(addToSyncQueue(privateAdd, a)).rejects.toThrow();
  await offlineRecipes.clear();
});

it('migrates generation-stamped pending groceries only to their proven stable owner',async()=>{
 const {offlineRecipes}=await import('./offlineRecipes');await offlineRecipes.bindSubject('subject');await offlineRecipes.verify('subject','owner-a');await bindOfflineGroceryIdentity('subject');
 const legacy='@hafa_grocery_scope_v2:account-a:list-a:queue';
 storage.values.set(legacy,JSON.stringify([{mutation:mutation(),queued_at:'now',ownerGeneration:JSON.stringify(['owner-a','prior-generation'])},{mutation:{...mutation(),mutation_id:'b',item:{name:'B secret'}},queued_at:'now',ownerGeneration:JSON.stringify(['owner-b','old-b'])}]));
 const a=getGroceryStorageLease();await cacheServerGrocerySnapshot(snapshot(),a);expect((await getPendingSyncQueue(a)).map(entry=>entry.mutation.mutation_id)).toEqual(['mutation-a']);
 await offlineRecipes.verify('subject','owner-b');const b=getGroceryStorageLease();await cacheServerGrocerySnapshot(snapshot(),b);expect((await getPendingSyncQueue(b)).map(entry=>entry.mutation.mutation_id)).toEqual(['b']);
 await offlineRecipes.verify('subject','owner-a');const returned=getGroceryStorageLease();await cacheServerGrocerySnapshot(snapshot(),returned);expect((await getPendingSyncQueue(returned)).map(entry=>entry.mutation.mutation_id)).toEqual(['mutation-a']);await offlineRecipes.clear();
});
