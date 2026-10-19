import { describe, expect, it } from 'vitest';

import { formatRecipeCount, formatSavedRecipeCount } from './recipeCount';

describe('formatRecipeCount', () => {
  it('pluralizes the library total', () => {
    expect(formatRecipeCount(0)).toBe('0 recipes');
    expect(formatRecipeCount(1)).toBe('1 recipe');
    expect(formatRecipeCount(24)).toBe('24 recipes');
  });

  it('shows the filtered share only when it differs from the total', () => {
    expect(formatRecipeCount(24, 5)).toBe('5 of 24 recipes');
    expect(formatRecipeCount(24, 24)).toBe('24 recipes');
  });

  it('describes the saved total for Settings', () => {
    expect(formatSavedRecipeCount(9)).toBe('9 recipes saved');
    expect(formatSavedRecipeCount(1)).toBe('1 recipe saved');
  });
});
