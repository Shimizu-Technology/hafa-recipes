/**
 * Collection detail screen - shows all recipes in a collection.
 */

import { useState, useCallback } from 'react';
import {
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  View as RNView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, useColors } from '@/components/Themed';
import CreateCollectionModal from '@/components/CreateCollectionModal';
import { useCollectionRecipes, useCollections, useRemoveFromCollection } from '@/hooks/useCollections';
import { CollectionRecipe, Collection } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';
import { AnimatedListItem, ScalePressable } from '@/components/Animated';

function RecipeCard({
  recipe,
  onPress,
  onRemove,
  colors,
}: {
  recipe: CollectionRecipe;
  onPress: () => void;
  onRemove: () => void;
  colors: ReturnType<typeof useColors>;
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

        {/* Footer */}
        <RNView style={styles.cardFooter}>
          <RNView style={styles.sourceRow}>
            <Ionicons name={sourceIcon as any} size={14} color={colors.textMuted} />
            <Text style={[styles.sourceText, { color: colors.textMuted }]}>
              {recipe.source_type}
            </Text>
          </RNView>
          
          {/* Remove button */}
          <TouchableOpacity
            style={[styles.removeButton, { backgroundColor: colors.error + '15' }]}
            onPress={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={14} color={colors.error} />
          </TouchableOpacity>
        </RNView>
      </RNView>
    </ScalePressable>
  );
}

export default function CollectionDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  
  const [showEditModal, setShowEditModal] = useState(false);
  
  // Get collection details
  const { data: collections } = useCollections();
  const collection = collections?.find(c => c.id === id);
  
  // Get recipes in collection
  const { 
    data: recipes, 
    isLoading, 
    refetch, 
    isRefetching 
  } = useCollectionRecipes(id || '');
  
  const removeFromCollection = useRemoveFromCollection();
  
  const handleRemoveRecipe = useCallback((recipeId: string, recipeTitle: string) => {
    Alert.alert(
      'Remove from Collection',
      `Remove "${recipeTitle}" from this collection?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeFromCollection.mutate({ collectionId: id!, recipeId });
          },
        },
      ]
    );
  }, [id, removeFromCollection]);
  
  const renderItem = ({ item, index }: { item: CollectionRecipe; index: number }) => (
    <AnimatedListItem index={index} delay={40}>
      <RecipeCard
        recipe={item}
        colors={colors}
        onPress={() => {
          haptics.light();
          router.push(`/recipe/${item.id}`);
        }}
        onRemove={() => {
          haptics.warning();
          handleRemoveRecipe(item.id, item.title);
        }}
      />
    </AnimatedListItem>
  );
  
  const ListEmpty = () => (
    <RNView style={styles.emptyContainer}>
      <Ionicons name="folder-open-outline" size={64} color={colors.textMuted} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        No recipes yet
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        Add recipes to this collection from the recipe detail page
      </Text>
    </RNView>
  );
  
  if (!collection) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerTitle: 'Collection' }} />
        <RNView style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </RNView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerTitle: `${collection.emoji || '📁'} ${collection.name}`,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setShowEditModal(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="ellipsis-horizontal" size={24} color={colors.tint} />
            </TouchableOpacity>
          ),
        }}
      />
      
      {/* Edit Collection Modal */}
      <CreateCollectionModal
        visible={showEditModal}
        onClose={() => setShowEditModal(false)}
        editingCollection={collection}
        onDeleted={() => router.back()}
      />
      
      {/* Recipe count header */}
      <RNView style={styles.header}>
        <Text style={[styles.countText, { color: colors.textSecondary }]}>
          {recipes?.length || 0} recipe{(recipes?.length || 0) !== 1 ? 's' : ''}
        </Text>
      </RNView>
      
      <FlatList
        data={recipes}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={!isLoading ? ListEmpty : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  countText: {
    fontSize: fontSize.sm,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
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
    height: 100,
  },
  placeholderThumbnail: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
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
  removeButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
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
    paddingHorizontal: spacing.xl,
  },
});

