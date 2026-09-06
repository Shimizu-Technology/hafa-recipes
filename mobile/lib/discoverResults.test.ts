import { describe, expect, it } from 'vitest';

import type { RecipeListItem } from '@/types/recipe';
import {
  baseDiscoverQueryOptions,
  hasServerDiscoverFilters,
  resolveDiscoverResults,
} from './discoverResults';

const recipe = { id: 'local' } as RecipeListItem;

describe('resolveDiscoverResults', () => {
  it('keeps the base query and pagination active for hide-mine alone', () => {
    expect(hasServerDiscoverFilters({
      query: '',
      sourceFilter: 'all',
      timeFilter: 'all',
      mealTypeFilter: 'all',
      selectedTags: [],
      hasSelectedExtractor: false,
      hideMyRecipes: true,
    })).toBe(false);
  });

  it('keeps filtered transitions anchored to the populated base-feed cache', () => {
    expect(baseDiscoverQueryOptions(true, true, 'popular', 'recent')).toEqual({
      sourceType: undefined,
      enabled: false,
      mealType: undefined,
      sort: 'recent',
    });
  });

  it('uses local matches while a non-text filter is loading', () => {
    expect(resolveDiscoverResults({
      hasTextSearch: false,
      hasActiveFilters: true,
      hasResolvedSearchResults: false,
      searchResults: [],
      localFilteredRecipes: [recipe],
      recipes: [recipe],
    })).toEqual([recipe]);
  });

  it('honors a resolved zero-result filter instead of reviving stale local cards', () => {
    expect(resolveDiscoverResults({
      hasTextSearch: false,
      hasActiveFilters: true,
      hasResolvedSearchResults: true,
      searchResults: [],
      localFilteredRecipes: [recipe],
      recipes: [recipe],
    })).toEqual([]);
  });
});
