/**
 * React Query hooks for recipe operations.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../lib/api';
import { ExtractRequest, JobStatus } from '../types/recipe';

const ACTIVE_JOB_KEY = 'active_extraction_job';

// Query keys
export const recipeKeys = {
  all: ['recipes'] as const,
  lists: () => [...recipeKeys.all, 'list'] as const,
  list: (filters: { limit?: number; offset?: number; sourceType?: string }) =>
    [...recipeKeys.lists(), filters] as const,
  recent: (limit?: number) => [...recipeKeys.all, 'recent', limit] as const,
  search: (query: string, sourceType?: string) => [...recipeKeys.all, 'search', query, sourceType] as const,
  details: () => [...recipeKeys.all, 'detail'] as const,
  detail: (id: string) => [...recipeKeys.details(), id] as const,
  count: (sourceType?: string) => [...recipeKeys.all, 'count', sourceType] as const,
  // Discover (public recipes)
  discover: () => ['discover'] as const,
  discoverList: (filters: { limit?: number; offset?: number; sourceType?: string }) =>
    [...recipeKeys.discover(), 'list', filters] as const,
  discoverSearch: (query: string, sourceType?: string) => [...recipeKeys.discover(), 'search', query, sourceType] as const,
  discoverCount: (sourceType?: string) => [...recipeKeys.discover(), 'count', sourceType] as const,
};

// ============================================================
// Query Hooks
// ============================================================

/**
 * Fetch all recipes with pagination and optional source filter
 */
export function useRecipes(limit = 50, offset = 0, sourceType?: string) {
  return useQuery({
    queryKey: recipeKeys.list({ limit, offset, sourceType }),
    queryFn: () => api.getRecipes(limit, offset, sourceType),
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
 * Search recipes with optional source filter
 */
export function useSearchRecipes(query: string, sourceType?: string) {
  return useQuery({
    queryKey: recipeKeys.search(query, sourceType),
    queryFn: () => api.searchRecipes(query, 20, sourceType),
    enabled: query.length > 0,
  });
}

/**
 * Get recipe count with optional source filter
 */
export function useRecipeCount(sourceType?: string) {
  return useQuery({
    queryKey: recipeKeys.count(sourceType),
    queryFn: () => api.getRecipeCount(sourceType),
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
 * Extract a recipe from URL (sync - legacy)
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
 * Async extraction with progress polling.
 * Supports background extraction - user can leave and come back.
 */
export function useAsyncExtraction() {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load any existing job on mount
  useEffect(() => {
    loadActiveJob();
    return () => {
      // Cleanup intervals on unmount
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // Load active job from storage
  const loadActiveJob = async () => {
    try {
      const stored = await AsyncStorage.getItem(ACTIVE_JOB_KEY);
      if (stored) {
        const { jobId: storedJobId, startTime: storedStartTime } = JSON.parse(stored);
        setJobId(storedJobId);
        setStartTime(storedStartTime);
        // Start polling for this job
        startPolling(storedJobId, storedStartTime);
      }
    } catch (e) {
      console.error('Failed to load active job:', e);
    }
  };

  // Save active job to storage
  const saveActiveJob = async (id: string, start: number) => {
    try {
      await AsyncStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId: id, startTime: start }));
    } catch (e) {
      console.error('Failed to save active job:', e);
    }
  };

  // Clear active job from storage
  const clearActiveJob = async () => {
    try {
      await AsyncStorage.removeItem(ACTIVE_JOB_KEY);
    } catch (e) {
      console.error('Failed to clear active job:', e);
    }
  };

  // Start polling for job status
  const startPolling = useCallback((id: string, start: number) => {
    setIsPolling(true);
    setElapsedTime(Math.floor((Date.now() - start) / 1000));

    // Update elapsed time every second
    timerIntervalRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    // Poll job status every 2 seconds
    const poll = async () => {
      try {
        const status = await api.getJobStatus(id);
        setJobStatus(status);

        if (status.status === 'completed' || status.status === 'failed') {
          // Stop polling
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          setIsPolling(false);
          await clearActiveJob();

          if (status.status === 'completed') {
            // Invalidate queries to show new recipe
            queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
            queryClient.invalidateQueries({ queryKey: recipeKeys.recent() });
            queryClient.invalidateQueries({ queryKey: recipeKeys.count() });
          } else if (status.status === 'failed') {
            setError(status.error_message || 'Extraction failed');
          }
        }
      } catch (e: any) {
        console.error('Poll error:', e);
        // Don't stop polling on network errors - job may still be running
      }
    };

    // Poll immediately
    poll();
    // Then poll every 2 seconds
    pollIntervalRef.current = setInterval(poll, 2000);
  }, [queryClient]);

  // Start a new extraction
  const startExtraction = async (request: ExtractRequest) => {
    setError(null);
    setJobStatus(null);

    try {
      const result = await api.startAsyncExtraction(request);

      // If recipe already exists, return immediately
      if (result.status === 'completed' && !result.job_id) {
        return {
          status: 'completed' as const,
          recipeId: (result as any).recipe_id,
          isExisting: true,
        };
      }

      // New job started
      const start = Date.now();
      setJobId(result.job_id);
      setStartTime(start);
      await saveActiveJob(result.job_id, start);
      startPolling(result.job_id, start);

      return {
        status: 'processing' as const,
        jobId: result.job_id,
        isExisting: false,
      };
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || e.message || 'Failed to start extraction';
      setError(errorMsg);
      throw new Error(errorMsg);
    }
  };

  // Cancel/reset state
  const reset = async () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    setJobId(null);
    setJobStatus(null);
    setIsPolling(false);
    setError(null);
    setStartTime(null);
    setElapsedTime(0);
    await clearActiveJob();
  };

  return {
    // State
    jobId,
    jobStatus,
    isPolling,
    error,
    elapsedTime,
    // Computed
    isExtracting: isPolling,
    isComplete: jobStatus?.status === 'completed',
    isFailed: jobStatus?.status === 'failed',
    recipeId: jobStatus?.recipe_id,
    progress: jobStatus?.progress || 0,
    currentStep: jobStatus?.current_step || '',
    message: jobStatus?.message || '',
    // Actions
    startExtraction,
    reset,
  };
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

// ============================================================
// Discover (Public Recipes) Hooks
// ============================================================

/**
 * Fetch public recipes with pagination and optional source filter
 */
export function useDiscoverRecipes(limit = 50, offset = 0, sourceType?: string) {
  return useQuery({
    queryKey: recipeKeys.discoverList({ limit, offset, sourceType }),
    queryFn: () => api.getPublicRecipes(limit, offset, sourceType),
  });
}

/**
 * Search public recipes with optional source filter
 */
export function useSearchPublicRecipes(query: string, sourceType?: string) {
  return useQuery({
    queryKey: recipeKeys.discoverSearch(query, sourceType),
    queryFn: () => api.searchPublicRecipes(query, 20, sourceType),
    enabled: query.length > 0,
  });
}

/**
 * Get public recipe count with optional source filter
 */
export function usePublicRecipeCount(sourceType?: string) {
  return useQuery({
    queryKey: recipeKeys.discoverCount(sourceType),
    queryFn: () => api.getPublicRecipeCount(sourceType),
  });
}

/**
 * Toggle recipe sharing (public/private)
 */
export function useToggleRecipeSharing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.toggleRecipeSharing(id),
    onSuccess: (data, id) => {
      // Invalidate the recipe detail to refresh is_public
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(id) });
      // Invalidate discover lists as the recipe may now be visible/hidden
      queryClient.invalidateQueries({ queryKey: recipeKeys.discover() });
      // Invalidate my recipes list
      queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
    },
  });
}

// ============================================================
// Saved/Bookmarked Recipes
// ============================================================

/**
 * Fetch saved recipes
 */
export function useSavedRecipes(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['savedRecipes', { limit, offset }],
    queryFn: () => api.getSavedRecipes(limit, offset),
  });
}

/**
 * Get saved recipes count
 */
export function useSavedRecipesCount() {
  return useQuery({
    queryKey: ['savedRecipesCount'],
    queryFn: () => api.getSavedRecipesCount(),
  });
}

/**
 * Check if a specific recipe is saved
 */
export function useIsRecipeSaved(recipeId: string, enabled = true) {
  return useQuery({
    queryKey: ['recipeSaved', recipeId],
    queryFn: () => api.checkRecipeSaved(recipeId),
    enabled: !!recipeId && enabled,
  });
}

/**
 * Save a recipe (with optimistic update for instant UI feedback)
 */
export function useSaveRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (recipeId: string) => api.saveRecipe(recipeId),
    // Optimistic update - update UI immediately before server responds
    onMutate: async (recipeId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['recipeSaved', recipeId] });
      
      // Snapshot the previous value
      const previousSaved = queryClient.getQueryData(['recipeSaved', recipeId]);
      
      // Optimistically update to the new value
      queryClient.setQueryData(['recipeSaved', recipeId], { is_saved: true });
      
      // Return context with the snapshot
      return { previousSaved, recipeId };
    },
    onError: (err, recipeId, context) => {
      // If the mutation fails, roll back to the previous value
      if (context?.previousSaved) {
        queryClient.setQueryData(['recipeSaved', recipeId], context.previousSaved);
      }
    },
    onSettled: (data, error, recipeId) => {
      // Always refetch after error or success to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['savedRecipes'] });
      queryClient.invalidateQueries({ queryKey: ['savedRecipesCount'] });
    },
  });
}

/**
 * Unsave a recipe (with optimistic update for instant UI feedback)
 */
export function useUnsaveRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (recipeId: string) => api.unsaveRecipe(recipeId),
    // Optimistic update - update UI immediately before server responds
    onMutate: async (recipeId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['recipeSaved', recipeId] });
      
      // Snapshot the previous value
      const previousSaved = queryClient.getQueryData(['recipeSaved', recipeId]);
      
      // Optimistically update to the new value
      queryClient.setQueryData(['recipeSaved', recipeId], { is_saved: false });
      
      // Return context with the snapshot
      return { previousSaved, recipeId };
    },
    onError: (err, recipeId, context) => {
      // If the mutation fails, roll back to the previous value
      if (context?.previousSaved) {
        queryClient.setQueryData(['recipeSaved', recipeId], context.previousSaved);
      }
    },
    onSettled: (data, error, recipeId) => {
      // Always refetch after error or success to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['savedRecipes'] });
      queryClient.invalidateQueries({ queryKey: ['savedRecipesCount'] });
    },
  });
}

