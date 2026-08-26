/** Stable route builders for navigation between related application records. */
export const appRoutes = {
  collection: (collectionId: string) => ({
    pathname: '/collection/[id]' as const,
    params: { id: collectionId },
  }),
  discover: '/(tabs)/discover' as const,
  planner: '/(tabs)/planner' as const,
  plannerDate: (date: string) => ({
    pathname: '/(tabs)/planner' as const,
    params: { date },
  }),
  plannerRecipe: (recipeId: string) => ({
    pathname: '/(tabs)/planner' as const,
    params: { recipeId },
  }),
  recipe: (recipeId: string) => ({
    pathname: '/recipe/[id]' as const,
    params: { id: recipeId },
  }),
};
