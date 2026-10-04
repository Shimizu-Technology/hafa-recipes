import type { DerivedValueMetadata, Nutrition, NutritionValues } from '@/types/recipe';

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
    .map((item) => ({ ...item, value: Math.round(Number(nutrition?.total?.[item.key]) * scale * 100) / 100 }));
  const perServing = wholeRecipe ? [] : NUTRIENTS.filter(({ key }) => typeof nutrition?.perServing?.[key] === 'number' && Number.isFinite(nutrition?.perServing?.[key]))
    .map((item) => ({ ...item, value: Number(nutrition?.perServing?.[item.key]) }));
  const sourcePerServing = NUTRIENTS.filter(({ key }) => typeof nutrition?.sourcePerServing?.[key] === 'number' && Number.isFinite(nutrition?.sourcePerServing?.[key]))
    .map((item) => ({ ...item, value: Number(nutrition?.sourcePerServing?.[item.key]) }));
  return { wholeRecipe, total, perServing, sourcePerServing,
    hasValues: total.length > 0 || perServing.length > 0 || sourcePerServing.length > 0 };
}

export type NutritionBasisId = 'recipe_serving' | 'whole_recipe' | 'source_serving' | 'source_reported';
export type NutritionBasis = {
  id: NutritionBasisId;
  label: string;
  detail?: string;
  values: ReturnType<typeof nutritionDisplay>['total'];
};

/** Only compare the same identified source portion; equal numbers alone do not imply equal portions. */
function equalValues(left: NutritionBasis['values'], right: NutritionBasis['values']) {
  return left.length === right.length && left.every((item, index) =>
    item.key === right[index]?.key && item.value === right[index]?.value);
}

export function nutritionBases(nutrition: Nutrition | null | undefined, scaleFactor = 1,
  recipeServings?: number | null): NutritionBasis[] {
  const display = nutritionDisplay(nutrition, scaleFactor);
  const servings = recipeServings === undefined ? nutrition?.servingsUsed : recipeServings;
  const hasKnownServings = typeof servings === 'number' && Number.isFinite(servings) && servings > 0;
  const wholeDetails = [
    ...(display.wholeRecipe && !hasKnownServings ? ['A serving count was not provided.'] : []),
    ...(scaleFactor !== 1 && Number.isFinite(scaleFactor) && scaleFactor > 0 ? ['For the scaled recipe'] : []),
  ].join(' ') || undefined;
  const bases: NutritionBasis[] = [];
  if (display.perServing.length > 0) {
    bases.push(nutrition?.servingBasis === 'source'
      ? { id: 'source_serving', label: 'Source serving', detail: nutrition.sourceServingSize || 'Portion stated by the source', values: display.perServing }
      : { id: 'recipe_serving', label: 'Per serving', detail: nutrition?.servingsUsed ? `Based on ${nutrition.servingsUsed} recipe servings` : undefined, values: display.perServing });
  }
  if (display.total.length > 0) bases.push({ id: 'whole_recipe', label: 'Whole recipe',
    detail: wholeDetails,
    values: display.total });
  if (display.sourcePerServing.length > 0) {
    const sourceBasis = bases.find((basis) => basis.id === 'source_serving');
    if (!sourceBasis || !equalValues(sourceBasis.values, display.sourcePerServing)) {
      bases.push({ id: sourceBasis ? 'source_reported' : 'source_serving',
        label: sourceBasis ? 'Source-reported portion' : 'Source serving',
        detail: nutrition?.sourceServingSize || 'Portion stated by the source', values: display.sourcePerServing });
    }
  }
  return bases;
}

export function selectNutritionBasis(bases: NutritionBasis[], selectedBasisId?: NutritionBasisId) {
  return bases.find((basis) => basis.id === selectedBasisId)
    ?? bases.find((basis) => basis.id === 'recipe_serving')
    ?? bases.find((basis) => basis.id === 'whole_recipe')
    ?? bases[0];
}

/** Preserve both stores: an empty metadata array must not conceal saved assumptions. */
export function nutritionAssumptions(nutrition?: Nutrition | null, metadata?: Partial<DerivedValueMetadata>) {
  return [...new Set([...(metadata?.assumptions ?? []), ...(nutrition?.assumptions ?? [])]
    .filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))];
}

export function nutritionProvenance(metadata?: Partial<DerivedValueMetadata>) {
  switch (metadata?.source) {
    case 'source': return 'Nutrition provided by the recipe source.';
    case 'user_provided': return 'Nutrition entered manually.';
    case 'source_and_ai_estimate': return 'Combines source-provided nutrition with estimates from recipe ingredients.';
    case 'ai_estimate': return 'Estimated from the recipe ingredients. Actual nutrition may vary.';
    default: return 'Approximate nutrition. Actual values may vary.';
  }
}

export function nutritionStatusMessage(hasValues: boolean, metadata?: Partial<DerivedValueMetadata>) {
  if (metadata?.status === 'stale') return 'Ingredients or servings changed. This earlier nutrition may no longer match the recipe.';
  if (metadata?.status === 'unavailable') return metadata.reason || 'Some nutrition could not be estimated. Ingredient amounts may need checking.';
  if (!hasValues) return metadata?.reason || 'Nutrition needs ingredient amounts before it can be estimated.';
  if (metadata?.status === 'unverified' || !metadata?.status) return 'This older nutrition has not been verified against the current recipe.';
  return null;
}

/** Share exactly one honest basis, with the same selection/default rules as the panel. */
export function formatNutritionAsText(nutrition?: Nutrition | null, metadata?: Partial<DerivedValueMetadata>,
  scaleFactor = 1, selectedBasisId?: NutritionBasisId, recipeServings?: number | null) {
  const basis = selectNutritionBasis(nutritionBases(nutrition, scaleFactor, recipeServings), selectedBasisId);
  if (!basis) return '';
  const status = nutritionStatusMessage(true, metadata);
  const assumptions = nutritionAssumptions(nutrition, metadata);
  return [
    `NUTRITION — ${basis.label}${basis.detail ? ` (${basis.detail})` : ''}`,
    basis.values.map((item) => `${item.label}: ${item.value} ${item.unit}`).join(' | '),
    nutritionProvenance(metadata),
    ...(status ? [status] : []),
    ...(assumptions.length ? ['Estimate assumptions:', ...assumptions.map((item) => `• ${item}`)] : []),
  ].join('\n');
}
