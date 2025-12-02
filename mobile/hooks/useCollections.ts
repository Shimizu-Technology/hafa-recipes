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
 * Add a recipe to a collection
 */
export function useAddToCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ collectionId, recipeId }: { collectionId: string; recipeId: string }) =>
      api.addRecipeToCollection(collectionId, recipeId),
    onSuccess: (_, { collectionId, recipeId }) => {
      // Invalidate the collection's recipes list
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipes(collectionId) });
      // Invalidate the collections list (to update recipe counts)
      queryClient.invalidateQueries({ queryKey: collectionKeys.list() });
      // Invalidate which collections this recipe is in
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipeCollections(recipeId) });
    },
  });
}

/**
 * Remove a recipe from a collection
 */
export function useRemoveFromCollection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ collectionId, recipeId }: { collectionId: string; recipeId: string }) =>
      api.removeRecipeFromCollection(collectionId, recipeId),
    onSuccess: (_, { collectionId, recipeId }) => {
      // Invalidate the collection's recipes list
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipes(collectionId) });
      // Invalidate the collections list (to update recipe counts)
      queryClient.invalidateQueries({ queryKey: collectionKeys.list() });
      // Invalidate which collections this recipe is in
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipeCollections(recipeId) });
    },
  });
}

