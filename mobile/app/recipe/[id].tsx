import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  Linking,
  Share,
  View as RNView,
  ActivityIndicator,
  ActionSheetIOS,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  Keyboard,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, View, Card, Chip, Divider, useColors } from '@/components/Themed';
import AddIngredientsModal from '@/components/AddIngredientsModal';
import RecipeChatModal from '@/components/RecipeChatModal';
import AddToCollectionModal from '@/components/AddToCollectionModal';
import VersionHistoryModal from '@/components/VersionHistoryModal';
import { 
  useRecipe, 
  useDeleteRecipe, 
  useToggleRecipeSharing,
  useIsRecipeSaved,
  useSaveRecipe,
  useUnsaveRecipe,
  useAsyncExtraction,
  useRecipeNote,
  useUpdateRecipeNote,
} from '@/hooks/useRecipes';
import { useAddFromRecipe } from '@/hooks/useGrocery';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { Ingredient } from '@/types/recipe';

type TabType = 'ingredients' | 'steps' | 'nutrition' | 'cost';

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabType>('ingredients');
  const [scaledServings, setScaledServings] = useState<number | null>(null);
  
  const { data: recipe, isLoading, error, refetch } = useRecipe(id);
  const deleteMutation = useDeleteRecipe();
  const toggleSharingMutation = useToggleRecipeSharing();
  const addToGroceryMutation = useAddFromRecipe();
  const extraction = useAsyncExtraction();
  const [imageError, setImageError] = useState(false);
  const [showIngredientPicker, setShowIngredientPicker] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const notesInputRef = useRef<TextInput>(null);
  const [notesSectionY, setNotesSectionY] = useState(0);
  const { userId } = useAuth();
  const { user } = useUser();
  
  // Check if user is admin (from Clerk public metadata)
  const isAdmin = (user?.publicMetadata as any)?.role === 'admin';
  
  // Save/bookmark functionality
  const { data: savedStatus } = useIsRecipeSaved(id);
  const saveMutation = useSaveRecipe();
  const unsaveMutation = useUnsaveRecipe();
  const isSaved = savedStatus?.is_saved ?? false;
  const isSavePending = saveMutation.isPending || unsaveMutation.isPending;
  
  // Personal notes
  const { data: personalNote, isLoading: isNoteLoading } = useRecipeNote(id, !!userId);
  const updateNoteMutation = useUpdateRecipeNote();
  
  // Sync noteText with fetched note
  useEffect(() => {
    if (personalNote?.note_text !== undefined) {
      setNoteText(personalNote.note_text);
    }
  }, [personalNote?.note_text]);

  const handleSaveNote = () => {
    if (!noteText.trim()) {
      setIsEditingNote(false);
      return;
    }
    
    updateNoteMutation.mutate(
      { recipeId: id, noteText: noteText.trim() },
      {
        onSuccess: () => {
          setIsEditingNote(false);
        },
        onError: () => {
          Alert.alert('Error', 'Failed to save note');
        },
      }
    );
  };

  // Check if the current user owns this recipe
  const isOwner = recipe?.user_id === userId;
  
  // Check if recipe can be re-extracted (has a valid source URL, not manual)
  const canReExtract = recipe?.source_url && !recipe.source_url.startsWith('manual://');

  const handleReExtract = () => {
    if (!recipe || !canReExtract) return;
    
    Alert.alert(
      'Re-extract Recipe',
      'This will re-run the AI extraction with the latest model. Your current recipe will be updated, but the original will be preserved.\n\nYou can leave this screen - the extraction will continue in the background.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Re-extract',
          onPress: async () => {
            try {
              // Get the location from the recipe's cost data or default to Guam
              const location = recipe.extracted?.costLocation || 'Guam';
              await extraction.startReExtraction(id, location);
              // Navigate to home tab where the progress UI will show
              router.replace('/(tabs)');
            } catch (error: any) {
              const message = error?.message || 'Failed to start re-extraction';
              Alert.alert('Error', message);
            }
          },
        },
      ]
    );
  };
  
  // Get all ingredients from all components
  const allIngredients = recipe?.extracted.components.flatMap(
    (component) => component.ingredients
  ) || [];

  const handleAddToGrocery = () => {
    if (!recipe) return;
    
    if (allIngredients.length === 0) {
      Alert.alert('No Ingredients', 'This recipe has no ingredients to add.');
      return;
    }

    // Open the ingredient picker modal
    setShowIngredientPicker(true);
  };

  const handleConfirmAddToGrocery = (selectedIngredients: Ingredient[]) => {
    if (!recipe || selectedIngredients.length === 0) {
      setShowIngredientPicker(false);
      return;
    }

    addToGroceryMutation.mutate(
      {
        recipeId: recipe.id,
        recipeTitle: recipe.extracted.title,
        ingredients: selectedIngredients,
      },
      {
        onSuccess: () => {
          setShowIngredientPicker(false);
          Alert.alert(
            'Added!',
            `${selectedIngredients.length} ingredient${selectedIngredients.length !== 1 ? 's' : ''} added to your grocery list.`,
            [
              { text: 'OK' },
              { text: 'View List', onPress: () => router.push('/(tabs)/grocery') },
            ]
          );
        },
        onError: () => {
          Alert.alert('Error', 'Failed to add ingredients to grocery list.');
        },
      }
    );
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Recipe',
      'Are you sure you want to delete this recipe? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Navigate back immediately (optimistic) - don't wait for server
            router.back();
            // Fire delete in background
            deleteMutation.mutate(id, {
              onError: () => {
                Alert.alert('Error', 'Failed to delete recipe. Please try again.');
              },
            });
          },
        },
      ]
    );
  };

  const handleSaveToggle = () => {
    if (isSavePending) return;
    if (isSaved) {
      unsaveMutation.mutate(id);
    } else {
      saveMutation.mutate(id);
    }
  };

  const handleMoreOptions = () => {
    // Admin can re-extract any recipe, owner can re-extract their own
    const canShowReExtract = canReExtract && (isOwner || isAdmin);
    
    if (Platform.OS === 'ios') {
      if (isOwner) {
        // Owner options: Add to Collection, Edit, Version History, Re-extract (if applicable), Delete
        const options = ['Cancel', 'Add to Collection', 'Edit Recipe', 'Version History'];
        let reExtractIndex = -1;
        let deleteIndex = 4;
        
        if (canReExtract) {
          options.push('Re-extract with AI');
          reExtractIndex = 4;
          deleteIndex = 5;
        }
        options.push('Delete Recipe');
        
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options,
            destructiveButtonIndex: deleteIndex,
            cancelButtonIndex: 0,
          },
          (buttonIndex) => {
            if (buttonIndex === 1) {
              setShowCollectionModal(true);
            } else if (buttonIndex === 2) {
              router.push(`/edit-recipe/${id}`);
            } else if (buttonIndex === 3) {
              setShowVersionHistory(true);
            } else if (buttonIndex === reExtractIndex) {
              handleReExtract();
            } else if (buttonIndex === deleteIndex) {
              handleDelete();
            }
          }
        );
      } else {
        // Non-owner options: Save/Unsave, Add to Collection, Re-extract (admin only)
        const saveText = isSaved ? 'Remove from Saved' : 'Save to My Recipes';
        const options = ['Cancel', saveText, 'Add to Collection'];
        let reExtractIndex = -1;
        
        if (canShowReExtract) {
          options.push('Re-extract with AI');
          reExtractIndex = 3;
        }
        
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options,
            cancelButtonIndex: 0,
          },
          (buttonIndex) => {
            if (buttonIndex === 1) {
              handleSaveToggle();
            } else if (buttonIndex === 2) {
              setShowCollectionModal(true);
            } else if (buttonIndex === reExtractIndex) {
              handleReExtract();
            }
          }
        );
      }
    } else {
      // Android fallback using Alert
      if (isOwner) {
        const options: any[] = [
          { text: 'Add to Collection', onPress: () => setShowCollectionModal(true) },
          { text: 'Edit Recipe', onPress: () => router.push(`/edit-recipe/${id}`) },
          { text: 'Version History', onPress: () => setShowVersionHistory(true) },
        ];
        if (canReExtract) {
          options.push({ text: 'Re-extract with AI', onPress: handleReExtract });
        }
        options.push({ text: 'Delete Recipe', style: 'destructive', onPress: handleDelete });
        options.push({ text: 'Cancel', style: 'cancel' });
        
        Alert.alert('Recipe Options', '', options);
      } else {
        // Non-owner options
        const saveText = isSaved ? 'Remove from Saved' : 'Save to My Recipes';
        const options: any[] = [
          { text: saveText, onPress: handleSaveToggle },
          { text: 'Add to Collection', onPress: () => setShowCollectionModal(true) },
        ];
        if (canShowReExtract) {
          options.push({ text: 'Re-extract with AI', onPress: handleReExtract });
        }
        options.push({ text: 'Cancel', style: 'cancel' });
        
        Alert.alert('Recipe Options', '', options);
      }
    }
  };

  const formatRecipeAsText = () => {
    if (!recipe) return '';
    const { extracted } = recipe;
    
    let text = `🍳 ${extracted.title}\n`;
    text += '━'.repeat(30) + '\n\n';
    
    // Meta info
    const metaParts: string[] = [];
    if (extracted.servings) metaParts.push(`👥 ${extracted.servings} servings`);
    if (extracted.times.total) metaParts.push(`⏱️ ${extracted.times.total}`);
    if (extracted.totalEstimatedCost) metaParts.push(`💰 $${extracted.totalEstimatedCost.toFixed(2)}`);
    if (metaParts.length > 0) {
      text += metaParts.join('  •  ') + '\n\n';
    }
    
    // Tags
    if (extracted.tags.length > 0) {
      text += `🏷️ ${extracted.tags.join(', ')}\n\n`;
    }
    
    // Ingredients
    text += '📝 INGREDIENTS\n';
    text += '─'.repeat(20) + '\n';
    extracted.components.forEach((component, compIndex) => {
      if (extracted.components.length > 1 && component.name) {
        text += `\n${component.name}:\n`;
      }
      component.ingredients.forEach(ing => {
        const qty = ing.quantity && ing.quantity !== 'null' ? ing.quantity : '';
        const unit = ing.unit && ing.unit !== 'null' ? ing.unit : '';
        const qtyUnit = qty ? `${qty}${unit ? ' ' + unit : ''} ` : '';
        const notes = ing.notes && ing.notes !== 'null' ? ` (${ing.notes})` : '';
        text += `• ${qtyUnit}${ing.name}${notes}\n`;
      });
    });
    
    text += '\n';
    
    // Steps
    text += '👨‍🍳 INSTRUCTIONS\n';
    text += '─'.repeat(20) + '\n';
    let stepNum = 1;
    extracted.components.forEach((component) => {
      if (extracted.components.length > 1 && component.name) {
        text += `\n${component.name}:\n`;
      }
      component.steps.forEach(step => {
        text += `${stepNum}. ${step}\n`;
        stepNum++;
      });
    });
    
    // Nutrition (if available)
    if (extracted.nutrition?.perServing) {
      const n = extracted.nutrition.perServing;
      const nutritionParts: string[] = [];
      if (n.calories) nutritionParts.push(`${n.calories} cal`);
      if (n.protein) nutritionParts.push(`${n.protein}g protein`);
      if (n.carbs) nutritionParts.push(`${n.carbs}g carbs`);
      if (n.fat) nutritionParts.push(`${n.fat}g fat`);
      
      if (nutritionParts.length > 0) {
        text += '\n📊 NUTRITION (per serving)\n';
        text += '─'.repeat(20) + '\n';
        text += nutritionParts.join(' | ') + '\n';
      }
    }
    
    // Equipment
    if (extracted.equipment && extracted.equipment.length > 0) {
      text += '\n🔧 EQUIPMENT\n';
      text += '─'.repeat(20) + '\n';
      text += extracted.equipment.join(', ') + '\n';
    }
    
    // Source
    text += '\n' + '━'.repeat(30) + '\n';
    text += `📺 Source: ${recipe.source_url}\n`;
    text += `Extracted with Håfa Recipes 🧑‍🍳`;
    
    return text;
  };

  const handleShare = async () => {
    if (!recipe) return;
    
    Alert.alert(
      'Share Recipe',
      'How would you like to share?',
      [
        {
          text: 'Full Recipe',
          onPress: async () => {
            try {
              await Share.share({
                message: formatRecipeAsText(),
              });
            } catch {
              // Share cancelled by user - not an error
            }
          },
        },
        {
          text: 'Just Link',
          onPress: async () => {
            try {
              await Share.share({
                title: recipe.extracted.title,
                message: `Check out this recipe: ${recipe.extracted.title}\n\n${recipe.source_url}`,
                url: recipe.source_url,
              });
            } catch {
              // Share cancelled by user - not an error
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleOpenSource = () => {
    if (recipe?.source_url) {
      Linking.openURL(recipe.source_url);
    }
  };

  const handleToggleSharing = async () => {
    if (!recipe) return;
    try {
      await toggleSharingMutation.mutateAsync(id);
    } catch (error) {
      Alert.alert('Error', 'Failed to update sharing settings');
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading recipe...
        </Text>
      </View>
    );
  }

  if (error || !recipe) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorEmoji}>😕</Text>
        <Text style={[styles.errorTitle, { color: colors.text }]}>
          Recipe not found
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={[styles.linkText, { color: colors.tint }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { extracted } = recipe;
  const sourceIcon = recipe.source_type === 'tiktok' 
    ? 'logo-tiktok' 
    : recipe.source_type === 'youtube' 
      ? 'logo-youtube' 
      : recipe.source_type === 'instagram' 
        ? 'logo-instagram' 
        : 'globe-outline';
  
  const sourceLabel = recipe.source_type === 'tiktok' 
    ? 'TikTok' 
    : recipe.source_type === 'youtube' 
      ? 'YouTube' 
      : recipe.source_type === 'instagram' 
        ? 'Instagram' 
        : 'Video';

  const tabs: { key: TabType; label: string }[] = [
    { key: 'ingredients', label: 'Ingredients' },
    { key: 'steps', label: 'Steps' },
    { key: 'nutrition', label: 'Nutrition' },
    ...(extracted.totalEstimatedCost ? [{ key: 'cost' as TabType, label: 'Cost' }] : []),
  ];

  // Recipe scaling logic
  const originalServings = extracted.servings || 1;
  const currentServings = scaledServings ?? originalServings;
  const scaleFactor = currentServings / originalServings;
  const isScaled = scaledServings !== null && scaledServings !== originalServings;

  // Helper to scale ingredient quantities
  const scaleQuantity = (quantity: string | null): string | null => {
    if (!quantity || scaleFactor === 1) return quantity;
    
    // Try to parse the quantity as a number or fraction
    const parsed = parseFloat(quantity);
    if (!isNaN(parsed)) {
      const scaled = parsed * scaleFactor;
      // Format nicely: show fractions for small numbers, decimals for larger
      if (scaled < 1) {
        // Convert to common fractions
        const fractions: Record<string, string> = {
          '0.25': '¼', '0.33': '⅓', '0.5': '½', '0.67': '⅔', '0.75': '¾',
        };
        const key = scaled.toFixed(2);
        return fractions[key] || scaled.toFixed(1);
      }
      return scaled % 1 === 0 ? scaled.toString() : scaled.toFixed(1);
    }
    return quantity; // Return original if can't parse
  };

  return (
    <>
      <Stack.Screen 
        options={{ 
          headerTitle: 'Recipe',
          headerRight: () => (
            <RNView style={styles.headerButtons}>
              <TouchableOpacity onPress={() => setShowChatModal(true)} style={styles.headerButton}>
                <Ionicons name="chatbubbles-outline" size={22} color={colors.tint} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleShare} style={styles.headerButton}>
                <Ionicons name="share-outline" size={22} color={colors.tint} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleMoreOptions} style={styles.headerButton}>
                <Ionicons name="ellipsis-horizontal" size={22} color={colors.tint} />
              </TouchableOpacity>
            </RNView>
          ),
        }} 
      />
      
      <KeyboardAvoidingView 
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
        >
        <ScrollView 
          ref={scrollViewRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl + 100 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero Image */}
          {recipe.thumbnail_url && !imageError ? (
            <Image 
              source={{ uri: recipe.thumbnail_url }} 
              style={styles.heroImage}
              onError={() => setImageError(true)}
            />
          ) : (
            <RNView style={[styles.placeholderHero, { backgroundColor: colors.tint + '15' }]}>
              <Ionicons name="restaurant-outline" size={64} color={colors.tint} />
            </RNView>
          )}

          {/* Content */}
          <RNView style={styles.content}>
            {/* Title */}
            <Text style={[styles.title, { color: colors.text }]}>
              {extracted.title}
            </Text>
            
            {/* Meta Row */}
            <RNView style={styles.metaRow}>
              {extracted.servings && (
                <RNView style={[styles.metaItemScalable, { backgroundColor: colors.backgroundSecondary }]}>
                  <TouchableOpacity 
                    style={[styles.scaleButton, { backgroundColor: colors.tint + '20' }]}
                    onPress={() => setScaledServings(Math.max(1, currentServings - 1))}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="remove" size={16} color={colors.tint} />
                  </TouchableOpacity>
                  <RNView style={styles.servingsDisplay}>
                    <Text style={styles.metaIcon}>👥</Text>
                    <Text style={[styles.metaValue, { color: isScaled ? colors.tint : colors.text }]}>
                      {currentServings}
                    </Text>
                    <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
                      {isScaled ? `(was ${originalServings})` : 'servings'}
                    </Text>
                  </RNView>
                  <TouchableOpacity 
                    style={[styles.scaleButton, { backgroundColor: colors.tint + '20' }]}
                    onPress={() => setScaledServings(currentServings + 1)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="add" size={16} color={colors.tint} />
                  </TouchableOpacity>
                  {isScaled && (
                    <TouchableOpacity 
                      style={styles.resetButton}
                      onPress={() => setScaledServings(null)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="refresh" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </RNView>
              )}
              {extracted.times.total && (
                <RNView style={[styles.metaItem, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={styles.metaIcon}>⏱️</Text>
                  <Text style={[styles.metaValue, { color: colors.text }]}>
                    {extracted.times.total}
                  </Text>
                </RNView>
              )}
              {extracted.totalEstimatedCost && (
                <RNView style={[styles.metaItem, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={styles.metaIcon}>💰</Text>
                  <Text style={[styles.metaValue, { color: colors.text }]}>
                    ${extracted.totalEstimatedCost.toFixed(2)}
                  </Text>
                </RNView>
              )}
            </RNView>

            {/* Quality Badge */}
            {recipe.has_audio_transcript && (
              <RNView style={[styles.qualityBadge, { backgroundColor: colors.success + '15' }]}>
                <Text style={[styles.qualityText, { color: colors.success }]}>
                  🎤 High Quality · Audio Transcribed
                </Text>
              </RNView>
            )}

            {/* Tags */}
            {extracted.tags.length > 0 && (
              <RNView style={styles.tagContainer}>
                {extracted.tags.map((tag, index) => (
                  <Chip key={index} label={tag} size="sm" />
                ))}
              </RNView>
            )}

            {/* Start Cooking Button */}
            <TouchableOpacity
              style={[styles.startCookingButton, { backgroundColor: colors.tint }]}
              onPress={() => router.push(`/cook-mode/${id}` as any)}
              activeOpacity={0.8}
            >
              <Ionicons name="restaurant" size={24} color="#FFFFFF" />
              <RNView style={styles.startCookingTextContainer}>
                <Text style={styles.startCookingText}>Start Cooking</Text>
                <Text style={styles.startCookingSubtext}>Step-by-step mode</Text>
              </RNView>
              <Ionicons name="chevron-forward" size={24} color="#FFFFFF" />
            </TouchableOpacity>

            {/* Recipe Notes (from creator/extraction) */}
            {extracted.notes && extracted.notes !== 'null' && (
              <RNView style={[styles.notesSection, { backgroundColor: colors.backgroundSecondary }]}>
                <RNView style={styles.notesTitleRow}>
                  <Ionicons name="document-text-outline" size={18} color={colors.tint} />
                  <Text style={[styles.notesTitle, { color: colors.text }]}>Recipe Notes</Text>
                </RNView>
                <Text style={[styles.notesText, { color: colors.textSecondary }]}>
                  {extracted.notes}
                </Text>
              </RNView>
            )}

            {/* Personal Notes Section - only show when logged in */}
            {userId && (
              <RNView 
                style={[styles.personalNotesSection, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
                onLayout={(event) => {
                  const { y } = event.nativeEvent.layout;
                  setNotesSectionY(y);
                }}
              >
                <RNView style={styles.personalNotesTitleRow}>
                  <RNView style={styles.personalNotesTitleLeft}>
                    <Ionicons name="pencil-outline" size={18} color={colors.accent} />
                    <Text style={[styles.notesTitle, { color: colors.text }]}>My Notes</Text>
                    <Text style={[styles.personalNotesPrivate, { color: colors.textMuted }]}>(Private)</Text>
                  </RNView>
                  {!isEditingNote && (
                    <TouchableOpacity 
                      onPress={() => {
                        setIsEditingNote(true);
                        // Scroll to notes section after a brief delay for keyboard
                        setTimeout(() => {
                          scrollViewRef.current?.scrollTo({ y: notesSectionY - 100, animated: true });
                        }, 300);
                      }}
                      style={[styles.editNoteButton, { backgroundColor: colors.tint + '15' }]}
                    >
                      <Text style={[styles.editNoteButtonText, { color: colors.tint }]}>
                        {personalNote?.note_text ? 'Edit' : 'Add Note'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </RNView>
                
                {isEditingNote ? (
                  <RNView style={styles.noteEditContainer}>
                    <TextInput
                      ref={notesInputRef}
                      style={[
                        styles.noteInput, 
                        { 
                          color: colors.text, 
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        }
                      ]}
                      placeholder="Add your personal notes here..."
                      placeholderTextColor={colors.textMuted}
                      value={noteText}
                      onChangeText={setNoteText}
                      multiline
                      numberOfLines={4}
                      textAlignVertical="top"
                      autoFocus
                      onFocus={() => {
                        // Scroll to keep input visible when focused
                        setTimeout(() => {
                          scrollViewRef.current?.scrollTo({ y: notesSectionY - 50, animated: true });
                        }, 100);
                      }}
                    />
                    <RNView style={styles.noteButtonRow}>
                      <TouchableOpacity 
                        style={[styles.noteCancelButton, { borderColor: colors.border }]}
                        onPress={() => {
                          setNoteText(personalNote?.note_text || '');
                          setIsEditingNote(false);
                        }}
                      >
                        <Text style={[styles.noteCancelButtonText, { color: colors.textMuted }]}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.noteSaveButton, { backgroundColor: colors.tint }]}
                        onPress={handleSaveNote}
                        disabled={updateNoteMutation.isPending}
                      >
                        <Text style={styles.noteSaveButtonText}>
                          {updateNoteMutation.isPending ? 'Saving...' : 'Save'}
                        </Text>
                      </TouchableOpacity>
                    </RNView>
                  </RNView>
                ) : (
                  personalNote?.note_text ? (
                    <Text style={[styles.notesText, { color: colors.textSecondary }]}>
                      {personalNote.note_text}
                    </Text>
                  ) : (
                    <Text style={[styles.noNotesText, { color: colors.textMuted }]}>
                      Tap "Add Note" to add your personal notes
                    </Text>
                  )
                )}
              </RNView>
            )}

            {/* Source Button */}
            <TouchableOpacity 
              style={[styles.sourceButton, { borderColor: colors.border }]} 
              onPress={handleOpenSource}
              activeOpacity={0.7}
            >
              <Ionicons name={sourceIcon as any} size={20} color={colors.textSecondary} />
              <Text style={[styles.sourceButtonText, { color: colors.text }]}>
                View on {sourceLabel}
              </Text>
              <Ionicons name="open-outline" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            {/* Share to Library Toggle - only show for owner */}
            {isOwner && (
              <TouchableOpacity 
                style={[
                  styles.shareButton, 
                  { 
                    borderColor: recipe.is_public ? colors.success : colors.border,
                    backgroundColor: recipe.is_public ? colors.success + '10' : 'transparent',
                  }
                ]} 
                onPress={handleToggleSharing}
                activeOpacity={0.7}
                disabled={toggleSharingMutation.isPending}
              >
                <Ionicons 
                  name={recipe.is_public ? 'globe' : 'globe-outline'} 
                  size={20} 
                  color={recipe.is_public ? colors.success : colors.textSecondary} 
                />
                <Text style={[
                  styles.shareButtonText, 
                  { color: recipe.is_public ? colors.success : colors.text }
                ]}>
                  {toggleSharingMutation.isPending 
                    ? 'Updating...' 
                    : recipe.is_public 
                      ? 'Shared to Library' 
                      : 'Share to Library'
                  }
                </Text>
                <Ionicons 
                  name={recipe.is_public ? 'checkmark-circle' : 'add-circle-outline'} 
                  size={18} 
                  color={recipe.is_public ? colors.success : colors.textMuted} 
                />
              </TouchableOpacity>
            )}

            {/* Public badge for non-owner viewing public recipe */}
            {!isOwner && recipe.is_public && (
              <RNView style={[styles.publicBadge, { backgroundColor: colors.tint + '15' }]}>
                <Ionicons name="globe" size={16} color={colors.tint} />
                <Text style={[styles.publicBadgeText, { color: colors.tint }]}>
                  Public Recipe
                </Text>
              </RNView>
            )}

            {/* Tabs */}
            <RNView style={[styles.tabContainer, { borderBottomColor: colors.border }]}>
              {tabs.map((tab) => (
                <TouchableOpacity
                  key={tab.key}
                  style={[
                    styles.tab,
                    activeTab === tab.key && { borderBottomColor: colors.tint },
                  ]}
                  onPress={() => setActiveTab(tab.key)}
                >
                  <Text 
                    style={[
                      styles.tabText, 
                      { color: activeTab === tab.key ? colors.tint : colors.textMuted },
                      activeTab === tab.key && styles.tabTextActive,
                    ]}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </RNView>

            {/* Tab Content */}
            <RNView style={styles.tabContent}>
              {activeTab === 'ingredients' && (
                <>
                  {extracted.components.map((component, compIndex) => (
                    <RNView key={compIndex} style={styles.componentSection}>
                      {extracted.components.length > 1 && component.name && typeof component.name === 'string' ? (
                        <Text style={[styles.componentTitle, { color: colors.tint }]}>
                          {component.name}
                        </Text>
                      ) : null}
                      {component.ingredients.map((ing, ingIndex) => {
                        // Build the quantity/unit string safely (with scaling)
                        const originalQty = ing.quantity && ing.quantity !== 'null' ? ing.quantity : '';
                        const scaledQty = scaleQuantity(originalQty);
                        const unit = ing.unit && ing.unit !== 'null' ? ing.unit : '';
                        const qtyUnit = scaledQty ? `${scaledQty}${unit ? ` ${unit}` : ''} ` : '';
                        const notes = ing.notes && ing.notes !== 'null' ? ing.notes : '';
                        const cost = typeof ing.estimatedCost === 'number' 
                          ? `$${(ing.estimatedCost * scaleFactor).toFixed(2)}` 
                          : null;
                        
                        return (
                          <RNView key={ingIndex} style={styles.ingredientRow}>
                            <RNView style={[styles.bullet, { backgroundColor: isScaled ? colors.tint : colors.tint }]} />
                            <RNView style={styles.ingredientContent}>
                              <Text style={[styles.ingredientText, { color: colors.text }]}>
                                {qtyUnit ? (
                                  <Text style={[styles.ingredientQty, isScaled && { color: colors.tint }]}>
                                    {qtyUnit}
                                  </Text>
                                ) : null}
                                {ing.name}
                                {notes ? <Text style={[styles.ingredientNotes, { color: colors.textMuted }]}>{` (${notes})`}</Text> : null}
                              </Text>
                              {cost ? <Text style={[styles.ingredientCost, { color: colors.textMuted }]}>{cost}</Text> : null}
                            </RNView>
                          </RNView>
                        );
                      })}
                    </RNView>
                  ))}
                  
                  {/* Add to Grocery List Button */}
                  <TouchableOpacity
                    style={[styles.addToGroceryButton, { backgroundColor: colors.tint }]}
                    onPress={handleAddToGrocery}
                    activeOpacity={0.8}
                    disabled={addToGroceryMutation.isPending}
                  >
                    <Ionicons name="cart-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.addToGroceryText}>
                      {addToGroceryMutation.isPending ? 'Adding...' : 'Add to Grocery List'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {activeTab === 'steps' && (
                <>
                  {extracted.components.map((component, compIndex) => (
                    <RNView key={compIndex} style={styles.componentSection}>
                      {extracted.components.length > 1 && (
                        <Text style={[styles.componentTitle, { color: colors.tint }]}>
                          {component.name}
                        </Text>
                      )}
                      {component.steps.map((step, stepIndex) => (
                        <RNView key={stepIndex} style={styles.stepRow}>
                          <RNView style={[styles.stepNumber, { backgroundColor: colors.tint }]}>
                            <Text style={styles.stepNumberText}>{stepIndex + 1}</Text>
                          </RNView>
                          <Text style={[styles.stepText, { color: colors.text }]}>
                            {step}
                          </Text>
                        </RNView>
                      ))}
                    </RNView>
                  ))}
                </>
              )}

              {activeTab === 'nutrition' && (
                <>
                  {/* Per Serving */}
                  {extracted.nutrition?.perServing && (
                    <RNView style={styles.nutritionSection}>
                      <Text style={[styles.nutritionTitle, { color: colors.text }]}>
                        Per Serving
                      </Text>
                      <RNView style={styles.nutritionGrid}>
                        {extracted.nutrition.perServing.calories && (
                          <RNView style={[styles.nutritionItem, { backgroundColor: colors.backgroundSecondary }]}>
                            <Text style={[styles.nutritionValue, { color: colors.tint }]}>
                              {extracted.nutrition.perServing.calories}
                            </Text>
                            <Text style={[styles.nutritionLabel, { color: colors.textMuted }]}>
                              Calories
                            </Text>
                          </RNView>
                        )}
                        {extracted.nutrition.perServing.protein && (
                          <RNView style={[styles.nutritionItem, { backgroundColor: colors.backgroundSecondary }]}>
                            <Text style={[styles.nutritionValue, { color: colors.tint }]}>
                              {extracted.nutrition.perServing.protein}g
                            </Text>
                            <Text style={[styles.nutritionLabel, { color: colors.textMuted }]}>
                              Protein
                            </Text>
                          </RNView>
                        )}
                        {extracted.nutrition.perServing.carbs && (
                          <RNView style={[styles.nutritionItem, { backgroundColor: colors.backgroundSecondary }]}>
                            <Text style={[styles.nutritionValue, { color: colors.tint }]}>
                              {extracted.nutrition.perServing.carbs}g
                            </Text>
                            <Text style={[styles.nutritionLabel, { color: colors.textMuted }]}>
                              Carbs
                            </Text>
                          </RNView>
                        )}
                        {extracted.nutrition.perServing.fat && (
                          <RNView style={[styles.nutritionItem, { backgroundColor: colors.backgroundSecondary }]}>
                            <Text style={[styles.nutritionValue, { color: colors.tint }]}>
                              {extracted.nutrition.perServing.fat}g
                            </Text>
                            <Text style={[styles.nutritionLabel, { color: colors.textMuted }]}>
                              Fat
                            </Text>
                          </RNView>
                        )}
                      </RNView>
                    </RNView>
                  )}

                  {/* Equipment */}
                  {extracted.equipment && extracted.equipment.length > 0 && (
                    <RNView style={styles.equipmentSection}>
                      <Text style={[styles.nutritionTitle, { color: colors.text }]}>
                        Equipment
                      </Text>
                      <RNView style={styles.equipmentList}>
                        {extracted.equipment.map((item, index) => (
                          <RNView 
                            key={index} 
                            style={[styles.equipmentItem, { backgroundColor: colors.backgroundSecondary }]}
                          >
                            <Text style={[styles.equipmentText, { color: colors.text }]}>
                              🔧 {item}
                            </Text>
                          </RNView>
                        ))}
                      </RNView>
                    </RNView>
                  )}
                </>
              )}

              {activeTab === 'cost' && extracted.totalEstimatedCost && (
                <>
                  {/* Cost Summary */}
                  <RNView style={styles.costSummaryCard}>
                    <RNView style={[styles.costTotalBox, { backgroundColor: colors.tint }]}>
                      <Text style={styles.costTotalLabel}>Estimated Total Cost</Text>
                      <Text style={styles.costTotalValue}>
                        ${(extracted.totalEstimatedCost * scaleFactor).toFixed(2)}
                      </Text>
                      {isScaled && (
                        <Text style={styles.costScaledNote}>
                          (scaled for {currentServings} servings)
                        </Text>
                      )}
                    </RNView>
                    
                    <RNView style={styles.costMetaRow}>
                      <RNView style={[styles.costMetaItem, { backgroundColor: colors.backgroundSecondary }]}>
                        <Text style={[styles.costMetaValue, { color: colors.text }]}>
                          ${((extracted.totalEstimatedCost * scaleFactor) / currentServings).toFixed(2)}
                        </Text>
                        <Text style={[styles.costMetaLabel, { color: colors.textMuted }]}>
                          per serving
                        </Text>
                      </RNView>
                      <RNView style={[styles.costMetaItem, { backgroundColor: colors.backgroundSecondary }]}>
                        <Text style={[styles.costMetaValue, { color: colors.text }]}>
                          📍 {extracted.costLocation}
                        </Text>
                        <Text style={[styles.costMetaLabel, { color: colors.textMuted }]}>
                          pricing region
                        </Text>
                      </RNView>
                    </RNView>
                  </RNView>

                  {/* Cost Breakdown */}
                  <RNView style={styles.costBreakdownSection}>
                    <Text style={[styles.costBreakdownTitle, { color: colors.text }]}>
                      Ingredient Costs
                    </Text>
                    {extracted.components.map((component, compIndex) => (
                      <RNView key={compIndex}>
                        {extracted.components.length > 1 && (
                          <Text style={[styles.componentTitle, { color: colors.tint }]}>
                            {component.name}
                          </Text>
                        )}
                        {component.ingredients
                          .filter(ing => typeof ing.estimatedCost === 'number')
                          .map((ing, ingIndex) => {
                            const scaledCost = (ing.estimatedCost || 0) * scaleFactor;
                            const originalQty = ing.quantity && ing.quantity !== 'null' ? ing.quantity : '';
                            const scaledQty = scaleQuantity(originalQty);
                            const unit = ing.unit && ing.unit !== 'null' ? ing.unit : '';
                            
                            return (
                              <RNView 
                                key={ingIndex} 
                                style={[styles.costItem, { borderBottomColor: colors.border }]}
                              >
                                <RNView style={styles.costItemLeft}>
                                  <Text style={[styles.costItemName, { color: colors.text }]}>
                                    {ing.name}
                                  </Text>
                                  {scaledQty && (
                                    <Text style={[styles.costItemQty, { color: colors.textMuted }]}>
                                      {scaledQty}{unit ? ` ${unit}` : ''}
                                    </Text>
                                  )}
                                </RNView>
                                <Text style={[styles.costItemPrice, { color: colors.tint }]}>
                                  ${scaledCost.toFixed(2)}
                                </Text>
                              </RNView>
                            );
                          })}
                      </RNView>
                    ))}
                  </RNView>
                </>
              )}
            </RNView>
          </RNView>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Add Ingredients Modal */}
      {recipe && (
        <AddIngredientsModal
          visible={showIngredientPicker}
          onClose={() => setShowIngredientPicker(false)}
          onConfirm={handleConfirmAddToGrocery}
          ingredients={allIngredients}
          recipeTitle={recipe.extracted.title}
          isLoading={addToGroceryMutation.isPending}
        />
      )}

      {/* AI Chat Modal */}
      {recipe && (
        <RecipeChatModal
          isVisible={showChatModal}
          onClose={() => setShowChatModal(false)}
          recipe={recipe}
        />
      )}
      
      {/* Add to Collection Modal */}
      {recipe && (
        <AddToCollectionModal
          visible={showCollectionModal}
          onClose={() => setShowCollectionModal(false)}
          recipeId={id}
          recipeTitle={extracted?.title || 'Recipe'}
        />
      )}

      {/* Version History Modal */}
      {recipe && (
        <VersionHistoryModal
          visible={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          recipeId={id}
          currentTitle={extracted?.title}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  errorTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.md,
  },
  linkText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerButton: {
    padding: spacing.xs,
  },
  heroImage: {
    width: '100%',
    height: 250,
  },
  placeholderHero: {
    width: '100%',
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: spacing.lg,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    lineHeight: 34,
    marginBottom: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  metaIcon: {
    fontSize: 16,
  },
  metaValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  metaLabel: {
    fontSize: fontSize.sm,
  },
  // Scalable servings
  metaItemScalable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  scaleButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  servingsDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  resetButton: {
    padding: spacing.xs,
    marginLeft: spacing.xs,
  },
  // Notes section
  notesSection: {
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  notesTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  notesTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  notesText: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  // Personal notes styles
  personalNotesSection: {
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  personalNotesTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  personalNotesTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  personalNotesPrivate: {
    fontSize: fontSize.xs,
    fontStyle: 'italic',
  },
  editNoteButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  editNoteButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  noteEditContainer: {
    marginTop: spacing.xs,
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    minHeight: 100,
    lineHeight: 22,
  },
  noteButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  noteCancelButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  noteCancelButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  noteSaveButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  noteSaveButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  noNotesText: {
    fontSize: fontSize.sm,
    fontStyle: 'italic',
  },
  qualityBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  qualityText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  startCookingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
  },
  startCookingTextContainer: {
    flex: 1,
    marginLeft: spacing.md,
  },
  startCookingText: {
    color: '#FFFFFF',
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  startCookingSubtext: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  sourceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  sourceButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  shareButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
  publicBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  publicBadgeText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    fontSize: fontSize.md,
  },
  tabTextActive: {
    fontWeight: fontWeight.semibold,
  },
  tabContent: {
    minHeight: 200,
  },
  componentSection: {
    marginBottom: spacing.lg,
  },
  componentTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.md,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    marginRight: spacing.md,
  },
  ingredientContent: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  ingredientText: {
    flex: 1,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  ingredientQty: {
    fontWeight: fontWeight.semibold,
  },
  ingredientNotes: {
    fontStyle: 'italic',
  },
  ingredientCost: {
    fontSize: fontSize.sm,
    marginLeft: spacing.sm,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  stepNumberText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  stepText: {
    flex: 1,
    fontSize: fontSize.md,
    lineHeight: 24,
  },
  nutritionSection: {
    marginBottom: spacing.xl,
  },
  nutritionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.md,
  },
  nutritionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  nutritionItem: {
    width: '48%',
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  nutritionValue: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
  },
  nutritionLabel: {
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  equipmentSection: {
    marginTop: spacing.md,
  },
  equipmentList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  equipmentItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  equipmentText: {
    fontSize: fontSize.sm,
  },
  addToGroceryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  addToGroceryText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  // Cost tab styles
  costSummaryCard: {
    marginBottom: spacing.xl,
  },
  costTotalBox: {
    padding: spacing.xl,
    borderRadius: radius.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  costTotalLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
  },
  costTotalValue: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: fontWeight.bold,
  },
  costScaledNote: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  costMetaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  costMetaItem: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  costMetaValue: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  costMetaLabel: {
    fontSize: fontSize.sm,
  },
  costBreakdownSection: {
    marginBottom: spacing.lg,
  },
  costBreakdownTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.md,
  },
  costItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  costItemLeft: {
    flex: 1,
  },
  costItemName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  costItemQty: {
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  costItemPrice: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
