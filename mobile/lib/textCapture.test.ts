import { describe, expect, it } from 'vitest';

import {
  MAX_PASTED_RECIPE_CHARS,
  canExtractPastedRecipe,
  normalizePastedRecipeText,
} from './textCapture';

describe('pasted recipe capture', () => {
  it('normalizes line endings without flattening nested recipe lists', () => {
    expect(normalizePastedRecipeText('  Ingredients:\r\n  - Sauce\r    - Salt  ')).toBe(
      'Ingredients:\n  - Sauce\n    - Salt',
    );
  });

  it('requires non-empty text within the API character limit', () => {
    expect(canExtractPastedRecipe('  ')).toBe(false);
    expect(canExtractPastedRecipe('1 cup rice\nCook it.')).toBe(true);
    expect(canExtractPastedRecipe('x'.repeat(MAX_PASTED_RECIPE_CHARS))).toBe(true);
    expect(canExtractPastedRecipe('x'.repeat(MAX_PASTED_RECIPE_CHARS + 1))).toBe(false);
  });
});
