/**
 * OCR Review Screen
 * 
 * Shows the recipe extracted from a scanned image and allows the user to review and save it.
 */

import { useState, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  View as RNView,
  Alert,
  Switch,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, Button, Input, useColors } from '@/components/Themed';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { useSaveOcrRecipe } from '@/hooks/useRecipes';

export default function OCRReviewScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { recipe: recipeParam, location, isPublic: isPublicParam } = useLocalSearchParams<{
    recipe: string;
    location: string;
    isPublic: string;
  }>();

  const [recipe, setRecipe] = useState<any>(null);
  const [isPublic, setIsPublic] = useState(isPublicParam === 'true');
  const [isSaving, setIsSaving] = useState(false);
  
  const saveOcrRecipe = useSaveOcrRecipe();

  useEffect(() => {
    if (recipeParam) {
      try {
        const parsed = JSON.parse(recipeParam);
        setRecipe(parsed);
      } catch {
        // User-facing alert is sufficient
        Alert.alert('Error', 'Failed to load recipe data');
        router.back();
      }
    }
  }, [recipeParam]);

  const handleSave = async () => {
    if (!recipe) return;

    setIsSaving(true);
    try {
      const result = await saveOcrRecipe.mutateAsync({
        extracted: recipe,
        is_public: isPublic,
      });

      if (result?.id) {
        Alert.alert(
          'Recipe Saved!',
          'Your scanned recipe has been saved.',
          [
            {
              text: 'View Recipe',
              onPress: () => {
                router.replace(`/recipe/${result.id}`);
              },
            },
          ]
        );
      }
    } catch (error: any) {
      // User-facing alert is sufficient
      Alert.alert(
        'Save Failed',
        error.message || 'Failed to save recipe. Please try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = () => {
    // Replace OCR review with add-recipe screen (pre-filled with OCR data)
    // Using replace so user doesn't come back to this screen after saving
    router.replace({
      pathname: '/add-recipe',
      params: {
        initialData: JSON.stringify(recipe),
        isPublic: isPublic ? 'true' : 'false',
        fromOcr: 'true', // Mark as originating from photo scan
      },
    });
  };

  if (!recipe) {
    return (
      <RNView style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen
          options={{
            title: 'Review Recipe',
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
          title: 'Review Recipe',
          headerBackTitle: 'Cancel',
        }}
      />
      
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Success Banner */}
        <RNView style={[styles.successBanner, { backgroundColor: colors.success + '20' }]}>
          <Ionicons name="checkmark-circle" size={24} color={colors.success} />
          <Text style={[styles.successText, { color: colors.success }]}>
            Recipe extracted successfully!
          </Text>
        </RNView>

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

        {/* Share Toggle */}
        <TouchableOpacity
          style={[
            styles.shareToggle,
            {
              backgroundColor: isPublic ? colors.tint + '15' : colors.backgroundSecondary,
              borderColor: isPublic ? colors.tint : colors.border,
            },
          ]}
          onPress={() => setIsPublic(!isPublic)}
          activeOpacity={0.7}
        >
          <RNView style={styles.shareToggleContent}>
            <Ionicons
              name={isPublic ? 'globe' : 'lock-closed'}
              size={20}
              color={isPublic ? colors.tint : colors.textMuted}
            />
            <RNView style={styles.shareToggleText}>
              <Text style={[styles.shareToggleTitle, { color: colors.text }]}>
                {isPublic ? 'Share to Library' : 'Keep Private'}
              </Text>
              <Text style={[styles.shareToggleSubtitle, { color: colors.textMuted }]}>
                {isPublic ? 'Others can discover this recipe' : 'Only visible to you'}
              </Text>
            </RNView>
          </RNView>
          <Switch
            value={isPublic}
            onValueChange={setIsPublic}
            trackColor={{ false: colors.border, true: colors.tint }}
            thumbColor="#FFFFFF"
          />
        </TouchableOpacity>

        {/* Hint */}
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          💡 Tap "Edit" to make changes before saving
        </Text>
      </ScrollView>

      {/* Bottom Action Bar */}
      <RNView style={[styles.bottomBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <RNView style={styles.bottomBarButtons}>
          {/* Edit Button */}
          <TouchableOpacity
            style={[styles.editButton, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
            onPress={handleEdit}
            disabled={isSaving}
          >
            <Ionicons name="create-outline" size={20} color={colors.text} />
            <Text style={[styles.editButtonText, { color: colors.text }]}>Edit</Text>
          </TouchableOpacity>
          
          {/* Save Button */}
          <RNView style={styles.saveButtonContainer}>
            <Button
              title={isSaving ? 'Saving...' : 'Save Recipe'}
              onPress={handleSave}
              disabled={isSaving}
              loading={isSaving}
              size="lg"
            />
          </RNView>
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
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
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
  shareToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  shareToggleContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
  },
  shareToggleText: {
    flex: 1,
  },
  shareToggleTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  shareToggleSubtitle: {
    fontSize: fontSize.xs,
    marginTop: 2,
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

