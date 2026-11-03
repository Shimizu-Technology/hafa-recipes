import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 }, View: 'View', useWindowDimensions: () => ({ fontScale: 1 }) }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@/components/chrome/motion', () => ({ PressScale: 'Pressable' }));
vi.mock('@/components/RecipeThumbnail', () => ({ RecipeThumbnail: 'RecipeThumbnail' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => ({}) }));
vi.mock('@/lib/recipeSource', () => ({ getRecipeSourcePresentation: () => ({ label: 'Manual' }) }));

import { pickLatestRecipe } from './LibraryLatest';

const recipe = (id: string, thumbnail_url: string | null = null) => ({ id, thumbnail_url });

describe('pickLatestRecipe', () => {
  it('leads with the newest recipe that has a photo among the first six', () => {
    expect(pickLatestRecipe([recipe('a'), recipe('b', ' '), recipe('c', 'https://x/c.jpg'), recipe('d', 'https://x/d.jpg')])?.id).toBe('c');
  });

  it('falls back to the newest recipe when none of the first six has a photo', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => recipe(id)).concat(recipe('g', 'https://x/g.jpg'));
    expect(pickLatestRecipe(list)?.id).toBe('a');
  });

  it('stays out of a small or empty library', () => {
    expect(pickLatestRecipe(undefined)).toBeNull();
    expect(pickLatestRecipe([recipe('a', 'https://x/a.jpg'), recipe('b')])).toBeNull();
  });
});
