import { useState } from 'react';
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
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, View, Card, Chip, Divider, useColors } from '@/components/Themed';
import AddIngredientsModal from '@/components/AddIngredientsModal';
import RecipeChatModal from '@/components/RecipeChatModal';
import { 
  useRecipe, 
  useDeleteRecipe, 
  useToggleRecipeSharing,
  useIsRecipeSaved,
  useSaveRecipe,
  useUnsaveRecipe,
} from '@/hooks/useRecipes';
import { useAddFromRecipe } from '@/hooks/useGrocery';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { useAuth } from '@clerk/clerk-expo';
import { Ingredient } from '@/types/recipe';

type TabType = 'ingredients' | 'steps' | 'nutrition';

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabType>('ingredients');
  
  const { data: recipe, isLoading, error } = useRecipe(id);
  const deleteMutation = useDeleteRecipe();
  const toggleSharingMutation = useToggleRecipeSharing();
  const addToGroceryMutation = useAddFromRecipe();
  const [imageError, setImageError] = useState(false);
  const [showIngredientPicker, setShowIngredientPicker] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const { userId } = useAuth();
  
  // Save/bookmark functionality
  const { data: savedStatus } = useIsRecipeSaved(id);
  const saveMutation = useSaveRecipe();
  const unsaveMutation = useUnsaveRecipe();
  const isSaved = savedStatus?.is_saved ?? false;
  const isSavePending = saveMutation.isPending || unsaveMutation.isPending;
  
  // Check if the current user owns this recipe
  const isOwner = recipe?.user_id === userId;
  
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
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync(id);
              router.back();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete recipe');
            }
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
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Edit Recipe', 'Delete Recipe'],
          destructiveButtonIndex: 2,
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            router.push(`/edit-recipe/${id}`);
          } else if (buttonIndex === 2) {
            handleDelete();
          }
        }
      );
    } else {
      // Android fallback using Alert
      Alert.alert(
        'Recipe Options',
        '',
        [
          { text: 'Edit Recipe', onPress: () => router.push(`/edit-recipe/${id}`) },
          { text: 'Delete Recipe', style: 'destructive', onPress: handleDelete },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
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
    text += `Extracted with Recipe Extractor 🧑‍🍳`;
    
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
            } catch (error) {
              console.error('Share error:', error);
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
            } catch (error) {
              console.error('Share error:', error);
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
  ];

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
              {/* Save button for non-owners */}
              {!isOwner && userId && (
                <TouchableOpacity onPress={handleSaveToggle} style={styles.headerButton} disabled={isSavePending}>
                  {isSavePending ? (
                    <ActivityIndicator size="small" color={colors.tint} />
                  ) : (
                    <Ionicons 
                      name={isSaved ? "heart" : "heart-outline"} 
                      size={22} 
                      color={isSaved ? colors.error : colors.tint} 
                    />
                  )}
                </TouchableOpacity>
              )}
              {/* More options for owners */}
              {isOwner && (
                <TouchableOpacity onPress={handleMoreOptions} style={styles.headerButton}>
                  <Ionicons name="ellipsis-horizontal" size={22} color={colors.tint} />
                </TouchableOpacity>
              )}
            </RNView>
          ),
        }} 
      />
      
      <View style={styles.container}>
        <ScrollView 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
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
                <RNView style={[styles.metaItem, { backgroundColor: colors.backgroundSecondary }]}>
                  <Text style={styles.metaIcon}>👥</Text>
                  <Text style={[styles.metaValue, { color: colors.text }]}>
                    {extracted.servings}
                  </Text>
                  <Text style={[styles.metaLabel, { color: colors.textMuted }]}>
                    servings
                  </Text>
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
                        // Build the quantity/unit string safely
                        const qty = ing.quantity && ing.quantity !== 'null' ? ing.quantity : '';
                        const unit = ing.unit && ing.unit !== 'null' ? ing.unit : '';
                        const qtyUnit = qty ? `${qty}${unit ? ` ${unit}` : ''} ` : '';
                        const notes = ing.notes && ing.notes !== 'null' ? ing.notes : '';
                        const cost = typeof ing.estimatedCost === 'number' ? `$${ing.estimatedCost.toFixed(2)}` : null;
                        
                        return (
                          <RNView key={ingIndex} style={styles.ingredientRow}>
                            <RNView style={[styles.bullet, { backgroundColor: colors.tint }]} />
                            <RNView style={styles.ingredientContent}>
                              <Text style={[styles.ingredientText, { color: colors.text }]}>
                                {qtyUnit ? <Text style={styles.ingredientQty}>{qtyUnit}</Text> : null}
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
            </RNView>
          </RNView>
        </ScrollView>
      </View>

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
});
