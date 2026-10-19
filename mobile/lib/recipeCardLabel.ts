import type { RecipeReviewState } from '@/types/recipe';
import { getRecipeTrustPresentation } from './recipeTrust';

export type RecipeCardLabelInput = {
  title: string;
  reviewState?: RecipeReviewState | null;
  totalTime?: string | null;
  servings?: number | null;
  sourceLabel?: string | null;
  author?: string | null;
  saved?: boolean;
};

/**
 * VoiceOver label for a tappable recipe card. The card groups its children,
 * so the label carries what a sighted user can scan on it: title, readiness
 * warning, time, servings, source, author and saved state.
 */
export function recipeCardAccessibilityLabel({
  title,
  reviewState,
  totalTime,
  servings,
  sourceLabel,
  author,
  saved,
}: RecipeCardLabelInput): string {
  const details = [
    title.trim() || 'Untitled recipe',
    getRecipeTrustPresentation(reviewState)?.accessibilityLabel,
    totalTime,
    servings ? `${servings} ${servings === 1 ? 'serving' : 'servings'}` : null,
    sourceLabel,
    author ? `by ${author}` : null,
    saved ? 'Saved' : null,
  ];
  return details
    .map((detail) => (typeof detail === 'string' ? detail.trim() : ''))
    .filter(Boolean)
    .join(', ');
}
