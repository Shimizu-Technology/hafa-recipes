import { useState, useCallback, memo } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  View as RNView,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { View, Text, useColors } from '@/components/Themed';
import { useSearchByIngredients } from '@/hooks/useRecipes';
import { IngredientMatchResult } from '@/types/recipe';
import { spacing, fontSize, fontWeight, radius } from '@/constants/Colors';
import { haptics } from '@/utils/haptics';
import { ScalePressable } from '@/components/Animated';

// Thumbnail component with error handling fallback
const RecipeThumbnail = memo(function RecipeThumbnail({
  uri,
  tintColor,
}: {
  uri: string | null | undefined;
  tintColor: string;
}) {
  const [hasError, setHasError] = useState(false);
  
  const showPlaceholder = !uri || hasError;
  
  if (showPlaceholder) {
    return (
      <RNView style={[styles.thumbnailPlaceholder, { backgroundColor: tintColor + '15' }]}>
        <Ionicons name="restaurant-outline" size={32} color={tintColor} />
      </RNView>
    );
  }
  
  return (
    <Image
      source={{ uri }}
      style={styles.thumbnail}
      onError={() => setHasError(true)}
    />
  );
});

export default function IngredientSearchScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  
  const [inputText, setInputText] = useState('');
  const [searchIngredients, setSearchIngredients] = useState<string[]>([]);
  const [includeSaved, setIncludeSaved] = useState(true);
  const [includePublic, setIncludePublic] = useState(true);
  
  // Search query
  const { data, isLoading, isFetching } = useSearchByIngredients(
    searchIngredients,
    includeSaved,
    includePublic,
    searchIngredients.length > 0
  );
  
  const handleSearch = useCallback(() => {
    if (!inputText.trim()) return;
    
    // Parse comma-separated ingredients
    const ingredients = inputText
      .split(',')
      .map(i => i.trim().toLowerCase())
      .filter(i => i.length > 0);
    
    if (ingredients.length > 0) {
      haptics.light();
      setSearchIngredients(ingredients);
    }
  }, [inputText]);
  
  const handleAddIngredient = useCallback((ingredient: string) => {
    if (!ingredient.trim()) return;
    const trimmed = ingredient.trim().toLowerCase();
    if (!searchIngredients.includes(trimmed)) {
      haptics.light();
      setSearchIngredients([...searchIngredients, trimmed]);
      setInputText('');
    }
  }, [searchIngredients]);
  
  const handleRemoveIngredient = useCallback((ingredient: string) => {
    haptics.light();
    setSearchIngredients(searchIngredients.filter(i => i !== ingredient));
  }, [searchIngredients]);
  
  const handleClear = useCallback(() => {
    haptics.light();
    setInputText('');
    setSearchIngredients([]);
  }, []);
  
  const renderResult = useCallback(({ item }: { item: IngredientMatchResult }) => {
    const recipe = item.recipe;
    
    return (
      <ScalePressable
        onPress={() => {
          haptics.light();
          router.push(`/recipe/${recipe.id}`);
        }}
      >
        <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.resultRow}>
            {/* Thumbnail with error fallback */}
            <RecipeThumbnail uri={recipe.thumbnail_url} tintColor={colors.tint} />
            
            {/* Content */}
            <View style={styles.resultContent}>
              <Text style={[styles.resultTitle, { color: colors.text }]} numberOfLines={2}>
                {recipe.title}
              </Text>
              
              {/* Match info */}
              <View style={styles.matchInfo}>
                <View style={[styles.matchBadge, { backgroundColor: colors.tint + '20' }]}>
                  <Text style={[styles.matchBadgeText, { color: colors.tint }]}>
                    {item.match_count}/{item.total_ingredients} ingredients ({item.match_percentage}%)
                  </Text>
                </View>
              </View>
              
              {/* Matched ingredients */}
              <Text style={[styles.matchedText, { color: colors.textMuted }]} numberOfLines={1}>
                ✓ {item.matched_ingredients.slice(0, 4).join(', ')}
                {item.matched_ingredients.length > 4 && ` +${item.matched_ingredients.length - 4} more`}
              </Text>
              
              {/* Missing ingredients */}
              {item.missing_ingredients.length > 0 && (
                <Text style={[styles.missingText, { color: colors.textMuted }]} numberOfLines={1}>
                  Need: {item.missing_ingredients.slice(0, 3).join(', ')}
                  {item.missing_ingredients.length > 3 && ` +${item.missing_ingredients.length - 3} more`}
                </Text>
              )}
            </View>
          </View>
        </View>
      </ScalePressable>
    );
  }, [colors, router]);
  
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
    
    if (searchIngredients.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="nutrition-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            What's in your kitchen?
          </Text>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            Enter ingredients you have, and we'll find recipes you can make.
          </Text>
          <Text style={[styles.exampleText, { color: colors.textMuted }]}>
            Try: chicken, rice, garlic
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
  }, [isLoading, isFetching, searchIngredients.length, colors]);
  
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
        {/* Search Input */}
        <View style={[styles.searchSection, { backgroundColor: colors.background }]}>
          <View style={[styles.inputContainer, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
            <Ionicons name="search-outline" size={20} color={colors.textMuted} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="Enter ingredients (e.g., chicken, rice)"
              placeholderTextColor={colors.textMuted}
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {inputText.length > 0 && (
              <TouchableOpacity onPress={() => setInputText('')}>
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          
          <TouchableOpacity
            style={[styles.searchButton, { backgroundColor: colors.tint }]}
            onPress={handleSearch}
          >
            <Text style={styles.searchButtonText}>Search</Text>
          </TouchableOpacity>
        </View>
        
        {/* Active ingredient chips */}
        {searchIngredients.length > 0 && (
          <View style={styles.chipsContainer}>
            <View style={styles.chipsRow}>
              {searchIngredients.map((ing) => (
                <TouchableOpacity
                  key={ing}
                  style={[styles.chip, { backgroundColor: colors.tint + '20', borderColor: colors.tint }]}
                  onPress={() => handleRemoveIngredient(ing)}
                >
                  <Text style={[styles.chipText, { color: colors.tint }]}>{ing}</Text>
                  <Ionicons name="close" size={14} color={colors.tint} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={handleClear} style={styles.clearButton}>
                <Text style={[styles.clearText, { color: colors.textMuted }]}>Clear all</Text>
              </TouchableOpacity>
            </View>
            
            {/* Toggle buttons */}
            <View style={styles.togglesRow}>
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
            </View>
          </View>
        )}
        
        {/* Results count */}
        {data && data.results.length > 0 && (
          <View style={styles.resultsHeader}>
            <Text style={[styles.resultsCount, { color: colors.text }]}>
              Found {data.total} recipe{data.total !== 1 ? 's' : ''}
            </Text>
          </View>
        )}
        
        {/* Results list */}
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
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchSection: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 44,
    gap: spacing.xs,
  },
  input: {
    flex: 1,
    fontSize: fontSize.md,
    height: '100%',
  },
  searchButton: {
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonText: {
    color: '#ffffff',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  chipsContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
  },
  chip: {
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
    paddingHorizontal: spacing.xs,
  },
  clearText: {
    fontSize: fontSize.sm,
  },
  togglesRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  toggleButton: {
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
  resultsHeader: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  resultsCount: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    flexGrow: 1,
  },
  resultCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    padding: spacing.sm,
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
  },
  thumbnailPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultContent: {
    flex: 1,
    marginLeft: spacing.sm,
    justifyContent: 'center',
  },
  resultTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  matchInfo: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  matchBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  matchBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  matchedText: {
    fontSize: fontSize.xs,
    marginBottom: 2,
  },
  missingText: {
    fontSize: fontSize.xs,
    fontStyle: 'italic',
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
});
