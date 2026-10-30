import { scopedRecipeKey } from './recipeQueryScope';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { PaginatedRecipes } from '@/types/recipe';

function isInfiniteRecipeData(data: unknown): data is InfiniteData<PaginatedRecipes> {
  if (!data || typeof data !== 'object' || !('pages' in data)) return false;
  const pages = (data as { pages?: unknown }).pages;
  return Array.isArray(pages) && pages.every((page) => (
    Boolean(page) && typeof page === 'object' && Array.isArray((page as { items?: unknown }).items)
  ));
}

/** Remove only a known match; unrelated filters and non-recipe cache values stay intact. */
export function removeDeletedRecipeFromCache(data: unknown, recipeId: string): unknown {
  const matches = (item: unknown) => !!item && typeof item === 'object'
    && 'id' in item && item.id === recipeId;
  if (Array.isArray(data)) return data.some(matches) ? data.filter(item => !matches(item)) : data;
  if (!data || typeof data !== 'object') return data;
  if (isInfiniteRecipeData(data)) {
    if (!data.pages.some(page => page.items.some(matches))) return data;
    return { ...data, pages: data.pages.map(page => ({
      ...page, items: page.items.filter(item => !matches(item)),
      ...(typeof page.total === 'number' ? { total: Math.max(0, page.total - 1) } : {}),
    })) };
  }
  if ('items' in data && Array.isArray(data.items) && data.items.some(matches)) {
    return { ...data, items: data.items.filter(item => !matches(item)),
      ...('total' in data && typeof data.total === 'number' ? { total: Math.max(0, data.total - 1) } : {}),
    };
  }
  return data;
}

export function updateSavedStateInRecipePages(
  data: InfiniteData<PaginatedRecipes> | undefined,
  recipeId: string,
  isSaved: boolean | null | undefined,
): InfiniteData<PaginatedRecipes> | undefined {
  if (!isInfiniteRecipeData(data)) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((recipe) => (
        recipe.id === recipeId ? { ...recipe, is_saved: isSaved } : recipe
      )),
    })),
  };
}

export type RecipeSavedStateSnapshot = {
  found: boolean;
  isSaved: boolean | null | undefined;
};

export function savedStateInRecipePages(
  data: InfiniteData<PaginatedRecipes> | undefined,
  recipeId: string,
): RecipeSavedStateSnapshot {
  if (!isInfiniteRecipeData(data)) return { found: false, isSaved: undefined };
  for (const page of data.pages) {
    const recipe = page.items.find((item) => item.id === recipeId);
    if (recipe) return { found: true, isSaved: recipe.is_saved };
  }
  return { found: false, isSaved: undefined };
}

/**
 * A failed optimistic mutation may have overlapped another mutation for the
 * same recipe. Re-read both active views so snapshot ordering cannot leave a
 * stale saved state behind.
 */
export async function reconcileSavedStateAfterError(
  queryClient: QueryClient,
  recipeId: string,
  guard?: () => void,
  readSaved?: () => Promise<{ is_saved: boolean }>,
): Promise<void> {
  if (guard && readSaved) {
    guard();
    const result = await readSaved();
    guard();
    queryClient.setQueryData(scopedRecipeKey(['recipeSaved', recipeId]), result);
    queryClient.setQueriesData<InfiniteData<PaginatedRecipes>>(
      { queryKey: ['discover'] },
      data => updateSavedStateInRecipePages(data, recipeId, result.is_saved),
    );
    return;
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['discover'] }),
    queryClient.invalidateQueries({ queryKey: ['recipeSaved', recipeId], exact: true }),
  ]);
}
