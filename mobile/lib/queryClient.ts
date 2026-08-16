/**
 * React Query client configuration.
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 30 seconds
      staleTime: 30 * 1000,
      // Cache data for 5 minutes
      gcTime: 5 * 60 * 1000,
      // Retry failed requests 2 times
      retry: 2,
      // Refetch on window focus (web) or app focus (mobile)
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Retry mutations once on failure
      retry: 1,
    },
  },
});

