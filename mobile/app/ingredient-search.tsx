import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  View as RNView,
  Alert,
  Keyboard,
  ScrollView,
} from 'react-native';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@clerk/expo';

import { View, Text, useColors } from '@/components/Themed';
import { useSearchByIngredients } from '@/hooks/useRecipes';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';
import {
  mergeIngredientSearchInput,
  parseIngredientSearchInput,
} from '../lib/ingredientSearch';
import { IngredientMatchCard } from '@/components/IngredientMatchCard';
import { useAddFromRecipe } from '@/hooks/useGrocery';
import { appRoutes } from '@/lib/routes';
import { usePantrySnapshot } from '@/hooks/usePantry';
import { pantrySearchNames } from '@/lib/pantry';
import type { IngredientMatchResult } from '@/types/recipe';

const PANTRY_STARTERS = ['chicken', 'rice', 'eggs', 'tomatoes'];
const MAX_SEARCH_INGREDIENTS = 50;

export default function IngredientSearchScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();

  const [inputText, setInputText] = useState('');
  const [searchIngredients, setSearchIngredients] = useState<string[]>([]);
  const [useSavedPantry, setUseSavedPantry] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [includeSaved, setIncludeSaved] = useState(true);
  const [includePublic, setIncludePublic] = useState(true);
  const [pendingGroceryRecipeId, setPendingGroceryRecipeId] = useState<string | null>(null);
  const [addedGroceryRecipeIds, setAddedGroceryRecipeIds] = useState<Set<string>>(new Set());
  const addFromRecipeMutation = useAddFromRecipe();
  const pantry = usePantrySnapshot('active', Boolean(isSignedIn));
  useFocusEffect(useCallback(() => { if (isSignedIn) void pantry.refetch(); }, [isSignedIn, pantry.refetch]));
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const pantryNames = useMemo(() => pantrySearchNames(pantry.data?.items ?? [], todayString), [pantry.data?.items, todayString]);
  const queryIngredients = useMemo(() => [...new Set([
    ...searchIngredients,
    ...(useSavedPantry && isSignedIn ? pantryNames : []),
  ])].slice(0, MAX_SEARCH_INGREDIENTS), [searchIngredients, useSavedPantry, isSignedIn, pantryNames]);
  useEffect(() => {
    if ((!isSignedIn || (pantry.isFetched && pantryNames.length === 0)) && searchIngredients.length === 0) setShowEditor(true);
  }, [isSignedIn, pantry.isFetched, pantryNames.length, searchIngredients.length]);

  // Search query
  const { data, isLoading, isFetching, isError, refetch } = useSearchByIngredients(
    queryIngredients,
    Boolean(isSignedIn) && includeSaved,
    includePublic,
    queryIngredients.length > 0
  );
  
  const handleSearch = useCallback(() => {
    if (!inputText.trim()) return;

    const ingredients = mergeIngredientSearchInput(searchIngredients, inputText);

    if (ingredients.length > MAX_SEARCH_INGREDIENTS) {
      Alert.alert(
        'Too Many Ingredients',
        `Search up to ${MAX_SEARCH_INGREDIENTS} ingredients at a time for the clearest matches.`,
      );
      return;
    }
    
    if (ingredients.length > 0) {
      haptics.light();
      setSearchIngredients(ingredients);
      setInputText('');
      setShowEditor(false);
      Keyboard.dismiss();
    }
  }, [inputText, searchIngredients]);
  
  const handleRemoveIngredient = useCallback((ingredient: string) => {
    haptics.light();
    setSearchIngredients(searchIngredients.filter(i => i !== ingredient));
  }, [searchIngredients]);
  
  const handleClear = useCallback(() => {
    haptics.light();
    setInputText('');
    setSearchIngredients([]);
  }, []);

  const handleStarterPress = useCallback((ingredient: string) => {
    haptics.light();
    const ingredients = mergeIngredientSearchInput(
      parseIngredientSearchInput(inputText),
      ingredient,
    );
    setInputText(ingredients.join(', '));
  }, [inputText]);

  const handleAddMissing = useCallback((result: IngredientMatchResult) => {
    if (addFromRecipeMutation.isPending) return;
    const { recipe, missing_ingredients: missingIngredients } = result;
    setPendingGroceryRecipeId(recipe.id);
    addFromRecipeMutation.mutate({
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      ingredients: missingIngredients.map((name) => ({
        name,
        quantity: null,
        unit: null,
        notes: null,
      })),
    }, {
      onSuccess: () => {
        haptics.success();
        setAddedGroceryRecipeIds((current) => new Set(current).add(recipe.id));
        Alert.alert(
          'Added to Grocery List',
          `${missingIngredients.length} missing ingredient${missingIngredients.length === 1 ? '' : 's'} from “${recipe.title}” ${missingIngredients.length === 1 ? 'was' : 'were'} added.`,
          [
            { text: 'Keep browsing', style: 'cancel' },
            { text: 'View grocery list', onPress: () => router.push(appRoutes.grocery) },
          ],
        );
      },
      onError: () => Alert.alert('Couldn’t Add Ingredients', 'Your grocery list was not changed. Please try again.'),
      onSettled: () => setPendingGroceryRecipeId(null),
    });
  }, [addFromRecipeMutation, router]);

  const renderResult = useCallback(({ item }: { item: IngredientMatchResult }) => (
    <IngredientMatchCard
      result={item}
      onOpen={() => {
        haptics.light();
        router.push(appRoutes.recipe(item.recipe.id));
      }}
      onAddMissing={isSignedIn ? () => handleAddMissing(item) : undefined}
      isAdding={pendingGroceryRecipeId === item.recipe.id}
      isAdded={addedGroceryRecipeIds.has(item.recipe.id)}
      isGroceryActionDisabled={addFromRecipeMutation.isPending}
    />
  ), [
    addFromRecipeMutation.isPending,
    addedGroceryRecipeIds,
    handleAddMissing,
    isSignedIn,
    pendingGroceryRecipeId,
    router,
  ]);
  
  const ListEmpty = useCallback(() => {
    if (isLoading || isFetching) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            Searching recipes...
          </Text>
        </View>
      );
    }

    if (queryIngredients.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="nutrition-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            What's in your kitchen?
          </Text>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            Paste or add what you have, and we’ll show what’s ready and what only needs a few extras.
          </Text>
          <Text style={[styles.exampleText, { color: colors.textMuted }]}>
            Separate ingredients with commas or new lines.
          </Text>
        </View>
      );
    }
    
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="sad-outline" size={64} color={colors.textMuted} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No matching recipes
        </Text>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>
          Try different ingredients or add more recipes to your collection.
        </Text>
      </View>
    );
  }, [isLoading, isFetching, queryIngredients.length, colors]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'What Can I Make?',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      />
      
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={100}
      >
        {isSignedIn && <RNView style={[styles.pantrySource, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <RNView style={styles.pantrySourceText}>
            <Ionicons name="basket-outline" size={20} color={colors.tint} />
            <RNView style={{ flex: 1 }}>
              <Text style={[styles.pantrySourceTitle, { color: colors.text }]}>My Pantry</Text>
              <Text style={{ color: colors.textSecondary, fontSize: fontSize.sm }}>
                {pantry.isLoading ? 'Loading what you have…' : `${pantryNames.length} usable item${pantryNames.length === 1 ? '' : 's'} · ${pantry.data?.scope === 'household' ? 'household' : 'personal'}`}
              </Text>
            </RNView>
            <TouchableOpacity onPress={() => router.push(appRoutes.pantry)} style={styles.sourceAction} accessibilityLabel="Manage pantry"><Text style={{ color: colors.tint, fontWeight: fontWeight.semibold }}>Manage</Text></TouchableOpacity>
          </RNView>
          {pantryNames.length > 0 && <TouchableOpacity onPress={() => { if (useSavedPantry && !searchIngredients.length) setShowEditor(true); setUseSavedPantry(!useSavedPantry); }} style={styles.usePantryRow} accessibilityRole="checkbox" accessibilityLabel="Use pantry ingredients in recipe search" accessibilityState={{ checked: useSavedPantry }}>
            <Ionicons name={useSavedPantry ? 'checkbox' : 'square-outline'} size={21} color={colors.tint} />
            <Text style={{ color: colors.text }}>Search with pantry items</Text>
          </TouchableOpacity>}
          {pantry.isError && <Text style={{ color: colors.warning }}>Pantry couldn’t load. You can still search manually.</Text>}
          {pantryNames.length > MAX_SEARCH_INGREDIENTS && <Text style={{ color: colors.warning }}>Search uses the first {MAX_SEARCH_INGREDIENTS} items. Narrow your pantry list for different matches.</Text>}
        </RNView>}
        {!showEditor && <TouchableOpacity onPress={() => setShowEditor(true)} style={[styles.compactEditor, { borderColor: colors.cardBorder, backgroundColor: colors.card }]} accessibilityRole="button" accessibilityLabel="Add or change search ingredients">
          <Ionicons name="add-circle-outline" size={21} color={colors.tint} />
          <Text style={{ color: colors.text, flex: 1, fontWeight: fontWeight.semibold }}>{searchIngredients.length ? `${searchIngredients.length} extra ingredient${searchIngredients.length === 1 ? '' : 's'} added` : 'Add extra ingredients'}</Text>
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        </TouchableOpacity>}
        {showEditor && <>
        <View style={[styles.searchCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <RNView style={styles.searchHeading}>
            <RNView style={[styles.searchIcon, { backgroundColor: colors.tint + '16' }]}>
              <Ionicons name="nutrition-outline" size={22} color={colors.tint} />
            </RNView>
            <RNView style={styles.searchHeadingText}>
              <Text style={[styles.searchTitle, { color: colors.text }]}>Cook with what you have</Text>
              <Text style={[styles.searchHint, { color: colors.textMuted }]}>Paste a list or add ingredients a few at a time.</Text>
            </RNView>
            <TouchableOpacity onPress={() => setShowEditor(false)} style={styles.sourceAction} accessibilityLabel="Collapse ingredient editor"><Ionicons name="chevron-up" size={20} color={colors.textMuted} /></TouchableOpacity>
          </RNView>

          <RNView style={[styles.inputContainer, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder={'chicken, rice, garlic\nor paste one ingredient per line'}
              placeholderTextColor={colors.textMuted}
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={handleSearch}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={1000}
              accessibilityLabel="Ingredients you have"
            />
            {inputText.length > 0 && (
              <TouchableOpacity
                onPress={() => setInputText('')}
                style={styles.clearInputButton}
                accessibilityRole="button"
                accessibilityLabel="Clear ingredient input"
              >
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </RNView>

          {searchIngredients.length === 0 && (
            <RNView style={styles.startersRow}>
              <Text style={[styles.startersLabel, { color: colors.textMuted }]}>Quick add</Text>
              {PANTRY_STARTERS.map((ingredient) => (
                <TouchableOpacity
                  key={ingredient}
                  style={[styles.starterChip, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={() => handleStarterPress(ingredient)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${ingredient} to ingredient search`}
                >
                  <Text style={[styles.starterText, { color: colors.textSecondary }]}>{ingredient}</Text>
                </TouchableOpacity>
              ))}
            </RNView>
          )}

          <TouchableOpacity
            style={[
              styles.searchButton,
              { backgroundColor: inputText.trim() ? colors.tint : colors.border },
            ]}
            onPress={handleSearch}
            disabled={!inputText.trim()}
            accessibilityRole="button"
            accessibilityLabel={searchIngredients.length > 0 ? 'Add ingredients and update results' : 'Find recipes with these ingredients'}
          >
            <Ionicons name="search" size={18} color="#FFFFFF" />
            <Text style={styles.searchButtonText}>
              {searchIngredients.length > 0 ? 'Add & Update Results' : 'Find Recipes'}
            </Text>
          </TouchableOpacity>
        </View>
        
        {/* Active ingredient chips */}
        {queryIngredients.length > 0 && (
          <View style={styles.chipsContainer}>
            <RNView style={styles.chipsScrollRow}>
              <ScrollView
                style={styles.chipsScroller}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
                keyboardShouldPersistTaps="handled"
              >
                {searchIngredients.map((ing) => (
                  <TouchableOpacity
                    key={ing}
                    style={[styles.chip, { backgroundColor: colors.tint + '20', borderColor: colors.tint }]}
                    onPress={() => handleRemoveIngredient(ing)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${ing} from ingredient search`}
                  >
                    <Text style={[styles.chipText, { color: colors.tint }]}>{ing}</Text>
                    <Ionicons name="close" size={14} color={colors.tint} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity
                onPress={handleClear}
                style={styles.clearButton}
                accessibilityRole="button"
                accessibilityLabel="Clear all search ingredients"
              >
                <Text style={[styles.clearText, { color: colors.textMuted }]}>Clear all</Text>
              </TouchableOpacity>
            </RNView>
            
            <Text style={[styles.scopeLabel, { color: colors.textMuted }]}>Search in</Text>
            <View style={styles.togglesRow}>
              {isSignedIn ? (
                <TouchableOpacity
                style={[
                  styles.toggleButton,
                  { 
                    backgroundColor: includePublic ? colors.tint + '20' : colors.backgroundSecondary,
                    borderColor: includePublic ? colors.tint : colors.border,
                  }
                ]}
                onPress={() => {
                  haptics.light();
                  setIncludePublic(!includePublic);
                }}
                accessibilityRole="checkbox"
                accessibilityLabel="Include Discover recipes"
                accessibilityState={{ checked: includePublic }}
                >
                <Ionicons
                  name={includePublic ? "globe" : "globe-outline"}
                  size={14}
                  color={includePublic ? colors.tint : colors.textMuted}
                />
                <Text style={[styles.toggleText, { color: includePublic ? colors.tint : colors.textMuted }]}>
                  Discover
                </Text>
                </TouchableOpacity>
              ) : (
                <RNView style={[styles.guestScope, { backgroundColor: colors.backgroundSecondary }]}>
                  <Ionicons name="globe" size={14} color={colors.tint} />
                  <Text style={[styles.toggleText, { color: colors.textSecondary }]}>Community recipes</Text>
                </RNView>
              )}
              
              {isSignedIn && (
                <TouchableOpacity
                  style={[
                    styles.toggleButton,
                    {
                      backgroundColor: includeSaved ? colors.tint + '20' : colors.backgroundSecondary,
                      borderColor: includeSaved ? colors.tint : colors.border,
                    }
                  ]}
                  onPress={() => {
                    haptics.light();
                  setIncludeSaved(!includeSaved);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityLabel="Include saved recipes"
                  accessibilityState={{ checked: includeSaved }}
                >
                  <Ionicons
                    name={includeSaved ? "bookmark" : "bookmark-outline"}
                    size={14}
                    color={includeSaved ? colors.tint : colors.textMuted}
                  />
                  <Text style={[styles.toggleText, { color: includeSaved ? colors.tint : colors.textMuted }]}>
                    Saved
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {isSignedIn && (
              <Text style={[styles.scopeHelp, { color: colors.textMuted }]}>
                Your own recipes are always included.
              </Text>
            )}
          </View>
        )}
        </>}
        
        {/* Results count */}
        {!isError && data && data.results.length > 0 && (
          <View style={styles.resultsHeader}>
            <Text style={[styles.resultsCount, { color: colors.text }]}>
              Best matches
            </Text>
            <Text style={[styles.resultsSummary, { color: colors.textMuted }]}>
              {data.total} recipe{data.total !== 1 ? 's' : ''} found
            </Text>
          </View>
        )}
        {queryIngredients.length > 0 && <Text style={[styles.matchNote, { color: colors.textMuted }]}>Matches compare ingredient names. Check the recipe for amounts before cooking.</Text>}
        
        {/* Results list */}
        {isError ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="cloud-offline-outline" size={64} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Couldn’t search recipes</Text>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>Your ingredients are still here. Check your connection and try again.</Text>
            <TouchableOpacity
              style={[styles.retryButton, { backgroundColor: colors.tint }]}
              onPress={() => void refetch()}
              accessibilityRole="button"
              accessibilityLabel="Retry ingredient search"
            >
              <Ionicons name="refresh-outline" size={18} color="#FFFFFF" />
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={data?.results || []}
            renderItem={renderResult}
            keyExtractor={(item) => item.recipe.id}
            ListEmptyComponent={ListEmpty}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: insets.bottom + spacing.xl }
            ]}
            showsVerticalScrollIndicator={false}
          />
        )}
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  pantrySource: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  pantrySourceText: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pantrySourceTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  sourceAction: { minWidth: 52, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  usePantryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  compactEditor: {
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  matchNote: { fontSize: fontSize.xs, lineHeight: 17, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  container: {
    flex: 1,
  },
  searchCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.md,
    gap: spacing.md,
  },
  searchHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchHeadingText: {
    flex: 1,
  },
  searchTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  searchHint: {
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: 2,
  },
  inputContainer: {
    height: 96,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 94,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    lineHeight: 21,
  },
  clearInputButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  startersLabel: {
    width: '100%',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  starterChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  starterText: {
    fontSize: fontSize.sm,
  },
  searchButton: {
    minHeight: 48,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchButtonText: {
    color: '#ffffff',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  chipsContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chipsScrollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chipsScroller: {
    flex: 1,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center',
    paddingRight: spacing.md,
  },
  chip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    gap: 4,
  },
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  clearButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  clearText: {
    fontSize: fontSize.sm,
  },
  togglesRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  toggleButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    gap: 4,
  },
  toggleText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  scopeLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  scopeHelp: {
    fontSize: fontSize.xs,
  },
  guestScope: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    gap: 4,
  },
  resultsHeader: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  resultsCount: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  resultsSummary: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: fontSize.xs,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  exampleText: {
    fontSize: fontSize.sm,
    marginTop: spacing.md,
    fontStyle: 'italic',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
