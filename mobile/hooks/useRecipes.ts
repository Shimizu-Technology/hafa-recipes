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

