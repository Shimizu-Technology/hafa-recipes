/** Shared limits and normalization for pasted-recipe capture. */

export const MAX_PASTED_RECIPE_CHARS = 50_000;

/** Normalize clipboard line endings while preserving meaningful list indentation. */
export function normalizePastedRecipeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

export function canExtractPastedRecipe(value: string): boolean {
  const normalized = normalizePastedRecipeText(value);
  return normalized.length > 0 && normalized.length <= MAX_PASTED_RECIPE_CHARS;
}
