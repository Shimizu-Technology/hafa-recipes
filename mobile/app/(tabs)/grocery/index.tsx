import { useRecipeOwnerGeneration } from '@/hooks/useOfflineLease';
/**
 * Grocery List Screen
 * 
 * Shows the user's grocery list grouped by recipe with collapsible sections.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  StyleSheet,
  PanResponder,
  SectionList,
  useWindowDimensions,
  ScrollView,
  Modal,
  TouchableOpacity,
  RefreshControl,
  View as RNView,
  Alert,
  TextInput,
  Keyboard,
  Platform,
  Share,
  ActivityIndicator,
  ActionSheetIOS,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { usePantrySnapshot, useTransferGroceriesToPantry } from '@/hooks/usePantry';

import { View, Text, Button, useColors } from '@/components/Themed';
import { SignInBanner } from '@/components/SignInBanner';
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
  usePendingGrocerySync,
  useGroceryListInfo,
  useDeleteGroceryItems,
  useUpdateGroceryItem,
} from '@/hooks/useGrocery';
import { GroceryItem } from '@/types/recipe';
import { spacing, fontSize, fontFamily, fontWeight, radius } from '@/constants/Colors';
import { useTextSize } from '@/hooks/useTextSize';
import { haptics } from '@/utils/haptics';
import { showToast } from '@/lib/toast';
import { ScalePressable } from '@/components/Animated';
import {
  GrocerySection,
  groupGroceryItems,
  OTHER_GROCERY_SECTION_KEY,
} from '@/lib/grocerySections';
import { appRoutes } from '@/lib/routes';
import { filterGroceryItems } from '@/lib/groceryFilters';
import {
  hasStatedIngredientAmount,
  MISSING_AMOUNT_LABEL,
  normalizeIngredientUnit,
} from '@/lib/recipeTrust';

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
  const hasAmount = hasStatedIngredientAmount(item.quantity);
  const showMissingAmount = Boolean(item.recipe_id) && !hasAmount;
  const normalizedUnit = normalizeIngredientUnit(item.unit);
  const hasNotes = Boolean(item.notes && item.notes !== 'null');
  const itemName = [hasAmount && item.quantity, hasAmount && normalizedUnit, item.name]
    .filter(Boolean)
    .join(' ');
  // The row groups its children, so read every visible detail in order.
  const itemLabel = [
    itemName,
    isSharedList && item.added_by_name && `Added by ${item.added_by_name}`,
    showMissingAmount && MISSING_AMOUNT_LABEL,
    showRecipeLabel && item.recipe_title && `from ${item.recipe_title}`,
    hasNotes && item.notes,
  ]
    .filter(Boolean)
    .join(', ');

  const [swiped, setSwiped] = useState(false);
  const swipe = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
    onPanResponderRelease: (_, gesture) => setSwiped(gesture.dx < -40),
  });
  const openMenu = () => {
    const actions = [{ text: 'Edit item', onPress: onEdit }, { text: 'Delete item', style: 'destructive' as const, onPress: onDelete }, { text: 'Cancel', style: 'cancel' as const }];
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ title: item.name, options: actions.map(action => action.text), cancelButtonIndex: 2, destructiveButtonIndex: 1 }, index => actions[index]?.onPress?.());
    else Alert.alert(item.name, undefined, actions);
  };
  return <RNView {...swipe.panHandlers} style={{ flexDirection: 'row', backgroundColor: colors.backgroundElevated }}>
    <RNView style={[styles.itemRow, { flex: 1, backgroundColor: colors.backgroundElevated }]}>
      <TouchableOpacity onPress={onToggle} activeOpacity={1} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
        accessibilityRole="checkbox" accessibilityState={{ checked: item.checked }} accessibilityLabel={itemLabel}>
        <Ionicons name={item.checked ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={item.checked ? colors.tint : colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onEdit} onLongPress={openMenu} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
        accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`}
        accessibilityActions={[{ name: 'remove', label: `Remove ${item.name}` }]}
        onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'remove') onDelete(); }}>
        <Text style={[styles.itemName, { fontSize: scaleFontSize(17), lineHeight: scaleFontSize(22), color: item.checked ? colors.textSecondary : colors.text }, item.checked && styles.itemNameChecked]}>{item.name}</Text>
        {(hasAmount || showMissingAmount || hasNotes || (isSharedList && item.added_by_name)) && <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18 }}>
          {[hasAmount && [item.quantity, normalizedUnit].filter(Boolean).join(' '), showMissingAmount && MISSING_AMOUNT_LABEL, hasNotes && item.notes, isSharedList && item.added_by_name && `Added by ${item.added_by_name}`].filter(Boolean).join(' · ')}
        </Text>}
      </TouchableOpacity>
    </RNView>
    {swiped && <TouchableOpacity onPress={onDelete} accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`} style={{ backgroundColor: colors.destructive, paddingHorizontal: 16, justifyContent: 'center' }}><Text style={{ color: colors.onError }}>Delete</Text></TouchableOpacity>}
  </RNView>;
}

export default function GroceryScreen() {
  const generation = useRecipeOwnerGeneration();
  return <GroceryScreenContent key={generation} />;
}

function GroceryScreenContent() {
  const { fontScale } = useWindowDimensions();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn } = useAuth();
  const isAuthenticated = isLoaded && isSignedIn === true;
  const isGuest = isLoaded && isSignedIn === false;
  const { scaleFontSize } = useTextSize();
  const router = useRouter();
  const { focusAdd, editItem } = useLocalSearchParams<{
    focusAdd?: string;
    editItem?: string;
  }>();
  
  // Ref for the add item input to maintain focus
  const addItemInputRef = useRef<TextInput>(null);
  
  const [addPendingSync, setAddPendingSync] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showChecked, setShowChecked] = useState(false);
  const [editingItem, setEditingItem] = useState<GroceryItem | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [overflowActions, setOverflowActions] = useState<{ text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] | null>(null);

  // Set up offline sync (syncs pending changes when back online)
  const { lastSyncResult, clearSyncResult } = useGrocerySync(isAuthenticated);
  const { data: hasQueuedChanges } = usePendingGrocerySync(isAuthenticated);
  const [newItemName, setNewItemName] = useState('');
  
  // Show alert when sync has failures
  useEffect(() => {
    if (lastSyncResult && lastSyncResult.failed === 0) setAddPendingSync(false);
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
  const { data: listInfo } = useGroceryListInfo(isAuthenticated);

  // Wait for Clerk before enabling any private grocery request.
  const {
    data: groceryItems,
    isLoading,
    isError,
    isRefetchError,
    serverConfirmedAt,
    freshness,
    refetch,
    isRefetching,
  } = useGroceryList(showChecked, isAuthenticated);
  const { data: countData } = useGroceryCount(isAuthenticated);
  const { data: allGroceryItems } = useGroceryList(true, isAuthenticated);
  const pantry = usePantrySnapshot('active', isAuthenticated);
  const transferToPantry = useTransferGroceriesToPantry();
  const transferredIds = new Set(pantry.data?.transferred_grocery_item_ids ?? []);
  const readyForPantry = (allGroceryItems ?? []).filter((item) => item.checked && !transferredIds.has(item.id));
  const isSharedList = listInfo?.is_shared === true;

  // Shared lists may change elsewhere. Quietly revalidate only after the
  // cached snapshot has aged; tab switches should never trigger pull UI.
  const lastBackgroundRefresh = useRef(0);
  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated && isSharedList && Date.now() - lastBackgroundRefresh.current > 30_000) {
        lastBackgroundRefresh.current = Date.now();
        void refetch();
      }
      if (isAuthenticated && focusAdd === '1') {
        const focusTimer = setTimeout(() => {
          addItemInputRef.current?.focus();
          router.setParams({ focusAdd: undefined });
        }, 150);
        return () => clearTimeout(focusTimer);
      }
    }, [focusAdd, isAuthenticated, isSharedList, refetch, router])
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
      !isAuthenticated
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
    isAuthenticated,
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
  const fullSections = useMemo(() => groupGroceryItems(allGroceryItems ?? groceryItems ?? []), [allGroceryItems, groceryItems]);

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

  const { isPullRefreshing, onPullRefresh } = usePullToRefresh(refetch);
  
  const handleToggle = (item: GroceryItem) => {
    toggleMutation.mutate(
      { id: item.id, checked: !item.checked },
      { onSuccess: () => haptics.light(), onError: () => Alert.alert('Couldn’t update item', 'Your change wasn’t saved. Please try again.') },
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
            onError: () => Alert.alert('Couldn’t delete item', 'The item is still on your list. Please try again.'),
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
              onError: () => Alert.alert('Couldn’t clear checked items', 'Your list wasn’t changed. Please try again.'),
            }),
        },
      ]
    );
  };

  const handleAddCheckedToPantry = () => {
    if (!readyForPantry.length || transferToPantry.isPending) return;
    Alert.alert(
      'Add checked items to pantry?',
      `${readyForPantry.length} item${readyForPantry.length === 1 ? '' : 's'} will be saved in your ${pantry.data?.scope === 'household' ? 'household' : 'personal'} pantry. Your grocery list will stay as it is. You can add dates and edit amounts in Pantry.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add to pantry', onPress: () => transferToPantry.mutate(readyForPantry.map((item) => ({
          grocery_item_id: item.id,
          quantity: item.quantity && /^\d{1,9}(\.\d{1,3})?$/.test(item.quantity.trim()) ? item.quantity.trim() : null,
          unit: item.unit,
          location: null,
          date_kind: null,
          date_value: null,
        })), {
          onSuccess: () => {
            haptics.success();
            showToast({
              message: `${readyForPantry.length} added to your pantry`,
              tone: 'success',
              actionLabel: 'Open pantry',
              onAction: () => router.push(appRoutes.pantry),
            });
          },
          onError: () => Alert.alert('Couldn’t add to pantry', 'Refresh your grocery list and pantry, then try again. Items already added will stay in your pantry.'),
        }) },
      ],
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
              onError: () => Alert.alert('Couldn’t clear the list', 'Your list wasn’t changed. Please try again.'),
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
              { onError: () => Alert.alert('Couldn’t remove recipe items', 'Your list wasn’t changed. Please try again.') },
            );
          },
        },
      ]
    );
  };

  const handleAddItem = (keepInputFocused = false) => {
    if (!newItemName.trim() || addItemMutation.isPending) return;
    
    
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
        onSuccess: (result) => {
          if (result.syncStatus === 'confirmed') {
            haptics.success();
            showToast({ message: 'Item added to grocery list', tone: 'success' });
          }
          setAddPendingSync(result.syncStatus === 'queued');
          setNewItemName(draft => draft.trim() === newItemName.trim() ? '' : draft);
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
        onError: () => Alert.alert('Couldn’t add item', 'The item wasn’t added. Please try again.'),
      }
    );
  };

  const formatGroceryListAsText = () => {
    if (!groceryItems || groceryItems.length === 0) return '';
    
    let text = `Grocery List — ${isSearching ? 'Search matches' : showChecked ? 'All' : 'To buy'}\n\n`;
    
    // Format items with simple list style
    const formatItem = (item: GroceryItem) => {
      const marker = item.checked ? '[x]' : '[ ]';
      const hasAmount = hasStatedIngredientAmount(item.quantity);
      const qty = hasAmount ? item.quantity : '';
      const unit = normalizeIngredientUnit(item.unit) ?? '';
      const qtyUnit = qty ? `${qty}${unit ? ' ' + unit : ''} ` : '';
      const notes = item.notes && item.notes !== 'null' ? ` (${item.notes})` : '';
      const amountWarning = item.recipe_id && !hasAmount ? ` — ${MISSING_AMOUNT_LABEL}` : '';
      return `${marker} ${qtyUnit}${item.name}${notes}${amountWarning}`;
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
    if (visibleItems.length === 0) {
      Alert.alert('No items in this view', 'Add some items to your grocery list first.');
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
      Alert.alert('Couldn’t update item', 'Your change wasn’t saved. Please try again.');
    }
  };

  const renderItem = ({ item, index, section }: { item: GroceryItem; index: number; section: GrocerySection }) => {
    // Don't render if section is collapsed
    if (isSectionCollapsed(section)) {
      return null;
    }

    return (
      <RNView style={{ overflow: 'hidden', borderTopLeftRadius: index === 0 ? 12 : 0, borderTopRightRadius: index === 0 ? 12 : 0, borderBottomLeftRadius: index === section.data.length - 1 ? 12 : 0, borderBottomRightRadius: index === section.data.length - 1 ? 12 : 0 }}>
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
      {index < section.data.length - 1 && <RNView style={{ height: StyleSheet.hairlineWidth, marginLeft: 60, backgroundColor: colors.border }} />}
      </RNView>
    );
  };

  const renderSectionHeader = ({ section }: { section: GrocerySection }) => {
    const fullSection = fullSections.find(candidate => candidate.key === section.key) ?? section;
    return <GrocerySectionHeader
      onShowMenu={setOverflowActions}
      section={fullSection}
      isCollapsed={isSectionCollapsed(section)}
      isCollapsible={!isSearching}
      onToggle={() => toggleSection(section)}
      onOpenRecipe={(recipeId) => router.push(appRoutes.recipe(recipeId))}
      onClearSection={section.recipeId ? () => handleClearRecipeSection(fullSection) : undefined}
    />;
  };

  const ListEmpty = () => {
    if (!isLoaded) {
      return (
        <RNView style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.actionText} />
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Checking your account…
          </Text>
        </RNView>
      );
    }

    if (isGuest) {
      return (
        <RNView style={styles.emptyContainer}>
          <RNView style={[styles.guestIconContainer, { backgroundColor: colors.tint + '15' }]}>
            <Ionicons name="basket-outline" size={42} color={colors.actionText} />
          </RNView>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>One list for the whole meal</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Sign in to add ingredients from recipes, plan your shopping trip, and keep your list in sync.
          </Text>
          <Button
            title="Browse recipes"
            variant="outline"
            onPress={() => router.push(appRoutes.discover)}
            style={styles.emptyPrimaryAction}
          />
        </RNView>
      );
    }

    // Show loading indicator if data is being fetched
    if (isLoading) {
      return (
        <RNView style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.actionText} />
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
          {isAuthenticated && (
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
        text: `Export text — ${isSearching ? 'Search matches' : showChecked ? 'All' : 'To buy'}`,
        onPress: handleExportList,
      });
      options.push({
        text: 'Clear all items',
        style: 'destructive',
        onPress: handleClearAll,
      });
    }
    
    options.push({ text: 'Cancel', style: 'cancel' });
    
    options.unshift({ text: 'Household sharing & list settings', onPress: () => setShowSettings(true) },
      { text: 'Account & Settings', onPress: () => router.push('/settings') },
      { text: 'Refresh list', onPress: () => { void refetch(); } });
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({
      options: options.map(option => option.text), cancelButtonIndex: options.length - 1,
      destructiveButtonIndex: options.findIndex(option => option.text === 'Clear all items'),
    }, index => options[index]?.onPress?.());
    else setOverflowActions(options);
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
    <>
      <Stack.Screen options={{ title: 'Grocery', headerLargeTitleStyle: { fontFamily: fontFamily.display, fontSize: 32, color: colors.text }, headerTitleStyle: { color: colors.text }, headerSearchBarOptions: { placeholder: 'Search grocery list', onChangeText: event => setSearchQuery(event.nativeEvent.text), onCancelButtonPress: () => setSearchQuery('') }, headerRight: () => isAuthenticated ? <TouchableOpacity onPress={handleShowOverflowMenu}
        style={styles.headerIconButton} accessibilityRole="button" accessibilityLabel="More grocery list actions"><Ionicons name="ellipsis-horizontal" size={22} color={colors.actionText} /></TouchableOpacity> : null }} />
      <SectionList
        style={[styles.container, { backgroundColor: colors.groupedBackground }]}
        key={fontScale}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={<RNView style={styles.header}>
        {isGuest && <SignInBanner message="Sign in to create grocery lists" />}
        {/* Editing controls appear only when there is an authenticated list. */}
        {isAuthenticated && (
          <>
        <RNView style={styles.addItemRow}>
          <Ionicons name="add-circle-outline" size={24} color={colors.actionText} />
          <TextInput ref={addItemInputRef} style={[styles.addItemInput, { color: colors.text, lineHeight: 22 }]}
            placeholder="Add an item" placeholderTextColor={colors.textSecondary} value={newItemName} onChangeText={setNewItemName}
            onSubmitEditing={() => handleAddItem(true)} returnKeyType="done" submitBehavior="submit" maxLength={255} accessibilityLabel="Add an item" />
        </RNView>

        {Platform.OS === 'web' && <TextInput accessibilityLabel="Search grocery list" placeholder="Search grocery list" placeholderTextColor={colors.textSecondary}
          value={searchQuery} onChangeText={setSearchQuery} style={{ minHeight: 44, padding: 12, borderRadius: 10, marginBottom: 8, backgroundColor: colors.surface2, color: colors.text }} />}

        {(addPendingSync || hasQueuedChanges || hasQueuedChanges === undefined || freshness === 'checking' || freshness === 'offline' || freshness === 'stale' || isRefetchError) && <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 8 }}>
          {addPendingSync || hasQueuedChanges ? 'Saved on this device · waiting to sync' : hasQueuedChanges === undefined || freshness === 'checking' ? 'Checking sync status…' : freshness === 'offline' ? 'Offline · showing this device’s list' : 'Couldn’t refresh · showing this device’s list'}
        </Text>}

        {/* Focus the shopping view while keeping completed items close by. */}
        {((countData && countData.total > 0) || (groceryItems && groceryItems.length > 0)) && (
          <TouchableOpacity onPress={() => setShowChecked(!showChecked)} accessibilityRole="button"
            accessibilityLabel={showChecked ? 'Show items to buy' : 'Show all grocery items'} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <Text style={{ color: colors.actionText, fontSize: 15, lineHeight: 20 }}>{showChecked ? 'All · Show to buy' : 'To buy · Show all'}</Text>
          </TouchableOpacity>
        )}
          </>
        )}
      </RNView>}
        sections={isAuthenticated ? sections : []}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={isAuthenticated ? <RNView>
        <TouchableOpacity
          onPress={() => router.push(appRoutes.pantry)}
          style={[styles.pantryLink, { backgroundColor: colors.backgroundSecondary }]}
          accessibilityRole="button"
          accessibilityLabel="Open my pantry"
        >
          <Ionicons name="basket-outline" size={19} color={colors.actionText} />
          <Text style={{ color: colors.actionText, fontWeight: fontWeight.semibold, flex: 1 }}>Pantry</Text>
          <Ionicons name="chevron-forward" size={17} color={colors.actionText} />
        </TouchableOpacity>
        {readyForPantry.length > 0 && <TouchableOpacity
          onPress={handleAddCheckedToPantry}
          disabled={transferToPantry.isPending}
          style={[styles.pantryLink, { backgroundColor: colors.success + '14' }]}
          accessibilityRole="button"
          accessibilityLabel={`Add ${readyForPantry.length} checked item${readyForPantry.length === 1 ? '' : 's'} to pantry`}
        >
          <Ionicons name="checkmark-circle-outline" size={19} color={colors.success} />
          <Text style={{ color: colors.success, fontWeight: fontWeight.semibold, flex: 1 }}>
            {transferToPantry.isPending ? 'Adding to pantry…' : `Add ${readyForPantry.length} checked item${readyForPantry.length === 1 ? '' : 's'} to pantry`}
          </Text>
          <Ionicons name="chevron-forward" size={17} color={colors.success} />
        </TouchableOpacity>}
</RNView> : null}
        contentContainerStyle={[
          styles.listContent,
          {
            // The native tab bar inset is applied by contentInsetAdjustmentBehavior.
            paddingBottom: spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        refreshControl={isAuthenticated ? (
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={onPullRefresh}
            tintColor={colors.tint}
          />
        ) : undefined}
      />

      {isAuthenticated && <Modal visible={overflowActions !== null} transparent animationType="fade" onRequestClose={() => setOverflowActions(null)}>
        <RNView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <RNView style={{ backgroundColor: colors.backgroundElevated, padding: 16, paddingBottom: Math.max(16, insets.bottom), borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' }}>
            <ScrollView>
              {overflowActions?.map(action => <TouchableOpacity key={action.text} accessibilityRole="button" accessibilityLabel={action.text}
                style={{ minHeight: 50, paddingVertical: 12 }} onPress={() => { setOverflowActions(null); action.onPress?.(); }}>
                <Text style={{ color: action.style === 'destructive' ? colors.destructive : colors.text }}>{action.text}</Text>
              </TouchableOpacity>)}
            </ScrollView>
          </RNView>
        </RNView>
      </Modal>}

      {/* Edit Modal */}
      {isAuthenticated && <EditGroceryItemModal
        visible={!!editingItem}
        onClose={() => setEditingItem(null)}
        onSave={handleSaveEdit}
        item={editingItem}
        isLoading={updateItemMutation.isPending}
      />}

      {/* Settings Modal */}
      {isAuthenticated && <GroceryListSettingsModal
        isVisible={showSettings}
        onClose={() => setShowSettings(false)}
      />}

    </>
  );
}

const styles = StyleSheet.create({
  pantryLink: {
    minHeight: 44,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: spacing.xxl,
  },
  header: {
    paddingTop: 8,
    paddingBottom: spacing.md,
    paddingHorizontal: 0,
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
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
    borderWidth: 0,
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
    minHeight: 44,
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
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 0,
    borderWidth: 0,
    marginBottom: 0,
  },
  checkbox: {
    marginRight: 12,
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
  missingAmount: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    marginTop: 2,
  },
  editButton: {
    minWidth: 44,
    minHeight: 44,
    // 44pt target without making single-line rows taller.
    marginVertical: -5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    minWidth: 44,
    minHeight: 44,
    // 44pt target without making single-line rows taller.
    marginVertical: -5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: 16,
  },
  guestIconContainer: {
    width: 76,
    height: 76,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
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
