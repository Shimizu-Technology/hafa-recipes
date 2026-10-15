/**
 * Modal for creating or editing a collection.
 */

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import {
  Modal,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View as RNView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Input, Button, useColors } from '@/components/Themed';
import { spacing, fontSize, fontWeight, radius, fontFamily } from '@/constants/Colors';
import { useCreateCollection, useUpdateCollection, useDeleteCollection } from '@/hooks/useCollections';
import { Collection } from '@/types/recipe';
import { haptics } from '@/utils/haptics';

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
  const [error, setError] = useState<string | null>(null);
  const { userId } = useAuth();
  const committedScope = useMemo(() => ({ userId, visible, id: editingCollection?.id }), [userId, visible, editingCollection?.id]);
  const scope = useRef<typeof committedScope | null>(null);
  const alive = useRef(false);
  const working = useRef(false);
  useLayoutEffect(() => {
    scope.current = committedScope;
    alive.current = true;
    working.current = false;
    return () => {
      if (scope.current === committedScope) { scope.current = null; alive.current = false; }
    };
  }, [committedScope]);

  const current = () => alive.current && visible && scope.current === committedScope;
  const requestGuard = () => { if (!current()) throw new Error('Collection editor changed; reopen it.'); };
  const close = () => { if (current()) onClose(); };

  const createMutation = useCreateCollection();
  const updateMutation = useUpdateCollection();
  const deleteMutation = useDeleteCollection();

  const isEditing = !!editingCollection;
  const isPending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  // Pre-fill form when editing
  useEffect(() => {
    setError(null);
    if (editingCollection) {
      setName(editingCollection.name);
    } else {
      setName('');
    }
  }, [editingCollection?.id, visible, userId]);

  const handleSave = async () => {
    if (!current() || !name.trim() || working.current) return;
    const captured = committedScope;
    working.current = true;
    setError(null);

    try {
      if (isEditing && editingCollection) {
        await updateMutation.mutateAsync({
          collectionId: editingCollection.id,
          updates: { name: name.trim() }, requestGuard,
        });
      } else {
        await createMutation.mutateAsync({
          name: name.trim(), requestGuard,
        });
      }
      if (alive.current && scope.current === captured) onClose();
    } catch {
      if (alive.current && scope.current === captured) setError('Couldn’t save this collection. Check your connection and try again.');
    } finally {
      if (scope.current === captured) working.current = false;
    }
  };

  const handleDelete = () => {
    if (!current() || !editingCollection || isPending || working.current) return;
    const captured = committedScope;

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
            if (!current() || scope.current !== captured || working.current) return;
            working.current = true;
            setError(null);
            try {
              await deleteMutation.mutateAsync({ collectionId: editingCollection.id, requestGuard });
              if (!alive.current || scope.current !== captured) return;
              onClose();
              // Navigate back after deletion (if callback provided)
              onDeleted?.();
            } catch {
              if (alive.current && scope.current === captured) setError('Couldn’t delete this collection. Check your connection and try again. Your recipes won’t be deleted.');
            } finally {
              if (scope.current === captured) working.current = false;
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
      onRequestClose={close}
    >
      <TouchableWithoutFeedback onPress={close}>
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
                  <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="close" size={24} color={colors.textMuted} />
                  </TouchableOpacity>
                </RNView>

                {/* Name input */}
                <RNView style={styles.field}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Name</Text>
                  <Input
                    value={name}
                    onChangeText={(value) => { if (current() && !working.current) { setName(value); setError(null); } }}
                    editable={!isPending}
                    placeholder="e.g., Weeknight Dinners"
                    autoFocus
                  />
                </RNView>

                {/* Preview */}
                <RNView style={styles.preview}>
                  <Text style={[styles.previewLabel, { color: colors.textMuted }]}>Preview</Text>
                  <RNView style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <RNView style={[styles.previewIcon, { backgroundColor: colors.tint + '15' }]}>
                      <Ionicons name="folder-open-outline" size={22} color={colors.tint} />
                    </RNView>
                    <Text style={[styles.previewName, { color: colors.text }]} numberOfLines={1}>
                      {name || 'Collection Name'}
                    </Text>
                  </RNView>
                </RNView>

                {error && <Text accessibilityRole="alert" style={{ color: colors.error, marginBottom: spacing.md }}>{error}</Text>}
                {/* Actions */}
                <RNView style={styles.actions}>
                  {isEditing && (
                    <TouchableOpacity
                      style={[styles.deleteButton, { borderColor: colors.error }]}
                      onPress={handleDelete}
                      disabled={isPending}
                      accessibilityLabel="Delete collection"
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.error} />
                    </TouchableOpacity>
                  )}
                  <RNView style={styles.actionsSpacer} />
                  <Button
                    title="Cancel"
                    onPress={close}
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
    fontFamily: fontFamily.displaySemibold,
  },
  field: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
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
  previewIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewName: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
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
