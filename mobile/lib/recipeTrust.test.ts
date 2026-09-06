import { describe, expect, it } from 'vitest';

import {
  getRecipeTrustPresentation,
  hasStatedIngredientAmount,
  MISSING_AMOUNT_LABEL,
} from './recipeTrust';

describe('recipe trust presentation', () => {
  it('labels only recipe states that still need owner attention', () => {
    expect(getRecipeTrustPresentation('source_incomplete')).toEqual({
      label: 'Needs details',
      accessibilityLabel: 'Recipe needs source details',
    });
    expect(getRecipeTrustPresentation('needs_review')?.label).toBe('Needs review');
    expect(getRecipeTrustPresentation('ready')).toBeNull();
    expect(getRecipeTrustPresentation(null)).toBeNull();
  });

  it('recognizes missing and legacy sentinel quantities', () => {
    expect(hasStatedIngredientAmount(null)).toBe(false);
    expect(hasStatedIngredientAmount(undefined)).toBe(false);
    expect(hasStatedIngredientAmount('')).toBe(false);
    expect(hasStatedIngredientAmount('  ')).toBe(false);
    expect(hasStatedIngredientAmount('null')).toBe(false);
    expect(hasStatedIngredientAmount(' NULL ')).toBe(false);
    expect(hasStatedIngredientAmount('2')).toBe(true);
    expect(MISSING_AMOUNT_LABEL).toBe('Amount not stated');
  });
});
