/**
 * Modal for adding a recipe to one or more collections.
 * Uses a smart single-button approach for cleaner UX.
 */

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import {
  Modal,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View as RNView,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Button, Input, useColors } from '@/components/Themed';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import {
  useCollections,
  useRecipeCollections,
  useAddToCollection,
  useRemoveFromCollection,
  useCreateCollection,
} from '@/hooks/useCollections';
import { Collection } from '@/types/recipe';
import { haptics } from '@/utils/haptics';
import { SlideUpView, ScalePressable } from '@/components/Animated';

interface AddToCollectionModalProps {
  visible: boolean;
  onClose: () => void;
  recipeId: string;
  recipeTitle: string;
}

export default function AddToCollectionModal({
  visible,
  onClose,
  recipeId,
  recipeTitle,
}: AddToCollectionModalProps) {
  const colors = useColors();

  // Selected collections (local state for optimistic UI)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [justCreated, setJustCreated] = useState(false); // For success feedback
  const [error, setError] = useState<string | null>(null);
  const [createdCollectionId, setCreatedCollectionId] = useState<string | null>(null);
  const { userId } = useAuth();
  const committedScope = useMemo(() => ({ userId, visible, recipeId }), [userId, visible, recipeId]);
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
  const requestGuard = () => { if (!current()) throw new Error('Collection choices changed; reopen them.'); };
  const close = () => { if (current()) onClose(); };

  // Fetch data
  const collectionsQuery = useCollections(visible);
  const membershipQuery = useRecipeCollections(recipeId, visible);
  const { data: collections, isLoading: isLoadingCollections } = collectionsQuery;
  const { data: recipeCollectionIds, isLoading: isLoadingRecipeCollections } = membershipQuery;

  // Mutations
  const addToCollection = useAddToCollection();
  const removeFromCollection = useRemoveFromCollection();
  const createCollection = useCreateCollection();

  const isLoading = isLoadingCollections || isLoadingRecipeCollections;
  const isCreating = createCollection.isPending || (showCreateNew && addToCollection.isPending);
  const isSaving = createCollection.isPending || addToCollection.isPending || removeFromCollection.isPending;
  const hasData = collections !== undefined && recipeCollectionIds !== undefined;

  // Determine button state
  const hasValidName = newCollectionName.trim().length > 0;
  const isInCreateMode = showCreateNew;

  // Initialize selected IDs from server data
  useEffect(() => {
    if (recipeCollectionIds) {
      // Ensure we only have strings (guard against corrupted cache data)
      const validIds = recipeCollectionIds.filter((id): id is string => typeof id === 'string');
      setSelectedIds(new Set(validIds));
    } else setSelectedIds(new Set());
  }, [recipeCollectionIds, visible, recipeId, userId]);

  // Reset state when modal closes
  useEffect(() => {
    setError(null);
    setCreatedCollectionId(null);
    if (!visible) {
      setShowCreateNew(false);
      setNewCollectionName('');
      setJustCreated(false);
    }
  }, [visible, recipeId, userId]);

  const handleToggleCollection = async (collectionId: string) => {
    if (!current() || working.current || !hasData) return;
    working.current = true;
    const captured = committedScope;
    setError(null);
    const isCurrentlySelected = selectedIds.has(collectionId);
    haptics.light();

    // Optimistic update - immediately update UI
    const newSelectedIds = new Set(selectedIds);
    if (isCurrentlySelected) {
      newSelectedIds.delete(collectionId);
    } else {
      newSelectedIds.add(collectionId);
    }
    setSelectedIds(newSelectedIds);

    try {
      await (isCurrentlySelected ? removeFromCollection : addToCollection).mutateAsync({ collectionId, recipeId, requestGuard });
    } catch {
      if (alive.current && scope.current === captured) {
        setSelectedIds((current) => {
          const restored = new Set(current);
          if (isCurrentlySelected) restored.add(collectionId); else restored.delete(collectionId);
          return restored;
        });
        setError('Couldn’t update this collection. Check your connection and try again.');
      }
    } finally {
      if (scope.current === captured) working.current = false;
    }
  };

  const handleCreateAndAdd = async () => {
    if (!current() || !newCollectionName.trim() || working.current || !hasData) return;
    working.current = true;
    const captured = committedScope;
    setError(null);

    const name = newCollectionName.trim();
    let savedCollectionId = createdCollectionId;
    Keyboard.dismiss();

    try {
      // Create collection
      const collectionId = savedCollectionId ?? (await createCollection.mutateAsync({ name, requestGuard })).id;
      savedCollectionId = collectionId;
      if (!alive.current || scope.current !== captured) return;
      setCreatedCollectionId(collectionId);

      // Add recipe to the new collection
      await addToCollection.mutateAsync({
        collectionId,
        recipeId, requestGuard,
      });

      // Update local state
      if (!alive.current || scope.current !== captured) return;
      setSelectedIds((current) => new Set([...current, collectionId]));

      // Show success feedback
      haptics.success();
      setJustCreated(true);
      setNewCollectionName('');
      setCreatedCollectionId(null);

      // Reset after brief delay
      setTimeout(() => {
        if (!alive.current || scope.current !== captured) return;
        setShowCreateNew(false);
        setJustCreated(false);
      }, 800);
    } catch {
      if (alive.current && scope.current === captured) setError(savedCollectionId
        ? 'Collection created. Couldn’t confirm the recipe was added. Retry adding it.'
        : 'Couldn’t create this collection. Check your connection and refresh your collections before trying again.');
    } finally {
      if (scope.current === captured) working.current = false;
    }
  };

  const handleMainButtonPress = () => {
    if (!current() || working.current) return;
    if (isInCreateMode && hasValidName) {
      // Create the collection
      handleCreateAndAdd();
    } else if (isInCreateMode && !hasValidName) {
      // Cancel create mode
      setShowCreateNew(false);
      setNewCollectionName('');
      setCreatedCollectionId(null);
      setError(null);
      Keyboard.dismiss();
    } else {
      // Close modal
      onClose();
    }
  };

  // Determine main button text and style
  const getMainButtonConfig = () => {
    if (justCreated) {
      return { title: 'Created', disabled: true };
    }
    if (isCreating) {
      return { title: createdCollectionId ? 'Adding recipe…' : 'Creating…', disabled: true, loading: true };
    }
    if (isSaving) return { title: 'Saving…', disabled: true, loading: true };
    if (isInCreateMode && hasValidName) {
      return { title: createdCollectionId ? 'Retry adding recipe' : 'Create Collection', disabled: isSaving || !hasData };
    }
    if (isInCreateMode && !hasValidName) {
      return { title: 'Cancel', disabled: false };
    }
    return { title: 'Done', disabled: isSaving };
  };

  const buttonConfig = getMainButtonConfig();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <TouchableWithoutFeedback onPress={close}>
          <RNView style={styles.overlay}>
            <TouchableWithoutFeedback>
              <RNView style={[styles.modal, { backgroundColor: colors.background }]}>
              {/* Header */}
              <RNView style={styles.header}>
                <RNView style={styles.headerContent}>
                  <Text style={[styles.title, { color: colors.text }]}>
                    Add to Collection
                  </Text>
                  <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
                    {recipeTitle}
                  </Text>
                </RNView>
                <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={24} color={colors.textMuted} />
                </TouchableOpacity>
              </RNView>

              {/* Collections list */}
              {(error || collectionsQuery.isError || membershipQuery.isError) && (
                <RNView style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }} accessibilityRole="alert">
                  <Text style={{ color: colors.error }}>
                    {error ?? (hasData ? 'Couldn’t refresh your collections. Your last loaded choices are shown.' : 'Couldn’t load your collections. Check your connection and try again.')}
                  </Text>
                  <Button title={error ? 'Refresh collections' : 'Try again'} disabled={isSaving || collectionsQuery.isFetching || membershipQuery.isFetching}
                    onPress={() => { if (current() && !working.current) { setError(null); void collectionsQuery.refetch(); void membershipQuery.refetch(); } }} />
                </RNView>
              )}
              {isLoading ? (
                <RNView style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </RNView>
              ) : (
                <ScrollView
                  style={styles.scrollView}
                  showsVerticalScrollIndicator={false}
                >
                  {collections && collections.length > 0 ? (
                    <>
                      {collections.map((collection) => {
                        const isSelected = selectedIds.has(collection.id);
                        return (
                          <TouchableOpacity
                            key={collection.id}
                            style={[
                              styles.collectionRow,
                              {
                                backgroundColor: isSelected ? colors.tint + '15' : 'transparent',
                                borderColor: isSelected ? colors.tint : colors.border,
                              },
                            ]}
                            onPress={() => handleToggleCollection(collection.id)}
                            disabled={isSaving || !hasData}
                            accessibilityRole="checkbox"
                            accessibilityLabel={collection.name}
                            accessibilityState={{ checked: isSelected, disabled: isSaving || !hasData }}
                            activeOpacity={0.7}
                          >
                            <RNView style={styles.collectionInfo}>
                              <RNView style={[styles.collectionIcon, { backgroundColor: colors.tint + '15' }]}>
                                <Ionicons name="folder-open-outline" size={20} color={colors.tint} />
                              </RNView>
                              <RNView style={styles.collectionText}>
                                <Text style={[styles.collectionName, { color: colors.text }]}>
                                  {collection.name}
                                </Text>
                                <Text style={[styles.collectionCount, { color: colors.textMuted }]}>
                                  {collection.recipe_count} recipe{collection.recipe_count !== 1 ? 's' : ''}
                                </Text>
                              </RNView>
                            </RNView>
                            <RNView style={[
                              styles.checkbox,
                              {
                                backgroundColor: isSelected ? colors.tint : 'transparent',
                                borderColor: isSelected ? colors.tint : colors.border,
                              },
                            ]}>
                              {isSelected && (
                                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                              )}
                            </RNView>
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  ) : collections !== undefined ? (
                    <RNView style={styles.emptyState}>
                      <Ionicons name="folder-outline" size={48} color={colors.textMuted} />
                      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                        No collections yet
                      </Text>
                    </RNView>
                  ) : null}

                  {/* Create new collection */}
                  {showCreateNew ? (
                    <RNView style={[styles.createNewForm, { borderColor: colors.tint + '40' }]}>
                      <RNView style={styles.createNewInput}>
                        <Ionicons
                          name={justCreated ? "checkmark-circle" : "folder-outline"}
                          size={20}
                          color={justCreated ? colors.success : colors.tint}
                        />
                        <RNView style={styles.inputWrapper}>
                          <Input
                            value={newCollectionName}
                            onChangeText={(value) => { if (current() && !working.current) { setNewCollectionName(value); setError(null); } }}
                            placeholder="Collection name..."
                            autoFocus
                            style={styles.collectionInput}
                            editable={!isSaving && !justCreated && !createdCollectionId}
                            onSubmitEditing={hasValidName ? handleCreateAndAdd : undefined}
                            returnKeyType="done"
                          />
                        </RNView>
                        {!justCreated && (
                          <TouchableOpacity
                            onPress={() => {
                              if (!current() || working.current) return;
                              setShowCreateNew(false);
                              setNewCollectionName('');
                              setCreatedCollectionId(null);
                              setError(null);
                              Keyboard.dismiss();
                            }}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          >
                            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                          </TouchableOpacity>
                        )}
                      </RNView>
                    </RNView>
                  ) : (
                    <TouchableOpacity
                      style={[styles.createNewButton, { borderColor: colors.border }]}
                      onPress={() => { if (current() && !working.current) setShowCreateNew(true); }}
                      accessibilityLabel="Create new collection"
                      disabled={isSaving || !hasData}
                    >
                      <Ionicons name="add-circle-outline" size={24} color={colors.tint} />
                      <Text style={[styles.createNewText, { color: colors.tint }]}>
                        Create New Collection
                      </Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
              )}

              {/* Smart main button - changes based on context */}
              <RNView style={styles.footer}>
                <Button
                  title={buttonConfig.title}
                  onPress={handleMainButtonPress}
                  disabled={buttonConfig.disabled}
                  loading={buttonConfig.loading}
                  style={styles.doneButton}
                />
              </RNView>
              </RNView>
            </TouchableWithoutFeedback>
          </RNView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '80%',
    paddingTop: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerContent: {
    flex: 1,
    marginRight: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  loadingContainer: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  scrollView: {
    maxHeight: 400,
    paddingHorizontal: spacing.lg,
  },
  collectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  collectionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  collectionIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  collectionText: {
    flex: 1,
  },
  collectionName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  collectionCount: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: fontSize.md,
    marginTop: spacing.sm,
  },
  createNewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  createNewText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  createNewForm: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.sm,
  },
  createNewInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  inputWrapper: {
    flex: 1,
  },
  collectionInput: {
    marginBottom: 0,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xl,
  },
  doneButton: {
    width: '100%',
  },
});
