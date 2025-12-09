/**
 * Recipe Picker Modal
 * 
 * A modal for selecting a recipe from the user's recipes, saved recipes, or discover.
 * Used in meal planning to add a recipe to a meal slot.
 * Includes quick filters for cook time and tags.
 */

import { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Modal,
  FlatList,
  TouchableOpacity,
  Image,
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
import { useRecipes, useSavedRecipes, useInfiniteDiscoverRecipes, usePopularTags } from '@/hooks/useRecipes';
import { RecipeListItem } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { lightHaptic } from '@/utils/haptics';

type TabType = 'mine' | 'saved' | 'discover';

interface RecipePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (recipe: RecipeListItem) => void;
  title?: string;
}

// Time filter options
const TIME_FILTERS = [
  { label: 'All', value: null },
  { label: '< 30 min', value: 'quick' },
  { label: '30-60 min', value: 'medium' },
  { label: '> 60 min', value: 'long' },
];

// Helper to parse time string to minutes
function parseTimeToMinutes(timeStr: string | null): number | null {
  if (!timeStr) return null;
  const lower = timeStr.toLowerCase();
  
  // Parse "X hours Y min" format
  const hoursMatch = lower.match(/(\d+)\s*(?:hour|hr)/);
  const minsMatch = lower.match(/(\d+)\s*(?:min|minute)/);
  
  let totalMinutes = 0;
  if (hoursMatch) totalMinutes += parseInt(hoursMatch[1]) * 60;
  if (minsMatch) totalMinutes += parseInt(minsMatch[1]);
  
  // If no match but has a number, assume minutes
  if (!hoursMatch && !minsMatch) {
    const numMatch = lower.match(/(\d+)/);
    if (numMatch) totalMinutes = parseInt(numMatch[1]);
  }
  
  return totalMinutes > 0 ? totalMinutes : null;
}

// Filter recipe by time
function matchesTimeFilter(recipe: RecipeListItem, filter: string | null): boolean {
  if (!filter) return true;
  
  const minutes = parseTimeToMinutes(recipe.total_time);
  if (minutes === null) return filter === null; // No time info, show only for "All"
  
  switch (filter) {
    case 'quick': return minutes < 30;
    case 'medium': return minutes >= 30 && minutes <= 60;
    case 'long': return minutes > 60;
    default: return true;
  }
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
  const [activeTab, setActiveTab] = useState<TabType>('mine');
  const [timeFilter, setTimeFilter] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Fetch user's recipes
  const {
    data: recipesData,
    isLoading: recipesLoading,
    fetchNextPage: fetchMoreRecipes,
    hasNextPage: hasMoreRecipes,
    isFetchingNextPage: fetchingMoreRecipes,
  } = useRecipes();

  // Fetch saved recipes
  const {
    data: savedData,
    isLoading: savedLoading,
  } = useSavedRecipes();

  // Fetch discover recipes
  const {
    data: discoverData,
    isLoading: discoverLoading,
    fetchNextPage: fetchMoreDiscover,
    hasNextPage: hasMoreDiscover,
    isFetchingNextPage: fetchingMoreDiscover,
  } = useInfiniteDiscoverRecipes();

  // Fetch popular tags for the current tab
  const { data: popularTags } = usePopularTags(activeTab === 'discover' ? 'public' : 'user');

  // Combine all recipes from paginated results
  const myRecipes = useMemo(() => {
    if (!recipesData) return [];
    return recipesData.pages.flatMap((page) => page.items);
  }, [recipesData]);

  const savedRecipes = useMemo(() => {
    if (!savedData) return [];
    return savedData.pages.flatMap((page) => page.items);
  }, [savedData]);

  const discoverRecipes = useMemo(() => {
    if (!discoverData) return [];
    return discoverData.pages.flatMap((page) => page.items);
  }, [discoverData]);

  // Get source list based on active tab
  const sourceRecipes = useMemo(() => {
    switch (activeTab) {
      case 'mine': return myRecipes;
      case 'saved': return savedRecipes;
      case 'discover': return discoverRecipes;
    }
  }, [activeTab, myRecipes, savedRecipes, discoverRecipes]);

  // Filter by search, time, and tags
  const filteredRecipes = useMemo(() => {
    let filtered = sourceRecipes;

    // Search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.title.toLowerCase().includes(searchLower) ||
          r.tags.some((t) => t.toLowerCase().includes(searchLower))
      );
    }

    // Time filter
    if (timeFilter) {
      filtered = filtered.filter((r) => matchesTimeFilter(r, timeFilter));
    }

    // Tag filter
    if (selectedTags.length > 0) {
      filtered = filtered.filter((r) =>
        selectedTags.some((tag) => r.tags.map((t) => t.toLowerCase()).includes(tag.toLowerCase()))
      );
    }

    return filtered;
  }, [sourceRecipes, search, timeFilter, selectedTags]);

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
      <TouchableOpacity
        style={[
          styles.recipeItem,
          { backgroundColor: colors.card, borderColor: colors.cardBorder },
        ]}
        onPress={() => handleSelect(item)}
        activeOpacity={0.7}
      >
        {item.thumbnail_url ? (
          <Image source={{ uri: item.thumbnail_url }} style={styles.thumbnail} />
        ) : (
          <RNView
            style={[
              styles.thumbnailPlaceholder,
              { backgroundColor: colors.tint + '15' },
            ]}
          >
            <Ionicons name="restaurant-outline" size={24} color={colors.tint} />
          </RNView>
        )}
        <RNView style={styles.recipeInfo}>
          <Text style={[styles.recipeTitle, { color: colors.text }]} numberOfLines={2}>
            {item.title}
          </Text>
          <RNView style={styles.recipeMeta}>
            {item.total_time && (
              <Text style={[styles.metaText, { color: colors.textMuted }]}>
                ⏱️ {item.total_time}
              </Text>
            )}
            {item.servings && (
              <Text style={[styles.metaText, { color: colors.textMuted }]}>
                👥 {item.servings}
              </Text>
            )}
          </RNView>
        </RNView>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    ),
    [colors, handleSelect]
  );

  const isLoading = recipesLoading || savedLoading || discoverLoading;
  const canFetchMore = activeTab === 'mine' ? hasMoreRecipes : activeTab === 'discover' ? hasMoreDiscover : false;
  const isFetchingMore = activeTab === 'mine' ? fetchingMoreRecipes : activeTab === 'discover' ? fetchingMoreDiscover : false;

  const handleEndReached = useCallback(() => {
    if (activeTab === 'mine' && hasMoreRecipes && !fetchingMoreRecipes) {
      fetchMoreRecipes();
    } else if (activeTab === 'discover' && hasMoreDiscover && !fetchingMoreDiscover) {
      fetchMoreDiscover();
    }
  }, [activeTab, hasMoreRecipes, fetchingMoreRecipes, fetchMoreRecipes, hasMoreDiscover, fetchingMoreDiscover, fetchMoreDiscover]);

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
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
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
                placeholder="Search recipes..."
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
                color={hasActiveFilters ? '#FFFFFF' : colors.textMuted}
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
                          { color: timeFilter === filter.value ? '#FFFFFF' : colors.text },
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
                            { color: selectedTags.includes(tagItem.tag) ? '#FFFFFF' : colors.text },
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

          {/* Tab Toggle - 3 tabs */}
          <RNView style={styles.tabRow}>
            <TouchableOpacity
              style={[
                styles.tab,
                activeTab === 'mine' && { backgroundColor: colors.tint },
              ]}
              onPress={() => setActiveTab('mine')}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === 'mine' ? '#FFFFFF' : colors.textMuted },
                ]}
              >
                My Recipes
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.tab,
                activeTab === 'saved' && { backgroundColor: colors.tint },
              ]}
              onPress={() => setActiveTab('saved')}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === 'saved' ? '#FFFFFF' : colors.textMuted },
                ]}
              >
                Saved
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.tab,
                activeTab === 'discover' && { backgroundColor: colors.tint },
              ]}
              onPress={() => setActiveTab('discover')}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === 'discover' ? '#FFFFFF' : colors.textMuted },
                ]}
              >
                Discover
              </Text>
            </TouchableOpacity>
          </RNView>
        </RNView>

        {/* Recipe List */}
        {isLoading ? (
          <RNView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.tint} />
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
                  {search || hasActiveFilters ? 'No recipes match your filters' : 'No recipes yet'}
                </Text>
                {hasActiveFilters && (
                  <TouchableOpacity style={styles.clearFiltersButton} onPress={clearFilters}>
                    <Text style={[styles.clearFiltersButtonText, { color: colors.tint }]}>
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
                <ActivityIndicator style={styles.footerLoader} color={colors.tint} />
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
  thumbnailPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
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
