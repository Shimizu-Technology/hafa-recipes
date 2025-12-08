/**
 * React Query hooks for grocery list operations.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { GroceryItemCreate, Ingredient } from '../types/recipe';

// Query keys
export const groceryKeys = {
  all: ['grocery'] as const,
  list: () => [...groceryKeys.all, 'list'] as const,
  count: () => [...groceryKeys.all, 'count'] as const,
};

/**
 * Fetch the grocery list
 */
export function useGroceryList(includeChecked = true) {
  return useQuery({
    queryKey: [...groceryKeys.list(), includeChecked],
    queryFn: () => api.getGroceryList(includeChecked),
  });
}

/**
 * Get grocery item counts
 */
export function useGroceryCount() {
  return useQuery({
    queryKey: groceryKeys.count(),
    queryFn: () => api.getGroceryCount(),
  });
}

/**
 * Add a single grocery item
 */
export function useAddGroceryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (item: GroceryItemCreate) => api.addGroceryItem(item),
    onSuccess: () => {
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

  return useMutation({
    mutationFn: ({
      recipeId,
      recipeTitle,
      ingredients,
    }: {
      recipeId: string;
      recipeTitle: string;
      ingredients: Ingredient[];
    }) => {
      // Convert Ingredient[] to GroceryItemCreate[]
      const items: GroceryItemCreate[] = ingredients.map((ing) => ({
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        notes: ing.notes,
      }));
      return api.addGroceryItemsFromRecipe(recipeId, recipeTitle, items);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groceryKeys.list() });
      queryClient.invalidateQueries({ queryKey: groceryKeys.count() });
    },
  });
}

/**
 * Toggle a grocery item's checked status
 * 
 * Uses optimistic updates for instant feedback.
 * Items stay in place after toggle (don't reorder) for better UX.
 */
export function useToggleGroceryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.toggleGroceryItem(id),
    onMutate: async (id) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: groceryKeys.list() });

      // Get all grocery list queries (with any filter params)
      const queries = queryClient.getQueriesData({ queryKey: groceryKeys.list() });
      
      // Store previous values for all matching queries
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
        // Find the item to determine if we're checking or unchecking
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
      // Roll back all queries on error
      if (context?.previousData) {
        context.previousData.forEach(({ queryKey, data }) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      if (context?.previousCount) {
        queryClient.setQueryData(groceryKeys.count(), context.previousCount);
      }
    },
    // Don't invalidate on settle - keep the optimistic state
    // Items will reorder on next pull-to-refresh
    onSuccess: () => {
      // Only invalidate the count to keep it accurate
      // Don't refetch the list - let the optimistic update stand
      queryClient.invalidateQueries({ queryKey: groceryKeys.count() });
    },
  });
}

/**
 * Delete a grocery item
 * 
 * Uses optimistic updates for instant feedback.
 * Item is removed immediately, API call happens in background.
 */
export function useDeleteGroceryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteGroceryItem(id),
    onMutate: async (id) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: groceryKeys.list() });
      await queryClient.cancelQueries({ queryKey: groceryKeys.count() });

      // Get all grocery list queries
      const queries = queryClient.getQueriesData({ queryKey: groceryKeys.list() });
      
      // Store previous values for rollback
      const previousData: Array<{ queryKey: any; data: any }> = [];
      let deletedItem: any = null;
      
      // Optimistically remove from ALL grocery list queries
      queries.forEach(([queryKey, data]) => {
        if (data && Array.isArray(data)) {
          previousData.push({ queryKey, data });
          
          // Find the item we're deleting
          if (!deletedItem) {
            deletedItem = data.find((item: any) => item.id === id);
          }
          
          queryClient.setQueryData(queryKey, (old: any) => {
            if (!old || !Array.isArray(old)) return old;
            return old.filter((item: any) => item.id !== id);
          });
        }
      });

      // Also update the count optimistically
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
      // Roll back all queries on error
      if (context?.previousData) {
        context.previousData.forEach(({ queryKey, data }) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      if (context?.previousCount) {
        queryClient.setQueryData(groceryKeys.count(), context.previousCount);
      }
    },
    // No need to invalidate on success - optimistic update is enough
    onSettled: () => {
      // Only invalidate count to keep it accurate
      queryClient.invalidateQueries({ queryKey: groceryKeys.count() });
    },
  });
}

/**
 * Clear all checked items
 */
export function useClearCheckedItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.clearCheckedGroceryItems(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groceryKeys.list() });
      queryClient.invalidateQueries({ queryKey: groceryKeys.count() });
    },
  });
}

/**
 * Clear all grocery items
 */
export function useClearAllItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.clearAllGroceryItems(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groceryKeys.list() });
      queryClient.invalidateQueries({ queryKey: groceryKeys.count() });
    },
  });
}

