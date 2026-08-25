/**
 * React Query client configuration.
 */

import { QueryClient } from '@tanstack/react-query';
import { shouldRetryAccountRequest } from './accountAccess';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 30 seconds
      staleTime: 30 * 1000,
      // Cache data for 5 minutes
      gcTime: 5 * 60 * 1000,
      // Authentication and other permanent client failures cannot heal by retrying.
      retry: shouldRetryAccountRequest,
      // Refetch on window focus (web) or app focus (mobile)
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Mutations opt into safe retries only when they carry an idempotency key.
      retry: 0,
    },
  },
});
