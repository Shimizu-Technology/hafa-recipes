import { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  View as RNView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/clerk-expo';

import { View, Text, Input, Chip, useColors } from '@/components/Themed';
import { SignInBanner } from '@/components/SignInBanner';
import FilterBottomSheet, { FilterState, SourceFilter, TimeFilter } from '@/components/FilterBottomSheet';
import { 
  useDiscoverRecipes, 
  useSearchPublicRecipes, 
  usePublicRecipeCount,
  useIsRecipeSaved,
  useSaveRecipe,
  useUnsaveRecipe,
  usePopularTags,
  filterRecipesLocally,
  SearchFilters,
} from '@/hooks/useRecipes';
import { RecipeListItem } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';
import { SkeletonRecipeList } from '@/components/Skeleton';
import { AnimatedListItem, ScalePressable } from '@/components/Animated';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

const ITEMS_PER_PAGE = 20;

// Save/Bookmark button component with heart pulse animation
function SaveButton({ 
  recipeId, 
  colors,
  isOwner,
}: { 
  recipeId: string; 
  colors: ReturnType<typeof useColors>;
  isOwner: boolean;
}) {
  const { data: savedStatus, isLoading } = useIsRecipeSaved(recipeId);
  const saveMutation = useSaveRecipe();
  const unsaveMutation = useUnsaveRecipe();
  const scale = useSharedValue(1);
  
  // Don't show save button for own recipes
  if (isOwner) return null;
  
  const isSaved = savedStatus?.is_saved ?? false;
  const isPending = saveMutation.isPending || unsaveMutation.isPending;
  
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  
  const handlePress = () => {
    if (isPending) return;
    haptics.medium();
    
    // Pulse animation
    scale.value = withSequence(
      withSpring(1.4, { damping: 8, stiffness: 400 }),
      withSpring(1, { damping: 8, stiffness: 400 })
    );
    
    if (isSaved) {
      unsaveMutation.mutate(recipeId);
    } else {
      saveMutation.mutate(recipeId);
    }
  };
  
  if (isLoading) {
    return (
      <RNView style={styles.saveButton}>
        <ActivityIndicator size="small" color={colors.textMuted} />
      </RNView>
    );
  }
  
  return (
    <TouchableOpacity 
      style={styles.saveButton} 
      onPress={handlePress}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Animated.View style={animatedStyle}>
        <Ionicons 
          name={isSaved ? "heart" : "heart-outline"} 
          size={22} 
          color={isSaved ? colors.error : colors.textMuted} 
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

// Helper to format relative time
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return months === 1 ? '1 month ago' : `${months} months ago`;
  }
  const years = Math.floor(diffDays / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

function RecipeCard({ 
  recipe, 
  onPress,
  colors,
  currentUserId,
}: { 
  recipe: RecipeListItem; 
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  currentUserId?: string | null;
}) {
  const [imageError, setImageError] = useState(false);
  
  const sourceIcon = recipe.source_type === 'tiktok' 
    ? 'logo-tiktok' 
    : recipe.source_type === 'youtube' 
      ? 'logo-youtube' 
      : recipe.source_type === 'instagram' 
        ? 'logo-instagram' 
        : recipe.source_type === 'manual'
          ? 'create-outline'
          : 'globe-outline';

  const showPlaceholder = !recipe.thumbnail_url || imageError;
  const isOwner = recipe.user_id === currentUserId;
  
  // Format attribution text
  const relativeTime = formatRelativeTime(recipe.created_at);
  const extractorName = isOwner 
    ? 'you' 
    : recipe.extractor_display_name || null;
  const attributionText = extractorName 
    ? `by ${extractorName} • ${relativeTime}` 
    : relativeTime;

  return (
    <ScalePressable 
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} 
      onPress={onPress}
    >
      {/* Thumbnail */}
      <RNView>
        {showPlaceholder ? (
          <RNView style={[styles.placeholderThumbnail, { backgroundColor: colors.tint + '15' }]}>
            <Ionicons name="restaurant-outline" size={32} color={colors.tint} />
          </RNView>
        ) : (
          <Image 
            source={{ uri: recipe.thumbnail_url! }} 
            style={styles.thumbnail}
            onError={() => setImageError(true)}
          />
        )}
        {/* Save button overlay */}
        {currentUserId && (
          <RNView style={styles.saveButtonContainer}>
            <SaveButton recipeId={recipe.id} colors={colors} isOwner={isOwner} />
          </RNView>
        )}
      </RNView>
      
      {/* Content */}
      <RNView style={styles.cardContent}>
        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
          {recipe.title}
        </Text>
        
        {/* Meta info */}
        <RNView style={styles.metaRow}>
          {recipe.total_time && (
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              ⏱️ {recipe.total_time}
            </Text>
          )}
          {recipe.servings && (
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              👥 {recipe.servings}
            </Text>
          )}
        </RNView>
        
        {/* Tags */}
        {recipe.tags.length > 0 && (
          <RNView style={styles.tagRow}>
            {recipe.tags.slice(0, 2).map((tag, index) => (
              <Chip key={index} label={tag} size="sm" />
            ))}
            {recipe.tags.length > 2 && (
              <Text style={[styles.moreText, { color: colors.textMuted }]}>
                +{recipe.tags.length - 2}
              </Text>
            )}
          </RNView>
        )}
        
        {/* Footer */}
        <RNView style={styles.cardFooter}>
          <RNView style={styles.footerLeft}>
          <RNView style={styles.sourceRow}>
            <Ionicons name={sourceIcon as any} size={14} color={colors.textMuted} />
            <Text style={[styles.sourceText, { color: colors.textMuted }]}>
              {recipe.source_type}
              </Text>
            </RNView>
            <Text style={[styles.attributionText, { color: colors.textMuted }]}>
              {attributionText}
            </Text>
          </RNView>
          {recipe.has_audio_transcript && (
            <RNView style={[styles.hdBadge, { backgroundColor: colors.success + '20' }]}>
              <Text style={[styles.hdText, { color: colors.success }]}>HD</Text>
            </RNView>
          )}
        </RNView>
      </RNView>
    </ScalePressable>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { userId, isSignedIn } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
  const [showFilterModal, setShowFilterModal] = useState(false);
  
  // Filter state
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [hideMyRecipes, setHideMyRecipes] = useState(false);
  
  // Pass source filter to server-side queries
  const sourceTypeParam = sourceFilter === 'all' ? undefined : sourceFilter;
  const timeFilterParam = timeFilter === 'all' ? undefined : timeFilter;
  
  // Check if any filters are active (excluding search)
  const activeFilterCount = 
    (sourceFilter !== 'all' ? 1 : 0) + 
    (timeFilter !== 'all' ? 1 : 0) + 
    selectedTags.length;
  
  // Check if search or filters are active
  const hasActiveFilters = searchQuery.length > 0 || activeFilterCount > 0;
  
  // Only fetch when authenticated
  const isAuthenticated = !!isSignedIn;
  
  // Discover recipes with infinite scroll
  const { 
    recipes, 
    total: recipesTotal,
    isLoading, 
    refetch, 
    isRefetching,
    fetchNextPage,
    hasNextPage: hasMoreRecipes,
    isFetchingNextPage,
  } = useDiscoverRecipes(sourceTypeParam, isAuthenticated);
  
  // Search/filter results (when filters are active)
  const { 
    recipes: searchResults,
    fetchNextPage: fetchNextSearchResults,
    hasNextPage: hasMoreSearchResults,
    isFetchingNextPage: isFetchingNextSearchResults,
    isFetching: isDiscoverSearchFetching,
  } = useSearchPublicRecipes({
    query: searchQuery,
    sourceType: sourceTypeParam,
    timeFilter: timeFilterParam,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
  }, isAuthenticated);
  
  const { data: countData } = usePublicRecipeCount(sourceTypeParam, isAuthenticated);
  
  // Popular tags from all public recipes
  const { data: popularTags } = usePopularTags('public', isAuthenticated);
  
  // Handle filter apply
  const handleApplyFilters = useCallback((filters: FilterState) => {
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

  // Optimistic filtering: filter locally while server request is in flight
  // Use server search results if available, otherwise filter cached data locally
  const filteredRecipes = useMemo(() => {
    let result = hasActiveFilters 
      ? (searchResults?.length ? searchResults : filterRecipesLocally(recipes, currentFilters))
      : recipes;
    
    // Filter out user's own recipes if toggle is on
    if (hideMyRecipes && userId && result) {
      result = result.filter(recipe => recipe.user_id !== userId);
    }
    
    return result;
  }, [hasActiveFilters, recipes, searchResults, currentFilters, hideMyRecipes, userId]);

  const displayRecipes = filteredRecipes?.slice(0, displayCount);
  
  // Determine if there's more to load - either from server or locally
  const hasMoreLocal = filteredRecipes && displayCount < filteredRecipes.length;
  const hasMoreServer = hasActiveFilters ? hasMoreSearchResults : hasMoreRecipes;
  const hasMore = hasMoreLocal || hasMoreServer;
  const isFetchingMore = isFetchingNextPage || isFetchingNextSearchResults;

  const handleRefresh = useCallback(() => {
    setDisplayCount(ITEMS_PER_PAGE);
    refetch();
  }, [refetch]);

  // Refetch when tab gains focus (handles cache cleared on user change)
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const handleLoadMore = () => {
    if (hasMoreLocal) {
      // First, show more of what we already have
      setDisplayCount(prev => prev + ITEMS_PER_PAGE);
    } else if (hasMoreServer) {
      // Then, fetch more from the server
      if (hasActiveFilters && hasMoreSearchResults) {
        fetchNextSearchResults();
      } else if (hasMoreRecipes) {
        fetchNextPage();
      }
      // Increase display count after fetch
      setDisplayCount(prev => prev + ITEMS_PER_PAGE);
    }
  };

  const renderItem = ({ item, index }: { item: RecipeListItem; index: number }) => (
    <AnimatedListItem index={index} delay={40}>
      <RecipeCard
        recipe={item}
        colors={colors}
        onPress={() => {
          haptics.light();
          router.push(`/recipe/${item.id}`);
        }}
        currentUserId={userId}
      />
    </AnimatedListItem>
  );

  // Memoize header to prevent re-render on search change
  const ListHeaderTitle = useCallback(() => (
    <RNView style={styles.titleRow}>
      <Text style={[styles.headerTitle, { color: colors.text }]}>
        Discover
      </Text>
      {countData && (
        <RNView style={[styles.countBadge, { backgroundColor: colors.tint }]}>
          <Text style={styles.countText}>{countData.count}</Text>
        </RNView>
      )}
      {isRefetching && (
        <ActivityIndicator size="small" color={colors.tint} style={{ marginLeft: spacing.sm }} />
      )}
    </RNView>
  ), [colors.text, colors.tint, countData, isRefetching]);

  const ListEmpty = () => (
    <RNView style={styles.emptyContainer}>
      <Ionicons name="globe-outline" size={64} color={colors.textMuted} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        No public recipes yet
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        Share your recipes to see them here!
      </Text>
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
            <ActivityIndicator size="small" color={colors.tint} />
          ) : (
            <>
              <Text style={[styles.loadMoreText, { color: colors.text }]}>
                Load More {typeof remaining === 'number' && remaining > 0 ? `(${remaining} remaining)` : ''}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
            </>
          )}
        </TouchableOpacity>
      </RNView>
    );
  };

  return (
    <View style={styles.container}>
      {/* Filter Bottom Sheet */}
      <FilterBottomSheet
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        onApply={handleApplyFilters}
        initialFilters={{ sourceFilter, timeFilter, selectedTags }}
        popularTags={popularTags}
      />
      
      {/* Fixed header with search - outside FlatList to prevent focus loss */}
      <RNView style={styles.header}>
        <ListHeaderTitle />
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Browse recipes shared by the community
        </Text>
        
        {/* Search + Filter row */}
        <RNView style={styles.searchRow}>
          <RNView style={styles.searchInputContainer}>
            <Input
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search recipes..."
            />
          </RNView>
          <TouchableOpacity
            style={[
              styles.filterButton,
              {
                backgroundColor: activeFilterCount > 0 ? colors.tint : colors.backgroundSecondary,
                borderColor: activeFilterCount > 0 ? colors.tint : colors.border,
              },
            ]}
            onPress={() => setShowFilterModal(true)}
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={activeFilterCount > 0 ? '#FFFFFF' : colors.text}
            />
            {activeFilterCount > 0 && (
              <RNView style={[styles.filterBadge, { backgroundColor: '#FFFFFF' }]}>
                <Text style={[styles.filterBadgeText, { color: colors.tint }]}>
                  {activeFilterCount}
                </Text>
              </RNView>
            )}
          </TouchableOpacity>
        </RNView>
        
        {/* Active filters summary */}
        {activeFilterCount > 0 && (
          <RNView style={styles.activeFiltersRow}>
            {sourceFilter !== 'all' && (
              <RNView style={[styles.activeFilterChip, { backgroundColor: colors.tint + '20' }]}>
                <Text style={[styles.activeFilterText, { color: colors.tint }]}>
                  {sourceFilter}
                </Text>
              </RNView>
            )}
            {timeFilter !== 'all' && (
              <RNView style={[styles.activeFilterChip, { backgroundColor: colors.success + '20' }]}>
                <Text style={[styles.activeFilterText, { color: colors.success }]}>
                  {timeFilter === 'quick' ? '<30 min' : timeFilter === 'medium' ? '30-60 min' : '60+ min'}
                </Text>
              </RNView>
            )}
            {selectedTags.length > 0 && (
              <RNView style={[styles.activeFilterChip, { backgroundColor: colors.tint + '20' }]}>
                <Text style={[styles.activeFilterText, { color: colors.tint }]}>
                  {selectedTags.length} tag{selectedTags.length > 1 ? 's' : ''}
                </Text>
              </RNView>
            )}
            <TouchableOpacity
              onPress={() => {
                setSourceFilter('all');
                setTimeFilter('all');
                setSelectedTags([]);
              }}
            >
              <Text style={[styles.clearFiltersText, { color: colors.textMuted }]}>
                Clear
              </Text>
            </TouchableOpacity>
          </RNView>
        )}
        
        {/* Search loading indicator - shows when server is fetching more results */}
        {hasActiveFilters && isDiscoverSearchFetching && (
          <RNView style={styles.searchLoadingRow}>
            <ActivityIndicator size="small" color={colors.tint} />
            <Text style={[styles.searchLoadingText, { color: colors.textMuted }]}>
              Finding more recipes...
            </Text>
          </RNView>
        )}
        
        {/* Hide my recipes toggle - only show for signed in users */}
        {isSignedIn && (
          <TouchableOpacity
            style={[
              styles.hideMyRecipesToggle,
              { 
                backgroundColor: hideMyRecipes ? colors.tint + '20' : colors.backgroundSecondary,
                borderColor: hideMyRecipes ? colors.tint : colors.border,
              },
            ]}
            onPress={() => {
              haptics.light();
              setHideMyRecipes(!hideMyRecipes);
            }}
            activeOpacity={0.7}
          >
            <Ionicons
              name={hideMyRecipes ? "eye-off" : "eye-off-outline"}
              size={16}
              color={hideMyRecipes ? colors.tint : colors.textMuted}
            />
            <Text 
              style={[
                styles.hideMyRecipesText, 
                { color: hideMyRecipes ? colors.tint : colors.textMuted }
              ]}
            >
              Hide my recipes
            </Text>
          </TouchableOpacity>
        )}
      </RNView>
      
      {isLoading && !displayRecipes?.length ? (
        <SkeletonRecipeList count={5} />
      ) : (
        <FlatList
          data={displayRecipes}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={ListEmpty}
          ListFooterComponent={ListFooter}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl + (isSignedIn ? 0 : 100) }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl 
              refreshing={isRefetching} 
              onRefresh={handleRefresh}
              tintColor={colors.tint}
            />
          }
        />
      )}
      
      {/* Sign In Banner for guests - shows save prompt */}
      {!isSignedIn && <SignInBanner message="Sign in to save recipes" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchInputContainer: {
    flex: 1,
  },
  filterButton: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
  },
  activeFiltersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  activeFilterChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  activeFilterText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  clearFiltersText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    marginLeft: spacing.xs,
  },
  searchLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  searchLoadingText: {
    fontSize: fontSize.xs,
  },
  hideMyRecipesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  hideMyRecipesText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  countBadge: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  countText: {
    color: '#FFFFFF',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  card: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
  },
  thumbnail: {
    width: 100,
    height: 120,
  },
  placeholderThumbnail: {
    width: 100,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonContainer: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
  },
  saveButton: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: radius.full,
    padding: spacing.xs,
  },
  cardContent: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  metaText: {
    fontSize: fontSize.xs,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  moreText: {
    fontSize: fontSize.xs,
    alignSelf: 'center',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  footerLeft: {
    flex: 1,
    gap: 2,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  attributionText: {
    fontSize: fontSize.xs,
  },
  sourceText: {
    fontSize: fontSize.xs,
    textTransform: 'capitalize',
  },
  hdBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  hdText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  emptySubtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
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
});

