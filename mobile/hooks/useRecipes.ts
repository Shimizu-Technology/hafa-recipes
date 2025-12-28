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
  extractorId?: string;
  extractorName?: string; // For display purposes
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
  topContributors: () => [...recipeKeys.discover(), 'topContributors'] as const,
  // Ingredient search
  byIngredients: (ingredients: string[], includeSaved: boolean, includePublic: boolean) => 
    [...recipeKeys.all, 'byIngredients', ingredients.join(','), includeSaved, includePublic] as const,
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
 * Search recipes by ingredients ("What can I make with...?")
 */
export function useSearchByIngredients(
  ingredients: string[],
  includeSaved = true,
  includePublic = true,
  enabled = true
) {
  return useQuery({
    queryKey: recipeKeys.byIngredients(ingredients, includeSaved, includePublic),
    queryFn: () => api.searchByIngredients(ingredients, includeSaved, includePublic),
    enabled: enabled && ingredients.length > 0,
    staleTime: 30_000,
  });
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
  const [isStarting, setIsStarting] = useState(false); // Immediate loading state
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
        
        // Don't try to resume jobs older than 10 minutes - they're likely stale
        const MAX_JOB_AGE_MS = 10 * 60 * 1000; // 10 minutes
        const jobAge = Date.now() - storedStartTime;
        
        if (jobAge > MAX_JOB_AGE_MS) {
          console.warn(`Stale job found (${Math.round(jobAge / 1000 / 60)} min old) - clearing`);
          await clearActiveJob();
          return;
        }
        
        setJobId(storedJobId);
        setStartTime(storedStartTime);
        // Start polling for this job
        startPolling(storedJobId, storedStartTime);
      }
    } catch {
      // Non-critical: active job will restart on next extraction
    }
  };

  // Save active job to storage
  const saveActiveJob = async (id: string, start: number) => {
    try {
      await AsyncStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId: id, startTime: start }));
    } catch {
      // Non-critical: job will still complete, just won't persist across app restart
    }
  };

  // Clear active job from storage
  const clearActiveJob = async () => {
    try {
      await AsyncStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {
      // Non-critical: stale job entry will be overwritten on next extraction
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
        
        // Handle 404 - job doesn't exist (was cancelled, server restarted, etc.)
        if (status === 404) {
          console.warn('Job not found (404) - stopping polling');
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          setIsPolling(false);
          setIsStarting(false);
          await clearActiveJob();
          // Don't show an error - user likely cancelled or can just try again
          return;
        }
        
        if (status === 401) {
          consecutiveAuthErrors++;
          console.warn(`Poll auth error ${consecutiveAuthErrors}/${maxAuthErrors} - network might be slow`);
          
          if (consecutiveAuthErrors >= maxAuthErrors) {
            // Stop polling after too many auth failures
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            setIsPolling(false);
            setError('Connection issue. The extraction may still complete - check your recipes later.');
            return;
          }
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
    setIsStarting(true); // Show loading immediately

    try {
      const result = await api.startAsyncExtraction(request);

      // If recipe already exists, return immediately
      if (result.status === 'completed' && !result.job_id) {
        setIsStarting(false);
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
      // Start polling FIRST, then clear isStarting to avoid flicker
      // (ensures isPolling=true before isStarting=false)
      startPolling(result.job_id, start);
      setIsStarting(false);
      await saveActiveJob(result.job_id, start);

      return {
        status: 'processing' as const,
        jobId: result.job_id,
        isExisting: false,
      };
    } catch (e: any) {
      setIsStarting(false); // Clear on error
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

  // Reset state without cancelling the backend job
  const reset = async () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    setJobId(null);
    setJobStatus(null);
    setIsPolling(false);
    setIsStarting(false);
    setError(null);
    setStartTime(null);
    setElapsedTime(0);
    await clearActiveJob();
  };

  // Cancel the backend job AND reset state
  const cancel = async () => {
    // Try to cancel the backend job
    if (jobId) {
      try {
        await api.cancelJob(jobId);
        console.log('Job cancelled on backend');
      } catch (error: any) {
        // Job might already be completed or not found - that's okay
        console.log('Could not cancel job:', error.response?.status === 404 ? 'not found' : error.message);
      }
    }
    // Reset frontend state
    await reset();
  };

  // Determine if this is a website extraction based on URL
  const sourceUrl = jobStatus?.url || '';
  // Re-extraction jobs use "re-extract:{recipe_id}" format - these are always video extractions
  // (since re-extraction is primarily used for video recipes)
  const isReExtraction = sourceUrl.startsWith('re-extract:');
  const isWebsiteExtraction = sourceUrl && !isReExtraction ? (
    !sourceUrl.toLowerCase().includes('tiktok.com') &&
    !sourceUrl.toLowerCase().includes('youtube.com') &&
    !sourceUrl.toLowerCase().includes('youtu.be') &&
    !sourceUrl.toLowerCase().includes('instagram.com')
  ) : false;

  return {
    // State
    jobId,
    jobStatus,
    isPolling,
    isStarting,
    error,
    elapsedTime,
    // Computed
    isExtracting: isPolling || isStarting, // Show progress UI immediately when starting
    isComplete: jobStatus?.status === 'completed',
    isFailed: jobStatus?.status === 'failed',
    recipeId: jobStatus?.recipe_id,
    progress: jobStatus?.progress || 0,
    currentStep: jobStatus?.current_step || '',
    message: jobStatus?.message || '',
    sourceUrl, // The URL being extracted (useful for re-extractions)
    isWebsiteExtraction, // true for website, false for video (TikTok/YouTube/Instagram)
    // Confidence info
    lowConfidence: jobStatus?.low_confidence || false,
    confidenceWarning: jobStatus?.confidence_warning || null,
    // Actions
    startExtraction,
    startReExtraction,
    reset,
    cancel, // New: actually cancels the backend job
  };
}

/**
 * Delete a recipe with optimistic update
 */
export function useDeleteRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteRecipe(id),
    
    // Optimistic update - remove immediately from UI
    onMutate: async (deletedId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: recipeKeys.all });
      
      // Snapshot previous data for rollback
      const previousInfiniteQueries = queryClient.getQueriesData({ queryKey: recipeKeys.all });
      
      // Optimistically remove from all infinite queries
      queryClient.setQueriesData(
        { queryKey: recipeKeys.all },
        (old: any) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              items: page.items?.filter((item: any) => item.id !== deletedId) || [],
              total: Math.max(0, (page.total || 0) - 1),
            })),
          };
        }
      );
      
      return { previousInfiniteQueries };
    },
    
    // On error, roll back
    onError: (err, deletedId, context) => {
      if (context?.previousInfiniteQueries) {
        context.previousInfiniteQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    
    onSuccess: (_, deletedId) => {
      // Remove detail from cache
      queryClient.removeQueries({ queryKey: recipeKeys.detail(deletedId) });
      // Invalidate counts to get accurate numbers
      queryClient.invalidateQueries({ queryKey: recipeKeys.count() });
    },
    
    // No need to invalidate lists - optimistic update handles it
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

export type DiscoverSort = 'recent' | 'random' | 'popular';

/**
 * Fetch public recipes with infinite scroll pagination
 */
export function useInfiniteDiscoverRecipes(
  sourceType?: string, 
  enabled = true,
  sort: DiscoverSort = 'recent'
) {
  return useInfiniteQuery({
    queryKey: [...recipeKeys.discoverInfinite(sourceType), sort],
    queryFn: ({ pageParam = 0 }) => api.getPublicRecipes(PAGE_SIZE, pageParam, sourceType, sort),
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
export function useDiscoverRecipes(
  sourceType?: string, 
  enabled = true,
  sort: DiscoverSort = 'recent'
) {
  const query = useInfiniteDiscoverRecipes(sourceType, enabled, sort);
  
  const recipes = useMemo(() => {
    if (!query.data?.pages) return [];
    const allItems = query.data.pages.flatMap(page => page.items);
    // Deduplicate by ID (needed for random sort where items may repeat across pages)
    const seen = new Set<string>();
    return allItems.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
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
  const { query, sourceType, timeFilter, tags, extractorId } = filters;
  const hasFilters = query || sourceType || timeFilter || (tags && tags.length > 0) || extractorId;
  
  return useInfiniteQuery({
    queryKey: recipeKeys.discoverInfiniteSearch(filters),
    queryFn: ({ pageParam = 0 }) => 
      api.searchPublicRecipes(query || '', PAGE_SIZE, pageParam, sourceType, timeFilter, tags, extractorId),
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
  const { query, sourceType, timeFilter, tags, extractorId } = filters;
  const hasFilters = query || sourceType || timeFilter || (tags && tags.length > 0) || extractorId;
  
  const infiniteQuery = useInfiniteSearchPublicRecipes(filters, enabled);
  
  const recipes = useMemo(() => {
    if (!infiniteQuery.data?.pages) return [];
    const allItems = infiniteQuery.data.pages.flatMap(page => page.items);
    // Deduplicate by ID
    const seen = new Set<string>();
    return allItems.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
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
 * Get top contributors (users with most public recipes)
 */
export type Contributor = { user_id: string; display_name: string; recipe_count: number };

export function useTopContributors(enabled = true) {
  return useQuery<Contributor[]>({
    queryKey: recipeKeys.topContributors(),
    queryFn: () => api.getTopContributors(),
    enabled,
    staleTime: 15_000, // Cache for 15 seconds - keeps counts fresh
  });
}

export function useAllContributors(enabled = true) {
  return useQuery<Contributor[]>({
    queryKey: ['allContributors'],
    queryFn: () => api.getAllContributors(),
    enabled,
    staleTime: 15_000, // Cache for 15 seconds - keeps counts fresh
  });
}

/**
 * Fetch similar recipes based on tags
 */
export function useSimilarRecipes(recipeId: string | undefined, enabled = true) {
  return useQuery<RecipeListItem[]>({
    queryKey: ['similarRecipes', recipeId],
    queryFn: () => api.getSimilarRecipes(recipeId!),
    enabled: enabled && !!recipeId,
    staleTime: 5 * 60_000, // Cache for 5 minutes
  });
}

/**
 * Toggle recipe sharing (public/private) with optimistic update
 */
export function useToggleRecipeSharing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.toggleRecipeSharing(id),
    // Optimistic update - toggle immediately in UI
    onMutate: async (id) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: recipeKeys.detail(id) });

      // Snapshot the previous value
      const previousRecipe = queryClient.getQueryData(recipeKeys.detail(id));

      // Optimistically update the recipe detail
      queryClient.setQueryData(recipeKeys.detail(id), (old: any) => {
        if (!old) return old;
        return { ...old, is_public: !old.is_public };
      });

      // Return context with the snapshotted value
      return { previousRecipe };
    },
    onError: (err, id, context) => {
      // Rollback on error
      if (context?.previousRecipe) {
        queryClient.setQueryData(recipeKeys.detail(id), context.previousRecipe);
      }
    },
    onSettled: (data, error, id) => {
      // Sync with server state
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
// OCR Recipe Saving
// ============================================================

export function useSaveOcrRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { extracted: any; is_public?: boolean }) => 
      api.saveOcrRecipe(params),
    onSuccess: (data) => {
      // Invalidate recipe list queries to include the new recipe
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['myRecipes'] });
      console.log('✅ OCR recipe saved successfully:', data.id);
    },
    onError: () => {
      // Error handled by caller with Alert
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

// ============================================================
// Personal Recipe Notes
// ============================================================

export const noteKeys = {
  all: ['recipeNotes'] as const,
  detail: (recipeId: string) => [...noteKeys.all, recipeId] as const,
};

export const versionKeys = {
  all: ['recipeVersions'] as const,
  list: (recipeId: string) => [...versionKeys.all, 'list', recipeId] as const,
  detail: (recipeId: string, versionId: string) => [...versionKeys.all, 'detail', recipeId, versionId] as const,
  count: (recipeId: string) => [...versionKeys.all, 'count', recipeId] as const,
};

/**
 * Fetch the current user's personal note for a recipe
 */
export function useRecipeNote(recipeId: string, enabled = true) {
  return useQuery({
    queryKey: noteKeys.detail(recipeId),
    queryFn: () => api.getRecipeNote(recipeId),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Update or create a personal note for a recipe
 */
export function useUpdateRecipeNote() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ recipeId, noteText }: { recipeId: string; noteText: string }) =>
      api.updateRecipeNote(recipeId, noteText),
    onSuccess: (data, { recipeId }) => {
      // Update the cache with the new note
      queryClient.setQueryData(noteKeys.detail(recipeId), data);
    },
  });
}

/**
 * Delete a personal note from a recipe
 */
export function useDeleteRecipeNote() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (recipeId: string) => api.deleteRecipeNote(recipeId),
    onSuccess: (_, recipeId) => {
      // Set the cache to null (no note)
      queryClient.setQueryData(noteKeys.detail(recipeId), null);
    },
  });
}

// ============================================================
// Recipe Version History
// ============================================================

/**
 * Fetch all versions of a recipe
 */
export function useRecipeVersions(recipeId: string, enabled = true) {
  return useQuery({
    queryKey: versionKeys.list(recipeId),
    queryFn: () => api.getRecipeVersions(recipeId),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Fetch details of a specific version
 */
export function useRecipeVersionDetail(recipeId: string, versionId: string, enabled = true) {
  return useQuery({
    queryKey: versionKeys.detail(recipeId, versionId),
    queryFn: () => api.getRecipeVersionDetail(recipeId, versionId),
    enabled: enabled && !!versionId,
    staleTime: 60_000,
  });
}

/**
 * Fetch version count for a recipe
 */
export function useRecipeVersionCount(recipeId: string, enabled = true) {
  return useQuery({
    queryKey: versionKeys.count(recipeId),
    queryFn: () => api.getRecipeVersionCount(recipeId),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Restore a recipe to a specific version
 */
export function useRestoreRecipeVersion() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ recipeId, versionId }: { recipeId: string; versionId: string }) =>
      api.restoreRecipeVersion(recipeId, versionId),
    onSuccess: (_, { recipeId }) => {
      // Invalidate recipe detail to get updated data
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
      // Invalidate versions list (new version was created)
      queryClient.invalidateQueries({ queryKey: versionKeys.list(recipeId) });
      queryClient.invalidateQueries({ queryKey: versionKeys.count(recipeId) });
    },
  });
}
