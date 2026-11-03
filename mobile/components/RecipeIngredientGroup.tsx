import { useContext, useEffect, useRef, useState } from 'react';
import { useLook } from '@/contexts/LookContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { TextScaleContext } from '@/components/Themed';
import { Alert, Animated, Easing, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { spokenQuantity } from '@/lib/quantityPresentation';
import { Card, Text, useColors } from '@/components/Themed';
import { scaleQuantity } from '@/hooks/useScaledServings';
import { getCookingNotes, getIngredientAmount } from '@/lib/recipeTrust';
import { getMissingQuantityLabel } from '@/lib/recipeReviewPresentation';
import type { Ingredient } from '@/types/recipe';

type Props = {
  title?: string;
  ingredients: Ingredient[];
  scaleFactor: number;
  isScaled: boolean;
  scaleFontSize: (size: number) => number;
  checked?: (index: number) => boolean;
  onToggle?: (index: number) => void;
  showCosts?: boolean;
};

/**
 * Cookbook's check-off: a 1.5pt rule sweeps left to right across the first line in 180ms ease-out.
 * Reduce Motion shows it at once. Only rows ticked after mount sweep.
 */
function StrikeSweep({ checked, top, width, color }: { checked: boolean; top: number; width?: number; color: string }) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(checked ? 1 : 0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduceMotion) { progress.setValue(checked ? 1 : 0); return; }
    Animated.timing(progress, { toValue: checked ? 1 : 0, duration: checked ? 180 : 120, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: true }).start();
  }, [checked, progress, reduceMotion]);
  return <Animated.View pointerEvents="none" style={[styles.sweep, width ? { width, right: undefined } : null,
    { top, backgroundColor: color, transformOrigin: 'left', opacity: progress.interpolate({ inputRange: [0, 0.01, 1], outputRange: [0, 1, 1] }), transform: [{ scaleX: progress }] }]} />;
}

/** Detail and Cook share the same amount, notes and uncertainty hierarchy. */
export function RecipeIngredientGroup({ title, ingredients, scaleFactor, isScaled, scaleFontSize, checked, onToggle, showCosts = false }: Props) {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const lineHeight = scaleFontSize(24);
  const textScale = useContext(TextScaleContext);
  const look = useLook();
  const sweep = look.motion.signature === 'detail-fade-strike';
  const flat = look.variants.card === 'flat';
  const [firstLineWidths, setFirstLineWidths] = useState<Record<number, number>>({});
  if (ingredients.length === 0) return null;
  return <View style={styles.group}>
    {title ? <Text accessibilityRole="header" style={[styles.title, { color: colors.textSecondary, fontSize: scaleFontSize(17), lineHeight: scaleFontSize(24) }]}>{title}</Text> : null}
    <Card noPadding style={[styles.card, look.id !== 'current' && { borderRadius: look.radii.card },
      flat && { backgroundColor: 'transparent', borderRadius: 0, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline }]}>
      {ingredients.map((ingredient, index) => {
        const amount = getIngredientAmount(ingredient);
        const quantity = scaleQuantity(amount.quantity, scaleFactor, amount.unit);
        const prefix = quantity ? `${quantity}${amount.unit ? ` ${amount.unit}` : ''} ` : '';
        const notes = getCookingNotes(ingredient.notes);
        const uncertainty = getMissingQuantityLabel(null, ingredient);
        const isChecked = checked?.(index) ?? false;
        const color = isChecked ? colors.textSecondary : colors.text;
        return <View key={index} style={[styles.row, onToggle && styles.checkRow, flat && styles.flatRow, flat && onToggle && styles.flatCheckRow]}>
          {onToggle && <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel={spokenQuantity(`${prefix}${ingredient.name}`)}
            accessibilityState={{ checked: isChecked }} onPress={() => onToggle(index)}
            style={[styles.check, flat && { left: -6 }, { top: 12 + (lineHeight * textScale * fontScale - 44) / 2 }]}>
            <Ionicons name={isChecked ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={isChecked ? colors.actionText : colors.textSecondary} />
          </TouchableOpacity>}
          <View style={styles.main}>
            <Text accessibilityLabel={spokenQuantity(`${prefix}${ingredient.name}`)} style={[styles.name, { color, fontSize: scaleFontSize(17), lineHeight }, isChecked && !sweep && styles.checked]}
              onTextLayout={sweep ? event => {
                const width = Math.ceil(event.nativeEvent.lines[0]?.width ?? 0);
                setFirstLineWidths(previous => previous[index] === width ? previous : { ...previous, [index]: width });
              } : undefined}>
              {prefix ? <Text style={[styles.amount, isScaled && !isChecked && { color: colors.actionText }]}>{prefix}</Text> : null}
              {ingredient.name}
            </Text>
            {sweep && onToggle && <StrikeSweep checked={isChecked} top={(lineHeight * textScale * fontScale) / 2} width={firstLineWidths[index]} color={colors.textSecondary} />}
            {notes ? <Text style={[styles.secondary, { color: colors.textSecondary, fontSize: scaleFontSize(15), lineHeight: scaleFontSize(21) }]}>{notes}</Text> : null}
            {uncertainty ? amount.isEstimate && amount.reason ? <TouchableOpacity accessibilityRole="button"
              accessibilityLabel={`Why this AI estimate for ${ingredient.name}?`}
              onPress={() => Alert.alert('AI estimate', amount.reason!)} style={styles.estimate}>
              <Text style={[styles.secondary, { color: colors.actionText, fontSize: scaleFontSize(13), lineHeight: scaleFontSize(18) }]}>{uncertainty} · Why?</Text>
            </TouchableOpacity> : <Text style={[styles.secondary, { color: amount.isEstimate ? colors.textSecondary : colors.warning, fontSize: scaleFontSize(13), lineHeight: scaleFontSize(18) }]}>{uncertainty}</Text> : null}
          </View>
          {showCosts && typeof ingredient.estimatedCost === 'number' && <Text style={[styles.cost, { color: colors.textSecondary, fontSize: scaleFontSize(15), lineHeight }]}>
            ${(ingredient.estimatedCost * scaleFactor).toFixed(2)}
          </Text>}
          {index < ingredients.length - 1 && <View pointerEvents="none" style={[styles.separator, { left: onToggle ? (flat ? 44 : 60) : flat ? 0 : 16, backgroundColor: look.id === 'current' ? colors.border : colors.hairline }, flat && { right: 0 }]} />}
        </View>;
      })}
    </Card>
  </View>;
}

const styles = StyleSheet.create({
  group: { marginBottom: 16 },
  title: { fontSize: 17, lineHeight: 24, fontWeight: '600', marginBottom: 8 },
  card: { borderRadius: 12, overflow: 'hidden' },
  row: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkRow: { paddingLeft: 60 },
  check: { position: 'absolute', left: 6, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, lineHeight: 24 },
  amount: { fontWeight: '600' },
  checked: { textDecorationLine: 'line-through' },
  secondary: { marginTop: 4 },
  estimate: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  cost: { flexShrink: 0, fontVariant: ['tabular-nums'] },
  flatRow: { paddingHorizontal: 0 },
  flatCheckRow: { paddingLeft: 44 },
  sweep: { position: 'absolute', left: 0, right: 0, height: 1.5, marginTop: -0.75 },
  separator: { position: 'absolute', right: 16, bottom: 0, height: StyleSheet.hairlineWidth },
});
