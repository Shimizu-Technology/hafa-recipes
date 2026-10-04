import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, useColors } from '@/components/Themed';
import { fontFamily, fontSize, radius, spacing } from '@/constants/Colors';
import type { DerivedValueMetadata, Nutrition } from '@/types/recipe';
import { useTextSize } from '@/hooks/useTextSize';
import {
  nutritionAssumptions, nutritionBases, nutritionProvenance, nutritionStatusMessage,
  selectNutritionBasis, type NutritionBasisId,
} from '@/lib/nutritionPresentation';

export function NutritionPanel({ nutrition, metadata, scaleFactor = 1, isLoading = false, error,
  onRefresh, selectedBasisId, onBasisChange }: {
  nutrition?: Nutrition | null; metadata?: Partial<DerivedValueMetadata>; scaleFactor?: number;
  isLoading?: boolean; error?: string | null; onRefresh?: () => void;
  selectedBasisId?: NutritionBasisId; onBasisChange?: (basisId: NutritionBasisId) => void;
}) {
  const colors = useColors();
  const { scaleFontSize } = useTextSize();
  const [localBasisId, setLocalBasisId] = useState<NutritionBasisId>();
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const bases = nutritionBases(nutrition, scaleFactor);
  // A controlled parent can reset to undefined after a recipe revision.
  // Never let an earlier local choice override that default selection.
  const requestedBasisId = onBasisChange ? selectedBasisId : selectedBasisId ?? localBasisId;
  const basis = selectNutritionBasis(bases, requestedBasisId);
  const assumptions = nutritionAssumptions(nutrition, metadata);
  const statusMessage = nutritionStatusMessage(Boolean(basis), metadata);
  const provenance = nutritionProvenance(metadata);
  // Keep large text readable with the product's existing dark/light action colors.
  const actionColor = colors.actionText;
  const textStyles = {
    title: { fontSize: scaleFontSize(fontSize.lg), lineHeight: scaleFontSize(24) },
    body: { fontSize: scaleFontSize(fontSize.sm), lineHeight: scaleFontSize(20) },
    value: { fontSize: scaleFontSize(fontSize.xl), lineHeight: scaleFontSize(28) },
  };
  const assumptionsKey = JSON.stringify(assumptions);
  useEffect(() => { setDetailsExpanded(false); }, [assumptionsKey]);

  return <View style={styles.container}>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[styles.title, textStyles.title, { color: colors.text }]}>
        {isLoading ? 'Updating nutrition…' : basis ? 'Nutrition' : 'Nutrition unavailable'}
      </Text>
      {onRefresh && <TouchableOpacity onPress={onRefresh} disabled={isLoading} style={styles.action}
        accessibilityRole="button" accessibilityLabel={basis ? 'Refresh nutrition' : 'Estimate nutrition'}
        accessibilityState={{ disabled: isLoading, busy: isLoading }}>
        {isLoading ? <ActivityIndicator color={actionColor} /> : <Text style={[textStyles.body, { color: actionColor, fontFamily: fontFamily.semibold }]}>
          {basis ? 'Refresh' : 'Estimate'}</Text>}
      </TouchableOpacity>}
    </View>
    {statusMessage && <View style={[styles.notice, { backgroundColor: colors.backgroundSecondary,
      borderColor: metadata?.status === 'stale' ? colors.warning : colors.border }]}>
      <Text style={[textStyles.body, { color: metadata?.status === 'stale' ? colors.warning : colors.textSecondary }]}>{statusMessage}</Text>
    </View>}
    {error && <Text accessibilityRole="alert" style={[textStyles.body, { color: colors.error }]}>{error}</Text>}
    {basis && <>
      {bases.length > 1 ? <View accessibilityRole="tablist" style={styles.bases}>
        {bases.map((option) => <TouchableOpacity key={option.id} style={[styles.basisButton,
          { borderColor: option.id === basis.id ? actionColor : colors.border,
            backgroundColor: option.id === basis.id ? colors.backgroundSecondary : 'transparent' }]}
          onPress={() => {
            if (onBasisChange) onBasisChange(option.id);
            else setLocalBasisId(option.id);
          }}
          accessibilityRole="tab" accessibilityLabel={option.label} accessibilityState={{ selected: option.id === basis.id }}>
          <Text style={[textStyles.body, { color: option.id === basis.id ? actionColor : colors.textSecondary,
            fontFamily: option.id === basis.id ? fontFamily.semibold : fontFamily.regular }]}>{option.label}</Text>
        </TouchableOpacity>)}
      </View> : <Text style={[textStyles.body, { color: colors.text, fontFamily: fontFamily.semibold }]}>{basis.label}</Text>}
      {basis.detail && <Text style={[textStyles.body, { color: colors.textSecondary }]}>{basis.detail}</Text>}
      <View style={styles.primaryGrid}>
        {basis.values.filter((item) => ['calories', 'protein', 'carbs', 'fat'].includes(item.key)).map((item) =>
          <View key={item.key} style={[styles.primaryCell, { backgroundColor: colors.backgroundSecondary }]}
            accessible accessibilityLabel={`${item.label}: ${item.value} ${item.unit}`}>
            <Text style={[styles.value, textStyles.value, { color: colors.text }]}>{item.value} <Text style={textStyles.body}>{item.unit}</Text></Text>
            <Text style={[textStyles.body, { color: colors.textSecondary }]}>{item.label}</Text>
          </View>)}
      </View>
      {basis.values.filter((item) => ['fiber', 'sugar', 'sodium'].includes(item.key)).map((item) =>
        <View key={item.key} style={[styles.nutrientRow, { borderBottomColor: colors.border }]}
          accessible accessibilityLabel={`${item.label}: ${item.value} ${item.unit}`}>
          <Text style={[textStyles.body, { color: colors.textSecondary }]}>{item.label}</Text>
          <Text style={[textStyles.body, { color: colors.text, fontFamily: fontFamily.semibold }]}>{item.value} {item.unit}</Text>
        </View>)}
    </>}
    <Text style={[textStyles.body, { color: colors.textSecondary }]}>{provenance}</Text>
    {assumptions.length > 0 && <View style={[styles.details, { borderTopColor: colors.border }]}>
      <TouchableOpacity onPress={() => setDetailsExpanded(!detailsExpanded)} style={styles.detailsToggle}
        accessibilityRole="button" accessibilityLabel={`Calculation details. ${assumptions.length} ${assumptions.length === 1 ? 'assumption' : 'assumptions'}`}
        accessibilityState={{ expanded: detailsExpanded }}>
        <Text style={[textStyles.body, styles.detailsTitle, { color: actionColor }]}>Calculation details</Text>
        <Text style={[textStyles.body, { color: colors.textMuted }]}>{assumptions.length}</Text>
        <Ionicons name={detailsExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={actionColor} />
      </TouchableOpacity>
      {detailsExpanded && <View style={styles.assumptions}>
        {assumptions.map((assumption, index) => <View key={assumption} style={styles.assumptionRow}>
          <Text style={[textStyles.body, { color: colors.textMuted }]}>{index + 1}.</Text>
          <Text style={[textStyles.body, styles.assumptionText, { color: colors.textSecondary }]}>{assumption}</Text>
        </View>)}
      </View>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, marginBottom: spacing.lg },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, justifyContent: 'space-between' },
  title: { fontFamily: fontFamily.semibold, flex: 1, minWidth: 140 },
  action: { minHeight: 44, minWidth: 44, paddingHorizontal: spacing.sm, justifyContent: 'center', alignItems: 'center' },
  notice: { borderWidth: 1, borderRadius: radius.md, padding: spacing.sm },
  bases: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  basisButton: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  primaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  primaryCell: { padding: spacing.md, borderRadius: radius.md, minWidth: '45%', flexGrow: 1, flexBasis: '45%' },
  value: { fontFamily: fontFamily.semibold },
  nutrientRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm,
    minHeight: 36, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  details: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.sm },
  detailsToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingVertical: spacing.sm },
  detailsTitle: { flex: 1, fontFamily: fontFamily.semibold },
  assumptions: { gap: spacing.md, paddingBottom: spacing.sm },
  assumptionRow: { flexDirection: 'row', gap: spacing.sm },
  assumptionText: { flex: 1 },
});
