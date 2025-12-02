/**
 * Modal for creating or editing a collection.
 */

import { useState, useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View as RNView,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Input, Button, useColors } from '@/components/Themed';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { useCreateCollection, useUpdateCollection, useDeleteCollection } from '@/hooks/useCollections';
import { Collection } from '@/types/recipe';
import { haptics } from '@/utils/haptics';

// Common emoji options for collections
const EMOJI_OPTIONS = [
  '📁', '🍽️', '🥗', '🍕', '🍔', '🌮', '🍜', '🍣',
  '🥘', '🍲', '🥧', '🎂', '🍪', '🥤', '☕', '🍷',
  '🌱', '🥬', '🥩', '🐔', '🐟', '🦐', '🥚', '🧀',
  '🏠', '❤️', '⭐', '🔥', '⏱️', '💪', '👨‍👩‍👧‍👦', '🎉',
];

interface CreateCollectionModalProps {
  visible: boolean;
  onClose: () => void;
  editingCollection?: Collection | null;
  onDeleted?: () => void; // Called after collection is deleted (for navigation)
}

export default function CreateCollectionModal({
  visible,
  onClose,
  editingCollection,
  onDeleted,
}: CreateCollectionModalProps) {
  const colors = useColors();
  const [name, setName] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null);
  
  const createMutation = useCreateCollection();
  const updateMutation = useUpdateCollection();
  const deleteMutation = useDeleteCollection();
  
  const isEditing = !!editingCollection;
  const isPending = createMutation.isPending || updateMutation.isPending;
  
  // Pre-fill form when editing
  useEffect(() => {
    if (editingCollection) {
      setName(editingCollection.name);
      setSelectedEmoji(editingCollection.emoji);
    } else {
      setName('');
      setSelectedEmoji(null);
    }
  }, [editingCollection, visible]);
  
  const handleSave = async () => {
    if (!name.trim()) return;
    
    try {
      if (isEditing && editingCollection) {
        await updateMutation.mutateAsync({
          collectionId: editingCollection.id,
          updates: { name: name.trim(), emoji: selectedEmoji || undefined },
        });
      } else {
        await createMutation.mutateAsync({
          name: name.trim(),
          emoji: selectedEmoji || undefined,
        });
      }
      onClose();
    } catch (error) {
      console.error('Failed to save collection:', error);
    }
  };
  
  const handleDelete = () => {
    if (!editingCollection) return;
    
    haptics.warning();
    Alert.alert(
      'Delete Collection',
      `Are you sure you want to delete "${editingCollection.name}"? The recipes won't be deleted, just removed from this collection.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync(editingCollection.id);
              onClose();
              // Navigate back after deletion (if callback provided)
              onDeleted?.();
            } catch (error) {
              console.error('Failed to delete collection:', error);
            }
          },
        },
      ]
    );
  };
  
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <RNView style={styles.overlay}>
          <TouchableWithoutFeedback>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.keyboardView}
            >
              <RNView style={[styles.modal, { backgroundColor: colors.background }]}>
                {/* Header */}
                <RNView style={styles.header}>
                  <Text style={[styles.title, { color: colors.text }]}>
                    {isEditing ? 'Edit Collection' : 'New Collection'}
                  </Text>
                  <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="close" size={24} color={colors.textMuted} />
                  </TouchableOpacity>
                </RNView>
                
                {/* Name input */}
                <RNView style={styles.field}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Name</Text>
                  <Input
                    value={name}
                    onChangeText={setName}
                    placeholder="e.g., Weeknight Dinners"
                    autoFocus
                  />
                </RNView>
                
                {/* Emoji picker */}
                <RNView style={styles.field}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Icon (optional)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <RNView style={styles.emojiRow}>
                      {/* None option */}
                      <TouchableOpacity
                        style={[
                          styles.emojiOption,
                          { 
                            backgroundColor: selectedEmoji === null ? colors.tint + '20' : colors.backgroundSecondary,
                            borderColor: selectedEmoji === null ? colors.tint : colors.border,
                          },
                        ]}
                        onPress={() => setSelectedEmoji(null)}
                      >
                        <Ionicons name="close-outline" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                      
                      {EMOJI_OPTIONS.map((emoji) => (
                        <TouchableOpacity
                          key={emoji}
                          style={[
                            styles.emojiOption,
                            { 
                              backgroundColor: selectedEmoji === emoji ? colors.tint + '20' : colors.backgroundSecondary,
                              borderColor: selectedEmoji === emoji ? colors.tint : colors.border,
                            },
                          ]}
                          onPress={() => setSelectedEmoji(emoji)}
                        >
                          <Text style={styles.emoji}>{emoji}</Text>
                        </TouchableOpacity>
                      ))}
                    </RNView>
                  </ScrollView>
                </RNView>
                
                {/* Preview */}
                <RNView style={styles.preview}>
                  <Text style={[styles.previewLabel, { color: colors.textMuted }]}>Preview:</Text>
                  <RNView style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <Text style={styles.previewEmoji}>{selectedEmoji || '📁'}</Text>
                    <Text style={[styles.previewName, { color: colors.text }]} numberOfLines={1}>
                      {name || 'Collection Name'}
                    </Text>
                  </RNView>
                </RNView>
                
                {/* Actions */}
                <RNView style={styles.actions}>
                  {isEditing && (
                    <TouchableOpacity
                      style={[styles.deleteButton, { borderColor: colors.error }]}
                      onPress={handleDelete}
                      disabled={deleteMutation.isPending}
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.error} />
                    </TouchableOpacity>
                  )}
                  <RNView style={styles.actionsSpacer} />
                  <Button
                    title="Cancel"
                    onPress={onClose}
                    variant="outline"
                    style={styles.cancelButton}
                  />
                  <Button
                    title={isEditing ? 'Save' : 'Create'}
                    onPress={handleSave}
                    disabled={!name.trim() || isPending}
                    loading={isPending}
                    style={styles.saveButton}
                  />
                </RNView>
              </RNView>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </RNView>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  keyboardView: {
    width: '100%',
    maxWidth: 400,
  },
  modal: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  field: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
  },
  emojiRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  emojiOption: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emoji: {
    fontSize: 22,
  },
  preview: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  previewLabel: {
    fontSize: fontSize.xs,
    marginBottom: spacing.xs,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
  },
  previewEmoji: {
    fontSize: 24,
  },
  previewName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deleteButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionsSpacer: {
    flex: 1,
  },
  cancelButton: {
    minWidth: 80,
  },
  saveButton: {
    minWidth: 80,
  },
});

