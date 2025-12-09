/**
 * React Query hooks for grocery list operations.
 * 
 * Includes offline support via AsyncStorage caching.
 * Changes made offline are queued and synced when back online.
 */

import { useQuery, useMutation, useQueryClient, useIsFetching } from '@tanstack/react-query';
import { useEffect, useCallback } from 'react';
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
export function useGroceryList(includeChecked = true) {
  const { isOnline } = useNetworkStatus();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: [...groceryKeys.list(), includeChecked],
    queryFn: async () => {
      // If offline, return cached data
      if (!isOnline) {
        const cached = await getCachedGroceryList();
        if (cached) {
          // Filter based on includeChecked parameter
          return includeChecked ? cached : cached.filter(item => !item.checked);
        }
        throw new Error('No cached data available offline');
      }

      // Online: fetch from server
      const data = await api.getGroceryList(includeChecked);
      
      // Cache the full list (always with checked items for consistency)
      if (includeChecked) {
        await cacheGroceryList(data);
      }
      
      return data;
    },
    // Use cached data as placeholder while fetching
    placeholderData: () => {
      // Try to get from React Query cache first
      const cached = queryClient.getQueryData([...groceryKeys.list(), true]) as GroceryItem[] | undefined;
      if (cached) {
        return includeChecked ? cached : cached.filter(item => !item.checked);
      }
      return undefined;
    },
    // Stay fresh but don't throw immediately if offline
    staleTime: 30 * 1000, // 30 seconds
    retry: isOnline ? 3 : 0, // Don't retry when offline
  });
}

/**
 * Get grocery item counts with offline support
 */
export function useGroceryCount() {
  const { isOnline } = useNetworkStatus();

  return useQuery({
    queryKey: groceryKeys.count(),
    queryFn: async () => {
      // If offline, return cached count
      if (!isOnline) {
        const cached = await getCachedGroceryCount();
        if (cached) return cached;
        throw new Error('No cached count available offline');
      }

      // Online: fetch from server
      const data = await api.getGroceryCount();
      await cacheGroceryCount(data);
      return data;
    },
    staleTime: 30 * 1000,
    retry: isOnline ? 3 : 0,
  });
}

/**
 * Add a single grocery item with offline support
 */
export function useAddGroceryItem() {
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();

  return useMutation({
    mutationFn: async (item: GroceryItemCreate) => {
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      if (!isOnline) {
        // Offline: apply locally and queue for sync
        await applyLocalAdd(item, tempId);
        await addToSyncQueue({ type: 'ADD_ITEM', payload: { ...item, tempId } });
        
        // Return a fake response
        return {
          id: tempId,
          ...item,
          checked: false,
          created_at: new Date().toISOString(),
        } as GroceryItem;
      }

      // Online: send to server
      return api.addGroceryItem(item);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: groceryKeys.list() });
      queryClient.invalidateQueries({ queryKey: groceryKeys.count() });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groceryKeys.count() });
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
 * Hook to sync pending changes when coming back online
 */
export function useGrocerySync() {
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();

  const syncPendingChanges = useCallback(async () => {
    if (!isOnline) return;

    const queue = await getPendingSyncQueue();
    if (queue.length === 0) return;

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
            const result = await api.addGroceryItem(itemData);
            // Replace temp ID with real ID in cache
            await replaceTempId(tempId, result.id);
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
        console.log(`[Grocery Sync] Synced: ${item.action.type}`);
      } catch (error) {
        console.warn(`[Grocery Sync] Failed to sync ${item.action.type}:`, error);
        // Keep in queue for next sync attempt
      }
    }

    // After syncing, refresh from server to get latest state
    await queryClient.invalidateQueries({ queryKey: groceryKeys.all });
    console.log('[Grocery Sync] Complete');
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

  return { syncPendingChanges };
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
