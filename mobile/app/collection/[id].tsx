import { RECIPE_GRID_GAP, RecipeGridCardFrame } from '@/components/RecipeGridCardFrame';
/**
 * Collection detail screen - shows all recipes in a collection.
 */

import { useAuth } from '@clerk/expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, RefreshControl, View as RNView, StyleSheet, TouchableOpacity, useWindowDimensions, } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedListItem } from '@/components/Animated';
import CreateCollectionModal from '@/components/CreateCollectionModal';
import { Button, Text, useColors, View } from '@/components/Themed';
import { fontSize, fontWeight, spacing } from '@/constants/Colors';
import { useCollectionRecipes, useCollections, useRemoveFromCollection } from '@/hooks/useCollections';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { recipeCardAccessibilityLabel } from '@/lib/recipeCardLabel';
import { getRecipeSourcePresentation } from '@/lib/recipeSource';
import { CollectionRecipe } from '@/types/recipe';
import { haptics } from '@/utils/haptics';

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
  const sourceLabel = getRecipeSourcePresentation(recipe.source_type).label;
  const card = <RecipeGridCardFrame title={recipe.title} thumbnailUrl={recipe.thumbnail_url} colors={colors} onPress={onPress}
    accessibilityLabel={recipeCardAccessibilityLabel({ title: recipe.title, reviewState: recipe.review_state, totalTime: recipe.total_time, servings: recipe.servings, sourceLabel })}
    accessibilityActions={[{ name: 'remove', label: 'Remove from collection' }]}
    onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'remove') onRemove(); }}
    footer={<RNView style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ fontSize: 13, lineHeight: 18, color: colors.textSecondary, flex: 1 }} numberOfLines={1}>{[sourceLabel, recipe.total_time].filter(Boolean).join(' · ')}</Text>
      {Platform.OS !== 'ios' && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${recipe.title} from collection`} onPress={event => { event.stopPropagation(); onRemove(); }} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={16} color={colors.textSecondary} /></TouchableOpacity>}
    </RNView>} />;
  if (Platform.OS !== 'ios') return card;
  return <Link href={`/recipe/${recipe.id}`} asChild onPress={event => event.preventDefault()}>
    <Link.Trigger>{card}</Link.Trigger>
    <Link.Menu><Link.MenuAction icon="minus.circle" onPress={onRemove}>Remove from collection</Link.MenuAction></Link.Menu>
  </Link>;
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
  const columns = useWindowDimensions().fontScale >= 1.3 ? 1 : 2;
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
        key={`columns-${columns}`}
        numColumns={columns}
        columnWrapperStyle={columns === 2 ? { gap: RECIPE_GRID_GAP } : undefined}
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
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingBottom: spacing.xxl,
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
