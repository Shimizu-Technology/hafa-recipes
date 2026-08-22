/** Durable, account-scoped grocery synchronization hooks. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import {
  addToSyncQueue,
  cacheGrocerySnapshot,
  cacheServerGrocerySnapshot,
  clearActiveGroceryScope,
  getGroceryStorageLease,
  getCachedGrocerySnapshot,
  getPendingSyncQueue,
  hasPendingSync,
  removeFromSyncQueue,
  type GroceryStorageLease,
} from '@/lib/offlineStorage';
import {
  applyOptimisticGroceryMutation,
  createAddMutation,
  createCheckedMutation,
  createDeleteMutation,
  createUpdateMutation,
  isRetryableGroceryError,
  sendGroceryMutationWithRetry,
} from '@/lib/grocerySync';
import type {
  GroceryItemChanges,
  GroceryItemCreate,
  GroceryMutationRequest,
  GrocerySnapshot,
  Ingredient,
} from '@/types/recipe';
import { useNetworkStatus, useOnlineCallback } from './useNetworkStatus';

export const groceryKeys = {
  all: ['grocery'] as const,
  snapshot: () => [...groceryKeys.all, 'snapshot'] as const,
  pending: () => [...groceryKeys.all, 'pendingSync'] as const,
};

let groceryMutationChain: Promise<unknown> = Promise.resolve();

function serializeGroceryMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = groceryMutationChain.then(operation, operation);
  groceryMutationChain = result.then(() => undefined, () => undefined);
  return result;
}

async function fetchAndCacheSnapshot(
  lease = getGroceryStorageLease(),
): Promise<GrocerySnapshot> {
  const serverSnapshot = await api.getGrocerySnapshot();
  return cacheServerGrocerySnapshot(serverSnapshot, lease);
}

function useSnapshotQuery(isSignedIn: boolean) {
  const { isApiReachable } = useNetworkStatus();
  return useQuery({
    queryKey: groceryKeys.snapshot(),
    queryFn: () =>
      serializeGroceryMutation(async () => {
        const lease = getGroceryStorageLease();
        if (isApiReachable === false) {
          const cached = await getCachedGrocerySnapshot(lease);
          if (cached) return cached;
          throw new Error('Your grocery list has not been saved for offline use yet.');
        }
        try {
          return await fetchAndCacheSnapshot(lease);
        } catch (error) {
          const cached = await getCachedGrocerySnapshot(lease);
          if (cached) return cached;
          throw error;
        }
      }),
    enabled: isSignedIn,
    staleTime: 10_000,
    retry: 2,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
  });
}

export function useGroceryList(includeChecked = true, isSignedIn = true) {
  const query = useSnapshotQuery(isSignedIn);
  return {
    ...query,
    data: query.data
      ? includeChecked
        ? query.data.items
        : query.data.items.filter((item) => !item.checked)
      : undefined,
  };
}

export function useGroceryCount(isSignedIn = true) {
  const query = useSnapshotQuery(isSignedIn);
  return {
    ...query,
    data: query.data
      ? { total: query.data.total, checked: query.data.checked, unchecked: query.data.unchecked }
      : undefined,
  };
}

export function useGroceryListInfo(isSignedIn = true) {
  const query = useSnapshotQuery(isSignedIn);
  return { ...query, data: query.data?.list };
}

async function baseSnapshot(
  queryClient: ReturnType<typeof useQueryClient>,
  confirmedOffline: boolean,
  lease: GroceryStorageLease,
): Promise<GrocerySnapshot> {
  const memory = queryClient.getQueryData<GrocerySnapshot>(groceryKeys.snapshot());
  if (memory) return memory;
  const cached = await getCachedGrocerySnapshot(lease);
  if (cached) return cached;
  if (confirmedOffline) throw new Error('Open your grocery list online before editing it offline.');
  const snapshot = await fetchAndCacheSnapshot(lease);
  queryClient.setQueryData(groceryKeys.snapshot(), snapshot);
  return snapshot;
}

async function commitMutations(
  queryClient: ReturnType<typeof useQueryClient>,
  confirmedOffline: boolean,
  prepare: (snapshot: GrocerySnapshot) => GroceryMutationRequest[],
): Promise<GrocerySnapshot> {
  return serializeGroceryMutation(async () => {
    const lease = getGroceryStorageLease();
    let snapshot = await baseSnapshot(queryClient, confirmedOffline, lease);
    const mutations = prepare(snapshot);
    if (mutations.length === 0) return snapshot;

    for (const mutation of mutations) {
      await addToSyncQueue(mutation, lease);
      snapshot = applyOptimisticGroceryMutation(snapshot, mutation);
      await cacheGrocerySnapshot(snapshot, lease);
      queryClient.setQueryData(groceryKeys.snapshot(), snapshot);
    }
    await queryClient.invalidateQueries({ queryKey: groceryKeys.pending() });

    if (confirmedOffline) return snapshot;

    for (const [index, mutation] of mutations.entries()) {
      try {
        const response = await sendGroceryMutationWithRetry(mutation, (request) =>
          api.syncGroceryMutation(request),
        );
        await removeFromSyncQueue(mutation.mutation_id, lease);
        snapshot = mutations
          .slice(index + 1)
          .reduce(
            (current, pending) => applyOptimisticGroceryMutation(current, pending),
            response.snapshot,
          );
        await cacheGrocerySnapshot(snapshot, lease);
        queryClient.setQueryData(groceryKeys.snapshot(), snapshot);
      } catch (error) {
        if (isRetryableGroceryError(error)) return snapshot;
        await removeFromSyncQueue(mutation.mutation_id, lease);
        try {
          const serverSnapshot = await fetchAndCacheSnapshot(lease);
          snapshot = mutations
            .slice(index + 1)
            .reduce(
              (current, pending) => applyOptimisticGroceryMutation(current, pending),
              serverSnapshot,
            );
          await cacheGrocerySnapshot(snapshot, lease);
          queryClient.setQueryData(groceryKeys.snapshot(), snapshot);
        } catch {
          // The queued mutation was rejected permanently; retain the last safe snapshot.
        }
        throw error;
      }
    }
    await queryClient.invalidateQueries({ queryKey: groceryKeys.pending() });
    return snapshot;
  });
}

function useDurableMutation<T>(
  prepare: (snapshot: GrocerySnapshot, variables: T) => GroceryMutationRequest[],
) {
  const queryClient = useQueryClient();
  const { isApiReachable } = useNetworkStatus();
  return useMutation({
    mutationFn: (variables: T) =>
      commitMutations(queryClient, isApiReachable === false, (snapshot) =>
        prepare(snapshot, variables),
      ),
    retry: 0,
  });
}

export function useAddGroceryItem() {
  return useDurableMutation<GroceryItemCreate>((snapshot, item) => [
    createAddMutation(snapshot.list.id, item),
  ]);
}

export function useAddFromRecipe() {
  return useDurableMutation<{
    recipeId: string;
    recipeTitle: string;
    ingredients: Ingredient[];
  }>((snapshot, { recipeId, recipeTitle, ingredients }) =>
    ingredients.map((ingredient) =>
      createAddMutation(snapshot.list.id, {
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        notes: ingredient.notes,
        recipe_id: recipeId,
        recipe_title: recipeTitle,
      }),
    ),
  );
}

export function useToggleGroceryItem() {
  return useDurableMutation<{ id: string; checked: boolean }>((snapshot, { id, checked }) => [
    createCheckedMutation(snapshot.list.id, id, checked),
  ]);
}

export function useUpdateGroceryItem() {
  return useDurableMutation<{ id: string; changes: GroceryItemChanges }>(
    (snapshot, { id, changes }) => [createUpdateMutation(snapshot.list.id, id, changes)],
  );
}

export function useDeleteGroceryItem() {
  return useDurableMutation<string>((snapshot, id) => [
    createDeleteMutation(snapshot.list.id, id),
  ]);
}

export function useDeleteGroceryItems() {
  return useDurableMutation<string[]>((snapshot, ids) =>
    ids.map((id) => createDeleteMutation(snapshot.list.id, id)),
  );
}

export function useClearCheckedItems() {
  return useDurableMutation<void>((snapshot) =>
    snapshot.items
      .filter((item) => item.checked)
      .map((item) => createDeleteMutation(snapshot.list.id, item.id)),
  );
}

export function useClearAllItems() {
  return useDurableMutation<void>((snapshot) =>
    snapshot.items.map((item) => createDeleteMutation(snapshot.list.id, item.id)),
  );
}

export interface SyncResult {
  synced: number;
  failed: number;
  failedItems: string[];
}

export function useGrocerySync() {
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const syncingRef = useRef<Promise<SyncResult> | null>(null);

  const syncPendingChanges = useCallback(async (): Promise<SyncResult> => {
    if (syncingRef.current) return syncingRef.current;
    const sync = serializeGroceryMutation(async () => {
      const result: SyncResult = { synced: 0, failed: 0, failedItems: [] };
      if (!isOnline) return result;
      const lease = getGroceryStorageLease();
      const queued = await getPendingSyncQueue(lease);
      let serverSnapshot: GrocerySnapshot;
      try {
        serverSnapshot = await api.getGrocerySnapshot();
      } catch {
        if (queued.length > 0) {
          result.failed = queued.length;
          result.failedItems.push('The grocery service is unavailable');
          setLastSyncResult(result);
        }
        return result;
      }
      if (queued.length === 0) {
        await cacheGrocerySnapshot(serverSnapshot, lease);
        queryClient.setQueryData(groceryKeys.snapshot(), serverSnapshot);
        return result;
      }

      if (queued.some((entry) => entry.mutation.list_id !== serverSnapshot.list.id)) {
        await cacheGrocerySnapshot(serverSnapshot, lease);
        queryClient.setQueryData(groceryKeys.snapshot(), serverSnapshot);
        result.failed = queued.length;
        result.failedItems.push('Your active grocery list changed');
        setLastSyncResult(result);
        return result;
      }

      let displayedSnapshot = queued.reduce(
        (current, entry) => applyOptimisticGroceryMutation(current, entry.mutation),
        serverSnapshot,
      );
      await cacheGrocerySnapshot(displayedSnapshot, lease);
      queryClient.setQueryData(groceryKeys.snapshot(), displayedSnapshot);

      for (const [index, entry] of queued.entries()) {
        try {
          const response = await sendGroceryMutationWithRetry(entry.mutation, (request) =>
            api.syncGroceryMutation(request),
          );
          serverSnapshot = response.snapshot;
          await removeFromSyncQueue(entry.mutation.mutation_id, lease);
          displayedSnapshot = queued
            .slice(index + 1)
            .reduce(
              (current, pending) =>
                applyOptimisticGroceryMutation(current, pending.mutation),
              serverSnapshot,
            );
          await cacheGrocerySnapshot(displayedSnapshot, lease);
          queryClient.setQueryData(groceryKeys.snapshot(), displayedSnapshot);
          result.synced += 1;
        } catch (error) {
          result.failed += 1;
          result.failedItems.push(entry.mutation.operation);
          const status = (error as { response?: { status?: number } })?.response?.status;
          if (isRetryableGroceryError(error)) break;
          if (status !== undefined) {
            await removeFromSyncQueue(entry.mutation.mutation_id, lease);
            displayedSnapshot = queued
              .slice(index + 1)
              .reduce(
                (current, pending) =>
                  applyOptimisticGroceryMutation(current, pending.mutation),
                serverSnapshot,
              );
            await cacheGrocerySnapshot(displayedSnapshot, lease);
            queryClient.setQueryData(groceryKeys.snapshot(), displayedSnapshot);
          }
        }
      }
      await queryClient.invalidateQueries({ queryKey: groceryKeys.pending() });
      setLastSyncResult(result);
      return result;
    });
    syncingRef.current = sync;
    try {
      return await sync;
    } finally {
      syncingRef.current = null;
    }
  }, [isOnline, queryClient]);

  useOnlineCallback(() => {
    void syncPendingChanges().catch((error) =>
      console.warn('[Grocery Sync] Failed to start synchronization:', error),
    );
  });
  useEffect(() => {
    if (isOnline) {
      void hasPendingSync(getGroceryStorageLease()).then((pending) => {
        if (pending) {
          void syncPendingChanges().catch((error) =>
            console.warn('[Grocery Sync] Failed to start synchronization:', error),
          );
        }
      });
    }
  }, [isOnline, syncPendingChanges]);

  return {
    syncPendingChanges,
    lastSyncResult,
    clearSyncResult: () => setLastSyncResult(null),
  };
}

export function usePendingGrocerySync() {
  const { isOnline } = useNetworkStatus();
  return useQuery({
    queryKey: groceryKeys.pending(),
    queryFn: () => hasPendingSync(getGroceryStorageLease()),
    enabled: !isOnline,
    refetchInterval: !isOnline ? 5_000 : false,
  });
}

export function useCreateGroceryInvite() {
  return useMutation({ mutationFn: () => api.createGroceryInvite() });
}

export function useInvitePreview(code: string, enabled = true) {
  return useQuery({
    queryKey: ['grocery', 'invite', code],
    queryFn: () => api.getInvitePreview(code),
    enabled: enabled && !!code,
    staleTime: 60_000,
  });
}

function useMembershipMutation<T>(mutationFn: (variables: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: T) =>
      serializeGroceryMutation(async () => {
        const result = await mutationFn(variables);
        await clearActiveGroceryScope(getGroceryStorageLease());
        return result;
      }),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: groceryKeys.all });
      await queryClient.invalidateQueries({ queryKey: groceryKeys.snapshot() });
    },
  });
}

export function useJoinGroceryList() {
  return useMembershipMutation<string>((code) => api.joinGroceryList(code));
}

export function useLeaveGroceryList() {
  return useMembershipMutation<void>(() => api.leaveGroceryList());
}

export function useRemoveGroceryMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeGroceryListMember(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groceryKeys.snapshot() }),
  });
}
