import { describe, expect, it } from 'vitest';

import {
  formatIngredientAmount,
  getRecipeTrustPresentation,
  hasStatedIngredientAmount,
  MISSING_AMOUNT_LABEL,
  normalizeIngredientUnit,
} from './recipeTrust';

describe('recipe trust presentation', () => {
  it('labels only recipe states that still need owner attention', () => {
    expect(getRecipeTrustPresentation('source_incomplete')).toEqual({
      label: 'Needs details',
      accessibilityLabel: 'Recipe needs source details',
    });
    expect(getRecipeTrustPresentation('needs_review')?.label).toBe('Some details uncertain');
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

  it('formats Cook Mode amounts without exposing legacy unit sentinels', () => {
    expect(formatIngredientAmount('2', 'tbsp')).toBe('2 tbsp');
    expect(formatIngredientAmount('2', 'null')).toBe('2');
    expect(formatIngredientAmount('2', ' NULL ')).toBe('2');
    expect(formatIngredientAmount('2', null, '4')).toBe('4');
    expect(formatIngredientAmount(null, 'tsp')).toBe(MISSING_AMOUNT_LABEL);
  });

  it('normalizes units shared by display, export, and persistence', () => {
    expect(normalizeIngredientUnit(null)).toBeNull();
    expect(normalizeIngredientUnit('   ')).toBeNull();
    expect(normalizeIngredientUnit(' NULL ')).toBeNull();
    expect(normalizeIngredientUnit(' tbsp ')).toBe('tbsp');
  });
});
