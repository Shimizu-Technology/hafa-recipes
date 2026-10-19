/**
 * Collection detail screen - shows all recipes in a collection.
 */

import { useState, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useAuth } from '@clerk/expo';
import {
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  View as RNView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Button, useColors } from '@/components/Themed';
import CreateCollectionModal from '@/components/CreateCollectionModal';
import { useCollectionRecipes, useCollections, useRemoveFromCollection } from '@/hooks/useCollections';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { CollectionRecipe, Collection } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';
import { getRecipeSourcePresentation } from '@/lib/recipeSource';
import { AnimatedListItem, ScalePressable } from '@/components/Animated';
import { RecipeTrustBadge } from '@/components/RecipeTrustBadge';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { recipeCardAccessibilityLabel } from '@/lib/recipeCardLabel';

/** Render a recipe row within a collection. */
export function RecipeCard({
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
  const { icon: sourceIcon, label: sourceLabel } = getRecipeSourcePresentation(recipe.source_type);

  return (
    <ScalePressable
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={recipeCardAccessibilityLabel(recipe.title, [recipe.total_time])}
      // The card groups its children for VoiceOver, so expose Remove as an action.
      accessibilityActions={[{ name: 'remove', label: 'Remove from collection' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'remove') onRemove();
      }}
    >
      {/* Thumbnail */}
      <RecipeThumbnail
        uri={recipe.thumbnail_url}
        style={styles.thumbnail}
        accessibilityLabel={`${recipe.title} photo`}
      />

      {/* Content */}
      <RNView style={styles.cardContent}>
        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
          {recipe.title}
        </Text>
        {recipe.review_state && recipe.review_state !== 'ready' && (
          <RNView style={styles.trustBadge}>
            <RecipeTrustBadge reviewState={recipe.review_state} />
          </RNView>
        )}

        {/* Meta info */}
        <RNView style={styles.metaRow}>
          {recipe.total_time && (
            <RNView style={styles.metaItem}>
              <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>{recipe.total_time}</Text>
            </RNView>
          )}
          {recipe.servings && (
            <RNView style={styles.metaItem}>
              <Ionicons name="people-outline" size={13} color={colors.textSecondary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>{recipe.servings}</Text>
            </RNView>
          )}
        </RNView>

        {/* Footer */}
        <RNView style={styles.cardFooter}>
          <RNView style={styles.sourceRow}>
            <Ionicons name={sourceIcon as any} size={14} color={colors.textMuted} />
            <Text style={[styles.sourceText, { color: colors.textMuted }]}>
              {sourceLabel}
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
            accessibilityRole="button"
            accessibilityLabel={`Remove ${recipe.title} from collection`}
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
  const { id: idParam } = useLocalSearchParams<{ id: string | string[] }>();
  const id = typeof idParam === 'string' && idParam.trim() ? idParam : '';
  const { userId } = useAuth();
  const committedScope = useMemo(() => ({ userId, id }), [userId, id]);
  const scope = useRef<typeof committedScope | null>(null);
  useLayoutEffect(() => {
    scope.current = committedScope;
    return () => { if (scope.current === committedScope) scope.current = null; };
  }, [committedScope]);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [showEditModal, setShowEditModal] = useState(false);

  // Get collection details
  const collectionsQuery = useCollections(!!id);
  const { data: collections } = collectionsQuery;
  const collection = collections?.find(c => c.id === id);

  // Get recipes in collection
  const {
    data: recipes,
    isLoading,
    isError,
    refetch,
    isRefetching
  } = useCollectionRecipes(id, !!collection);
  const { isPullRefreshing, onPullRefresh } = usePullToRefresh(
    () => Promise.all([collectionsQuery.refetch(), refetch()]),
  );

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
            if (scope.current !== committedScope) return;
            removeFromCollection.mutate({ collectionId: id, recipeId }, {
              onError: () => {
                if (scope.current === committedScope) {
                  Alert.alert('Couldn’t remove recipe', 'Refresh this collection and try again. Your recipe remains in your library.');
                }
              },
            });
          },
        },
      ]
    );
  }, [id, userId, removeFromCollection, committedScope]);

  const leaveCollection = () => {
    router.replace('/(tabs)/history');
  };

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
          {id && collectionsQuery.isLoading ? <ActivityIndicator size="large" color={colors.actionText} /> : (
            <>
              <Text style={[styles.emptyTitle, { color: colors.text }]} accessibilityRole="alert">
                {id && collectionsQuery.isError ? 'Couldn’t load this collection' : 'Collection unavailable'}
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                {id && collectionsQuery.isError ? 'Check your connection and try again.' : 'It may have been deleted or belong to another account.'}
              </Text>
              {id && collectionsQuery.isError && <Button title={collectionsQuery.isFetching ? 'Trying again…' : 'Try again'}
                disabled={collectionsQuery.isFetching} onPress={() => { void collectionsQuery.refetch(); }} />}
              <Button title="Back to library" onPress={leaveCollection} variant="outline" />
            </>
          )}
        </RNView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerTitle: collection.name,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setShowEditModal(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="ellipsis-horizontal" size={24} color={colors.actionText} />
            </TouchableOpacity>
          ),
        }}
      />

      {/* Edit Collection Modal */}
      <CreateCollectionModal
        visible={showEditModal}
        onClose={() => setShowEditModal(false)}
        editingCollection={collection}
        onDeleted={leaveCollection}
      />

      {/* Recipe count header */}
      <RNView style={styles.header}>
        <Text style={[styles.countText, { color: colors.textSecondary }]}>
          {recipes !== undefined ? `${recipes.length} recipe${recipes.length !== 1 ? 's' : ''}` : 'Recipes'}
        </Text>
        {(collectionsQuery.isError || isError) && (
          <RNView accessibilityRole="alert">
            <Text style={{ color: colors.textSecondary }}>
              {isError && !recipes ? 'Couldn’t load these recipes.' : 'Couldn’t refresh this collection. Your last loaded data is still shown.'}
            </Text>
            <Button title={isRefetching || collectionsQuery.isFetching ? 'Trying again…' : 'Try again'}
              disabled={isRefetching || collectionsQuery.isFetching}
              onPress={() => { void collectionsQuery.refetch(); void refetch(); }} />
          </RNView>
        )}
        {isLoading && !recipes && <ActivityIndicator size="large" color={colors.actionText} />}
      </RNView>

      <FlatList
        data={recipes}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={!isLoading && !isError ? ListEmpty : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={onPullRefresh}
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
  trustBadge: {
    marginTop: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
