/**
 * Recipe Picker Modal
 *
 * A modal for selecting a recipe from the user's recipes, saved recipes, or discover.
 * Used in meal planning to add a recipe to a meal slot.
 * Includes quick filters for cook time and tags.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Modal,
  FlatList,
  TouchableOpacity,
  View as RNView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Chip, useColors } from '@/components/Themed';
import { usePlannerRecipeSearch, usePopularTags } from '@/hooks/useRecipes';
import { RecipeListItem } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { lightHaptic } from '@/utils/haptics';
import { RecipeTrustBadge } from '@/components/RecipeTrustBadge';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';

type TabType = 'all' | 'mine' | 'saved' | 'discover';

interface RecipePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (recipe: RecipeListItem) => void;
  title?: string;
}

type RecipePickerRowProps = {
  item: RecipeListItem;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
};

// Time filter options
const TIME_FILTERS = [
  { label: 'All', value: null },
  { label: '< 30 min', value: 'quick' },
  { label: '30-60 min', value: 'medium' },
  { label: '> 60 min', value: 'long' },
];

/** Render one recipe choice with its current readiness state. */
/** Render one selectable recipe in the planner picker. */
export function RecipePickerRow({ item, colors, onPress }: RecipePickerRowProps) {
  return (
    <TouchableOpacity
      style={[
        styles.recipeItem,
        { backgroundColor: colors.card, borderColor: colors.cardBorder },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <RecipeThumbnail
        uri={item.thumbnail_url}
        style={styles.thumbnail}
        accessibilityLabel={`${item.title} photo`}
        placeholderIconSize={24}
      />
      <RNView style={styles.recipeInfo}>
        <Text style={[styles.recipeTitle, { color: colors.text }]} numberOfLines={2}>
          {item.title}
        </Text>
        <RecipeTrustBadge reviewState={item.review_state} />
        <RNView style={styles.recipeMeta}>
          {item.total_time && (
            <RNView style={styles.metaItem}>
              <Ionicons name="time-outline" size={12} color={colors.textMuted} />
              <Text style={[styles.metaText, { color: colors.textMuted }]}>{item.total_time}</Text>
            </RNView>
          )}
          {item.servings && (
            <RNView style={styles.metaItem}>
              <Ionicons name="people-outline" size={12} color={colors.textMuted} />
              <Text style={[styles.metaText, { color: colors.textMuted }]}>{item.servings}</Text>
            </RNView>
          )}
        </RNView>
      </RNView>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

export default function RecipePickerModal({
  visible,
  onClose,
  onSelect,
  title = 'Select Recipe',
}: RecipePickerModalProps) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [timeFilter, setTimeFilter] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const results = usePlannerRecipeSearch(activeTab, {
    query: debouncedSearch, timeFilter: timeFilter ?? undefined, tags: selectedTags,
  }, visible);
  const filteredRecipes = results.data?.pages.flatMap(page => page.items) ?? [];
  const { data: popularTags } = usePopularTags(activeTab === 'discover' ? 'public' : 'user');

  const handleSelect = useCallback(
    (recipe: RecipeListItem) => {
      lightHaptic();
      onSelect(recipe);
    },
    [onSelect]
  );

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setTimeFilter(null);
    setSelectedTags([]);
  }, []);

  const hasActiveFilters = timeFilter !== null || selectedTags.length > 0;

  const renderRecipe = useCallback(
    ({ item }: { item: RecipeListItem }) => (
      <RecipePickerRow
        item={item}
        colors={colors}
        onPress={() => handleSelect(item)}
      />
    ),
    [colors, handleSelect]
  );

  const isLoading = results.isLoading;
  const isFetchingMore = results.isFetchingNextPage;
  const handleEndReached = () => {
    if (results.hasNextPage && !results.isFetchingNextPage && !results.isError) void results.fetchNextPage();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <RNView
          style={[
            styles.header,
            { borderBottomColor: colors.border, paddingTop: insets.top > 0 ? insets.top : spacing.md },
          ]}
        >
          <RNView style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close recipe picker">
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </RNView>

          {/* Search Bar */}
          <RNView style={styles.searchRow}>
            <RNView
              style={[
                styles.searchContainer,
                { backgroundColor: colors.card, borderColor: colors.cardBorder },
              ]}
            >
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search all recipes in this scope"
                accessibilityLabel="Search recipes in selected scope"
                placeholderTextColor={colors.textMuted}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </RNView>
            <TouchableOpacity
              style={[
                styles.filterButton,
                { backgroundColor: hasActiveFilters ? colors.tint : colors.card, borderColor: colors.cardBorder },
              ]}
              onPress={() => setShowFilters(!showFilters)}
            >
              <Ionicons
                name="options-outline"
                size={20}
                color={hasActiveFilters ? colors.onTint : colors.textMuted}
              />
            </TouchableOpacity>
          </RNView>

          {/* Quick Filters */}
          {showFilters && (
            <RNView style={styles.filtersContainer}>
              {/* Time Filter */}
              <RNView style={styles.filterSection}>
                <Text style={[styles.filterLabel, { color: colors.textMuted }]}>Cook Time</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
                  {TIME_FILTERS.map((filter) => (
                    <TouchableOpacity
                      key={filter.label}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: timeFilter === filter.value ? colors.tint : colors.card,
                          borderColor: colors.cardBorder,
                        },
                      ]}
                      onPress={() => setTimeFilter(timeFilter === filter.value ? null : filter.value)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          { color: timeFilter === filter.value ? colors.onTint : colors.text },
                        ]}
                      >
                        {filter.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </RNView>

              {/* Tag Filter */}
              {popularTags && popularTags.length > 0 && (
                <RNView style={styles.filterSection}>
                  <Text style={[styles.filterLabel, { color: colors.textMuted }]}>Tags</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
                    {popularTags.slice(0, 8).map((tagItem) => (
                      <TouchableOpacity
                        key={tagItem.tag}
                        style={[
                          styles.filterChip,
                          {
                            backgroundColor: selectedTags.includes(tagItem.tag) ? colors.tint : colors.card,
                            borderColor: colors.cardBorder,
                          },
                        ]}
                        onPress={() => toggleTag(tagItem.tag)}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            { color: selectedTags.includes(tagItem.tag) ? colors.onTint : colors.text },
                          ]}
                        >
                          {tagItem.tag}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </RNView>
              )}

              {/* Clear Filters */}
              {hasActiveFilters && (
                <TouchableOpacity style={styles.clearFilters} onPress={clearFilters}>
                  <Text style={[styles.clearFiltersText, { color: colors.error }]}>
                    Clear Filters
                  </Text>
                </TouchableOpacity>
              )}
            </RNView>
          )}

          <RNView style={styles.tabRow} accessibilityRole="radiogroup">
            {([['all', 'All library'], ['mine', 'Mine'], ['saved', 'Saved'], ['discover', 'Discover']] as const).map(([scope, label]) => (
              <Chip key={scope} label={label} selected={activeTab === scope}
                accessibilityRole="radio" accessibilityLabel={`${label} recipes`}
                onPress={() => setActiveTab(scope)} />
            ))}
          </RNView>

        </RNView>

        {results.isError && <RNView style={{ padding: spacing.md }}>
          <Text style={{ color: colors.text }}>Couldn’t load {activeTab === 'all' ? 'your library' : activeTab} recipes. {filteredRecipes.length > 0 ? 'Showing loaded recipes.' : ''}</Text>
          <TouchableOpacity style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Retry recipe search"
            disabled={results.isFetching} onPress={() => results.isFetchNextPageError ? results.fetchNextPage() : results.refetch()}>
            <Text style={{ color: colors.actionText }}>{results.isFetching ? 'Retrying…' : 'Retry'}</Text>
          </TouchableOpacity>
        </RNView>}
        {/* Recipe List */}
        {isLoading ? (
          <RNView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.actionText} />
          </RNView>
        ) : (
          <FlatList
            data={filteredRecipes}
            renderItem={renderRecipe}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: insets.bottom + spacing.lg },
            ]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <RNView style={styles.emptyContainer}>
                <Ionicons name="restaurant-outline" size={48} color={colors.textMuted} />
                <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                  {results.isError ? 'Recipes are unavailable' : search || hasActiveFilters ? 'No recipes match in this scope' : 'No recipes in this scope yet'}
                </Text>
                {hasActiveFilters && (
                  <TouchableOpacity style={styles.clearFiltersButton} onPress={clearFilters}>
                    <Text style={[styles.clearFiltersButtonText, { color: colors.actionText }]}>
                      Clear Filters
                    </Text>
                  </TouchableOpacity>
                )}
              </RNView>
            }
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              isFetchingMore ? (
                <ActivityIndicator style={styles.footerLoader} color={colors.actionText} />
              ) : null
            }
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    borderBottomWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  closeButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    padding: spacing.xs,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: fontSize.md,
  },
  filterButton: {
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  filtersContainer: {
    marginBottom: spacing.md,
  },
  filterSection: {
    marginBottom: spacing.sm,
  },
  filterLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  filterScroll: {
    flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    borderWidth: 1,
    marginRight: spacing.xs,
  },
  filterChipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  clearFilters: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  clearFiltersText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  tabText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: spacing.lg,
  },
  recipeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
  },
  recipeInfo: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
  },
  recipeTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    marginBottom: 4,
  },
  recipeMeta: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaText: {
    fontSize: fontSize.xs,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
  },
  emptyText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  clearFiltersButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  clearFiltersButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  footerLoader: {
    paddingVertical: spacing.lg,
  },
});
