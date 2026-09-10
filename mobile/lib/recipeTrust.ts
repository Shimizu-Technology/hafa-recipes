import type { Ingredient, RecipeReviewState } from '@/types/recipe';

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
      label: 'Some details uncertain',
      accessibilityLabel: 'Some recipe details are uncertain',
    };
  }

  return null;
}

/** Treat legacy string sentinels and whitespace as an unstated amount. */
export function hasStatedIngredientAmount(quantity: string | null | undefined): boolean {
  if (quantity == null) return false;
  const normalized = quantity.trim().toLowerCase();
  return !['', 'null', 'none', 'n/a', 'not stated', 'unknown'].includes(normalized);
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

/** Use an estimate only when no source amount exists, keeping its origin visible. */
export function getIngredientAmount(ingredient: Pick<Ingredient, 'quantity' | 'unit' | 'quantityEstimate'>) {
  const estimate = !hasStatedIngredientAmount(ingredient.quantity)
    && hasStatedIngredientAmount(ingredient.quantityEstimate?.quantity)
    ? ingredient.quantityEstimate : null;
  return {
    quantity: estimate?.quantity ?? (hasStatedIngredientAmount(ingredient.quantity) ? ingredient.quantity : null),
    unit: normalizeIngredientUnit(estimate ? estimate.unit : ingredient.unit),
    isEstimate: !!estimate,
    reason: estimate?.reason?.trim() || null,
  };
}

/** Grocery items use the displayed amount, with provenance retained in visible notes. */
export function ingredientToGroceryItem(ingredient: Ingredient) {
  const amount = getIngredientAmount(ingredient);
  const notes = ingredient.notes && ingredient.notes.toLowerCase() !== 'null' ? ingredient.notes.trim() : '';
  const estimateNote = amount.isEstimate
    ? `AI estimate${amount.reason ? `: ${amount.reason}` : ''}` : '';
  return {
    name: ingredient.name,
    quantity: amount.quantity,
    unit: amount.unit,
    notes: [estimateNote, notes].filter(Boolean).join(' · ') || null,
  };
}

/** Older imports sometimes stored extraction diagnostics instead of cooking notes. */
export function getCookingNotes(notes: string | null | undefined): string | null {
  if (!notes || ['null', 'none', 'n/a'].includes(notes.trim().toLowerCase())) return null;
  // Filter diagnostic sentences, while retaining real tips from a mixed notes field.
  const sentences = notes.trim().replace(/([.!?])\s+/g, '$1\n').split(/\n+/);
  const diagnostics = /\b(?:the (?:description|caption|source|transcript|video) (?:identifies|does not|doesn't|did not|lacks|only|provides|contains)|(?:no|missing|insufficient|incomplete) (?:full |complete |exact |detailed )?(?:ingredient list|recipe details|measurements|instructions)|(?:could not|couldn't|unable to) extract|extraction (?:quality|confidence|failed)|low confidence)\b/i;
  return sentences.filter(sentence => !diagnostics.test(sentence)).join(' ').trim() || null;
}
