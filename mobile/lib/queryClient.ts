/**
 * React Query client configuration.
 */

import { QueryClient } from '@tanstack/react-query';
import { shouldRetryAccountRequest } from './accountAccess';
import { bindReactQueryToNativeLifecycle } from './queryLifecycle';

// Make refetchOnWindowFocus/refetchOnReconnect work on iOS and Android.
bindReactQueryToNativeLifecycle();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 30 seconds
      staleTime: 30 * 1000,
      // Cache data for 5 minutes
      gcTime: 5 * 60 * 1000,
      // Authentication and other permanent client failures cannot heal by retrying.
      retry: shouldRetryAccountRequest,
      // Refetch stale queries when the app returns to the foreground (see queryLifecycle).
      refetchOnWindowFocus: true,
      // Always run the query function, even when NetInfo reports offline. Grocery
      // and other screens read their offline caches inside the query function, and
      // offline failures should still surface as errors rather than paused queries.
      networkMode: 'always',
    },
    mutations: {
      // Mutations opt into safe retries only when they carry an idempotency key.
      retry: 0,
      // Never pause mutations while offline: the grocery queue handles offline writes itself.
      networkMode: 'always',
    },
  },
});
