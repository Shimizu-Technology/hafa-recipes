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
  Keyboard,
  TouchableWithoutFeedback,
  Dimensions,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Input, Chip, Button, useColors } from '@/components/Themed';
import { SignInBanner } from '@/components/SignInBanner';
import FilterBottomSheet, { FilterState, SourceFilter, TimeFilter, OwnershipFilter } from '@/components/FilterBottomSheet';
import CreateCollectionModal from '@/components/CreateCollectionModal';
import BulkAddToCollectionModal from '@/components/BulkAddToCollectionModal';
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
import { spacing, fontSize, fontWeight, radius, shadows, fontFamily } from '@/constants/Colors';
import Colors from '@/constants/Colors';
import { haptics } from '@/utils/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_PADDING = spacing.lg; // 24px on each side
const GRID_GAP = spacing.sm; // Gap between cards
const GRID_CARD_WIDTH = (SCREEN_WIDTH - (GRID_PADDING * 2) - GRID_GAP) / 2;
import { useAuth } from '@clerk/clerk-expo';
import { useViewPreference } from '@/hooks/useViewPreference';

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
        : recipe.source_type === 'website'
          ? 'globe-outline' 
        : recipe.source_type === 'manual'
          ? 'create-outline'
          : 'globe-outline';

  const showPlaceholder = !recipe.thumbnail_url || imageError;

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

// Grid recipe card - square image with title overlay
function GridRecipeCard({ 
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
  const showPlaceholder = !recipe.thumbnail_url || imageError;

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
        {/* Saved badge */}
        {isSavedRecipe && (
          <RNView style={[styles.gridSavedBadge, { backgroundColor: colors.error }]}>
            <Ionicons name="heart" size={12} color="#FFFFFF" />
          </RNView>
        )}
        {/* Cook time badge */}
        {recipe.total_time && (
          <RNView style={[styles.gridTimeBadge, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
            <Ionicons name="time-outline" size={10} color="#FFFFFF" />
            <Text style={styles.gridTimeText}>{recipe.total_time}</Text>
          </RNView>
        )}
        
        {/* Subtle gradient overlay at bottom for text readability */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.7)']}
          style={styles.gridOverlay}
        />
        
        {/* Title overlaid on image */}
        <RNView style={styles.gridCardContent}>
          <Text style={styles.gridCardTitle} numberOfLines={2}>
            {recipe.title}
          </Text>
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
    (ownershipFilter !== 'all' ? 1 : 0); // Count ownership filter if not "all"
  
  // Derived booleans for ownership filter
  const showSavedRecipes = ownershipFilter === 'all' || ownershipFilter === 'saved';
  const showOwnRecipes = ownershipFilter === 'all' || ownershipFilter === 'own';
  
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

  const isLoading = (showOwnRecipes && isLoadingRecipes) || (showSavedRecipes && isLoadingSaved);
  const isRefetching = (showOwnRecipes && isRefetchingRecipes) || (showSavedRecipes && isRefetchingSaved);
  
  const handleRefreshAll = useCallback(() => {
    if (showOwnRecipes) refetchRecipes();
    if (showSavedRecipes) refetchSaved();
  }, [refetchRecipes, refetchSaved, showOwnRecipes, showSavedRecipes]);

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

  // Combine own recipes with saved recipes based on ownership filter
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
  }, [recipes, searchResults, savedRecipes, ownershipFilter, hasActiveFilters, sourceTypeParam, currentFilters]);

  // Calculate total count based on ownership filter
  const totalCount = useMemo(() => {
    if (ownershipFilter === 'saved') {
      return savedRecipes?.length ?? 0;
    } else if (ownershipFilter === 'own') {
      return recipesTotal;
    } else {
      return recipesTotal + (savedRecipes?.length ?? 0);
    }
  }, [ownershipFilter, recipesTotal, savedRecipes]);

  // For display, slice to current page
  const displayRecipes = combinedRecipes?.slice(0, displayCount);
  
  // Determine if there's more to load - either from server or locally
  const hasMoreLocal = combinedRecipes && displayCount < combinedRecipes.length;
  // hasMoreServer depends on ownership filter
  const hasMoreServer = useMemo(() => {
    if (ownershipFilter === 'saved') {
      return hasMoreSaved; // Only check saved when in "Saved Only" mode
    } else if (ownershipFilter === 'own') {
      return hasActiveFilters ? hasMoreSearchResults : hasMoreRecipes; // Only check own recipes
    } else {
      // "all" mode - check both
      return (hasActiveFilters ? hasMoreSearchResults : hasMoreRecipes) || hasMoreSaved;
    }
  }, [ownershipFilter, hasMoreSaved, hasMoreRecipes, hasMoreSearchResults, hasActiveFilters]);
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
      if (showSavedRecipes && hasMoreSaved) {
        fetchNextSaved();
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
      setSelectedRecipeIds(new Set(displayRecipes.map(r => r.id)));
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
        <AnimatedListItem index={index} delay={40}>
          <TouchableOpacity
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={400}
            activeOpacity={0.9}
            style={styles.gridCardWrapper}
          >
            <CardComponent
              recipe={item}
              colors={colors}
              onPress={handlePress}
              isSavedRecipe={showSavedBadge}
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
      <AnimatedListItem index={index} delay={40}>
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
            >
              <CardComponent
                recipe={item}
                colors={colors}
                onPress={handlePress}
                isSavedRecipe={showSavedBadge}
              />
            </TouchableOpacity>
          </RNView>
        </RNView>
      </AnimatedListItem>
    );
  };

  // Header overflow menu handler
  const handleShowHeaderMenu = useCallback(() => {
    haptics.light();
    Alert.alert(
      'Options',
      undefined,
      [
        {
          text: isGrid ? 'Switch to List View' : 'Switch to Grid View',
          onPress: () => {
            haptics.light();
            toggleViewMode();
          },
        },
        {
          text: 'Select Recipes',
          onPress: () => enterSelectionMode(),
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  }, [isGrid, toggleViewMode, enterSelectionMode]);

  // Memoize header to prevent re-render on search change
  const ListHeaderTitle = useCallback(() => {
    // Selection mode header
    if (isSelectionMode) {
      return (
        <RNView style={styles.titleRow}>
          <RNView style={styles.titleLeft}>
            <TouchableOpacity onPress={exitSelectionMode} style={styles.cancelButton}>
              <Text style={[styles.cancelButtonText, { color: colors.tint }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.selectionCount, { color: colors.text }]}>
              {selectedRecipeIds.size} selected
            </Text>
          </RNView>
          
          <RNView style={styles.headerActions}>
            <TouchableOpacity
              style={[styles.selectAllButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
              onPress={selectedRecipeIds.size === displayRecipes?.length ? clearSelection : selectAllRecipes}
              activeOpacity={0.7}
            >
              <Text style={[styles.selectAllText, { color: colors.tint }]}>
                {selectedRecipeIds.size === displayRecipes?.length ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          </RNView>
        </RNView>
      );
    }
    
    // Normal header - clean two-row design
    return (
      <RNView>
        {/* Title row */}
        <RNView style={styles.titleRow}>
          <RNView style={styles.titleLeft}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              My Recipes
            </Text>
            {totalCount !== undefined && (
              <RNView style={[styles.countBadge, { backgroundColor: colors.tint }]}>
                <Text style={styles.countText}>
                  {hasActiveFilters && combinedRecipes 
                    ? `${combinedRecipes.length} of ${totalCount}`
                    : totalCount}
                </Text>
              </RNView>
            )}
            {isRefetching && (
              <ActivityIndicator size="small" color={colors.tint} style={{ marginLeft: spacing.sm }} />
            )}
          </RNView>
          
          {/* Overflow menu */}
          <TouchableOpacity
            style={[styles.headerMenuButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
            onPress={handleShowHeaderMenu}
            activeOpacity={0.7}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.tint} />
          </TouchableOpacity>
        </RNView>
        
        {/* Subtitle row with "What can I make?" */}
        <TouchableOpacity
          style={[styles.ingredientSearchButton, { backgroundColor: colors.tint + '15' }]}
          onPress={() => {
            haptics.light();
            router.push('/ingredient-search');
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="nutrition-outline" size={18} color={colors.tint} />
          <Text style={[styles.ingredientSearchText, { color: colors.tint }]}>
            What can I make?
          </Text>
        </TouchableOpacity>
      </RNView>
    );
  }, [colors, totalCount, isRefetching, router, hasActiveFilters, combinedRecipes, isSelectionMode, selectedRecipeIds.size, displayRecipes?.length, exitSelectionMode, selectAllRecipes, clearSelection, handleShowHeaderMenu]);

  const ListEmpty = () => (
    <RNView style={styles.emptyContainer}>
      <RNView style={[styles.emptyIconContainer, { backgroundColor: colors.tint + '15' }]}>
        <Text style={styles.emptyEmoji}>🍳</Text>
      </RNView>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        No recipes yet
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        Start building your recipe collection!
      </Text>
      <TouchableOpacity
        style={[styles.emptyButton, { backgroundColor: colors.tint }]}
        onPress={() => router.push('/(tabs)')}
        activeOpacity={0.8}
      >
        <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
        <Text style={styles.emptyButtonText}>Add Your First Recipe</Text>
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
        initialFilters={{ sourceFilter, timeFilter, selectedTags }}
        popularTags={popularTags}
        showOwnershipFilter
        ownershipFilter={ownershipFilter}
        onOwnershipFilterChange={setOwnershipFilter}
      />
      
      {/* Create Collection Modal */}
      <CreateCollectionModal
        visible={showCreateCollectionModal}
        onClose={() => setShowCreateCollectionModal(false)}
      />
      
      {/* Bulk Add to Collection Modal */}
      <BulkAddToCollectionModal
        visible={showBulkAddModal}
        onClose={() => setShowBulkAddModal(false)}
        recipeIds={Array.from(selectedRecipeIds)}
        onComplete={handleBulkAddComplete}
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
            {ownershipFilter === 'own' && (
              <RNView style={[styles.activeFilterChip, { backgroundColor: colors.tint + '20' }]}>
                <Text style={[styles.activeFilterText, { color: colors.tint }]}>
                  My Recipes
                </Text>
              </RNView>
            )}
            {ownershipFilter === 'saved' && (
              <RNView style={[styles.activeFilterChip, { backgroundColor: colors.error + '20' }]}>
                <Text style={[styles.activeFilterText, { color: colors.error }]}>
                  Saved Only
                </Text>
              </RNView>
            )}
            <TouchableOpacity
              onPress={() => {
                setSourceFilter('all');
                setTimeFilter('all');
                setSelectedTags([]);
                setOwnershipFilter('all');
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
        
        {/* Collections row - show skeleton while loading, or real content */}
        {isLoadingCollections ? (
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
              <SkeletonCollectionList count={3} />
            </ScrollView>
          </RNView>
        ) : collections && collections.length > 0 ? (
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
        ) : null}
        
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
          key={isGrid ? 'grid' : 'list'} // Force re-render when changing layout
          data={displayRecipes}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={isGrid ? 2 : 1}
          columnWrapperStyle={isGrid ? styles.gridRow : undefined}
          ListEmptyComponent={ListEmpty}
          ListFooterComponent={ListFooter}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl + 80 }]}
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
              <Text style={styles.addToCollectionButtonText}>Add to Collection</Text>
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
    marginBottom: spacing.md,
  },
  titleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ingredientSearchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    gap: spacing.xs,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  ingredientSearchText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontFamily: fontFamily.bold,
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
    // Subtle shadow for depth
    ...shadows.card,
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
  savedBadge: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    borderRadius: radius.full,
    padding: 4,
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
    height: '40%', // Shorter, more subtle (no author line)
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
  gridSavedBadge: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    borderRadius: radius.full,
    padding: 5,
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
    paddingTop: spacing.md,
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
  // Header action buttons
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  viewToggleButton: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    marginBottom: spacing.lg,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
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
  // Header menu button
  headerMenuButton: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
