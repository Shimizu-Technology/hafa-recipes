import type { RecipeListItem } from '@/types/recipe';

export const MAX_THUMBNAIL_PREFETCH_BATCH = 20;

/** Return only newly exposed URLs so pagination does not reschedule prior pages. */
export function newlyExposedThumbnailUrls(
  recipes: RecipeListItem[],
  scheduledUrls: Set<string>,
): string[] {
  const freshUrls: string[] = [];
  for (const recipe of recipes) {
    const url = recipe.thumbnail_url?.trim();
    if (!url || scheduledUrls.has(url)) continue;
    scheduledUrls.add(url);
    freshUrls.push(url);
    if (freshUrls.length === MAX_THUMBNAIL_PREFETCH_BATCH) break;
  }
  return freshUrls;
}
