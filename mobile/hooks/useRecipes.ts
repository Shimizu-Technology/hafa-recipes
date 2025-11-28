/**
 * React Query hooks for recipe operations.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ExtractRequest } from '../types/recipe';

// Query keys
export const recipeKeys = {
  all: ['recipes'] as const,
  lists: () => [...recipeKeys.all, 'list'] as const,
  list: (filters: { limit?: number; offset?: number }) =>
    [...recipeKeys.lists(), filters] as const,
  recent: (limit?: number) => [...recipeKeys.all, 'recent', limit] as const,
  search: (query: string) => [...recipeKeys.all, 'search', query] as const,
  details: () => [...recipeKeys.all, 'detail'] as const,
  detail: (id: string) => [...recipeKeys.details(), id] as const,
  count: () => [...recipeKeys.all, 'count'] as const,
};

// ============================================================
// Query Hooks
// ============================================================

/**
 * Fetch all recipes with pagination
 */
export function useRecipes(limit = 50, offset = 0) {
  return useQuery({
    queryKey: recipeKeys.list({ limit, offset }),
    queryFn: () => api.getRecipes(limit, offset),
  });
}

/**
 * Fetch recent recipes
 */
export function useRecentRecipes(limit = 10) {
  return useQuery({
    queryKey: recipeKeys.recent(limit),
    queryFn: () => api.getRecentRecipes(limit),
  });
}

/**
 * Fetch a single recipe by ID
 */
export function useRecipe(id: string) {
  return useQuery({
    queryKey: recipeKeys.detail(id),
    queryFn: () => api.getRecipe(id),
    enabled: !!id,
  });
}

/**
 * Search recipes
 */
export function useSearchRecipes(query: string) {
  return useQuery({
    queryKey: recipeKeys.search(query),
    queryFn: () => api.searchRecipes(query),
    enabled: query.length > 0,
  });
}

/**
 * Get recipe count
 */
export function useRecipeCount() {
  return useQuery({
    queryKey: recipeKeys.count(),
    queryFn: () => api.getRecipeCount(),
  });
}

/**
 * Get available locations
 */
export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: () => api.getLocations(),
    staleTime: Infinity, // Locations don't change
  });
}

// ============================================================
// Mutation Hooks
// ============================================================

/**
 * Extract a recipe from URL
 */
export function useExtractRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: ExtractRequest) => api.extractRecipe(request),
    onSuccess: () => {
      // Invalidate recipe lists to refetch with new recipe
      queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
      queryClient.invalidateQueries({ queryKey: recipeKeys.recent() });
      queryClient.invalidateQueries({ queryKey: recipeKeys.count() });
    },
  });
}

/**
 * Delete a recipe
 */
export function useDeleteRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteRecipe(id),
    onSuccess: (_, deletedId) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: recipeKeys.detail(deletedId) });
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
      queryClient.invalidateQueries({ queryKey: recipeKeys.recent() });
      queryClient.invalidateQueries({ queryKey: recipeKeys.count() });
    },
  });
}

/**
 * Update a recipe
 */
export function useUpdateRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      update,
    }: {
      id: string;
      update: { title?: string; servings?: number; notes?: string; tags?: string[] };
    }) => api.updateRecipe(id, update),
    onSuccess: (data, { id }) => {
      // Update cache with new data
      queryClient.setQueryData(recipeKeys.detail(id), data);
      // Invalidate lists (title might have changed)
      queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
      queryClient.invalidateQueries({ queryKey: recipeKeys.recent() });
    },
  });
}

/**
 * Check for duplicate recipe
 */
export function useCheckDuplicate() {
  return useMutation({
    mutationFn: (url: string) => api.checkDuplicate(url),
  });
}

