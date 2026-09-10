/**
 * Capture Review Screen
 * 
 * Shows a recipe extracted from images or pasted text before it is saved.
 */

import { useState, useEffect, useRef } from 'react';
import { randomUUID } from 'expo-crypto';
import {
  StyleSheet,
  ScrollView,
  View as RNView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Button, useColors } from '@/components/Themed';
import {
  RecipeVisibilitySelector,
  type RecipeVisibility,
} from '@/components/RecipeVisibilitySelector';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { useSaveCapturedRecipe } from '@/hooks/useRecipes';
import { usePublishingDisclosure } from '@/hooks/usePublishingDisclosure';
import { formatPublishDisclosure } from '@/lib/recipePublishing';
import { getOcrPublishDisclosure } from '@/lib/ocrReview';
import { captureSaveFailure } from '@/lib/captureSave';

export default function OCRReviewScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    recipe: recipeParam,
    location,
    isPublic: isPublicParam,
    sourceType: sourceTypeParam,
    saveFailed,
    captureId: captureIdParam,
    saveErrorKind,
    saveErrorMessage,
  } = useLocalSearchParams<{
    recipe: string;
    location: string;
    isPublic?: string;
    sourceType?: 'photo' | 'text';
    saveFailed?: string;
    captureId?: string;
    saveErrorKind?: string;
    saveErrorMessage?: string;
  }>();
  const sourceType = sourceTypeParam === 'text' ? 'text' : 'photo';
  const isTextCapture = sourceType === 'text';

  const saveInFlight = useRef(false);
  const [recipe, setRecipe] = useState<any>(null);
  const [isPublic, setIsPublic] = useState(isPublicParam !== 'false');
  const [isSaving, setIsSaving] = useState(false);
  const [captureId, setCaptureId] = useState(() => captureIdParam ?? randomUUID());
  const [failure, setFailure] = useState<{ kind: string; message: string } | null>(null);
  const attemptedSave = useRef(saveFailed === 'true');
  const canEdit = !attemptedSave.current || failure?.kind === 'invalid';
  const canRetry = failure?.kind !== 'invalid' && failure?.kind !== 'conflict';
  
  const saveCapturedRecipe = useSaveCapturedRecipe();
  const { requestPublishing, isCheckingDisclosure } = usePublishingDisclosure();

  const publishPreview = () => formatPublishDisclosure(getOcrPublishDisclosure(recipe || {}));

  const handleVisibilityChange = async (visibility: RecipeVisibility) => {
    if (!canEdit || saveInFlight.current) return;
    if (visibility === 'private') {
      setIsPublic(false);
      return;
    }
    if (isPublic) return;
    if (!recipe) return;
    if (await requestPublishing(publishPreview())) setIsPublic(true);
  };

  useEffect(() => {
    if (recipeParam) {
      try {
        const parsed = JSON.parse(recipeParam);
        setRecipe(parsed);
        setIsPublic(isPublicParam !== 'false');
        setCaptureId(captureIdParam ?? randomUUID());
        attemptedSave.current = saveFailed === 'true';
        setFailure(saveFailed === 'true' ? {
          kind: saveErrorKind ?? 'retry',
          message: saveErrorMessage ?? 'Your extracted recipe is still here. Retry saving without importing it again.',
        } : null);
      } catch {
        // User-facing alert is sufficient
        Alert.alert('Error', 'Failed to load recipe data');
        router.back();
      }
    }
  }, [captureIdParam, isPublicParam, recipeParam, router.back, saveErrorKind, saveErrorMessage, saveFailed]);

  const doSave = async () => {
    if (!recipe || !canRetry || saveInFlight.current || isCheckingDisclosure) return;
    saveInFlight.current = true;

    if (isPublic) {
      const allowed = await requestPublishing(publishPreview());
      if (!allowed) {
        saveInFlight.current = false;
        setIsPublic(false);
        return;
      }
    }

    setIsSaving(true);
    attemptedSave.current = true;
    try {
      const result = await saveCapturedRecipe.mutateAsync({
        extracted: recipe,
        source_type: sourceType,
        is_public: isPublic,
        capture_id: captureId,
      });

      if (!result?.id) throw new Error('Save did not finish. Please retry.');
      router.replace(`/recipe/${result.id}`);
    } catch (error: unknown) {
      const nextFailure = captureSaveFailure(error);
      setFailure(nextFailure);
      Alert.alert('Save failed', nextFailure.message);
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
    }
  };
  
  const handleEdit = () => {
    if (!canEdit || saveInFlight.current) return;
    // Replace review with add-recipe screen, preserving the capture origin.
    // Using replace so user doesn't come back to this screen after saving
    router.replace({
      pathname: '/add-recipe',
      params: {
        initialData: JSON.stringify(recipe),
        isPublic: isPublic ? 'true' : 'false',
        captureSource: sourceType,
      },
    });
  };

  if (!recipe) {
    return (
      <RNView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen
          options={{
            title: 'Save Recipe',
            headerBackTitle: 'Back',
          }}
        />
        <RNView style={styles.loadingContainer}>
          <Text style={{ color: colors.textMuted }}>Loading...</Text>
        </RNView>
      </RNView>
    );
  }

  // Get all ingredients from components
  const allIngredients = recipe.components?.flatMap((c: any) => 
    c.ingredients?.map((i: any) => ({
      ...i,
      componentName: recipe.components.length > 1 ? c.name : null,
    })) || []
  ) || recipe.ingredients || [];

  // Get all steps from components
  const allSteps = recipe.components?.flatMap((c: any) =>
    c.steps?.map((s: string) => ({
      step: s,
      componentName: recipe.components.length > 1 ? c.name : null,
    })) || []
  ) || recipe.steps?.map((s: string) => ({ step: s, componentName: null })) || [];

  return (
    <RNView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: 'Save Recipe',
          headerBackTitle: 'Cancel',
        }}
      />
      
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 136 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Review Banner */}
        <RNView style={[styles.successBanner, { backgroundColor: colors.warning + '18' }]}>
          <Ionicons name="alert-circle-outline" size={24} color={colors.warning} />
          <Text style={[styles.successText, { color: colors.text }]}>
            {failure ? 'Recipe extracted. Save needs attention.' : 'Your recipe is ready to save'}
          </Text>
        </RNView>

        <RNView style={[styles.reviewNotice, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
          <Ionicons name="eye-outline" size={20} color={colors.tint} />
          <RNView style={styles.reviewNoticeText}>
            <Text style={[styles.reviewNoticeTitle, { color: colors.text }]}>{failure?.kind === 'invalid' ? 'Edit recipe details' : failure ? 'Saving your recipe' : 'Ready when you are'}</Text>
            <Text style={[styles.reviewNoticeBody, { color: colors.textMuted }]}>
              {failure
                ? failure.message
                : isTextCapture
                ? 'AI can misunderstand copied formatting or missing context. Håfa Recipes does not store the original pasted text with your saved recipe.'
                : 'AI can misread amounts, temperatures, or step order. Source screenshots are uploaded for extraction but are not attached to the saved recipe.'}
            </Text>
          </RNView>
        </RNView>

        {recipe.lowConfidence && recipe.confidenceWarning && (
          <RNView style={[styles.confidenceWarning, { borderColor: colors.warning, backgroundColor: colors.warning + '12' }]}>
            <Ionicons name="warning-outline" size={18} color={colors.warning} />
            <Text style={[styles.confidenceWarningText, { color: colors.text }]}>{recipe.confidenceWarning}</Text>
          </RNView>
        )}

        {/* Title */}
        <RNView style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Title</Text>
          <Text style={[styles.title, { color: colors.text }]}>{recipe.title || 'Untitled Recipe'}</Text>
        </RNView>

        {/* Quick Info */}
        <RNView style={styles.quickInfo}>
          {recipe.servings && (
            <RNView style={[styles.quickInfoItem, { backgroundColor: colors.backgroundSecondary }]}>
              <Ionicons name="people" size={16} color={colors.tint} />
              <Text style={[styles.quickInfoText, { color: colors.text }]}>
                {recipe.servings} servings
              </Text>
            </RNView>
          )}
          {recipe.times?.total && (
            <RNView style={[styles.quickInfoItem, { backgroundColor: colors.backgroundSecondary }]}>
              <Ionicons name="time" size={16} color={colors.tint} />
              <Text style={[styles.quickInfoText, { color: colors.text }]}>
                {recipe.times.total}
              </Text>
            </RNView>
          )}
          {recipe.totalEstimatedCost && (
            <RNView style={[styles.quickInfoItem, { backgroundColor: colors.backgroundSecondary }]}>
              <Ionicons name="cash" size={16} color={colors.tint} />
              <Text style={[styles.quickInfoText, { color: colors.text }]}>
                ~${recipe.totalEstimatedCost.toFixed(2)}
              </Text>
            </RNView>
          )}
        </RNView>

        {/* Ingredients */}
        <RNView style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Ingredients ({allIngredients.length})
          </Text>
          {allIngredients.map((ing: any, idx: number) => (
            <RNView key={idx} style={styles.ingredientRow}>
              <Text style={[styles.bullet, { color: colors.tint }]}>•</Text>
              <Text style={[styles.ingredientText, { color: colors.text }]}>
                {ing.quantity && `${ing.quantity} `}
                {ing.unit && `${ing.unit} `}
                {ing.name}
                {ing.notes && ` (${ing.notes})`}
              </Text>
            </RNView>
          ))}
        </RNView>

        {/* Steps */}
        <RNView style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Instructions ({allSteps.length} steps)
          </Text>
          {allSteps.map((item: any, idx: number) => (
            <RNView key={idx} style={styles.stepRow}>
              <RNView style={[styles.stepNumber, { backgroundColor: colors.tint }]}>
                <Text style={styles.stepNumberText}>{idx + 1}</Text>
              </RNView>
              <Text style={[styles.stepText, { color: colors.text }]}>
                {item.step}
              </Text>
            </RNView>
          ))}
        </RNView>

        {/* Notes */}
        {recipe.notes && (
          <RNView style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Notes</Text>
            <Text style={[styles.notesText, { color: colors.textSecondary }]}>
              {recipe.notes}
            </Text>
          </RNView>
        )}

        <RecipeVisibilitySelector
          value={isPublic ? 'public' : 'private'}
          onChange={handleVisibilityChange}
          disabled={isSaving || isCheckingDisclosure || !canEdit}
        />

        {/* Hint */}
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          {canEdit ? 'Tip: tap "Edit" to make changes before saving' : 'Retry saving first. You can change details and visibility on the saved recipe.'}
        </Text>
      </ScrollView>

      {/* Bottom Action Bar */}
      <RNView
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, spacing.lg),
          },
        ]}
      >
        <RNView style={styles.bottomBarButtons}>
          {failure?.kind === 'conflict' && <Button title="Open My Recipes" onPress={() => router.replace('/(tabs)/history')} />}
          {/* Edit Button */}
          {canEdit && <TouchableOpacity
            style={[styles.editButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
            onPress={handleEdit}
            disabled={isSaving || isCheckingDisclosure}
          >
            <Ionicons name="create-outline" size={20} color={colors.text} />
            <Text style={[styles.editButtonText, { color: colors.text }]}>Edit</Text>
          </TouchableOpacity>}
          
          {/* Save Button */}
          {canRetry && <RNView style={styles.saveButtonContainer}>
            <Button
              title={isSaving ? 'Saving...' : failure ? 'Retry Save' : isPublic ? 'Publish Recipe' : 'Save Private Recipe'}
              onPress={doSave}
              disabled={isSaving || isCheckingDisclosure}
              loading={isSaving}
              size="lg"
            />
          </RNView>}
        </RNView>
      </RNView>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: spacing.lg,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  successText: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  reviewNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  reviewNoticeText: {
    flex: 1,
    gap: 2,
  },
  reviewNoticeTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  reviewNoticeBody: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  confidenceWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  confidenceWarningText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  quickInfo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  quickInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  quickInfoText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  bullet: {
    fontSize: fontSize.lg,
    marginRight: spacing.sm,
    lineHeight: 22,
  },
  ingredientText: {
    flex: 1,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    marginTop: 2,
  },
  stepNumberText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  stepText: {
    flex: 1,
    fontSize: fontSize.md,
    lineHeight: 24,
  },
  notesText: {
    fontSize: fontSize.md,
    lineHeight: 22,
    fontStyle: 'italic',
  },
  hint: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    borderTopWidth: 1,
  },
  bottomBarButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
  },
  editButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  saveButtonContainer: {
    flex: 1,
  },
});
