/**
 * Modal for adding multiple recipes to collections at once.
 * Used for bulk operations from My Recipes selection mode.
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
  useAddToCollection, 
  useCreateCollection,
} from '@/hooks/useCollections';
import { Collection } from '@/types/recipe';
import { haptics } from '@/utils/haptics';

interface BulkAddToCollectionModalProps {
  visible: boolean;
  onClose: () => void;
  recipeIds: string[];
  onComplete?: () => void;
}

export default function BulkAddToCollectionModal({
  visible,
  onClose,
  recipeIds,
  onComplete,
}: BulkAddToCollectionModalProps) {
  const colors = useColors();
  
  // Selected collections to add recipes to
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<string>>(new Set());
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addProgress, setAddProgress] = useState(0);
  
  // Fetch collections
  const { data: collections, isLoading: isLoadingCollections } = useCollections();
  
  // Mutations
  const addToCollection = useAddToCollection();
  const createCollection = useCreateCollection();
  
  const isCreating = createCollection.isPending;
  const hasValidName = newCollectionName.trim().length > 0;
  
  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      setSelectedCollectionIds(new Set());
      setShowCreateNew(false);
      setNewCollectionName('');
      setIsAdding(false);
      setAddProgress(0);
    }
  }, [visible]);
  
  const toggleCollection = (collectionId: string) => {
    setSelectedCollectionIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(collectionId)) {
        newSet.delete(collectionId);
      } else {
        newSet.add(collectionId);
      }
      return newSet;
    });
    haptics.light();
  };
  
  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;
    
    const name = newCollectionName.trim();
    Keyboard.dismiss();
    
    try {
      const newCollection = await createCollection.mutateAsync({ name });
      
      // Auto-select the new collection
      setSelectedCollectionIds(prev => new Set([...prev, newCollection.id]));
      
      haptics.success();
      setNewCollectionName('');
      setShowCreateNew(false);
    } catch {
      // Error handled by React Query
    }
  };
  
  const handleAddToCollections = async () => {
    if (selectedCollectionIds.size === 0 || recipeIds.length === 0) return;
    
    setIsAdding(true);
    setAddProgress(0);
    
    const totalOperations = recipeIds.length * selectedCollectionIds.size;
    let completed = 0;
    
    try {
      // Add each recipe to each selected collection
      for (const recipeId of recipeIds) {
        for (const collectionId of selectedCollectionIds) {
          try {
            await addToCollection.mutateAsync({ collectionId, recipeId });
          } catch {
            // Continue even if one fails
          }
          completed++;
          setAddProgress(Math.round((completed / totalOperations) * 100));
        }
      }
      
      haptics.success();
      onComplete?.();
    } catch {
      // Error handling
    } finally {
      setIsAdding(false);
    }
  };
  
  const canAdd = selectedCollectionIds.size > 0 && recipeIds.length > 0 && !isAdding;
  
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
                    <Text style={[styles.subtitle, { color: colors.textMuted }]}>
                      {recipeIds.length} recipe{recipeIds.length !== 1 ? 's' : ''} selected
                    </Text>
                  </RNView>
                  <TouchableOpacity 
                    onPress={onClose} 
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    disabled={isAdding}
                  >
                    <Ionicons name="close" size={24} color={colors.textMuted} />
                  </TouchableOpacity>
                </RNView>
                
                {/* Adding progress */}
                {isAdding && (
                  <RNView style={[styles.progressContainer, { backgroundColor: colors.tint + '15' }]}>
                    <ActivityIndicator size="small" color={colors.tint} />
                    <Text style={[styles.progressText, { color: colors.tint }]}>
                      Adding recipes... {addProgress}%
                    </Text>
                  </RNView>
                )}
                
                {/* Collections list */}
                {isLoadingCollections ? (
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
                          const isSelected = selectedCollectionIds.has(collection.id);
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
                              onPress={() => toggleCollection(collection.id)}
                              activeOpacity={0.7}
                              disabled={isAdding}
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
                            name="folder-outline" 
                            size={20} 
                            color={colors.tint} 
                          />
                          <RNView style={styles.inputWrapper}>
                            <Input
                              value={newCollectionName}
                              onChangeText={setNewCollectionName}
                              placeholder="Collection name..."
                              autoFocus
                              style={styles.collectionInput}
                              editable={!isCreating && !isAdding}
                              onSubmitEditing={hasValidName ? handleCreateCollection : undefined}
                              returnKeyType="done"
                            />
                          </RNView>
                          {hasValidName ? (
                            <TouchableOpacity 
                              onPress={handleCreateCollection}
                              disabled={isCreating}
                            >
                              {isCreating ? (
                                <ActivityIndicator size="small" color={colors.tint} />
                              ) : (
                                <Ionicons name="checkmark-circle" size={24} color={colors.tint} />
                              )}
                            </TouchableOpacity>
                          ) : (
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
                        disabled={isAdding}
                      >
                        <Ionicons name="add-circle-outline" size={24} color={colors.tint} />
                        <Text style={[styles.createNewText, { color: colors.tint }]}>
                          Create New Collection
                        </Text>
                      </TouchableOpacity>
                    )}
                  </ScrollView>
                )}
                
                {/* Footer with action button */}
                <RNView style={styles.footer}>
                  <Button
                    title={isAdding 
                      ? 'Adding...' 
                      : `Add to ${selectedCollectionIds.size} Collection${selectedCollectionIds.size !== 1 ? 's' : ''}`
                    }
                    onPress={handleAddToCollections}
                    disabled={!canAdd}
                    loading={isAdding}
                    style={styles.addButton}
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
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  progressText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
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
  addButton: {
    width: '100%',
  },
});
