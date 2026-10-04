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
  it('rejects NaN and empty objects', () => {
    expect(hasNutritionValues({ calories: NaN })).toBe(false);
    expect(hasNutritionValues({})).toBe(false);
  });
});
