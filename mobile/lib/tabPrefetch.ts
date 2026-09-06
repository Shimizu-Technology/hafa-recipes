import type { QueryClient } from '@tanstack/react-query';

import { recipeKeys } from '@/hooks/useRecipes';
import { api } from '@/lib/api';

type PrefetchClient = Pick<QueryClient, 'prefetchInfiniteQuery' | 'prefetchQuery'>;

/** Warm public tab data for everyone and private library data only after sign-in. */
export function prefetchTabData(queryClient: PrefetchClient, isSignedIn: boolean): void {
  if (isSignedIn) {
    void queryClient.prefetchInfiniteQuery({
      queryKey: recipeKeys.infinite(undefined),
      queryFn: ({ pageParam = 0 }) => api.getRecipes(20, pageParam),
      initialPageParam: 0,
      staleTime: 30_000,
    });
    void queryClient.prefetchQuery({
      queryKey: recipeKeys.popularTags('user'),
      queryFn: () => api.getPopularTags('user'),
      staleTime: 60_000,
    });
  }

  void queryClient.prefetchInfiniteQuery({
    queryKey: recipeKeys.discoverFeed(undefined, 'recent', undefined),
    queryFn: ({ pageParam = 0 }) => api.getPublicRecipes(20, pageParam),
    initialPageParam: 0,
    staleTime: 30_000,
  });
  void queryClient.prefetchQuery({
    queryKey: recipeKeys.popularTags('public'),
    queryFn: () => api.getPopularTags('public'),
    staleTime: 60_000,
  });
}
