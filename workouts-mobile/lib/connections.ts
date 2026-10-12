export interface RecipeGrants {
  generation: number;
  revision: number;
  library_context: boolean;
  meal_plan_context: boolean;
  scopes: Array<{ scope: "recipes_library_context" | "recipes_meal_plan_context"; granted_at: string }>;
}
export interface DietaryRecipe {
  id: string;
  title: string;
  servings: number | null;
  ingredients: Array<{ name: string; quantity: string | null; unit: string | null }>;
  incomplete: boolean;
  nutrition: Record<string, number | null>;
  nutrition_basis: "source" | "recipe_servings" | "whole_recipe" | null;
  nutrition_status: "current" | "stale" | "unverified" | "unavailable";
}
export interface RecipeContext {
  receipt_id: string;
  scopes: string[];
  start_date: string;
  end_date: string;
  library: DietaryRecipe[];
  meal_plan: Array<{
    id: string;
    date: string;
    meal_type: string;
    planned_servings: string | null;
    recipe: DietaryRecipe;
  }>;
  notice: string;
}
