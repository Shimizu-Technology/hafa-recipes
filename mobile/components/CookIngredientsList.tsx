import { ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Text, useColors } from '@/components/Themed';
import { brand, fontSize, fontWeight, spacing } from '@/constants/Colors';
import { scaleQuantity } from '@/hooks/useScaledServings';
import { formatIngredientAmount, hasStatedIngredientAmount, getIngredientAmount } from '../lib/recipeTrust';
import type { Ingredient } from '@/types/recipe';

type CookIngredientsListProps = {
  ingredients: Ingredient[];
  scaleFactor: number;
  isScaled: boolean;
  warningColor: string;
  scaleFontSize: (size: number) => number;
};

/** Render Cook Mode ingredient amounts with honest missing-data language. */
export function CookIngredientsList({
  ingredients,
  scaleFactor,
  isScaled,
  warningColor,
  scaleFontSize,
}: CookIngredientsListProps) {
  const colors = useColors();
  return (
    <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
      {ingredients.map((ingredient, index) => {
        const amount = getIngredientAmount(ingredient);
        const scaledQuantity = scaleQuantity(amount.quantity, scaleFactor);
        const hasAmount = hasStatedIngredientAmount(amount.quantity);
        return (
          <RNView key={index} style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text
              style={[
                styles.quantity,
                { color: colors.actionText, flexShrink: 1 },
                isScaled && { color: colors.actionText },
                !hasAmount && { color: warningColor },
                { fontSize: scaleFontSize(hasAmount ? fontSize.md : fontSize.sm) },
              ]}
            >
              {formatIngredientAmount(amount.quantity, amount.unit, scaledQuantity)}
            </Text>
            <Text style={[styles.name, { color: colors.text, fontSize: scaleFontSize(fontSize.md) }]}>
              {ingredient.name}
              {amount.isEstimate && <Text style={{ color: warningColor, fontSize: scaleFontSize(fontSize.sm) }}>{'\nAI estimate'}</Text>}
            </Text>
          </RNView>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  quantity: {
    color: brand.reefHighlight,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    width: '34%',
    paddingRight: 8,
  },
  scaledQuantity: {
    color: brand.reefHighlight,
  },
  name: {
    color: '#ffffff',
    fontSize: fontSize.md,
    flex: 1,
  },
});
