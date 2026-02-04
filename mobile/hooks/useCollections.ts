/**
 * React Query hooks for collection operations.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Collection, CollectionRecipe } from '../types/recipe';

// Query keys
export const collectionKeys = {
  all: ['collections'] as const,
  list: () => [...collectionKeys.all, 'list'] as const,
  detail: (id: string) => [...collectionKeys.all, 'detail', id] as const,
  recipes: (id: string) => [...collectionKeys.all, 'recipes', id] as const,
  recipeCollections: (recipeId: string) => [...collectionKeys.all, 'recipeCollections', recipeId] as const,
};

// ============================================================
// Query Hooks
// ============================================================

/**
 * Fetch all collections for the current user
 */
export function useCollections(enabled = true) {
  return useQuery({
    queryKey: collectionKeys.list(),
    queryFn: () => api.getCollections(),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Fetch recipes in a specific collection
 */
export function useCollectionRecipes(collectionId: string, enabled = true) {
  return useQuery({
    queryKey: collectionKeys.recipes(collectionId),
    queryFn: () => api.getCollectionRecipes(collectionId),
    enabled: enabled && !!collectionId,
    staleTime: 30_000,
  });
}

/**
 * Get which collections a recipe belongs to
 * Returns an array of collection IDs (strings)
 */
export function useRecipeCollections(recipeId: string, enabled = true) {
  return useQuery({
    queryKey: collectionKeys.recipeCollections(recipeId),
    queryFn: () => api.getRecipeCollections(recipeId),
    enabled: enabled && !!recipeId,
    staleTime: 30_000,
  });
}

// ============================================================
// Mutation Hooks
// ============================================================

/**
 * Create a new collection
 * Shows loading state, then adds to list on success
 */
export function useCreateCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, emoji }: { name: string; emoji?: string }) => 
      api.createCollection(name, emoji),
    onSuccess: (newCollection) => {
      // Add the new collection to the cache immediately
      queryClient.setQueryData<Collection[]>(collectionKeys.list(), (old) => 
        old ? [...old, newCollection] : [newCollection]
      );
    },
    onSettled: () => {
      // Refetch to ensure we're in sync
      queryClient.invalidateQueries({ queryKey: collectionKeys.list() });
    },
  });
}

/**
 * Update a collection
 */
export function useUpdateCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ collectionId, updates }: { collectionId: string; updates: { name?: string; emoji?: string } }) =>
      api.updateCollection(collectionId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionKeys.list() });
    },
  });
}

/**
 * Delete a collection
 */
export function useDeleteCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (collectionId: string) => api.deleteCollection(collectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionKeys.list() });
    },
  });
}

/**
 * Add a recipe to a collection with optimistic update
 */
export function useAddToCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ collectionId, recipeId }: { collectionId: string; recipeId: string }) =>
      api.addRecipeToCollection(collectionId, recipeId),
    // Optimistic update - show in collection immediately
    onMutate: ({ collectionId, recipeId }) => {
      // Cancel queries without awaiting (fire-and-forget for speed)
      queryClient.cancelQueries({ queryKey: collectionKeys.recipeCollections(recipeId) });
      queryClient.cancelQueries({ queryKey: collectionKeys.list() });

      // Snapshot the previous values
      // Note: recipeCollections returns string[] (collection IDs), NOT Collection[]
      const previousRecipeCollections = queryClient.getQueryData<string[]>(
        collectionKeys.recipeCollections(recipeId)
      );
      const previousCollectionList = queryClient.getQueryData<Collection[]>(collectionKeys.list());

      // Check if already in collection (prevent duplicates)
      if (previousRecipeCollections?.includes(collectionId)) {
        return { previousRecipeCollections, previousCollectionList, alreadyInCollection: true };
      }

      // Optimistically add to the recipe's collections (as a string ID, not Collection object!)
      queryClient.setQueryData<string[]>(
        collectionKeys.recipeCollections(recipeId),
        (old) => old ? [...old, collectionId] : [collectionId]
      );

      // Optimistically update the collection's recipe_count
      queryClient.setQueryData<Collection[]>(
        collectionKeys.list(),
        (old) => old?.map(c => 
          c.id === collectionId 
            ? { ...c, recipe_count: (c.recipe_count || 0) + 1 }
            : c
        ) ?? []
      );

      return { previousRecipeCollections, previousCollectionList, alreadyInCollection: false };
    },
    onError: (err, { recipeId }, context) => {
      // Rollback on error
      if (context?.previousRecipeCollections) {
        queryClient.setQueryData(
          collectionKeys.recipeCollections(recipeId),
          context.previousRecipeCollections
        );
      }
      if (context?.previousCollectionList) {
        queryClient.setQueryData(
          collectionKeys.list(),
          context.previousCollectionList
        );
      }
    },
    onSettled: (_, __, { collectionId, recipeId }) => {
      // Invalidate to ensure we're in sync with server
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipes(collectionId) });
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipeCollections(recipeId) });
    },
  });
}

/**
 * Remove a recipe from a collection with optimistic update
 */
export function useRemoveFromCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ collectionId, recipeId }: { collectionId: string; recipeId: string }) =>
      api.removeRecipeFromCollection(collectionId, recipeId),
    // Optimistic update - remove from collection immediately
    onMutate: ({ collectionId, recipeId }) => {
      // Cancel queries without awaiting (fire-and-forget for speed)
      queryClient.cancelQueries({ queryKey: collectionKeys.recipeCollections(recipeId) });
      queryClient.cancelQueries({ queryKey: collectionKeys.recipes(collectionId) });
      queryClient.cancelQueries({ queryKey: collectionKeys.list() });

      // Snapshot the previous values
      // Note: recipeCollections returns string[] (collection IDs), NOT Collection[]
      const previousRecipeCollections = queryClient.getQueryData<string[]>(
        collectionKeys.recipeCollections(recipeId)
      );
      const previousCollectionRecipes = queryClient.getQueryData<CollectionRecipe[]>(
        collectionKeys.recipes(collectionId)
      );
      const previousCollectionList = queryClient.getQueryData<Collection[]>(collectionKeys.list());

      // Optimistically remove from the recipe's collections (filter by string ID)
      queryClient.setQueryData<string[]>(
        collectionKeys.recipeCollections(recipeId),
        (old) => old?.filter(id => id !== collectionId) ?? []
      );

      // Optimistically remove from the collection's recipes
      // Note: CollectionRecipe.id is the recipe ID, not recipe_id
      queryClient.setQueryData<CollectionRecipe[]>(
        collectionKeys.recipes(collectionId),
        (old) => old?.filter(r => r.id !== recipeId) ?? []
      );

      // Optimistically update the collection's recipe_count
      queryClient.setQueryData<Collection[]>(
        collectionKeys.list(),
        (old) => old?.map(c => 
          c.id === collectionId 
            ? { ...c, recipe_count: Math.max(0, (c.recipe_count || 0) - 1) }
            : c
        ) ?? []
      );

      return { previousRecipeCollections, previousCollectionRecipes, previousCollectionList };
    },
    onError: (err, { collectionId, recipeId }, context) => {
      // Rollback on error
      if (context?.previousRecipeCollections) {
        queryClient.setQueryData(
          collectionKeys.recipeCollections(recipeId),
          context.previousRecipeCollections
        );
      }
      if (context?.previousCollectionRecipes) {
        queryClient.setQueryData(
          collectionKeys.recipes(collectionId),
          context.previousCollectionRecipes
        );
      }
      if (context?.previousCollectionList) {
        queryClient.setQueryData(
          collectionKeys.list(),
          context.previousCollectionList
        );
      }
    },
    onSettled: (_, __, { recipeId }) => {
      // Invalidate to ensure we're in sync with server
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipeCollections(recipeId) });
    },
  });
}

