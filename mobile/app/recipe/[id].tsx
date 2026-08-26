import { useState, useEffect, useMemo, useRef } from 'react';
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
  Modal,
  Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Text, View, Card, Chip, Divider, useColors } from '@/components/Themed';
import AddIngredientsModal from '@/components/AddIngredientsModal';
import RecipeChatModal from '@/components/RecipeChatModal';
import AddToCollectionModal from '@/components/AddToCollectionModal';
import { RecipeCollectionsCard } from '@/components/RecipeCollectionsCard';
import { RecipeMealPlanCard } from '@/components/RecipeMealPlanCard';
import VersionHistoryModal from '@/components/VersionHistoryModal';
import { SafetyActionModal } from '@/components/SafetyActionModal';
import { 
  useRecipe, 
  useDeleteRecipe, 
  useToggleRecipeSharing,
  useIsRecipeSaved,
  useSaveRecipe,
  useUnsaveRecipe,
  useRecipeNote,
  useUpdateRecipeNote,
  useSimilarRecipes,
} from '@/hooks/useRecipes';
import { useAsyncExtraction } from '@/contexts/ExtractionContext';
import { RecipeListItem } from '@/types/recipe';
import { useAddFromRecipe } from '@/hooks/useGrocery';
import { useCollections, useRecipeCollections } from '@/hooks/useCollections';
import { useRecipeMealPlanEntries } from '@/hooks/useMealPlan';
import { SkeletonSimilarRecipes } from '@/components/Skeleton';
import { formatPublishDisclosure, getPublishDisclosure } from '@/lib/recipePublishing';
import { usePublishingDisclosure } from '@/hooks/usePublishingDisclosure';
import { getRecipeSourcePresentation } from '@/lib/recipeSource';
import { spacing, fontSize, fontWeight, radius, shadows, fontFamily } from '@/constants/Colors';
import { useTextSize } from '@/hooks/useTextSize';
import { useAuth, useUser } from '@clerk/expo';
import { Ingredient } from '@/types/recipe';
import { useScaledServings, scaleQuantity, scaleIngredient } from '@/hooks/useScaledServings';
import {
  useBlockContributor,
  useCreateSafetyAppeal,
  useCreateSafetyReport,
} from '@/hooks/useCommunitySafety';
import { getSafetyErrorMessage } from '@/lib/communitySafety';
import { collectionsContainingRecipe } from '@/lib/recipeRelationships';
import { appRoutes } from '@/lib/routes';
import type { ReportCategory, SafetyTargetType } from '@/types/communitySafety';

type TabType = 'ingredients' | 'steps' | 'nutrition' | 'cost';
type RecipeMenuAction = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

/**
 * Similar Recipe Card with proper image error handling
 */
function SimilarRecipeCard({ 
  item, 
  onPress,
  colors,
}: { 
  item: RecipeListItem; 
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [imageError, setImageError] = useState(false);
  const showPlaceholder = !item.thumbnail_url || imageError;

  return (
    <TouchableOpacity
      style={[styles.similarCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {showPlaceholder ? (
        <RNView style={[styles.similarImagePlaceholder, { backgroundColor: colors.tint + '15' }]}>
          <Ionicons name="restaurant-outline" size={32} color={colors.tint} />
        </RNView>
      ) : (
        <Image 
          source={{ uri: item.thumbnail_url! }} 
          style={styles.similarImage}
          onError={() => setImageError(true)}
        />
      )}
      <RNView style={styles.similarCardContent}>
        <Text 
          style={[styles.similarCardTitle, { color: colors.text }]} 
          numberOfLines={2}
        >
          {item.title}
        </Text>
        {item.total_time && (
          <Text style={[styles.similarCardMeta, { color: colors.textMuted }]}>
            {item.total_time}
          </Text>
        )}
      </RNView>
    </TouchableOpacity>
  );
}

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { scaleFontSize } = useTextSize();
  const [activeTab, setActiveTab] = useState<TabType>('ingredients');
  
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
  const [reportTarget, setReportTarget] = useState<SafetyTargetType | null>(null);
  const [showRecipeAppeal, setShowRecipeAppeal] = useState(false);
  const [androidMenuActions, setAndroidMenuActions] = useState<RecipeMenuAction[] | null>(null);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [showIngredientsRef, setShowIngredientsRef] = useState(false); // Collapsed by default
  const [noteText, setNoteText] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const notesInputRef = useRef<TextInput>(null);
  const [notesSectionY, setNotesSectionY] = useState(0);
  const { userId } = useAuth();
  const { user } = useUser();
  const reportMutation = useCreateSafetyReport();
  const appealMutation = useCreateSafetyAppeal();
  const blockMutation = useBlockContributor();
  const { requestPublishing } = usePublishingDisclosure();
  
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

  // Reverse links for the current user's private collection relationships.
  const {
    data: collections,
    isLoading: isCollectionsLoading,
  } = useCollections(!!userId);
  const {
    data: recipeCollectionIds,
    isLoading: isRecipeCollectionsLoading,
  } = useRecipeCollections(id, !!userId);
  const recipeCollections = useMemo(
    () => collectionsContainingRecipe(collections, recipeCollectionIds),
    [collections, recipeCollectionIds],
  );
  const {
    data: recipePlanEntries = [],
    isLoading: isRecipePlanLoading,
  } = useRecipeMealPlanEntries(id, !!userId);
  
  // Similar recipes
  const { data: similarRecipes, isLoading: isSimilarLoading } = useSimilarRecipes(id, !!recipe);
  
  // Scaled servings hook - must be called before any early returns
  // Uses default of 1 when recipe isn't loaded yet
  const originalServings = recipe?.extracted?.servings || 1;
  const {
    scaledServings,
    setScaledServings,
    resetServings,
    currentServings,
    scaleFactor,
    isScaled,
  } = useScaledServings(id, originalServings);
  
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
  const contributorId = recipe?.contributor_id ?? null;
  const contributorName = recipe?.extractor_display_name || 'this contributor';
  
  const hasExternalSource = /^https?:\/\//i.test(recipe?.source_url || '');
  // Re-extraction requires a fetchable source URL; manual and photo recipes
  // intentionally keep their internal source markers out of user actions.
  const canReExtract = hasExternalSource;

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

  // Check if there's actual nutrition data (not just empty objects)
  const hasNutritionData = recipe?.extracted.nutrition?.perServing && (
    recipe.extracted.nutrition.perServing.calories ||
    recipe.extracted.nutrition.perServing.protein ||
    recipe.extracted.nutrition.perServing.carbs ||
    recipe.extracted.nutrition.perServing.fat
  );
  const nutritionStatus = recipe?.extracted.derivedData?.nutrition?.status;
  const costStatus = recipe?.extracted.derivedData?.cost?.status;

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

  const requireSafetySignIn = (onSignedIn: () => void) => {
    if (userId) {
      onSignedIn();
      return;
    }
    Alert.alert(
      'Sign in required',
      'Sign in to report content or manage blocked contributors.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign In', onPress: () => router.push('/(auth)/sign-in') },
      ],
    );
  };

  const handleBlockContributor = () => {
    if (!contributorId) return;
    requireSafetySignIn(() => {
      Alert.alert(
        `Block ${contributorName}?`,
        'Their public recipes will disappear from Discover, search, saved lists, and recommendations. You can unblock them in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Block',
            style: 'destructive',
            onPress: async () => {
              try {
                await blockMutation.mutateAsync(contributorId);
                router.back();
                Alert.alert('Contributor blocked', 'You will no longer see their public recipes.');
              } catch (error) {
                Alert.alert('Couldn’t block contributor', getSafetyErrorMessage(error));
              }
            },
          },
        ],
      );
    });
  };

  const handleMoreOptions = () => {
    if (!recipe) return;
    const canShowReExtract = canReExtract && (isOwner || isAdmin);
    const actions: RecipeMenuAction[] = isOwner
      ? [
          { label: 'Add to Collection', onPress: () => setShowCollectionModal(true) },
          { label: 'Edit Recipe', onPress: () => router.push(`/edit-recipe/${id}`) },
          { label: 'Version History', onPress: () => setShowVersionHistory(true) },
          ...(canReExtract ? [{ label: 'Re-extract with AI', onPress: handleReExtract }] : []),
          ...(recipe.moderation_status === 'hidden'
            ? [{ label: 'Appeal Moderation Hold', onPress: () => setShowRecipeAppeal(true) }]
            : []),
          { label: 'Delete Recipe', onPress: handleDelete, destructive: true },
        ]
      : [
          { label: isSaved ? 'Remove from Saved' : 'Save to My Recipes', onPress: handleSaveToggle },
          { label: 'Add to Collection', onPress: () => setShowCollectionModal(true) },
          ...(canShowReExtract ? [{ label: 'Re-extract with AI', onPress: handleReExtract }] : []),
          ...(recipe.is_public
            ? [{
                label: 'Report Recipe',
                onPress: () => requireSafetySignIn(() => setReportTarget('recipe')),
              }]
            : []),
          ...(recipe.is_public && contributorId
            ? [
                {
                  label: 'Report Contributor',
                  onPress: () => requireSafetySignIn(() => setReportTarget('contributor')),
                },
                { label: `Block ${contributorName}`, onPress: handleBlockContributor, destructive: true },
              ]
            : []),
        ];

    if (Platform.OS === 'ios') {
      const destructiveIndex = actions.findIndex((action) => action.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', ...actions.map((action) => action.label)],
          cancelButtonIndex: 0,
          destructiveButtonIndex: destructiveIndex >= 0 ? destructiveIndex + 1 : undefined,
        },
        (buttonIndex) => {
          if (buttonIndex > 0) actions[buttonIndex - 1]?.onPress();
        },
      );
      return;
    }

    setAndroidMenuActions(actions);
  };

  const formatRecipeAsText = () => {
    if (!recipe) return '';
    const { extracted } = recipe;
    
    let text = `${extracted.title}\n`;
    text += '━'.repeat(30) + '\n\n';
    
    // Meta info
    const metaParts: string[] = [];
    if (extracted.servings) metaParts.push(`${extracted.servings} servings`);
    if (extracted.times?.total) metaParts.push(`${extracted.times.total}`);
    if (extracted.totalEstimatedCost) metaParts.push(`$${extracted.totalEstimatedCost.toFixed(2)}`);
    if (metaParts.length > 0) {
      text += metaParts.join('  •  ') + '\n\n';
    }
    
    // Tags
    if (extracted.tags.length > 0) {
      text += `Tags: ${extracted.tags.join(', ')}\n\n`;
    }
    
    // Ingredients
    text += 'INGREDIENTS\n';
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
    text += 'INSTRUCTIONS\n';
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
        text += '\nNUTRITION (per serving)\n';
        text += '─'.repeat(20) + '\n';
        text += nutritionParts.join(' | ') + '\n';
      }
    }
    
    // Equipment
    if (extracted.equipment && extracted.equipment.length > 0) {
      text += '\nEQUIPMENT\n';
      text += '─'.repeat(20) + '\n';
      text += extracted.equipment.join(', ') + '\n';
    }
    
    // Source
    text += '\n' + '━'.repeat(30) + '\n';
    if (hasExternalSource) {
      text += `Source: ${recipe.source_url}\n`;
    }
    text += `${hasExternalSource ? 'Extracted' : 'Created'} with Håfa Recipes`;
    
    return text;
  };

  const handleShare = async () => {
    if (!recipe) return;

    if (!hasExternalSource) {
      try {
        await Share.share({ message: formatRecipeAsText() });
      } catch {
        // Share cancelled by user - not an error
      }
      return;
    }
    
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
    const updateSharing = async () => {
      try {
        await toggleSharingMutation.mutateAsync({ id, isPublic: !recipe.is_public });
      } catch {
        Alert.alert('Error', 'Failed to update sharing settings');
      }
    };

    if (recipe.is_public) {
      Alert.alert(
        'Review public recipe',
        `${formatPublishDisclosure(getPublishDisclosure(recipe))}\n\nMaking it private means people who saved it will no longer be able to open it.`,
        [
          { text: 'Keep shared', style: 'cancel' },
          { text: 'Make private', style: 'destructive', onPress: updateSharing },
        ],
      );
      return;
    }

    if (await requestPublishing(formatPublishDisclosure(getPublishDisclosure(recipe)))) {
      await updateSharing();
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
        <Ionicons
          name="alert-circle-outline"
          size={52}
          color={colors.textMuted}
          style={styles.errorIcon}
        />
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
  
  const { icon: sourceIcon, label: sourceLabel } = getRecipeSourcePresentation(recipe.source_type);

  const tabs: { key: TabType; label: string }[] = [
    { key: 'ingredients', label: 'Ingredients' },
    { key: 'steps', label: 'Steps' },
    { key: 'nutrition', label: 'Nutrition' },
    ...(extracted.totalEstimatedCost ? [{ key: 'cost' as TabType, label: 'Cost' }] : []),
  ];

  // Recipe scaling logic - now using the shared scaleQuantity utility from useScaledServings
  // scaleFactor, currentServings, isScaled are provided by useScaledServings hook above

  return (
    <>
      <Stack.Screen 
        options={{ 
          headerTitle: 'Recipe',
          headerRight: () => (
            <RNView style={styles.headerButtons}>
              <TouchableOpacity
                onPress={() => setShowChatModal(true)}
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel="Ask about this recipe"
              >
                <Ionicons name="chatbubbles-outline" size={22} color={colors.tint} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleShare}
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel="Share recipe"
              >
                <Ionicons name="share-outline" size={22} color={colors.tint} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleMoreOptions}
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel="More recipe options"
              >
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

            {isOwner && recipe.moderation_status === 'hidden' && (
              <RNView style={[styles.moderationNotice, { backgroundColor: `${colors.warning}20`, borderColor: colors.warning }]}>
                <Ionicons name="alert-circle-outline" size={22} color={colors.warning} />
                <RNView style={styles.moderationNoticeCopy}>
                  <Text style={[styles.moderationNoticeTitle, { color: colors.text }]}>Hidden from public view</Text>
                  <Text style={[styles.moderationNoticeText, { color: colors.textSecondary }]}>
                    You can still use this recipe while the moderation hold is active.
                  </Text>
                </RNView>
                <TouchableOpacity onPress={() => setShowRecipeAppeal(true)} accessibilityRole="button">
                  <Text style={[styles.moderationAppealText, { color: colors.tint }]}>Appeal</Text>
                </TouchableOpacity>
              </RNView>
            )}
            
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
                    <Ionicons name="people-outline" size={18} color={colors.tint} />
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
                      onPress={resetServings}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="refresh" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </RNView>
              )}
              {extracted.times?.total && (
                <RNView style={[styles.metaItem, { backgroundColor: colors.backgroundSecondary }]}>
                  <Ionicons name="time-outline" size={18} color={colors.tint} />
                  <Text style={[styles.metaValue, { color: colors.text }]}>
                    {extracted.times.total}
                  </Text>
                </RNView>
              )}
              {extracted.totalEstimatedCost && (
                <RNView style={[styles.metaItem, { backgroundColor: colors.backgroundSecondary }]}>
                  <Ionicons name="cash-outline" size={18} color={colors.tint} />
                  <Text style={[styles.metaValue, { color: colors.text }]}>
                    ${extracted.totalEstimatedCost.toFixed(2)}
                  </Text>
                </RNView>
              )}
            </RNView>

            {/* Quality Badge - show warning if low confidence, otherwise show quality */}
            {extracted.lowConfidence ? (
              <RNView style={[styles.qualityBadge, { backgroundColor: '#fef3c7' }]}>
                <Text style={[styles.qualityText, { color: '#92400e' }]}>
                  Needs review · Some details may be inaccurate
                </Text>
              </RNView>
            ) : recipe.has_audio_transcript && (
              <RNView style={[styles.qualityBadge, { backgroundColor: colors.success + '15' }]}>
                <Text style={[styles.qualityText, { color: colors.success }]}>
                  High quality · Audio transcribed
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

            {userId && (
              <RecipeCollectionsCard
                collections={recipeCollections}
                isLoading={isCollectionsLoading || isRecipeCollectionsLoading}
                onOpenCollection={(collectionId) => router.push(appRoutes.collection(collectionId))}
                onManageCollections={() => setShowCollectionModal(true)}
              />
            )}

            {userId && (
              <RecipeMealPlanCard
                entries={recipePlanEntries}
                isLoading={isRecipePlanLoading}
                onOpenDate={(date) => router.push(appRoutes.plannerDate(date))}
                onOpenPlanner={() => router.push(appRoutes.planner)}
              />
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
            {hasExternalSource && (
              <TouchableOpacity
                style={[styles.sourceButton, { borderColor: colors.border }]}
                onPress={handleOpenSource}
                activeOpacity={0.7}
                accessibilityRole="link"
                accessibilityLabel={`View recipe on ${sourceLabel}`}
              >
                <Ionicons name={sourceIcon as any} size={20} color={colors.textSecondary} />
                <Text style={[styles.sourceButtonText, { color: colors.text }]}>
                  View on {sourceLabel}
                </Text>
                <Ionicons name="open-outline" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}

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
                        const scaledQty = scaleQuantity(originalQty, scaleFactor);
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
                              <Text style={[styles.ingredientText, { color: colors.text, fontSize: scaleFontSize(fontSize.md), lineHeight: scaleFontSize(22) }]}>
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
                  {/* Quick Reference: Ingredients */}
                  <TouchableOpacity
                    style={[styles.ingredientsRefHeader, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
                    onPress={() => setShowIngredientsRef(!showIngredientsRef)}
                    activeOpacity={0.7}
                  >
                    <RNView style={styles.ingredientsRefTitleRow}>
                      <Ionicons name="list-outline" size={18} color={colors.tint} />
                      <Text style={[styles.ingredientsRefTitle, { color: colors.text }]}>
                        Quick Reference: Ingredients
                      </Text>
                      {isScaled && (
                        <RNView style={[styles.scaledBadge, { backgroundColor: colors.tint + '20' }]}>
                          <Text style={[styles.scaledBadgeText, { color: colors.tint }]}>
                            {currentServings} servings
                          </Text>
                        </RNView>
                      )}
                    </RNView>
                    <Ionicons 
                      name={showIngredientsRef ? 'chevron-up' : 'chevron-down'} 
                      size={20} 
                      color={colors.textMuted} 
                    />
                  </TouchableOpacity>
                  
                  {showIngredientsRef && (
                    <RNView style={[styles.ingredientsRefContent, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
                      {extracted.components.map((component, compIndex) => (
                        <RNView key={compIndex}>
                          {extracted.components.length > 1 && (
                            <Text style={[styles.ingredientsRefCompTitle, { color: colors.tint }]}>
                              {component.name}
                            </Text>
                          )}
                          {component.ingredients.map((ing, ingIndex) => {
                            const scaledQty = scaleQuantity(ing.quantity ?? null, scaleFactor);
                            const unit = ing.unit && ing.unit !== 'null' ? ing.unit : '';
                            return (
                              <RNView key={ingIndex} style={styles.ingredientsRefItem}>
                                <Text style={[styles.ingredientsRefQty, isScaled && { color: colors.tint }]}>
                                  {scaledQty || '•'}{unit ? ` ${unit}` : ''}
                                </Text>
                                <Text style={[styles.ingredientsRefName, { color: colors.text }]}>
                                  {ing.name}
                                </Text>
                              </RNView>
                            );
                          })}
                        </RNView>
                      ))}
                    </RNView>
                  )}

                  {/* Steps */}
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
                          <Text style={[styles.stepText, { color: colors.text, fontSize: scaleFontSize(fontSize.md), lineHeight: scaleFontSize(24) }]}>
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
                  {hasNutritionData && nutritionStatus && nutritionStatus !== 'current' && (
                    <RNView style={[
                      styles.estimateNotice,
                      {
                        backgroundColor: nutritionStatus === 'stale' ? colors.warning + '14' : colors.backgroundSecondary,
                        borderColor: nutritionStatus === 'stale' ? colors.warning : colors.border,
                      },
                    ]}>
                      <Ionicons
                        name={nutritionStatus === 'stale' ? 'alert-circle-outline' : 'information-circle-outline'}
                        size={20}
                        color={nutritionStatus === 'stale' ? colors.warning : colors.textMuted}
                      />
                      <RNView style={styles.estimateNoticeCopy}>
                        <Text style={[styles.estimateNoticeTitle, { color: colors.text }]}>Estimated nutrition</Text>
                        <Text style={[styles.estimateNoticeText, { color: colors.textSecondary }]}>
                          {nutritionStatus === 'stale'
                            ? 'Ingredients or servings changed. Recalculate in Edit Recipe before relying on these values.'
                            : 'This estimate predates freshness tracking. Recalculate it in Edit Recipe when accuracy matters.'}
                        </Text>
                      </RNView>
                    </RNView>
                  )}
                  {/* Empty state for no nutrition data */}
                  {!hasNutritionData && (
                    <RNView style={styles.emptyNutritionState}>
                      <Ionicons name="nutrition-outline" size={40} color={colors.textMuted} />
                      <Text style={[styles.emptyNutritionTitle, { color: colors.text }]}>
                        No Nutrition Data
                      </Text>
                      <Text style={[styles.emptyNutritionText, { color: colors.textMuted }]}>
                        Nutrition information wasn't available for this recipe.
                      </Text>
                    </RNView>
                  )}

                  {/* Full Recipe Total - Show scaled total (like cost tab) */}
                  {hasNutritionData && extracted.nutrition?.perServing && (
                    <RNView style={styles.nutritionTotalCard}>
                      <RNView style={[styles.nutritionTotalBox, { backgroundColor: colors.tint }]}>
                        <Text style={styles.nutritionTotalLabel}>
                          Estimated full recipe {isScaled ? `(${currentServings} servings)` : `(${originalServings} servings)`}
                        </Text>
                        <Text style={styles.nutritionTotalValue}>
                          {Math.round((extracted.nutrition.perServing.calories || 0) * currentServings)} cal
                        </Text>
                        {isScaled && (
                          <Text style={styles.nutritionScaledNote}>
                            scaled from {originalServings} servings
                          </Text>
                        )}
                      </RNView>
                      
                      <RNView style={styles.nutritionTotalMetaRow}>
                        {extracted.nutrition.perServing.protein && (
                          <RNView style={[styles.nutritionTotalMetaItem, { backgroundColor: colors.backgroundSecondary }]}>
                            <Text style={[styles.nutritionTotalMetaValue, { color: colors.text }]}>
                              {Math.round((extracted.nutrition.perServing.protein || 0) * currentServings)}g
                            </Text>
                            <Text style={[styles.nutritionTotalMetaLabel, { color: colors.textMuted }]}>
                              Protein
                            </Text>
                          </RNView>
                        )}
                        {extracted.nutrition.perServing.carbs && (
                          <RNView style={[styles.nutritionTotalMetaItem, { backgroundColor: colors.backgroundSecondary }]}>
                            <Text style={[styles.nutritionTotalMetaValue, { color: colors.text }]}>
                              {Math.round((extracted.nutrition.perServing.carbs || 0) * currentServings)}g
                            </Text>
                            <Text style={[styles.nutritionTotalMetaLabel, { color: colors.textMuted }]}>
                              Carbs
                            </Text>
                          </RNView>
                        )}
                        {extracted.nutrition.perServing.fat && (
                          <RNView style={[styles.nutritionTotalMetaItem, { backgroundColor: colors.backgroundSecondary }]}>
                            <Text style={[styles.nutritionTotalMetaValue, { color: colors.text }]}>
                              {Math.round((extracted.nutrition.perServing.fat || 0) * currentServings)}g
                            </Text>
                            <Text style={[styles.nutritionTotalMetaLabel, { color: colors.textMuted }]}>
                              Fat
                            </Text>
                          </RNView>
                        )}
                      </RNView>
                    </RNView>
                  )}

                  {/* Per Serving */}
                  {hasNutritionData && extracted.nutrition?.perServing && (
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
                            <Ionicons name="construct-outline" size={15} color={colors.textMuted} />
                            <Text style={[styles.equipmentText, { color: colors.text }]}>
                              {item}
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
                  {costStatus && costStatus !== 'current' && (
                    <RNView style={[
                      styles.estimateNotice,
                      {
                        backgroundColor: costStatus === 'stale' ? colors.warning + '14' : colors.backgroundSecondary,
                        borderColor: costStatus === 'stale' ? colors.warning : colors.border,
                      },
                    ]}>
                      <Ionicons name="pricetag-outline" size={20} color={costStatus === 'stale' ? colors.warning : colors.textMuted} />
                      <RNView style={styles.estimateNoticeCopy}>
                        <Text style={[styles.estimateNoticeTitle, { color: colors.text }]}>Estimated cost</Text>
                        <Text style={[styles.estimateNoticeText, { color: colors.textSecondary }]}>
                          {costStatus === 'stale'
                            ? 'Ingredients or servings changed, so this earlier cost estimate may no longer match.'
                            : 'Prices vary by store and this older estimate has not been freshness-verified.'}
                        </Text>
                      </RNView>
                    </RNView>
                  )}
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
                        <RNView style={styles.costMetaValueRow}>
                          <Ionicons name="location-outline" size={16} color={colors.text} />
                          <Text style={[styles.costMetaValue, { color: colors.text, marginBottom: 0 }]}>
                            {extracted.costLocation}
                          </Text>
                        </RNView>
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
                            const scaledQty = scaleQuantity(originalQty, scaleFactor);
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
          
          {/* Similar Recipes Section */}
          {(isSimilarLoading || (similarRecipes && similarRecipes.length > 0)) && (
            <RNView style={styles.similarSection}>
              <Text style={[styles.similarTitle, { color: colors.text }]}>
                You May Also Like
              </Text>
              {isSimilarLoading ? (
                <SkeletonSimilarRecipes count={3} />
              ) : (
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.similarScroll}
              >
                {similarRecipes?.map((item: RecipeListItem) => (
                  <SimilarRecipeCard
                    key={item.id}
                    item={item}
                    onPress={() => router.push(`/recipe/${item.id}`)}
                    colors={colors}
                  />
                ))}
        </ScrollView>
              )}
            </RNView>
          )}
        </ScrollView>
        
        {/* Floating Start Cooking Button */}
        <RNView style={[
          styles.floatingButtonContainer,
          { 
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + spacing.sm,
          }
        ]}>
          <TouchableOpacity
            style={[styles.floatingCookButton, { backgroundColor: colors.tint }]}
            onPress={() => router.push({
              pathname: `/cook-mode/${id}` as any,
              params: isScaled ? { scaleFactor: scaleFactor.toString(), servings: currentServings.toString() } : {},
            })}
            activeOpacity={0.8}
          >
            <Ionicons name="restaurant" size={22} color="#FFFFFF" />
            <Text style={styles.floatingCookButtonText}>Start Cooking</Text>
          </TouchableOpacity>
        </RNView>
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
          scaleFactor={scaleFactor}
          currentServings={currentServings}
          originalServings={originalServings}
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

      {recipe && reportTarget && (
        <SafetyActionModal
          visible
          mode="report"
          targetType={reportTarget}
          targetLabel={reportTarget === 'recipe' ? recipe.extracted.title : contributorName}
          isSubmitting={reportMutation.isPending}
          onClose={() => setReportTarget(null)}
          onSubmit={async ({ category, details }) => {
            if (!category) return;
            try {
              await reportMutation.mutateAsync({
                target_type: reportTarget,
                category: category as ReportCategory,
                details: details || undefined,
                ...(reportTarget === 'recipe'
                  ? { recipe_id: recipe.id }
                  : { contributor_id: contributorId || undefined }),
              });
              setReportTarget(null);
              Alert.alert('Report submitted', 'Thank you. You can track its status in Settings → Safety Center.');
            } catch (error) {
              Alert.alert('Couldn’t submit report', getSafetyErrorMessage(error));
            }
          }}
        />
      )}

      {recipe && (
        <SafetyActionModal
          visible={showRecipeAppeal}
          mode="appeal"
          targetType="recipe"
          targetLabel={recipe.extracted.title}
          isSubmitting={appealMutation.isPending}
          onClose={() => setShowRecipeAppeal(false)}
          onSubmit={async ({ details }) => {
            try {
              await appealMutation.mutateAsync({
                target_type: 'recipe',
                recipe_id: recipe.id,
                details,
              });
              setShowRecipeAppeal(false);
              Alert.alert('Appeal submitted', 'You can track its status in Settings → Safety Center.');
            } catch (error) {
              Alert.alert('Couldn’t submit appeal', getSafetyErrorMessage(error));
            }
          }}
        />
      )}

      <Modal
        visible={androidMenuActions !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAndroidMenuActions(null)}
      >
        <Pressable
          style={styles.optionsBackdrop}
          onPress={() => setAndroidMenuActions(null)}
          accessibilityRole="button"
          accessibilityLabel="Close recipe options"
        >
          <Pressable
            style={[
              styles.optionsSheet,
              {
                backgroundColor: colors.background,
                paddingBottom: Math.max(insets.bottom, spacing.md),
              },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            <RNView style={styles.optionsHandle} />
            <Text style={[styles.optionsTitle, { color: colors.text }]}>Recipe options</Text>
            {androidMenuActions?.map((action) => (
              <TouchableOpacity
                key={action.label}
                style={[styles.optionsAction, { borderTopColor: colors.border }]}
                accessibilityRole="button"
                onPress={() => {
                  setAndroidMenuActions(null);
                  setTimeout(action.onPress, 150);
                }}
              >
                <Text
                  style={[
                    styles.optionsActionText,
                    { color: action.destructive ? colors.error : colors.text },
                  ]}
                >
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.optionsCancel, { backgroundColor: colors.backgroundSecondary }]}
              accessibilityRole="button"
              onPress={() => setAndroidMenuActions(null)}
            >
              <Text style={[styles.optionsCancelText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100, // Extra padding for floating button
  },
  moderationNotice: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  moderationNoticeCopy: { flex: 1, gap: 2 },
  moderationNoticeTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  moderationNoticeText: { fontSize: fontSize.xs, lineHeight: 17 },
  moderationAppealText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  optionsBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  optionsSheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    ...shadows.strong,
  },
  optionsHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(148, 163, 184, 0.55)',
    marginBottom: spacing.md,
  },
  optionsTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.sm,
  },
  optionsAction: {
    minHeight: 52,
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  optionsActionText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  optionsCancel: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  optionsCancelText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
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
  errorIcon: {
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
    height: 300,
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
    fontSize: fontSize.xxxl,
    fontFamily: fontFamily.display,
    lineHeight: 42,
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
    borderRadius: radius.full,
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
    borderRadius: radius.full,
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
    padding: spacing.lg,
    borderRadius: radius.xl,
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
    fontFamily: fontFamily.bold,
  },
  startCookingSubtext: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  // Floating button styles
  floatingButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    ...shadows.medium,
  },
  floatingCookButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  floatingCookButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.lg,
    fontFamily: fontFamily.semibold,
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
  ingredientsRefHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  ingredientsRefTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  ingredientsRefTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  scaledBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginLeft: spacing.sm,
  },
  scaledBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  ingredientsRefContent: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  ingredientsRefCompTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  ingredientsRefItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  ingredientsRefQty: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    width: 80,
  },
  ingredientsRefName: {
    fontSize: fontSize.sm,
    flex: 1,
  },
  nutritionSection: {
    marginBottom: spacing.xl,
  },
  estimateNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  estimateNoticeCopy: {
    flex: 1,
  },
  estimateNoticeTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginBottom: 2,
  },
  estimateNoticeText: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  emptyNutritionState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyNutritionIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyNutritionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.sm,
  },
  emptyNutritionText: {
    fontSize: fontSize.md,
    textAlign: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
  // Nutrition total card styles (similar to cost card)
  nutritionTotalCard: {
    marginBottom: spacing.xl,
  },
  nutritionTotalBox: {
    padding: spacing.xl,
    borderRadius: radius.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  nutritionTotalLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
  },
  nutritionTotalValue: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: fontWeight.bold,
  },
  nutritionScaledNote: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  nutritionTotalMetaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  nutritionTotalMetaItem: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  nutritionTotalMetaValue: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  nutritionTotalMetaLabel: {
    fontSize: fontSize.sm,
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
  costMetaValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
  // Similar Recipes Section
  similarSection: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  similarTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.md,
  },
  similarScroll: {
    paddingRight: spacing.md,
    gap: spacing.sm,
  },
  similarCard: {
    width: 160,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  similarImage: {
    width: '100%',
    height: 100,
    resizeMode: 'cover',
  },
  similarImagePlaceholder: {
    width: '100%',
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  similarCardContent: {
    padding: spacing.sm,
  },
  similarCardTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    lineHeight: fontSize.sm * 1.3,
  },
  similarCardMeta: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
});
