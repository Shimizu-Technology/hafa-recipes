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
export function getIngredientAmount(ingredient: Partial<Pick<Ingredient, 'name' | 'quantity' | 'unit' | 'notes' | 'quantityEstimate'>>) {
  const sourceLanguage = [ingredient.name, ingredient.unit, ingredient.notes].filter(Boolean).join(' ');
  const flexiblePhrase = sourceLanguage.match(/\b(?:to\s+taste|as\s+(?:needed|desired)|for\s+garnish|optional)\b/i)?.[0];
  const statedQuantity = hasStatedIngredientAmount(ingredient.quantity) ? ingredient.quantity : null;
  const qualitativeQuantity = !statedQuantity && flexiblePhrase ? flexiblePhrase.toLowerCase().replace(/\s+/g, ' ') : null;
  const estimate = !qualitativeQuantity && !statedQuantity
    && hasStatedIngredientAmount(ingredient.quantityEstimate?.quantity)
    ? ingredient.quantityEstimate : null;
  return {
    quantity: estimate?.quantity ?? statedQuantity ?? qualitativeQuantity ?? null,
    unit: qualitativeQuantity ? null : normalizeIngredientUnit(estimate ? estimate.unit : ingredient.unit),
    isEstimate: !!estimate,
    reason: estimate?.reason?.trim() || null,
  };
}

/** Grocery items use the displayed amount, with provenance retained in visible notes. */
export function ingredientToGroceryItem(ingredient: Ingredient) {
  const amount = getIngredientAmount(ingredient);
  const notes = getCookingNotes(ingredient.notes) || '';
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
  const sourceReference = /\b(?:description|caption|source|transcript|video|extraction)\b/i;
  const unavailableDetail = /\b(?:does not|doesn't|did not|didn't|not (?:stated|provided|specified|available)|missing|omitted|lacks?|insufficient|incomplete|could not|couldn't|unable to|low confidence)\b/i;
  const recipeInformation = /\b(?:ingredients?|amounts?|quantit(?:y|ies)|measurements?|temperatures?|tim(?:e|es|ing|ings)|instructions?|steps?|details?|extract(?:ion)?)\b/i;
  const missingAmount = /^(?:the )?(?:amount|quantity) (?:was )?(?:omitted|not (?:stated|provided|specified))[.!]?$/i;
  const isDiagnostic = (text: string) => missingAmount.test(text.trim())
    || (sourceReference.test(text) && unavailableDetail.test(text) && recipeInformation.test(text));
  // Keep intact cooking sentences. Only divide a mixed diagnostic at a clear new
  // clause, so comma-separated lists of missing details do not become fake notes.
  const cookingClause = '(?:chill|freeze|refrigerate|store|serve|cook|bake|boil|simmer|mix|stir|whisk|fold|knead|rest|let|allow|use|add|reduce|increase|avoid|keep|remove|drain|rinse|season|cover|preheat|heat|cool|cut|chop|slice|dice|toast|roast|fry|saute|steam|grill|marinate|soak|roll|shape|press|grease|line|brush|spread|sprinkle|finish|turn)';
  const diagnosticClause = '(?:(?:the )?(?:source|description|caption|transcript|video|extraction|amount|quantity))';
  const clauseBoundary = new RegExp(`;\\s*|,\\s*(?=(?:(?:and|but)\\s+)?(?:${cookingClause}|${diagnosticClause})\\b)`, 'i');
  const sentences = notes.trim().replace(/([.!?])\s+/g, '$1\n').split(/\n+/);
  return sentences.flatMap(sentence => {
    const clauses = sentence.split(clauseBoundary);
    if (!clauses.some(isDiagnostic)) return [sentence];
    return clauses.filter(clause => !isDiagnostic(clause));
  }).map(clause => clause.trim()).filter(Boolean).join(' ').trim() || null;
}
