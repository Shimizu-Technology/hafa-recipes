/**
 * Grocery List Screen
 * 
 * Shows the user's grocery list grouped by recipe with collapsible sections.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  View as RNView,
  Alert,
  TextInput,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { View, Text, Button, useColors } from '@/components/Themed';
import { SignInBanner } from '@/components/SignInBanner';
import EditGroceryItemModal from '@/components/EditGroceryItemModal';
import {
  useGroceryList,
  useGroceryCount,
  useToggleGroceryItem,
  useDeleteGroceryItem,
  useClearCheckedItems,
  useClearAllItems,
  useAddGroceryItem,
  useGrocerySync,
} from '@/hooks/useGrocery';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { api } from '@/lib/api';
import { GroceryItem } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';
import { AnimatedListItem, ScalePressable } from '@/components/Animated';

const COLLAPSED_SECTIONS_KEY = 'grocery_collapsed_sections';
const OTHER_ITEMS_KEY = 'Other Items';

interface GrocerySection {
  title: string;
  recipeId: string | null;
  data: GroceryItem[];
  checkedCount: number;
  totalCount: number;
}

function GroceryItemRow({
  item,
  colors,
  onToggle,
  onDelete,
  onEdit,
  showRecipeLabel = false,
}: {
  item: GroceryItem;
  colors: ReturnType<typeof useColors>;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  showRecipeLabel?: boolean;
}) {
  return (
    <ScalePressable 
      style={[
        styles.itemRow, 
        { 
          backgroundColor: colors.card, 
          borderColor: item.checked ? colors.success + '40' : colors.cardBorder,
          opacity: item.checked ? 0.7 : 1,
        }
      ]}
      onPress={onToggle}
      scaleValue={0.98}
    >
      {/* Checkbox */}
      <RNView style={styles.checkbox}>
        <Ionicons
          name={item.checked ? 'checkbox' : 'square-outline'}
          size={24}
          color={item.checked ? colors.success : colors.textMuted}
        />
      </RNView>

      {/* Item details */}
      <RNView style={styles.itemContent}>
        <Text
          style={[
            styles.itemName,
            { color: item.checked ? colors.textMuted : colors.text },
            item.checked && styles.itemNameChecked,
          ]}
          numberOfLines={1}
        >
          {item.quantity && item.quantity !== 'null' && `${item.quantity} `}
          {item.unit && item.unit !== 'null' && `${item.unit} `}
          {item.name}
        </Text>
        {showRecipeLabel && item.recipe_title && (
          <Text style={[styles.recipeLabel, { color: colors.textMuted }]} numberOfLines={1}>
            from {item.recipe_title}
          </Text>
        )}
        {item.notes && item.notes !== 'null' && (
          <Text style={[styles.itemNotes, { color: colors.textMuted }]} numberOfLines={1}>
            {item.notes}
          </Text>
        )}
      </RNView>

      {/* Edit button */}
      <TouchableOpacity 
        onPress={(e) => {
          e.stopPropagation?.();
          onEdit();
        }} 
        style={styles.editButton}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="pencil-outline" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Delete button */}
      <TouchableOpacity 
        onPress={(e) => {
          e.stopPropagation?.();
          onDelete();
        }} 
        style={styles.deleteButton}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="trash-outline" size={20} color={colors.error} />
      </TouchableOpacity>
    </ScalePressable>
  );
}

function SectionHeader({
  section,
  isCollapsed,
  onToggle,
  colors,
}: {
  section: GrocerySection;
  isCollapsed: boolean;
  onToggle: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const isOther = section.title === OTHER_ITEMS_KEY;
  const icon = isOther ? 'list-outline' : 'restaurant-outline';
  
  return (
    <TouchableOpacity
      style={[styles.sectionHeader, { backgroundColor: colors.backgroundSecondary }]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <RNView style={styles.sectionHeaderLeft}>
        <Ionicons name={icon} size={18} color={colors.tint} style={styles.sectionIcon} />
        <Text style={[styles.sectionTitle, { color: colors.text }]} numberOfLines={1}>
          {section.title}
        </Text>
        <RNView style={[styles.sectionBadge, { backgroundColor: colors.tint + '20' }]}>
          <Text style={[styles.sectionBadgeText, { color: colors.tint }]}>
            {section.checkedCount}/{section.totalCount}
          </Text>
        </RNView>
      </RNView>
      <Ionicons
        name={isCollapsed ? 'chevron-down' : 'chevron-up'}
        size={20}
        color={colors.textMuted}
      />
    </TouchableOpacity>
  );
}

export default function GroceryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();
  const { isOnline } = useNetworkStatus();
  
  const [newItemName, setNewItemName] = useState('');
  const [showChecked, setShowChecked] = useState(true);
  const [editingItem, setEditingItem] = useState<GroceryItem | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Set up offline sync
  useGrocerySync();

  const { data: groceryItems, isLoading, refetch, isRefetching } = useGroceryList(showChecked);
  const { data: countData } = useGroceryCount();
  const toggleMutation = useToggleGroceryItem();
  const deleteMutation = useDeleteGroceryItem();
  const clearCheckedMutation = useClearCheckedItems();
  const clearAllMutation = useClearAllItems();
  const addItemMutation = useAddGroceryItem();

  // Load collapsed sections from AsyncStorage on mount
  useEffect(() => {
    const loadCollapsedSections = async () => {
      try {
        const stored = await AsyncStorage.getItem(COLLAPSED_SECTIONS_KEY);
        if (stored) {
          setCollapsedSections(new Set(JSON.parse(stored)));
        }
      } catch (error) {
        console.warn('Failed to load collapsed sections:', error);
      }
    };
    loadCollapsedSections();
  }, []);

  // Save collapsed sections to AsyncStorage
  const saveCollapsedSections = async (sections: Set<string>) => {
    try {
      await AsyncStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...sections]));
    } catch (error) {
      console.warn('Failed to save collapsed sections:', error);
    }
  };

  // Group items by recipe into sections
  const sections = useMemo((): GrocerySection[] => {
    if (!groceryItems || groceryItems.length === 0) return [];

    const byRecipe: { [key: string]: GroceryItem[] } = {};
    const otherItems: GroceryItem[] = [];

    groceryItems.forEach(item => {
      if (item.recipe_title) {
        const key = item.recipe_title;
        if (!byRecipe[key]) {
          byRecipe[key] = [];
        }
        byRecipe[key].push(item);
      } else {
        otherItems.push(item);
      }
    });

    const result: GrocerySection[] = [];

    // Add recipe sections (sorted alphabetically)
    Object.entries(byRecipe)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([title, items]) => {
        const checkedCount = items.filter(i => i.checked).length;
        result.push({
          title,
          recipeId: items[0]?.recipe_id || null,
          data: items,
          checkedCount,
          totalCount: items.length,
        });
      });

    // Add "Other Items" section at the end
    if (otherItems.length > 0) {
      const checkedCount = otherItems.filter(i => i.checked).length;
      result.push({
        title: OTHER_ITEMS_KEY,
        recipeId: null,
        data: otherItems,
        checkedCount,
        totalCount: otherItems.length,
      });
    }

    return result;
  }, [groceryItems]);

  const toggleSection = (title: string) => {
    haptics.light();
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      saveCollapsedSections(next);
      return next;
    });
  };

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);
  
  const handleToggle = (id: string) => {
    haptics.light();
    toggleMutation.mutate(id);
  };

  const handleDelete = (id: string, name: string) => {
    haptics.warning();
    Alert.alert('Delete Item', `Remove "${name}" from your list?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteMutation.mutate(id),
      },
    ]);
  };

  const handleClearChecked = () => {
    if (!countData || countData.checked === 0) return;
    
    Alert.alert(
      'Clear Checked Items',
      `Remove ${countData.checked} checked item${countData.checked !== 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => clearCheckedMutation.mutate(),
        },
      ]
    );
  };

  const handleClearAll = () => {
    if (!countData || countData.total === 0) return;
    
    Alert.alert(
      'Clear All Items',
      `Remove all ${countData.total} item${countData.total !== 1 ? 's' : ''} from your grocery list? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => clearAllMutation.mutate(),
        },
      ]
    );
  };

  const handleAddItem = () => {
    if (!newItemName.trim()) return;
    
    haptics.success();
    addItemMutation.mutate(
      { name: newItemName.trim() },
      {
        onSuccess: () => setNewItemName(''),
      }
    );
  };

  const formatGroceryListAsText = () => {
    if (!groceryItems || groceryItems.length === 0) return '';
    
    // Group items by recipe
    const byRecipe: { [key: string]: typeof groceryItems } = {};
    const noRecipe: typeof groceryItems = [];
    
    groceryItems.forEach(item => {
      if (item.recipe_title) {
        if (!byRecipe[item.recipe_title]) {
          byRecipe[item.recipe_title] = [];
        }
        byRecipe[item.recipe_title].push(item);
      } else {
        noRecipe.push(item);
      }
    });

    let text = '🛒 Grocery List\n\n';
    
    // Format items with simple list style
    const formatItem = (item: GroceryItem) => {
      const marker = item.checked ? '✓' : '-';
      const qty = item.quantity && item.quantity !== 'null' ? item.quantity : '';
      const unit = item.unit && item.unit !== 'null' ? item.unit : '';
      const qtyUnit = qty ? `${qty}${unit ? ' ' + unit : ''} ` : '';
      const notes = item.notes && item.notes !== 'null' ? ` (${item.notes})` : '';
      return `${marker} ${qtyUnit}${item.name}${notes}`;
    };

    // Add items grouped by recipe first
    Object.entries(byRecipe)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([recipeName, items], index) => {
        if (index > 0) text += '\n';
        text += `📖 ${recipeName}\n`;
        items.forEach(item => {
          text += formatItem(item) + '\n';
        });
      });

    // Add items without recipe last
    if (noRecipe.length > 0) {
      if (Object.keys(byRecipe).length > 0) text += '\n';
      text += `📝 Other Items\n`;
      noRecipe.forEach(item => {
        text += formatItem(item) + '\n';
      });
    }

    return text.trim();
  };

  const handleExportList = async () => {
    if (!groceryItems || groceryItems.length === 0) {
      Alert.alert('Empty List', 'Add some items to your grocery list first.');
      return;
    }

    const listText = formatGroceryListAsText();
    
    try {
      await Share.share({
        message: listText,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const handleEdit = (item: GroceryItem) => {
    setEditingItem(item);
  };

  const handleSaveEdit = async (updates: { name: string; quantity: string; unit: string; notes: string }) => {
    if (!editingItem) return;
    
    setIsUpdating(true);
    try {
      await api.updateGroceryItem(editingItem.id, {
        name: updates.name,
        quantity: updates.quantity || null,
        unit: updates.unit || null,
        notes: updates.notes || null,
      });
      await refetch();
      setEditingItem(null);
    } catch (error) {
      Alert.alert('Error', 'Failed to update item');
    } finally {
      setIsUpdating(false);
    }
  };

  const renderItem = ({ item, index, section }: { item: GroceryItem; index: number; section: GrocerySection }) => {
    // Don't render if section is collapsed
    if (collapsedSections.has(section.title)) {
      return null;
    }

    return (
      <AnimatedListItem index={index} delay={30}>
        <GroceryItemRow
          item={item}
          colors={colors}
          onToggle={() => handleToggle(item.id)}
          onDelete={() => handleDelete(item.id, item.name)}
          onEdit={() => handleEdit(item)}
          showRecipeLabel={false}
        />
      </AnimatedListItem>
    );
  };

  const renderSectionHeader = ({ section }: { section: GrocerySection }) => (
    <SectionHeader
      section={section}
      isCollapsed={collapsedSections.has(section.title)}
      onToggle={() => toggleSection(section.title)}
      colors={colors}
    />
  );

  const ListEmpty = () => (
    <RNView style={styles.emptyContainer}>
      <Ionicons name="cart-outline" size={64} color={colors.textMuted} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        Your grocery list is empty
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        Add items manually above, or add ingredients from a recipe
      </Text>
    </RNView>
  );

  return (
    <RNView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Offline indicator banner */}
      {!isOnline && (
        <RNView style={[styles.offlineBanner, { backgroundColor: colors.warning }]}>
          <Ionicons name="cloud-offline-outline" size={16} color="#FFFFFF" />
          <Text style={styles.offlineBannerText}>
            You're offline. Changes will sync when you reconnect.
          </Text>
        </RNView>
      )}

      {/* Fixed header with input */}
      <RNView style={styles.header}>
        {/* Title row */}
        <RNView style={styles.titleRow}>
          <RNView style={styles.titleLeft}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Grocery List</Text>
            {countData && countData.unchecked > 0 && (
              <RNView style={[styles.countBadge, { backgroundColor: colors.tint }]}>
                <Text style={styles.countText}>{countData.unchecked}</Text>
              </RNView>
            )}
          </RNView>
          {countData && countData.total > 0 && (
            <TouchableOpacity onPress={handleExportList} style={styles.exportButton}>
              <Ionicons name="share-outline" size={22} color={colors.tint} />
            </TouchableOpacity>
          )}
        </RNView>

        {/* Add item input */}
        <RNView style={[styles.addItemRow, { borderColor: colors.border }]}>
          <TextInput
            style={[styles.addItemInput, { color: colors.text }]}
            placeholder="Add an item..."
            placeholderTextColor={colors.textMuted}
            value={newItemName}
            onChangeText={setNewItemName}
            onSubmitEditing={handleAddItem}
            returnKeyType="done"
          />
          <TouchableOpacity
            onPress={handleAddItem}
            disabled={!newItemName.trim()}
            style={[
              styles.addButton,
              { backgroundColor: newItemName.trim() ? colors.tint : colors.border },
            ]}
          >
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </RNView>

        {/* Filter/action row */}
        {countData && countData.total > 0 && (
          <RNView style={styles.actionRow}>
            <TouchableOpacity
              onPress={() => setShowChecked(!showChecked)}
              style={styles.filterButton}
            >
              <Ionicons
                name={showChecked ? 'eye' : 'eye-off'}
                size={18}
                color={colors.textMuted}
              />
              <Text style={[styles.filterText, { color: colors.textMuted }]}>
                {showChecked ? 'Hide' : 'Show'} checked
              </Text>
            </TouchableOpacity>

            <RNView style={styles.clearButtons}>
              {countData.checked > 0 && (
                <TouchableOpacity onPress={handleClearChecked} style={styles.clearButton}>
                  <Ionicons name="checkmark-done-outline" size={16} color={colors.textMuted} />
                  <Text style={[styles.clearText, { color: colors.textMuted }]}>
                    Clear done
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={handleClearAll} style={styles.clearButton}>
                <Ionicons name="trash-outline" size={16} color={colors.error} />
                <Text style={[styles.clearText, { color: colors.error }]}>
                  Clear all
                </Text>
              </TouchableOpacity>
            </RNView>
          </RNView>
        )}
      </RNView>

      <SectionList
        sections={sections}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={!isLoading ? ListEmpty : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom, 80) + spacing.xl + (isSignedIn ? 0 : 100) }]}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.tint}
          />
        }
      />

      {/* Edit Modal */}
      <EditGroceryItemModal
        visible={!!editingItem}
        onClose={() => setEditingItem(null)}
        onSave={handleSaveEdit}
        item={editingItem}
        isLoading={isUpdating}
      />
      
      {/* Sign In Banner for guests */}
      {!isSignedIn && <SignInBanner message="Sign in to create grocery lists" />}
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  offlineBannerText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
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
  exportButton: {
    padding: spacing.sm,
  },
  countText: {
    color: '#FFFFFF',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  addItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  addItemInput: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
  },
  addButton: {
    padding: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  filterText: {
    fontSize: fontSize.sm,
  },
  clearButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  clearText: {
    fontSize: fontSize.sm,
  },
  // Section header styles
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sectionIcon: {
    marginRight: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    flex: 1,
  },
  sectionBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    marginLeft: spacing.sm,
  },
  sectionBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  // Item styles
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  checkbox: {
    marginRight: spacing.md,
  },
  itemContent: {
    flex: 1,
  },
  itemName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  itemNameChecked: {
    textDecorationLine: 'line-through',
  },
  recipeLabel: {
    fontSize: fontSize.xs,
    marginTop: 2,
    fontStyle: 'italic',
  },
  itemNotes: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  editButton: {
    padding: spacing.sm,
  },
  deleteButton: {
    padding: spacing.sm,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
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
    lineHeight: 22,
  },
});
