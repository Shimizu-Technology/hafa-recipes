import { useContext } from 'react';
import { TextScaleContext } from '@/components/Themed';
import { TextInput } from '@/components/Themed';
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
  Keyboard,
  Platform,
  Share,
  ActivityIndicator,
  ActionSheetIOS,
  LayoutAnimation,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatIngredientAmount, spokenQuantity } from '@/lib/quantityPresentation';
import { useAuth } from '@clerk/expo';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { usePantrySnapshot, useTransferGroceriesToPantry } from '@/hooks/usePantry';
import { useGroceryCollapse } from '@/hooks/useGroceryCollapse';
import { useReduceMotion } from '@/hooks/useReduceMotion';

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
  useRestoreGroceryItem,
  GroceryListChangedError,
} from '@/hooks/useGrocery';
import { parseGroceryItemInput } from '@/lib/groceryItemInput';
import { GroceryItem } from '@/types/recipe';
import { layout, spacing, fontSize, fontFamily, fontWeight, radius } from '@/constants/Colors';
import { useTabScrollEndPadding } from '@/lib/bottomOverlay';
import { useTabScrollToTop } from '@/lib/tabScrollToTop';
import { HeaderIconButton, headerRightOptions } from '@/components/chrome/HeaderButton';
import { SegmentedControl } from '@/components/chrome/SegmentedControl';
import { AccountHeaderButton } from '@/components/TabChrome';
import { haptics } from '@/utils/haptics';
import { showToast } from '@/lib/toast';
import { ScalePressable } from '@/components/Animated';
import {
  GrocerySection,
  groupGroceryItems,
  OTHER_GROCERY_SECTION_KEY,
  OTHER_GROCERY_SECTION_TITLE,
} from '@/lib/grocerySections';
import { appRoutes } from '@/lib/routes';
import { filterGroceryItems } from '@/lib/groceryFilters';
import { showsSectionHeaders } from '@/lib/groceryCollapse';
import {
  hasStatedIngredientAmount,
  MISSING_AMOUNT_LABEL,
  normalizeIngredientUnit,
} from '@/lib/recipeTrust';

/** A quick fold that settles before the next tap; Reduce Motion skips it. */
const SECTION_FOLD_ANIMATION = LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity);

function GroceryItemRow({
  item,
  colors,
  onToggle,
  onDelete,
  onEdit,
  swiped,
  onSwipe,
  showRecipeLabel = false,
  isSharedList = false,
  scaleFontSize,
}: {
  item: GroceryItem;
  colors: ReturnType<typeof useColors>;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  /** Whether the Delete button is showing. */
  swiped: boolean;
  onSwipe: (open: boolean) => void;
  showRecipeLabel?: boolean;
  isSharedList?: boolean;
  scaleFontSize: (size: number) => number;
}) {
  const { fontScale } = useWindowDimensions();
  const textScale = useContext(TextScaleContext);
  const firstLineHeight = scaleFontSize(22) * textScale * fontScale;
  const hasAmount = hasStatedIngredientAmount(item.quantity);
  const showMissingAmount = Boolean(item.recipe_id) && !hasAmount;
  const normalizedUnit = normalizeIngredientUnit(item.unit);
  const displayedAmount = formatIngredientAmount(item.quantity, normalizedUnit);
  const hasNotes = Boolean(item.notes && item.notes !== 'null');
  const itemName = [hasAmount && displayedAmount, item.name]
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

  // The screen keeps one row open at a time, so a scroll or any other tap
  // closes it. The responder reads the latest handler through a ref.
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
    // Once a sideways swipe has started, the list doesn't take it over.
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, gesture) => onSwipeRef.current(gesture.dx < -40),
  })).current;
  const openMenu = () => {
    const actions = [{ text: 'Edit item', onPress: onEdit }, { text: 'Delete item', style: 'destructive' as const, onPress: onDelete }, { text: 'Cancel', style: 'cancel' as const }];
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ title: item.name, options: actions.map(action => action.text), cancelButtonIndex: 2, destructiveButtonIndex: 1 }, index => actions[index]?.onPress?.());
    else Alert.alert(item.name, undefined, actions);
  };
  return <RNView {...swipe.panHandlers} style={{ flexDirection: 'row', backgroundColor: colors.backgroundElevated }}>
    <RNView style={[styles.itemRow, { flex: 1, backgroundColor: colors.backgroundElevated }]}>
      <TouchableOpacity onPress={onToggle} activeOpacity={1} style={[styles.itemCheck, { top: 12 + (firstLineHeight - 44) / 2 }]}
        accessibilityRole="checkbox" accessibilityState={{ checked: item.checked }} accessibilityLabel={spokenQuantity(itemLabel)}>
        <Ionicons name={item.checked ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={item.checked ? colors.actionText : colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onEdit} onLongPress={openMenu} style={styles.itemBody}
        accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`}
        accessibilityActions={[{ name: 'remove', label: `Remove ${item.name}` }]}
        onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'remove') onDelete(); }}>
        <RNView style={styles.itemText}>
          <Text style={[styles.itemName, { fontSize: scaleFontSize(17), lineHeight: scaleFontSize(22), color: item.checked ? colors.textSecondary : colors.text }, item.checked && styles.itemNameChecked]}>{item.name}</Text>
          {(hasAmount || showMissingAmount || hasNotes || (isSharedList && item.added_by_name)) && <Text style={{ color: colors.textSecondary, fontSize: scaleFontSize(15), lineHeight: scaleFontSize(21), marginTop: 4 }}>
            {[hasAmount && displayedAmount, showMissingAmount && MISSING_AMOUNT_LABEL, hasNotes && item.notes, isSharedList && item.added_by_name && `Added by ${item.added_by_name}`].filter(Boolean).join(' · ')}
          </Text>}
        </RNView>
        {/* A quiet hint that the name opens the editor; centred on the first line. */}
        {!swiped && <Ionicons name="pencil" size={15} color={colors.textSecondary} style={[styles.editHint, { marginTop: (firstLineHeight - 15) / 2 }]} />}
      </TouchableOpacity>
    </RNView>
    {swiped && <TouchableOpacity onPress={onDelete} accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`} style={[styles.swipeDelete, { backgroundColor: colors.destructive }]}>
      <Ionicons name="trash-outline" size={19} color={colors.onError} />
      <Text style={[styles.swipeDeleteLabel, { color: colors.onError }]}>Delete</Text>
    </TouchableOpacity>}
  </RNView>;
}

export default function GroceryScreen() {
  const generation = useRecipeOwnerGeneration();
  return <GroceryScreenContent key={generation} />;
}

function GroceryScreenContent() {
  const { fontScale } = useWindowDimensions();
  // At accessibility text sizes the view switch and Pantry get their own rows
  // so neither squeezes the other.
  const stackToolbar = fontScale * useContext(TextScaleContext) >= 1.35;
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const endPadding = useTabScrollEndPadding(spacing.xl);
  const listRef = useRef<SectionList<GroceryItem, any>>(null);
  const tabScroll = useTabScrollToTop('grocery', listRef);
  const { isLoaded, isSignedIn } = useAuth();
  const isAuthenticated = isLoaded && isSignedIn === true;
  const isGuest = isLoaded && isSignedIn === false;
  const scaleFontSize = (size: number) => size; // Shared Text applies the app preference.
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
  // The one row whose Delete button is showing.
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
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
  const { data: listInfo, accountScopeId } = useGroceryListInfo(isAuthenticated);

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
  const reduceMotion = useReduceMotion();

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
  const restoreItemMutation = useRestoreGroceryItem();

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

  const normalizedSearchQuery = searchQuery.trim();
  const isSearching = normalizedSearchQuery.length > 0;
  const visibleItems = useMemo(
    () => filterGroceryItems(groceryItems ?? [], normalizedSearchQuery),
    [groceryItems, normalizedSearchQuery],
  );
  const sections = useMemo(() => groupGroceryItems(visibleItems), [visibleItems]);
  const fullSections = useMemo(() => groupGroceryItems(allGroceryItems ?? groceryItems ?? []), [allGroceryItems, groceryItems]);
  // Folds belong to this account's view of this list. They are tidied against
  // the whole list, never a search or the To buy view.
  const collapseScope = useMemo(
    () => (accountScopeId && listInfo?.id ? { accountScopeId, listId: listInfo.id } : null),
    [accountScopeId, listInfo?.id],
  );
  const collapse = useGroceryCollapse(collapseScope, allGroceryItems ? fullSections : null);
  const showHeaders = showsSectionHeaders(sections);
  // Searching shows every match, so folding pauses until the search clears.
  const canCollapse = showHeaders && !isSearching;
  const isSectionCollapsed = useCallback(
    (section: GrocerySection) => canCollapse && collapse.isCollapsed(section),
    [canCollapse, collapse],
  );
  // A folded section keeps its header and hands the list no rows.
  const shownSections = useMemo(
    () => sections.map(section => isSectionCollapsed(section) ? { ...section, data: [] } : section),
    [isSectionCollapsed, sections],
  );
  const anyExpanded = canCollapse && sections.some(section => !isSectionCollapsed(section));

  const animateFold = () => {
    if (!reduceMotion) LayoutAnimation.configureNext(SECTION_FOLD_ANIMATION);
  };
  const toggleSection = (section: GrocerySection) => {
    haptics.light();
    animateFold();
    collapse.toggle(section);
  };
  const setAllSectionsCollapsed = (collapsed: boolean) => {
    haptics.light();
    animateFold();
    if (collapsed) collapse.setAll(sections, true);
    else collapse.expandAll();
  };

  const { isPullRefreshing, onPullRefresh } = usePullToRefresh(refetch);
  
  const handleToggle = (item: GroceryItem, undoable = true) => {
    toggleMutation.mutate(
      { id: item.id, checked: !item.checked },
      {
        onSuccess: () => {
          haptics.light();
          // To buy hides a checked row at once, so offer the way back that the
          // widget gives with its recently checked rows.
          if (undoable && !item.checked && !showChecked) {
            showToast({ message: `Checked off ${item.name}`, actionLabel: 'Undo', onAction: () => handleToggle({ ...item, checked: true }, false) });
          }
        },
        onError: () => Alert.alert('Couldn’t update item', 'Your change wasn’t saved. Please try again.'),
      },
    );
  };

  const setSwipeOpen = (id: string | null) => {
    if (id === openSwipeId) return;
    if (!reduceMotion) LayoutAnimation.configureNext(SECTION_FOLD_ANIMATION);
    setOpenSwipeId(id);
  };
  // While a row shows Delete, a tap anywhere else only closes it, as in iOS lists.
  const unlessSwipeOpen = (action: () => void) => () => {
    if (openSwipeId) setSwipeOpen(null);
    else action();
  };

  // One item goes at once, with Undo in place of a confirmation.
  const handleDelete = (item: GroceryItem) => {
    setOpenSwipeId(null);
    haptics.medium();
    deleteMutation.mutate(item.id, {
      // Undo returns the item only to the list it was deleted from.
      onSuccess: (deleted) => showToast({
        message: `Deleted ${item.name}`,
        actionLabel: 'Undo',
        onAction: () => restoreItemMutation.mutate({ item, accountScopeId: deleted.account_scope_id, listId: deleted.list.id }, {
          onError: (error) => error instanceof GroceryListChangedError
            ? Alert.alert('Your list changed', `${item.name} was on a different list, so it can’t come back here.`)
            : Alert.alert('Couldn’t bring the item back', 'Add it again from the top of your list.'),
        }),
      }),
      onError: () => Alert.alert('Couldn’t delete item', 'The item is still on your list. Please try again.'),
    });
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
    
    
    // New items land in "Other", so unfold it to show them arriving.
    const otherSection = { key: OTHER_GROCERY_SECTION_KEY, title: OTHER_GROCERY_SECTION_TITLE };
    if (collapse.isCollapsed(otherSection)) collapse.setAll([otherSection], false);
    
    addItemMutation.mutate(
      parseGroceryItemInput(newItemName),
      {
        onSuccess: (result) => {
          if (result.syncStatus === 'confirmed') {
            haptics.success();
            showToast({ message: 'Item added to grocery list', tone: 'success' });
          }
          setAddPendingSync(result.syncStatus === 'queued');
          setNewItemName(draft => draft.trim() === newItemName.trim() ? '' : draft);
          if (keepInputFocused) {
            // Return adds and stays ready for the next item; Return on an
            // empty field ends entry.
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
      const amount = hasAmount ? formatIngredientAmount(item.quantity, normalizeIngredientUnit(item.unit)) : '';
      const qtyUnit = amount ? `${amount} ` : '';
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
    // Otherwise iOS hands focus back to "Add an item" when the sheet closes
    // and the keyboard covers the list.
    addItemInputRef.current?.blur();
    Keyboard.dismiss();
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
    const firstOfSheet = !showHeaders && index === 0 && section.key === shownSections[0]?.key;
    const lastOfSheet = index === section.data.length - 1 && section.key === shownSections[shownSections.length - 1]?.key;
    return (
      // Every section shares one sheet; only its outermost rows round their corners.
      <RNView style={{ overflow: 'hidden', ...(firstOfSheet ? { borderTopLeftRadius: 16, borderTopRightRadius: 16 } : null), ...(lastOfSheet ? { borderBottomLeftRadius: 16, borderBottomRightRadius: 16 } : null) }}>
      <GroceryItemRow
        item={item}
        colors={colors}
        onToggle={unlessSwipeOpen(() => handleToggle(item))}
        onDelete={() => handleDelete(item)}
        onEdit={unlessSwipeOpen(() => handleEdit(item))}
        swiped={openSwipeId === item.id}
        onSwipe={open => setSwipeOpen(open ? item.id : null)}
        showRecipeLabel={false}
        isSharedList={listInfo?.is_shared ?? false}
        scaleFontSize={scaleFontSize}
      />
      {index < section.data.length - 1 && <RNView style={{ height: StyleSheet.hairlineWidth, marginLeft: 60, backgroundColor: colors.hairline }} />}
      </RNView>
    );
  };

  const renderSectionHeader = ({ section }: { section: GrocerySection }) => {
    if (!showHeaders) return null;
    const fullSection = fullSections.find(candidate => candidate.key === section.key) ?? section;
    return <GrocerySectionHeader
      onShowMenu={setOverflowActions}
      section={fullSection}
      isCollapsed={isSectionCollapsed(section)}
      isCollapsible={canCollapse}
      onToggle={unlessSwipeOpen(() => toggleSection(section))}
      first={section.key === shownSections[0]?.key}
      last={section.key === shownSections[shownSections.length - 1]?.key}
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
      <Stack.Screen options={{ title: 'Grocery', headerLargeTitleStyle: { fontFamily: fontFamily.display, fontSize: 34, color: colors.text }, headerTitleStyle: { fontFamily: fontFamily.semibold, color: colors.text }, headerSearchBarOptions: { placement: 'stacked', placeholder: 'Search grocery list', onChangeText: event => setSearchQuery(event.nativeEvent.text), onCancelButtonPress: () => setSearchQuery('') }, ...headerRightOptions(() => <>{isAuthenticated && <HeaderIconButton icon="ellipsis-horizontal" accessibilityLabel="More grocery list actions" onPress={handleShowOverflowMenu} />}<AccountHeaderButton /></>) }} />
      <SectionList
        ref={listRef}
        {...tabScroll}
        onScrollBeginDrag={event => {
          tabScroll.onScrollBeginDrag(event);
          if (openSwipeId) setSwipeOpen(null);
        }}
        style={[styles.container, { backgroundColor: colors.groupedBackground }]}
        key={fontScale}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={<RNView style={styles.header}>
        {isGuest && <SignInBanner message="Sign in to create grocery lists" />}
        {/* Editing controls appear only when there is an authenticated list. */}
        {isAuthenticated && (
          <>
        <RNView style={[styles.addItemRow, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
          <Ionicons name="add-circle-outline" size={24} color={colors.actionText} />
          <TextInput ref={addItemInputRef} style={[styles.addItemInput, { color: colors.text, lineHeight: 22 }]}
            placeholder="Add an item" placeholderTextColor={colors.textSecondary} value={newItemName} onChangeText={setNewItemName}
            onSubmitEditing={() => newItemName.trim() ? handleAddItem(true) : addItemInputRef.current?.blur()} returnKeyType="done" submitBehavior="submit" maxLength={255} accessibilityLabel="Add an item" />
        </RNView>

        {Platform.OS === 'web' && <TextInput accessibilityLabel="Search grocery list" placeholder="Search grocery list" placeholderTextColor={colors.textSecondary}
          value={searchQuery} onChangeText={setSearchQuery} style={{ minHeight: 44, padding: 12, borderRadius: 10, marginBottom: 8, backgroundColor: colors.surface2, color: colors.text }} />}

        {(addPendingSync || hasQueuedChanges || hasQueuedChanges === undefined || freshness === 'checking' || freshness === 'offline' || freshness === 'stale' || isRefetchError) && <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 8 }}>
          {addPendingSync || hasQueuedChanges ? 'Saved on this device · waiting to sync' : hasQueuedChanges === undefined || freshness === 'checking' ? 'Checking sync status…' : freshness === 'offline' ? 'Offline · showing this device’s list' : 'Couldn’t refresh · showing this device’s list'}
        </Text>}

        {/* Focus the shopping view while keeping completed items close by. */}
        <RNView style={[styles.viewRow, stackToolbar && styles.viewRowStacked]}>
          {((countData && countData.total > 0) || (groceryItems && groceryItems.length > 0)) && <RNView style={stackToolbar ? undefined : { flex: 1 }}>
            <SegmentedControl accessibilityLabel="Grocery view" value={showChecked ? 'all' : 'toBuy'} onChange={value => { setOpenSwipeId(null); setShowChecked(value === 'all'); }}
              options={[{ value: 'toBuy', label: 'To buy' }, { value: 'all', label: 'All' }]} />
          </RNView>}
          {/* Same height, fill and corners as the view switch beside it. */}
          <TouchableOpacity onPress={() => router.push(appRoutes.pantry)} accessibilityRole="button" accessibilityLabel="Open my pantry" style={styles.toolbarTarget}>
            <RNView style={[styles.toolbarButton, stackToolbar && styles.toolbarButtonStacked, { backgroundColor: colors.surface2 }]}>
              <Ionicons name="basket-outline" size={17} color={colors.textSecondary} />
              <Text numberOfLines={1} style={[styles.toolbarLabel, { color: colors.text }]}>Pantry</Text>
            </RNView>
          </TouchableOpacity>
        </RNView>

        {(groceryItems?.length ?? 0) > 0 && <RNView style={styles.summaryRow}>
          <Text style={[styles.summaryText, { color: colors.textSecondary }]}>{isSearching ? `${visibleItems.length} match${visibleItems.length === 1 ? '' : 'es'}` : getSubtitleText()}</Text>
          {canCollapse && sections.length > 1 && <TouchableOpacity onPress={() => setAllSectionsCollapsed(anyExpanded)} accessibilityRole="button"
            accessibilityLabel={anyExpanded ? 'Collapse all recipes' : 'Expand all recipes'} style={styles.summaryAction}>
            <Text style={[styles.summaryActionText, { color: colors.actionText }]}>{anyExpanded ? 'Collapse all' : 'Expand all'}</Text>
          </TouchableOpacity>}
        </RNView>}
          </>
        )}
      </RNView>}
        sections={isAuthenticated ? shownSections : []}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={isAuthenticated ? <RNView>
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
            paddingBottom: endPadding,
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
        onDelete={() => {
          if (!editingItem) return;
          setEditingItem(null);
          handleDelete(editingItem);
        }}
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
    minHeight: 48,
    // Matches the grocery sheet above it.
    borderRadius: 16,
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
    paddingHorizontal: layout.margin,
    paddingBottom: spacing.xxl,
  },
  header: {
    paddingTop: 4,
    paddingBottom: spacing.md,
    paddingHorizontal: 0,
  },
  viewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  // 44pt target around the 36pt control, like the segmented track.
  toolbarTarget: { minHeight: 44, marginVertical: -4, justifyContent: 'center' },
  toolbarButton: { minHeight: 36, borderRadius: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  viewRowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 12 },
  toolbarButtonStacked: { justifyContent: 'center', paddingVertical: 6 },
  toolbarLabel: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, marginTop: 12, marginBottom: -8, paddingLeft: 4 },
  summaryText: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  summaryAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  summaryActionText: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
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
    paddingLeft: 12,
    borderWidth: StyleSheet.hairlineWidth,
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
  itemBody: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  itemText: { flex: 1 },
  editHint: { opacity: 0.6 },
  swipeDelete: { minWidth: 88, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', gap: 2 },
  swipeDeleteLabel: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  itemCheck: { position: 'absolute', left: 6, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  itemRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingLeft: 60,
    paddingRight: 16,
    paddingVertical: 12,
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
