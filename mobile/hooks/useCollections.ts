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
    onMutate: async ({ collectionId, recipeId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: collectionKeys.recipeCollections(recipeId) });

      // Snapshot the previous value
      const previousCollections = queryClient.getQueryData<Collection[]>(
        collectionKeys.recipeCollections(recipeId)
      );

      // Get the collection being added to
      const allCollections = queryClient.getQueryData<Collection[]>(collectionKeys.list());
      const addedCollection = allCollections?.find(c => c.id === collectionId);

      // Optimistically add to the recipe's collections
      if (addedCollection) {
        queryClient.setQueryData<Collection[]>(
          collectionKeys.recipeCollections(recipeId),
          (old) => old ? [...old, addedCollection] : [addedCollection]
        );
      }

      return { previousCollections };
    },
    onError: (err, { recipeId }, context) => {
      // Rollback on error
      if (context?.previousCollections) {
        queryClient.setQueryData(
          collectionKeys.recipeCollections(recipeId),
          context.previousCollections
        );
      }
    },
    onSettled: (_, __, { collectionId, recipeId }) => {
      // Sync with server
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipes(collectionId) });
      queryClient.invalidateQueries({ queryKey: collectionKeys.list() });
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
    onMutate: async ({ collectionId, recipeId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: collectionKeys.recipeCollections(recipeId) });
      await queryClient.cancelQueries({ queryKey: collectionKeys.recipes(collectionId) });

      // Snapshot the previous values
      const previousCollections = queryClient.getQueryData<Collection[]>(
        collectionKeys.recipeCollections(recipeId)
      );
      const previousRecipes = queryClient.getQueryData<CollectionRecipe[]>(
        collectionKeys.recipes(collectionId)
      );

      // Optimistically remove from the recipe's collections
      queryClient.setQueryData<Collection[]>(
        collectionKeys.recipeCollections(recipeId),
        (old) => old?.filter(c => c.id !== collectionId) ?? []
      );

      // Optimistically remove from the collection's recipes
      queryClient.setQueryData<CollectionRecipe[]>(
        collectionKeys.recipes(collectionId),
        (old) => old?.filter(r => r.recipe_id !== recipeId) ?? []
      );

      return { previousCollections, previousRecipes };
    },
    onError: (err, { collectionId, recipeId }, context) => {
      // Rollback on error
      if (context?.previousCollections) {
        queryClient.setQueryData(
          collectionKeys.recipeCollections(recipeId),
          context.previousCollections
        );
      }
      if (context?.previousRecipes) {
        queryClient.setQueryData(
          collectionKeys.recipes(collectionId),
          context.previousRecipes
        );
      }
    },
    onSettled: (_, __, { collectionId, recipeId }) => {
      // Sync with server
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipes(collectionId) });
      queryClient.invalidateQueries({ queryKey: collectionKeys.list() });
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipeCollections(recipeId) });
    },
  });
}

