import { useImportInbox } from '@/hooks/useImportInbox';
import { CaptureAccountChangedError } from '@/lib/captureAccount';
import { NutritionPanel } from '@/components/NutritionPanel';
import { hasNutritionValues, normalizeNutritionValues } from '@/lib/nutritionPresentation';
import type { NutritionEstimateValues } from '@/lib/api';
/**
 * Add Recipe Screen
 * 
 * Allows users to manually create a recipe with optional image upload.
 */

import type { QuantityEstimate, Nutrition } from '@/types/recipe';
import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  View as RNView,
  ActivityIndicator,
} from 'react-native';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { View, Text, useColors } from '@/components/Themed';
import {
  RecipeVisibilitySelector,
  type RecipeVisibility,
} from '@/components/RecipeVisibilitySelector';
import { api } from '@/lib/api';
import { formatPublishDisclosure } from '@/lib/recipePublishing';
import { usePublishingDisclosure } from '@/hooks/usePublishingDisclosure';
import { invalidateCreatedRecipeQueries } from '@/hooks/useRecipes';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

interface IngredientInput {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  notes: string;
  quantityEstimate?: QuantityEstimate | null;
}

interface StepInput {
  id: string;
  text: string;
}

// Common unit options including "to taste" style options
const UNIT_OPTIONS = [
  '', // Empty for custom input
  'to taste',
  'pinch',
  'dash',
  'tsp',
  'tbsp',
  'cup',
  'oz',
  'lb',
  'g',
  'kg',
  'ml',
  'L',
  'piece',
  'slice',
  'clove',
  'can',
  'package',
];

function nutritionFingerprintFor(ingredients: Array<{ name: string; quantity: string; unit: string; notes: string }>, servings: string) {
  return JSON.stringify({ ingredients: ingredients.map(({ name, quantity, unit, notes }) => ({ name: name.trim(), quantity: quantity.trim(), unit: unit.trim(), notes: notes.trim() })), servings });
}

export default function AddRecipeScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { requestPublishing, isCheckingDisclosure } = usePublishingDisclosure();
  
  // Get initial data from route params for imported-recipe pre-fill.
  const {
    initialData,
    initialImageUri,
    isPublic: isPublicParam,
    fromOcr,
    captureSource,
    captureOwnerId,
  } = useLocalSearchParams<{
    initialData?: string;
    initialImageUri?: string;
    isPublic?: string;
    fromOcr?: string;
    captureSource?: 'photo' | 'text';
    captureOwnerId?: string;
  }>();
  
  const inbox = useImportInbox();
  const captureOwner = useRef({ ownerId: inbox.ownerId, mounted: true });
  captureOwner.current.ownerId = inbox.ownerId;
  useEffect(() => {
    captureOwner.current.mounted = true;
    return () => { captureOwner.current.mounted = false; };
  }, []);
  const savingOwner = useRef<string | null>(null);
  // `fromOcr` preserves navigation compatibility with released photo flows.
  const importedSource = captureSource === 'text'
    ? 'text'
    : (captureSource === 'photo' || fromOcr === 'true' ? 'photo' : 'manual');
  const importedOwner = useRef<string | null>(captureOwnerId ?? null);
  if (importedSource !== 'manual' && !importedOwner.current && inbox.ownerId) importedOwner.current = inbox.ownerId;

  // Form state
  const [title, setTitle] = useState('');
  const [servings, setServings] = useState('');
  const [estimateContextChanged, setEstimateContextChanged] = useState(false);
  const [prepTime, setPrepTime] = useState('');
  const [cookTime, setCookTime] = useState('');
  const [totalTime, setTotalTime] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [isPublic, setIsPublic] = useState(isPublicParam === undefined ? !initialImageUri : isPublicParam !== 'false');
  const recoveredImageUri = initialImageUri?.trim() || null;
  const [imageUri, setImageUri] = useState<string | null>(recoveredImageUri);
  
  // Dynamic lists
  const [ingredients, setIngredients] = useState<IngredientInput[]>([
    { id: '1', name: '', quantity: '', unit: '', notes: '' },
  ]);
  const [steps, setSteps] = useState<StepInput[]>([
    { id: '1', text: '' },
  ]);
  
  // Pre-fill form from OCR data if provided
  useEffect(() => {
    if (initialData) {
      try {
        const data = JSON.parse(initialData);
        setEstimateContextChanged(false);
        
        // Basic fields
        if (data.title) setTitle(data.title);
        if (data.servings) setServings(String(data.servings));
        if (data.times?.prep) setPrepTime(data.times.prep);
        if (data.times?.cook) setCookTime(data.times.cook);
        if (data.times?.total) setTotalTime(data.times.total);
        if (data.notes) setNotes(data.notes);
        if (data.tags?.length) setTags(data.tags.join(', '));
        if (data.nutrition) {
          setSourceNutrition(data.nutrition);
          setEstimatedNutrition(Object.fromEntries(Object.entries(data.nutrition.perServing || {}).filter(([, value]) => typeof value === 'number')));
          setEstimatedNutritionTotal(Object.fromEntries(Object.entries(data.nutrition.total || {}).filter(([, value]) => typeof value === 'number')));
          setNutritionBasis(data.nutrition.servingBasis || 'recipe_servings');
          setNutritionAssumptions(data.nutrition.assumptions || []);
        }
        
        // Preserve the visibility choice made on the OCR review screen.
        setIsPublic(isPublicParam !== 'false');
        
        // Ingredients - flatten from components
        const allIngredients: IngredientInput[] = [];
        if (data.components) {
          data.components.forEach((comp: any) => {
            comp.ingredients?.forEach((ing: any, idx: number) => {
              allIngredients.push({
                id: `${allIngredients.length + 1}`,
                name: ing.name || '',
                quantity: ing.quantity || '',
                unit: ing.unit || '',
                notes: ing.notes || '',
              quantityEstimate: ing.quantityEstimate,
              });
            });
          });
        } else if (data.ingredients) {
          data.ingredients.forEach((ing: any, idx: number) => {
            allIngredients.push({
              id: `${idx + 1}`,
              name: ing.name || '',
              quantity: ing.quantity || '',
              unit: ing.unit || '',
              notes: ing.notes || '',
              quantityEstimate: ing.quantityEstimate,
            });
          });
        }
        if (allIngredients.length > 0) {
          setIngredients(allIngredients);
          if (data.nutrition) setNutritionFingerprint(nutritionFingerprintFor(allIngredients, data.servings ? String(data.servings) : ''));
        }
        
        // Steps - flatten from components
        const allSteps: StepInput[] = [];
        if (data.components) {
          data.components.forEach((comp: any) => {
            comp.steps?.forEach((step: string) => {
              allSteps.push({
                id: `${allSteps.length + 1}`,
                text: step,
              });
            });
          });
        } else if (data.steps) {
          data.steps.forEach((step: string, idx: number) => {
            allSteps.push({
              id: `${idx + 1}`,
              text: step,
            });
          });
        }
        if (allSteps.length > 0) {
          setSteps(allSteps);
        }
        
        console.log('Pre-filled form from OCR data');
      } catch {
        // Non-critical: form will be empty, user can fill manually
      }
    }
  }, [initialData, isPublicParam]);
  
  // AI feature states
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  const [isEstimatingNutrition, setIsEstimatingNutrition] = useState(false);
  const [sourceNutrition, setSourceNutrition] = useState<(Nutrition & { sourcePerServing?: NutritionEstimateValues }) | null>(null);
  const [estimatedNutrition, setEstimatedNutrition] = useState<NutritionEstimateValues | null>(null);
  const [estimatedNutritionTotal, setEstimatedNutritionTotal] = useState<NutritionEstimateValues | null>(null);
  const [nutritionBasis, setNutritionBasis] = useState<'source' | 'recipe_servings' | 'whole_recipe'>('recipe_servings');
  const [nutritionAssumptions, setNutritionAssumptions] = useState<string[]>([]);
  const [nutritionFingerprint, setNutritionFingerprint] = useState<string | null>(null);
  const currentNutritionFingerprint = nutritionFingerprintFor(ingredients, servings);
  const latestNutritionFingerprint = useRef(currentNutritionFingerprint);
  latestNutritionFingerprint.current = currentNutritionFingerprint;
  const nutritionMatchesInputs = nutritionFingerprint === currentNutritionFingerprint;

  // Create recipe mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const originalOwner = importedSource === 'manual' ? inbox.ownerId : importedOwner.current;
      const guardOwner = () => {
        if (!originalOwner || !captureOwner.current.mounted || captureOwner.current.ownerId !== originalOwner) throw new CaptureAccountChangedError();
      };
      guardOwner();
      savingOwner.current = originalOwner;
      // Filter out empty ingredients and steps
      const validIngredients = ingredients
        .filter(ing => ing.name.trim())
        .map(ing => ({
          name: ing.name.trim(),
          quantity: ing.quantity.trim() || null,
          unit: ing.unit.trim() || null,
          notes: ing.notes.trim() || null,
          quantityEstimate: estimateContextChanged || ing.quantity.trim() ? null : ing.quantityEstimate,
        }));

      const validSteps = steps
        .filter(step => step.text.trim())
        .map(step => step.text.trim());

      const isRecoveredImageDraft = importedSource === 'photo'
        && Boolean(recoveredImageUri)
        && Boolean(imageUri);
      if (validIngredients.length === 0 && !isRecoveredImageDraft) {
        throw new Error('Please add at least one ingredient');
      }
      if (validSteps.length === 0 && !isRecoveredImageDraft) {
        throw new Error('Please add at least one step');
      }
      const isStructurallyComplete = validIngredients.length > 0 && validSteps.length > 0;

      const tagList = tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t);

      return api.createManualRecipe(
        {
          title: title.trim(),
          servings: servings ? parseInt(servings, 10) : null,
          prep_time: prepTime.trim() || null,
          cook_time: cookTime.trim() || null,
          total_time: totalTime.trim() || null,
          ingredients: validIngredients,
          steps: validSteps,
          notes: notes.trim() || null,
          tags: tagList.length > 0 ? tagList : null,
          // A source-only recovery remains private until the user completes it.
          is_public: isStructurallyComplete ? isPublic : false,
          nutrition: nutritionMatchesInputs ? estimatedNutrition : null,
          nutrition_total: nutritionMatchesInputs ? estimatedNutritionTotal : null,
          nutrition_source_serving_size: nutritionMatchesInputs ? sourceNutrition?.sourceServingSize ?? null : null,
          nutrition_source_per_serving: nutritionMatchesInputs ? sourceNutrition?.sourcePerServing ?? null : null,
          nutrition_serving_basis: nutritionBasis,
          nutrition_assumptions: nutritionAssumptions,
          source_type: importedSource,
        },
        imageUri, guardOwner
      );
    },
    onSuccess: (recipe) => {
      if (!captureOwner.current.mounted || captureOwner.current.ownerId !== savingOwner.current) return;
      invalidateCreatedRecipeQueries(queryClient, recipe.id);
      
      router.replace(`/recipe/${recipe.id}`);
    },
    onError: (error: Error) => {
      if (error instanceof CaptureAccountChangedError) return;
      Alert.alert('Error', error.message || 'Failed to create recipe');
    },
  });

  const handlePickImage = async () => {
    // Request permissions
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant camera roll access to add photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant camera access to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const showImageOptions = () => {
    Alert.alert('Add Photo', 'Choose an option', [
      { text: 'Take Photo', onPress: handleTakePhoto },
      { text: 'Choose from Library', onPress: handlePickImage },
      ...(imageUri ? [{ text: 'Remove Photo', onPress: () => setImageUri(null), style: 'destructive' as const }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const addIngredient = () => {
    setEstimateContextChanged(true);
    setIngredients([
      ...ingredients,
      { id: Date.now().toString(), name: '', quantity: '', unit: '', notes: '' },
    ]);
  };

  const removeIngredient = (id: string) => {
    setEstimateContextChanged(true);
    if (ingredients.length > 1) {
      setIngredients(ingredients.filter(ing => ing.id !== id));
    }
  };

  const updateIngredient = (id: string, field: keyof IngredientInput, value: string) => {
    if (field !== 'notes') setEstimateContextChanged(true);
    setIngredients(ingredients.map(ing =>
      ing.id === id ? { ...ing, [field]: value } : ing
    ));
  };

  const addStep = () => {
    setEstimateContextChanged(true);
    setSteps([...steps, { id: Date.now().toString(), text: '' }]);
  };

  const removeStep = (id: string) => {
    setEstimateContextChanged(true);
    if (steps.length > 1) {
      setSteps(steps.filter(step => step.id !== id));
    }
  };

  const updateStep = (id: string, text: string) => {
    setEstimateContextChanged(true);
    setSteps(steps.map(step =>
      step.id === id ? { ...step, text } : step
    ));
  };

  const publishPreview = () => formatPublishDisclosure({
    title: title.trim() || 'Untitled recipe',
    ingredientCount: ingredients.filter(ingredient => ingredient.name.trim()).length,
    instructionCount: steps.filter(step => step.text.trim()).length,
    hasPhoto: Boolean(imageUri),
    hasSourceLink: false,
    contributorName: 'your contributor name',
  });

  const isRecoveredIncompleteDraft = importedSource === 'photo'
    && Boolean(recoveredImageUri)
    && Boolean(imageUri)
    && (!ingredients.some(ingredient => ingredient.name.trim())
      || !steps.some(step => step.text.trim()));

  const submitRecipe = async () => {
    if (isPublic && !isRecoveredIncompleteDraft && !(await requestPublishing(publishPreview()))) {
      setIsPublic(false);
      return;
    }
    createMutation.mutate();
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a recipe title.');
      return;
    }
    

    void submitRecipe();
  };

  const handleVisibilityChange = async (visibility: RecipeVisibility) => {
    if (visibility === 'private') {
      setIsPublic(false);
      return;
    }
    if (isPublic) return;
    if (await requestPublishing(publishPreview())) setIsPublic(true);
  };

  const handleSuggestTags = async () => {
    const validIngredients = ingredients.filter(i => i.name.trim());
    if (validIngredients.length === 0) {
      Alert.alert('Add Ingredients First', 'Please add some ingredients before suggesting tags.');
      return;
    }

    setIsGeneratingTags(true);
    try {
      const ingredientNames = validIngredients.map(i => i.name.trim());
      const recipeTitle = title.trim() || 'Untitled Recipe';
      
      const response = await api.suggestTags(recipeTitle, ingredientNames);
      
      // Set the suggested tags
      setTags(response.tags.join(', '));
    } catch (error) {
      Alert.alert('Error', 'Failed to suggest tags. Please try again.');
    } finally {
      setIsGeneratingTags(false);
    }
  };

  const handleEstimateNutrition = async () => {
    const validIngredients = ingredients.filter(i => i.name.trim());
    if (validIngredients.length === 0) {
      Alert.alert('Add Ingredients First', 'Please add some ingredients before estimating nutrition.');
      return;
    }

    setIsEstimatingNutrition(true);
    try {
      const ingredientStrings = validIngredients.map(i => {
        const qty = i.quantity ? `${i.quantity} ` : '';
        const unit = i.unit ? `${i.unit} ` : '';
        return `${qty}${unit}${i.name}`.trim();
      });
      
      const servingsNum = servings ? Number(servings) : null;
      
      const response = await api.estimateNutrition(ingredientStrings, servingsNum);
      
      if (latestNutritionFingerprint.current !== currentNutritionFingerprint) {
        Alert.alert('Recipe Changed', 'The ingredients or servings changed while estimating. Please estimate again.');
        return;
      }
      setNutritionFingerprint(currentNutritionFingerprint);
      setSourceNutrition(null);
      setEstimatedNutrition(response.nutrition);
      setEstimatedNutritionTotal(response.total ?? null);
      setNutritionBasis(response.servingBasis ?? (servingsNum ? 'recipe_servings' : 'whole_recipe'));
      setNutritionAssumptions(response.assumptions ?? []);
    } catch (error) {
      Alert.alert('Error', 'Failed to estimate nutrition. Please try again.');
    } finally {
      setIsEstimatingNutrition(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: initialData ? 'Edit Recipe' : 'Add Recipe',
          headerRight: () => (
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={createMutation.isPending}
              style={styles.saveButton}
            >
              {createMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.tint} />
              ) : (
                <Text style={[styles.saveButtonText, { color: colors.tint }]}>
                  {isRecoveredIncompleteDraft ? 'Save draft' : (isPublic ? 'Publish' : 'Save private')}
                </Text>
              )}
            </TouchableOpacity>
          ),
        }}
      />
      
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
            keyboardShouldPersistTaps="handled"
          >
            {/* Image Section */}
            <TouchableOpacity
              style={[styles.imageSection, { backgroundColor: colors.backgroundSecondary }]}
              onPress={showImageOptions}
              activeOpacity={0.7}
            >
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.recipeImage} />
              ) : (
                <RNView style={styles.imagePlaceholder}>
                  <Ionicons name="camera-outline" size={48} color={colors.textMuted} />
                  <Text style={[styles.imagePlaceholderText, { color: colors.textMuted }]}>
                    Add Photo
                  </Text>
                </RNView>
              )}
            </TouchableOpacity>

            {/* Title */}
            <RNView style={styles.section}>
              <Text style={[styles.label, { color: colors.text }]}>Title *</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                placeholder="Recipe name"
                placeholderTextColor={colors.textMuted}
                value={title}
                onChangeText={setTitle}
              />
            </RNView>

            {/* Meta Row */}
            <RNView style={styles.metaRow}>
              <RNView style={styles.metaItem}>
                <Text style={[styles.label, { color: colors.text }]}>Servings</Text>
                <TextInput
                  style={[styles.input, styles.smallInput, { color: colors.text, borderColor: colors.border }]}
                  placeholder="4"
                  placeholderTextColor={colors.textMuted}
                  value={servings}
                  onChangeText={value => { setEstimateContextChanged(true); setServings(value); }}
                  keyboardType="number-pad"
                />
              </RNView>
              <RNView style={styles.metaItem}>
                <Text style={[styles.label, { color: colors.text }]}>Prep Time</Text>
                <TextInput
                  style={[styles.input, styles.smallInput, { color: colors.text, borderColor: colors.border }]}
                  placeholder="15 min"
                  placeholderTextColor={colors.textMuted}
                  value={prepTime}
                  onChangeText={setPrepTime}
                />
              </RNView>
            </RNView>

            <RNView style={styles.metaRow}>
              <RNView style={styles.metaItem}>
                <Text style={[styles.label, { color: colors.text }]}>Cook Time</Text>
                <TextInput
                  style={[styles.input, styles.smallInput, { color: colors.text, borderColor: colors.border }]}
                  placeholder="30 min"
                  placeholderTextColor={colors.textMuted}
                  value={cookTime}
                  onChangeText={setCookTime}
                />
              </RNView>
              <RNView style={styles.metaItem}>
                <Text style={[styles.label, { color: colors.text }]}>Total Time</Text>
                <TextInput
                  style={[styles.input, styles.smallInput, { color: colors.text, borderColor: colors.border }]}
                  placeholder="45 min"
                  placeholderTextColor={colors.textMuted}
                  value={totalTime}
                  onChangeText={setTotalTime}
                />
              </RNView>
            </RNView>

            {/* Ingredients */}
            <RNView style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: spacing.sm }]}>Ingredients *</Text>
              
              {ingredients.map((ing, index) => (
                <RNView 
                  key={ing.id} 
                  style={[styles.ingredientCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
                >
                  {/* Header row with number and delete */}
                  <RNView style={styles.ingredientHeader}>
                    <RNView style={[styles.ingredientBadge, { backgroundColor: colors.tint + '20' }]}>
                      <Text style={[styles.ingredientBadgeText, { color: colors.tint }]}>{index + 1}</Text>
                    </RNView>
                    {ingredients.length > 1 && (
                      <TouchableOpacity
                        onPress={() => removeIngredient(ing.id)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </TouchableOpacity>
                    )}
                  </RNView>
                  
                  {/* Name */}
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    placeholder="Ingredient name"
                    placeholderTextColor={colors.textMuted}
                    value={ing.name}
                    onChangeText={(v) => updateIngredient(ing.id, 'name', v)}
                  />
                  
                  {/* Qty + Unit row */}
                  <RNView style={styles.qtyUnitRow}>
                    <TextInput
                      style={[styles.input, styles.qtyInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                      placeholder="½"
                      placeholderTextColor={colors.textMuted}
                      value={ing.quantity}
                      onChangeText={(v) => updateIngredient(ing.id, 'quantity', v)}
                    />
                    <RNView style={[styles.unitPickerContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <TextInput
                        style={[styles.unitInput, { color: colors.text }]}
                        value={ing.unit}
                        onChangeText={(v) => updateIngredient(ing.id, 'unit', v)}
                        placeholder="Unit"
                        placeholderTextColor={colors.textMuted}
                      />
                      <TouchableOpacity
                        style={styles.unitDropdownButton}
                        onPress={() => {
                          Alert.alert(
                            'Select Unit',
                            '',
                            [
                              ...UNIT_OPTIONS.filter(u => u).map(unit => ({
                                text: unit,
                                onPress: () => updateIngredient(ing.id, 'unit', unit),
                              })),
                              { text: 'Clear', onPress: () => updateIngredient(ing.id, 'unit', ''), style: 'destructive' },
                              { text: 'Cancel', style: 'cancel' },
                            ]
                          );
                        }}
                      >
                        <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                    </RNView>
                  </RNView>
                  
                  {/* Notes */}
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                    placeholder="Notes (e.g., diced, room temp)"
                    placeholderTextColor={colors.textMuted}
                    value={ing.notes}
                    onChangeText={(v) => updateIngredient(ing.id, 'notes', v)}
                  />
                </RNView>
              ))}
              
              {/* Add button at bottom */}
              <TouchableOpacity 
                onPress={addIngredient} 
                style={[styles.addButtonBottom, { borderColor: colors.tint }]}
              >
                <Ionicons name="add-circle-outline" size={20} color={colors.tint} />
                <Text style={[styles.addButtonText, { color: colors.tint }]}>Add Ingredient</Text>
              </TouchableOpacity>
            </RNView>

            {/* Steps */}
            <RNView style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: spacing.sm }]}>Instructions *</Text>
              
              {steps.map((step, index) => (
                <RNView key={step.id} style={styles.stepRow}>
                  <RNView style={[styles.stepNumber, { backgroundColor: colors.tint }]}>
                    <Text style={styles.stepNumberText}>{index + 1}</Text>
                  </RNView>
                  <TextInput
                    style={[styles.input, styles.stepInput, { color: colors.text, borderColor: colors.border }]}
                    placeholder="Describe this step..."
                    placeholderTextColor={colors.textMuted}
                    value={step.text}
                    onChangeText={(v) => updateStep(step.id, v)}
                    multiline
                  />
                  <TouchableOpacity
                    onPress={() => removeStep(step.id)}
                    style={styles.removeButton}
                    disabled={steps.length === 1}
                  >
                    <Ionicons
                      name="close-circle"
                      size={24}
                      color={steps.length === 1 ? colors.border : colors.error}
                    />
                  </TouchableOpacity>
                </RNView>
              ))}
              
              {/* Add button at bottom */}
              <TouchableOpacity 
                onPress={addStep} 
                style={[styles.addButtonBottom, { borderColor: colors.border }]}
              >
                <Ionicons name="add-circle-outline" size={20} color={colors.tint} />
                <Text style={[styles.addButtonText, { color: colors.tint }]}>Add Step</Text>
              </TouchableOpacity>
            </RNView>

            {/* Tags */}
            <RNView style={styles.section}>
              <RNView style={styles.labelRow}>
                <Text style={[styles.label, { color: colors.text }]}>Tags</Text>
                <TouchableOpacity
                  onPress={handleSuggestTags}
                  disabled={isGeneratingTags || ingredients.filter(i => i.name.trim()).length === 0}
                  style={[styles.aiButton, { backgroundColor: colors.tint }]}
                >
                  {isGeneratingTags ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={14} color="#FFFFFF" />
                      <Text style={styles.aiButtonText}>Suggest</Text>
                    </>
                  )}
                </TouchableOpacity>
              </RNView>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                placeholder="dinner, quick, italian (comma separated)"
                placeholderTextColor={colors.textMuted}
                value={tags}
                onChangeText={setTags}
              />
            </RNView>

            {/* Notes */}
            <RNView style={styles.section}>
              <Text style={[styles.label, { color: colors.text }]}>Notes</Text>
              <TextInput
                style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.border }]}
                placeholder="Any additional notes or tips..."
                placeholderTextColor={colors.textMuted}
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </RNView>

            {/* Nutrition Estimate */}
            <RNView style={styles.section}>
              <RNView style={styles.labelRow}>
                <Text style={[styles.label, { color: colors.text }]}>Nutrition</Text>
                <TouchableOpacity
                  onPress={handleEstimateNutrition}
                  disabled={isEstimatingNutrition || ingredients.filter(i => i.name.trim()).length === 0}
                  style={[styles.aiButton, { backgroundColor: colors.tint }]}
                >
                  {isEstimatingNutrition ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={14} color="#FFFFFF" />
                      <Text style={styles.aiButtonText}>Estimate</Text>
                    </>
                  )}
                </TouchableOpacity>
              </RNView>
              
              {nutritionMatchesInputs && (estimatedNutrition || estimatedNutritionTotal) ? (
                <NutritionPanel nutrition={{
                  ...sourceNutrition,
                  perServing: normalizeNutritionValues(estimatedNutrition),
                  total: normalizeNutritionValues(estimatedNutritionTotal),
                  servingBasis: nutritionBasis, assumptions: nutritionAssumptions,
                }} metadata={{ status: 'current' }} isLoading={isEstimatingNutrition} />
              ) : <Text style={[styles.nutritionPlaceholderText, { color: colors.textMuted }]}>Estimate nutrition from your ingredients. Without a serving count, estimates cover the whole recipe.</Text>}
            </RNView>

            {isRecoveredIncompleteDraft && (
              <Text style={[styles.nutritionDisclaimer, { color: colors.textMuted }]}>
                This image can be saved privately as a draft. Add at least one ingredient and
                instruction before publishing.
              </Text>
            )}

            <RecipeVisibilitySelector
              value={isPublic ? 'public' : 'private'}
              onChange={handleVisibilityChange}
              disabled={createMutation.isPending || isCheckingDisclosure || isRecoveredIncompleteDraft}
            />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  saveButton: {
    paddingHorizontal: spacing.sm,
  },
  saveButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  imageSection: {
    height: 200,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  recipeImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePlaceholderText: {
    marginTop: spacing.sm,
    fontSize: fontSize.md,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.md,
  },
  smallInput: {
    flex: 1,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  metaItem: {
    flex: 1,
  },
  addButtonBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  ingredientCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  ingredientHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  ingredientBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ingredientBadgeText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  removeButton: {
    padding: spacing.xs,
  },
  qtyUnitRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  qtyInput: {
    width: 80,
  },
  unitPickerContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingRight: spacing.xs,
  },
  unitInput: {
    flex: 1,
    padding: spacing.sm,
    fontSize: fontSize.md,
  },
  unitDropdownButton: {
    padding: spacing.xs,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  stepNumberText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  stepInput: {
    flex: 1,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  aiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  aiButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  nutritionCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  nutritionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  nutritionItem: {
    alignItems: 'center',
  },
  nutritionValue: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  nutritionLabel: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  nutritionDisclaimer: {
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  nutritionPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  nutritionPlaceholderText: {
    flex: 1,
    fontSize: fontSize.sm,
  },
});
