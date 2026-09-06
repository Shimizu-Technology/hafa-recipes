import { describe, expect, it } from 'vitest';

import type { RecipeListItem } from '@/types/recipe';
import {
  baseDiscoverQueryOptions,
  canFilterDiscoverLocally,
  hasServerDiscoverFilters,
  hideOwnedDiscoverRecipes,
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

  it('treats a whitespace-only query as the unfiltered base feed', () => {
    expect(hasServerDiscoverFilters({
      query: '   ',
      sourceFilter: 'all',
      timeFilter: 'all',
      mealTypeFilter: 'all',
      selectedTags: [],
      hasSelectedExtractor: false,
      hideMyRecipes: false,
    })).toBe(false);
  });

  it('uses local fallback only for filters represented in cached list items', () => {
    expect(canFilterDiscoverLocally({})).toBe(true);
    expect(canFilterDiscoverLocally({ mealType: 'dinner' })).toBe(false);
    expect(canFilterDiscoverLocally({ extractorId: 'contributor' })).toBe(false);
  });

  it('never compares a public recipe user ID with a Clerk subject', () => {
    const legacyRecipe = { ...recipe, user_id: 'same-as-clerk', is_owner: undefined };
    const ownedRecipe = { ...recipe, id: 'owned', is_owner: true };

    expect(hideOwnedDiscoverRecipes([legacyRecipe, ownedRecipe], true)).toEqual([
      legacyRecipe,
    ]);
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
      canUseLocalFallback: true,
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
      canUseLocalFallback: true,
      searchResults: [],
      localFilteredRecipes: [recipe],
      recipes: [recipe],
    })).toEqual([]);
  });

  it('waits for the server instead of showing incomplete local matches', () => {
    expect(resolveDiscoverResults({
      hasTextSearch: false,
      hasActiveFilters: true,
      hasResolvedSearchResults: false,
      canUseLocalFallback: false,
      searchResults: [],
      localFilteredRecipes: [recipe],
      recipes: [recipe],
    })).toEqual([]);
  });
});
