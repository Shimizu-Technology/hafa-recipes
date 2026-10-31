import type { RecipeListItem } from '@/types/recipe';

/** Only classify unambiguous durations; unknown or ranged times stay in All recipes. */
export function recipeMinutes(time: string | null): number | null {
  if (!time || !/^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*)?(?:(\d+)\s*(?:m|min|mins|minute|minutes))?$/i.test(time.trim())) return null;
  const match = time.trim().match(/^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*)?(?:(\d+)\s*(?:m|min|mins|minute|minutes))?$/i)!;
  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  return minutes > 0 ? minutes : null;
}
export function discoverSections(recipes: RecipeListItem[], now = Date.now()) {
  const week = 7 * 24 * 60 * 60 * 1000;
  return [
    { title: 'New this week', recipes: recipes.filter(r => { const age = now - Date.parse(r.created_at); return age >= 0 && age < week; }).slice(0, 4) },
    { title: 'Quick (under 30 min)', recipes: recipes.filter(r => { const minutes = recipeMinutes(r.total_time); return minutes !== null && minutes < 30; }).slice(0, 4) },
  ].filter(section => section.recipes.length > 0);
}
