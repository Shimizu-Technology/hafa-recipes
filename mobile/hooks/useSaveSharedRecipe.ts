import { api } from '@/lib/api';
import { recipeKeys } from '@/hooks/useRecipes';
import { useRecipeMutation as useMutation, useRecipeQueryClient as useQueryClient } from '@/hooks/useRecipeQuery';

export type SharedSaveProblem = {
  kind: 'own' | 'unavailable' | 'rate-limited' | 'sign-in' | 'failed';
  message: string;
  /** Whether Save can be tried again from the same screen. */
  canRetry: boolean;
};

/** "in 20 seconds" from a Retry-After, or "in a minute" when it's missing or long. */
export function retryWait(retryAfter?: number): string {
  return retryAfter && retryAfter < 60 ? `in ${Math.ceil(retryAfter)} seconds` : 'in a minute';
}

/** Plain words for each way POST /public/r/{key}/save can fail. */
export function sharedSaveProblem(error: unknown): SharedSaveProblem {
  const { status, retryAfter } = (error ?? {}) as { status?: number; retryAfter?: number };
  switch (status) {
    case 400:
      return { kind: 'own', message: 'This is your recipe, so it’s already in your library.', canRetry: false };
    case 401:
      return { kind: 'sign-in', message: 'Sign in to save this recipe.', canRetry: true };
    case 404:
      return { kind: 'unavailable', message: 'This recipe can’t be saved. It may be private now, or the link was turned off.', canRetry: false };
    case 429:
      return { kind: 'rate-limited', message: `Too many saves at once. Try again ${retryWait(retryAfter)}.`, canRetry: true };
    default:
      return { kind: 'failed', message: 'Couldn’t save. Check your connection and try again.', canRetry: true };
  }
}

/** Save a recipe opened from a Håfa link as a private copy; the library refreshes to include it. */
export function useSaveSharedRecipe(key: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!key) throw Object.assign(new Error('Missing link'), { status: 404 });
      return api.saveSharedRecipe(key);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: recipeKeys.all }),
  });
}
