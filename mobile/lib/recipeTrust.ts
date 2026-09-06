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

/** Normalize legacy null-like units before display, export, or persistence. */
export function normalizeIngredientUnit(unit: string | null | undefined): string | null {
  const normalized = unit?.trim();
  return normalized && normalized.toLowerCase() !== 'null' ? normalized : null;
}

/** Format Cook Mode amounts while filtering legacy null-like units. */
export function formatIngredientAmount(
  quantity: string | null | undefined,
  unit: string | null | undefined,
  scaledQuantity?: string | null,
): string {
  if (!hasStatedIngredientAmount(quantity)) return MISSING_AMOUNT_LABEL;

  const displayQuantity = scaledQuantity ?? quantity!.trim();
  const normalizedUnit = normalizeIngredientUnit(unit);
  const displayUnit = normalizedUnit ? ` ${normalizedUnit}` : '';
  return `${displayQuantity}${displayUnit}`;
}

export const MISSING_AMOUNT_LABEL = 'Amount not stated';
