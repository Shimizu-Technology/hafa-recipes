import { useState, useCallback } from 'react';
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
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Input, Chip, Button, useColors } from '@/components/Themed';
import { useRecipes, useSearchRecipes, useRecipeCount } from '@/hooks/useRecipes';
import { RecipeListItem } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

const ITEMS_PER_PAGE = 20;

function RecipeCard({ 
  recipe, 
  onPress,
  colors,
}: { 
  recipe: RecipeListItem; 
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const sourceIcon = recipe.source_type === 'tiktok' 
    ? 'logo-tiktok' 
    : recipe.source_type === 'youtube' 
      ? 'logo-youtube' 
      : recipe.source_type === 'instagram' 
        ? 'logo-instagram' 
        : 'globe-outline';

  return (
    <TouchableOpacity 
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} 
      onPress={onPress} 
      activeOpacity={0.7}
    >
      {/* Thumbnail */}
      {recipe.thumbnail_url ? (
        <Image source={{ uri: recipe.thumbnail_url }} style={styles.thumbnail} />
      ) : (
        <RNView style={[styles.placeholderThumbnail, { backgroundColor: colors.tint + '15' }]}>
          <Ionicons name="restaurant-outline" size={32} color={colors.tint} />
        </RNView>
      )}
      
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

export default function HistoryScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
  
  const { data: recipes, isLoading, refetch, isRefetching } = useRecipes();
  const { data: searchResults } = useSearchRecipes(searchQuery);
  const { data: countData } = useRecipeCount();

  const allRecipes = searchQuery.length > 0 ? searchResults : recipes;
  const displayRecipes = allRecipes?.slice(0, displayCount);
  const hasMore = allRecipes && displayCount < allRecipes.length;

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
    />
  );

  const ListHeader = () => (
    <RNView style={styles.header}>
      {/* Title */}
      <RNView style={styles.titleRow}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          My Recipes
        </Text>
        {countData && (
          <RNView style={[styles.countBadge, { backgroundColor: colors.tint }]}>
            <Text style={styles.countText}>{countData.count}</Text>
          </RNView>
        )}
      </RNView>
      
      {/* Search */}
      <Input
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Search recipes..."
      />
    </RNView>
  );

  const ListEmpty = () => (
    <RNView style={styles.emptyContainer}>
      <Ionicons name="restaurant-outline" size={64} color={colors.textMuted} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        No recipes yet
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        Extract your first recipe from the home screen!
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
            Load More ({allRecipes ? allRecipes.length - displayCount : 0} remaining)
          </Text>
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </RNView>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={displayRecipes}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeader}
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
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.lg,
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
});
