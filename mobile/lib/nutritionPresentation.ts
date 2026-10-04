import type { Nutrition, NutritionValues } from '@/types/recipe';

export const NUTRIENTS: Array<{ key: keyof NutritionValues; label: string; unit: string }> = [
  { key: 'calories', label: 'Calories', unit: 'cal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'fiber', label: 'Fiber', unit: 'g' },
  { key: 'sugar', label: 'Sugar', unit: 'g' },
  { key: 'sodium', label: 'Sodium', unit: 'mg' },
];

export function hasNutritionValues(values: Partial<NutritionValues> | null | undefined) {
  return Boolean(values && NUTRIENTS.some(({ key }) => typeof values[key] === 'number' && Number.isFinite(values[key])));
}

export function normalizeNutritionValues(values: Partial<NutritionValues> | null | undefined): NutritionValues {
  return Object.fromEntries(NUTRIENTS.map(({ key }) => [key,
    typeof values?.[key] === 'number' && Number.isFinite(values[key]) ? values[key] : null])) as unknown as NutritionValues;
}

export function nutritionDisplay(nutrition: Nutrition | null | undefined, scaleFactor = 1) {
  const wholeRecipe = nutrition?.servingBasis === 'whole_recipe';
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const total = NUTRIENTS.filter(({ key }) => Number.isFinite(nutrition?.total?.[key]) && typeof nutrition?.total?.[key] === 'number')
    .map((item) => ({ ...item, value: Math.round(Number(nutrition?.total?.[item.key]) * scale) }));
  const perServing = wholeRecipe ? [] : NUTRIENTS.filter(({ key }) => typeof nutrition?.perServing?.[key] === 'number' && Number.isFinite(nutrition?.perServing?.[key]))
    .map((item) => ({ ...item, value: Number(nutrition?.perServing?.[item.key]) }));
  return { wholeRecipe, total, perServing, hasValues: total.length > 0 || perServing.length > 0 };
}
