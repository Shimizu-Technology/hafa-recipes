/**
 * Modal for adding a recipe to one or more collections.
 * Uses a smart single-button approach for cleaner UX.
 */

import { useState, useEffect } from 'react';
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
  
  // Fetch data
  const { data: collections, isLoading: isLoadingCollections } = useCollections();
  const { data: recipeCollectionIds, isLoading: isLoadingRecipeCollections } = useRecipeCollections(recipeId);
  
  // Mutations
  const addToCollection = useAddToCollection();
  const removeFromCollection = useRemoveFromCollection();
  const createCollection = useCreateCollection();
  
  const isLoading = isLoadingCollections || isLoadingRecipeCollections;
  const isCreating = createCollection.isPending;
  
  // Determine button state
  const hasValidName = newCollectionName.trim().length > 0;
  const isInCreateMode = showCreateNew;
  
  // Initialize selected IDs from server data
  useEffect(() => {
    if (recipeCollectionIds) {
      setSelectedIds(new Set(recipeCollectionIds));
    }
  }, [recipeCollectionIds]);
  
  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      setShowCreateNew(false);
      setNewCollectionName('');
      setJustCreated(false);
    }
  }, [visible]);
  
  const handleToggleCollection = (collectionId: string) => {
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
    
    // Fire-and-forget API call (no await - allows rapid clicking)
    if (isCurrentlySelected) {
      removeFromCollection.mutate(
        { collectionId, recipeId },
        { onError: () => setSelectedIds(selectedIds) }
      );
    } else {
      addToCollection.mutate(
        { collectionId, recipeId },
        { onError: () => setSelectedIds(selectedIds) }
      );
    }
  };
  
  const handleCreateAndAdd = async () => {
    if (!newCollectionName.trim()) return;
    
    const name = newCollectionName.trim();
    Keyboard.dismiss();
    
    try {
      // Create collection
      const newCollection = await createCollection.mutateAsync({ name });
      
      // Add recipe to the new collection
      await addToCollection.mutateAsync({
        collectionId: newCollection.id,
        recipeId,
      });
      
      // Update local state
      setSelectedIds(new Set([...selectedIds, newCollection.id]));
      
      // Show success feedback
      haptics.success();
      setJustCreated(true);
      setNewCollectionName('');
      
      // Reset after brief delay
      setTimeout(() => {
        setShowCreateNew(false);
        setJustCreated(false);
      }, 800);
    } catch (error) {
      console.error('Failed to create collection:', error);
    }
  };
  
  const handleMainButtonPress = () => {
    if (isInCreateMode && hasValidName) {
      // Create the collection
      handleCreateAndAdd();
    } else if (isInCreateMode && !hasValidName) {
      // Cancel create mode
      setShowCreateNew(false);
      setNewCollectionName('');
      Keyboard.dismiss();
    } else {
      // Close modal
      onClose();
    }
  };
  
  // Determine main button text and style
  const getMainButtonConfig = () => {
    if (justCreated) {
      return { title: '✓ Created!', disabled: true };
    }
    if (isCreating) {
      return { title: 'Creating...', disabled: true, loading: true };
    }
    if (isInCreateMode && hasValidName) {
      return { title: 'Create Collection', disabled: false };
    }
    if (isInCreateMode && !hasValidName) {
      return { title: 'Cancel', disabled: false };
    }
    return { title: 'Done', disabled: false };
  };
  
  const buttonConfig = getMainButtonConfig();
  
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <TouchableWithoutFeedback onPress={onClose}>
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
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={24} color={colors.textMuted} />
                </TouchableOpacity>
              </RNView>
              
              {/* Collections list */}
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
                            activeOpacity={0.7}
                          >
                            <RNView style={styles.collectionInfo}>
                              <Text style={styles.collectionEmoji}>
                                {collection.emoji || '📁'}
                              </Text>
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
                  ) : (
                    <RNView style={styles.emptyState}>
                      <Ionicons name="folder-outline" size={48} color={colors.textMuted} />
                      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                        No collections yet
                      </Text>
                    </RNView>
                  )}
                  
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
                            onChangeText={setNewCollectionName}
                            placeholder="Collection name..."
                            autoFocus
                            style={styles.collectionInput}
                            editable={!isCreating && !justCreated}
                            onSubmitEditing={hasValidName ? handleCreateAndAdd : undefined}
                            returnKeyType="done"
                          />
                        </RNView>
                        {!justCreated && (
                          <TouchableOpacity 
                            onPress={() => {
                              setShowCreateNew(false);
                              setNewCollectionName('');
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
                      onPress={() => setShowCreateNew(true)}
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
  collectionEmoji: {
    fontSize: 24,
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

