/**
 * React Query hooks for recipe operations.
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData, useInfiniteQuery, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { AppState, AppStateStatus } from 'react-native';
import { api } from '../lib/api';
import { ExtractRequest, JobStatus, RecipeListItem, PaginatedRecipes } from '../types/recipe';

// Page size for infinite scroll
const PAGE_SIZE = 20;

const LEGACY_ACTIVE_JOB_KEY = 'active_extraction_job';
const ACTIVE_JOB_KEY_PREFIX = 'active_extraction_job_v2';
const MAX_STORED_JOB_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SUCCESS_POLL_DELAY_MS = 2_500;
const MAX_RETRY_POLL_DELAY_MS = 30_000;

type StoredExtractionRequest =
  | { kind: 'extract'; payload: ExtractRequest }
  | { kind: 'reextract'; recipeId: string; location: string };

type StoredExtractionJob = {
  userId: string;
  jobId: string | null;
  idempotencyKey: string;
  startTime: number;
  request: StoredExtractionRequest;
};

const activeJobKey = (userId: string) =>
  `${ACTIVE_JOB_KEY_PREFIX}:${encodeURIComponent(userId)}`;

const createIdempotencyKey = (kind: StoredExtractionRequest['kind']) =>
  `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

const transportRetryDelay = (failureCount: number) => {
  const exponential = Math.min(
    MAX_RETRY_POLL_DELAY_MS,
    SUCCESS_POLL_DELAY_MS * (2 ** Math.min(failureCount, 4)),
  );
  return Math.round(exponential * (0.8 + Math.random() * 0.4));
};

const serverAwarePollDelay = (status: JobStatus) => {
  if (!status.next_attempt_at) return SUCCESS_POLL_DELAY_MS;
  const untilRetry = new Date(status.next_attempt_at).getTime() - Date.now();
  return Math.min(15_000, Math.max(SUCCESS_POLL_DELAY_MS, untilRetry + 500));
};

// Query keys
// Filter types
export type SearchFilters = {
  query?: string;
  sourceType?: string;
  timeFilter?: string;
  tags?: string[];
  extractorId?: string;
  extractorName?: string; // For display purposes
  mealType?: string;
};

export const recipeKeys = {
  all: ['recipes'] as const,
  lists: () => [...recipeKeys.all, 'list'] as const,
  list: (filters: { limit?: number; offset?: number; sourceType?: string }) =>
    [...recipeKeys.lists(), filters] as const,
  infinite: (sourceType?: string) => [...recipeKeys.all, 'infinite', sourceType] as const,
  recentRoot: () => [...recipeKeys.all, 'recent'] as const,
  infiniteSearch: (filters: SearchFilters) => [...recipeKeys.all, 'infiniteSearch', filters] as const,
  recent: (limit?: number) => [...recipeKeys.all, 'recent', limit] as const,
  search: (filters: SearchFilters) => [...recipeKeys.all, 'search', filters] as const,
  details: () => [...recipeKeys.all, 'detail'] as const,
  detail: (id: string) => [...recipeKeys.details(), id] as const,
  countRoot: () => [...recipeKeys.all, 'count'] as const,
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

export function invalidateCreatedRecipeQueries(queryClient: QueryClient, recipeId?: string | null) {
  queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
  queryClient.invalidateQueries({ queryKey: recipeKeys.recentRoot() });
  queryClient.invalidateQueries({ queryKey: recipeKeys.countRoot() });
  queryClient.invalidateQueries({ queryKey: recipeKeys.discover() });
  queryClient.invalidateQueries({ queryKey: recipeKeys.popularTags('public') });
  queryClient.invalidateQueries({ queryKey: recipeKeys.topContributors() });
  if (recipeId) queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
}

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
    onSuccess: (recipe) => invalidateCreatedRecipeQueries(queryClient, recipe.id),
  });
}

/**
 * Async extraction with progress polling.
 * Supports background extraction - user can leave and come back.
 */
export function useAsyncExtractionController() {
  const queryClient = useQueryClient();
  const { userId, isLoaded: isAuthLoaded } = useAuth();
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [terminalState, setTerminalState] = useState<'failed' | 'cancelled' | 'expired' | null>(null);
  const [canRetryStart, setCanRetryStart] = useState(false);
  const [jobKind, setJobKind] = useState<StoredExtractionRequest['kind']>('extract');
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingGenerationRef = useRef(0);
  const pollInFlightRef = useRef(false);
  const currentJobIdRef = useRef<string | null>(null);
  const currentStartTimeRef = useRef<number | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const stopPollingTimers = useCallback((updateState = true) => {
    pollingGenerationRef.current += 1;
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    pollTimeoutRef.current = null;
    timerIntervalRef.current = null;
    if (updateState) setIsPolling(false);
  }, []);

  const clearActiveJob = useCallback(async () => {
    if (!userId) return;
    try {
      await AsyncStorage.removeItem(activeJobKey(userId));
    } catch {
      // Non-critical: a terminal entry is ignored once it ages out or is replaced.
    }
  }, [userId]);

  const saveActiveJob = useCallback(async (storedJob: StoredExtractionJob) => {
    try {
      await AsyncStorage.setItem(activeJobKey(storedJob.userId), JSON.stringify(storedJob));
    } catch {
      // The server still owns the durable job if local persistence is unavailable.
    }
  }, []);

  const invalidateCompletedRecipe = useCallback((recipeId?: string | null) => {
    invalidateCreatedRecipeQueries(queryClient, recipeId);
  }, [queryClient]);

  const startPolling = useCallback((id: string, startedAt: number) => {
    stopPollingTimers(false);
    const generation = pollingGenerationRef.current;
    currentJobIdRef.current = id;
    currentStartTimeRef.current = startedAt;
    setJobId(id);
    setStartTime(startedAt);
    setElapsedTime(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    setIsPolling(true);

    timerIntervalRef.current = setInterval(() => {
      setElapsedTime(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1_000);

    const scheduleNext = (poll: (failures: number) => Promise<void>, delay: number, failures: number) => {
      if (generation !== pollingGenerationRef.current || appStateRef.current !== 'active') return;
      pollTimeoutRef.current = setTimeout(() => void poll(failures), delay);
    };

    const poll = async (consecutiveFailures = 0): Promise<void> => {
      if (generation !== pollingGenerationRef.current || appStateRef.current !== 'active') return;
      if (pollInFlightRef.current) {
        scheduleNext(poll, 500, consecutiveFailures);
        return;
      }

      pollInFlightRef.current = true;
      try {
        const status = await api.getJobStatus(id);
        if (generation !== pollingGenerationRef.current) return;

        setJobStatus(status);
        setConnectionNotice(null);
        setError(null);
        setTerminalState(null);

        if (status.status === 'completed') {
          stopPollingTimers();
          await clearActiveJob();
          invalidateCompletedRecipe(status.recipe_id);
          return;
        }

        if (status.status === 'failed' || status.status === 'cancelled' || status.status === 'expired') {
          stopPollingTimers();
          await clearActiveJob();
          setTerminalState(status.status);
          if (status.status === 'cancelled') {
            setError('This extraction was cancelled. You can start it again whenever you are ready.');
          } else if (status.status === 'expired') {
            setError('This extraction expired before it finished. Please start a new extraction.');
          } else {
            setError(status.error_message || 'We could not finish this extraction. Please try again.');
          }
          return;
        }

        scheduleNext(poll, serverAwarePollDelay(status), 0);
      } catch (pollError: any) {
        if (generation !== pollingGenerationRef.current) return;
        const responseStatus = pollError?.response?.status;

        if (responseStatus === 404) {
          stopPollingTimers();
          await clearActiveJob();
          setTerminalState('failed');
          setError('We could not find this extraction. It may have expired; please start it again.');
          return;
        }

        const nextFailureCount = consecutiveFailures + 1;
        setConnectionNotice(
          responseStatus === 401
            ? 'Your session is reconnecting. The extraction is still safe on the server.'
            : 'Connection is unstable. The extraction is still running and we will keep checking.',
        );
        scheduleNext(poll, transportRetryDelay(nextFailureCount), nextFailureCount);
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void poll();
  }, [clearActiveJob, invalidateCompletedRecipe, stopPollingTimers]);

  const beginStoredRequest = useCallback(async (storedJob: StoredExtractionJob) => {
    setIsStarting(true);
    setCanRetryStart(false);
    setError(null);
    setConnectionNotice(null);
    setTerminalState(null);
    setJobKind(storedJob.request.kind);

    try {
      const result = storedJob.request.kind === 'extract'
        ? await api.startAsyncExtraction(storedJob.request.payload, storedJob.idempotencyKey)
        : await api.startReExtraction(
            storedJob.request.recipeId,
            storedJob.request.location,
            storedJob.idempotencyKey,
          );

      if (result.status === 'completed' && !result.job_id) {
        if (!result.recipe_id) throw new Error('The completed extraction did not include a recipe.');
        await clearActiveJob();
        setIsStarting(false);
        invalidateCompletedRecipe(result.recipe_id);
        setJobStatus({
          id: '',
          url: storedJob.request.kind === 'extract' ? storedJob.request.payload.url : '',
          status: 'completed',
          progress: 100,
          current_step: 'complete',
          message: 'Recipe already exists',
          recipe_id: result.recipe_id,
          error_message: null,
        });
        return {
          status: 'completed' as const,
          recipeId: result.recipe_id,
          isExisting: true,
        };
      }

      if (!result.job_id) throw new Error('The server did not return an extraction job.');

      const confirmedJob = { ...storedJob, jobId: result.job_id };
      await saveActiveJob(confirmedJob);
      setJobId(result.job_id);
      setStartTime(storedJob.startTime);
      startPolling(result.job_id, storedJob.startTime);
      setIsStarting(false);

      return {
        status: 'processing' as const,
        jobId: result.job_id,
        recipeId: result.recipe_id,
        isExisting: Boolean(result.is_existing),
      };
    } catch (startError: any) {
      setIsStarting(false);
      const responseStatus = startError?.response?.status as number | undefined;
      const definitivelyRejected = responseStatus !== undefined &&
        [400, 403, 404, 409, 422].includes(responseStatus);
      if (definitivelyRejected) {
        await clearActiveJob();
      } else {
        setCanRetryStart(true);
      }
      const message = definitivelyRejected
        ? startError.response?.data?.detail || 'We could not start this extraction.'
        : responseStatus === 401
          ? 'Your session needs to reconnect. Reconnect to safely check the same extraction request.'
          : responseStatus === 429
            ? 'The extraction service is busy. Reconnect shortly to safely check the same request.'
            : 'We could not confirm the start because the connection dropped. Reconnect to safely check the same request.';
      setTerminalState('failed');
      setError(message);
      throw new Error(message);
    }
  }, [clearActiveJob, invalidateCompletedRecipe, saveActiveJob, startPolling]);

  const retryPendingStart = useCallback(async () => {
    if (!userId) return;
    try {
      const raw = await AsyncStorage.getItem(activeJobKey(userId));
      if (!raw) {
        setCanRetryStart(false);
        setError('The pending extraction is no longer available. Please start again.');
        return;
      }
      const storedJob = JSON.parse(raw) as StoredExtractionJob;
      if (storedJob.userId !== userId || storedJob.jobId) {
        setCanRetryStart(false);
        if (storedJob.jobId) startPolling(storedJob.jobId, storedJob.startTime);
        return;
      }
      await beginStoredRequest(storedJob);
    } catch {
      // beginStoredRequest already preserves the pending key and friendly error.
    }
  }, [beginStoredRequest, startPolling, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appStateRef.current === 'active';
      appStateRef.current = nextState;

      if (nextState === 'active' && !wasActive) {
        if (currentJobIdRef.current && currentStartTimeRef.current) {
          startPolling(currentJobIdRef.current, currentStartTimeRef.current);
        }
      } else if (nextState !== 'active' && wasActive) {
        // The durable server worker continues; pause network/timer work locally.
        stopPollingTimers(false);
      }
    });
    return () => subscription.remove();
  }, [startPolling, stopPollingTimers]);

  useEffect(() => {
    stopPollingTimers();
    currentJobIdRef.current = null;
    currentStartTimeRef.current = null;
    setJobId(null);
    setJobStatus(null);
    setError(null);
    setConnectionNotice(null);
    setTerminalState(null);
    setCanRetryStart(false);
    setStartTime(null);
    setElapsedTime(0);

    if (!isAuthLoaded || !userId) return;

    let cancelled = false;
    const load = async () => {
      try {
        // The legacy entry was not account-scoped and cannot be resumed safely.
        await AsyncStorage.removeItem(LEGACY_ACTIVE_JOB_KEY);
        const raw = await AsyncStorage.getItem(activeJobKey(userId));
        if (!raw || cancelled) return;
        const storedJob = JSON.parse(raw) as StoredExtractionJob;
        if (storedJob.userId !== userId || Date.now() - storedJob.startTime > MAX_STORED_JOB_AGE_MS) {
          await AsyncStorage.removeItem(activeJobKey(userId));
          return;
        }

        setJobKind(storedJob.request.kind);
        if (storedJob.jobId) {
          startPolling(storedJob.jobId, storedJob.startTime);
        } else {
          setCanRetryStart(true);
          setTerminalState('failed');
          setError('The app did not receive the job confirmation. Reconnect to safely check the same request.');
        }
      } catch {
        // A malformed/stale local entry must never block a new extraction.
        await AsyncStorage.removeItem(activeJobKey(userId));
      }
    };
    void load();

    return () => {
      cancelled = true;
      stopPollingTimers();
    };
  }, [isAuthLoaded, startPolling, stopPollingTimers, userId]);

  const startExtraction = async (request: ExtractRequest) => {
    if (!userId) throw new Error('Please sign in before extracting a recipe.');
    if (isPolling || isStarting) throw new Error('An extraction is already in progress.');

    const storedJob: StoredExtractionJob = {
      userId,
      jobId: null,
      idempotencyKey: createIdempotencyKey('extract'),
      startTime: Date.now(),
      request: { kind: 'extract', payload: request },
    };
    await saveActiveJob(storedJob);
    return beginStoredRequest(storedJob);
  };

  const startReExtraction = async (recipeId: string, location = 'Guam') => {
    if (!userId) throw new Error('Please sign in before re-extracting a recipe.');
    if (isPolling || isStarting) throw new Error('Another extraction is already in progress.');

    const storedJob: StoredExtractionJob = {
      userId,
      jobId: null,
      idempotencyKey: createIdempotencyKey('reextract'),
      startTime: Date.now(),
      request: { kind: 'reextract', recipeId, location },
    };
    await saveActiveJob(storedJob);
    return beginStoredRequest(storedJob);
  };

  const reset = async () => {
    stopPollingTimers();
    currentJobIdRef.current = null;
    currentStartTimeRef.current = null;
    setJobId(null);
    setJobStatus(null);
    setIsStarting(false);
    setError(null);
    setConnectionNotice(null);
    setTerminalState(null);
    setCanRetryStart(false);
    setStartTime(null);
    setElapsedTime(0);
    await clearActiveJob();
  };

  const cancel = async () => {
    if (jobId) {
      try {
        await api.cancelJob(jobId);
      } catch (cancelError: any) {
        if (cancelError?.response?.status !== 404) throw cancelError;
      }
    }
    await reset();
  };

  const sourceUrl = jobStatus?.url || '';
  const isWebsiteExtraction = Boolean(sourceUrl) && (
    !sourceUrl.toLowerCase().includes('tiktok.com') &&
    !sourceUrl.toLowerCase().includes('youtube.com') &&
    !sourceUrl.toLowerCase().includes('youtu.be') &&
    !sourceUrl.toLowerCase().includes('instagram.com')
  );
  const resolvedTerminalState = jobStatus?.status === 'failed' ||
    jobStatus?.status === 'cancelled' || jobStatus?.status === 'expired'
    ? jobStatus.status
    : terminalState;

  return {
    jobId,
    jobStatus,
    jobKind,
    isPolling,
    isStarting,
    error,
    connectionNotice,
    canRetryStart,
    elapsedTime,
    isExtracting: isPolling || isStarting,
    isComplete: jobStatus?.status === 'completed',
    isFailed: Boolean(resolvedTerminalState),
    terminalStatus: resolvedTerminalState,
    isRetrying: jobStatus?.current_step === 'retrying' || Boolean(jobStatus?.next_attempt_at),
    recipeId: jobStatus?.recipe_id,
    progress: jobStatus?.progress || 0,
    currentStep: jobStatus?.current_step || '',
    message: jobStatus?.message || '',
    nextAttemptAt: jobStatus?.next_attempt_at || null,
    attemptCount: jobStatus?.attempt_count || 0,
    maxAttempts: jobStatus?.max_attempts || 0,
    sourceUrl,
    isWebsiteExtraction,
    lowConfidence: jobStatus?.low_confidence || false,
    confidenceWarning: jobStatus?.confidence_warning || null,
    startExtraction,
    startReExtraction,
    retryPendingStart,
    reset,
    cancel,
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
      // Cancel any outgoing refetches for both My Recipes and Discover
      await queryClient.cancelQueries({ queryKey: recipeKeys.all });
      await queryClient.cancelQueries({ queryKey: recipeKeys.discover() });
      
      // Snapshot previous data for rollback
      const previousRecipeQueries = queryClient.getQueriesData({ queryKey: recipeKeys.all });
      const previousDiscoverQueries = queryClient.getQueriesData({ queryKey: recipeKeys.discover() });
      
      // Helper function to remove recipe from paginated data
      const removeFromPages = (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items?.filter((item: any) => item.id !== deletedId) || [],
            total: Math.max(0, (page.total || 0) - 1),
          })),
        };
      };
      
      // Optimistically remove from My Recipes queries
      queryClient.setQueriesData(
        { queryKey: recipeKeys.all },
        removeFromPages
      );
      
      // Optimistically remove from Discover queries
      queryClient.setQueriesData(
        { queryKey: recipeKeys.discover() },
        removeFromPages
      );
      
      return { previousRecipeQueries, previousDiscoverQueries };
    },
    
    // On error, roll back both
    onError: (err, deletedId, context) => {
      if (context?.previousRecipeQueries) {
        context.previousRecipeQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      if (context?.previousDiscoverQueries) {
        context.previousDiscoverQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    
    onSuccess: (_, deletedId) => {
      // Remove detail from cache
      queryClient.removeQueries({ queryKey: recipeKeys.detail(deletedId) });
      // Invalidate counts to get accurate numbers (both My Recipes and Discover)
      queryClient.invalidateQueries({ queryKey: recipeKeys.count() });
      queryClient.invalidateQueries({ queryKey: recipeKeys.discoverCount() });
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
  sort: DiscoverSort = 'recent',
  mealType?: string
) {
  return useInfiniteQuery({
    queryKey: [...recipeKeys.discoverInfinite(sourceType), sort, mealType],
    queryFn: ({ pageParam = 0 }) => api.getPublicRecipes(PAGE_SIZE, pageParam, sourceType, sort, undefined, mealType),
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
  sort: DiscoverSort = 'recent',
  mealType?: string
) {
  const query = useInfiniteDiscoverRecipes(sourceType, enabled, sort, mealType);
  
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
  const { query, sourceType, timeFilter, tags, extractorId, mealType } = filters;
  const hasFilters = query || sourceType || timeFilter || (tags && tags.length > 0) || extractorId || mealType;
  
  return useInfiniteQuery({
    queryKey: recipeKeys.discoverInfiniteSearch(filters),
    queryFn: ({ pageParam = 0 }) => 
      api.searchPublicRecipes(query || '', PAGE_SIZE, pageParam, sourceType, timeFilter, tags, extractorId, mealType),
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
  const { query, sourceType, timeFilter, tags, extractorId, mealType } = filters;
  const hasFilters = query || sourceType || timeFilter || (tags && tags.length > 0) || extractorId || mealType;
  
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
export type Contributor = {
  user_id: string;
  contributor_id?: string;
  display_name: string;
  recipe_count: number;
};

export function useTopContributors(enabled = true) {
  return useQuery<Contributor[]>({
    queryKey: recipeKeys.topContributors(),
    queryFn: () => api.getTopContributors(),
    enabled,
    staleTime: 15_000, // Cache for 15 seconds - keeps counts fresh
    refetchOnMount: 'always', // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when app comes to foreground
  });
}

export function useAllContributors(enabled = true) {
  return useQuery<Contributor[]>({
    queryKey: ['allContributors'],
    queryFn: () => api.getAllContributors(),
    enabled,
    staleTime: 15_000, // Cache for 15 seconds - keeps counts fresh
    refetchOnMount: 'always', // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when app comes to foreground
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
    mutationFn: ({ id, isPublic }: { id: string; isPublic: boolean }) => api.setRecipeSharing(id, isPublic),
    // Optimistic update - toggle immediately in UI
    onMutate: async ({ id, isPublic }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: recipeKeys.detail(id) });

      // Snapshot the previous value
      const previousRecipe = queryClient.getQueryData(recipeKeys.detail(id));

      // Optimistically update the recipe detail
      queryClient.setQueryData(recipeKeys.detail(id), (old: any) => {
        if (!old) return old;
        return { ...old, is_public: isPublic };
      });

      // Return context with the snapshotted value
      return { previousRecipe };
    },
    onError: (err, { id }, context) => {
      // Rollback on error
      if (context?.previousRecipe) {
        queryClient.setQueryData(recipeKeys.detail(id), context.previousRecipe);
      }
    },
    onSettled: (data, error, { id }) => {
      invalidateCreatedRecipeQueries(queryClient, id);
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
// Captured Recipe Saving
// ============================================================

export function useSaveCapturedRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      extracted: any;
      source_type: 'photo' | 'text';
      is_public?: boolean;
    }) => api.saveCapturedRecipe(params),
    onSuccess: (data) => {
      invalidateCreatedRecipeQueries(queryClient, data.id);
      queryClient.invalidateQueries({ queryKey: ['myRecipes'] });
      console.log('Captured recipe saved successfully:', data.id);
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
