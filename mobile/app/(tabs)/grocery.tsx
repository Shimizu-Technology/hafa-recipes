/**
 * Grocery List Screen
 * 
 * Shows the user's grocery list grouped by recipe with collapsible sections.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  View as RNView,
  Alert,
  TextInput,
  Keyboard,
  Platform,
  Share,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { View, Text, Button, useColors } from '@/components/Themed';
import { SignInBanner } from '@/components/SignInBanner';
import { guestPromptBottomPadding, useGuestPromptHeight } from '../../lib/guestPromptLayout';
import EditGroceryItemModal from '@/components/EditGroceryItemModal';
import GroceryListSettingsModal from '@/components/GroceryListSettingsModal';
import { GrocerySectionHeader } from '@/components/GrocerySectionHeader';
import {
  useGroceryList,
  useGroceryCount,
  useToggleGroceryItem,
  useDeleteGroceryItem,
  useClearCheckedItems,
  useClearAllItems,
  useAddGroceryItem,
  useGrocerySync,
  useGroceryListInfo,
  useDeleteGroceryItems,
  useUpdateGroceryItem,
} from '@/hooks/useGrocery';
import { GroceryItem } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { useTextSize } from '@/hooks/useTextSize';
import { haptics } from '@/utils/haptics';
import { AnimatedListItem, ScalePressable } from '@/components/Animated';
import {
  GrocerySection,
  groupGroceryItems,
  OTHER_GROCERY_SECTION_KEY,
} from '@/lib/grocerySections';
import { appRoutes } from '@/lib/routes';
import { filterGroceryItems } from '@/lib/groceryFilters';

const COLLAPSED_SECTIONS_KEY = 'grocery_collapsed_sections';

function GroceryItemRow({
  item,
  colors,
  onToggle,
  onDelete,
  onEdit,
  showRecipeLabel = false,
  isSharedList = false,
  scaleFontSize,
}: {
  item: GroceryItem;
  colors: ReturnType<typeof useColors>;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  showRecipeLabel?: boolean;
  isSharedList?: boolean;
  scaleFontSize: (size: number) => number;
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
        <RNView style={styles.itemNameRow}>
          <Text
            style={[
              styles.itemName,
              { color: item.checked ? colors.textMuted : colors.text, fontSize: scaleFontSize(fontSize.md) },
              item.checked && styles.itemNameChecked,
              // Allow name to shrink when added_by label is present
              isSharedList && item.added_by_name && styles.itemNameWithLabel,
            ]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {item.quantity && item.quantity !== 'null' && `${item.quantity} `}
            {item.unit && item.unit !== 'null' && `${item.unit} `}
            {item.name}
          </Text>
          {isSharedList && item.added_by_name && (
            <Text 
              style={[styles.addedByLabel, { color: colors.textMuted }]}
              numberOfLines={1}
            >
              ({item.added_by_name})
            </Text>
          )}
        </RNView>
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

export default function GroceryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();
  const guestPromptHeight = useGuestPromptHeight();
  const { scaleFontSize } = useTextSize();
  const router = useRouter();
  const { focusAdd, editItem } = useLocalSearchParams<{
    focusAdd?: string;
    editItem?: string;
  }>();
  
  // Ref for the add item input to maintain focus
  const addItemInputRef = useRef<TextInput>(null);
  
  const [newItemName, setNewItemName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showChecked, setShowChecked] = useState(false);
  const [editingItem, setEditingItem] = useState<GroceryItem | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);

  // Set up offline sync (syncs pending changes when back online)
  const { lastSyncResult, clearSyncResult } = useGrocerySync(!!isSignedIn);
  
  // Show alert when sync has failures
  useEffect(() => {
    if (lastSyncResult && lastSyncResult.failed > 0) {
      Alert.alert(
        "Sync Notice",
        `Some changes couldn't be synced (${lastSyncResult.failed} item${lastSyncResult.failed > 1 ? 's' : ''}). The list has been refreshed with the latest data.`,
        [
          { text: "OK", onPress: clearSyncResult }
        ]
      );
    }
  }, [lastSyncResult, clearSyncResult]);
  
  // Get list info for shared status
  const { data: listInfo } = useGroceryListInfo(!!isSignedIn);

  // Pass isSignedIn to prevent queries from running when not authenticated
  const {
    data: groceryItems,
    isLoading,
    isError,
    isRefetchError,
    refetch,
    isRefetching,
  } = useGroceryList(showChecked, isSignedIn);
  const { data: countData } = useGroceryCount(isSignedIn);

  // Refetch when tab gains focus to ensure we always have fresh data
  // This is critical for shared lists where others may have made changes
  useFocusEffect(
    useCallback(() => {
      if (isSignedIn) {
        // Force refetch to get the latest data from server
        // This ensures we don't show stale cache data
        refetch();
      }
      if (isSignedIn && focusAdd === '1') {
        const focusTimer = setTimeout(() => {
          addItemInputRef.current?.focus();
          router.setParams({ focusAdd: undefined });
        }, 150);
        return () => clearTimeout(focusTimer);
      }
    }, [focusAdd, isSignedIn, refetch, router])
  );
  const toggleMutation = useToggleGroceryItem();
  const deleteMutation = useDeleteGroceryItem();
  const clearCheckedMutation = useClearCheckedItems();
  const clearAllMutation = useClearAllItems();
  const addItemMutation = useAddGroceryItem();
  const deleteItemsMutation = useDeleteGroceryItems();
  const updateItemMutation = useUpdateGroceryItem();

  // Widget rows can open the existing edit sheet for one specific item. Wait
  // for the authenticated snapshot so a cold-start deep link is reliable.
  useEffect(() => {
    if (
      !isSignedIn
      || !editItem
      || !groceryItems
      || isRefetching
      || isRefetchError
    ) return;
    const requestedItem = groceryItems.find((item) => item.id === editItem);
    if (requestedItem) {
      setEditingItem(requestedItem);
    } else if (!showChecked) {
      // A checked widget row may target an item hidden by the in-app filter.
      setShowChecked(true);
      return;
    }
    router.setParams({ editItem: undefined });
  }, [
    editItem,
    groceryItems,
    isRefetchError,
    isRefetching,
    isSignedIn,
    router,
    showChecked,
  ]);

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

  const normalizedSearchQuery = searchQuery.trim();
  const isSearching = normalizedSearchQuery.length > 0;
  const visibleItems = useMemo(
    () => filterGroceryItems(groceryItems ?? [], normalizedSearchQuery),
    [groceryItems, normalizedSearchQuery],
  );
  const sections = useMemo(() => groupGroceryItems(visibleItems), [visibleItems]);

  // Title lookup keeps collapse choices saved by older app versions working.
  const isSectionCollapsed = useCallback(
    (section: GrocerySection) =>
      !isSearching
      && (collapsedSections.has(section.key) || collapsedSections.has(section.title)),
    [collapsedSections, isSearching],
  );

  const toggleSection = (section: GrocerySection) => {
    haptics.light();
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(section.key) || next.has(section.title)) {
        next.delete(section.key);
        next.delete(section.title);
      } else {
        next.add(section.key);
      }
      saveCollapsedSections(next);
      return next;
    });
  };

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);
  
  const handleToggle = (item: GroceryItem) => {
    haptics.light();
    toggleMutation.mutate(
      { id: item.id, checked: !item.checked },
      { onError: () => Alert.alert('Error', 'Failed to update item') },
    );
  };

  const handleDelete = (id: string, name: string) => {
    haptics.warning();
    Alert.alert('Delete Item', `Remove "${name}" from your list?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteMutation.mutate(id, {
            onError: () => Alert.alert('Error', 'Failed to delete item'),
          }),
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
          onPress: () =>
            clearCheckedMutation.mutate(undefined, {
              onError: () => Alert.alert('Error', 'Failed to clear checked items'),
            }),
        },
      ]
    );
  };

  const handleClearAll = () => {
    const totalItems = countData?.total ?? groceryItems?.length ?? 0;
    
    if (totalItems === 0) return;
    
    Alert.alert(
      'Clear All Items',
      `Remove all ${totalItems} item${totalItems !== 1 ? 's' : ''} from your grocery list? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () =>
            clearAllMutation.mutate(undefined, {
              onError: () => Alert.alert('Error', 'Failed to clear the grocery list'),
            }),
        },
      ]
    );
  };

  const handleClearRecipeSection = (section: GrocerySection) => {
    if (!section.recipeId) return;
    
    Alert.alert(
      'Clear Recipe Items',
      `Remove all ${section.totalCount} item${section.totalCount !== 1 ? 's' : ''} from "${section.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            haptics.medium();
            deleteItemsMutation.mutate(
              section.data.map((item) => item.id),
              { onError: () => Alert.alert('Error', 'Failed to clear recipe items') },
            );
          },
        },
      ]
    );
  };

  const handleAddItem = (keepInputFocused = false) => {
    if (!newItemName.trim()) return;
    
    haptics.success();
    
    // Auto-expand "Other Items" section since that's where new items go
    if (
      collapsedSections.has(OTHER_GROCERY_SECTION_KEY) ||
      collapsedSections.has('Other Items')
    ) {
      setCollapsedSections(prev => {
        const next = new Set(prev);
        next.delete(OTHER_GROCERY_SECTION_KEY);
        next.delete('Other Items');
        saveCollapsedSections(next);
        return next;
      });
    }
    
    addItemMutation.mutate(
      { name: newItemName.trim() },
      {
        onSuccess: () => {
          setNewItemName('');
          setSearchQuery('');
          if (keepInputFocused) {
            // The visible add button supports rapid, repeated entry. The
            // keyboard's Done key intentionally ends entry and stays blurred.
            setTimeout(() => {
              addItemInputRef.current?.focus();
            }, 100);
          } else {
            Keyboard.dismiss();
          }
        },
        onError: () => Alert.alert('Error', 'Failed to add item'),
      }
    );
  };

  const formatGroceryListAsText = () => {
    if (!groceryItems || groceryItems.length === 0) return '';
    
    let text = 'Grocery List\n\n';
    
    // Format items with simple list style
    const formatItem = (item: GroceryItem) => {
      const marker = item.checked ? '[x]' : '[ ]';
      const qty = item.quantity && item.quantity !== 'null' ? item.quantity : '';
      const unit = item.unit && item.unit !== 'null' ? item.unit : '';
      const qtyUnit = qty ? `${qty}${unit ? ' ' + unit : ''} ` : '';
      const notes = item.notes && item.notes !== 'null' ? ` (${item.notes})` : '';
      return `${marker} ${qtyUnit}${item.name}${notes}`;
    };

    sections.forEach((section, index) => {
      if (index > 0) text += '\n';
      text += `${section.title}\n`;
      section.data.forEach(item => {
          text += formatItem(item) + '\n';
      });
    });

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
    } catch {
      // Share cancelled by user - not an error
    }
  };

  const handleEdit = (item: GroceryItem) => {
    setEditingItem(item);
  };

  const handleSaveEdit = async (updates: { name: string; quantity: string; unit: string; notes: string }) => {
    if (!editingItem) return;
    
    try {
      await updateItemMutation.mutateAsync({
        id: editingItem.id,
        changes: {
          name: updates.name,
          quantity: updates.quantity || null,
          unit: updates.unit || null,
          notes: updates.notes || null,
        },
      });
      setEditingItem(null);
    } catch {
      Alert.alert('Error', 'Failed to update item');
    }
  };

  const renderItem = ({ item, index, section }: { item: GroceryItem; index: number; section: GrocerySection }) => {
    // Don't render if section is collapsed
    if (isSectionCollapsed(section)) {
      return null;
    }

    return (
      <AnimatedListItem index={index} delay={30}>
        <GroceryItemRow
          item={item}
          colors={colors}
          onToggle={() => handleToggle(item)}
          onDelete={() => handleDelete(item.id, item.name)}
          onEdit={() => handleEdit(item)}
          showRecipeLabel={false}
          isSharedList={listInfo?.is_shared ?? false}
          scaleFontSize={scaleFontSize}
        />
      </AnimatedListItem>
    );
  };

  const renderSectionHeader = ({ section }: { section: GrocerySection }) => (
    <GrocerySectionHeader
      section={section}
      isCollapsed={isSectionCollapsed(section)}
      isCollapsible={!isSearching}
      onToggle={() => toggleSection(section)}
      onOpenRecipe={(recipeId) => router.push(appRoutes.recipe(recipeId))}
      onClearSection={section.recipeId ? () => handleClearRecipeSection(section) : undefined}
    />
  );

  const ListEmpty = () => {
    // Show loading indicator if data is being fetched
    if (isLoading) {
      return (
        <RNView style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary, marginTop: spacing.md }]}>
            Loading your grocery list...
          </Text>
        </RNView>
      );
    }

    if (isError && !groceryItems?.length) {
      return (
        <RNView style={styles.emptyContainer}>
          <Ionicons name="cloud-offline-outline" size={56} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Couldn’t load your list</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>Check your connection and try again.</Text>
          <Button
            title={isRefetching ? 'Trying again…' : 'Try again'}
            onPress={() => refetch()}
            disabled={isRefetching}
            style={styles.emptyPrimaryAction}
          />
        </RNView>
      );
    }

    if (isSearching) {
      return (
        <RNView style={styles.emptyContainer}>
          <Ionicons name="search-outline" size={56} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No matching items</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>Try another search or clear it to see your list.</Text>
          <Button
            title="Clear search"
            variant="outline"
            onPress={() => setSearchQuery('')}
            style={styles.emptyPrimaryAction}
          />
        </RNView>
      );
    }

    if (!showChecked && (countData?.checked ?? 0) > 0) {
      return (
        <RNView style={styles.emptyContainer}>
          <Ionicons name="checkmark-circle-outline" size={64} color={colors.success} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Everything is checked off</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>Nice work. You can review checked items or clear them when you’re ready.</Text>
          <Button
            title="View all items"
            variant="outline"
            onPress={() => setShowChecked(true)}
            style={styles.emptyPrimaryAction}
          />
        </RNView>
      );
    }
    
    return (
      <RNView style={styles.emptyContainer}>
        <Ionicons name="cart-outline" size={64} color={colors.textMuted} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          Your grocery list is empty
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          Add items manually above, or add ingredients from a recipe
        </Text>
        <RNView style={styles.emptyActions}>
          <Button
            title="Browse recipes"
            onPress={() => router.push(appRoutes.discover)}
            style={styles.emptyAction}
          />
          {isSignedIn && (
            <Button
              title="Open meal plan"
              variant="outline"
              onPress={() => router.push(appRoutes.planner)}
              style={styles.emptyAction}
            />
          )}
        </RNView>
      </RNView>
    );
  };

  // Handle overflow menu actions
  const handleShowOverflowMenu = () => {
    haptics.light();
    const hasCheckedItems = (countData?.checked ?? 0) > 0 || groceryItems?.some(item => item.checked);
    const hasItems = (countData?.total ?? 0) > 0 || (groceryItems?.length ?? 0) > 0;
    
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
    
    if (hasCheckedItems) {
      options.push({
        text: `Clear checked (${countData?.checked ?? 0})`,
        onPress: handleClearChecked,
      });
    }
    
    if (hasItems) {
      options.push({
        text: 'Export list',
        onPress: handleExportList,
      });
      options.push({
        text: 'Clear all items',
        style: 'destructive',
        onPress: handleClearAll,
      });
    }
    
    options.push({ text: 'Cancel', style: 'cancel' });
    
    Alert.alert('Actions', undefined, options);
  };

  // Build subtitle text
  const getSubtitleText = () => {
    const itemCount = countData?.unchecked ?? 0;
    const itemText = itemCount === 1 ? '1 item left' : `${itemCount} items left`;
    
    if (listInfo?.is_shared) {
      return `Shared · ${itemText}`;
    }
    return itemText;
  };

  return (
    <RNView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Fixed header with input */}
      <RNView style={styles.header}>
        {/* Title row - clean with just title and icons */}
        <RNView style={styles.titleRow}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Grocery List</Text>
          <RNView style={styles.headerButtons}>
            <TouchableOpacity 
              onPress={() => {
                haptics.light();
                refetch();
              }} 
              style={styles.headerIconButton}
              disabled={isRefetching}
            >
              <Ionicons 
                name="refresh-outline" 
                size={22} 
                color={isRefetching ? colors.textMuted : colors.tint} 
              />
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => setShowSettings(true)} 
              style={styles.headerIconButton}
            >
              <Ionicons name="settings-outline" size={22} color={colors.tint} />
            </TouchableOpacity>
          </RNView>
        </RNView>

        {/* Subtitle row - shared status + item count */}
        <TouchableOpacity 
          style={styles.subtitleRow}
          onPress={listInfo?.is_shared ? () => setShowSettings(true) : undefined}
          activeOpacity={listInfo?.is_shared ? 0.7 : 1}
        >
          {listInfo?.is_shared && (
            <Ionicons name="people" size={14} color={colors.success} style={styles.subtitleIcon} />
          )}
          <Text style={[styles.subtitleText, { color: colors.textSecondary }]}>
            {getSubtitleText()}
          </Text>
          {isRefetching && (
            <ActivityIndicator size="small" color={colors.tint} style={styles.subtitleSpinner} />
          )}
        </TouchableOpacity>

        {/* Add item input */}
        <RNView style={[styles.addItemRow, { borderColor: colors.border }]}>
          <TextInput
            ref={addItemInputRef}
            style={[styles.addItemInput, { color: colors.text }]}
            placeholder="Add an item..."
            placeholderTextColor={colors.textMuted}
            value={newItemName}
            onChangeText={setNewItemName}
            onSubmitEditing={() => handleAddItem(false)}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            maxLength={255}
            accessibilityLabel="Add grocery item"
          />
          <TouchableOpacity
            onPress={() => handleAddItem(true)}
            disabled={!newItemName.trim()}
            style={[
              styles.addButton,
              { backgroundColor: newItemName.trim() ? colors.tint : colors.border },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Add item and keep typing"
          >
            <Ionicons name="add" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </RNView>

        <RNView style={[styles.searchRow, { backgroundColor: colors.backgroundSecondary }]}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search items or recipes"
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="never"
            maxLength={100}
            accessibilityLabel="Search grocery items and recipes"
          />
          {isSearching && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.clearSearchButton}
              accessibilityRole="button"
              accessibilityLabel="Clear grocery search"
            >
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </RNView>

        {/* Focus the shopping view while keeping completed items close by. */}
        {((countData && countData.total > 0) || (groceryItems && groceryItems.length > 0)) && (
          <RNView style={styles.actionRow}>
            <RNView
              style={[styles.viewSelector, { backgroundColor: colors.backgroundSecondary }]}
              accessibilityRole="tablist"
            >
              <TouchableOpacity
                onPress={() => setShowChecked(false)}
                style={[styles.viewOption, !showChecked && { backgroundColor: colors.card }]}
                accessibilityRole="tab"
                accessibilityLabel={`${countData?.unchecked ?? 0} items to buy`}
                accessibilityState={{ selected: !showChecked }}
              >
                <Text style={[styles.viewOptionText, { color: !showChecked ? colors.text : colors.textMuted }]}>
                  To buy ({countData?.unchecked ?? 0})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowChecked(true)}
                style={[styles.viewOption, showChecked && { backgroundColor: colors.card }]}
                accessibilityRole="tab"
                accessibilityLabel={`${countData?.total ?? groceryItems?.length ?? 0} total grocery items`}
                accessibilityState={{ selected: showChecked }}
              >
                <Text style={[styles.viewOptionText, { color: showChecked ? colors.text : colors.textMuted }]}>
                  All ({countData?.total ?? groceryItems?.length ?? 0})
                </Text>
              </TouchableOpacity>
            </RNView>

            <TouchableOpacity
              onPress={handleShowOverflowMenu}
              style={[styles.overflowButton, { backgroundColor: colors.backgroundSecondary }]}
              accessibilityRole="button"
              accessibilityLabel="More grocery list actions"
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </RNView>
        )}
      </RNView>

      <SectionList
        sections={sections}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingBottom: guestPromptBottomPadding(
              Math.max(insets.bottom, 80) + spacing.xl,
              Boolean(isSignedIn),
              guestPromptHeight,
            ),
          },
        ]}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        onTouchStart={() => Keyboard.dismiss()}
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
        isLoading={updateItemMutation.isPending}
      />

      {/* Settings Modal */}
      <GroceryListSettingsModal
        isVisible={showSettings}
        onClose={() => setShowSettings(false)}
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
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconButton: {
    padding: spacing.sm,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  subtitleIcon: {
    marginRight: spacing.xs,
  },
  subtitleText: {
    fontSize: fontSize.sm,
  },
  subtitleSpinner: {
    marginLeft: spacing.sm,
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
  searchRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: fontSize.sm,
  },
  clearSearchButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: radius.md,
  },
  viewOption: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    justifyContent: 'center',
  },
  viewOptionText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  overflowButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
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
    flex: 1,
    flexShrink: 1,
  },
  itemNameWithLabel: {
    flex: 1,
    flexShrink: 1,
    maxWidth: '70%',
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  itemNameChecked: {
    textDecorationLine: 'line-through',
  },
  addedByLabel: {
    fontSize: fontSize.xs,
    fontStyle: 'italic',
    flexShrink: 0,
    maxWidth: '30%',
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
  emptyActions: {
    width: '100%',
    maxWidth: 320,
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  emptyPrimaryAction: {
    width: '100%',
    maxWidth: 320,
    marginTop: spacing.lg,
  },
  emptyAction: {
    width: '100%',
  },
});
