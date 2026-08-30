import type { RecipeReviewState } from '@/types/recipe';

export function getRecipeReviewLabel(state?: RecipeReviewState | null): string | null {
  if (state === 'source_incomplete') return 'Source incomplete · Add what the source did not show';
  if (state === 'needs_review') return 'Needs review · Compare this draft with the original';
  if (state === 'ready') return 'Ready to cook';
  return null;
}

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
