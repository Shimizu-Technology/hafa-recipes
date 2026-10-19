export function recipeCost(total: number | null | undefined, servings: number | null | undefined,
  scaleFactor = 1) {
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) return null;
  const knownServings = typeof servings === 'number' && Number.isFinite(servings) && servings > 0;
  const factor = knownServings && Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return { total: total * factor, perServing: knownServings ? total / servings : null };
}

export function recipeLoadError(error: unknown) {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (status === 404) return { title: 'Recipe not found', message: 'This recipe is no longer available.', canRetry: false };
  if (status === 403) return { title: 'Recipe unavailable', message: 'You do not have access to this recipe.', canRetry: false };
  if (status === 401) return { title: 'Sign in to open this recipe', message: 'Your session may have expired. Sign in again and retry.', canRetry: true };
  return { title: 'Couldn’t load this recipe', message: 'Check your connection and try again.', canRetry: true };
}

export type RecipeDetailView = 'preview' | 'loading' | 'unavailable' | 'recipe';

/**
 * Which recipe detail state to render. The cached card preview appears only
 * while loading; a settled error or the full recipe always replaces it.
 */
export function recipeDetailView({ isLoading, hasPreview, hasRecipe, error }: {
  isLoading: boolean;
  hasPreview: boolean;
  hasRecipe: boolean;
  error: unknown;
}): RecipeDetailView {
  if (isLoading) return hasPreview ? 'preview' : 'loading';
  if (!hasRecipe || (error && !canRetainRecipeOnError(error))) return 'unavailable';
  return 'recipe';
}

/** Cached recipe content is usable only when the server has not revoked access. */
export function canRetainRecipeOnError(error: unknown) {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === undefined || status >= 500 || status === 408 || status === 429;
}
