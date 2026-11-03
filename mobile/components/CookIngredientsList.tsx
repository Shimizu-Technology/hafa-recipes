import { ScrollView, StyleSheet } from 'react-native';
import { layout } from '@/constants/Colors';
import { Text, useColors } from '@/components/Themed';
import { RecipeIngredientGroup } from '@/components/RecipeIngredientGroup';
import type { Ingredient, RecipeComponent } from '@/types/recipe';

type CookIngredientsListProps = {
  ingredients: Ingredient[];
  components?: RecipeComponent[];
  scaleFactor: number;
  isScaled: boolean;
  warningColor: string;
  scaleFontSize: (size: number) => number;
};

/** Keep component context, notes and estimate explanations available while cooking. */
export function CookIngredientsList({ ingredients, components, scaleFactor, isScaled, scaleFontSize }: CookIngredientsListProps) {
  const colors = useColors();
  const groups = components?.length ? components : [{ name: '', ingredients }];
  return <ScrollView style={styles.list} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    {ingredients.length === 0 && <Text style={{ color: colors.textSecondary, fontSize: scaleFontSize(17), lineHeight: scaleFontSize(24) }}>No ingredients listed</Text>}
    {groups.map((group, index) => group.ingredients.length > 0 && <RecipeIngredientGroup key={index}
      title={groups.length > 1 ? group.name : undefined} ingredients={group.ingredients}
      scaleFactor={scaleFactor} isScaled={isScaled} scaleFontSize={scaleFontSize} />)}
  </ScrollView>;
}
const styles = StyleSheet.create({ list: { flex: 1 }, content: { paddingHorizontal: layout.margin, paddingVertical: 16, paddingBottom: 32 } });
