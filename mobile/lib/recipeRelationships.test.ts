import { describe, expect, it } from 'vitest';

import type { Collection } from '@/types/recipe';
import { collectionsContainingRecipe } from './recipeRelationships';

function collection(id: string, name: string): Collection {
  return {
    id,
    name,
    emoji: null,
    recipe_count: 1,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  };
}

describe('recipe relationships', () => {
  it('returns known recipe collections in the canonical collection-list order', () => {
    const collections = [
      collection('weeknight', 'Weeknight Meals'),
      collection('favorites', 'Favorites'),
      collection('desserts', 'Desserts'),
    ];

    expect(collectionsContainingRecipe(
      collections,
      ['favorites', 'missing', 'weeknight', 'favorites'],
    )).toEqual([collections[0], collections[1]]);
  });

  it('returns no relationships until both source queries have data', () => {
    expect(collectionsContainingRecipe(undefined, ['favorites'])).toEqual([]);
    expect(collectionsContainingRecipe([collection('favorites', 'Favorites')], undefined))
      .toEqual([]);
  });
});
