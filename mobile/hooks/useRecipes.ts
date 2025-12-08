/**
 * React Query hooks for recipe operations.
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../lib/api';
import { ExtractRequest, JobStatus, RecipeListItem, PaginatedRecipes } from '../types/recipe';

// Page size for infinite scroll
const PAGE_SIZE = 20;

const ACTIVE_JOB_KEY = 'active_extraction_job';

// Query keys
// Filter types
export type SearchFilters = {
  query?: string;
  sourceType?: string;
  timeFilter?: string;
  tags?: string[];
};

export const recipeKeys = {
  all: ['recipes'] as const,
  lists: () => [...recipeKeys.all, 'list'] as const,
  list: (filters: { limit?: number; offset?: number; sourceType?: string }) =>
    [...recipeKeys.lists(), filters] as const,
  infinite: (sourceType?: string) => [...recipeKeys.all, 'infinite', sourceType] as const,
  infiniteSearch: (filters: SearchFilters) => [...recipeKeys.all, 'infiniteSearch', filters] as const,
  recent: (limit?: number) => [...recipeKeys.all, 'recent', limit] as const,
  search: (filters: SearchFilters) => [...recipeKeys.all, 'search', filters] as const,
  details: () => [...recipeKeys.all, 'detail'] as const,
  detail: (id: string) => [...recipeKeys.details(), id] as const,
  count: (sourceType?: string) => [...recipeKeys.all, 'count', sourceType] as const,
  popularTags: (scope: 'user' | 'public') => [...recipeKeys.all, 'popularTags', scope] as const,
  // Saved recipes
  saved: () => ['savedRecipes'] as const,
  savedInfinite: () => [...recipeKeys.saved(), 'infinite'] as const,
  // Discover (public recipes)
  discover: () => ['discover'] as const,
  discoverList: (filters: { limit?: number; offset?: number; sourceType?: string }) =>
    [...recipeKeys.discover(), 'list', filters] as const,
  discoverInfinite: (sourceType?: string) => [...recipeKeys.discover(), 'infinite', sourceType] as const,
  discoverInfiniteSearch: (filters: SearchFilters) => [...recipeKeys.discover(), 'infiniteSearch', filters] as const,
  discoverSearch: (filters: SearchFilters) => [...recipeKeys.discover(), 'search', filters] as const,
  discoverCount: (sourceType?: string) => [...recipeKeys.discover(), 'count', sourceType] as const,
};

// ============================================================
// Query Hooks
// ============================================================

/**
 * Fetch all recipes with infinite scroll pagination
 */
export function useInfiniteRecipes(sourceType?: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: recipeKeys.infinite(sourceType),
    queryFn: ({ pageParam = 0 }) => api.getRecipes(PAGE_SIZE, pageParam, sourceType),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.limit;
    },
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Helper hook that flattens infinite query pages into a single array
 */
export function useRecipes(sourceType?: string, enabled = true) {
  const query = useInfiniteRecipes(sourceType, enabled);
  
  const recipes = useMemo(() => {
    if (!query.data?.pages) return [];
    return query.data.pages.flatMap(page => page.items);
  }, [query.data?.pages]);
  
  const total = query.data?.pages[0]?.total ?? 0;
  
  return {
    ...query,
    recipes,
    total,
    hasMore: query.hasNextPage,
  };
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
 * Search and filter recipes with infinite scroll
 */
export function useInfiniteSearchRecipes(filters: SearchFilters, enabled = true) {
  const { query, sourceType, timeFilter, tags } = filters;
  const hasFilters = query || sourceType || timeFilter || (tags && tags.length > 0);
  
  return useInfiniteQuery({
    queryKey: recipeKeys.infiniteSearch(filters),
    queryFn: ({ pageParam = 0 }) => 
      api.searchRecipes(query || '', PAGE_SIZE, pageParam, sourceType, timeFilter, tags),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.limit;
    },
    enabled: enabled && !!hasFilters,
    staleTime: 30_000,
  });
}

/**
 * Helper hook that flattens search results into a single array
 */
export function useSearchRecipes(filters: SearchFilters, enabled = true) {
  const { query, sourceType, timeFilter, tags } = filters;
  const hasFilters = query || sourceType || timeFilter || (tags && tags.length > 0);
  
  const infiniteQuery = useInfiniteSearchRecipes(filters, enabled);
  
  const recipes = useMemo(() => {
    if (!infiniteQuery.data?.pages) return [];
    return infiniteQuery.data.pages.flatMap(page => page.items);
  }, [infiniteQuery.data?.pages]);
  
  const total = infiniteQuery.data?.pages[0]?.total ?? 0;
  
  return {
    ...infiniteQuery,
    data: hasFilters ? recipes : undefined, // Keep existing behavior for backward compat
    recipes,
    total,
    hasMore: infiniteQuery.hasNextPage,
  };
}

/**
 * Get recipe count with optional source filter
 */
export function useRecipeCount(sourceType?: string, enabled = true) {
  return useQuery({
    queryKey: recipeKeys.count(sourceType),
    queryFn: () => api.getRecipeCount(sourceType),
    enabled,
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
    
    // Track consecutive auth errors
    let consecutiveAuthErrors = 0;
    const maxAuthErrors = 5;

    // Update elapsed time every second
    timerIntervalRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    // Poll job status every 2 seconds
    const poll = async () => {
      try {
        const status = await api.getJobStatus(id);
        setJobStatus(status);
        consecutiveAuthErrors = 0; // Reset on successful request

        if (status.status === 'completed' || status.status === 'failed') {
          // Stop polling
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          setIsPolling(false);
          await clearActiveJob();

          if (status.status === 'completed') {
            // Invalidate queries to show new/updated recipe
            queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
            queryClient.invalidateQueries({ queryKey: recipeKeys.recent() });
            queryClient.invalidateQueries({ queryKey: recipeKeys.count() });
            // Also invalidate the specific recipe (important for re-extraction)
            if (status.recipe_id) {
              queryClient.invalidateQueries({ queryKey: recipeKeys.detail(status.recipe_id) });
            }
          } else if (status.status === 'failed') {
            setError(status.error_message || 'Extraction failed');
          }
        }
      } catch (e: any) {
        const status = e?.response?.status;
        
        if (status === 401) {
          consecutiveAuthErrors++;
          console.warn(`Poll auth error ${consecutiveAuthErrors}/${maxAuthErrors} - network might be slow`);
          
          if (consecutiveAuthErrors >= maxAuthErrors) {
            // Stop polling after too many auth failures
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            setIsPolling(false);
            setError('Connection issue. The extraction may still complete - check your recipes later.');
            console.error('Stopped polling due to repeated auth errors');
            return;
          }
        } else {
          console.error('Poll error:', e?.message || e);
        }
        // Continue polling for non-fatal errors - job may still be running
      }
    };

    // Poll immediately
    poll();
    // Then poll every 2 seconds (slightly longer to be more forgiving on slow networks)
    pollIntervalRef.current = setInterval(poll, 2500);
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

  // Start re-extraction for an existing recipe
  const startReExtraction = async (recipeId: string, location: string = 'Guam') => {
    setError(null);
    setJobStatus(null);

    try {
      const result = await api.startReExtraction(recipeId, location);

      if (!result.job_id) {
        throw new Error('Failed to start re-extraction');
      }

      // Job started
      const start = Date.now();
      setJobId(result.job_id);
      setStartTime(start);
      await saveActiveJob(result.job_id, start);
      startPolling(result.job_id, start);

      return {
        status: 'processing' as const,
        jobId: result.job_id,
        recipeId: result.recipe_id,
      };
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || e.message || 'Failed to start re-extraction';
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
    startReExtraction,
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
 * Re-extract a recipe from its source URL
 */
export function useReExtractRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, location = "Guam" }: { id: string; location?: string }) =>
      api.reExtractRecipe(id, location),
    onSuccess: (updatedRecipe) => {
      // Update the detail cache
      queryClient.setQueryData(recipeKeys.detail(updatedRecipe.id), updatedRecipe);
      // Invalidate lists to show updated data
      queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
      queryClient.invalidateQueries({ queryKey: recipeKeys.discover() });
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
 * Fetch public recipes with infinite scroll pagination
 */
export function useInfiniteDiscoverRecipes(sourceType?: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: recipeKeys.discoverInfinite(sourceType),
    queryFn: ({ pageParam = 0 }) => api.getPublicRecipes(PAGE_SIZE, pageParam, sourceType),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.limit;
    },
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Helper hook that flattens discover results into a single array
 */
export function useDiscoverRecipes(sourceType?: string, enabled = true) {
  const query = useInfiniteDiscoverRecipes(sourceType, enabled);
  
  const recipes = useMemo(() => {
    if (!query.data?.pages) return [];
    return query.data.pages.flatMap(page => page.items);
  }, [query.data?.pages]);
  
  const total = query.data?.pages[0]?.total ?? 0;
  
  return {
    ...query,
    recipes,
    total,
    hasMore: query.hasNextPage,
  };
}

/**
 * Search and filter public recipes with infinite scroll
 */
export function useInfiniteSearchPublicRecipes(filters: SearchFilters, enabled = true) {
  const { query, sourceType, timeFilter, tags } = filters;
  const hasFilters = query || sourceType || timeFilter || (tags && tags.length > 0);
  
  return useInfiniteQuery({
    queryKey: recipeKeys.discoverInfiniteSearch(filters),
    queryFn: ({ pageParam = 0 }) => 
      api.searchPublicRecipes(query || '', PAGE_SIZE, pageParam, sourceType, timeFilter, tags),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.limit;
    },
    enabled: enabled && !!hasFilters,
    staleTime: 30_000,
  });
}

/**
 * Helper hook that flattens public search results into a single array
 */
export function useSearchPublicRecipes(filters: SearchFilters, enabled = true) {
  const { query, sourceType, timeFilter, tags } = filters;
  const hasFilters = query || sourceType || timeFilter || (tags && tags.length > 0);
  
  const infiniteQuery = useInfiniteSearchPublicRecipes(filters, enabled);
  
  const recipes = useMemo(() => {
    if (!infiniteQuery.data?.pages) return [];
    return infiniteQuery.data.pages.flatMap(page => page.items);
  }, [infiniteQuery.data?.pages]);
  
  const total = infiniteQuery.data?.pages[0]?.total ?? 0;
  
  return {
    ...infiniteQuery,
    data: hasFilters ? recipes : undefined, // Keep existing behavior for backward compat
    recipes,
    total,
    hasMore: infiniteQuery.hasNextPage,
  };
}

/**
 * Get public recipe count with optional source filter
 */
export function usePublicRecipeCount(sourceType?: string, enabled = true) {
  return useQuery({
    queryKey: recipeKeys.discoverCount(sourceType),
    queryFn: () => api.getPublicRecipeCount(sourceType),
    enabled,
  });
}

/**
 * Get popular tags for user's recipes or all public recipes
 */
export function usePopularTags(scope: 'user' | 'public' = 'user', enabled = true) {
  return useQuery({
    queryKey: recipeKeys.popularTags(scope),
    queryFn: () => api.getPopularTags(scope),
    enabled,
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
 * Fetch saved recipes with infinite scroll
 */
export function useInfiniteSavedRecipes(enabled = true) {
  return useInfiniteQuery({
    queryKey: recipeKeys.savedInfinite(),
    queryFn: ({ pageParam = 0 }) => api.getSavedRecipes(PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.limit;
    },
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Helper hook that flattens saved recipes into a single array
 */
export function useSavedRecipes(enabled = true) {
  const query = useInfiniteSavedRecipes(enabled);
  
  const recipes = useMemo(() => {
    if (!query.data?.pages) return [];
    return query.data.pages.flatMap(page => page.items);
  }, [query.data?.pages]);
  
  const total = query.data?.pages[0]?.total ?? 0;
  
  return {
    ...query,
    recipes,
    total,
    hasMore: query.hasNextPage,
  };
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

// ============================================================
// Client-Side Filtering Utilities
// ============================================================

/**
 * Parse time string to minutes for comparison
 * Examples: "30 minutes" -> 30, "1 hour" -> 60, "1 hour 30 minutes" -> 90
 */
function parseTimeToMinutes(timeStr: string | null): number | null {
  if (!timeStr) return null;
  
  let total = 0;
  const hourMatch = timeStr.match(/(\d+)\s*h(?:our)?s?/i);
  const minMatch = timeStr.match(/(\d+)\s*m(?:in(?:ute)?s?)?/i);
  
  if (hourMatch) total += parseInt(hourMatch[1]) * 60;
  if (minMatch) total += parseInt(minMatch[1]);
  
  // If no match, try to parse as just a number (assume minutes)
  if (!hourMatch && !minMatch) {
    const numMatch = timeStr.match(/(\d+)/);
    if (numMatch) total = parseInt(numMatch[1]);
  }
  
  return total > 0 ? total : null;
}

/**
 * Filter recipes client-side for instant UI feedback
 * This is used while the server request is in flight
 */
export function filterRecipesLocally(
  recipes: RecipeListItem[] | undefined,
  filters: SearchFilters
): RecipeListItem[] {
  if (!recipes) return [];
  
  const { query, sourceType, timeFilter, tags } = filters;
  
  return recipes.filter((recipe) => {
    // Source type filter
    if (sourceType && recipe.source_type !== sourceType) {
      return false;
    }
    
    // Time filter
    if (timeFilter) {
      const minutes = parseTimeToMinutes(recipe.total_time);
      if (minutes === null) {
        // If no time info, only include if filter is 'any' or not set
        if (timeFilter !== 'all') return false;
      } else {
        switch (timeFilter) {
          case 'quick': // Under 30 min
            if (minutes >= 30) return false;
            break;
          case 'medium': // 30-60 min
            if (minutes < 30 || minutes > 60) return false;
            break;
          case 'long': // Over 1 hour
            if (minutes <= 60) return false;
            break;
        }
      }
    }
    
    // Tag filter (recipe must have all selected tags)
    if (tags && tags.length > 0) {
      const recipeTags = recipe.tags.map(t => t.toLowerCase());
      const hasAllTags = tags.every(tag => 
        recipeTags.some(rt => rt.includes(tag.toLowerCase()))
      );
      if (!hasAllTags) return false;
    }
    
    // Search query filter
    if (query && query.trim()) {
      const searchLower = query.toLowerCase().trim();
      const titleMatch = recipe.title.toLowerCase().includes(searchLower);
      const tagMatch = recipe.tags.some(t => t.toLowerCase().includes(searchLower));
      if (!titleMatch && !tagMatch) return false;
    }
    
    return true;
  });
}
