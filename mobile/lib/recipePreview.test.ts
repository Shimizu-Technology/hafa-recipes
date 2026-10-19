import { describe, expect, it } from 'vitest';

import { findRecipePreview } from './recipePreview';

const card = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Recipe ${id}`,
  source_url: `https://example.com/${id}`,
  source_type: 'website',
  thumbnail_url: `https://img.example.com/${id}.jpg`,
  total_time: '30 min',
  servings: 4,
  is_owner: true,
  is_public: false,
  user_id: 'user-1',
  ...overrides,
});

describe('findRecipePreview', () => {
  it('finds a card inside infinite query pages', () => {
    const infinite = { pages: [{ items: [card('a')] }, { items: [card('b')] }], pageParams: [0, 20] };
    expect(findRecipePreview([infinite], 'b')).toEqual({
      id: 'b',
      title: 'Recipe b',
      thumbnailUrl: 'https://img.example.com/b.jpg',
      sourceUrl: 'https://example.com/b',
      totalTime: '30 min',
      servings: 4,
    });
  });

  it('finds cards in paginated responses, plain arrays and ingredient matches', () => {
    expect(findRecipePreview([{ items: [card('a')] }], 'a')?.title).toBe('Recipe a');
    expect(findRecipePreview([[card('c')]], 'c')?.title).toBe('Recipe c');
    expect(findRecipePreview([[{ recipe: card('d'), matched_ingredients: [] }]], 'd')?.title).toBe('Recipe d');
  });

  it('never carries ownership, visibility or editing fields', () => {
    const preview = findRecipePreview([[card('a')]], 'a');
    expect(Object.keys(preview ?? {}).sort()).toEqual(['id', 'servings', 'sourceUrl', 'thumbnailUrl', 'title', 'totalTime']);
  });

  it('normalizes missing or unusable optional fields', () => {
    const preview = findRecipePreview([[card('a', { thumbnail_url: '  ', total_time: null, servings: 0, source_url: undefined })]], 'a');
    expect(preview).toMatchObject({ thumbnailUrl: null, totalTime: null, servings: null, sourceUrl: null });
  });

  it('ignores detail responses, untitled cards and missing ids', () => {
    const detail = { id: 'a', extracted: { title: 'Full recipe' } };
    expect(findRecipePreview([detail], 'a')).toBeNull();
    expect(findRecipePreview([[card('a', { title: '' })]], 'a')).toBeNull();
    expect(findRecipePreview([[card('a')]], undefined)).toBeNull();
    expect(findRecipePreview([undefined, null, 3, 'text'], 'a')).toBeNull();
  });
});
