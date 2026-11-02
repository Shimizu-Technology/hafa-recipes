import { Alert, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
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

/** Detail and Cook share the same amount, notes and uncertainty hierarchy. */
export function RecipeIngredientGroup({ title, ingredients, scaleFactor, isScaled, scaleFontSize, checked, onToggle, showCosts = false }: Props) {
  const colors = useColors();
  const { fontScale } = useWindowDimensions();
  const lineHeight = scaleFontSize(24);
  if (ingredients.length === 0) return null;
  return <View style={styles.group}>
    {title ? <Text accessibilityRole="header" style={[styles.title, { color: colors.textSecondary, fontSize: scaleFontSize(17), lineHeight: scaleFontSize(24) }]}>{title}</Text> : null}
    <Card noPadding style={styles.card}>
      {ingredients.map((ingredient, index) => {
        const amount = getIngredientAmount(ingredient);
        const quantity = scaleQuantity(amount.quantity, scaleFactor);
        const prefix = quantity ? `${quantity}${amount.unit ? ` ${amount.unit}` : ''} ` : '';
        const notes = getCookingNotes(ingredient.notes);
        const uncertainty = getMissingQuantityLabel(null, ingredient);
        const isChecked = checked?.(index) ?? false;
        const color = isChecked ? colors.textSecondary : colors.text;
        return <View key={index} style={[styles.row, onToggle && styles.checkRow]}>
          {onToggle && <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel={ingredient.name}
            accessibilityState={{ checked: isChecked }} onPress={() => onToggle(index)}
            style={[styles.check, { top: 12 + (lineHeight * fontScale - 44) / 2 }]}>
            <Ionicons name={isChecked ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={isChecked ? colors.actionText : colors.textSecondary} />
          </TouchableOpacity>}
          <View style={styles.main}>
            <Text style={[styles.name, { color, fontSize: scaleFontSize(17), lineHeight }, isChecked && styles.checked]}>
              {prefix ? <Text style={[styles.amount, isScaled && !isChecked && { color: colors.actionText }]}>{prefix}</Text> : null}
              {ingredient.name}
            </Text>
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
          {index < ingredients.length - 1 && <View pointerEvents="none" style={[styles.separator, { left: onToggle ? 60 : 16, backgroundColor: colors.border }]} />}
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
  separator: { position: 'absolute', right: 16, bottom: 0, height: StyleSheet.hairlineWidth },
});
