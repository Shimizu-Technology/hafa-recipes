import { useState, useCallback } from 'react';
import {
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  View as RNView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/clerk-expo';

import { View, Text, Input, Chip, useColors } from '@/components/Themed';
import { 
  useDiscoverRecipes, 
  useSearchPublicRecipes, 
  usePublicRecipeCount,
  useIsRecipeSaved,
  useSaveRecipe,
  useUnsaveRecipe,
} from '@/hooks/useRecipes';
import { RecipeListItem } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

const ITEMS_PER_PAGE = 20;

// Source filter options
const SOURCE_FILTERS = [
  { key: 'all', label: 'All', icon: 'apps-outline' },
  { key: 'tiktok', label: 'TikTok', icon: 'logo-tiktok' },
  { key: 'youtube', label: 'YouTube', icon: 'logo-youtube' },
  { key: 'instagram', label: 'Instagram', icon: 'logo-instagram' },
  { key: 'manual', label: 'Manual', icon: 'create-outline' },
] as const;

type SourceFilter = typeof SOURCE_FILTERS[number]['key'];

// Save/Bookmark button component
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
  
  // Don't show save button for own recipes
  if (isOwner) return null;
  
  const isSaved = savedStatus?.is_saved ?? false;
  const isPending = saveMutation.isPending || unsaveMutation.isPending;
  
  const handlePress = () => {
    if (isPending) return;
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
      <Ionicons 
        name={isSaved ? "heart" : "heart-outline"} 
        size={22} 
        color={isSaved ? colors.error : colors.textMuted} 
      />
    </TouchableOpacity>
  );
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

  return (
    <TouchableOpacity 
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} 
      onPress={onPress} 
      activeOpacity={0.7}
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
    </TouchableOpacity>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  
  // Pass source filter to server-side queries
  const sourceTypeParam = sourceFilter === 'all' ? undefined : sourceFilter;
  
  const { data: recipes, isLoading, refetch, isRefetching } = useDiscoverRecipes(50, 0, sourceTypeParam);
  const { data: searchResults } = useSearchPublicRecipes(searchQuery, sourceTypeParam);
  const { data: countData } = usePublicRecipeCount(sourceTypeParam);

  // Use search results or recipes from server (already filtered)
  const filteredRecipes = searchQuery.length > 0 ? searchResults : recipes;

  const displayRecipes = filteredRecipes?.slice(0, displayCount);
  const hasMore = filteredRecipes && displayCount < filteredRecipes.length;

  const handleRefresh = useCallback(() => {
    setDisplayCount(ITEMS_PER_PAGE);
    refetch();
  }, [refetch]);

  const handleLoadMore = () => {
    if (hasMore) {
      setDisplayCount(prev => prev + ITEMS_PER_PAGE);
    }
  };

  const renderItem = ({ item }: { item: RecipeListItem }) => (
    <RecipeCard
      recipe={item}
      colors={colors}
      onPress={() => router.push(`/recipe/${item.id}`)}
      currentUserId={userId}
    />
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
    </RNView>
  ), [colors.text, colors.tint, countData]);

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
    
    return (
      <RNView style={styles.footerContainer}>
        <TouchableOpacity 
          style={[styles.loadMoreButton, { borderColor: colors.border }]}
          onPress={handleLoadMore}
          activeOpacity={0.7}
        >
          <Text style={[styles.loadMoreText, { color: colors.text }]}>
            Load More ({filteredRecipes ? filteredRecipes.length - displayCount : 0} remaining)
          </Text>
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </RNView>
    );
  };

  return (
    <View style={styles.container}>
      {/* Fixed header with search - outside FlatList to prevent focus loss */}
      <RNView style={styles.header}>
        <ListHeaderTitle />
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Browse recipes shared by the community
        </Text>
        <Input
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search public recipes..."
        />
        
        {/* Source filters */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterContainer}
        >
          {SOURCE_FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter.key}
              onPress={() => {
                setSourceFilter(filter.key);
                setDisplayCount(ITEMS_PER_PAGE);
              }}
              style={[
                styles.filterChip,
                {
                  backgroundColor: sourceFilter === filter.key ? colors.tint : colors.backgroundSecondary,
                  borderColor: sourceFilter === filter.key ? colors.tint : colors.border,
                },
              ]}
            >
              <Ionicons
                name={filter.icon as any}
                size={16}
                color={sourceFilter === filter.key ? '#FFFFFF' : colors.textMuted}
              />
              <Text
                style={[
                  styles.filterChipText,
                  { color: sourceFilter === filter.key ? '#FFFFFF' : colors.text },
                ]}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </RNView>
      
      <FlatList
        data={displayRecipes}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={!isLoading ? ListEmpty : null}
        ListFooterComponent={ListFooter}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl 
            refreshing={isRefetching} 
            onRefresh={handleRefresh}
            tintColor={colors.tint}
          />
        }
      />
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
  filterScroll: {
    marginTop: spacing.md,
    marginHorizontal: -spacing.lg,
  },
  filterContainer: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: fontSize.sm,
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
});

