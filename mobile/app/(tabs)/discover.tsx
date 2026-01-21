import { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  View as RNView,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
  ScrollView,
  Dimensions,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/clerk-expo';

import { View, Text, Input, Chip, useColors } from '@/components/Themed';
import { SignInBanner } from '@/components/SignInBanner';
import FilterBottomSheet, { FilterState, SourceFilter, TimeFilter, MealTypeFilter } from '@/components/FilterBottomSheet';
import AllContributorsModal from '@/components/AllContributorsModal';
import { 
  useDiscoverRecipes, 
  useSearchPublicRecipes, 
  usePublicRecipeCount,
  useIsRecipeSaved,
  useSaveRecipe,
  useUnsaveRecipe,
  usePopularTags,
  useTopContributors,
  filterRecipesLocally,
  SearchFilters,
  DiscoverSort,
} from '@/hooks/useRecipes';
import { RecipeListItem } from '@/types/recipe';
import { api } from '@/lib/api';
import { spacing, fontSize, fontWeight, radius, shadows, fontFamily } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_PADDING = spacing.lg; // 24px on each side
const GRID_GAP = spacing.sm; // Gap between cards
const GRID_CARD_WIDTH = (SCREEN_WIDTH - (GRID_PADDING * 2) - GRID_GAP) / 2;
import { useViewPreference } from '@/hooks/useViewPreference';
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
  onUserPress,
  colors,
  currentUserId,
}: { 
  recipe: RecipeListItem; 
  onPress: () => void;
  onUserPress?: (userId: string, userName: string) => void;
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
        : recipe.source_type === 'website'
          ? 'globe-outline' 
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
  const canFilterByUser = !isOwner && recipe.extractor_display_name && recipe.user_id;

  return (
    <ScalePressable 
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} 
      onPress={onPress}
    >
      {/* Thumbnail with gradient overlay */}
      <RNView style={styles.thumbnailContainer}>
        {showPlaceholder ? (
          <RNView style={[styles.placeholderThumbnail, { backgroundColor: colors.tint + '15' }]}>
            <Ionicons name="restaurant-outline" size={32} color={colors.tint} />
          </RNView>
        ) : (
          <>
            <Image 
              source={{ uri: recipe.thumbnail_url! }} 
              style={styles.thumbnail}
              onError={() => setImageError(true)}
            />
            {/* Subtle gradient for depth */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.3)']}
              style={styles.thumbnailOverlay}
            />
          </>
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
            <RNView style={styles.attributionRow}>
              {canFilterByUser && onUserPress ? (
                <>
                  <Text style={[styles.attributionText, { color: colors.textMuted }]}>by </Text>
                  <TouchableOpacity 
                    onPress={(e) => {
                      e.stopPropagation?.();
                      onUserPress(recipe.user_id!, recipe.extractor_display_name!);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  >
                    <Text style={[styles.attributionText, { color: colors.tint, textDecorationLine: 'underline' }]}>
                      {extractorName}
                    </Text>
                  </TouchableOpacity>
                  <Text style={[styles.attributionText, { color: colors.textMuted }]}> • {relativeTime}</Text>
                </>
              ) : (
                <Text style={[styles.attributionText, { color: colors.textMuted }]}>
                  {extractorName ? `by ${extractorName} • ${relativeTime}` : relativeTime}
                </Text>
              )}
            </RNView>
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

// Grid recipe card - square image with title overlay
function GridRecipeCard({ 
  recipe, 
  onPress,
  onUserPress,
  colors,
  currentUserId,
}: { 
  recipe: RecipeListItem; 
  onPress: () => void;
  onUserPress?: (userId: string, userName: string) => void;
  colors: ReturnType<typeof useColors>;
  currentUserId?: string | null;
}) {
  const [imageError, setImageError] = useState(false);
  const showPlaceholder = !recipe.thumbnail_url || imageError;
  
  // Can filter by this user if they have a user_id and display name, and it's not the current user
  const canFilterByUser = recipe.user_id && recipe.extractor_display_name && recipe.user_id !== currentUserId;
  const isOwner = recipe.user_id === currentUserId;

  return (
    <ScalePressable 
      style={[styles.gridCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} 
      onPress={onPress}
    >
      {/* Full card is the image with overlay */}
      <RNView style={styles.gridThumbnailContainer}>
        {showPlaceholder ? (
          <RNView style={[styles.gridPlaceholder, { backgroundColor: colors.tint + '15' }]}>
            <Ionicons name="restaurant-outline" size={40} color={colors.tint} />
          </RNView>
        ) : (
          <Image 
            source={{ uri: recipe.thumbnail_url! }} 
            style={styles.gridThumbnail}
            onError={() => setImageError(true)}
          />
        )}
        
        {/* Cook time badge - top left */}
        {recipe.total_time && (
          <RNView style={[styles.gridTimeBadge, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
            <Ionicons name="time-outline" size={10} color="#FFFFFF" />
            <Text style={styles.gridTimeText}>{recipe.total_time}</Text>
          </RNView>
        )}
        
        {/* Save button - top right */}
        {currentUserId && (
          <RNView style={styles.gridSaveButtonContainer}>
            <SaveButton recipeId={recipe.id} colors={colors} isOwner={isOwner} />
          </RNView>
        )}
        
        {/* Subtle gradient overlay at bottom for text readability */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.7)']}
          style={styles.gridOverlay}
        />
        
        {/* Title and author overlaid on image */}
        <RNView style={styles.gridCardContent}>
          <Text style={styles.gridCardTitle} numberOfLines={2}>
            {recipe.title}
          </Text>
          {recipe.extractor_display_name && (
            canFilterByUser && onUserPress ? (
              <TouchableOpacity 
                onPress={(e) => {
                  e.stopPropagation?.();
                  haptics.light();
                  onUserPress(recipe.user_id!, recipe.extractor_display_name!);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Text style={[styles.gridCardAuthor, { textDecorationLine: 'underline' }]} numberOfLines={1}>
                  by {recipe.extractor_display_name}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.gridCardAuthor} numberOfLines={1}>
                by {recipe.extractor_display_name}
              </Text>
            )
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
  const [showAllContributors, setShowAllContributors] = useState(false);
  const [isRandomLoading, setIsRandomLoading] = useState(false);
  const [showSurpriseModal, setShowSurpriseModal] = useState(false);
  
  // View preference (grid or list)
  const { viewMode, toggleViewMode, isGrid } = useViewPreference();
  
  // User filter state (for "recipes by user" feature)
  const [selectedExtractor, setSelectedExtractor] = useState<{ id: string; name: string } | null>(null);
  
  // @username search pattern detection
  const usernameSearchMatch = useMemo(() => {
    const match = searchQuery.match(/^@(.+)/);
    if (match) {
      return match[1].toLowerCase().trim();
    }
    return null;
  }, [searchQuery]);
  
  // Filter state
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [hideMyRecipes, setHideMyRecipes] = useState(false);
  const [sortOrder, setSortOrder] = useState<DiscoverSort>('recent');
  const [mealTypeFilter, setMealTypeFilter] = useState<MealTypeFilter>('all');
  
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
    (selectedExtractor ? 1 : 0);
  
  // Check if search or filters are active
  const hasActiveFilters = searchQuery.length > 0 || activeFilterCount > 0 || !!selectedExtractor;
  
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
  } = useDiscoverRecipes(sourceTypeParam, isAuthenticated, sortOrder, mealTypeParam);
  
  // Search/filter results (when filters are active)
  const { 
    recipes: searchResults,
    total: searchTotal,
    fetchNextPage: fetchNextSearchResults,
    hasNextPage: hasMoreSearchResults,
    isFetchingNextPage: isFetchingNextSearchResults,
    isFetching: isDiscoverSearchFetching,
  } = useSearchPublicRecipes({
    query: searchQuery,
    sourceType: sourceTypeParam,
    timeFilter: timeFilterParam,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
    extractorId: selectedExtractor?.id,
    extractorName: selectedExtractor?.name,
    mealType: mealTypeParam,
  }, isAuthenticated);
  
  const { data: countData } = usePublicRecipeCount(sourceTypeParam, isAuthenticated);
  
  // Popular tags from all public recipes
  const { data: popularTags } = usePopularTags('public', isAuthenticated);
  
  // Top contributors (users with most public recipes)
  const { data: topContributors } = useTopContributors(isAuthenticated);
  
  // Filter contributors based on @username search
  const matchingContributors = useMemo(() => {
    if (!usernameSearchMatch || !topContributors) return [];
    return topContributors.filter(c => 
      c.display_name.toLowerCase().includes(usernameSearchMatch)
    ).slice(0, 5); // Limit to 5 suggestions
  }, [usernameSearchMatch, topContributors]);
  
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
    query: searchQuery || undefined,
    sourceType: sourceTypeParam,
    timeFilter: timeFilterParam,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
    extractorId: selectedExtractor?.id,
    extractorName: selectedExtractor?.name,
    mealType: mealTypeParam,
  }), [searchQuery, sourceTypeParam, timeFilterParam, selectedTags, selectedExtractor, mealTypeParam]);

  // Determine what to display:
  // - For text search: ONLY use server results (local can't search ingredients)
  // - For other filters: use optimistic local filtering while server loads
  const hasTextSearch = !!searchQuery?.trim();
  
  const filteredRecipes = useMemo(() => {
    let result: RecipeListItem[] | undefined;
    
    if (hasTextSearch) {
      // Text search MUST use server results - local filter can't search ingredients
      result = searchResults;
    } else if (hasActiveFilters) {
      // For non-text filters, use server results if available, otherwise filter locally
      result = searchResults?.length ? searchResults : filterRecipesLocally(recipes, currentFilters);
    } else {
      // No filters - use the discover results
      result = recipes;
    }
    
    // Filter out user's own recipes if toggle is on
    if (hideMyRecipes && userId && result) {
      result = result.filter(recipe => recipe.user_id !== userId);
    }
    
    return result;
  }, [hasTextSearch, hasActiveFilters, recipes, searchResults, currentFilters, hideMyRecipes, userId]);

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

  // Handle user press to filter by extractor
  const handleUserPress = useCallback((extractorId: string, extractorName: string) => {
    haptics.light();
    setSelectedExtractor({ id: extractorId, name: extractorName });
    setDisplayCount(ITEMS_PER_PAGE); // Reset pagination
  }, []);
  
  const clearExtractorFilter = useCallback(() => {
    setSelectedExtractor(null);
    setDisplayCount(ITEMS_PER_PAGE);
  }, []);

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
    if (isGrid) {
      return (
        <AnimatedListItem index={index} delay={40}>
          <GridRecipeCard
            recipe={item}
            colors={colors}
            onPress={() => {
              haptics.light();
              router.push(`/recipe/${item.id}`);
            }}
            onUserPress={handleUserPress}
            currentUserId={userId}
          />
        </AnimatedListItem>
      );
    }
    return (
      <AnimatedListItem index={index} delay={40}>
        <RecipeCard
          recipe={item}
          colors={colors}
          onPress={() => {
            haptics.light();
            router.push(`/recipe/${item.id}`);
          }}
          onUserPress={handleUserPress}
          currentUserId={userId}
        />
      </AnimatedListItem>
    );
  };

  // Memoize header to prevent re-render on search change
  const ListHeaderTitle = useCallback(() => (
    <RNView style={styles.titleRow}>
      <RNView style={styles.titleLeft}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Discover
        </Text>
        {countData && (
          <RNView style={[styles.countBadge, { backgroundColor: colors.tint }]}>
            <Text style={styles.countText}>
              {hasActiveFilters && searchTotal > 0
                ? searchTotal  // Just show the filtered count, not "X of Y"
                : countData.count}
            </Text>
          </RNView>
        )}
        {isRefetching && (
          <ActivityIndicator size="small" color={colors.tint} style={{ marginLeft: spacing.sm }} />
        )}
      </RNView>
      
      {/* View toggle button */}
      <TouchableOpacity
        style={[styles.viewToggleButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
        onPress={() => {
          haptics.light();
          toggleViewMode();
        }}
        activeOpacity={0.7}
      >
        <Ionicons 
          name={isGrid ? 'list-outline' : 'grid-outline'} 
          size={18} 
          color={colors.tint} 
        />
      </TouchableOpacity>
    </RNView>
  ), [colors.text, colors.tint, countData, isRefetching, hasActiveFilters, searchTotal, isGrid, toggleViewMode]);

  const ListEmpty = () => (
    <RNView style={styles.emptyContainer}>
      <RNView style={[styles.emptyIconContainer, { backgroundColor: colors.tint + '15' }]}>
        <Text style={styles.emptyEmoji}>🌍</Text>
      </RNView>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        No recipes found
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        {hasActiveFilters 
          ? 'Try adjusting your filters or search term'
          : 'Be the first to share a recipe with the community!'}
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
        visible={showFilterModal}
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
        visible={showSurpriseModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSurpriseModal(false)}
      >
        <Pressable 
          style={styles.surpriseModalOverlay}
          onPress={() => setShowSurpriseModal(false)}
        >
          <Pressable 
            style={[styles.surpriseModalContent, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
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
                <Text style={styles.surpriseOptionEmoji}>🎲</Text>
                <Text style={[styles.surpriseOptionText, { color: colors.text }]}>
                  Anything! (Fully Random)
                </Text>
              </TouchableOpacity>
              
              <RNView style={[styles.surpriseDivider, { backgroundColor: colors.border }]} />
              
              <TouchableOpacity
                style={[styles.surpriseOption, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleRandomRecipe('breakfast')}
              >
                <Text style={styles.surpriseOptionEmoji}>🌅</Text>
                <Text style={[styles.surpriseOptionText, { color: colors.text }]}>
                  Random Breakfast
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.surpriseOption, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleRandomRecipe('lunch')}
              >
                <Text style={styles.surpriseOptionEmoji}>🥪</Text>
                <Text style={[styles.surpriseOptionText, { color: colors.text }]}>
                  Random Lunch
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.surpriseOption, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleRandomRecipe('dinner')}
              >
                <Text style={styles.surpriseOptionEmoji}>🍽️</Text>
                <Text style={[styles.surpriseOptionText, { color: colors.text }]}>
                  Random Dinner
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.surpriseOption, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleRandomRecipe('snack')}
              >
                <Text style={styles.surpriseOptionEmoji}>🍿</Text>
                <Text style={[styles.surpriseOptionText, { color: colors.text }]}>
                  Random Snack
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.surpriseOption, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => handleRandomRecipe('dessert')}
              >
                <Text style={styles.surpriseOptionEmoji}>🍰</Text>
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
              placeholder="Search recipes or @username..."
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
        
        {/* Discovery Actions Row */}
        <RNView style={styles.discoveryRow}>
          <TouchableOpacity
            style={[styles.discoveryButton, { backgroundColor: colors.warning + '15' }]}
            onPress={() => {
              haptics.light();
              setShowSurpriseModal(true);
            }}
            disabled={isRandomLoading}
            activeOpacity={0.7}
          >
            {isRandomLoading ? (
              <ActivityIndicator size="small" color={colors.warning} />
            ) : (
              <>
                <Ionicons name="shuffle" size={18} color={colors.warning} />
                <Text style={[styles.discoveryButtonText, { color: colors.warning }]}>
                  Surprise Me
                </Text>
              </>
            )}
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.discoveryButton, { backgroundColor: colors.tint + '15' }]}
            onPress={() => {
              haptics.light();
              router.push('/ingredient-search');
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="nutrition-outline" size={18} color={colors.tint} />
            <Text style={[styles.discoveryButtonText, { color: colors.tint }]}>
              What Can I Make?
            </Text>
          </TouchableOpacity>
        </RNView>
        
        {/* @username search suggestions */}
        {usernameSearchMatch && matchingContributors.length > 0 && (
          <RNView style={[styles.usernameSuggestions, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
            <Text style={[styles.usernameSuggestionsHint, { color: colors.textMuted }]}>
              Filter by contributor:
            </Text>
            {matchingContributors.map((contributor) => (
              <TouchableOpacity
                key={contributor.user_id}
                style={[styles.usernameSuggestionItem, { borderColor: colors.border }]}
                onPress={() => {
                  haptics.light();
                  setSelectedExtractor({ id: contributor.user_id, name: contributor.display_name });
                  setSearchQuery('');
                  setDisplayCount(ITEMS_PER_PAGE);
                }}
              >
                <Ionicons name="person-circle-outline" size={20} color={colors.tint} />
                <RNView style={styles.usernameSuggestionInfo}>
                  <Text style={[styles.usernameSuggestionName, { color: colors.text }]}>
                    {contributor.display_name}
                  </Text>
                  <Text style={[styles.usernameSuggestionCount, { color: colors.textMuted }]}>
                    {contributor.recipe_count} recipes
                  </Text>
                </RNView>
              </TouchableOpacity>
            ))}
          </RNView>
        )}
        
        {/* Active filters summary */}
        {activeFilterCount > 0 && (
          <RNView style={styles.activeFiltersRow}>
            {selectedExtractor && (
              <TouchableOpacity 
                style={[styles.activeFilterChip, styles.extractorFilterChip, { backgroundColor: colors.tint }]}
                onPress={clearExtractorFilter}
              >
                <Text style={[styles.activeFilterText, { color: '#FFFFFF' }]}>
                  by {selectedExtractor.name}{searchTotal > 0 ? ` (${searchTotal})` : ''}
                </Text>
                <Ionicons name="close" size={14} color="#FFFFFF" style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            )}
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
                setSelectedExtractor(null);
              }}
            >
              <Text style={[styles.clearFiltersText, { color: colors.textMuted }]}>
                Clear all
              </Text>
            </TouchableOpacity>
          </RNView>
        )}
        
        {/* Search loading indicator - shows when server is fetching more results */}
        {hasTextSearch && isDiscoverSearchFetching && (
          <RNView style={styles.searchLoadingRow}>
            <ActivityIndicator size="small" color={colors.tint} />
            <Text style={[styles.searchLoadingText, { color: colors.textMuted }]}>
              Searching...
            </Text>
          </RNView>
        )}
        
        {/* Top Contributors - hide when searching to reduce clutter */}
        {!hasTextSearch && topContributors && topContributors.length > 0 && (
          <RNView style={styles.contributorsSection}>
            <RNView style={styles.contributorsHeader}>
              <Text style={[styles.contributorsSectionTitle, { color: colors.textMuted }]}>
                Top Contributors
              </Text>
              <TouchableOpacity 
                onPress={() => {
                  haptics.light();
                  setShowAllContributors(true);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.seeAllText, { color: colors.tint }]}>See All</Text>
              </TouchableOpacity>
            </RNView>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.contributorsScroll}
              keyboardShouldPersistTaps="handled"
            >
              {topContributors.map((contributor: { user_id: string; display_name: string; recipe_count: number }) => {
                const isSelected = selectedExtractor?.id === contributor.user_id;
                return (
                  <TouchableOpacity
                    key={contributor.user_id}
                    style={[
                      styles.contributorChip,
                      { 
                        backgroundColor: isSelected ? colors.tint : colors.backgroundSecondary, 
                        borderColor: isSelected ? colors.tint : colors.border 
                      }
                    ]}
                    onPress={() => {
                      haptics.light();
                      if (isSelected) {
                        clearExtractorFilter();
                      } else {
                        setSelectedExtractor({ id: contributor.user_id, name: contributor.display_name });
                        setDisplayCount(ITEMS_PER_PAGE);
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons 
                      name="person-circle-outline" 
                      size={18} 
                      color={isSelected ? '#FFFFFF' : colors.textSecondary} 
                    />
                    <RNView style={styles.contributorInfo}>
                      <Text 
                        style={[
                          styles.contributorName, 
                          { color: isSelected ? '#FFFFFF' : colors.text }
                        ]}
                        numberOfLines={1}
                      >
                        {contributor.display_name}
                      </Text>
                      <Text 
                        style={[
                          styles.contributorCount, 
                          { color: isSelected ? 'rgba(255,255,255,0.8)' : colors.textMuted }
                        ]}
                      >
                        {contributor.recipe_count} recipes
                      </Text>
                    </RNView>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </RNView>
        )}
      </RNView>
      
      {(isLoading || (hasTextSearch && isDiscoverSearchFetching)) && !displayRecipes?.length ? (
        <SkeletonRecipeList count={5} />
      ) : (
        <FlatList
          key={isGrid ? 'grid' : 'list'} // Force re-render when changing layout
          data={displayRecipes}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={isGrid ? 2 : 1}
          columnWrapperStyle={isGrid ? styles.gridRow : undefined}
          ListEmptyComponent={ListEmpty}
          ListFooterComponent={ListFooter}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl + (isSignedIn ? 0 : 100) }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
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
      
      {/* All Contributors Modal */}
      <AllContributorsModal
        visible={showAllContributors}
        onClose={() => setShowAllContributors(false)}
        onSelectContributor={(contributor) => {
          setSelectedExtractor({ id: contributor.user_id, name: contributor.display_name });
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
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  titleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontFamily: fontFamily.bold,
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
  discoveryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  discoveryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    gap: spacing.xs,
  },
  discoveryButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
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
  extractorFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
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
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  sortLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    gap: 4,
  },
  sortChipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    gap: 4,
  },
  actionButtonText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
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
  contributorsSection: {
    marginTop: spacing.md,
  },
  contributorsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  contributorsSectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  seeAllText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  // @username suggestions
  usernameSuggestions: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  usernameSuggestionsHint: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
  },
  usernameSuggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
  },
  usernameSuggestionInfo: {
    flex: 1,
  },
  usernameSuggestionName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  usernameSuggestionCount: {
    fontSize: fontSize.xs,
  },
  contributorsScroll: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  contributorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
  },
  contributorInfo: {
    maxWidth: 100,
  },
  contributorName: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  contributorCount: {
    fontSize: 10,
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
    // Subtle shadow for depth
    ...shadows.card,
  },
  // Grid view styles
  gridRow: {
    justifyContent: 'space-between',
    gap: GRID_GAP,
  },
  gridCard: {
    width: GRID_CARD_WIDTH,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    borderWidth: 1,
    ...shadows.card,
  },
  gridThumbnailContainer: {
    width: '100%',
    aspectRatio: 0.85, // Taller cards for overlay text
    position: 'relative',
  },
  gridOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '45%', // Shorter, more subtle
  },
  gridThumbnail: {
    width: '100%',
    height: '100%',
  },
  gridPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridTimeBadge: {
    position: 'absolute',
    bottom: spacing.xs,
    left: spacing.xs,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  gridSaveButtonContainer: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: radius.full,
    padding: spacing.xs,
  },
  gridTimeText: {
    color: '#FFFFFF',
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
  },
  gridCardContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.sm,
    paddingTop: spacing.lg,
  },
  gridCardTitle: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    lineHeight: 18,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  gridCardAuthor: {
    fontSize: fontSize.xs,
    marginTop: 4,
    color: 'rgba(255, 255, 255, 0.85)',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  viewToggleButton: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailContainer: {
    position: 'relative',
    overflow: 'hidden',
  },
  thumbnail: {
    width: 110,
    height: 130,
  },
  thumbnailOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
  },
  placeholderThumbnail: {
    width: 110,
    height: 130,
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
    fontFamily: fontFamily.semibold,
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
  attributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
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
  emptyEmoji: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.semibold,
    marginBottom: spacing.sm,
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
    fontFamily: fontFamily.semibold,
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
  surpriseOptionEmoji: {
    fontSize: 24,
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

