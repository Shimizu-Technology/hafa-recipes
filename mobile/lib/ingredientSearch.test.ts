import { describe, expect, it } from 'vitest';

import { parseIngredientSearchInput } from './ingredientSearch';

describe('parseIngredientSearchInput', () => {
  it('accepts comma-separated and line-separated pasted ingredients', () => {
    expect(parseIngredientSearchInput('Chicken, rice\nGarlic\nolive oil')).toEqual([
      'chicken',
      'rice',
      'garlic',
      'olive oil',
    ]);
  });

  it('removes blank and duplicate ingredients while preserving order', () => {
    expect(parseIngredientSearchInput(' Rice, ,rice\nCHICKEN, chicken ')).toEqual([
      'rice',
      'chicken',
    ]);
  });
});
