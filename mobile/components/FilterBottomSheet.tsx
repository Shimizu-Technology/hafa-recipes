import { useState, useEffect } from 'react';
import {
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  View as RNView,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, View, useColors } from '@/components/Themed';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

// Filter options
const SOURCE_FILTERS = [
  { key: 'all', label: 'All Sources', icon: 'apps-outline' },
  { key: 'tiktok', label: 'TikTok', icon: 'logo-tiktok' },
  { key: 'youtube', label: 'YouTube', icon: 'logo-youtube' },
  { key: 'instagram', label: 'Instagram', icon: 'logo-instagram' },
  { key: 'website', label: 'Website', icon: 'globe-outline' },
  { key: 'manual', label: 'Manual', icon: 'create-outline' },
] as const;

const TIME_FILTERS = [
  { key: 'all', label: 'Any Time', icon: 'time-outline' },
  { key: 'quick', label: 'Under 30 min', icon: 'flash-outline' },
  { key: 'medium', label: '30-60 min', icon: 'timer-outline' },
  { key: 'long', label: 'Over 60 min', icon: 'hourglass-outline' },
] as const;

const SORT_OPTIONS = [
  { key: 'recent', label: 'Recent', icon: 'time-outline' },
  { key: 'popular', label: 'Popular', icon: 'heart-outline' },
  { key: 'random', label: 'Random', icon: 'shuffle-outline' },
] as const;

export type SourceFilter = typeof SOURCE_FILTERS[number]['key'];
export type TimeFilter = typeof TIME_FILTERS[number]['key'];
export type SortOption = typeof SORT_OPTIONS[number]['key'];

export interface FilterState {
  sourceFilter: SourceFilter;
  timeFilter: TimeFilter;
  selectedTags: string[];
  sortOrder?: SortOption;
  hideMyRecipes?: boolean;
}

interface FilterBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: FilterState) => void;
  initialFilters: FilterState;
  popularTags?: { tag: string; count: number }[];
  showIncludeSaved?: boolean;
  includeSaved?: boolean;
  onIncludeSavedChange?: (value: boolean) => void;
  // Discover-specific options
  showSortOption?: boolean;
  showHideMyRecipes?: boolean;
}

export default function FilterBottomSheet({
  visible,
  onClose,
  onApply,
  initialFilters,
  popularTags = [],
  showIncludeSaved = false,
  includeSaved = true,
  onIncludeSavedChange,
  showSortOption = false,
  showHideMyRecipes = false,
}: FilterBottomSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  
  // Local state for filters (applied on "Apply" button)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(initialFilters.sourceFilter);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(initialFilters.timeFilter);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialFilters.selectedTags);
  const [sortOrder, setSortOrder] = useState<SortOption>(initialFilters.sortOrder || 'recent');
  const [hideMyRecipes, setHideMyRecipes] = useState<boolean>(initialFilters.hideMyRecipes || false);
  
  // Reset local state when modal opens
  useEffect(() => {
    if (visible) {
      setSourceFilter(initialFilters.sourceFilter);
      setTimeFilter(initialFilters.timeFilter);
      setSelectedTags(initialFilters.selectedTags);
      setSortOrder(initialFilters.sortOrder || 'recent');
      setHideMyRecipes(initialFilters.hideMyRecipes || false);
    }
  }, [visible, initialFilters]);
  
  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };
  
  const handleApply = () => {
    onApply({ sourceFilter, timeFilter, selectedTags, sortOrder, hideMyRecipes });
    onClose();
  };
  
  const handleClear = () => {
    setSourceFilter('all');
    setTimeFilter('all');
    setSelectedTags([]);
    setSortOrder('recent');
    setHideMyRecipes(false);
  };
  
  const activeFilterCount = 
    (sourceFilter !== 'all' ? 1 : 0) + 
    (timeFilter !== 'all' ? 1 : 0) + 
    selectedTags.length +
    (hideMyRecipes ? 1 : 0);
  
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable 
          style={[
            styles.sheet, 
            { 
              backgroundColor: colors.background,
              paddingBottom: insets.bottom + spacing.md,
            }
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Handle bar */}
          <RNView style={styles.handleContainer}>
            <RNView style={[styles.handle, { backgroundColor: colors.border }]} />
          </RNView>
          
          {/* Header */}
          <RNView style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Filters</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </RNView>
          
          <ScrollView 
            style={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {/* Source Filter */}
            <RNView style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Source</Text>
              <RNView style={styles.chipContainer}>
                {SOURCE_FILTERS.map((filter) => (
                  <TouchableOpacity
                    key={filter.key}
                    onPress={() => setSourceFilter(filter.key)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: sourceFilter === filter.key 
                          ? colors.tint 
                          : colors.backgroundSecondary,
                        borderColor: sourceFilter === filter.key 
                          ? colors.tint 
                          : colors.border,
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
                        styles.chipText,
                        { color: sourceFilter === filter.key ? '#FFFFFF' : colors.text },
                      ]}
                    >
                      {filter.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </RNView>
            </RNView>
            
            {/* Time Filter */}
            <RNView style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Cook Time</Text>
              <RNView style={styles.chipContainer}>
                {TIME_FILTERS.map((filter) => (
                  <TouchableOpacity
                    key={filter.key}
                    onPress={() => setTimeFilter(filter.key)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: timeFilter === filter.key 
                          ? colors.success 
                          : colors.backgroundSecondary,
                        borderColor: timeFilter === filter.key 
                          ? colors.success 
                          : colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={filter.icon as any}
                      size={16}
                      color={timeFilter === filter.key ? '#FFFFFF' : colors.textMuted}
                    />
                    <Text
                      style={[
                        styles.chipText,
                        { color: timeFilter === filter.key ? '#FFFFFF' : colors.text },
                      ]}
                    >
                      {filter.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </RNView>
            </RNView>
            
            {/* Tags Filter */}
            {popularTags.length > 0 && (
              <RNView style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Tags {selectedTags.length > 0 && `(${selectedTags.length} selected)`}
                </Text>
                <RNView style={styles.chipContainer}>
                  {popularTags.map((item) => (
                    <TouchableOpacity
                      key={item.tag}
                      onPress={() => toggleTag(item.tag)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: selectedTags.includes(item.tag) 
                            ? colors.tint 
                            : colors.backgroundSecondary,
                          borderColor: selectedTags.includes(item.tag) 
                            ? colors.tint 
                            : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: selectedTags.includes(item.tag) ? '#FFFFFF' : colors.text },
                        ]}
                      >
                        {item.tag} ({item.count})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </RNView>
              </RNView>
            )}
            
            {/* Sort Option (for Discover) */}
            {showSortOption && (
              <RNView style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Sort By</Text>
                <RNView style={styles.chipContainer}>
                  {SORT_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setSortOrder(option.key)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: sortOrder === option.key 
                            ? colors.tint 
                            : colors.backgroundSecondary,
                          borderColor: sortOrder === option.key 
                            ? colors.tint 
                            : colors.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={option.icon as any}
                        size={16}
                        color={sortOrder === option.key ? '#FFFFFF' : colors.textMuted}
                      />
                      <Text
                        style={[
                          styles.chipText,
                          { color: sortOrder === option.key ? '#FFFFFF' : colors.text },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </RNView>
              </RNView>
            )}
            
            {/* Hide My Recipes Toggle (for Discover) */}
            {showHideMyRecipes && (
              <RNView style={styles.section}>
                <TouchableOpacity
                  style={[styles.toggleRow, { borderColor: colors.border }]}
                  onPress={() => setHideMyRecipes(!hideMyRecipes)}
                >
                  <RNView style={styles.toggleLabel}>
                    <Ionicons 
                      name={hideMyRecipes ? "eye-off" : "eye-off-outline"}
                      size={20} 
                      color={hideMyRecipes ? colors.tint : colors.textMuted} 
                    />
                    <Text style={[styles.toggleText, { color: colors.text }]}>
                      Hide My Recipes
                    </Text>
                  </RNView>
                  <Ionicons 
                    name={hideMyRecipes ? "checkbox" : "square-outline"} 
                    size={24} 
                    color={hideMyRecipes ? colors.tint : colors.textMuted} 
                  />
                </TouchableOpacity>
              </RNView>
            )}
            
            {/* Include Saved Toggle (for My Recipes) */}
            {showIncludeSaved && (
              <RNView style={styles.section}>
                <TouchableOpacity
                  style={[styles.toggleRow, { borderColor: colors.border }]}
                  onPress={() => onIncludeSavedChange?.(!includeSaved)}
                >
                  <RNView style={styles.toggleLabel}>
                    <Ionicons 
                      name="heart" 
                      size={20} 
                      color={includeSaved ? colors.error : colors.textMuted} 
                    />
                    <Text style={[styles.toggleText, { color: colors.text }]}>
                      Include Saved Recipes
                    </Text>
                  </RNView>
                  <Ionicons 
                    name={includeSaved ? "checkbox" : "square-outline"} 
                    size={24} 
                    color={includeSaved ? colors.tint : colors.textMuted} 
                  />
                </TouchableOpacity>
              </RNView>
            )}
          </ScrollView>
          
          {/* Footer Buttons */}
          <RNView style={styles.footer}>
            <TouchableOpacity
              style={[styles.clearButton, { borderColor: colors.border }]}
              onPress={handleClear}
            >
              <Text style={[styles.clearButtonText, { color: colors.text }]}>
                Clear All
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.applyButton, { backgroundColor: colors.tint }]}
              onPress={handleApply}
            >
              <Text style={styles.applyButtonText}>
                Apply{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </Text>
            </TouchableOpacity>
          </RNView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '80%',
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  content: {
    paddingHorizontal: spacing.lg,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.sm,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  toggleLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toggleText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  clearButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  clearButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  applyButton: {
    flex: 2,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: '#FFFFFF',
  },
});

