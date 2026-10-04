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
