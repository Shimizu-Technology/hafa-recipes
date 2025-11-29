/**
 * Grocery List Screen
 * 
 * Shows the user's grocery list with ability to check off items.
 */

import { useState, useCallback } from 'react';
import {
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  View as RNView,
  Alert,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Button, useColors } from '@/components/Themed';
import EditGroceryItemModal from '@/components/EditGroceryItemModal';
import {
  useGroceryList,
  useGroceryCount,
  useToggleGroceryItem,
  useDeleteGroceryItem,
  useClearCheckedItems,
  useAddGroceryItem,
} from '@/hooks/useGrocery';
import { api } from '@/lib/api';
import { GroceryItem } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

function GroceryItemRow({
  item,
  colors,
  onToggle,
  onDelete,
  onEdit,
}: {
  item: GroceryItem;
  colors: ReturnType<typeof useColors>;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  // The entire row is tappable to toggle for easier interaction
  return (
    <TouchableOpacity 
      style={[
        styles.itemRow, 
        { 
          backgroundColor: colors.card, 
          borderColor: item.checked ? colors.success + '40' : colors.cardBorder,
          opacity: item.checked ? 0.7 : 1,
        }
      ]}
      onPress={onToggle}
      activeOpacity={0.6}
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
          {item.quantity && `${item.quantity} `}
          {item.unit && `${item.unit} `}
          {item.name}
        </Text>
        {item.recipe_title && (
          <Text style={[styles.recipeLabel, { color: colors.textMuted }]} numberOfLines={1}>
            from {item.recipe_title}
          </Text>
        )}
        {item.notes && (
          <Text style={[styles.itemNotes, { color: colors.textMuted }]} numberOfLines={1}>
            {item.notes}
          </Text>
        )}
      </RNView>

      {/* Edit button - stop propagation */}
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

      {/* Delete button - stop propagation */}
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
    </TouchableOpacity>
  );
}

export default function GroceryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [newItemName, setNewItemName] = useState('');
  const [showChecked, setShowChecked] = useState(true);
  const [editingItem, setEditingItem] = useState<GroceryItem | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const { data: groceryItems, isLoading, refetch, isRefetching } = useGroceryList(showChecked);
  const { data: countData } = useGroceryCount();
  const toggleMutation = useToggleGroceryItem();
  const deleteMutation = useDeleteGroceryItem();
  const clearCheckedMutation = useClearCheckedItems();
  const addItemMutation = useAddGroceryItem();

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleToggle = (id: string) => {
    toggleMutation.mutate(id);
  };

  const handleDelete = (id: string, name: string) => {
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

  const handleAddItem = () => {
    if (!newItemName.trim()) return;
    
    addItemMutation.mutate(
      { name: newItemName.trim() },
      {
        onSuccess: () => setNewItemName(''),
      }
    );
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

  const renderItem = ({ item }: { item: GroceryItem }) => (
    <GroceryItemRow
      item={item}
      colors={colors}
      onToggle={() => handleToggle(item.id)}
      onDelete={() => handleDelete(item.id, item.name)}
      onEdit={() => handleEdit(item)}
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
    <View style={styles.container}>
      {/* Fixed header with input - outside FlatList to prevent focus loss */}
      <RNView style={styles.header}>
        {/* Title row */}
        <RNView style={styles.titleRow}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Grocery List</Text>
          {countData && countData.unchecked > 0 && (
            <RNView style={[styles.countBadge, { backgroundColor: colors.tint }]}>
              <Text style={styles.countText}>{countData.unchecked}</Text>
            </RNView>
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
                {showChecked ? 'Hide checked' : 'Show checked'}
              </Text>
            </TouchableOpacity>

            {countData.checked > 0 && (
              <TouchableOpacity onPress={handleClearChecked} style={styles.clearButton}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
                <Text style={[styles.clearText, { color: colors.error }]}>
                  Clear checked ({countData.checked})
                </Text>
              </TouchableOpacity>
            )}
          </RNView>
        )}
      </RNView>

      <FlatList
        data={groceryItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={!isLoading ? ListEmpty : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    marginBottom: spacing.md,
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
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  clearText: {
    fontSize: fontSize.sm,
  },
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

