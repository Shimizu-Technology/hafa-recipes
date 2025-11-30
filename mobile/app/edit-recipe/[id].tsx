/**
 * Edit Recipe Screen
 * 
 * Allows users to edit an existing recipe.
 * For extracted recipes, saves the original on first edit.
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

export default function EditRecipeScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  // Form state
  const [title, setTitle] = useState('');
  const [servings, setServings] = useState('');
  const [prepTime, setPrepTime] = useState('');
  const [cookTime, setCookTime] = useState('');
  const [totalTime, setTotalTime] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [newImageUri, setNewImageUri] = useState<string | null>(null);
  
  // Dynamic lists
  const [ingredients, setIngredients] = useState<IngredientInput[]>([
    { id: '1', name: '', quantity: '', unit: '', notes: '' },
  ]);
  const [steps, setSteps] = useState<StepInput[]>([
    { id: '1', text: '' },
  ]);
  
  // AI feature states
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  const [isEstimatingNutrition, setIsEstimatingNutrition] = useState(false);
  const [estimatedNutrition, setEstimatedNutrition] = useState<{
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  } | null>(null);

  // Fetch existing recipe
  const { data: recipe, isLoading: isLoadingRecipe } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => api.getRecipe(id!),
    enabled: !!id,
  });

  // Check if recipe has original version
  const { data: originalStatus } = useQuery({
    queryKey: ['recipe-original', id],
    queryFn: () => api.checkHasOriginal(id!),
    enabled: !!id,
  });

  // Pre-populate form when recipe loads
  useEffect(() => {
    if (recipe?.extracted) {
      const extracted = recipe.extracted;
      const times = extracted.times || {};
      const nutrition = extracted.nutrition?.perServing || {};
      
      setTitle(extracted.title || '');
      setServings(extracted.servings?.toString() || '');
      setPrepTime(times.prep || '');
      setCookTime(times.cook || '');
      setTotalTime(times.total || '');
      setNotes(extracted.notes || '');
      setTags((extracted.tags || []).join(', '));
      setIsPublic(recipe.is_public);
      setThumbnailUrl(recipe.thumbnail_url || null);
      
      // Set nutrition if available
      if (nutrition.calories || nutrition.protein || nutrition.carbs || nutrition.fat) {
        setEstimatedNutrition({
          calories: nutrition.calories ?? undefined,
          protein: nutrition.protein ?? undefined,
          carbs: nutrition.carbs ?? undefined,
          fat: nutrition.fat ?? undefined,
        });
      }
      
      // Get ingredients from components or legacy field
      const components = extracted.components || [];
      let allIngredients: any[] = [];
      if (components.length > 0) {
        allIngredients = components.flatMap((c: any) => c.ingredients || []);
      } else if (extracted.ingredients) {
        allIngredients = extracted.ingredients;
      }
      
      if (allIngredients.length > 0) {
        setIngredients(allIngredients.map((ing: any, idx: number) => ({
          id: (idx + 1).toString(),
          name: ing.name || '',
          quantity: ing.quantity || '',
          unit: ing.unit || '',
          notes: ing.notes || '',
        })));
      }
      
      // Get steps from components or legacy field
      let allSteps: string[] = [];
      if (components.length > 0) {
        allSteps = components.flatMap((c: any) => c.steps || []);
      } else if (extracted.steps) {
        allSteps = extracted.steps;
      }
      
      if (allSteps.length > 0) {
        setSteps(allSteps.map((step: string, idx: number) => ({
          id: (idx + 1).toString(),
          text: step,
        })));
      }
    }
  }, [recipe]);

  // Edit recipe mutation
  const editMutation = useMutation({
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

      return api.editRecipe(
        id!,
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
        },
        newImageUri
      );
    },
    onSuccess: () => {
      // Invalidate recipe queries to refresh
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['recipe', id] });
      queryClient.invalidateQueries({ queryKey: ['recipe-original', id] });
      
      Alert.alert('Success!', 'Recipe updated successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message || 'Failed to update recipe');
    },
  });

  // Restore original mutation
  const restoreMutation = useMutation({
    mutationFn: () => api.restoreOriginalRecipe(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['recipe', id] });
      queryClient.invalidateQueries({ queryKey: ['recipe-original', id] });
      
      Alert.alert('Restored!', 'Recipe has been restored to the original version.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message || 'Failed to restore recipe');
    },
  });

  const handleSubmit = () => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a recipe title.');
      return;
    }
    editMutation.mutate();
  };

  const handleRestoreOriginal = () => {
    Alert.alert(
      'Restore Original',
      'This will revert all your changes to the original AI-extracted version. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Restore', 
          style: 'destructive',
          onPress: () => restoreMutation.mutate()
        },
      ]
    );
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

  // Image picker functions
  const handlePickImage = async () => {
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
      setNewImageUri(result.assets[0].uri);
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
      setNewImageUri(result.assets[0].uri);
    }
  };

  const showImageOptions = () => {
    const hasImage = newImageUri || thumbnailUrl;
    Alert.alert('Recipe Photo', 'Choose an option', [
      { text: 'Take Photo', onPress: handleTakePhoto },
      { text: 'Choose from Library', onPress: handlePickImage },
      ...(hasImage ? [{ 
        text: 'Remove Photo', 
        onPress: () => {
          setNewImageUri(null);
          setThumbnailUrl(null);
        }, 
        style: 'destructive' as const 
      }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Ingredient helpers
  const addIngredient = () => {
    const newId = (ingredients.length + 1).toString();
    setIngredients([...ingredients, { id: newId, name: '', quantity: '', unit: '', notes: '' }]);
  };

  const updateIngredient = (id: string, field: keyof IngredientInput, value: string) => {
    setIngredients(ingredients.map(ing => 
      ing.id === id ? { ...ing, [field]: value } : ing
    ));
  };

  const removeIngredient = (id: string) => {
    if (ingredients.length > 1) {
      setIngredients(ingredients.filter(ing => ing.id !== id));
    }
  };

  // Step helpers
  const addStep = () => {
    const newId = (steps.length + 1).toString();
    setSteps([...steps, { id: newId, text: '' }]);
  };

  const updateStep = (id: string, text: string) => {
    setSteps(steps.map(step => 
      step.id === id ? { ...step, text } : step
    ));
  };

  const removeStep = (id: string) => {
    if (steps.length > 1) {
      setSteps(steps.filter(step => step.id !== id));
    }
  };

  if (isLoadingRecipe) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading recipe...</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: 'Edit Recipe',
          headerRight: () => (
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={editMutation.isPending}
              style={styles.saveButton}
            >
              {editMutation.isPending ? (
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
              {newImageUri || thumbnailUrl ? (
                <>
                  <Image source={{ uri: newImageUri || thumbnailUrl! }} style={styles.recipeImage} />
                  <RNView style={styles.imageOverlay}>
                    <Ionicons name="camera" size={24} color="#FFFFFF" />
                    <Text style={styles.imageOverlayText}>Tap to change</Text>
                  </RNView>
                </>
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
                style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
                value={title}
                onChangeText={setTitle}
                placeholder="Recipe name"
                placeholderTextColor={colors.textMuted}
              />
            </RNView>

            {/* Meta Info Row */}
            <RNView style={styles.metaRow}>
              <RNView style={styles.metaItem}>
                <Text style={[styles.label, { color: colors.text }]}>Servings</Text>
                <TextInput
                  style={[styles.input, styles.smallInput, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
                  value={servings}
                  onChangeText={setServings}
                  placeholder="4"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                />
              </RNView>
              <RNView style={styles.metaItem}>
                <Text style={[styles.label, { color: colors.text }]}>Total Time</Text>
                <TextInput
                  style={[styles.input, styles.smallInput, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
                  value={totalTime}
                  onChangeText={setTotalTime}
                  placeholder="30 min"
                  placeholderTextColor={colors.textMuted}
                />
              </RNView>
            </RNView>

            {/* Prep/Cook Time Row */}
            <RNView style={styles.metaRow}>
              <RNView style={styles.metaItem}>
                <Text style={[styles.label, { color: colors.text }]}>Prep Time</Text>
                <TextInput
                  style={[styles.input, styles.smallInput, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
                  value={prepTime}
                  onChangeText={setPrepTime}
                  placeholder="15 min"
                  placeholderTextColor={colors.textMuted}
                />
              </RNView>
              <RNView style={styles.metaItem}>
                <Text style={[styles.label, { color: colors.text }]}>Cook Time</Text>
                <TextInput
                  style={[styles.input, styles.smallInput, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
                  value={cookTime}
                  onChangeText={setCookTime}
                  placeholder="20 min"
                  placeholderTextColor={colors.textMuted}
                />
              </RNView>
            </RNView>

            {/* Ingredients Section */}
            <RNView style={styles.section}>
              <RNView style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Ingredients *</Text>
              </RNView>
              
              {ingredients.map((ingredient, index) => (
                <RNView key={ingredient.id} style={[styles.ingredientRow, { borderColor: colors.border }]}>
                  <RNView style={styles.ingredientInputs}>
                    {/* Name - First */}
                    <TextInput
                      style={[styles.input, styles.ingredientName, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
                      value={ingredient.name}
                      onChangeText={(v) => updateIngredient(ingredient.id, 'name', v)}
                      placeholder="Ingredient name"
                      placeholderTextColor={colors.textMuted}
                    />
                    <RNView style={styles.qtyUnitRow}>
                      {/* Quantity */}
                      <TextInput
                        style={[styles.input, styles.ingredientQty, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
                        value={ingredient.quantity}
                        onChangeText={(v) => updateIngredient(ingredient.id, 'quantity', v)}
                        placeholder="Qty"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="decimal-pad"
                      />
                      {/* Unit - Now a dropdown/picker */}
                      <RNView style={[styles.unitPickerContainer, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
                        <TextInput
                          style={[styles.unitInput, { color: colors.text }]}
                          value={ingredient.unit}
                          onChangeText={(v) => updateIngredient(ingredient.id, 'unit', v)}
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
                                ...UNIT_OPTIONS.map(unit => ({
                                  text: unit || '(custom)',
                                  onPress: () => updateIngredient(ingredient.id, 'unit', unit),
                                })),
                                { text: 'Cancel', style: 'cancel' },
                              ]
                            );
                          }}
                        >
                          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                      </RNView>
                    </RNView>
                  </RNView>
                  {ingredients.length > 1 && (
                    <TouchableOpacity
                      onPress={() => removeIngredient(ingredient.id)}
                      style={styles.removeButton}
                    >
                      <Ionicons name="close-circle" size={24} color={colors.error} />
                    </TouchableOpacity>
                  )}
                </RNView>
              ))}
              
              <TouchableOpacity
                style={[styles.addButton, { borderColor: colors.tint }]}
                onPress={addIngredient}
              >
                <Ionicons name="add" size={20} color={colors.tint} />
                <Text style={[styles.addButtonText, { color: colors.tint }]}>Add Ingredient</Text>
              </TouchableOpacity>
            </RNView>

            {/* Steps Section */}
            <RNView style={styles.section}>
              <RNView style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Steps *</Text>
              </RNView>
              
              {steps.map((step, index) => (
                <RNView key={step.id} style={styles.stepRow}>
                  <Text style={[styles.stepNumber, { color: colors.tint }]}>{index + 1}.</Text>
                  <TextInput
                    style={[styles.input, styles.stepInput, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
                    value={step.text}
                    onChangeText={(v) => updateStep(step.id, v)}
                    placeholder="Describe this step..."
                    placeholderTextColor={colors.textMuted}
                    multiline
                  />
                  {steps.length > 1 && (
                    <TouchableOpacity
                      onPress={() => removeStep(step.id)}
                      style={styles.removeButton}
                    >
                      <Ionicons name="close-circle" size={24} color={colors.error} />
                    </TouchableOpacity>
                  )}
                </RNView>
              ))}
              
              <TouchableOpacity
                style={[styles.addButton, { borderColor: colors.tint }]}
                onPress={addStep}
              >
                <Ionicons name="add" size={20} color={colors.tint} />
                <Text style={[styles.addButtonText, { color: colors.tint }]}>Add Step</Text>
              </TouchableOpacity>
            </RNView>

            {/* Tags Section */}
            <RNView style={styles.section}>
              <RNView style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Tags</Text>
                <TouchableOpacity
                  style={[styles.aiButton, { backgroundColor: colors.tint }]}
                  onPress={handleSuggestTags}
                  disabled={isGeneratingTags}
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
                style={[styles.input, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
                value={tags}
                onChangeText={setTags}
                placeholder="dinner, quick, easy (comma separated)"
                placeholderTextColor={colors.textMuted}
              />
            </RNView>

            {/* Nutrition Section */}
            <RNView style={styles.section}>
              <RNView style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Nutrition</Text>
                <TouchableOpacity
                  style={[styles.aiButton, { backgroundColor: colors.tint }]}
                  onPress={handleEstimateNutrition}
                  disabled={isEstimatingNutrition}
                >
                  {isEstimatingNutrition ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="calculator" size={14} color="#FFFFFF" />
                      <Text style={styles.aiButtonText}>Estimate</Text>
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
                    Per serving • Values are approximate
                  </Text>
                </RNView>
              ) : (
                <RNView style={[styles.nutritionPlaceholder, { borderColor: colors.border }]}>
                  <Ionicons name="nutrition-outline" size={24} color={colors.textMuted} />
                  <Text style={[styles.nutritionPlaceholderText, { color: colors.textMuted }]}>
                    Tap "Estimate" for AI nutrition facts
                  </Text>
                </RNView>
              )}
            </RNView>

            {/* Notes */}
            <RNView style={styles.section}>
              <Text style={[styles.label, { color: colors.text }]}>Notes</Text>
              <TextInput
                style={[styles.input, styles.notesInput, { backgroundColor: colors.backgroundSecondary, color: colors.text, borderColor: colors.border }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Additional notes, tips, or variations..."
                placeholderTextColor={colors.textMuted}
                multiline
              />
            </RNView>

            {/* Public Toggle */}
            <TouchableOpacity
              style={[styles.toggleRow, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
              onPress={() => setIsPublic(!isPublic)}
            >
              <RNView style={styles.toggleInfo}>
                <Ionicons 
                  name={isPublic ? "globe-outline" : "lock-closed-outline"} 
                  size={24} 
                  color={isPublic ? colors.tint : colors.textMuted} 
                />
                <RNView style={styles.toggleTextContainer}>
                  <Text style={[styles.toggleTitle, { color: colors.text }]}>
                    {isPublic ? 'Shared to Library' : 'Private Recipe'}
                  </Text>
                  <Text style={[styles.toggleSubtitle, { color: colors.textMuted }]}>
                    {isPublic ? 'Others can discover this recipe' : 'Only you can see this recipe'}
                  </Text>
                </RNView>
              </RNView>
              <Ionicons
                name={isPublic ? "checkmark-circle" : "ellipse-outline"}
                size={28}
                color={isPublic ? colors.tint : colors.textMuted}
              />
            </TouchableOpacity>

            {/* Restore Original Button (for extracted recipes that have been edited) */}
            {originalStatus?.has_original && (
              <TouchableOpacity
                style={[styles.restoreButton, { borderColor: colors.warning }]}
                onPress={handleRestoreOriginal}
                disabled={restoreMutation.isPending}
              >
                {restoreMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.warning} />
                ) : (
                  <>
                    <Ionicons name="refresh" size={20} color={colors.warning} />
                    <Text style={[styles.restoreButtonText, { color: colors.warning }]}>
                      Restore Original Version
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: fontSize.md,
  },
  scrollContent: {
    padding: spacing.md,
  },
  saveButton: {
    paddingHorizontal: spacing.md,
  },
  saveButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  imageSection: {
    height: 200,
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recipeImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  imageOverlayText: {
    color: '#FFFFFF',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  imagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  imagePlaceholderText: {
    fontSize: fontSize.sm,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
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
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    fontSize: fontSize.md,
  },
  smallInput: {
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  metaItem: {
    flex: 1,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  ingredientInputs: {
    flex: 1,
    gap: spacing.xs,
  },
  ingredientName: {
    flex: 1,
  },
  qtyUnitRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  ingredientQty: {
    width: 60,
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
  removeButton: {
    padding: spacing.xs,
    marginTop: spacing.xs,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  addButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  stepNumber: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    width: 24,
    marginTop: spacing.sm,
  },
  stepInput: {
    flex: 1,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  notesInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  toggleTextContainer: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  toggleSubtitle: {
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  aiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
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
  restoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    borderWidth: 2,
    borderRadius: radius.md,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  restoreButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
});

