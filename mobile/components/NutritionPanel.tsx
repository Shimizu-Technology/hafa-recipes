import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, radius, spacing } from '@/constants/Colors';
import type { DerivedValueMetadata, Nutrition } from '@/types/recipe';
import { nutritionDisplay } from '@/lib/nutritionPresentation';

export function NutritionPanel({ nutrition, metadata, scaleFactor = 1, isLoading = false, error,
  onRefresh }: { nutrition?: Nutrition | null; metadata?: Partial<DerivedValueMetadata>; scaleFactor?: number;
  isLoading?: boolean; error?: string | null; onRefresh?: () => void }) {
  const colors = useColors();
  const display = nutritionDisplay(nutrition, scaleFactor);
  const status = metadata?.status;
  const assumptions = metadata?.assumptions ?? nutrition?.assumptions ?? [];
  return <View style={styles.container}>
    <View style={styles.header}>
      <Text style={[styles.title, { color: colors.text }]}>
        {isLoading ? 'Estimating nutrition…' : display.hasValues ? 'Nutrition estimate' : 'Nutrition needs an estimate'}
      </Text>
      {onRefresh && <TouchableOpacity onPress={onRefresh} disabled={isLoading} accessibilityRole="button"
        accessibilityLabel={display.hasValues ? 'Refresh nutrition estimate' : 'Estimate nutrition'}>
        {isLoading ? <ActivityIndicator color={colors.tint} /> : <Text style={{ color: colors.tint }}>
          {display.hasValues ? 'Refresh' : 'Estimate'}</Text>}
      </TouchableOpacity>}
    </View>
    <Text style={[styles.note, { color: status === 'stale' ? colors.warning : colors.textSecondary }]}>
      {status === 'stale' ? 'Ingredients or servings changed. Refresh this estimate to use the latest recipe.'
        : status === 'unavailable' ? metadata?.reason || 'Some nutrition could not be estimated. Check the ingredient amounts and try again.'
        : !display.hasValues ? metadata?.reason || 'Nutrition could not be estimated during import. Ingredients and amounts are needed to calculate it.'
        : status === 'unverified' || !status ? 'This older estimate has not been verified against the current recipe.'
        : 'Approximate values based on the recipe ingredients. Actual nutrition may vary.'}
    </Text>
    {display.wholeRecipe && <Text style={[styles.note, { color: colors.textMuted }]}>For the whole recipe. A serving count was not provided.</Text>}
    {nutrition?.sourceServingSize && <Text style={[styles.note, { color: colors.textMuted }]}>Source serving: {nutrition.sourceServingSize}</Text>}
    {error && <Text accessibilityRole="alert" style={[styles.note, { color: colors.error }]}>{error}</Text>}
    {display.total.length > 0 && <>
      <Text style={[styles.label, { color: colors.text }]}>Whole recipe{scaleFactor !== 1 && !display.wholeRecipe ? ' · scaled' : ''}</Text>
      <View style={styles.grid}>{display.total.map((item) => <View key={item.key} style={[styles.cell, { backgroundColor: colors.backgroundSecondary }]}>
        <Text style={[styles.value, { color: colors.tint }]}>{item.value} {item.unit}</Text>
        <Text style={[styles.note, { color: colors.textMuted }]}>{item.label}</Text>
      </View>)}</View>
    </>}
    {display.perServing.length > 0 && <>
      <Text style={[styles.label, { color: colors.text }]}>Per serving</Text>
      <View style={styles.grid}>{display.perServing.map((item) => <View key={item.key} style={[styles.cell, { backgroundColor: colors.backgroundSecondary }]}>
        <Text style={[styles.value, { color: colors.tint }]}>{item.value} {item.unit}</Text>
        <Text style={[styles.note, { color: colors.textMuted }]}>{item.label}</Text>
      </View>)}</View>
    </>}
    {assumptions.length > 0 && <Text style={[styles.note, { color: colors.textMuted }]}>Estimate assumptions: {assumptions.join('; ')}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, marginBottom: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, justifyContent: 'space-between' },
  title: { fontFamily: fontFamily.semibold, fontSize: fontSize.lg, flex: 1 },
  note: { fontSize: fontSize.sm, lineHeight: 20 },
  label: { fontFamily: fontFamily.semibold, marginTop: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: { padding: spacing.md, borderRadius: radius.md, minWidth: '30%', flexGrow: 1 },
  value: { fontSize: fontSize.lg, fontFamily: fontFamily.semibold },
});
