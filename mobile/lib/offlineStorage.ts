/** Account-scoped grocery snapshots and durable mutation queue. */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { applyOptimisticGroceryMutation } from './grocerySync';
import type { GroceryMutationRequest, GrocerySnapshot } from '../types/recipe';

const IDENTITY_KEY = '@hafa_grocery_identity_v2';
const ACTIVE_SCOPE_KEY = '@hafa_grocery_active_scope_v2';
const SCOPE_PREFIX = '@hafa_grocery_scope_v2:';
const LEGACY_KEYS = ['@hafa_grocery_list', '@hafa_grocery_count', '@hafa_pending_sync', '@hafa_last_sync'];

interface GroceryStorageScope {
  accountScopeId: string;
  listId: string;
}

export interface PendingGroceryMutation {
  mutation: GroceryMutationRequest;
  queued_at: string;
}

export interface GroceryStorageLease {
  readonly identityEpoch: number;
  readonly scopeEpoch: number;
}

let storageChain: Promise<unknown> = Promise.resolve();
let identityEpoch = 0;
let scopeEpoch = 0;
let identityReady = false;

export function assertGroceryStorageLease(lease: GroceryStorageLease): void {
  if (
    !identityReady ||
    lease.identityEpoch !== identityEpoch ||
    lease.scopeEpoch !== scopeEpoch
  ) {
    throw new Error('Grocery storage identity or list scope changed.');
  }
}

export function getGroceryStorageLease(): GroceryStorageLease {
  const lease = { identityEpoch, scopeEpoch };
  assertGroceryStorageLease(lease);
  return lease;
}

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageChain.then(operation, operation);
  storageChain = result.then(() => undefined, () => undefined);
  return result;
}

function scopeId(scope: GroceryStorageScope): string {
  return `${encodeURIComponent(scope.accountScopeId)}:${encodeURIComponent(scope.listId)}`;
}

function snapshotKey(scope: GroceryStorageScope): string {
  return `${SCOPE_PREFIX}${scopeId(scope)}:snapshot`;
}

function queueKey(scope: GroceryStorageScope): string {
  return `${SCOPE_PREFIX}${scopeId(scope)}:queue`;
}

function lastSyncKey(scope: GroceryStorageScope): string {
  return `${SCOPE_PREFIX}${scopeId(scope)}:last_sync`;
}

function scopeFromSnapshot(snapshot: GrocerySnapshot): GroceryStorageScope {
  return { accountScopeId: snapshot.account_scope_id, listId: snapshot.list.id };
}

function sameScope(left: GroceryStorageScope, right: GroceryStorageScope): boolean {
  return left.accountScopeId === right.accountScopeId && left.listId === right.listId;
}

async function getActiveScopeUnsafe(): Promise<GroceryStorageScope | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_SCOPE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GroceryStorageScope>;
    if (typeof parsed.accountScopeId !== 'string' || typeof parsed.listId !== 'string') return null;
    return { accountScopeId: parsed.accountScopeId, listId: parsed.listId };
  } catch {
    return null;
  }
}

async function setActiveScopeUnsafe(scope: GroceryStorageScope): Promise<void> {
  const previous = await getActiveScopeUnsafe();
  if (previous && !sameScope(previous, scope)) {
    await AsyncStorage.multiRemove([snapshotKey(previous), queueKey(previous), lastSyncKey(previous)]);
  }
  await AsyncStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify(scope));
}

async function privateGroceryKeys(): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys();
  return keys.filter((key) => key === ACTIVE_SCOPE_KEY || key === IDENTITY_KEY || key.startsWith(SCOPE_PREFIX) || LEGACY_KEYS.includes(key));
}

async function clearPrivateGroceryStorage(): Promise<void> {
  const keys = await privateGroceryKeys();
  if (keys.length > 0) await AsyncStorage.multiRemove(keys);
}

/** Clerk is only a local privacy boundary; the API's stable scope owns data. */
export function bindOfflineGroceryIdentity(clerkUserId: string | null): Promise<void> {
  const requestedIdentityEpoch = ++identityEpoch;
  ++scopeEpoch;
  identityReady = false;
  return serialized(async () => {
    if (requestedIdentityEpoch !== identityEpoch) return;
    if (!clerkUserId) {
      await clearPrivateGroceryStorage();
      identityReady = true;
      return;
    }
    const identityHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, clerkUserId);
    if (requestedIdentityEpoch !== identityEpoch) return;
    const previousHash = await AsyncStorage.getItem(IDENTITY_KEY);
    if (previousHash !== identityHash) await clearPrivateGroceryStorage();
    await AsyncStorage.setItem(IDENTITY_KEY, identityHash);
    await AsyncStorage.multiRemove(LEGACY_KEYS);
    if (requestedIdentityEpoch === identityEpoch) identityReady = true;
  });
}

export function cacheGrocerySnapshot(
  snapshot: GrocerySnapshot,
  lease: GroceryStorageLease,
): Promise<void> {
  return serialized(async () => {
    assertGroceryStorageLease(lease);
    const scope = scopeFromSnapshot(snapshot);
    await setActiveScopeUnsafe(scope);
    await AsyncStorage.multiSet([
      [snapshotKey(scope), JSON.stringify(snapshot)],
      [lastSyncKey(scope), new Date().toISOString()],
    ]);
  });
}

/** Atomically overlay the current durable queue onto a fresh server snapshot. */
export function cacheServerGrocerySnapshot(
  serverSnapshot: GrocerySnapshot,
  lease: GroceryStorageLease,
): Promise<GrocerySnapshot> {
  return serialized(async () => {
    assertGroceryStorageLease(lease);
    const serverScope = scopeFromSnapshot(serverSnapshot);
    const activeScope = await getActiveScopeUnsafe();
    let snapshot = serverSnapshot;
    if (activeScope && sameScope(activeScope, serverScope)) {
      const raw = await AsyncStorage.getItem(queueKey(activeScope));
      if (raw) {
        try {
          const queue = JSON.parse(raw) as PendingGroceryMutation[];
          snapshot = queue
            .filter((entry) => entry.mutation?.list_id === serverScope.listId)
            .reduce(
              (current, entry) =>
                applyOptimisticGroceryMutation(current, entry.mutation),
              serverSnapshot,
            );
        } catch {
          // A corrupt queue is ignored; the authoritative server state wins.
        }
      }
    }
    await setActiveScopeUnsafe(serverScope);
    await AsyncStorage.multiSet([
      [snapshotKey(serverScope), JSON.stringify(snapshot)],
      [lastSyncKey(serverScope), new Date().toISOString()],
    ]);
    return snapshot;
  });
}

export function getCachedGrocerySnapshot(
  lease: GroceryStorageLease,
): Promise<GrocerySnapshot | null> {
  return serialized(async () => {
    assertGroceryStorageLease(lease);
    const scope = await getActiveScopeUnsafe();
    if (!scope) return null;
    const raw = await AsyncStorage.getItem(snapshotKey(scope));
    if (!raw) return null;
    try {
      const snapshot = JSON.parse(raw) as GrocerySnapshot;
      if (snapshot.account_scope_id !== scope.accountScopeId || snapshot.list?.id !== scope.listId || !Array.isArray(snapshot.items)) return null;
      return snapshot;
    } catch {
      return null;
    }
  });
}

export function getLastSyncTime(lease: GroceryStorageLease): Promise<string | null> {
  return serialized(async () => {
    assertGroceryStorageLease(lease);
    const scope = await getActiveScopeUnsafe();
    return scope ? AsyncStorage.getItem(lastSyncKey(scope)) : null;
  });
}

export function applyLocalGroceryMutation(
  mutation: GroceryMutationRequest,
  lease: GroceryStorageLease,
): Promise<GrocerySnapshot> {
  return serialized(async () => {
    assertGroceryStorageLease(lease);
    const scope = await getActiveScopeUnsafe();
    if (!scope || scope.listId !== mutation.list_id) throw new Error('No matching grocery snapshot is available offline.');
    const raw = await AsyncStorage.getItem(snapshotKey(scope));
    if (!raw) throw new Error('No grocery snapshot is available offline.');
    const snapshot = JSON.parse(raw) as GrocerySnapshot;
    const updated = applyOptimisticGroceryMutation(snapshot, mutation);
    await AsyncStorage.setItem(snapshotKey(scope), JSON.stringify(updated));
    return updated;
  });
}

export function addToSyncQueue(
  mutation: GroceryMutationRequest,
  lease: GroceryStorageLease,
): Promise<void> {
  return serialized(async () => {
    assertGroceryStorageLease(lease);
    const scope = await getActiveScopeUnsafe();
    if (!scope || scope.listId !== mutation.list_id) throw new Error('Cannot queue a grocery mutation for an inactive list.');
    const key = queueKey(scope);
    const raw = await AsyncStorage.getItem(key);
    const queue = raw ? (JSON.parse(raw) as PendingGroceryMutation[]) : [];
    if (!queue.some((entry) => entry.mutation.mutation_id === mutation.mutation_id)) {
      queue.push({ mutation, queued_at: new Date().toISOString() });
      await AsyncStorage.setItem(key, JSON.stringify(queue));
    }
  });
}

export function getPendingSyncQueue(
  lease: GroceryStorageLease,
): Promise<PendingGroceryMutation[]> {
  return serialized(async () => {
    assertGroceryStorageLease(lease);
    const scope = await getActiveScopeUnsafe();
    if (!scope) return [];
    const raw = await AsyncStorage.getItem(queueKey(scope));
    if (!raw) return [];
    try {
      const queue = JSON.parse(raw) as PendingGroceryMutation[];
      return queue.filter((entry) => entry.mutation?.list_id === scope.listId);
    } catch {
      return [];
    }
  });
}

export function removeFromSyncQueue(
  mutationId: string,
  lease: GroceryStorageLease,
): Promise<void> {
  return serialized(async () => {
    assertGroceryStorageLease(lease);
    const scope = await getActiveScopeUnsafe();
    if (!scope) return;
    const key = queueKey(scope);
    const raw = await AsyncStorage.getItem(key);
    const queue = raw ? (JSON.parse(raw) as PendingGroceryMutation[]) : [];
    await AsyncStorage.setItem(key, JSON.stringify(queue.filter((entry) => entry.mutation.mutation_id !== mutationId)));
  });
}

export function clearSyncQueue(lease: GroceryStorageLease): Promise<void> {
  return serialized(async () => {
    assertGroceryStorageLease(lease);
    const scope = await getActiveScopeUnsafe();
    if (scope) await AsyncStorage.removeItem(queueKey(scope));
  });
}

export async function hasPendingSync(lease: GroceryStorageLease): Promise<boolean> {
  return (await getPendingSyncQueue(lease)).length > 0;
}

export function clearActiveGroceryScope(lease: GroceryStorageLease): Promise<void> {
  assertGroceryStorageLease(lease);
  ++scopeEpoch;
  return serialized(async () => {
    const scope = await getActiveScopeUnsafe();
    if (scope) await AsyncStorage.multiRemove([snapshotKey(scope), queueKey(scope), lastSyncKey(scope), ACTIVE_SCOPE_KEY]);
    else await AsyncStorage.removeItem(ACTIVE_SCOPE_KEY);
  });
}

export function clearAllOfflineGroceryData(): Promise<void> {
  ++identityEpoch;
  ++scopeEpoch;
  identityReady = false;
  return serialized(clearPrivateGroceryStorage);
}
