import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { PaginatedRecipes } from '@/types/recipe';

function isInfiniteRecipeData(data: unknown): data is InfiniteData<PaginatedRecipes> {
  if (!data || typeof data !== 'object' || !('pages' in data)) return false;
  const pages = (data as { pages?: unknown }).pages;
  return Array.isArray(pages) && pages.every((page) => (
    Boolean(page) && typeof page === 'object' && Array.isArray((page as { items?: unknown }).items)
  ));
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
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['discover'] }),
    queryClient.invalidateQueries({ queryKey: ['recipeSaved', recipeId], exact: true }),
  ]);
}
