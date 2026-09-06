import type { RecipeListItem } from '@/types/recipe';

type ResolveDiscoverResultsOptions = {
  hasTextSearch: boolean;
  hasActiveFilters: boolean;
  hasResolvedSearchResults: boolean;
  canUseLocalFallback: boolean;
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
  return filters.query.trim().length > 0
    || filters.sourceFilter !== 'all'
    || filters.timeFilter !== 'all'
    || filters.mealTypeFilter !== 'all'
    || filters.selectedTags.length > 0
    || filters.hasSelectedExtractor;
}

/** Meal and contributor fields are not guaranteed in every cached list item. */
export function canFilterDiscoverLocally(filters: {
  mealType?: string;
  extractorId?: string;
}): boolean {
  return !filters.mealType && !filters.extractorId;
}

/** Trust the API ownership flag; recipe user IDs are not Clerk subjects. */
export function hideOwnedDiscoverRecipes(
  recipes: RecipeListItem[],
  hideMyRecipes: boolean,
): RecipeListItem[] {
  if (!hideMyRecipes) return recipes;
  return recipes.filter((recipe) => recipe.is_owner !== true);
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
  canUseLocalFallback,
  searchResults,
  localFilteredRecipes,
  recipes,
}: ResolveDiscoverResultsOptions): RecipeListItem[] {
  if (hasTextSearch) return searchResults;
  if (!hasActiveFilters) return recipes;
  if (hasResolvedSearchResults) return searchResults;
  return canUseLocalFallback ? localFilteredRecipes : [];
}
