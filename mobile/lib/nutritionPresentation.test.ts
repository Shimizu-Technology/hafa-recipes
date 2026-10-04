import { describe, expect, it } from 'vitest';
import { hasNutritionValues, normalizeNutritionValues, nutritionDisplay } from './nutritionPresentation';

describe('nutrition presentation', () => {
  it('shows zero nutrients and never turns unknown values into zero', () => {
    const nutrition = { perServing: normalizeNutritionValues({ calories: 0, fat: 0 }), total: normalizeNutritionValues({}) };
    expect(hasNutritionValues(nutrition.perServing)).toBe(true);
    expect(nutritionDisplay(nutrition).perServing).toMatchObject([{ key: 'calories', value: 0 }, { key: 'fat', value: 0 }]);
    expect(nutritionDisplay(nutrition).total).toEqual([]);
  });
  it('shows only whole-recipe totals when the serving count is unknown', () => {
    const nutrition = { servingBasis: 'whole_recipe' as const, perServing: normalizeNutritionValues({ calories: 100 }), total: normalizeNutritionValues({ calories: 800, protein: 0 }) };
    expect(nutritionDisplay(nutrition).perServing).toEqual([]);
    expect(nutritionDisplay(nutrition).total).toMatchObject([{ value: 800 }, { value: 0 }]);
  });
  it('scales known totals while preserving the per-serving basis', () => {
    const nutrition = { perServing: normalizeNutritionValues({ calories: 100 }), total: normalizeNutritionValues({ calories: 400 }) };
    expect(nutritionDisplay(nutrition, 2).total[0].value).toBe(800);
    expect(nutritionDisplay(nutrition, 2).perServing[0].value).toBe(100);
  });
  it('preserves fractional whole-recipe nutrients instead of rounding them to zero', () => {
    const nutrition = { servingBasis: 'whole_recipe' as const,
      total: normalizeNutritionValues({ fat: 1.25, fiber: 0.2, sugar: 0 }),
      perServing: normalizeNutritionValues({}) };
    expect(nutritionDisplay(nutrition).total).toMatchObject([
      { key: 'fat', value: 1.25 }, { key: 'fiber', value: 0.2 }, { key: 'sugar', value: 0 },
    ]);
    expect(nutritionDisplay(nutrition, 0.5).total).toMatchObject([
      { key: 'fat', value: 0.63 }, { key: 'fiber', value: 0.1 }, { key: 'sugar', value: 0 },
    ]);
  });
  it('rejects NaN and empty objects', () => {
    expect(hasNutritionValues({ calories: NaN })).toBe(false);
    expect(hasNutritionValues({})).toBe(false);
  });
  it('keeps publisher portions separate from recipe-serving estimates while scaling', () => {
    const nutrition = { servingBasis: 'recipe_servings' as const, sourceServingSize: '1 cookie',
      sourcePerServing: { calories: 100, sugar: 0 },
      perServing: normalizeNutritionValues({ calories: 300 }),
      total: normalizeNutritionValues({ calories: 2400 }) };
    const display = nutritionDisplay(nutrition, 2);
    expect(display.total[0].value).toBe(4800);
    expect(display.perServing[0].value).toBe(300);
    expect(display.sourcePerServing).toMatchObject([{ key: 'calories', value: 100 }, { key: 'sugar', value: 0 }]);
  });
});

import {
  formatNutritionAsText, nutritionAssumptions, nutritionBases, nutritionProvenance,
  nutritionStatusMessage, selectNutritionBasis,
} from './nutritionPresentation';

const knownNutrition = () => ({ servingBasis: 'recipe_servings' as const, servingsUsed: 4,
  perServing: normalizeNutritionValues({ calories: 100, protein: 0, fat: 1.25, fiber: 0.2 }),
  total: normalizeNutritionValues({ calories: 400, protein: 0, fat: 5, fiber: 0.8 }),
});

describe('nutrition basis and export', () => {
  it('defaults to a recipe serving and selects scaled whole totals without scaling per servings', () => {
    const bases = nutritionBases(knownNutrition(), 2);
    expect(selectNutritionBasis(bases)?.id).toBe('recipe_serving');
    expect(selectNutritionBasis(bases, 'whole_recipe')?.values[0].value).toBe(800);
    expect(selectNutritionBasis(bases, 'recipe_serving')?.values[0].value).toBe(100);
    expect(selectNutritionBasis(bases, 'source_serving')?.id).toBe('recipe_serving');
  });
  it('never offers recipe servings for an unknown yield, but retains a distinct source portion', () => {
    const nutrition = { ...knownNutrition(), servingBasis: 'whole_recipe' as const,
      sourcePerServing: { calories: 50 }, sourceServingSize: '1 cookie' };
    const bases = nutritionBases(nutrition);
    expect(bases.map(b => b.id)).toEqual(['whole_recipe', 'source_serving']);
    expect(selectNutritionBasis(bases)?.id).toBe('whole_recipe');
    expect(bases[1].detail).toBe('1 cookie');
  });
  it('deduplicates equivalent source portions without mutating saved values', () => {
    const nutrition = { ...knownNutrition(), servingBasis: 'source' as const,
      total: normalizeNutritionValues({}), sourcePerServing: { calories: 100, protein: 0, fat: 1.25, fiber: 0.2 }, sourceServingSize: '1 bowl' };
    const before = JSON.stringify(nutrition);
    expect(nutritionBases(nutrition)).toHaveLength(1);
    expect(JSON.stringify(nutrition)).toBe(before);
  });
  it('does not deduplicate equal numbers for different recipe and source portions', () => {
    const nutrition = { ...knownNutrition(), sourceServingSize: '1 cookie', sourcePerServing: knownNutrition().perServing };
    expect(nutritionBases(nutrition).map(b => b.id)).toEqual(['recipe_serving', 'whole_recipe', 'source_serving']);
  });
  it('keeps differing same-source data reachable rather than silently overwriting it', () => {
    const nutrition = { ...knownNutrition(), servingBasis: 'source' as const, sourcePerServing: { calories: 90 } };
    expect(nutritionBases(nutrition).map(b => b.id)).toEqual(['source_serving', 'whole_recipe', 'source_reported']);
  });
  it('handles source-only and secondary-only partial nutrition without fabricated primary values', () => {
    const nutrition = { perServing: normalizeNutritionValues({}), total: normalizeNutritionValues({}), sourcePerServing: { sodium: 0 } };
    expect(selectNutritionBasis(nutritionBases(nutrition))).toMatchObject({ id: 'source_serving', values: [{ key: 'sodium', value: 0 }] });
    expect(formatNutritionAsText(nutrition)).toContain('Sodium: 0 mg');
    expect(formatNutritionAsText(nutrition)).not.toContain('Calories:');
    expect(formatNutritionAsText(null)).toBe('');
  });
  it('reconciles both assumptions stores and does not let an empty array hide text', () => {
    const nutrition = { ...knownNutrition(), assumptions: ['Nutrition assumption', 'Same assumption'] };
    expect(nutritionAssumptions(nutrition, { assumptions: [] })).toEqual(['Nutrition assumption', 'Same assumption']);
    expect(nutritionAssumptions(nutrition, { assumptions: ['Metadata assumption', 'Same assumption', ' '] }))
      .toEqual(['Metadata assumption', 'Same assumption', 'Nutrition assumption']);
  });
  it.each([
    ['source', 'provided by the recipe source'], ['user_provided', 'entered manually'],
    ['ai_estimate', 'Estimated from'], ['source_and_ai_estimate', 'Combines source-provided'],
  ])('explains %s provenance without inventing how values were obtained', (source, copy) => {
    expect(nutritionProvenance({ source })).toContain(copy);
  });
  it('exports the selected basis, full assumptions, provenance and freshness warnings', () => {
    const nutrition = { ...knownNutrition(), assumptions: ['Used 2 tablespoons of oil.', 'Yield measured after cooking.'] };
    const text = formatNutritionAsText(nutrition, { source: 'ai_estimate', status: 'stale', assumptions: [] }, 2, 'whole_recipe');
    expect(text).toContain('NUTRITION — Whole recipe (For the scaled recipe)');
    expect(text).toContain('Calories: 800 cal');
    expect(text).toContain('Protein: 0 g');
    expect(text).toContain('Ingredients or servings changed');
    expect(text).toContain('• Used 2 tablespoons of oil.');
    expect(text).toContain('• Yield measured after cooking.');
    expect(text).not.toContain('NUTRITION — Per serving');
  });
  it('keeps unavailable and unverified notices independent of whether data exists', () => {
    expect(nutritionStatusMessage(true, { status: 'unavailable', reason: 'Missing oil amount' })).toBe('Missing oil amount');
    expect(nutritionStatusMessage(true, { status: 'unverified' })).toContain('older nutrition');
    expect(nutritionStatusMessage(false, { status: 'current' })).toContain('needs ingredient amounts');
  });
});
