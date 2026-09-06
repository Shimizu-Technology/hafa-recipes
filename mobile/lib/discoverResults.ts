import type { RecipeListItem } from '@/types/recipe';

type ResolveDiscoverResultsOptions = {
  hasTextSearch: boolean;
  hasActiveFilters: boolean;
  hasResolvedSearchResults: boolean;
  searchResults: RecipeListItem[];
  localFilteredRecipes: RecipeListItem[];
  recipes: RecipeListItem[];
};

type DiscoverFilterRouting = {
  query: string;
  sourceFilter: string;
  timeFilter: string;
  mealTypeFilter: string;
  selectedTags: string[];
  hasSelectedExtractor: boolean;
  hideMyRecipes: boolean;
};

/** Local-only filters must not disable or reroute the paginated base feed. */
export function hasServerDiscoverFilters(filters: DiscoverFilterRouting): boolean {
  return filters.query.length > 0
    || filters.sourceFilter !== 'all'
    || filters.timeFilter !== 'all'
    || filters.mealTypeFilter !== 'all'
    || filters.selectedTags.length > 0
    || filters.hasSelectedExtractor;
}

/** Keep the populated base-feed cache available while a filtered query runs. */
export function baseDiscoverQueryOptions<TSort extends string>(
  canBrowseDiscover: boolean,
  hasActiveFilters: boolean,
  currentSort: TSort,
  lastPopulatedSort: TSort,
) {
  return {
    sourceType: undefined,
    enabled: canBrowseDiscover && !hasActiveFilters,
    mealType: undefined,
    sort: hasActiveFilters ? lastPopulatedSort : currentSort,
  } as const;
}

/** Keep useful local results while filters load, but honor a resolved empty result. */
export function resolveDiscoverResults({
  hasTextSearch,
  hasActiveFilters,
  hasResolvedSearchResults,
  searchResults,
  localFilteredRecipes,
  recipes,
}: ResolveDiscoverResultsOptions): RecipeListItem[] {
  if (hasTextSearch) return searchResults;
  if (!hasActiveFilters) return recipes;
  return hasResolvedSearchResults ? searchResults : localFilteredRecipes;
}
