/**
 * React Query hooks for grocery list operations.
 * 
 * Includes offline support via AsyncStorage caching.
 * Changes made offline are queued and synced when back online.
 */

import { useQuery, useMutation, useQueryClient, useIsFetching } from '@tanstack/react-query';
import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { GroceryItem, GroceryItemCreate, Ingredient } from '../types/recipe';
import { useNetworkStatus, useOnlineCallback } from './useNetworkStatus';
import {
  cacheGroceryList,
  getCachedGroceryList,
  cacheGroceryCount,
  getCachedGroceryCount,
  addToSyncQueue,
  getPendingSyncQueue,
  removeFromSyncQueue,
  clearSyncQueue,
  applyLocalToggle,
  applyLocalDelete,
  applyLocalAdd,
  applyLocalClearChecked,
  applyLocalClearAll,
  replaceTempId,
  hasPendingSync,
} from '../lib/offlineStorage';

// Query keys
export const groceryKeys = {
  all: ['grocery'] as const,
  list: () => [...groceryKeys.all, 'list'] as const,
  count: () => [...groceryKeys.all, 'count'] as const,
};

/**
 * Fetch the grocery list with offline support
 */
export function useGroceryList(includeChecked = true, isSignedIn = true) {
  const { isApiReachable } = useNetworkStatus();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: [...groceryKeys.list(), includeChecked],
    queryFn: async () => {
      // IMPORTANT: Only use offline mode if we've CONFIRMED we're offline
      // (isApiReachable === false, not null which means "unknown")
      const confirmedOffline = isApiReachable === false;
      
      if (confirmedOffline) {
        // Confirmed offline - use cache
        console.log('📴 Offline mode: using cached grocery list');
        const cached = await getCachedGroceryList();
        if (cached) {
          return includeChecked ? cached : cached.filter(item => !item.checked);
        }
        return [];
      }

      // Online or status unknown - ALWAYS try to fetch fresh data from server
      try {
        const data = await api.getGroceryList(includeChecked);
        
        // Cache the full list for offline use
        if (includeChecked) {
          await cacheGroceryList(data);
        }
        
        return data;
      } catch (error) {
        // If API fails (timeout, server error, etc.), fall back to cache
        // This prevents showing an error screen when we have usable cached data
        console.log('📥 API fetch failed, trying cache fallback');
        const cached = await getCachedGroceryList();
        if (cached && cached.length > 0) {
          console.log(`📦 Using cached data (${cached.length} items)`);
          return includeChecked ? cached : cached.filter(item => !item.checked);
        }
        // No cache available - re-throw the error
        throw error;
      }
    },
    // DON'T use placeholderData - it can show stale cache while fetching
    // Instead, just show loading state until we have fresh data
    // This prevents the "partial data" issue where cache shows incomplete list
    
    // Only run query when user is signed in
    enabled: isSignedIn,
    // Reduce staleTime to ensure fresher data
    staleTime: 10 * 1000, // 10 seconds instead of 30
    retry: 3,
    // Refetch when network comes back online
    refetchOnReconnect: true,
    // Retry on mount to ensure fresh data
    refetchOnMount: 'always',
  });
}

/**
 * Get grocery item counts with offline support
 */
export function useGroceryCount(isSignedIn = true) {
  const { isApiReachable } = useNetworkStatus();

  return useQuery({
    queryKey: groceryKeys.count(),
    queryFn: async () => {
      // IMPORTANT: Only use offline mode if we've CONFIRMED we're offline
      const confirmedOffline = isApiReachable === false;
      
      if (confirmedOffline) {
        console.log('📴 Offline mode: using cached grocery count');
        const cached = await getCachedGroceryCount();
        if (cached) {
          return cached;
        }
        return { total: 0, checked: 0, unchecked: 0 };
      }

      // Online or status unknown - ALWAYS fetch fresh data
      try {
        const data = await api.getGroceryCount();
        await cacheGroceryCount(data);
        return data;
      } catch (error) {
        // Fall back to cache if API fails
        const cached = await getCachedGroceryCount();
        if (cached) {
          return cached;
        }
        throw error;
      }
    },
    // Only run query when user is signed in
    enabled: isSignedIn,
    staleTime: 10 * 1000, // 10 seconds
    retry: 3,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
  });
}

/**
 * Add a single grocery item with offline support and optimistic updates
 */
export function useAddGroceryItem() {
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();

  return useMutation({
    mutationFn: async (item: GroceryItemCreate) => {
      if (!isOnline) {
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await applyLocalAdd(item, tempId);
        // Convert null to undefined for sync queue type compatibility
        await addToSyncQueue({ 
          type: 'ADD_ITEM', 
          payload: { 
            ...item, 
            tempId,
            recipe_id: item.recipe_id ?? undefined,
            recipe_title: item.recipe_title ?? undefined,
          } 
        });
        
        return {
          id: tempId,
          ...item,
          checked: false,
          created_at: new Date().toISOString(),
        } as GroceryItem;
      }

      return api.addGroceryItem(item);
    },
    onMutate: async (newItem) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: groceryKeys.list() });
      await queryClient.cancelQueries({ queryKey: groceryKeys.count() });

      // Snapshot previous data
      const previousListTrue = queryClient.getQueryData<GroceryItem[]>([...groceryKeys.list(), true]);
      const previousListFalse = queryClient.getQueryData<GroceryItem[]>([...groceryKeys.list(), false]);
      const previousCount = queryClient.getQueryData<{ total: number; checked: number; unchecked: number }>(groceryKeys.count());

      // Create optimistic item
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const optimisticItem: GroceryItem = {
        id: tempId,
        name: newItem.name,
        quantity: newItem.quantity ?? null,
        unit: newItem.unit ?? null,
        notes: newItem.notes ?? null,
        checked: false,
        recipe_id: newItem.recipe_id ?? null,
        recipe_title: newItem.recipe_title ?? null,
        added_by_name: null,
        created_at: new Date().toISOString(),
      };

      // Update list cache - add to TOP of list
      if (previousListTrue) {
        queryClient.setQueryData<GroceryItem[]>([...groceryKeys.list(), true], [optimisticItem, ...previousListTrue]);
      } else {
        queryClient.setQueryData<GroceryItem[]>([...groceryKeys.list(), true], [optimisticItem]);
      }

      if (previousListFalse) {
        queryClient.setQueryData<GroceryItem[]>([...groceryKeys.list(), false], [optimisticItem, ...previousListFalse]);
      }

      // Update count cache
      if (previousCount) {
        queryClient.setQueryData(groceryKeys.count(), {
          total: previousCount.total + 1,
          checked: previousCount.checked,
          unchecked: previousCount.unchecked + 1,
        });
      }

      return { previousListTrue, previousListFalse, previousCount, tempId };
    },
    onSuccess: (serverItem, variables, context) => {
      // Replace temp item with real server item
      if (context?.tempId && serverItem) {
        queryClient.setQueryData<GroceryItem[]>([...groceryKeys.list(), true], (old) => {
          if (!old) return [serverItem];
          return old.map(item => item.id === context.tempId ? serverItem : item);
        });
        queryClient.setQueryData<GroceryItem[]>([...groceryKeys.list(), false], (old) => {
          if (!old) return undefined;
          return old.map(item => item.id === context.tempId ? serverItem : item);
        });
      }
    },
    onError: (err, newItem, context) => {
      // Rollback on error
      if (context?.previousListTrue !== undefined) {
        queryClient.setQueryData([...groceryKeys.list(), true], context.previousListTrue);
      }
      if (context?.previousListFalse !== undefined) {
        queryClient.setQueryData([...groceryKeys.list(), false], context.previousListFalse);
      }
      if (context?.previousCount) {
        queryClient.setQueryData(groceryKeys.count(), context.previousCount);
      }
    },
  });
}

/**
 * Add ingredients from a recipe to the grocery list
 */
export function useAddFromRecipe() {
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();

  return useMutation({
    mutationFn: async ({
      recipeId,
      recipeTitle,
      ingredients,
    }: {
      recipeId: string;
      recipeTitle: string;
      ingredients: Ingredient[];
    }) => {
      const items: GroceryItemCreate[] = ingredients.map((ing) => ({
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        notes: ing.notes,
      }));

      if (!isOnline) {
        // Offline: apply each item locally and queue for sync
        for (const item of items) {
          const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await applyLocalAdd({ ...item, recipe_id: recipeId, recipe_title: recipeTitle }, tempId);
        }
        await addToSyncQueue({ 
          type: 'ADD_FROM_RECIPE', 
          payload: { recipeId, recipeTitle, items } 
        });
        return;
      }

      return api.addGroceryItemsFromRecipe(recipeId, recipeTitle, items);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groceryKeys.list() });
      queryClient.invalidateQueries({ queryKey: groceryKeys.count() });
    },
  });
}

/**
 * Toggle a grocery item's checked status with offline support
 */
export function useToggleGroceryItem() {
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();

  return useMutation({
    mutationFn: async (id: string) => {
      // Always apply locally first (optimistic)
      await applyLocalToggle(id);

      if (!isOnline) {
        // Queue for sync
        await addToSyncQueue({ type: 'TOGGLE_ITEM', payload: { id } });
        return;
      }

      // Online: send to server
      return api.toggleGroceryItem(id);
    },
    onMutate: async (id) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: groceryKeys.list() });

      // Get all grocery list queries
      const queries = queryClient.getQueriesData({ queryKey: groceryKeys.list() });
      
      // Store previous values
      const previousData: Array<{ queryKey: any; data: any }> = [];
      
      // Optimistically update ALL grocery list queries
      queries.forEach(([queryKey, data]) => {
        if (data) {
          previousData.push({ queryKey, data });
          
          queryClient.setQueryData(queryKey, (old: any) => {
            if (!old || !Array.isArray(old)) return old;
            return old.map((item: any) =>
              item.id === id ? { ...item, checked: !item.checked } : item
            );
          });
        }
      });

      // Also update the count optimistically
      const countData = queryClient.getQueryData(groceryKeys.count()) as any;
      if (countData) {
        const allItems = queries[0]?.[1] as any[];
        const item = allItems?.find((i: any) => i.id === id);
        
        if (item) {
          const wasChecked = item.checked;
          queryClient.setQueryData(groceryKeys.count(), {
            ...countData,
            checked: wasChecked ? countData.checked - 1 : countData.checked + 1,
            unchecked: wasChecked ? countData.unchecked + 1 : countData.unchecked - 1,
          });
        }
      }

      return { previousData, previousCount: countData };
    },
    onError: (err, id, context) => {
      // Roll back on error
      if (context?.previousData) {
        context.previousData.forEach(({ queryKey, data }) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      if (context?.previousCount) {
        queryClient.setQueryData(groceryKeys.count(), context.previousCount);
      }
    },
    onSuccess: (data, id, context) => {
      // Don't invalidate immediately - the optimistic update is already correct
      // Only sync count after a small delay to avoid flashing
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: groceryKeys.count() });
      }, 500);
    },
  });
}

/**
 * Delete a grocery item with offline support
 */
export function useDeleteGroceryItem() {
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();

  return useMutation({
    mutationFn: async (id: string) => {
      // Always apply locally first
      await applyLocalDelete(id);

      if (!isOnline) {
        // Don't queue delete for temp items (they were never synced)
        if (!id.startsWith('temp_')) {
          await addToSyncQueue({ type: 'DELETE_ITEM', payload: { id } });
        }
        return;
      }

      // Online: send to server (unless it's a temp item)
      if (!id.startsWith('temp_')) {
        return api.deleteGroceryItem(id);
      }
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: groceryKeys.list() });
      await queryClient.cancelQueries({ queryKey: groceryKeys.count() });

      const queries = queryClient.getQueriesData({ queryKey: groceryKeys.list() });
      const previousData: Array<{ queryKey: any; data: any }> = [];
      let deletedItem: any = null;
      
      queries.forEach(([queryKey, data]) => {
        if (data && Array.isArray(data)) {
          previousData.push({ queryKey, data });
          
          if (!deletedItem) {
            deletedItem = data.find((item: any) => item.id === id);
          }
          
          queryClient.setQueryData(queryKey, (old: any) => {
            if (!old || !Array.isArray(old)) return old;
            return old.filter((item: any) => item.id !== id);
          });
        }
      });

      const countData = queryClient.getQueryData(groceryKeys.count()) as any;
      if (countData && deletedItem) {
        queryClient.setQueryData(groceryKeys.count(), {
          ...countData,
          total: countData.total - 1,
          checked: deletedItem.checked ? countData.checked - 1 : countData.checked,
          unchecked: deletedItem.checked ? countData.unchecked : countData.unchecked - 1,
        });
      }

      return { previousData, previousCount: countData };
    },
    onError: (err, id, context) => {
      if (context?.previousData) {
        context.previousData.forEach(({ queryKey, data }) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      if (context?.previousCount) {
        queryClient.setQueryData(groceryKeys.count(), context.previousCount);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: groceryKeys.count() });
    },
  });
}

/**
 * Clear all checked items with offline support
 */
export function useClearCheckedItems() {
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();

  return useMutation({
    mutationFn: async () => {
      await applyLocalClearChecked();

      if (!isOnline) {
        await addToSyncQueue({ type: 'CLEAR_CHECKED' });
        return;
      }

      return api.clearCheckedGroceryItems();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groceryKeys.list() });
      queryClient.invalidateQueries({ queryKey: groceryKeys.count() });
    },
  });
}

/**
 * Clear all grocery items with offline support
 */
export function useClearAllItems() {
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();

  return useMutation({
    mutationFn: async () => {
      await applyLocalClearAll();

      if (!isOnline) {
        await addToSyncQueue({ type: 'CLEAR_ALL' });
        return;
      }

      return api.clearAllGroceryItems();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groceryKeys.list() });
      queryClient.invalidateQueries({ queryKey: groceryKeys.count() });
    },
  });
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  synced: number;
  failed: number;
  failedItems: string[];
}

/**
 * Hook to sync pending changes when coming back online
 */
export function useGrocerySync() {
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  const syncPendingChanges = useCallback(async (): Promise<SyncResult> => {
    const result: SyncResult = { synced: 0, failed: 0, failedItems: [] };
    
    if (!isOnline) return result;

    const queue = await getPendingSyncQueue();
    if (queue.length === 0) return result;

    console.log(`[Grocery Sync] Syncing ${queue.length} pending changes...`);

    for (const item of queue) {
      try {
        switch (item.action.type) {
          case 'TOGGLE_ITEM':
            // Skip if it's a temp item
            if (!item.action.payload.id.startsWith('temp_')) {
              await api.toggleGroceryItem(item.action.payload.id);
            }
            break;

          case 'DELETE_ITEM':
            if (!item.action.payload.id.startsWith('temp_')) {
              await api.deleteGroceryItem(item.action.payload.id);
            }
            break;

          case 'ADD_ITEM': {
            const { tempId, ...itemData } = item.action.payload;
            const addResult = await api.addGroceryItem(itemData);
            // Replace temp ID with real ID in cache
            await replaceTempId(tempId, addResult.id);
            break;
          }

          case 'ADD_FROM_RECIPE':
            const items = item.action.payload.items.map(i => ({
              name: i.name,
              quantity: i.quantity,
              unit: i.unit,
              notes: i.notes,
            }));
            await api.addGroceryItemsFromRecipe(
              item.action.payload.recipeId,
              item.action.payload.recipeTitle,
              items
            );
            break;

          case 'CLEAR_CHECKED':
            await api.clearCheckedGroceryItems();
            break;

          case 'CLEAR_ALL':
            await api.clearAllGroceryItems();
            break;
        }

        // Remove from queue after successful sync
        await removeFromSyncQueue(item.id);
        result.synced++;
        console.log(`[Grocery Sync] Synced: ${item.action.type}`);
      } catch (error: any) {
        console.warn(`[Grocery Sync] Failed to sync ${item.action.type}:`, error);
        result.failed++;
        result.failedItems.push(item.action.type);
        
        // For 404 errors (item not found), remove from queue - the item no longer exists
        if (error?.response?.status === 404) {
          await removeFromSyncQueue(item.id);
          console.log(`[Grocery Sync] Removed stale item from queue: ${item.action.type}`);
        }
        // Keep other errors in queue for next sync attempt
      }
    }

    // After syncing, refresh from server to get latest state
    await queryClient.invalidateQueries({ queryKey: groceryKeys.all });
    
    // Store the result
    setLastSyncResult(result);
    
    console.log(`[Grocery Sync] Complete: ${result.synced} synced, ${result.failed} failed`);
    return result;
  }, [isOnline, queryClient]);

  // Sync when coming back online
  useOnlineCallback(syncPendingChanges);

  // Also sync on mount if there are pending changes
  useEffect(() => {
    if (isOnline) {
      hasPendingSync().then(pending => {
        if (pending) {
          syncPendingChanges();
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

/**
 * Hook to check if there are pending offline changes
 */
export function usePendingGrocerySync() {
  const { isOnline } = useNetworkStatus();
  
  return useQuery({
    queryKey: ['grocery', 'pendingSync'],
    queryFn: () => hasPendingSync(),
    // Only check when offline
    enabled: !isOnline,
    refetchInterval: !isOnline ? 5000 : false, // Check every 5s when offline
  });
}

// ============================================================
// Shared Grocery List Hooks
// ============================================================

/**
 * Get info about the user's grocery list (members, shared status)
 */
export function useGroceryListInfo(isSignedIn = true) {
  return useQuery({
    queryKey: [...groceryKeys.all, 'listInfo'],
    queryFn: () => api.getGroceryListInfo(),
    enabled: isSignedIn,
    staleTime: 30 * 1000,
  });
}

/**
 * Create an invite link for sharing the grocery list
 */
export function useCreateGroceryInvite() {
  return useMutation({
    mutationFn: () => api.createGroceryInvite(),
  });
}

/**
 * Get preview of an invite (for join confirmation screen)
 */
export function useInvitePreview(code: string, enabled = true) {
  return useQuery({
    queryKey: ['grocery', 'invite', code],
    queryFn: () => api.getInvitePreview(code),
    enabled: enabled && !!code,
    staleTime: 60 * 1000,
  });
}

/**
 * Join a shared grocery list via invite code
 */
export function useJoinGroceryList() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (code: string) => api.joinGroceryList(code),
    onSuccess: () => {
      // Invalidate all grocery queries to refresh with new list
      queryClient.invalidateQueries({ queryKey: groceryKeys.all });
    },
  });
}

/**
 * Leave a shared grocery list
 */
export function useLeaveGroceryList() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => api.leaveGroceryList(),
    onSuccess: () => {
      // Invalidate all grocery queries to refresh with personal list
      queryClient.invalidateQueries({ queryKey: groceryKeys.all });
    },
  });
}

/**
 * Remove a member from the grocery list
 */
export function useRemoveGroceryMember() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (userId: string) => api.removeGroceryListMember(userId),
    onSuccess: () => {
      // Refresh list info to update members
      queryClient.invalidateQueries({ queryKey: [...groceryKeys.all, 'listInfo'] });
    },
  });
}
