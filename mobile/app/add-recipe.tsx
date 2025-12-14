/**
 * Add Recipe Screen
 * 
 * Allows users to manually create a recipe with optional image upload.
 */

import { useState, useEffect } from 'react';
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
import { api } from '@/lib/api';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';

interface IngredientInput {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  notes: string;
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

export default function AddRecipeScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  
  // Get initial data from route params (for OCR pre-fill)
  const { initialData, isPublic: initialIsPublic, fromOcr } = useLocalSearchParams<{
    initialData?: string;
    isPublic?: string;
    fromOcr?: string;
  }>();
  
  // Track if this recipe originated from OCR
  const isFromOcr = fromOcr === 'true';

  // Form state
  const [title, setTitle] = useState('');
  const [servings, setServings] = useState('');
  const [prepTime, setPrepTime] = useState('');
  const [cookTime, setCookTime] = useState('');
  const [totalTime, setTotalTime] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [imageUri, setImageUri] = useState<string | null>(null);
  
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
        
        // Basic fields
        if (data.title) setTitle(data.title);
        if (data.servings) setServings(String(data.servings));
        if (data.times?.prep) setPrepTime(data.times.prep);
        if (data.times?.cook) setCookTime(data.times.cook);
        if (data.times?.total) setTotalTime(data.times.total);
        if (data.notes) setNotes(data.notes);
        if (data.tags?.length) setTags(data.tags.join(', '));
        
        // Set public/private from params
        if (initialIsPublic !== undefined) {
          setIsPublic(initialIsPublic === 'true');
        }
        
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
            });
          });
        }
        if (allIngredients.length > 0) {
          setIngredients(allIngredients);
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
        
        console.log('📝 Pre-filled form from OCR data');
      } catch {
        // Non-critical: form will be empty, user can fill manually
      }
    }
  }, [initialData, initialIsPublic]);
  
  // AI feature states
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  const [isEstimatingNutrition, setIsEstimatingNutrition] = useState(false);
  const [estimatedNutrition, setEstimatedNutrition] = useState<{
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  } | null>(null);

  // Create recipe mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      // Filter out empty ingredients and steps
      const validIngredients = ingredients
        .filter(ing => ing.name.trim())
        .map(ing => ({
          name: ing.name.trim(),
          quantity: ing.quantity.trim() || null,
          unit: ing.unit.trim() || null,
          notes: ing.notes.trim() || null,
        }));

      const validSteps = steps
        .filter(step => step.text.trim())
        .map(step => step.text.trim());

      if (validIngredients.length === 0) {
        throw new Error('Please add at least one ingredient');
      }
      if (validSteps.length === 0) {
        throw new Error('Please add at least one step');
      }

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
          is_public: isPublic,
          nutrition: estimatedNutrition,
          source_type: isFromOcr ? 'photo' : 'manual', // Preserve OCR origin
        },
        imageUri
      );
    },
    onSuccess: (recipe) => {
      // Invalidate recipe queries to refresh lists
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['recipeCount'] });
      
      Alert.alert('Success!', 'Your recipe has been created.', [
        { text: 'View Recipe', onPress: () => router.replace(`/recipe/${recipe.id}`) },
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (error: Error) => {
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
    setIngredients([
      ...ingredients,
      { id: Date.now().toString(), name: '', quantity: '', unit: '', notes: '' },
    ]);
  };

  const removeIngredient = (id: string) => {
    if (ingredients.length > 1) {
      setIngredients(ingredients.filter(ing => ing.id !== id));
    }
  };

  const updateIngredient = (id: string, field: keyof IngredientInput, value: string) => {
    setIngredients(ingredients.map(ing =>
      ing.id === id ? { ...ing, [field]: value } : ing
    ));
  };

  const addStep = () => {
    setSteps([...steps, { id: Date.now().toString(), text: '' }]);
  };

  const removeStep = (id: string) => {
    if (steps.length > 1) {
      setSteps(steps.filter(step => step.id !== id));
    }
  };

  const updateStep = (id: string, text: string) => {
    setSteps(steps.map(step =>
      step.id === id ? { ...step, text } : step
    ));
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a recipe title.');
      return;
    }
    createMutation.mutate();
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
      
      const servingsNum = servings ? parseInt(servings, 10) : 4;
      
      const response = await api.estimateNutrition(ingredientStrings, servingsNum);
      
      setEstimatedNutrition({
        calories: response.nutrition.calories,
        protein: response.nutrition.protein,
        carbs: response.nutrition.carbs,
        fat: response.nutrition.fat,
      });
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
                <Text style={[styles.saveButtonText, { color: colors.tint }]}>Save</Text>
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
                  onChangeText={setServings}
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
                <RNView key={ing.id} style={styles.ingredientRow}>
                  <RNView style={styles.ingredientNumber}>
                    <Text style={[styles.ingredientNumberText, { color: colors.textMuted }]}>
                      {index + 1}
                    </Text>
                  </RNView>
                  <RNView style={styles.ingredientInputs}>
                    {/* Name first (primary field) */}
                    <TextInput
                      style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                      placeholder="Ingredient name"
                      placeholderTextColor={colors.textMuted}
                      value={ing.name}
                      onChangeText={(v) => updateIngredient(ing.id, 'name', v)}
                    />
                    {/* Qty and Unit row */}
                    <RNView style={styles.ingredientSecondRow}>
                      <TextInput
                        style={[styles.input, styles.qtyInput, { color: colors.text, borderColor: colors.border }]}
                        placeholder="Qty"
                        placeholderTextColor={colors.textMuted}
                        value={ing.quantity}
                        onChangeText={(v) => updateIngredient(ing.id, 'quantity', v)}
                      />
                      <TouchableOpacity
                        style={[styles.unitPicker, { borderColor: colors.border }]}
                        onPress={() => {
                          Alert.alert(
                            'Select Unit',
                            'Choose a unit or enter custom',
                            [
                              ...UNIT_OPTIONS.filter(u => u).map(unit => ({
                                text: unit,
                                onPress: () => updateIngredient(ing.id, 'unit', unit),
                              })),
                              {
                                text: 'Custom...',
                                onPress: () => {
                                  Alert.prompt(
                                    'Custom Unit',
                                    'Enter a custom unit:',
                                    (text) => {
                                      if (text) updateIngredient(ing.id, 'unit', text);
                                    },
                                    'plain-text',
                                    ing.unit
                                  );
                                },
                              },
                              { text: 'Clear', onPress: () => updateIngredient(ing.id, 'unit', ''), style: 'destructive' },
                              { text: 'Cancel', style: 'cancel' },
                            ]
                          );
                        }}
                      >
                        <Text style={[styles.unitPickerText, { color: ing.unit ? colors.text : colors.textMuted }]}>
                          {ing.unit || 'Unit'}
                        </Text>
                        <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TextInput
                        style={[styles.input, styles.notesInputSmall, { color: colors.text, borderColor: colors.border }]}
                        placeholder="Notes"
                        placeholderTextColor={colors.textMuted}
                        value={ing.notes}
                        onChangeText={(v) => updateIngredient(ing.id, 'notes', v)}
                      />
                    </RNView>
                  </RNView>
                  <TouchableOpacity
                    onPress={() => removeIngredient(ing.id)}
                    style={styles.removeButton}
                    disabled={ingredients.length === 1}
                  >
                    <Ionicons
                      name="close-circle"
                      size={24}
                      color={ingredients.length === 1 ? colors.border : colors.error}
                    />
                  </TouchableOpacity>
                </RNView>
              ))}
              
              {/* Add button at bottom */}
              <TouchableOpacity 
                onPress={addIngredient} 
                style={[styles.addButtonBottom, { borderColor: colors.border }]}
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
                  style={styles.aiButton}
                >
                  {isGeneratingTags ? (
                    <ActivityIndicator size="small" color={colors.tint} />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={14} color={colors.tint} />
                      <Text style={[styles.aiButtonText, { color: colors.tint }]}>Suggest</Text>
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
                <Text style={[styles.label, { color: colors.text }]}>Nutrition (per serving)</Text>
                <TouchableOpacity
                  onPress={handleEstimateNutrition}
                  disabled={isEstimatingNutrition || ingredients.filter(i => i.name.trim()).length === 0}
                  style={styles.aiButton}
                >
                  {isEstimatingNutrition ? (
                    <ActivityIndicator size="small" color={colors.tint} />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={14} color={colors.tint} />
                      <Text style={[styles.aiButtonText, { color: colors.tint }]}>Estimate</Text>
                    </>
                  )}
                </TouchableOpacity>
              </RNView>
              
              {estimatedNutrition ? (
                <RNView style={[styles.nutritionCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
                  <RNView style={styles.nutritionRow}>
                    <RNView style={styles.nutritionItem}>
                      <Text style={[styles.nutritionValue, { color: colors.tint }]}>
                        {estimatedNutrition.calories}
                      </Text>
                      <Text style={[styles.nutritionLabel, { color: colors.textMuted }]}>cal</Text>
                    </RNView>
                    <RNView style={styles.nutritionItem}>
                      <Text style={[styles.nutritionValue, { color: colors.tint }]}>
                        {estimatedNutrition.protein}g
                      </Text>
                      <Text style={[styles.nutritionLabel, { color: colors.textMuted }]}>protein</Text>
                    </RNView>
                    <RNView style={styles.nutritionItem}>
                      <Text style={[styles.nutritionValue, { color: colors.tint }]}>
                        {estimatedNutrition.carbs}g
                      </Text>
                      <Text style={[styles.nutritionLabel, { color: colors.textMuted }]}>carbs</Text>
                    </RNView>
                    <RNView style={styles.nutritionItem}>
                      <Text style={[styles.nutritionValue, { color: colors.tint }]}>
                        {estimatedNutrition.fat}g
                      </Text>
                      <Text style={[styles.nutritionLabel, { color: colors.textMuted }]}>fat</Text>
                    </RNView>
                  </RNView>
                  <Text style={[styles.nutritionDisclaimer, { color: colors.textMuted }]}>
                    ✨ AI estimated • Values are approximate
                  </Text>
                </RNView>
              ) : (
                <RNView style={[styles.nutritionPlaceholder, { borderColor: colors.border }]}>
                  <Ionicons name="nutrition-outline" size={24} color={colors.textMuted} />
                  <Text style={[styles.nutritionPlaceholderText, { color: colors.textMuted }]}>
                    Add ingredients and tap "Estimate" for AI nutrition facts
                  </Text>
                </RNView>
              )}
            </RNView>

            {/* Public Toggle */}
            <TouchableOpacity
              style={[
                styles.publicToggle,
                {
                  borderColor: isPublic ? colors.success : colors.border,
                  backgroundColor: isPublic ? colors.success + '10' : 'transparent',
                },
              ]}
              onPress={() => setIsPublic(!isPublic)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isPublic ? 'globe' : 'globe-outline'}
                size={20}
                color={isPublic ? colors.success : colors.textSecondary}
              />
              <Text
                style={[
                  styles.publicToggleText,
                  { color: isPublic ? colors.success : colors.text },
                ]}
              >
                {isPublic ? 'Share to Library' : 'Keep Private'}
              </Text>
              <Ionicons
                name={isPublic ? 'checkmark-circle' : 'add-circle-outline'}
                size={18}
                color={isPublic ? colors.success : colors.textMuted}
              />
            </TouchableOpacity>
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
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  ingredientNumber: {
    width: 24,
    paddingTop: spacing.md,
  },
  ingredientNumberText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  ingredientInputs: {
    flex: 1,
    gap: spacing.xs,
  },
  ingredientSecondRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  qtyInput: {
    width: 60,
  },
  unitPicker: {
    width: 90,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  unitPickerText: {
    fontSize: fontSize.md,
  },
  notesInputSmall: {
    flex: 1,
  },
  removeButton: {
    paddingTop: spacing.md,
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
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  aiButtonText: {
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
  publicToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  publicToggleText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    flex: 1,
  },
});

