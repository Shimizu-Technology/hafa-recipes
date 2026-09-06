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

/** Use one canonical query value for routing, caching, and API requests. */
export function normalizeDiscoverSearchQuery(query?: string): string | undefined {
  return query?.trim() || undefined;
}

export function hasDiscoverSearchRequestFilters(filters: {
  query?: string;
  sourceType?: string;
  timeFilter?: string;
  tags?: string[];
  extractorId?: string;
  mealType?: string;
}): boolean {
  return normalizeDiscoverSearchQuery(filters.query) !== undefined
    || Boolean(filters.sourceType)
    || Boolean(filters.timeFilter)
    || Boolean(filters.tags?.length)
    || Boolean(filters.extractorId)
    || Boolean(filters.mealType);
}

/** Local-only filters must not disable or reroute the paginated base feed. */
export function hasServerDiscoverFilters(filters: DiscoverFilterRouting): boolean {
  return normalizeDiscoverSearchQuery(filters.query) !== undefined
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
