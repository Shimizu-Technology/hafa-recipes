import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useRecipes', () => ({
  recipeKeys: {
    infinite: (sourceType?: string) => ['recipes', 'infinite', sourceType],
    discoverFeed: (sourceType?: string, sort = 'recent', mealType?: string) =>
      ['discover', 'infinite', sourceType, sort, mealType],
    popularTags: (scope: string) => ['recipes', 'popularTags', scope],
  },
}));
vi.mock('@/lib/api', () => ({
  api: {
    getRecipes: vi.fn(),
    getPublicRecipes: vi.fn(),
    getPopularTags: vi.fn(),
  },
}));

import { prefetchTabData } from './tabPrefetch';

function client() {
  return {
    prefetchInfiniteQuery: vi.fn<(options: { queryKey: readonly unknown[] }) => Promise<void>>(
      async () => undefined,
    ),
    prefetchQuery: vi.fn<(options: { queryKey: readonly unknown[] }) => Promise<void>>(
      async () => undefined,
    ),
  };
}

describe('prefetchTabData', () => {
  it('uses the exact Discover consumer key for guests', () => {
    const queryClient = client();
    prefetchTabData(queryClient as unknown as Parameters<typeof prefetchTabData>[0], false);

    expect(queryClient.prefetchInfiniteQuery).toHaveBeenCalledOnce();
    expect(queryClient.prefetchInfiniteQuery.mock.calls[0][0].queryKey).toEqual(
      ['discover', 'infinite', undefined, 'recent', undefined],
    );
    expect(queryClient.prefetchQuery).toHaveBeenCalledOnce();
    expect(queryClient.prefetchQuery.mock.calls[0][0].queryKey).toEqual(
      ['recipes', 'popularTags', 'public'],
    );
  });

  it('also warms private library data after sign-in', () => {
    const queryClient = client();
    prefetchTabData(queryClient as unknown as Parameters<typeof prefetchTabData>[0], true);

    expect(queryClient.prefetchInfiniteQuery).toHaveBeenCalledTimes(2);
    expect(queryClient.prefetchInfiniteQuery.mock.calls.map(([options]) => options.queryKey)).toEqual([
      ['recipes', 'infinite', undefined],
      ['discover', 'infinite', undefined, 'recent', undefined],
    ]);
    expect(queryClient.prefetchQuery.mock.calls.map(([options]) => options.queryKey)).toEqual([
      ['recipes', 'popularTags', 'user'],
      ['recipes', 'popularTags', 'public'],
    ]);
  });
});
