/** Stable route builders for navigation between related application records. */
export const appRoutes = {
  discover: '/(tabs)/discover' as const,
  planner: '/(tabs)/planner' as const,
  recipe: (recipeId: string) => ({
    pathname: '/recipe/[id]' as const,
    params: { id: recipeId },
  }),
};
