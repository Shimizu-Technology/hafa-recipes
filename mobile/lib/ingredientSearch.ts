/** Parse a pasted or typed ingredient list into stable, unique search terms. */
export function parseIngredientSearchInput(input: string): string[] {
  const seen = new Set<string>();
  const ingredients: string[] = [];

  for (const value of input.split(/[,\n]+/)) {
    const ingredient = value.trim().toLocaleLowerCase('en');
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
  const merged = [...current, ...parseIngredientSearchInput(input)];
  return merged.filter((ingredient, index) => merged.indexOf(ingredient) === index);
}
