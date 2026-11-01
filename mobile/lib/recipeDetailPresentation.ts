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

export type RecipeDetailView = 'preview' | 'loading' | 'unavailable' | 'offline' | 'recipe';

/**
 * Which recipe detail state to render. The cached card preview appears only
 * while loading; a settled error or the full recipe always replaces it.
 */
export function recipeDetailView({ isLoading, hasPreview, hasRecipe, error, isOffline = false }: {
  isLoading: boolean;
  isOffline?: boolean;
  hasPreview: boolean;
  hasRecipe: boolean;
  error: unknown;
}): RecipeDetailView {
  if (error && !canRetainRecipeOnError(error)) return 'unavailable';
  if (hasRecipe) return 'recipe';
  if (isOffline) return 'offline';
  if (isLoading || !error) return hasPreview ? 'preview' : 'loading';
  return 'unavailable';
}

/** Cached recipe content is usable only when the server has not revoked access. */
export function canRetainRecipeOnError(error: unknown) {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === undefined || status >= 500 || status === 408 || status === 429;
}

export type RecipeFact = { icon: 'people-outline' | 'timer-outline' | 'time-outline'; value: string; label: string };

/** Only the facts the recipe actually states; unknown servings or times are left out rather than shown as dashes. */
export function recipeFacts(servings: number | null, times: { prep?: string | null; cook?: string | null; total?: string | null } | null | undefined): RecipeFact[] {
  const clean = (value?: string | null) => value?.trim() || null;
  const prep = clean(times?.prep);
  const total = clean(times?.total);
  const cook = clean(times?.cook);
  return [
    ...(servings ? [{ icon: 'people-outline' as const, value: String(servings), label: servings === 1 ? 'serving' : 'servings' }] : []),
    ...(prep ? [{ icon: 'timer-outline' as const, value: prep, label: 'prep' }] : []),
    ...(total ? [{ icon: 'time-outline' as const, value: total, label: 'total' }]
      : cook ? [{ icon: 'time-outline' as const, value: cook, label: 'cook' }] : []),
  ];
}

/** Turn stored tag slugs ("peanut-butter-cookies") into readable chips ("Peanut butter cookies"), once each. */
export function recipeTagLabels(tags: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  return (tags ?? []).flatMap((tag) => {
    const words = String(tag).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    const key = words.toLowerCase();
    if (!words || seen.has(key)) return [];
    seen.add(key);
    return [words.charAt(0).toUpperCase() + words.slice(1)];
  });
}
