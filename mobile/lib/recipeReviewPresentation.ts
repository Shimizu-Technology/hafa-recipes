import type { RecipeReviewState } from '@/types/recipe';

/** Present the persisted recipe-review state in concise cooking language. */
export function getRecipeReviewLabel(state?: RecipeReviewState | null): string | null {
  if (state === 'source_incomplete') return 'Source incomplete · Add what the source did not show';
  if (state === 'needs_review') return 'Needs review · Compare this draft with the original';
  if (state === 'ready') return 'Ready to cook';
  return null;
}

/** Describe whether a recipe can enter cook mode and what warning it needs. */
export function getCookDraftPresentation(
  state: RecipeReviewState | null | undefined,
  instructionCount: number,
) {
  if (instructionCount === 0) {
    return {
      canCook: false,
      buttonLabel: 'Add instructions to cook',
      alertTitle: 'Instructions needed',
      alertMessage: 'This saved source does not have cooking instructions yet. Add them while viewing the original.',
    };
  }
  if (state === 'source_incomplete' || state === 'needs_review') {
    return {
      canCook: true,
      buttonLabel: 'Cook with draft',
      alertTitle: state === 'source_incomplete' ? 'Cook with an incomplete draft?' : 'Cook with an unverified draft?',
      alertMessage: 'Some cooking-critical details may be missing or inaccurate. Compare this draft with the original source as you cook.',
    };
  }
  return {
    canCook: true,
    buttonLabel: 'Start Cooking',
    alertTitle: null,
    alertMessage: null,
  };
}

/** Label an absent amount honestly unless the source explicitly supplied flexibility. */
export function getMissingQuantityLabel(
  _state: RecipeReviewState | null | undefined,
  ingredient: { name?: string | null; quantity?: string | null; unit?: string | null; notes?: string | null },
): string | null {
  const nullish = new Set(['', 'null', 'none', 'n/a', 'not stated', 'unknown']);
  const hasStatedValue = (value?: string | null) => (
    !!value && !nullish.has(value.trim().toLowerCase())
  );
  if (hasStatedValue(ingredient.quantity)) return null;
  const sourceLanguage = `${ingredient.name || ''} ${ingredient.unit || ''} ${ingredient.notes || ''}`.toLowerCase();
  if (['to taste', 'as needed', 'as desired', 'for garnish', 'optional'].some(
    phrase => sourceLanguage.includes(phrase),
  )) return null;
  return 'Not stated — verify original';
}

/** Trust the API's stable-identity ownership verdict, not a Clerk subject. */
export function isRecipeOwner(recipe?: { is_owner?: boolean | null } | null): boolean {
  return recipe?.is_owner === true;
}

/** Allow source actions only for fetchable web URLs. */
export function canOpenRecipeOriginal(sourceUrl?: string | null): boolean {
  return /^https?:\/\//i.test(sourceUrl || '');
}
