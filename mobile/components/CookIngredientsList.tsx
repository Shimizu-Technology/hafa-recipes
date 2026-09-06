import { ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Text } from '@/components/Themed';
import { brand, fontSize, fontWeight, spacing } from '@/constants/Colors';
import { scaleQuantity } from '@/hooks/useScaledServings';
import { formatIngredientAmount, hasStatedIngredientAmount } from '../lib/recipeTrust';
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
  return (
    <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
      {ingredients.map((ingredient, index) => {
        const scaledQuantity = scaleQuantity(ingredient.quantity ?? null, scaleFactor);
        const hasAmount = hasStatedIngredientAmount(ingredient.quantity);
        return (
          <RNView key={index} style={styles.row}>
            <Text
              style={[
                styles.quantity,
                isScaled && styles.scaledQuantity,
                !hasAmount && { color: warningColor },
                { fontSize: scaleFontSize(hasAmount ? fontSize.md : fontSize.sm) },
              ]}
            >
              {formatIngredientAmount(ingredient.quantity, ingredient.unit, scaledQuantity)}
            </Text>
            <Text style={[styles.name, { fontSize: scaleFontSize(fontSize.md) }]}>
              {ingredient.name}
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
    width: 124,
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
