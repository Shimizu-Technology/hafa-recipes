/**
 * Modal for selecting which ingredients to add to grocery list
 */

import { useState, useEffect } from 'react';
import {
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  View as RNView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, View, useColors } from './Themed';
import { Ingredient } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

interface AddIngredientsModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (selectedIngredients: Ingredient[]) => void;
  ingredients: Ingredient[];
  recipeTitle: string;
  isLoading?: boolean;
}

export default function AddIngredientsModal({
  visible,
  onClose,
  onConfirm,
  ingredients,
  recipeTitle,
  isLoading = false,
}: AddIngredientsModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  
  // Track which ingredients are selected (all selected by default)
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Reset selection when modal opens
  useEffect(() => {
    if (visible) {
      // Select all by default
      setSelected(new Set(ingredients.map((_, index) => index)));
    }
  }, [visible, ingredients]);

  const toggleItem = (index: number) => {
    setSelected((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelected(new Set(ingredients.map((_, index) => index)));
  };

  const deselectAll = () => {
    setSelected(new Set());
  };

  const handleConfirm = () => {
    const selectedIngredients = ingredients.filter((_, index) => selected.has(index));
    onConfirm(selectedIngredients);
  };

  const selectedCount = selected.size;
  const allSelected = selectedCount === ingredients.length;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <RNView style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton}>
            <Text style={[styles.headerButtonText, { color: colors.tint }]}>Cancel</Text>
          </TouchableOpacity>
          <RNView style={styles.headerTitleContainer}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Add Ingredients</Text>
            <Text style={[styles.headerSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
              {recipeTitle}
            </Text>
          </RNView>
          <TouchableOpacity 
            onPress={handleConfirm} 
            style={styles.headerButton}
            disabled={selectedCount === 0 || isLoading}
          >
            <Text style={[
              styles.headerButtonText, 
              { color: selectedCount === 0 ? colors.textMuted : colors.tint }
            ]}>
              {isLoading ? 'Adding...' : `Add (${selectedCount})`}
            </Text>
          </TouchableOpacity>
        </RNView>

        {/* Select All / Deselect All */}
        <RNView style={[styles.selectAllRow, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={allSelected ? deselectAll : selectAll}>
            <Text style={[styles.selectAllText, { color: colors.tint }]}>
              {allSelected ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.countText, { color: colors.textMuted }]}>
            {selectedCount} of {ingredients.length} selected
          </Text>
        </RNView>

        {/* Ingredient List */}
        <ScrollView 
          style={styles.list}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing.xl }]}
        >
          {ingredients.map((ingredient, index) => {
            const isSelected = selected.has(index);
            return (
              <TouchableOpacity
                key={index}
                style={[
                  styles.ingredientRow,
                  { 
                    backgroundColor: colors.card,
                    borderColor: isSelected ? colors.tint : colors.cardBorder,
                  },
                ]}
                onPress={() => toggleItem(index)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isSelected ? 'checkbox' : 'square-outline'}
                  size={24}
                  color={isSelected ? colors.tint : colors.textMuted}
                />
                <RNView style={styles.ingredientContent}>
                  <Text style={[styles.ingredientName, { color: colors.text }]}>
                    {ingredient.quantity && ingredient.quantity !== 'null' && `${ingredient.quantity} `}
                    {ingredient.unit && ingredient.unit !== 'null' && `${ingredient.unit} `}
                    {ingredient.name}
                  </Text>
                  {ingredient.notes && ingredient.notes !== 'null' && (
                    <Text style={[styles.ingredientNotes, { color: colors.textMuted }]}>
                      {ingredient.notes}
                    </Text>
                  )}
                </RNView>
                {ingredient.estimatedCost != null && ingredient.estimatedCost > 0 && (
                  <Text style={[styles.ingredientCost, { color: colors.textMuted }]}>
                    ${ingredient.estimatedCost.toFixed(2)}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerButton: {
    minWidth: 80,
  },
  headerButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  headerSubtitle: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  selectAllRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  selectAllText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  countText: {
    fontSize: fontSize.sm,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  ingredientContent: {
    flex: 1,
  },
  ingredientName: {
    fontSize: fontSize.md,
  },
  ingredientNotes: {
    fontSize: fontSize.sm,
    marginTop: 2,
    fontStyle: 'italic',
  },
  ingredientCost: {
    fontSize: fontSize.sm,
  },
});

