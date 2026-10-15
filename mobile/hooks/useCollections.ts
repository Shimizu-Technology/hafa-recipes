/**
 * React Query hooks for collection operations.
 */

import { useQuery, useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { api, type RequestGuard } from '../lib/api';
import { Collection, CollectionRecipe } from '../types/recipe';

// Query keys
export const collectionKeys = {
  all: ['collections'] as const,
  list: (owner?: string | null) => [...collectionKeys.all, owner, 'list'] as const,
  detail: (id: string, owner?: string | null) => [...collectionKeys.all, owner, 'detail', id] as const,
  recipes: (id: string, owner?: string | null) => [...collectionKeys.all, owner, 'recipes', id] as const,
  recipeCollections: (recipeId: string, owner?: string | null) => [...collectionKeys.all, owner, 'recipeCollections', recipeId] as const,
};

function useCollectionAccount() {
  const { userId, isLoaded } = useAuth();
  const owner = isLoaded ? userId ?? null : null;
  const captured = useMemo(() => ({ owner }), [owner]);
  const identity = useRef<typeof captured | null>(null);
  useLayoutEffect(() => {
    identity.current = captured;
    return () => { if (identity.current === captured) identity.current = null; };
  }, [captured]);
  const current = () => !!owner && identity.current === captured;
  const guard = () => { if (!current()) throw new Error('Account changed; reopen this collection.'); };
  return { owner, current, guard };
}

// Freeze at mutation start so a paused request cannot borrow a new account.
type Guarded = { requestGuard?: RequestGuard };

function freezeCollectionMutation<Data, Error, Variables extends Guarded, Context>(
  mutation: UseMutationResult<Data, Error, Variables, Context>,
  scope: ReturnType<typeof useCollectionAccount>,
): UseMutationResult<Data, Error, Variables, Context> {
  const freeze = (variables: Variables): Variables => {
    const requestGuard = variables.requestGuard;
    return { ...variables, requestGuard: () => { scope.guard(); requestGuard?.(); } };
  };
  return { ...mutation,
    mutate: (variables, options) => mutation.mutate(freeze(variables), options),
    mutateAsync: (variables, options) => mutation.mutateAsync(freeze(variables), options),
  };
}

// ============================================================
// Query Hooks
// ============================================================

/**
 * Fetch all collections for the current user
 */
export function useCollections(enabled = true) {
  const scope = useCollectionAccount();
  return useQuery({
    queryKey: collectionKeys.list(scope.owner),
    queryFn: ({ signal }) => api.getCollections(signal, scope.guard),
    enabled: enabled && !!scope.owner,
    staleTime: 30_000,
  });
}

/**
 * Fetch recipes in a specific collection
 */
export function useCollectionRecipes(collectionId: string, enabled = true) {
  const scope = useCollectionAccount();
  return useQuery({
    queryKey: collectionKeys.recipes(collectionId, scope.owner),
    queryFn: ({ signal }) => api.getCollectionRecipes(collectionId, signal, scope.guard),
    enabled: enabled && !!collectionId && !!scope.owner,
    staleTime: 30_000,
  });
}

/**
 * Get which collections a recipe belongs to
 * Returns an array of collection IDs (strings)
 */
export function useRecipeCollections(recipeId: string, enabled = true) {
  const scope = useCollectionAccount();
  return useQuery({
    queryKey: collectionKeys.recipeCollections(recipeId, scope.owner),
    queryFn: ({ signal }) => api.getRecipeCollections(recipeId, signal, scope.guard),
    enabled: enabled && !!recipeId && !!scope.owner,
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
  const scope = useCollectionAccount();

  return freezeCollectionMutation(useMutation({
    mutationFn: ({ name, emoji, requestGuard }: { name: string; emoji?: string } & Guarded) =>
      api.createCollection(name, emoji, requestGuard),
    onMutate: (variables) => {
      variables.requestGuard?.();
      return scope;
    },
    onSuccess: (newCollection, _, context) => {
      if (!context?.current()) return;
      // Add the new collection to the cache immediately
      queryClient.setQueryData<Collection[]>(collectionKeys.list(context.owner), (old) =>
        old ? [...old, newCollection] : [newCollection]
      );
    },
    onSettled: (_, __, ___, context) => {
      if (!context) return;
      // Refetch to ensure we're in sync
      queryClient.invalidateQueries({ queryKey: collectionKeys.list(context.owner) });
    },
  }), scope);
}

/**
 * Update a collection
 */
export function useUpdateCollection() {
  const queryClient = useQueryClient();
  const scope = useCollectionAccount();

  return freezeCollectionMutation(useMutation({
    mutationFn: ({ collectionId, updates, requestGuard }: { collectionId: string; updates: { name?: string; emoji?: string } } & Guarded) =>
      api.updateCollection(collectionId, updates, requestGuard),
    onMutate: (variables) => {
      variables.requestGuard?.();
      return scope;
    },
    onSettled: (_, __, ___, context) => {
      if (context) queryClient.invalidateQueries({ queryKey: collectionKeys.list(context.owner) });
    },
  }), scope);
}

/**
 * Delete a collection
 */
export function useDeleteCollection() {
  const queryClient = useQueryClient();
  const scope = useCollectionAccount();

  return freezeCollectionMutation(useMutation({
    mutationFn: ({ collectionId, requestGuard }: { collectionId: string } & Guarded) => api.deleteCollection(collectionId, requestGuard),
    onMutate: (variables) => {
      variables.requestGuard?.();
      return scope;
    },
    onSettled: (_, __, ___, context) => {
      if (context) queryClient.invalidateQueries({ queryKey: collectionKeys.list(context.owner) });
    },
  }), scope);
}

/**
 * Add a recipe to a collection with optimistic update
 */
export function useAddToCollection() {
  const queryClient = useQueryClient();
  const scope = useCollectionAccount();

  return freezeCollectionMutation(useMutation({
    mutationFn: ({ collectionId, recipeId, requestGuard }: { collectionId: string; recipeId: string } & Guarded) =>
      api.addRecipeToCollection(collectionId, recipeId, requestGuard),
    // Optimistic update - show in collection immediately
    onMutate: (variables) => {
      variables.requestGuard?.();
      const { collectionId, recipeId } = variables;
      // Cancel queries without awaiting (fire-and-forget for speed)
      queryClient.cancelQueries({ queryKey: collectionKeys.recipeCollections(recipeId, scope.owner) });
      queryClient.cancelQueries({ queryKey: collectionKeys.list(scope.owner) });

      // Snapshot the previous values
      // Note: recipeCollections returns string[] (collection IDs), NOT Collection[]
      const previousRecipeCollections = queryClient.getQueryData<string[]>(
        collectionKeys.recipeCollections(recipeId, scope.owner)
      );
      const previousCollectionList = queryClient.getQueryData<Collection[]>(collectionKeys.list(scope.owner));

      // Check if already in collection (prevent duplicates)
      if (previousRecipeCollections?.includes(collectionId)) {
        return { ...scope, previousRecipeCollections, previousCollectionList, alreadyInCollection: true };
      }

      // Optimistically add to the recipe's collections (as a string ID, not Collection object!)
      queryClient.setQueryData<string[]>(
        collectionKeys.recipeCollections(recipeId, scope.owner),
        (old) => old ? [...old, collectionId] : old
      );

      // Optimistically update the collection's recipe_count
      queryClient.setQueryData<Collection[]>(
        collectionKeys.list(scope.owner),
        (old) => old?.map(c => 
          c.id === collectionId 
            ? { ...c, recipe_count: (c.recipe_count || 0) + 1 }
            : c
        )
      );

      return { ...scope, previousRecipeCollections, previousCollectionList, alreadyInCollection: false };
    },
    onError: (err, { recipeId }, context) => {
      if (!context?.current()) return;
      // Rollback on error
      if (context?.previousRecipeCollections) {
        queryClient.setQueryData(
          collectionKeys.recipeCollections(recipeId, context.owner),
          context.previousRecipeCollections
        );
      }
      if (context?.previousCollectionList) {
        queryClient.setQueryData(
          collectionKeys.list(context.owner),
          context.previousCollectionList
        );
      }
    },
    onSettled: (_, __, { collectionId, recipeId }, context) => {
      if (!context) return;
      // Invalidate to ensure we're in sync with server
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipes(collectionId, context.owner) });
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipeCollections(recipeId, context.owner) });
      queryClient.invalidateQueries({ queryKey: collectionKeys.list(context.owner) });
    },
  }), scope);
}

/**
 * Remove a recipe from a collection with optimistic update
 */
export function useRemoveFromCollection() {
  const queryClient = useQueryClient();
  const scope = useCollectionAccount();

  return freezeCollectionMutation(useMutation({
    mutationFn: ({ collectionId, recipeId, requestGuard }: { collectionId: string; recipeId: string } & Guarded) =>
      api.removeRecipeFromCollection(collectionId, recipeId, requestGuard),
    // Optimistic update - remove from collection immediately
    onMutate: (variables) => {
      variables.requestGuard?.();
      const { collectionId, recipeId } = variables;
      // Cancel queries without awaiting (fire-and-forget for speed)
      queryClient.cancelQueries({ queryKey: collectionKeys.recipeCollections(recipeId, scope.owner) });
      queryClient.cancelQueries({ queryKey: collectionKeys.recipes(collectionId, scope.owner) });
      queryClient.cancelQueries({ queryKey: collectionKeys.list(scope.owner) });

      // Snapshot the previous values
      // Note: recipeCollections returns string[] (collection IDs), NOT Collection[]
      const previousRecipeCollections = queryClient.getQueryData<string[]>(
        collectionKeys.recipeCollections(recipeId, scope.owner)
      );
      const previousCollectionRecipes = queryClient.getQueryData<CollectionRecipe[]>(
        collectionKeys.recipes(collectionId, scope.owner)
      );
      const previousCollectionList = queryClient.getQueryData<Collection[]>(collectionKeys.list(scope.owner));

      // Optimistically remove from the recipe's collections (filter by string ID)
      queryClient.setQueryData<string[]>(
        collectionKeys.recipeCollections(recipeId, scope.owner),
        (old) => old?.filter(id => id !== collectionId)
      );

      // Optimistically remove from the collection's recipes
      // Note: CollectionRecipe.id is the recipe ID, not recipe_id
      queryClient.setQueryData<CollectionRecipe[]>(
        collectionKeys.recipes(collectionId, scope.owner),
        (old) => old?.filter(r => r.id !== recipeId)
      );

      // Optimistically update the collection's recipe_count
      queryClient.setQueryData<Collection[]>(
        collectionKeys.list(scope.owner),
        (old) => old?.map(c => 
          c.id === collectionId 
            ? { ...c, recipe_count: Math.max(0, (c.recipe_count || 0) - 1) }
            : c
        )
      );

      return { ...scope, previousRecipeCollections, previousCollectionRecipes, previousCollectionList };
    },
    onError: (err, { collectionId, recipeId }, context) => {
      if (!context?.current()) return;
      // Rollback on error
      if (context?.previousRecipeCollections) {
        queryClient.setQueryData(
          collectionKeys.recipeCollections(recipeId, context.owner),
          context.previousRecipeCollections
        );
      }
      if (context?.previousCollectionRecipes) {
        queryClient.setQueryData(
          collectionKeys.recipes(collectionId, context.owner),
          context.previousCollectionRecipes
        );
      }
      if (context?.previousCollectionList) {
        queryClient.setQueryData(
          collectionKeys.list(context.owner),
          context.previousCollectionList
        );
      }
    },
    onSettled: (_, __, { collectionId, recipeId }, context) => {
      if (!context) return;
      // Invalidate to ensure we're in sync with server
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipeCollections(recipeId, context.owner) });
      queryClient.invalidateQueries({ queryKey: collectionKeys.recipes(collectionId, context.owner) });
      queryClient.invalidateQueries({ queryKey: collectionKeys.list(context.owner) });
    },
  }), scope);
}
