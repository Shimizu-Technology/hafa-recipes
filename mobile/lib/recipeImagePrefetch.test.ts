import { describe, expect, it } from 'vitest';

import type { RecipeListItem } from '@/types/recipe';
import {
  MAX_THUMBNAIL_PREFETCH_BATCH,
  newlyExposedThumbnailUrls,
} from './recipeImagePrefetch';

const recipe = (id: number, thumbnailUrl = `https://img.example/${id}.webp`) => ({
  id: String(id),
  thumbnail_url: thumbnailUrl,
}) as RecipeListItem;

describe('newlyExposedThumbnailUrls', () => {
  it('schedules each URL once as more pages become visible', () => {
    const scheduled = new Set<string>();

    expect(newlyExposedThumbnailUrls([recipe(1), recipe(2)], scheduled)).toEqual([
      'https://img.example/1.webp',
      'https://img.example/2.webp',
    ]);
    expect(newlyExposedThumbnailUrls(
      [recipe(1), recipe(2), recipe(3)],
      scheduled,
    )).toEqual(['https://img.example/3.webp']);
  });

  it('deduplicates, skips empty URLs, and bounds each scheduling batch', () => {
    const scheduled = new Set<string>();
    const recipes = [
      recipe(0, ' '),
      ...Array.from(
        { length: MAX_THUMBNAIL_PREFETCH_BATCH + 5 },
        (_, index) => recipe(index + 1),
      ),
      recipe(100, 'https://img.example/1.webp'),
    ];

    const urls = newlyExposedThumbnailUrls(recipes, scheduled);

    expect(urls).toHaveLength(MAX_THUMBNAIL_PREFETCH_BATCH);
    expect(new Set(urls).size).toBe(MAX_THUMBNAIL_PREFETCH_BATCH);
  });
});
