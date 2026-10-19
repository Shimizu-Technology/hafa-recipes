/** Describe how many recipes are shown, e.g. "1 recipe", "24 recipes", "5 of 24 recipes". */
export function formatRecipeCount(total: number, shown?: number): string {
  const noun = total === 1 ? 'recipe' : 'recipes';
  if (shown !== undefined && shown !== total) return `${shown} of ${total} ${noun}`;
  return `${total} ${noun}`;
}

/** Describe the saved-recipe total shown in Settings, e.g. "9 recipes saved". */
export function formatSavedRecipeCount(total: number): string {
  return `${formatRecipeCount(total)} saved`;
}
