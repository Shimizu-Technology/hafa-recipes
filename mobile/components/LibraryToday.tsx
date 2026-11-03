import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';

import { FadeUp, LookPressable } from '@/components/lookMotion';
import { RecipeThumbnail } from '@/components/RecipeThumbnail';
import { Text, useColors } from '@/components/Themed';
import { useLook } from '@/contexts/LookContext';
import { getRecipeSourcePresentation } from '@/lib/recipeSource';
import type { RecipeListItem } from '@/types/recipe';

/**
 * The Library's "today" moment in the design-preview looks: the latest recipe, set apart from the grid.
 * Cookbook leads with it like a cookbook's recipe of the day, Island gives it a full-bleed feature card,
 * Calm keeps one quiet "Latest" row. Current shows nothing here.
 */
export function LibraryToday({ recipe, onPress }: { recipe: RecipeListItem; onPress: () => void }) {
  const look = useLook();
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const { label: sourceLabel } = getRecipeSourcePresentation(recipe.source_type);
  const meta = [sourceLabel, recipe.total_time].filter(Boolean).join(' · ');
  const a11y = `Latest recipe, ${recipe.title}${meta ? `, ${meta}` : ''}`;
  const large = fontScale >= 1.3;

  if (look.variants.home === 'feature') {
    return <FadeUp index={0} enabled style={styles.block}>
      <LookPressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} testID="library-today"
        style={[styles.feature, { borderRadius: look.radii.card, backgroundColor: colors.backgroundElevated }, look.shadows.float]}>
        <View style={[styles.featureClip, { borderRadius: look.radii.card }]}>
          <RecipeThumbnail uri={recipe.thumbnail_url} style={styles.featurePhoto} accessible={false} placeholderTitle={recipe.title} priority="high" />
          <LinearGradient pointerEvents="none" colors={['rgba(18,16,13,0)', 'rgba(18,16,13,0.45)', 'rgba(18,16,13,0.8)']} style={styles.scrim} />
          <View style={styles.featureCopy}>
            <View style={styles.featureKicker}>
              <View style={[styles.sunDot, { backgroundColor: colors.highlight }]} />
              <Text style={[styles.featureMeta, { color: colors.onPhoto }]}>Latest save{meta ? ` · ${meta}` : ''}</Text>
            </View>
            <Text numberOfLines={large ? 4 : 2} style={[styles.featureTitle, { color: colors.onPhoto, fontFamily: look.fonts?.display }]}>{recipe.title}</Text>
          </View>
        </View>
      </LookPressable>
    </FadeUp>;
  }

  if (look.variants.home === 'lead') {
    return <FadeUp index={0} enabled style={styles.block}>
      <LookPressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} testID="library-today">
        <RecipeThumbnail uri={recipe.thumbnail_url} style={[styles.leadPhoto, { borderRadius: look.radii.photo }]} accessible={false} placeholderTitle={recipe.title} priority="high" />
        <Text style={[styles.leadMeta, { color: colors.textSecondary }]}>Latest in your kitchen{meta ? ` · ${meta}` : ''}</Text>
        <Text numberOfLines={large ? 5 : 3} style={[styles.leadTitle, { color: colors.text, fontFamily: look.fonts?.display }]}>{recipe.title}</Text>
      </LookPressable>
      <View style={[styles.rule, { backgroundColor: colors.hairline }]} />
    </FadeUp>;
  }

  return <FadeUp index={0} enabled style={styles.block}>
    <LookPressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} testID="library-today"
      style={[styles.row, { backgroundColor: colors.backgroundElevated, borderColor: colors.hairline, borderRadius: look.radii.card }]}>
      <RecipeThumbnail uri={recipe.thumbnail_url} style={[styles.rowPhoto, { borderRadius: look.radii.photo }]} accessible={false} placeholderIconSize={22} />
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>Latest</Text>
        <Text numberOfLines={2} style={[styles.rowTitle, { color: colors.text }]}>{recipe.title}</Text>
        {meta ? <Text numberOfLines={1} style={[styles.rowLabel, { color: colors.textSecondary }]}>{meta}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </LookPressable>
  </FadeUp>;
}

const styles = StyleSheet.create({
  block: { marginBottom: 24 },
  feature: {},
  featureClip: { overflow: 'hidden' },
  featurePhoto: { width: '100%', aspectRatio: 4 / 3 },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%' },
  featureCopy: { position: 'absolute', left: 20, right: 20, bottom: 18, gap: 6 },
  featureKicker: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sunDot: { width: 8, height: 8, borderRadius: 4 },
  featureMeta: { fontSize: 13, lineHeight: 18, fontWeight: '600', opacity: 0.9 },
  featureTitle: { fontSize: 28, lineHeight: 33 },
  leadPhoto: { width: '100%', aspectRatio: 3 / 2 },
  leadMeta: { fontSize: 13, lineHeight: 18, marginTop: 12 },
  leadTitle: { fontSize: 28, lineHeight: 33, marginTop: 4 },
  rule: { height: StyleSheet.hairlineWidth, marginTop: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 12, borderWidth: StyleSheet.hairlineWidth },
  rowPhoto: { width: 64, height: 64 },
  rowCopy: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 13, lineHeight: 18 },
  rowTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
});
