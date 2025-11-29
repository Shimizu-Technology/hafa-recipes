/**
 * Modal for editing a grocery item
 */

import { useState, useEffect } from 'react';
import {
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  View as RNView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, View, useColors } from './Themed';
import { GroceryItem } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

interface EditGroceryItemModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (updates: { name: string; quantity: string; unit: string; notes: string }) => void;
  item: GroceryItem | null;
  isLoading?: boolean;
}

export default function EditGroceryItemModal({
  visible,
  onClose,
  onSave,
  item,
  isLoading = false,
}: EditGroceryItemModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [notes, setNotes] = useState('');

  // Reset form when modal opens with new item
  useEffect(() => {
    if (visible && item) {
      setName(item.name);
      setQuantity(item.quantity || '');
      setUnit(item.unit || '');
      setNotes(item.notes || '');
    }
  }, [visible, item]);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      quantity: quantity.trim(),
      unit: unit.trim(),
      notes: notes.trim(),
    });
  };

  const canSave = name.trim().length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView 
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.container, { paddingTop: insets.top }]}>
          {/* Header */}
          <RNView style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose} style={styles.headerButton}>
              <Text style={[styles.headerButtonText, { color: colors.tint }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Edit Item</Text>
            <TouchableOpacity 
              onPress={handleSave} 
              style={styles.headerButton}
              disabled={!canSave || isLoading}
            >
              <Text style={[
                styles.headerButtonText, 
                { color: canSave ? colors.tint : colors.textMuted }
              ]}>
                {isLoading ? 'Saving...' : 'Save'}
              </Text>
            </TouchableOpacity>
          </RNView>

          {/* Form */}
          <RNView style={styles.form}>
            {/* Name (Required) */}
            <RNView style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Item Name *
              </Text>
              <TextInput
                style={[
                  styles.input,
                  { 
                    color: colors.text,
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  }
                ]}
                value={name}
                onChangeText={setName}
                placeholder="e.g., Chicken breast"
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
            </RNView>

            {/* Quantity & Unit Row */}
            <RNView style={styles.row}>
              <RNView style={[styles.inputGroup, styles.halfWidth]}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>
                  Quantity
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    { 
                      color: colors.text,
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    }
                  ]}
                  value={quantity}
                  onChangeText={setQuantity}
                  placeholder="e.g., 2"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="default"
                />
              </RNView>

              <RNView style={[styles.inputGroup, styles.halfWidth]}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>
                  Unit
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    { 
                      color: colors.text,
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    }
                  ]}
                  value={unit}
                  onChangeText={setUnit}
                  placeholder="e.g., lbs"
                  placeholderTextColor={colors.textMuted}
                />
              </RNView>
            </RNView>

            {/* Notes */}
            <RNView style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Notes
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.notesInput,
                  { 
                    color: colors.text,
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  }
                ]}
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g., organic, boneless"
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={2}
              />
            </RNView>

            {/* Recipe source (read-only) */}
            {item?.recipe_title && (
              <RNView style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>
                  From Recipe
                </Text>
                <Text style={[styles.recipeTitle, { color: colors.textMuted }]}>
                  {item.recipe_title}
                </Text>
              </RNView>
            )}
          </RNView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
    minWidth: 70,
  },
  headerButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  form: {
    padding: spacing.lg,
  },
  inputGroup: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  halfWidth: {
    flex: 1,
  },
  recipeTitle: {
    fontSize: fontSize.md,
    fontStyle: 'italic',
  },
});

