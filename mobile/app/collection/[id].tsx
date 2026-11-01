import { fontFamily } from '@/constants/Colors';
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
  useWindowDimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Button, useColors } from '@/components/Themed';
import CreateCollectionModal from '@/components/CreateCollectionModal';
import { HeaderIconButton, headerRightOptions } from '@/components/chrome/HeaderButton';
import { useCollectionRecipes, useCollections, useRemoveFromCollection } from '@/hooks/useCollections';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { CollectionRecipe, Collection } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';
import { getRecipeSourcePresentation } from '@/lib/recipeSource';
import { AnimatedListItem, ScalePressable } from '@/components/Animated';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { recipeCardAccessibilityLabel } from '@/lib/recipeCardLabel';

const GRID_GAP = 12;

/** Collection photo grid: 2 columns (1 at large text), like the Library grid, with time and servings. */
function useCardWidth() {
  const { width, fontScale } = useWindowDimensions();
  const content = Math.min(width, 720) - 32;
  return fontScale >= 1.3 ? content : (content - GRID_GAP) / 2;
}

/** Render a recipe card within a collection. */
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
  const { label: sourceLabel } = getRecipeSourcePresentation(recipe.source_type);
  const width = useCardWidth();
  const facts = [
    recipe.total_time ? { icon: 'time-outline' as const, text: recipe.total_time } : null,
    recipe.servings ? { icon: 'people-outline' as const, text: String(recipe.servings) } : null,
  ].filter(Boolean) as { icon: 'time-outline' | 'people-outline'; text: string }[];

  return (
    <RNView style={[styles.card, { width }]}>
      <ScalePressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={recipeCardAccessibilityLabel({
          title: recipe.title,
          reviewState: recipe.review_state,
          totalTime: recipe.total_time,
          servings: recipe.servings,
          sourceLabel,
        })}
        // The card groups its children for VoiceOver, so expose Remove as an action.
        accessibilityActions={[{ name: 'remove', label: 'Remove from collection' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'remove') onRemove();
        }}
      >
        <RecipeThumbnail
          uri={recipe.thumbnail_url}
          style={[styles.thumbnail, { backgroundColor: colors.surface2 }]}
          accessibilityLabel={`${recipe.title} photo`}
        />
        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
          {recipe.title}
        </Text>
        <RNView style={styles.metaRow}>
          {facts.length ? facts.map((fact) => (
            <RNView key={fact.icon} style={styles.metaItem}>
              <Ionicons name={fact.icon} size={14} color={colors.textSecondary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>{fact.text}</Text>
            </RNView>
          )) : <Text style={[styles.metaText, { color: colors.textSecondary }]}>{sourceLabel}</Text>}
        </RNView>
      </ScalePressable>
      {/* A solid circle stays readable on any photo; Remove still asks first. */}
      <TouchableOpacity
        style={styles.removeButton}
        onPress={onRemove}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${recipe.title} from collection`}
      >
        <RNView style={styles.removeCircle}>
          <Ionicons name="close" size={16} color="#1C1C1E" />
        </RNView>
      </TouchableOpacity>
    </RNView>
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
  const largeText = useWindowDimensions().fontScale >= 1.3;

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
    router.replace('/history');
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
        <Stack.Screen options={{ headerLargeTitleEnabled: true, headerLargeTitleStyle: { fontFamily: fontFamily.display, color: colors.text, fontSize: 32 }, headerTitle: 'Collection' }} />
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
          headerTitle: collection.name, headerLargeTitleEnabled: true, headerLargeTitleStyle: { fontFamily: fontFamily.display, color: colors.text, fontSize: 32 },
          ...headerRightOptions(() => <HeaderIconButton icon="ellipsis-horizontal" accessibilityLabel="Collection options" onPress={() => setShowEditModal(true)} />),
        }}
      />

      {/* Edit Collection Modal */}
      <CreateCollectionModal
        visible={showEditModal}
        onClose={() => setShowEditModal(false)}
        editingCollection={collection}
        onDeleted={leaveCollection}
      />

      <FlatList contentInsetAdjustmentBehavior="automatic"
        key={largeText ? 'list' : 'grid'}
        data={recipes}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        numColumns={largeText ? 1 : 2}
        columnWrapperStyle={largeText ? undefined : styles.gridRow}
        // Inside the list so the count scrolls with the photos instead of sitting under the large title.
        ListHeaderComponent={<>
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
        </>}
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
    paddingVertical: spacing.sm,
  },
  countText: {
    fontSize: fontSize.sm,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: spacing.xxl,
  },
  gridRow: {
    gap: GRID_GAP,
  },
  card: {
    marginBottom: 20,
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
  },
  cardTitle: {
    marginTop: 8,
    fontSize: 16,
    fontFamily: fontFamily.displaySemibold,
    lineHeight: 21,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    marginTop: 2,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 13,
    lineHeight: 18,
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  removeCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 2,
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
