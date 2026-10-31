import { LibraryStatus } from '@/components/LibraryStatus';
import { RecipeBrowseHeader } from '@/components/RecipeBrowseHeader';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, RefreshControl, View as RNView, StyleSheet, TouchableOpacity, TouchableWithoutFeedback, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedListItem, useInitialListEntrance } from '@/components/Animated';
import BulkAddToCollectionModal from '@/components/BulkAddToCollectionModal';
import FilterBottomSheet, { FilterState, OwnershipFilter, SourceFilter, TimeFilter } from '@/components/FilterBottomSheet';
import { RECIPE_GRID_GAP, RecipeGridCardFrame, } from '@/components/RecipeGridCardFrame';
import { SignInBanner } from '@/components/SignInBanner';
import { SkeletonRecipeList } from '@/components/Skeleton';
import { Text, useColors, View } from '@/components/Themed';
import { fontFamily, fontSize, fontWeight, radius, spacing } from '@/constants/Colors';
import { filterRecipesLocally, SearchFilters, usePopularTags, useRecipeCount, useRecipes, useSavedRecipes, useSearchRecipes, } from '@/hooks/useRecipes';
import { getRecipeSourcePresentation } from '@/lib/recipeSource';
import { RecipeListItem } from '@/types/recipe';
import { haptics } from '@/utils/haptics';

import { useDebouncedSearchQuery } from '@/hooks/useDebouncedSearchQuery';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useViewPreference } from '@/hooks/useViewPreference';
import { recipeCardAccessibilityLabel } from '@/lib/recipeCardLabel';
import { useAuth } from '@clerk/expo';

const ITEMS_PER_PAGE = 20;

/** Render a library recipe as a compact list card. */
export function RecipeCard({
  recipe,
  onPress,
  colors,
  isSavedRecipe,
  selected,
}: {
  recipe: RecipeListItem;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  isSavedRecipe?: boolean;
  /** Set only in selection mode so VoiceOver announces the selection. */
  selected?: boolean;
}) {
  return <GridRecipeCard recipe={recipe} onPress={onPress} colors={colors} isSavedRecipe={isSavedRecipe} selected={selected} fullWidth />;
}

/** Render a library recipe with the same grid structure used in Discover. */
export function GridRecipeCard({
  recipe,
  onPress,
  colors,
  isSavedRecipe,
  selected, fullWidth,
}: {
  recipe: RecipeListItem;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  isSavedRecipe?: boolean;
  /** Set only in selection mode so VoiceOver announces the selection. */
  selected?: boolean;
  fullWidth?: boolean;
}) {
  const { icon: sourceIcon, label: sourceLabel } = getRecipeSourcePresentation(recipe.source_type);

  return (
    <RecipeGridCardFrame
      title={recipe.title}
      thumbnailUrl={recipe.thumbnail_url}
      onPress={onPress}
      colors={colors}
      accessibilityLabel={recipeCardAccessibilityLabel({
        title: recipe.title,
        reviewState: recipe.review_state,
        totalTime: recipe.total_time,
        sourceLabel,
        saved: isSavedRecipe,
      })}
      selected={selected}
      fullWidth={fullWidth}
      footer={<Text style={{ fontSize: 13, lineHeight: 18, color: colors.textSecondary }} numberOfLines={1}>{[sourceLabel, recipe.total_time].filter(Boolean).join(' · ')}</Text>}
    />
  );
}

export function HistoryScreen({ active = true }: { active?: boolean } = {}) {
  const router = useRouter();
  const colors = useColors();
  const largeText = useWindowDimensions().fontScale >= 1.3;
  const insets = useSafeAreaInsets();
  const { userId, isSignedIn } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  // Local filtering follows every keystroke; the server search uses the debounced value.
  const debouncedSearchQuery = useDebouncedSearchQuery(searchQuery);
  const isServerSearchCurrent = debouncedSearchQuery === searchQuery;
  const [needsCheckOnly, setNeedsCheckOnly] = useState(false);
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
  const [showFilterModal, setShowFilterModal] = useState(false);

  // Selection mode for bulk operations
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<Set<string>>(new Set());
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);

  // View preference (grid or list)
  const { viewMode, toggleViewMode, isGrid } = useViewPreference();

  // Filter state
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('all'); // all, own, or saved only



  // Pass source filter to server-side queries
  const sourceTypeParam = sourceFilter === 'all' ? undefined : sourceFilter;
  const timeFilterParam = timeFilter === 'all' ? undefined : timeFilter;

  // Check if any filters are active (excluding search)
  const activeFilterCount =
    (sourceFilter !== 'all' ? 1 : 0) +
    (timeFilter !== 'all' ? 1 : 0) +
    selectedTags.length +
    (ownershipFilter !== 'all' ? 1 : 0); // Count ownership filter if not "all"

  // Derived booleans for ownership filter
  const showSavedRecipes = ownershipFilter === 'all' || ownershipFilter === 'saved';
  const showOwnRecipes = ownershipFilter === 'all' || ownershipFilter === 'own';

  // Check if search or filters are active
  const hasActiveFilters = searchQuery.length > 0 || sourceFilter !== 'all' || timeFilter !== 'all' || selectedTags.length > 0;

  // Only fetch when authenticated
  const isAuthenticated = active && !!isSignedIn;

  // Own recipes with infinite scroll
  const {
    recipes,
    isLoading: isLoadingRecipes,
    isError: isRecipesError,
    refetch: refetchRecipes,
    fetchNextPage: fetchNextRecipes,
    hasNextPage: hasMoreRecipes,
    isFetchingNextPage: isFetchingNextRecipes,
  } = useRecipes(sourceTypeParam, isAuthenticated);

  // Search/filter results (when filters are active)
  const {
    recipes: searchResults,
    fetchNextPage: fetchNextSearchResults,
    hasNextPage: hasMoreSearchResults,
    isFetchingNextPage: isFetchingNextSearchResults,
    isFetching: isSearchFetching,
    isSuccess: isSearchSuccess,
    total: searchTotal,
    isError: isSearchError,
    refetch: refetchSearch,
  } = useSearchRecipes({
    query: debouncedSearchQuery,
    sourceType: sourceTypeParam,
    timeFilter: timeFilterParam,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
    ownership: ownershipFilter,
  }, isAuthenticated);

  const { data: countData } = useRecipeCount(undefined, isAuthenticated);
  const ownLibraryTotal = countData?.count ?? 0;

  // Popular tags for this user
  const { data: popularTags } = usePopularTags('user', isAuthenticated);

  // Saved recipes with infinite scroll
  const {
    recipes: savedRecipes,
    total: savedTotal,
    isLoading: isLoadingSaved,
    isError: isSavedRecipesError,
    refetch: refetchSaved,
    fetchNextPage: fetchNextSaved,
    hasNextPage: hasMoreSaved,
  } = useSavedRecipes(isAuthenticated);

  const isLoading = (showOwnRecipes && isLoadingRecipes) || (showSavedRecipes && isLoadingSaved);
  const hasPrimaryLoadError = hasActiveFilters
    ? isSearchError
    : (showOwnRecipes && isRecipesError) || (showSavedRecipes && isSavedRecipesError);

  const handleRefreshAll = useCallback(async () => {
    await Promise.all([
      hasActiveFilters ? refetchSearch() : Promise.resolve(),
      showOwnRecipes ? refetchRecipes() : Promise.resolve(),
      showSavedRecipes ? refetchSaved() : Promise.resolve(),
    ]);
  }, [hasActiveFilters, isAuthenticated, refetchRecipes, refetchSaved, refetchSearch, showOwnRecipes, showSavedRecipes]);

  // Handle filter apply
  const handleApplyFilters = useCallback((filters: FilterState) => {
    setOwnershipFilter(filters.ownershipFilter || 'all');
    setSourceFilter(filters.sourceFilter);
    setTimeFilter(filters.timeFilter);
    setSelectedTags(filters.selectedTags);
    setDisplayCount(ITEMS_PER_PAGE);
  }, []);

  // Build current filter state for optimistic filtering
  const currentFilters: SearchFilters = useMemo(() => ({
    query: searchQuery || undefined,
    sourceType: sourceTypeParam,
    timeFilter: timeFilterParam,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
  }), [searchQuery, sourceTypeParam, timeFilterParam, selectedTags]);

  // Combine own recipes with saved recipes based on ownership filter
  const combinedRecipes = useMemo(() => {
    if (hasActiveFilters && isServerSearchCurrent && isSearchSuccess) return searchResults;
    // Optimistic filtering: filter locally while server request is in flight
    // Use server search results if available, otherwise filter locally
    let ownRecipes: RecipeListItem[] | undefined;

    if (hasActiveFilters) {
      // If search results are back, use them; otherwise filter cached data locally
      // Server results for an older (pre-debounce) query would not match the input yet.
      ownRecipes = isServerSearchCurrent && searchResults?.length
        ? searchResults
        : filterRecipesLocally(recipes, currentFilters);
    } else {
      ownRecipes = recipes;
    }

    // Handle "saved only" mode - only show saved recipes
    if (ownershipFilter === 'saved') {
      if (!savedRecipes) return undefined;
      const filteredSaved = hasActiveFilters
        ? filterRecipesLocally(savedRecipes, currentFilters)
        : (sourceTypeParam ? savedRecipes.filter(r => r.source_type === sourceTypeParam) : savedRecipes);
      return filteredSaved;
    }

    if (!ownRecipes) return undefined;

    // Handle "own only" mode - only show own recipes
    if (ownershipFilter === 'own' || !savedRecipes) {
      return ownRecipes;
    }

    // "all" mode - combine own and saved
    const ownIds = new Set(ownRecipes.map(r => r.id));
    const uniqueSaved = savedRecipes.filter(r => !ownIds.has(r.id));

    // Apply filters to saved recipes too (optimistic filtering)
    const filteredSaved = hasActiveFilters
      ? filterRecipesLocally(uniqueSaved, currentFilters)
      : (sourceTypeParam ? uniqueSaved.filter(r => r.source_type === sourceTypeParam) : uniqueSaved);

    // Combine: own recipes first, then saved
    return [...ownRecipes, ...filteredSaved];
  }, [recipes, searchResults, isServerSearchCurrent, isSearchSuccess, savedRecipes, ownershipFilter, hasActiveFilters, sourceTypeParam, currentFilters]);

  // Calculate total count based on ownership filter
  // The library total ignores search filters; matches are the server's total for
  // the current filtered search, never the length of the pages loaded so far.
  const libraryCount = useMemo(() => {
    if (ownershipFilter === 'saved') {
      return savedTotal;
    } else if (ownershipFilter === 'own') {
      return ownLibraryTotal;
    } else {
      return ownLibraryTotal + savedTotal;
    }
  }, [ownershipFilter, ownLibraryTotal, savedTotal]);
  const matchingCount = hasActiveFilters && isServerSearchCurrent && isSearchSuccess ? searchTotal : undefined;

  // For display, slice to current page
  const needsCheckCount = combinedRecipes?.filter(r => r.review_state && r.review_state !== 'ready').length ?? 0;
  const displayRecipes = (needsCheckOnly ? combinedRecipes?.filter(r => r.review_state && r.review_state !== 'ready') : combinedRecipes)?.slice(0, displayCount);
  const canEnterRow = useInitialListEntrance(Boolean(displayRecipes?.length));

  const allShownSelected = Boolean(displayRecipes?.length) && displayRecipes!.every(recipe => selectedRecipeIds.has(recipe.id));

  // Determine if there's more to load - either from server or locally
  const hasMoreLocal = combinedRecipes && displayCount < combinedRecipes.length;
  // hasMoreServer depends on ownership filter
  const hasMoreServer = useMemo(() => {
    if (hasActiveFilters) return isServerSearchCurrent && hasMoreSearchResults;
    if (ownershipFilter === 'saved') {
      return hasMoreSaved; // Only check saved when in "Saved Only" mode
    } else if (ownershipFilter === 'own') {
      return hasActiveFilters ? hasMoreSearchResults : hasMoreRecipes; // Only check own recipes
    } else {
      // "all" mode - check both
      return (hasActiveFilters ? hasMoreSearchResults : hasMoreRecipes) || hasMoreSaved;
    }
  }, [ownershipFilter, hasMoreSaved, hasMoreRecipes, hasMoreSearchResults, hasActiveFilters, isServerSearchCurrent]);
  const hasMore = hasMoreLocal || hasMoreServer;

  const refreshLibrary = useCallback(async () => {
    setDisplayCount(ITEMS_PER_PAGE);
    await handleRefreshAll();
  }, [handleRefreshAll]);
  const { isPullRefreshing, onPullRefresh } = usePullToRefresh(refreshLibrary);

  const handleLoadMore = () => {
    if (hasMoreLocal) {
      // First, show more of what we already have
      setDisplayCount(prev => prev + ITEMS_PER_PAGE);
    } else if (hasMoreServer) {
      // Then, fetch more from the server
      if (hasActiveFilters) {
        // Don't page the previous query while a new one is still debouncing.
        if (isServerSearchCurrent) fetchNextSearchResults();
      } else {
        if (showOwnRecipes && hasMoreRecipes) fetchNextRecipes();
        if (showSavedRecipes && hasMoreSaved) fetchNextSaved();
      }
      // Increase display count after fetch
      setDisplayCount(prev => prev + ITEMS_PER_PAGE);
    }
  };

  // Selection mode helpers
  const toggleRecipeSelection = useCallback((recipeId: string) => {
    setSelectedRecipeIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(recipeId)) {
        newSet.delete(recipeId);
      } else {
        newSet.add(recipeId);
      }
      return newSet;
    });
    haptics.light();
  }, []);

  const selectAllRecipes = useCallback(() => {
    if (displayRecipes) {
      setSelectedRecipeIds(previous => new Set([...previous, ...displayRecipes.map(r => r.id)]));
      haptics.medium();
    }
  }, [displayRecipes]);

  const clearSelection = useCallback(() => {
    setSelectedRecipeIds(new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedRecipeIds(new Set());
  }, []);

  const enterSelectionMode = useCallback((initialRecipeId?: string) => {
    setIsSelectionMode(true);
    if (initialRecipeId) {
      setSelectedRecipeIds(new Set([initialRecipeId]));
    }
    haptics.medium();
  }, []);

  const handleBulkAddComplete = useCallback(() => {
    setShowBulkAddModal(false);
    exitSelectionMode();
    haptics.success();
  }, [exitSelectionMode]);

  const renderItem = ({ item, index }: { item: RecipeListItem; index: number }) => {
    const CardComponent = isGrid ? GridRecipeCard : RecipeCard;
    // Show heart badge for saved recipes:
    // - In "saved" mode: ALL recipes are saved, show heart on all
    // - In "all" mode: Show heart only for recipes from other users (saved ones)
    // - In "own" mode: Never show heart (all are user's own)
    const showSavedBadge = ownershipFilter === 'saved' ||
      (ownershipFilter === 'all' && item.user_id !== userId);

    const isSelected = selectedRecipeIds.has(item.id);

    const handlePress = () => {
      if (isSelectionMode) {
        toggleRecipeSelection(item.id);
      } else {
        haptics.light();
        router.push(`/recipe/${item.id}`);
      }
    };

    const handleLongPress = () => {
      if (!isSelectionMode) {
        enterSelectionMode(item.id);
      }
    };

    // Grid view: overlay checkbox on card
    if (isGrid) {
      return (
        <AnimatedListItem index={index} delay={40} enter={canEnterRow()}>
          <TouchableOpacity
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={400}
            activeOpacity={0.9}
            style={styles.gridCardWrapper}
            // VoiceOver focuses the labelled card inside, not this wrapper.
            accessible={false}
          >
            <CardComponent
              recipe={item}
              colors={colors}
              onPress={handlePress}
              isSavedRecipe={showSavedBadge}
              selected={isSelectionMode ? isSelected : undefined}
            />
            {isSelectionMode && (
              <RNView
                style={[
                  styles.gridSelectionCheckbox,
                  isSelected && { backgroundColor: colors.tint, borderColor: colors.tint },
                  !isSelected && { backgroundColor: 'rgba(0,0,0,0.5)', borderColor: 'rgba(255,255,255,0.5)' },
                ]}
              >
                {isSelected && (
                  <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                )}
              </RNView>
            )}
          </TouchableOpacity>
        </AnimatedListItem>
      );
    }

    // List view: checkbox beside card
    return (
      <AnimatedListItem index={index} delay={40} enter={canEnterRow()}>
        <RNView style={styles.selectableCardContainer}>
          {isSelectionMode && (
            <TouchableOpacity
              style={[
                styles.selectionCheckbox,
                isSelected && { backgroundColor: colors.tint, borderColor: colors.tint },
                !isSelected && { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
              ]}
              onPress={() => toggleRecipeSelection(item.id)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={`Select ${item.title}`}
            >
              {isSelected && (
                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          )}
          <RNView style={[styles.selectableCardWrapper, isSelectionMode && styles.selectableCardShifted]}>
            <TouchableOpacity
              onPress={handlePress}
              onLongPress={handleLongPress}
              delayLongPress={400}
              activeOpacity={0.9}
              // VoiceOver focuses the labelled card inside, not this wrapper.
              accessible={false}
            >
              <CardComponent
                recipe={item}
                colors={colors}
                onPress={handlePress}
                isSavedRecipe={showSavedBadge}
                selected={isSelectionMode ? isSelected : undefined}
              />
            </TouchableOpacity>
          </RNView>
        </RNView>
      </AnimatedListItem>
    );
  };

  // Memoize header to prevent re-render on search change
  const ListHeaderTitle = useCallback(() => {
    // Selection mode header
    if (isSelectionMode) {
      return (
        <RNView style={styles.titleRow}>
          <RNView style={styles.titleLeft}>
            <TouchableOpacity onPress={exitSelectionMode} style={styles.cancelButton}>
              <Text style={[styles.cancelButtonText, { color: colors.actionText }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.selectionCount, { color: colors.text }]}>
              {selectedRecipeIds.size} selected
            </Text>
          </RNView>

          <RNView style={styles.headerActions}>
            <TouchableOpacity
              style={[styles.selectAllButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
              onPress={allShownSelected ? clearSelection : selectAllRecipes}
              activeOpacity={0.7}
            >
              <Text style={[styles.selectAllText, { color: colors.actionText }]}>
                {allShownSelected ? 'Deselect all' : 'Select shown'}
              </Text>
            </TouchableOpacity>
          </RNView>
        </RNView>
      );
    }

    return <LibraryStatus active={active} needsCheck={needsCheckCount} checking={needsCheckOnly} onNeedsCheck={() => { setNeedsCheckOnly(value => !value); setDisplayCount(ITEMS_PER_PAGE); }} onFilter={() => setShowFilterModal(true)} />;
  }, [active, colors, needsCheckCount, needsCheckOnly, isSelectionMode, selectedRecipeIds.size, allShownSelected, exitSelectionMode, selectAllRecipes, clearSelection]);

  const filteredEmpty = needsCheckOnly || hasActiveFilters || ownershipFilter !== 'all';
  const clearSearchAndFilters = () => {
    setNeedsCheckOnly(false); setSearchQuery(''); setSourceFilter('all'); setTimeFilter('all');
    setSelectedTags([]); setOwnershipFilter('all'); setDisplayCount(ITEMS_PER_PAGE);
  };

  const ListEmpty = () => (
    <RNView style={styles.emptyContainer}>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {hasPrimaryLoadError ? 'Couldn’t load your recipes' : filteredEmpty ? 'No recipes match' : 'No recipes yet'}
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        {hasPrimaryLoadError
          ? 'Your recipes are still safe. Check your connection and try again.'
          : filteredEmpty ? 'Try another search or clear your filters.' : 'Start building your recipe collection!'}
      </Text>
      <TouchableOpacity
        style={[styles.emptyButton, { backgroundColor: colors.tint }]}
        onPress={hasPrimaryLoadError ? handleRefreshAll : filteredEmpty ? clearSearchAndFilters : () => router.push('/')}
        activeOpacity={0.8}
      >
        <Ionicons name={hasPrimaryLoadError ? 'refresh-outline' : filteredEmpty ? 'close-circle-outline' : 'add-circle-outline'} size={20} color="#FFFFFF" />
        <Text style={[styles.emptyButtonText, { color: colors.onTint }]}>{hasPrimaryLoadError ? 'Try Again' : filteredEmpty ? 'Clear search and filters' : 'Add Your First Recipe'}</Text>
      </TouchableOpacity>
    </RNView>
  );

  const isFetchingMore = isFetchingNextRecipes || isFetchingNextSearchResults;

  const ListFooter = () => {
    if (!hasMore) return null;

    return (
      <RNView style={styles.footerContainer}>
        <TouchableOpacity
          style={[styles.loadMoreButton, { borderColor: colors.border }]}
          onPress={handleLoadMore}
          activeOpacity={0.7}
          disabled={isFetchingMore}
        >
          {isFetchingMore ? (
            <ActivityIndicator size="small" color={colors.actionText} />
          ) : (
            <>
              <Text style={[styles.loadMoreText, { color: colors.text }]}>
                Load More
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
            </>
          )}
        </TouchableOpacity>
      </RNView>
    );
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
    <View style={styles.container}>
      {/* Filter Bottom Sheet */}
      <FilterBottomSheet
        visible={active && showFilterModal}
        onClose={() => setShowFilterModal(false)}
        onApply={handleApplyFilters}
        initialFilters={{ sourceFilter, timeFilter, selectedTags, ownershipFilter }}
        popularTags={popularTags}
        showOwnershipFilter
      />

      {/* Bulk Add to Collection Modal */}
      <BulkAddToCollectionModal
        visible={active && showBulkAddModal}
        onClose={() => setShowBulkAddModal(false)}
        recipeIds={Array.from(selectedRecipeIds)}
        onComplete={handleBulkAddComplete}
      />

      <RecipeBrowseHeader library actions={[
        { title: isGrid ? 'Switch to list view' : 'Switch to grid view', onPress: toggleViewMode },
        { title: 'Select recipes', onPress: enterSelectionMode },
      ]} />
      {isLoading && !displayRecipes?.length ? (
        <SkeletonRecipeList count={isGrid ? 6 : 4} layout={isGrid ? 'grid' : 'list'} />
      ) : (
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          key={isGrid && !largeText ? 'grid' : 'list'} // Force re-render when changing layout
          data={displayRecipes}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={isGrid && !largeText ? 2 : 1}
          columnWrapperStyle={isGrid && !largeText ? styles.gridRow : undefined}
          ListHeaderComponent={<>
            <ListHeaderTitle />
            {activeFilterCount > 0 && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear library filters" onPress={clearSearchAndFilters} style={{ minHeight: 44, justifyContent: 'center', marginBottom: 12 }}>
              <Text style={{ color: colors.textSecondary }}>{[sourceFilter !== 'all' && sourceFilter, timeFilter !== 'all' && (timeFilter === 'quick' ? 'Under 30 min' : timeFilter === 'medium' ? '30–60 min' : '60+ min'), ...selectedTags, ownershipFilter !== 'all' && ownershipFilter].filter(Boolean).join(' · ')} ×</Text>
            </TouchableOpacity>}
          </>}
          ListEmptyComponent={ListEmpty}
          ListFooterComponent={ListFooter}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingBottom: insets.bottom + spacing.xl + 80,
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
          refreshControl={
            <RefreshControl
              refreshing={isPullRefreshing}
              onRefresh={onPullRefresh}
              tintColor={colors.tint}
            />
          }
        />
      )}

      {/* Sign In Banner for guests */}
      {!isSignedIn && <SignInBanner message="Sign in to save your recipes" />}

      {/* Selection Action Bar */}
      {isSelectionMode && (
        <RNView style={[styles.selectionActionBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <RNView style={styles.selectionActionContent}>
            <Text style={[styles.selectionActionText, { color: colors.textSecondary }]}>
              {selectedRecipeIds.size} recipe{selectedRecipeIds.size !== 1 ? 's' : ''} selected
            </Text>
            <TouchableOpacity
              style={[
                styles.addToCollectionButton,
                { backgroundColor: colors.tint },
                selectedRecipeIds.size === 0 && { opacity: 0.5 },
              ]}
              onPress={() => setShowBulkAddModal(true)}
              disabled={selectedRecipeIds.size === 0}
              activeOpacity={0.8}
            >
              <Ionicons name="folder-outline" size={18} color="#FFFFFF" />
              <Text style={[styles.addToCollectionButtonText, { color: colors.onTint }]}>Add to Collection</Text>
            </TouchableOpacity>
          </RNView>
        </RNView>
      )}
    </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: spacing.xxl,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  titleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Grid view styles
  gridRow: {
    justifyContent: 'space-between',
    gap: RECIPE_GRID_GAP,
  },
  // Header action buttons
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.semibold, fontWeight: '600',
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold, fontWeight: '600',
  },
  footerContainer: {
    paddingVertical: spacing.md,
  },
  loadMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  loadMoreText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  // Grid card wrapper for selection overlay
  gridCardWrapper: {
    position: 'relative',
  },
  gridSelectionCheckbox: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  // Selection mode styles
  cancelButton: {
    marginRight: spacing.sm,
  },
  cancelButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  selectionCount: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  selectAllButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  selectAllText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  selectableCardContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  selectionCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
    marginTop: spacing.sm,
  },
  selectableCardWrapper: {
    flex: 1,
  },
  selectableCardShifted: {
    // Card shrinks slightly when checkbox is visible
  },
  selectionActionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xl,
  },
  selectionActionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectionActionText: {
    fontSize: fontSize.sm,
  },
  addToCollectionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    gap: spacing.xs,
  },
  addToCollectionButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});

/** Keep existing deep links selecting their original scope. */
export default function LegacyRecipeRoute() {
  return <Redirect href={{ pathname: '/(tabs)/recipes', params: { scope: 'library' } }} />;
}
