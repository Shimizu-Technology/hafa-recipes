import { QueryClient, QueryObserver, type InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { PaginatedRecipes, RecipeListItem } from '@/types/recipe';
import {
  reconcileSavedStateAfterError,
  removeDeletedRecipeFromCache,
  savedStateInRecipePages,
  updateSavedStateInRecipePages,
} from '@/lib/recipeCache';

function recipe(id: string, isSaved: boolean): RecipeListItem {
  return {
    id,
    title: `Recipe ${id}`,
    source_url: 'https://example.com/recipe',
    source_type: 'website',
    thumbnail_url: null,
    extraction_quality: null,
    has_audio_transcript: false,
    tags: [],
    servings: null,
    total_time: null,
    created_at: '2026-09-06T00:00:00Z',
    user_id: 'author',
    is_owner: false,
    is_saved: isSaved,
    extractor_display_name: 'Cook',
    is_public: true,
  };
}

function pages(): InfiniteData<PaginatedRecipes> {
  return {
    pages: [
      {
        items: [recipe('one', false)],
        total: 2,
        limit: 1,
        offset: 0,
        has_more: true,
      },
      {
        items: [recipe('two', false)],
        total: 2,
        limit: 1,
        offset: 1,
        has_more: false,
      },
    ],
    pageParams: [0, 1],
  };
}

describe('deleted recipe cache projection', () => {
  it('removes one recipe and adjusts the shared count once across all loaded pages', () => {
    const before = pages();
    const after = removeDeletedRecipeFromCache(before, 'two') as InfiniteData<PaginatedRecipes>;
    expect(after.pages.map(page => page.total)).toEqual([1, 1]);
    expect(after.pages[0].items.map(item => item.id)).toEqual(['one']);
    expect(after.pages[1].items).toEqual([]);
    expect(before.pages[1].items).toHaveLength(1);
  });
  it('leaves unrelated filters, count records, and unfetched results intact', () => {
    const before = pages(), count = { count: 5 };
    expect(removeDeletedRecipeFromCache(before, 'absent')).toBe(before);
    expect(removeDeletedRecipeFromCache(count, 'two')).toBe(count);
    expect(removeDeletedRecipeFromCache(undefined, 'two')).toBeUndefined();
  });
  it('removes a matching result from ordinary pages and recent arrays', () => {
    const before = pages().pages[0];
    expect(removeDeletedRecipeFromCache(before, 'one')).toMatchObject({ items: [], total: 1 });
    expect(removeDeletedRecipeFromCache(before.items, 'one')).toEqual([]);
  });
});

describe('updateSavedStateInRecipePages', () => {
  it('updates the matching recipe across an infinite Discover result', () => {
    const before = pages();
    const after = updateSavedStateInRecipePages(before, 'two', true)!;

    expect(after.pages[0].items[0].is_saved).toBe(false);
    expect(after.pages[1].items[0].is_saved).toBe(true);
    expect(before.pages[1].items[0].is_saved).toBe(false);
  });

  it('preserves an empty cache', () => {
    expect(updateSavedStateInRecipePages(undefined, 'one', true)).toBeUndefined();
  });

  it('ignores non-page entries under the shared Discover cache prefix', () => {
    const queryClient = new QueryClient();
    const count = { count: 2 };
    const contributors = [{ user_id: 'cook', recipe_count: 2 }];
    queryClient.setQueryData(['discover', 'count'], count);
    queryClient.setQueryData(['discover', 'topContributors'], contributors);
    queryClient.setQueryData(['discover', 'infinite'], pages());

    expect(() => queryClient.setQueriesData<InfiniteData<PaginatedRecipes>>(
      { queryKey: ['discover'] },
      (data) => updateSavedStateInRecipePages(data, 'one', true),
    )).not.toThrow();
    expect(queryClient.getQueryData(['discover', 'count'])).toBe(count);
    expect(queryClient.getQueryData(['discover', 'topContributors'])).toBe(contributors);
    expect((queryClient.getQueryData(
      ['discover', 'infinite'],
    ) as InfiniteData<PaginatedRecipes>).pages[0].items[0].is_saved).toBe(true);
  });

  it('can roll back one interleaved save without clobbering another', () => {
    const before = pages();
    const firstSnapshot = savedStateInRecipePages(before, 'one');
    const afterFirst = updateSavedStateInRecipePages(before, 'one', true)!;
    const afterSecond = updateSavedStateInRecipePages(afterFirst, 'two', true)!;
    const afterFirstFails = updateSavedStateInRecipePages(
      afterSecond,
      'one',
      firstSnapshot.isSaved,
    )!;

    expect(afterFirstFails.pages[0].items[0].is_saved).toBe(false);
    expect(afterFirstFails.pages[1].items[0].is_saved).toBe(true);
  });

  it('reconciles a stale same-recipe rollback with authoritative state', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = ['discover', 'feed'];
    const authoritativePages = pages();
    const afterSave = updateSavedStateInRecipePages(authoritativePages, 'one', true)!;
    const unsaveSnapshot = savedStateInRecipePages(afterSave, 'one');
    const afterUnsave = updateSavedStateInRecipePages(afterSave, 'one', false)!;
    const afterSaveFails = updateSavedStateInRecipePages(afterUnsave, 'one', false)!;
    const afterBothFail = updateSavedStateInRecipePages(
      afterSaveFails,
      'one',
      unsaveSnapshot.isSaved,
    )!;
    expect(afterBothFail.pages[0].items[0].is_saved).toBe(true);
    queryClient.setQueryData(queryKey, afterBothFail);

    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: async () => authoritativePages,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    await reconcileSavedStateAfterError(queryClient, 'one');

    const reconciled = queryClient.getQueryData<InfiniteData<PaginatedRecipes>>(queryKey);
    expect(reconciled?.pages[0].items[0].is_saved).toBe(false);
    unsubscribe();
  });
});

it('does not publish an old account reconciliation into the next account cache', async () => {
  const client = new QueryClient();
  client.setQueryData(['recipeSaved', 'one'], { is_saved: false });
  let finish!: (value: { is_saved: boolean }) => void;
  let authorized = true;
  const result = reconcileSavedStateAfterError(client, 'one', () => { if (!authorized) throw new Error('Account changed'); }, () => new Promise(resolve => { finish = resolve; }));
  authorized = false; finish({ is_saved: true });
  await expect(result).rejects.toThrow('Account changed');
  expect(client.getQueryData(['recipeSaved', 'one'])).toEqual({ is_saved: false });
});
