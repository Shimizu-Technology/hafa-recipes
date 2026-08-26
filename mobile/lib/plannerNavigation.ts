import type { MealPlanEntryCreate, MealType, RecipeListItem } from '@/types/recipe';

export type MealPlanRecipe = Pick<RecipeListItem, 'id' | 'title' | 'thumbnail_url'>;

/** Parse an exact planner date without allowing JavaScript date rollover. */
export function parsePlannerDateParam(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Accept only a canonical UUID before requesting a recipe for planner handoff. */
export function parsePlannerRecipeParam(value: string | undefined): string | null {
  if (!value || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

/** Build the planner mutation from a server-backed recipe selection. */
export function buildMealPlanEntry(
  recipe: MealPlanRecipe,
  date: string,
  mealType: MealType,
): MealPlanEntryCreate {
  return {
    date,
    meal_type: mealType,
    recipe_id: recipe.id,
    recipe_title: recipe.title,
    recipe_thumbnail: recipe.thumbnail_url,
  };
}
