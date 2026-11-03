import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { PressScale } from '@/components/chrome/motion';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { Text, useColors } from '@/components/Themed';
import { getRecipeSourcePresentation } from '@/lib/recipeSource';
import { recipeCardAccessibilityLabel } from '@/lib/recipeCardLabel';
import type { RecipeListItem } from '@/types/recipe';

/**
 * The newest recipe with a photo among the first six (or simply the newest), shown once above the grid.
 * Only for an unfiltered Library of three or more recipes, so it never hides a search result.
 */
export function pickLatestRecipe<T extends Pick<RecipeListItem, 'thumbnail_url'>>(recipes: readonly T[] | undefined): T | null {
  if (!recipes || recipes.length < 3) return null;
  return recipes.slice(0, 6).find(recipe => recipe.thumbnail_url?.trim()) ?? recipes[0];
}

/** Library's quiet "Latest" row: a white sheet with a hairline, the photo, the title and where it came from. */
export function LibraryLatest({ recipe, onPress, onLongPress, saved }: { recipe: RecipeListItem; onPress: () => void; onLongPress?: () => void; saved?: boolean }) {
  const colors = useColors();
  const large = useWindowDimensions().fontScale >= 1.3;
  const { label: sourceLabel } = getRecipeSourcePresentation(recipe.source_type);
  const meta = [sourceLabel, recipe.total_time].filter(Boolean).join(' · ');
  // Same spoken details as the grid card it stands in for (review state, time, source, saved).
  const label = recipeCardAccessibilityLabel({ title: recipe.title, reviewState: recipe.review_state, totalTime: recipe.total_time, sourceLabel, saved });
  return <PressScale onPress={onPress} onLongPress={onLongPress} delayLongPress={400} accessibilityRole="button" accessibilityLabel={`Latest recipe, ${label}`}
    testID="library-latest"
    style={[styles.row, large && styles.rowLarge, { backgroundColor: colors.backgroundElevated, borderColor: colors.hairline }]}>
    <RecipeThumbnail uri={recipe.thumbnail_url} style={styles.photo} accessible={false} placeholderIconSize={22} priority="high" />
    <View style={styles.copy}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>Latest</Text>
      <Text numberOfLines={large ? 4 : 2} style={[styles.title, { color: colors.text }]}>{recipe.title}</Text>
      {meta ? <Text numberOfLines={large ? 3 : 1} style={[styles.label, { color: colors.textSecondary }]}>{meta}</Text> : null}
    </View>
    {!large && <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
  </PressScale>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, marginBottom: 24 },
  // Large text: the photo sits above so the title gets the full width instead of one word per line.
  rowLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 12 },
  photo: { width: 64, height: 64, borderRadius: 12 },
  copy: { flex: 1, gap: 2 },
  label: { fontSize: 13, lineHeight: 18 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
});
