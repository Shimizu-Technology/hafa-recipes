import { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  View as RNView,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Input, Chip, Button, useColors } from '@/components/Themed';
import { SignInBanner } from '@/components/SignInBanner';
import FilterBottomSheet, { FilterState, SourceFilter, TimeFilter } from '@/components/FilterBottomSheet';
import CreateCollectionModal from '@/components/CreateCollectionModal';
import { SkeletonRecipeList, SkeletonCollectionList } from '@/components/Skeleton';
import { AnimatedListItem, ScalePressable } from '@/components/Animated';
import { 
  useRecipes, 
  useSearchRecipes, 
  useRecipeCount,
  useSavedRecipes,
  usePopularTags,
  filterRecipesLocally,
  SearchFilters,
} from '@/hooks/useRecipes';
import { useCollections } from '@/hooks/useCollections';
import { RecipeListItem, Collection } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { useAuth } from '@clerk/clerk-expo';
import { haptics } from '@/utils/haptics';

const ITEMS_PER_PAGE = 20;

function RecipeCard({ 
  recipe, 
  onPress,
  colors,
  isSavedRecipe,
}: { 
  recipe: RecipeListItem; 
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  isSavedRecipe?: boolean;
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
        {/* Saved badge */}
        {isSavedRecipe && (
          <RNView style={[styles.savedBadge, { backgroundColor: colors.error }]}>
            <Ionicons name="heart" size={10} color="#FFFFFF" />
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
          <RNView style={styles.sourceRow}>
            <Ionicons name={sourceIcon as any} size={14} color={colors.textMuted} />
            <Text style={[styles.sourceText, { color: colors.textMuted }]}>
              {recipe.source_type}
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

// Collection card for the horizontal row - single cover image style
function CollectionCard({
  collection,
  onPress,
  colors,
}: {
  collection: Collection;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const firstThumbnail = collection.preview_thumbnails?.[0];
  const [imageError, setImageError] = useState(false);
  
  return (
    <TouchableOpacity
      style={[styles.collectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Single cover image or emoji */}
      <RNView style={styles.collectionPreview}>
        {firstThumbnail && !imageError ? (
          <Image 
            source={{ uri: firstThumbnail }} 
            style={styles.collectionCoverImage} 
            onError={() => setImageError(true)}
          />
        ) : (
          <RNView style={[styles.collectionEmptyPreview, { backgroundColor: colors.tint + '15' }]}>
            <Text style={{ fontSize: 28 }}>{collection.emoji || '📁'}</Text>
          </RNView>
        )}
        {/* Recipe count badge */}
        {collection.recipe_count > 0 && (
          <RNView style={[styles.collectionBadge, { backgroundColor: colors.tint }]}>
            <Text style={styles.collectionBadgeText}>{collection.recipe_count}</Text>
          </RNView>
        )}
      </RNView>
      
      {/* Collection info */}
      <RNView style={styles.collectionInfo}>
        <Text style={[styles.collectionName, { color: colors.text }]} numberOfLines={1}>
          {collection.name}
        </Text>
      </RNView>
    </TouchableOpacity>
  );
}

// New collection card (+ button)
function NewCollectionCard({
  onPress,
  colors,
}: {
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity
      style={[styles.collectionCard, styles.newCollectionCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border, borderStyle: 'dashed' }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <RNView style={[styles.newCollectionIcon, { backgroundColor: colors.tint + '15' }]}>
        <Ionicons name="add" size={28} color={colors.tint} />
      </RNView>
      <Text style={[styles.newCollectionText, { color: colors.textMuted }]}>
        New Collection
      </Text>
    </TouchableOpacity>
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { userId, isSignedIn } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showCreateCollectionModal, setShowCreateCollectionModal] = useState(false);
  
  // Filter state
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [includeSaved, setIncludeSaved] = useState(true); // Toggle for including saved recipes
  
  // Collections
  const { data: collections, isLoading: isLoadingCollections } = useCollections(!!isSignedIn);
  
  // Pass source filter to server-side queries
  const sourceTypeParam = sourceFilter === 'all' ? undefined : sourceFilter;
  const timeFilterParam = timeFilter === 'all' ? undefined : timeFilter;
  
  // Check if any filters are active (excluding search)
  const activeFilterCount = 
    (sourceFilter !== 'all' ? 1 : 0) + 
    (timeFilter !== 'all' ? 1 : 0) + 
    selectedTags.length +
    (!includeSaved ? 1 : 0); // Count "exclude saved" as a filter
  
  // Check if search or filters are active
  const hasActiveFilters = searchQuery.length > 0 || sourceFilter !== 'all' || timeFilter !== 'all' || selectedTags.length > 0;
  
  // Only fetch when authenticated
  const isAuthenticated = !!isSignedIn;
  
  // Own recipes with infinite scroll
  const { 
    recipes, 
    total: recipesTotal,
    isLoading: isLoadingRecipes, 
    refetch: refetchRecipes, 
    isRefetching: isRefetchingRecipes,
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
  } = useSearchRecipes({
    query: searchQuery,
    sourceType: sourceTypeParam,
    timeFilter: timeFilterParam,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
  }, isAuthenticated);
  
  const { data: countData } = useRecipeCount(sourceTypeParam, isAuthenticated);
  
  // Popular tags for this user
  const { data: popularTags } = usePopularTags('user', isAuthenticated);
  
  // Saved recipes with infinite scroll
  const { 
    recipes: savedRecipes, 
    isLoading: isLoadingSaved, 
    refetch: refetchSaved, 
    isRefetching: isRefetchingSaved,
    fetchNextPage: fetchNextSaved,
    hasNextPage: hasMoreSaved,
  } = useSavedRecipes(isAuthenticated);

  const isLoading = isLoadingRecipes || (includeSaved && isLoadingSaved);
  const isRefetching = isRefetchingRecipes || (includeSaved && isRefetchingSaved);
  
  const handleRefreshAll = useCallback(() => {
    refetchRecipes();
    if (includeSaved) refetchSaved();
  }, [refetchRecipes, refetchSaved, includeSaved]);

  // Refetch when tab gains focus (handles cache cleared on user change)
  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) {
        refetchRecipes();
      }
    }, [isAuthenticated, refetchRecipes])
  );

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

  // Combine own recipes with saved recipes when toggle is on
  const combinedRecipes = useMemo(() => {
    // Optimistic filtering: filter locally while server request is in flight
    // Use server search results if available, otherwise filter locally
    let ownRecipes: RecipeListItem[] | undefined;
    
    if (hasActiveFilters) {
      // If search results are back, use them; otherwise filter cached data locally
      ownRecipes = searchResults?.length ? searchResults : filterRecipesLocally(recipes, currentFilters);
    } else {
      ownRecipes = recipes;
    }
    
    if (!ownRecipes) return undefined;
    
    if (!includeSaved || !savedRecipes) {
      return ownRecipes;
    }
    
    // Combine and dedupe (in case a saved recipe somehow appears in both)
    const ownIds = new Set(ownRecipes.map(r => r.id));
    const uniqueSaved = savedRecipes.filter(r => !ownIds.has(r.id));
    
    // Apply filters to saved recipes too (optimistic filtering)
    const filteredSaved = hasActiveFilters
      ? filterRecipesLocally(uniqueSaved, currentFilters)
      : (sourceTypeParam ? uniqueSaved.filter(r => r.source_type === sourceTypeParam) : uniqueSaved);
    
    // Combine: own recipes first, then saved
    return [...ownRecipes, ...filteredSaved];
  }, [recipes, searchResults, savedRecipes, includeSaved, hasActiveFilters, sourceTypeParam, currentFilters]);

  const totalCount = recipesTotal + (includeSaved && savedRecipes ? savedRecipes.length : 0);

  // For display, slice to current page
  const displayRecipes = combinedRecipes?.slice(0, displayCount);
  
  // Determine if there's more to load - either from server or locally
  const hasMoreLocal = combinedRecipes && displayCount < combinedRecipes.length;
  const hasMoreServer = hasActiveFilters ? hasMoreSearchResults : hasMoreRecipes;
  const hasMore = hasMoreLocal || hasMoreServer;

  const handleRefresh = useCallback(() => {
    setDisplayCount(ITEMS_PER_PAGE);
    handleRefreshAll();
  }, [handleRefreshAll]);

  const handleLoadMore = () => {
    if (hasMoreLocal) {
      // First, show more of what we already have
      setDisplayCount(prev => prev + ITEMS_PER_PAGE);
    } else if (hasMoreServer) {
      // Then, fetch more from the server
      if (hasActiveFilters && hasMoreSearchResults) {
        fetchNextSearchResults();
      } else if (hasMoreRecipes) {
        fetchNextRecipes();
      }
      if (includeSaved && hasMoreSaved) {
        fetchNextSaved();
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
        isSavedRecipe={item.user_id !== userId}
      />
    </AnimatedListItem>
  );

  // Memoize header to prevent re-render on search change
  const ListHeaderTitle = useCallback(() => (
    <RNView style={styles.titleRow}>
      <Text style={[styles.headerTitle, { color: colors.text }]}>
        My Recipes
      </Text>
      {totalCount !== undefined && (
        <RNView style={[styles.countBadge, { backgroundColor: colors.tint }]}>
          <Text style={styles.countText}>{totalCount}</Text>
        </RNView>
      )}
      {isRefetching && (
        <ActivityIndicator size="small" color={colors.tint} style={{ marginLeft: spacing.sm }} />
      )}
    </RNView>
  ), [colors.text, colors.tint, totalCount, isRefetching]);

  const ListEmpty = () => (
    <RNView style={styles.emptyContainer}>
      <Ionicons 
        name="restaurant-outline"
        size={64} 
        color={colors.textMuted} 
      />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        No recipes yet
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        Extract your first recipe from the home screen!
      </Text>
    </RNView>
  );

  const isFetchingMore = isFetchingNextRecipes || isFetchingNextSearchResults;
  
  const ListFooter = () => {
    if (!hasMore) return null;
    
    const remaining = hasMoreLocal && combinedRecipes 
      ? combinedRecipes.length - displayCount 
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
        showIncludeSaved
        includeSaved={includeSaved}
        onIncludeSavedChange={setIncludeSaved}
      />
      
      {/* Create Collection Modal */}
      <CreateCollectionModal
        visible={showCreateCollectionModal}
        onClose={() => setShowCreateCollectionModal(false)}
      />
      
      {/* Fixed header with search - outside FlatList to prevent focus loss */}
      <RNView style={styles.header}>
        <ListHeaderTitle />
        
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
        {(activeFilterCount > 0 || !includeSaved) && (
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
            {!includeSaved && (
              <RNView style={[styles.activeFilterChip, { backgroundColor: colors.error + '20' }]}>
                <Text style={[styles.activeFilterText, { color: colors.error }]}>
                  Own only
                </Text>
              </RNView>
            )}
            <TouchableOpacity
              onPress={() => {
                setSourceFilter('all');
                setTimeFilter('all');
                setSelectedTags([]);
                setIncludeSaved(true);
              }}
            >
              <Text style={[styles.clearFiltersText, { color: colors.textMuted }]}>
                Clear
              </Text>
            </TouchableOpacity>
          </RNView>
        )}
        
        {/* Search loading indicator - shows when server is fetching more results */}
        {hasActiveFilters && isSearchFetching && (
          <RNView style={styles.searchLoadingRow}>
            <ActivityIndicator size="small" color={colors.tint} />
            <Text style={[styles.searchLoadingText, { color: colors.textMuted }]}>
              Finding more recipes...
            </Text>
          </RNView>
        )}
        
        {/* Collections row */}
        {collections && collections.length > 0 && (
          <RNView style={styles.collectionsSection}>
            <RNView style={styles.collectionsSectionHeader}>
              <Text style={[styles.collectionsSectionTitle, { color: colors.text }]}>
                📁 Collections
              </Text>
            </RNView>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.collectionsRow}
            >
              {collections.map((collection) => (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  colors={colors}
                  onPress={() => {
                    haptics.light();
                    router.push(`/collection/${collection.id}`);
                  }}
                />
              ))}
              <NewCollectionCard
                colors={colors}
                onPress={() => {
                  haptics.medium();
                  setShowCreateCollectionModal(true);
                }}
              />
            </ScrollView>
          </RNView>
        )}
        
        {/* Show "Create first collection" prompt if no collections */}
        {collections && collections.length === 0 && !isLoadingCollections && (
          <TouchableOpacity
            style={[styles.createFirstCollection, { backgroundColor: colors.tint + '10', borderColor: colors.tint + '30' }]}
            onPress={() => setShowCreateCollectionModal(true)}
          >
            <Ionicons name="folder-outline" size={20} color={colors.tint} />
            <Text style={[styles.createFirstCollectionText, { color: colors.tint }]}>
              Create your first collection to organize recipes
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.tint} />
          </TouchableOpacity>
        )}
      </RNView>
      
      {isLoading && !displayRecipes?.length ? (
        <SkeletonRecipeList count={4} />
      ) : (
        <FlatList
          data={displayRecipes}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={ListEmpty}
          ListFooterComponent={ListFooter}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl + 80 }]}
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
      
      {/* Floating Action Button - Add Recipe (only for signed-in users) */}
      {isSignedIn && (
        <ScalePressable
          style={[styles.fab, { backgroundColor: colors.tint }]}
          onPress={() => {
            haptics.medium();
            // Navigate to Extract tab (index 0) - the central place for adding recipes
            router.push('/(tabs)');
          }}
          scaleValue={0.9}
        >
          <Ionicons name="add" size={28} color="#FFFFFF" />
        </ScalePressable>
      )}
      
      {/* Sign In Banner for guests */}
      {!isSignedIn && <SignInBanner message="Sign in to save your recipes" />}
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
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
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
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  tagChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  tagChipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
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
  savedBadge: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    borderRadius: radius.full,
    padding: 4,
  },
  placeholderEmoji: {
    fontSize: 32,
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
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  // Collections styles
  collectionsSection: {
    marginTop: spacing.md,
  },
  collectionsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  collectionsSectionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  collectionsRow: {
    paddingRight: spacing.lg,
    gap: spacing.sm,
  },
  collectionCard: {
    width: 120,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  newCollectionCard: {
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 140,
  },
  collectionPreview: {
    height: 80,
    overflow: 'hidden',
    position: 'relative',
  },
  collectionCoverImage: {
    width: '100%',
    height: '100%',
  },
  collectionEmptyPreview: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  collectionBadge: {
    position: 'absolute',
    bottom: spacing.xs,
    right: spacing.xs,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  collectionBadgeText: {
    color: '#FFFFFF',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  collectionInfo: {
    padding: spacing.sm,
  },
  collectionName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  collectionCount: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  newCollectionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  newCollectionText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },
  createFirstCollection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  createFirstCollectionText: {
    flex: 1,
    fontSize: fontSize.sm,
  },
});
