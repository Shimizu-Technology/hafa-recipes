import type { RecipeReviewState } from '@/types/recipe';

export type RecipeTrustPresentation = {
  label: string;
  accessibilityLabel: string;
};

/** Keep draft wording consistent anywhere a recipe can be selected or used. */
export function getRecipeTrustPresentation(
  reviewState: RecipeReviewState | null | undefined,
): RecipeTrustPresentation | null {
  if (reviewState === 'source_incomplete') {
    return {
      label: 'Needs details',
      accessibilityLabel: 'Recipe needs source details',
    };
  }

  if (reviewState === 'needs_review') {
    return {
      label: 'Needs review',
      accessibilityLabel: 'Recipe needs review',
    };
  }

  return null;
}

/** Treat legacy string sentinels and whitespace as an unstated amount. */
export function hasStatedIngredientAmount(quantity: string | null | undefined): boolean {
  if (quantity == null) return false;
  const normalized = quantity.trim().toLowerCase();
  return normalized.length > 0 && normalized !== 'null';
}

export const MISSING_AMOUNT_LABEL = 'Amount not stated';
