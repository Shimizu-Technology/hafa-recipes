import { RecipeBrowseHeader } from '@/components/RecipeBrowseHeader';
import { useRecipeOwnerGeneration } from '@/hooks/useOfflineLease';
import { guestRecipeIntent } from '@/lib/guestRecipeIntent';
import { discoverSections } from '@/lib/recipeBrowse';
import { useAuth } from '@clerk/expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Keyboard, Modal, Pressable, RefreshControl, View as RNView, StyleSheet, TouchableOpacity, TouchableWithoutFeedback, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AllContributorsModal from '@/components/AllContributorsModal';
import FilterBottomSheet, { FilterState, MealTypeFilter, SourceFilter, TimeFilter } from '@/components/FilterBottomSheet';
import { SignInBanner } from '@/components/SignInBanner';
import { Text, useColors, View } from '@/components/Themed';
import { fontFamily, fontSize, fontWeight, radius, shadows, spacing } from '@/constants/Colors';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { DiscoverSort, filterRecipesLocally, SearchFilters, useCurrentUserIdentity, useDiscoverRecipes, useIsRecipeSaved, usePopularTags, useSaveRecipe, useSearchPublicRecipes, useUnsaveRecipe, } from '@/hooks/useRecipes';
import { api } from '@/lib/api';
import { baseDiscoverQueryOptions, canFilterDiscoverLocally, hasServerDiscoverFilters, hideOwnedDiscoverRecipes, resolveDiscoverResults, } from '@/lib/discoverResults';
import { getRecipeSourcePresentation } from '@/lib/recipeSource';
import { RecipeListItem } from '@/types/recipe';
import { haptics } from '@/utils/haptics';

import { AnimatedListItem, useInitialListEntrance } from '@/components/Animated';
import { SkeletonRecipeList } from '@/components/Skeleton';

import { RECIPE_GRID_GAP, RecipeGridCardFrame, } from '@/components/RecipeGridCardFrame';
import { recipeCardAccessibilityLabel } from '@/lib/recipeCardLabel';

const ITEMS_PER_PAGE = 20;

function getContributorId(value: { contributor_id?: string | null; user_id?: string | null }): string | null {
  return value.contributor_id ?? value.user_id ?? null;
}

// Save/Bookmark button reflects confirmed server state.
export function SaveButton({
  recipeId,
  initialIsSaved,
  active = true,
  colors,
  isOwner,
}: {
  recipeId: string;
  initialIsSaved?: boolean | null;
  active?: boolean;
  colors: ReturnType<typeof useColors>;
  isOwner: boolean;
}) {
  // New APIs include saved state in the feed response. Keep the one-card query
  // only as a rolling-deploy fallback for an older API response.
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const shouldFetchSavedStatus = active && !!isSignedIn && !isOwner && initialIsSaved == null;
  const { data: savedStatus, isLoading } = useIsRecipeSaved(
    recipeId,
    shouldFetchSavedStatus,
  );
  const saveMutation = useSaveRecipe();
  const unsaveMutation = useUnsaveRecipe();

  // Don't show save button for own recipes
  if (isOwner) return null;

  const isSaved = !!isSignedIn && (initialIsSaved ?? savedStatus?.is_saved ?? false);
  const isPending = saveMutation.isPending || unsaveMutation.isPending;

  const handlePress = () => {
    if (isPending) return;
    if (!isSignedIn) {
      guestRecipeIntent.start(recipeId, 'save');
      router.push('/(auth)/sign-in');
      return;
    }
    if (isSaved) {
      unsaveMutation.mutate(recipeId);
    } else {
      saveMutation.mutate(recipeId);
    }
  };

  if (shouldFetchSavedStatus && isLoading) {
    return (
      <RNView style={styles.saveTarget}><RNView style={styles.saveButton}>
        <ActivityIndicator size="small" color="#FFFFFF" />
      </RNView></RNView>
    );
  }

  return (
    <RNView style={styles.saveTarget}>
    <TouchableOpacity
      style={styles.saveButton}
      onPress={event => { event?.stopPropagation(); handlePress(); }}
      disabled={isPending}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={isSaved ? 'Remove recipe from saved' : 'Save recipe'}
      accessibilityState={{ selected: isSaved, disabled: isPending }}
    >
      <RNView>
        <Ionicons
          name={isSaved ? "bookmark" : "bookmark-outline"}
          size={17}
          color="#FFFFFF"
        />
      </RNView>
    </TouchableOpacity>
    </RNView>
  );
}

function GridRecipeCard({
  recipe,
  onPress,
  colors,
  currentUserId,
  imagePriority = 'normal',
  active = true,
}: {
  recipe: RecipeListItem;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  currentUserId?: string | null;
  imagePriority?: 'normal' | 'high';
  active?: boolean;
}) {
  const isOwner = recipe.is_owner ?? recipe.user_id === currentUserId;
  const showSaveButton = !isOwner;

  return (
    <RecipeGridCardFrame
      title={recipe.title}
      thumbnailUrl={recipe.thumbnail_url}
      onPress={onPress}
      colors={colors}
      accessibilityLabel={recipeCardAccessibilityLabel({
        title: recipe.title,
        totalTime: recipe.total_time,
        sourceLabel: recipe.extractor_display_name ? null : getRecipeSourcePresentation(recipe.source_type).label,
        author: recipe.extractor_display_name,
      })}
      imagePriority={imagePriority}
      imageAdornment={showSaveButton ? <RNView style={styles.gridSaveButtonContainer}><SaveButton active={active} recipeId={recipe.id} initialIsSaved={recipe.is_saved} colors={colors} isOwner={isOwner} /></RNView> : null}
      footer={<Text style={{ fontSize: 13, lineHeight: 18, color: colors.textSecondary }} numberOfLines={1}>{[recipe.extractor_display_name || getRecipeSourcePresentation(recipe.source_type).label, recipe.total_time].filter(Boolean).join(' · ')}</Text>}
    />
  );
}

export function DiscoverScreen({ active = true }: { active?: boolean } = {}) {
  const router = useRouter();
  const colors = useColors();
  const largeText = useWindowDimensions().fontScale >= 1.3;
  const insets = useSafeAreaInsets();
  const { userId, isSignedIn } = useAuth();
  const identity = useCurrentUserIdentity(active && Boolean(isSignedIn));
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showAllContributors, setShowAllContributors] = useState(false);
  const [isRandomLoading, setIsRandomLoading] = useState(false);
  const [showSurpriseModal, setShowSurpriseModal] = useState(false);

  // User filter state (for "recipes by user" feature)
  const [selectedExtractor, setSelectedExtractor] = useState<{ id: string; name: string } | null>(null);

  // Filter state
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [hideMyRecipes, setHideMyRecipes] = useState(false);
  const [sortOrder, setSortOrder] = useState<DiscoverSort>('recent');
  const [mealTypeFilter, setMealTypeFilter] = useState<MealTypeFilter>('all');
  const lastPopulatedBaseSort = useRef<DiscoverSort>(sortOrder);

  // Pass source filter to server-side queries
  const sourceTypeParam = sourceFilter === 'all' ? undefined : sourceFilter;
  const timeFilterParam = timeFilter === 'all' ? undefined : timeFilter;
  const mealTypeParam = mealTypeFilter === 'all' ? undefined : mealTypeFilter;

  // Check if any filters are active (excluding search)
  const activeFilterCount =
    (sourceFilter !== 'all' ? 1 : 0) +
    (timeFilter !== 'all' ? 1 : 0) +
    (mealTypeFilter !== 'all' ? 1 : 0) +
    selectedTags.length +
    (hideMyRecipes ? 1 : 0) +
    (selectedExtractor ? 1 : 0);

  // Hide-mine is local-only. Keep it out of server-query routing so the base
  // feed stays enabled and can continue paginating while the local view hides
  // the current user's cards.
  const hasServerFilters = hasServerDiscoverFilters({
    query: '',
    sourceFilter,
    timeFilter,
    mealTypeFilter,
    selectedTags,
    hasSelectedExtractor: !!selectedExtractor,
    hideMyRecipes,
  });
  const hasVisibleFilters = hasServerFilters || hideMyRecipes;

  // Discover is a public community library. Guests can browse; sign-in is only
  // required for saving recipes and personalized actions.
  const canBrowseDiscover = active;
  const baseDiscoverQuery = baseDiscoverQueryOptions(
    canBrowseDiscover,
    hasServerFilters,
    sortOrder,
    lastPopulatedBaseSort.current,
  );
  useEffect(() => {
    if (!hasServerFilters) lastPopulatedBaseSort.current = sortOrder;
  }, [hasServerFilters, sortOrder]);

  // Discover recipes with infinite scroll
  const {
    recipes,
    total: recipesTotal,
    isLoading,
    refetch,
    fetchNextPage,
    hasNextPage: hasMoreRecipes,
    isFetchingNextPage,
    isError: isDiscoverError,
  } = useDiscoverRecipes(
    baseDiscoverQuery.sourceType,
    baseDiscoverQuery.enabled,
    baseDiscoverQuery.sort,
    baseDiscoverQuery.mealType,
  );

  // Search/filter results (when filters are active)
  const {
    recipes: searchResults,
    total: searchTotal,
    fetchNextPage: fetchNextSearchResults,
    hasNextPage: hasMoreSearchResults,
    isFetchingNextPage: isFetchingNextSearchResults,
    isFetching: isDiscoverSearchFetching,
    isSuccess: hasResolvedSearchResults,
    isError: isSearchError,
    refetch: refetchSearch,
  } = useSearchPublicRecipes({
    query: '',
    sourceType: sourceTypeParam,
    timeFilter: timeFilterParam,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
    extractorId: selectedExtractor?.id,
    extractorName: selectedExtractor?.name,
    mealType: mealTypeParam,
  }, canBrowseDiscover);

  const { data: popularTags } = usePopularTags('public', canBrowseDiscover);

  // Handle filter apply
  const handleApplyFilters = useCallback((filters: FilterState) => {
    setSourceFilter(filters.sourceFilter);
    setTimeFilter(filters.timeFilter);
    setSelectedTags(filters.selectedTags);
    if (filters.sortOrder) setSortOrder(filters.sortOrder);
    if (filters.hideMyRecipes !== undefined) setHideMyRecipes(filters.hideMyRecipes);
    if (filters.mealTypeFilter) setMealTypeFilter(filters.mealTypeFilter);
    setDisplayCount(ITEMS_PER_PAGE);
  }, []);

  // Build current filter state for optimistic filtering
  const currentFilters: SearchFilters = useMemo(() => ({
    sourceType: sourceTypeParam,
    timeFilter: timeFilterParam,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
    extractorId: selectedExtractor?.id,
    extractorName: selectedExtractor?.name,
    mealType: mealTypeParam,
  }), [sourceTypeParam, timeFilterParam, selectedTags, selectedExtractor, mealTypeParam]);

  // Determine what to display:
  // - For filters represented in cached cards: show accurate local matches
  // - For meal/contributor filters: wait for the authoritative server result
  const canUseLocalFallback = canFilterDiscoverLocally({
    mealType: mealTypeParam,
    extractorId: selectedExtractor?.id,
  });

  const filteredRecipes = useMemo(() => {
    const result = resolveDiscoverResults({
      hasTextSearch: false,
      hasActiveFilters: hasServerFilters,
      hasResolvedSearchResults,
      canUseLocalFallback,
      searchResults,
      localFilteredRecipes: filterRecipesLocally(recipes, currentFilters),
      recipes,
    });

    return hideOwnedDiscoverRecipes(result, hideMyRecipes);
  }, [hasServerFilters, recipes, searchResults, hasResolvedSearchResults, canUseLocalFallback, currentFilters, hideMyRecipes]);

  const displayRecipes = useMemo(
    () => filteredRecipes?.slice(0, displayCount),
    [filteredRecipes, displayCount],
  );
  const canEnterRow = useInitialListEntrance(Boolean(displayRecipes?.length));
  const hasPrimaryLoadError = hasServerFilters ? isSearchError : isDiscoverError;



  // Determine if there's more to load - either from server or locally
  const hasMoreLocal = filteredRecipes && displayCount < filteredRecipes.length;
  const hasMoreServer = hasServerFilters ? hasMoreSearchResults : hasMoreRecipes;
  const hasMore = hasMoreLocal || hasMoreServer;
  const isFetchingMore = isFetchingNextPage || isFetchingNextSearchResults;

  const refreshDiscover = useCallback(async () => {
    setDisplayCount(ITEMS_PER_PAGE);
    if (hasServerFilters) {
      await refetchSearch();
    } else {
      await refetch();
    }
  }, [hasServerFilters, refetch, refetchSearch]);
  const { isPullRefreshing, onPullRefresh } = usePullToRefresh(refreshDiscover);

  const handleLoadMore = () => {
    if (hasMoreLocal) {
      // First, show more of what we already have
      setDisplayCount(prev => prev + ITEMS_PER_PAGE);
    } else if (hasMoreServer) {
      // Then, fetch more from the server
      if (hasServerFilters && hasMoreSearchResults) {
        fetchNextSearchResults();
      } else if (hasMoreRecipes) {
        fetchNextPage();
      }
      // Increase display count after fetch
      setDisplayCount(prev => prev + ITEMS_PER_PAGE);
    }
  };

  // Handle random recipe selection
  const handleRandomRecipe = useCallback(async (selectedMealType?: string) => {
    setShowSurpriseModal(false);
    setIsRandomLoading(true);
    haptics.medium();
    try {
      // Use selected meal type if provided, otherwise use current filter
      const mealType = selectedMealType || mealTypeParam;
      const randomRecipe = await api.getRandomRecipe(mealType, sourceTypeParam);
      router.push(`/recipe/${randomRecipe.id}`);
    } catch (error: any) {
      Alert.alert(
        'No Recipes Found',
        error?.response?.data?.detail || 'Try removing some filters and try again.'
      );
    } finally {
      setIsRandomLoading(false);
    }
  }, [mealTypeParam, sourceTypeParam, router]);

  const renderItem = ({ item, index }: { item: RecipeListItem; index: number }) => {
    return (
        <AnimatedListItem index={index} delay={40} enter={canEnterRow()}>
          <GridRecipeCard
            recipe={item} active={active}
            colors={colors}
            onPress={() => {
              haptics.light();
              router.push(`/recipe/${item.id}`);
            }}
            currentUserId={identity.data?.id}
            imagePriority={index < 4 ? 'high' : 'normal'}
          />
        </AnimatedListItem>
    );
  };

  const ListEmpty = () => (
    <RNView style={styles.emptyContainer}>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        No recipes found
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        {hasVisibleFilters
          ? 'Try adjusting your filters'
          : 'Be the first to share a recipe with the community!'}
      </Text>
    </RNView>
  );

  const ListError = () => (
    <RNView style={styles.emptyContainer}>
      <RNView style={[styles.emptyIconContainer, { backgroundColor: colors.error + '12' }]}>
        <Ionicons name="cloud-offline-outline" size={46} color={colors.error} />
      </RNView>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        Couldn’t load recipes
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        The community library is unavailable right now. Check the API connection and try again.
      </Text>
      <TouchableOpacity
        style={[styles.retryButton, { backgroundColor: colors.tint }]}
        onPress={refreshDiscover}
        activeOpacity={0.8}
      >
        <Ionicons name="refresh" size={17} color={colors.onTint} />
        <Text style={styles.retryButtonText}>Try Again</Text>
      </TouchableOpacity>
    </RNView>
  );

  const ListFooter = () => {
    if (!hasMore) return null;

    const remaining = hasMoreLocal && filteredRecipes
      ? filteredRecipes.length - displayCount
      : (hasMoreServer ? '...' : 0);

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
        initialFilters={{ sourceFilter, timeFilter, selectedTags, sortOrder, hideMyRecipes, mealTypeFilter }}
        popularTags={popularTags}
        showSortOption
        showHideMyRecipes={!!isSignedIn}
        showMealTypeFilter
      />

      {/* Surprise Me Modal */}
      <Modal
        visible={active && showSurpriseModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSurpriseModal(false)}
      >
        <Pressable
          style={styles.surpriseModalOverlay}
          onPress={() => setShowSurpriseModal(false)}
          accessible={false}
        >
          <Pressable
            style={[styles.surpriseModalContent, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
            accessible={false}
          >
            <RNView style={styles.surpriseModalHeader}>
              <Ionicons name="shuffle" size={24} color={colors.warning} />
              <Text style={[styles.surpriseModalTitle, { color: colors.text }]}>
                Surprise Me With...
              </Text>
            </RNView>

            <RNView style={styles.surpriseModalOptions}>
              <TouchableOpacity
                style={[styles.surpriseOption, { backgroundColor: colors.warning + '15' }]}
                onPress={() => handleRandomRecipe(undefined)}
              >
                <Ionicons name="shuffle" size={24} color={colors.warning} style={styles.surpriseOptionIcon} />
                <Text style={[styles.surpriseOptionText, { color: colors.text }]}>
                  Anything! (Fully Random)
                </Text>
              </TouchableOpacity>

              <RNView style={[styles.surpriseDivider, { backgroundColor: colors.border }]} />

              <TouchableOpacity
                style={[styles.surpriseOption, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleRandomRecipe('breakfast')}
              >
                <Ionicons name="sunny-outline" size={24} color={colors.actionText} style={styles.surpriseOptionIcon} />
                <Text style={[styles.surpriseOptionText, { color: colors.text }]}>
                  Random Breakfast
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.surpriseOption, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleRandomRecipe('lunch')}
              >
                <Ionicons name="cafe-outline" size={24} color={colors.actionText} style={styles.surpriseOptionIcon} />
                <Text style={[styles.surpriseOptionText, { color: colors.text }]}>
                  Random Lunch
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.surpriseOption, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleRandomRecipe('dinner')}
              >
                <Ionicons name="restaurant-outline" size={24} color={colors.actionText} style={styles.surpriseOptionIcon} />
                <Text style={[styles.surpriseOptionText, { color: colors.text }]}>
                  Random Dinner
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.surpriseOption, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleRandomRecipe('snack')}
              >
                <Ionicons name="nutrition-outline" size={24} color={colors.actionText} style={styles.surpriseOptionIcon} />
                <Text style={[styles.surpriseOptionText, { color: colors.text }]}>
                  Random Snack
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.surpriseOption, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleRandomRecipe('dessert')}
              >
                <Ionicons name="ice-cream-outline" size={24} color={colors.actionText} style={styles.surpriseOptionIcon} />
                <Text style={[styles.surpriseOptionText, { color: colors.text }]}>
                  Random Dessert
                </Text>
              </TouchableOpacity>
            </RNView>

            <TouchableOpacity
              style={[styles.surpriseCancelButton, { borderColor: colors.border }]}
              onPress={() => setShowSurpriseModal(false)}
            >
              <Text style={[styles.surpriseCancelText, { color: colors.textMuted }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <RecipeBrowseHeader actions={[
        { title: 'Filter recipes', onPress: () => setShowFilterModal(true) },
        { title: 'Top contributors', onPress: () => setShowAllContributors(true) },
        { title: 'Surprise me', onPress: () => setShowSurpriseModal(true) },
        { title: 'Search recipes', onPress: () => router.navigate('/(tabs)/search') },
      ]} />
      {(isLoading || (hasServerFilters && isDiscoverSearchFetching)) && !displayRecipes?.length ? (
        <SkeletonRecipeList count={6} layout="grid" />
      ) : (
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          key={!largeText ? 'grid' : 'list'} // Force re-render when changing layout
          data={displayRecipes}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={!largeText ? 2 : 1}
          columnWrapperStyle={!largeText ? styles.gridRow : undefined}
          ListHeaderComponent={<>
            {hasVisibleFilters && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear Discover filters" onPress={() => { setSourceFilter('all'); setTimeFilter('all'); setSelectedTags([]); setSelectedExtractor(null); setMealTypeFilter('all'); setHideMyRecipes(false); setSortOrder('recent'); }} style={{ minHeight: 44, justifyContent: 'center', marginBottom: 12 }}>
              <Text style={{ color: colors.textSecondary }}>{[selectedExtractor?.name, sourceFilter !== 'all' && sourceFilter, timeFilter !== 'all' && timeFilter, ...selectedTags, mealTypeFilter !== 'all' && mealTypeFilter, hideMyRecipes && 'Mine hidden'].filter(Boolean).join(' · ')} ×</Text>
            </TouchableOpacity>}
            {!hasVisibleFilters && discoverSections(displayRecipes ?? []).map(section => <RNView key={section.title} style={{ marginBottom: 8 }}>
              <Text style={{ fontFamily: fontFamily.displaySemibold, fontWeight: '600', fontSize: 20, lineHeight: 25, marginBottom: 12 }}>{section.title}</Text>
              <RNView style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: RECIPE_GRID_GAP }}>{section.recipes.map(recipe => <GridRecipeCard key={recipe.id} recipe={recipe} active={active} colors={colors} onPress={() => router.push(`/recipe/${recipe.id}`)} currentUserId={identity.data?.id} />)}</RNView>
            </RNView>)}
            {Boolean(displayRecipes?.length) && <Text style={{ fontFamily: fontFamily.displaySemibold, fontWeight: '600', fontSize: 20, lineHeight: 25, marginBottom: 12 }}>All recipes</Text>}
          </>}
          ListEmptyComponent={hasPrimaryLoadError ? ListError : ListEmpty}
          ListFooterComponent={ListFooter}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingBottom: Math.max(insets.bottom + spacing.xl, 80),
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

      {/* Sign In Banner for guests - shows save prompt */}
      {!isSignedIn && <SignInBanner message="Sign in to save recipes" />}

      {/* All Contributors Modal */}
      <AllContributorsModal
        visible={active && showAllContributors}
        onClose={() => setShowAllContributors(false)}
        onSelectContributor={(contributor) => {
          setSelectedExtractor({ id: getContributorId(contributor)!, name: contributor.display_name });
          setDisplayCount(ITEMS_PER_PAGE);
        }}
        selectedContributorId={selectedExtractor?.id}
      />
    </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingBottom: spacing.xxl,
  },
  // Grid view styles
  gridRow: {
    justifyContent: 'space-between',
    gap: RECIPE_GRID_GAP,
  },
  gridSaveButtonContainer: { position: 'absolute', top: 1, right: 1 },
  saveTarget: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  saveButton: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.semibold, fontWeight: '600',
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
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
  // Surprise Me Modal
  surpriseModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  surpriseModalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.strong,
  },
  surpriseModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  surpriseModalTitle: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.semibold, fontWeight: '600',
  },
  surpriseModalOptions: {
    gap: spacing.xs,
  },
  surpriseOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
    gap: spacing.md,
  },
  surpriseOptionIcon: {
    width: 32,
    textAlign: 'center',
  },
  surpriseOptionText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
  surpriseDivider: {
    height: 1,
    marginVertical: spacing.xs,
  },
  surpriseCancelButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  surpriseCancelText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
});

/** Pause background browsing and retire local UI when the stable owner changes. */
export default function DiscoverRoute() {
  const focused = useIsFocused();
  const generation = useRecipeOwnerGeneration();
  return <DiscoverScreen key={generation} active={focused} />;
}
