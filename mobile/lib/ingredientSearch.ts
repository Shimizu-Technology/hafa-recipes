function normalizeIngredientSearchTerm(value: string): string {
  return value.trim().toLocaleLowerCase('en');
}

/** Parse a pasted or typed ingredient list into stable, unique search terms. */
export function parseIngredientSearchInput(input: string): string[] {
  const seen = new Set<string>();
  const ingredients: string[] = [];

  for (const value of input.split(/[,\n]+/)) {
    const ingredient = normalizeIngredientSearchTerm(value);
    if (!ingredient || seen.has(ingredient)) continue;
    seen.add(ingredient);
    ingredients.push(ingredient);
  }

  return ingredients;
}

/** Adds pasted or typed ingredients to an existing search without duplicates. */
export function mergeIngredientSearchInput(
  current: readonly string[],
  input: string,
): string[] {
  const merged = [
    ...current.map(normalizeIngredientSearchTerm).filter(Boolean),
    ...parseIngredientSearchInput(input),
  ];
  return [...new Set(merged)];
}
